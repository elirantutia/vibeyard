/**
 * Platform-aware hook command generators.
 *
 * Hook commands always invoke pre-installed Python scripts in STATUS_DIR
 * rather than inlining Python source into `sh -c '...'`. Inlining was fragile
 * because Python string literals containing single quotes (e.g. `r'${DIR}'`)
 * terminated the outer shell single-quoted string, producing broken hooks
 * that exited non-zero with no stderr.
 *
 * Commands are returned without a `cmd /c` wrapper — the hook executor
 * (Claude CLI's child_process.exec) already invokes cmd.exe as the shell
 * on Windows.
 */
import * as fs from 'fs';
import * as path from 'path';
import { STATUS_DIR, SCRIPT_DIR } from './hook-status';
import { isWin } from './platform';
import { getPythonCmd } from './python-bin';
import { STOP_INFLIGHT_TRUST_MS } from '../shared/constants';

// Python helper scripts are written to STATUS_DIR via installEventScript()
// and cleaned up on app exit. Shared scripts are installed once via
// installHookScripts(); provider-specific event scripts are installed per
// session.

let scriptsInstalled = false;

/**
 * How long (ms) an in-flight subagent registry entry is trusted before the Stop
 * writer stops counting it. Guards against a lost SubagentStop (which is known
 * to be unreliable, anthropics/claude-code#27755) wedging a session in
 * 'working' forever. Generous because a slow-but-active subagent keeps its
 * entry fresh via PostToolUse (see claude-cli.ts captureEventCmd).
 *
 * Only reached on the FALLBACK branch of stop_status_writer.py — a Stop whose
 * `background_tasks` is empty or absent.
 */
export const STOP_STALE_MS = STOP_INFLIGHT_TRUST_MS;

/**
 * Ensure the shared Python helper scripts exist in STATUS_DIR.
 */
export function installHookScripts(): void {
  if (scriptsInstalled) return;

  // status_writer.py — writes event:status to .status file
  installEventScript('status_writer.py', `import sys,os
event=sys.argv[1]
status=sys.argv[2]
sid=os.environ.get(sys.argv[3],'')
status_dir=sys.argv[4]
if sid:
    with open(os.path.join(status_dir,sid+'.status'),'w') as f:
        f.write(event+':'+status)
`);

  // stop_status_writer.py — decides whether a Stop really ends the session.
  // The main Claude agent fires a top-level Stop every time it pauses to wait
  // on parallel Task subagents, so a naive "Stop -> completed" write produces
  // false completion notifications mid-orchestration.
  //
  // Claude Code answers this directly now: the Stop payload carries
  // `background_tasks` (each `{id,type,status,...}`, type one of shell,
  // subagent, monitor, workflow, teammate, cloud session, MCP task). We hold
  // the session in 'working' only for the types that mean *the model itself
  // will produce more output in this turn* — subagent/teammate/workflow. A
  // backgrounded shell, a monitor, an MCP task or a cloud session may wake the
  // session later, but the turn is over and the user is free to type, so those
  // complete. `session_crons` is deliberately never consulted: a /loop session
  // always has a pending cron and would otherwise never report completed.
  //
  // Only a NON-EMPTY `background_tasks` is authoritative. An empty array is not
  // a reliable "nothing in flight" signal: the CLI filters the array on an
  // `isBackgrounded` flag that Task-spawned subagents only acquire after an
  // optional auto-background timer, so a spurious Stop fired the instant the
  // main agent pauses on freshly-dispatched foreground subagents can carry
  // `[]` while three of them are running — exactly the false completion this
  // writer exists to prevent. So an empty array falls through to the
  // <sid>.subagents registry of in-flight agent ids, which captureEventCmd
  // still maintains, and the two signals are OR'd. Being wrong in this direction costs a late notification
  // bounded by the renderer's STOP_FALLBACK_MS backstop; being wrong in the
  // other direction fires a completion mid-orchestration.
  //
  // The registry is also the whole answer on older CLIs, where the key is
  // absent entirely.
  //
  // argv: [1]=session-id env var, [2]=status_dir, [3]=stale_ms, [4]=marker.
  installEventScript('stop_status_writer.py', `import sys,os,json,time
sid=os.environ.get(sys.argv[1],'')
status_dir=sys.argv[2]
try:
    stale_ms=int(sys.argv[3])
except:
    stale_ms=600000
if not sid:
    sys.exit(0)
d={}
try:
    d=json.load(sys.stdin)
except:
    pass
if not isinstance(d,dict):
    d={}
# A Stop firing inside a subagent is never the parent session completing.
# Keyed on agent_id only: agent_type is ALSO set on the main thread of a session
# started with --agent, which would wedge such a session in 'working' forever.
force_working=bool(d.get('agent_id') or d.get('hook_event_name')=='SubagentStop')
HOLD=('subagent','teammate','workflow')
DONE=('completed','complete','done','failed','error','cancelled','canceled','killed','stopped','timed_out','timeout')
inflight=False
# One pass sorts each live task into three groups. HOLD keeps the turn open.
# SHOW is work that dies with the tab, so the tab marks it: a run_in_background
# shell, a monitor, an MCP task. Everything else is ignored, mirroring Claude
# Code's own filter for internal tasks (cloud session, dream, auto-mode scan,
# memory save) and failing toward no marker for a type added later, since a
# ring that never clears also blocks close and quit. Claude Code's ambient
# artifact watcher ("live updates for artifact ...", re-armed on every resume)
# is also a monitor, but unlike one the user asked for it carries neither a
# command nor an MCP server, which is how it is told apart.
SHOW=('shell','monitor','mcp task')
bg=[]
bt=d.get('background_tasks')
if isinstance(bt,list):
    for task in bt:
        if not isinstance(task,dict):
            continue
        if str(task.get('status','')).strip().lower() in DONE:
            continue
        ty=str(task.get('type','')).strip().lower()
        if ty in HOLD:
            inflight=True
            continue
        if ty not in SHOW or (ty=='monitor' and not (task.get('command') or task.get('server'))):
            continue
        desc=str(task.get('description') or task.get('command') or '')
        bg.append({'type':ty,'description':desc[:120]})
# An empty/absent list is not proof of an idle session — fall back to the registry.
# The registry is {"ids":{agent_id:last_seen_ms}}; a file from before the
# registry ({"n":count,"t":ms}) is still honoured so an upgrade mid-orchestration
# cannot fire a false completion.
if not inflight:
    now=int(time.time()*1000)
    try:
        with open(os.path.join(status_dir,sid+'.subagents')) as f:
            c=json.load(f)
        ids=c.get('ids')
        if isinstance(ids,dict):
            inflight=any(now-int(v)<stale_ms for v in ids.values())
        else:
            inflight=int(c.get('n',0))>0 and now-int(c.get('t',0))<stale_ms
    except:
        pass
status='working' if (force_working or inflight) else 'completed'
os.makedirs(status_dir,exist_ok=True)
# Only a payload that carries the list can say anything about background work,
# and a subagent's own Stop says nothing about the parent. Rewritten only on
# change (each write is an fs event plus an IPC round-trip), and atomically: the
# watcher must never read a truncated file, or a clearing write is lost. The
# temp name does not end in .background, so the watcher ignores it.
if isinstance(bt,list) and not force_working:
    bp=os.path.join(status_dir,sid+'.background')
    out=json.dumps({'tasks':bg})
    try:
        with open(bp) as f:
            same=f.read()==out
    except:
        same=not bg
    if not same:
        with open(bp+'.tmp','w') as f:
            f.write(out)
        os.replace(bp+'.tmp',bp)
with open(os.path.join(status_dir,sid+'.status'),'w') as f:
    f.write('Stop:'+status)
`);

  // session_id_capture.py — captures session_id from JSON stdin
  installEventScript('session_id_capture.py', `import sys,json,os
try:
    d=json.load(sys.stdin)
except:
    sys.exit(0)
sid_env=os.environ.get(sys.argv[1],'')
status_dir=sys.argv[2]
claude_sid=d.get('session_id','')
if sid_env and claude_sid:
    with open(os.path.join(status_dir,sid_env+'.sessionid'),'w') as f:
        f.write(claude_sid)
`);

  // tool_failure_capture.py — captures tool failure details from a
  // PostToolUseFailure payload (`tool_name`, `tool_input`, `error`). Skips
  // `is_interrupt`, which marks a user abort rather than a broken toolchain and
  // must not raise a missing-tool insight. Random suffix so several failures in
  // one turn can't collide.
  installEventScript('tool_failure_capture.py', `import sys,json,os,random,string
try:
    d=json.load(sys.stdin)
except:
    sys.exit(0)
sid=os.environ.get(sys.argv[1],'')
status_dir=sys.argv[2]
tn=d.get('tool_name','')
ti=d.get('tool_input',{})
err=d.get('error','')
if not isinstance(err,str):
    err=json.dumps(err)
# Both renderer detectors require a matching error string, so an empty one is a
# guaranteed-wasted file write + fs event + IPC round-trip.
if sid and tn and err and not d.get('is_interrupt'):
    sfx=''.join(random.choices(string.ascii_lowercase,k=6))
    with open(os.path.join(status_dir,sid+'-'+sfx+'.toolfailure'),'w') as f:
        json.dump({'tool_name':tn,'tool_input':ti,'error':err},f)
`);

  scriptsInstalled = true;
}

/**
 * Generate a hook command that writes event:status to the .status file.
 */
export function statusCmd(
  event: string,
  status: string,
  sessionIdVar: string,
  hookMarker: string,
): string {
  if (isWin) {
    const py = path.join(SCRIPT_DIR, 'status_writer.py').replace(/\\/g, '/');
    const dir = STATUS_DIR.replace(/\\/g, '/');
    return `${getPythonCmd()} "${py}" "${event}" "${status}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
  }
  return `sh -c 'mkdir -p ${STATUS_DIR} && echo ${event}:${status} > ${STATUS_DIR}/$${sessionIdVar}.status ${hookMarker}'`;
}

/**
 * Generate the subagent-aware Stop status command. Invokes stop_status_writer.py
 * which writes 'completed' only when no subagents are in flight (else 'working').
 * Mirrors captureSessionIdCmd (no isWin branch — relies on getPythonCmd() + normalized paths).
 */
export function stopStatusCmd(
  sessionIdVar: string,
  hookMarker: string,
): string {
  const py = path.join(SCRIPT_DIR, 'stop_status_writer.py').replace(/\\/g, '/');
  const dir = STATUS_DIR.replace(/\\/g, '/');
  return `${getPythonCmd()} "${py}" "${sessionIdVar}" "${dir}" "${STOP_STALE_MS}" "${hookMarker}"`;
}

/**
 * Generate a hook command that captures session_id from JSON stdin.
 */
export function captureSessionIdCmd(
  sessionIdVar: string,
  hookMarker: string,
): string {
  const py = path.join(SCRIPT_DIR, 'session_id_capture.py').replace(/\\/g, '/');
  const dir = STATUS_DIR.replace(/\\/g, '/');
  return `${getPythonCmd()} "${py}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
}

/**
 * Generate a hook command that captures tool failure details.
 */
export function captureToolFailureCmd(
  sessionIdVar: string,
  hookMarker: string,
): string {
  const py = path.join(SCRIPT_DIR, 'tool_failure_capture.py').replace(/\\/g, '/');
  const dir = STATUS_DIR.replace(/\\/g, '/');
  return `${getPythonCmd()} "${py}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
}

/**
 * Write a Python event script to STATUS_DIR.
 * Call this before `wrapPythonHookCmd` to ensure the script file exists.
 *
 * @param scriptName Unique name for the .py file
 * @param pythonCode Multi-line Python code
 */
export function installEventScript(scriptName: string, pythonCode: string): void {
  fs.mkdirSync(SCRIPT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCRIPT_DIR, scriptName), pythonCode);
}

/**
 * Return a hook command that invokes a pre-installed Python event script.
 * The script must already exist in STATUS_DIR — call `installEventScript`
 * first.
 *
 * @param scriptName Unique name for the .py file
 * @param _pythonCode Unused; retained for call-site compatibility
 * @param hookMarker The marker string to identify IDE hooks
 * @param _pipeStdin Unused; scripts always read from stdin when invoked by
 *   Claude Code hooks
 */
export function wrapPythonHookCmd(
  scriptName: string,
  _pythonCode: string,
  hookMarker: string,
  _pipeStdin = true,
): string {
  const pyCmd = path.join(SCRIPT_DIR, scriptName).replace(/\\/g, '/');
  return `${getPythonCmd()} "${pyCmd}" "${hookMarker}"`;
}


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
import { isWin, pythonBin as PY } from './platform';

// Python helper scripts are written to STATUS_DIR via installEventScript()
// and cleaned up on app exit. Shared scripts are installed once via
// installHookScripts(); provider-specific event scripts are installed per
// session.

let scriptsInstalled = false;

/**
 * How long (ms) an in-flight subagent count is trusted before the Stop writer
 * falls back to 'completed'. Guards against a lost SubagentStop (which is
 * known to be unreliable, anthropics/claude-code#27755) wedging a session in
 * 'working' forever. Generous because a slow-but-active subagent keeps the
 * counter's timestamp fresh via PostToolUse (see claude-cli.ts captureEventCmd).
 */
export const STOP_STALE_MS = 600000;

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

  // stop_status_writer.py — subagent-aware Stop handler. The main Claude agent
  // fires a top-level Stop hook every time it pauses to wait on parallel Task
  // subagents, so a naive "Stop -> completed" write produces false completion
  // notifications mid-orchestration. This reads the per-session in-flight
  // subagent counter (<sid>.subagents, maintained by the captureEventCmd
  // scripts) and only writes 'completed' when no subagents are in flight.
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
force_working=False
try:
    d=json.load(sys.stdin)
    if d.get('agent_id') or d.get('agent_type') or d.get('hook_event_name')=='SubagentStop':
        force_working=True
except:
    pass
n=0
t=0
try:
    with open(os.path.join(status_dir,sid+'.subagents')) as f:
        c=json.load(f)
        n=int(c.get('n',0))
        t=int(c.get('t',0))
except:
    pass
now=int(time.time()*1000)
inflight=n>0 and (now-t)<stale_ms
status='working' if (force_working or inflight) else 'completed'
os.makedirs(status_dir,exist_ok=True)
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

  // tool_failure_capture.py — captures tool failure details
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
if sid and tn:
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
    return `python "${py}" "${event}" "${status}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
  }
  return `sh -c 'mkdir -p ${STATUS_DIR} && echo ${event}:${status} > ${STATUS_DIR}/$${sessionIdVar}.status ${hookMarker}'`;
}

/**
 * Generate the subagent-aware Stop status command. Invokes stop_status_writer.py
 * which writes 'completed' only when no subagents are in flight (else 'working').
 * Mirrors captureSessionIdCmd (no isWin branch — relies on PY + normalized paths).
 */
export function stopStatusCmd(
  sessionIdVar: string,
  hookMarker: string,
): string {
  const py = path.join(SCRIPT_DIR, 'stop_status_writer.py').replace(/\\/g, '/');
  const dir = STATUS_DIR.replace(/\\/g, '/');
  return `${PY} "${py}" "${sessionIdVar}" "${dir}" "${STOP_STALE_MS}" "${hookMarker}"`;
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
  return `${PY} "${py}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
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
  return `${PY} "${py}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
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
  return `${PY} "${pyCmd}" "${hookMarker}"`;
}


import * as fs from 'fs';
import * as path from 'path';
import { STATUS_DIR, SCRIPT_DIR } from './hook-status';
import { installEventScript, installHookScripts } from './hook-commands';
import { readFileSafe, readJsonSafe } from './fs-utils';
import { pythonBin } from './platform';
import type { SettingsValidationResult, InspectorEventType } from '../shared/types';

type HookStatus = 'waiting' | 'working' | 'completed';

export const COPILOT_HOOK_MARKER = '# vibeyard-hook';
export const SESSION_ID_VAR = 'VIBEYARD_SESSION_ID';

const HOOK_FILENAME = 'vibeyard-copilot-hooks.json';
const EVENT_CAPTURE_SCRIPT = 'copilot_event_capture.py';

// Per https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-hooks
// Each Copilot hook event is mapped to a session status transition and an
// inspector event type consumed by the renderer timeline.
const COPILOT_EVENTS: Record<string, { status: HookStatus; type: InspectorEventType }> = {
  sessionStart:        { status: 'waiting',   type: 'session_start' },
  userPromptSubmitted: { status: 'working',   type: 'user_prompt' },
  preToolUse:          { status: 'working',   type: 'pre_tool_use' },
  postToolUse:         { status: 'working',   type: 'tool_use' },
  errorOccurred:       { status: 'working',   type: 'tool_failure' },
  agentStop:           { status: 'completed', type: 'stop' },
  sessionEnd:          { status: 'completed', type: 'session_end' },
};

const EXPECTED_HOOK_EVENTS = Object.keys(COPILOT_EVENTS);

interface HookEntry {
  type?: string;
  bash?: string;
  powershell?: string;
  [key: string]: unknown;
}

type HooksConfig = Record<string, HookEntry[]>;

// The last project path we installed hooks for. reinstallSettings() and
// validateSettings() are called without a projectPath from the IPC layer,
// so we remember the last one here.
let lastProjectPath: string | null = null;

function hookFilePath(projectPath: string): string {
  return path.join(projectPath, '.github', 'hooks', HOOK_FILENAME);
}

function isIdeHook(h: HookEntry): boolean {
  return !!(h.bash?.includes(COPILOT_HOOK_MARKER) || h.powershell?.includes(COPILOT_HOOK_MARKER));
}

// The Python dispatcher script handles all six events. Dispatched by argv[1].
// Reads stdin JSON (Copilot hook payload), writes .status + .events keyed off
// $VIBEYARD_SESSION_ID, opportunistically captures the Copilot session ID into
// .sessionid, and for postToolUse failures / errorOccurred also writes a
// .toolfailure record.
//
// Payload shapes per https://docs.github.com/en/copilot/reference/hooks-configuration:
//   sessionStart        {timestamp, cwd, source, initialPrompt, sessionId?}
//   userPromptSubmitted {timestamp, cwd, prompt, sessionId?}
//   preToolUse          {timestamp, cwd, toolName, toolArgs, sessionId?}
//   postToolUse         {timestamp, cwd, toolName, toolArgs, toolResult, sessionId?}
//   errorOccurred       {timestamp, cwd, error:{message,name,stack}, sessionId?}
//   sessionEnd          {timestamp, cwd, reason, sessionId?}
// Some Copilot builds nest the payload under `input` / `data`, so the script
// checks all three shapes before deciding whether it can emit .sessionid.
//
// The hook subprocess still keys its sidecar files off the Vibeyard session ID
// from CopilotProvider.buildEnv(), but when Copilot also includes its own
// session ID we persist that separately for resume/history support.
const EVENT_CAPTURE_SCRIPT_BODY = `import sys,json,os,time,random,string
try:
    d=json.load(sys.stdin)
except:
    d={}
try:
    event=sys.argv[1]
    etype=sys.argv[2]
    status=sys.argv[3]
    sid_var=sys.argv[4]
    status_dir=sys.argv[5]
    sid=os.environ.get(sid_var,'')
    if not sid:
        sys.exit(0)
    os.makedirs(status_dir,exist_ok=True)
    session_id = ''
    if isinstance(d.get('input'), dict):
        session_id = d['input'].get('sessionId','') or d['input'].get('session_id','')
    if (not session_id) and isinstance(d.get('data'), dict):
        session_id = d['data'].get('sessionId','') or d['data'].get('session_id','')
    if not session_id:
        session_id = d.get('sessionId','') or d.get('session_id','')
    if session_id:
        with open(os.path.join(status_dir,sid+'.sessionid'),'w') as f:
            f.write(session_id)
    if status != 'none':
        with open(os.path.join(status_dir,sid+'.status'),'w') as f:
            f.write(event+':'+status)
    e={'type':etype,'timestamp':int(time.time()*1000),'hookEvent':event}
    tn=d.get('toolName','')
    if tn:
        e['tool_name']=tn
    ta=d.get('toolArgs')
    if ta:
        if isinstance(ta,str):
            try:
                e['tool_input']=json.loads(ta)
            except:
                e['tool_input']={'raw':ta}
        elif isinstance(ta,dict):
            e['tool_input']=ta
    err=d.get('error')
    err_msg=''
    if isinstance(err,dict):
        err_msg=err.get('message','') or err.get('name','')
    elif isinstance(err,str):
        err_msg=err
    if err_msg:
        e['error']=err_msg
    cw=d.get('cwd','')
    if cw:
        e['cwd']=cw
    msg=d.get('prompt','') or d.get('initialPrompt','')
    if msg:
        e['message']=msg
    tr=d.get('toolResult')
    tr_error=''
    if isinstance(tr,dict):
        rt=tr.get('resultType','')
        if rt in ('failure','denied'):
            tr_error=tr.get('textResultForLlm','') or rt
    if tr_error and 'error' not in e:
        e['error']=tr_error
    with open(os.path.join(status_dir,sid+'.events'),'a') as f:
        f.write(json.dumps(e)+'\\n')
    needs_failure = (event=='errorOccurred' and err_msg) or (event=='postToolUse' and tr_error)
    if needs_failure and tn:
        sfx=''.join(random.choices(string.ascii_lowercase,k=6))
        with open(os.path.join(status_dir,sid+'-'+sfx+'.toolfailure'),'w') as f:
            json.dump({'tool_name':tn,'tool_input':e.get('tool_input',{}),'error':err_msg or tr_error},f)
except:
    sys.exit(0)
`;

function buildHookEntry(event: string): HookEntry {
  const { status, type } = COPILOT_EVENTS[event];
  const script = path.join(SCRIPT_DIR, EVENT_CAPTURE_SCRIPT).replace(/\\/g, '/');
  const statusDir = STATUS_DIR.replace(/\\/g, '/');
  // Hook subprocesses spawned by Copilot CLI inherit VIBEYARD_SESSION_ID from
  // the PTY env. The Python script reads argv[4] as the env var *name*.
  const argv = `"${event}" "${type}" "${status}" "${SESSION_ID_VAR}" "${statusDir}"`;
  const bash = `${pythonBin} "${script}" ${argv} ${COPILOT_HOOK_MARKER}`;
  const powershell = `python "${script}" ${argv} ${COPILOT_HOOK_MARKER}`;
  return { type: 'command', bash, powershell };
}

function buildHooksConfig(): HooksConfig {
  const hooks: HooksConfig = {};
  for (const event of EXPECTED_HOOK_EVENTS) {
    hooks[event] = [buildHookEntry(event)];
  }
  return hooks;
}

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export function installCopilotHooks(projectPath?: string): void {
  const target = projectPath ?? lastProjectPath;
  if (!target) return; // no-op on boot before any project is active
  lastProjectPath = target;

  installHookScripts();
  installEventScript(EVENT_CAPTURE_SCRIPT, EVENT_CAPTURE_SCRIPT_BODY);

  const filePath = hookFilePath(target);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const payload = {
    version: 1,
    hooks: buildHooksConfig(),
  };
  const serialized = JSON.stringify(payload, null, 2) + '\n';
  // Skip write when content is byte-identical — spawnPty calls this on every
  // Copilot session, and the payload is deterministic across spawns.
  if (readFileSafe(filePath) !== serialized) {
    fs.writeFileSync(filePath, serialized);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateCopilotHooks(projectPath?: string): SettingsValidationResult {
  const target = projectPath ?? lastProjectPath;
  const hookDetails: Record<string, boolean> = Object.fromEntries(
    EXPECTED_HOOK_EVENTS.map((e) => [e, false]),
  );

  if (!target) {
    return { statusLine: 'vibeyard', hooks: 'missing', hookDetails };
  }

  const raw = readJsonSafe(hookFilePath(target));
  const hooks: HooksConfig = (raw?.hooks ?? {}) as HooksConfig;
  let found = 0;
  for (const event of EXPECTED_HOOK_EVENTS) {
    const entries = hooks[event];
    const installed = entries?.some((h) => isIdeHook(h)) ?? false;
    hookDetails[event] = installed;
    if (installed) found++;
  }

  let status: SettingsValidationResult['hooks'] = 'missing';
  if (found === EXPECTED_HOOK_EVENTS.length) status = 'complete';
  else if (found > 0) status = 'partial';

  return { statusLine: 'vibeyard', hooks: status, hookDetails };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function cleanupCopilotHooks(projectPath?: string): void {
  const target = projectPath ?? lastProjectPath;
  if (!target) return;
  try {
    fs.unlinkSync(hookFilePath(target));
  } catch {
    // already gone
  }
}

/** @internal Test-only: reset module state */
export function _resetForTesting(): void {
  lastProjectPath = null;
}

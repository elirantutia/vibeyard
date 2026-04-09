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
import { STATUS_DIR } from './hook-status';

const isWin = process.platform === 'win32';

const PY = isWin ? 'python' : '/usr/bin/python3';

// Python helper scripts are written to STATUS_DIR via installEventScript()
// and cleaned up on app exit. Shared scripts are installed once via
// installHookScripts(); provider-specific event scripts are installed per
// session.

let scriptsInstalled = false;

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
    const py = path.join(STATUS_DIR, 'status_writer.py').replace(/\\/g, '/');
    const dir = STATUS_DIR.replace(/\\/g, '/');
    return `python "${py}" "${event}" "${status}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
  }
  return `sh -c 'mkdir -p ${STATUS_DIR} && echo ${event}:${status} > ${STATUS_DIR}/$${sessionIdVar}.status ${hookMarker}'`;
}

/**
 * Generate a hook command that captures session_id from JSON stdin.
 */
export function captureSessionIdCmd(
  sessionIdVar: string,
  hookMarker: string,
): string {
  const py = path.join(STATUS_DIR, 'session_id_capture.py').replace(/\\/g, '/');
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
  const py = path.join(STATUS_DIR, 'tool_failure_capture.py').replace(/\\/g, '/');
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
  fs.mkdirSync(STATUS_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATUS_DIR, scriptName), pythonCode);
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
  const pyCmd = path.join(STATUS_DIR, scriptName).replace(/\\/g, '/');
  return `${PY} "${pyCmd}" "${hookMarker}"`;
}

/**
 * Clean up hook scripts from STATUS_DIR.
 */
export function cleanupHookScripts(): void {
  const scripts = ['status_writer.py', 'session_id_capture.py', 'tool_failure_capture.py'];
  for (const name of scripts) {
    try { fs.unlinkSync(path.join(STATUS_DIR, name)); } catch {}
  }
  // Also clean up any event capture scripts
  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const f of files) {
      if (f.endsWith('.py')) {
        try { fs.unlinkSync(path.join(STATUS_DIR, f)); } catch {}
      }
    }
  } catch {}
  scriptsInstalled = false;
}

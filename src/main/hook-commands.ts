/**
 * Platform-aware hook command generators.
 *
 * On Unix, hooks are `sh -c '...'` commands with inline Python.
 * On Windows, hooks delegate to Python scripts in STATUS_DIR.
 * Commands are returned without a `cmd /c` wrapper — the hook executor
 * (Claude CLI's child_process.exec) already invokes cmd.exe as the shell.
 */
import * as fs from 'fs';
import * as path from 'path';
import { STATUS_DIR } from './hook-status';

const isWin = process.platform === 'win32';

// On Windows, we write Python helper scripts to STATUS_DIR and call them from .cmd wrappers.
// The scripts are written once during installHooks and cleaned up on app exit.

let scriptsInstalled = false;

/**
 * Ensure the Python helper scripts exist in STATUS_DIR (Windows only).
 * No-op on Unix.
 */
export function installHookScripts(): void {
  if (!isWin || scriptsInstalled) return;
  fs.mkdirSync(STATUS_DIR, { recursive: true });

  // status_writer.py — writes event:status to .status file
  fs.writeFileSync(path.join(STATUS_DIR, 'status_writer.py'), `import sys,os
event=sys.argv[1]
status=sys.argv[2]
sid=os.environ.get(sys.argv[3],'')
status_dir=sys.argv[4]
if sid:
    with open(os.path.join(status_dir,sid+'.status'),'w') as f:
        f.write(event+':'+status)
`);

  // session_id_capture.py — captures session_id from JSON stdin
  fs.writeFileSync(path.join(STATUS_DIR, 'session_id_capture.py'), `import sys,json,os
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
  fs.writeFileSync(path.join(STATUS_DIR, 'tool_failure_capture.py'), `import sys,json,os,random,string
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
  if (isWin) {
    const py = path.join(STATUS_DIR, 'session_id_capture.py').replace(/\\/g, '/');
    const dir = STATUS_DIR.replace(/\\/g, '/');
    return `python "${py}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
  }
  return `sh -c 'input=$(cat); sid=$(echo "$input" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get(\\"session_id\\",\\"\\"))" 2>/dev/null); if [ -n "$sid" ]; then mkdir -p ${STATUS_DIR} && echo "$sid" > ${STATUS_DIR}/$${sessionIdVar}.sessionid; fi ${hookMarker}'`;
}

/**
 * Generate a hook command that captures tool failure details.
 */
export function captureToolFailureCmd(
  sessionIdVar: string,
  hookMarker: string,
): string {
  if (isWin) {
    const py = path.join(STATUS_DIR, 'tool_failure_capture.py').replace(/\\/g, '/');
    const dir = STATUS_DIR.replace(/\\/g, '/');
    return `python "${py}" "${sessionIdVar}" "${dir}" "${hookMarker}"`;
  }
  return `sh -c 'cat | /usr/bin/python3 -c "import sys,json,os,random,string; d=json.load(sys.stdin); sid=os.environ.get(\\"${sessionIdVar}\\",\\"\\"); tn=d.get(\\"tool_name\\",\\"\\"); ti=d.get(\\"tool_input\\",{}); err=d.get(\\"error\\",\\"\\"); sfx=\\"\\".join(random.choices(string.ascii_lowercase,k=6)); json.dump({\\"tool_name\\":tn,\\"tool_input\\":ti,\\"error\\":err},open(f\\"${STATUS_DIR}/\\"+sid+\\"-\\"+sfx+\\".toolfailure\\",\\"w\\")) if sid and tn else None" 2>/dev/null ${hookMarker}'`;
}

/**
 * Write a Python script to STATUS_DIR and return a platform-appropriate hook command.
 *
 * On Unix: returns `sh -c '... | /usr/bin/python3 -c "..." 2>/dev/null marker'`
 * On Windows: writes the Python to a .py file in STATUS_DIR and returns a command
 *   that invokes it. The file write is a deliberate side effect — scripts are cleaned
 *   up by `cleanupHookScripts` which scans STATUS_DIR for all .py files.
 *
 * @param scriptName Unique name for the .py file (Windows)
 * @param pythonCode Multi-line Python code
 * @param hookMarker The marker string to identify IDE hooks
 * @param pipeStdin Whether to pipe stdin to the script (default true)
 */
export function wrapPythonHookCmd(
  scriptName: string,
  pythonCode: string,
  hookMarker: string,
  pipeStdin = true,
): string {
  if (isWin) {
    const pyPath = path.join(STATUS_DIR, scriptName);
    fs.mkdirSync(STATUS_DIR, { recursive: true });
    fs.writeFileSync(pyPath, pythonCode);
    const pyCmd = pyPath.replace(/\\/g, '/');
    return `python "${pyCmd}" "${hookMarker}"`;
  }
  // Unix: inline the Python in sh -c, escaping double-quotes
  const escaped = pythonCode.replace(/"/g, '\\"');
  const cat = pipeStdin ? 'cat | ' : '';
  return `sh -c '${cat}/usr/bin/python3 -c "${escaped}" 2>/dev/null ${hookMarker}'`;
}

/**
 * Clean up Windows hook scripts from STATUS_DIR.
 */
export function cleanupHookScripts(): void {
  if (!isWin) return;
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

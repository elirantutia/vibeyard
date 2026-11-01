const path = require('path');
const os = require('os');

// Run the Python client directly, never through a shell: on Windows a .cmd
// needs shell:true, which would let cmd.exe reinterpret the user's arguments.
// Mirrors pythonBin in src/main/platform.ts.
function ctlInvocation(home = os.homedir(), win = process.platform === 'win32') {
  const join = win ? path.win32.join : path.posix.join;
  return { command: win ? 'python' : '/usr/bin/python3', script: join(home, '.vibeyard', 'run', 'bin', 'ctl.py') };
}

// Decide what the launcher prints and exits with after spawnSync. A spawn
// failure (e.g. python missing) must still honour the one-JSON-object contract.
function forwardResult(r, command) {
  if (r.error) {
    return {
      output: JSON.stringify({ ok: false, error: { code: 'timeout', message: `cannot run ${command}: ${r.error.message}` } }),
      code: 2,
    };
  }
  return { code: r.status === null ? 2 : r.status };
}

module.exports = { ctlInvocation, forwardResult };

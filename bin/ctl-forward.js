const path = require('path');
const os = require('os');

// Never run the client through a shell that would reinterpret the user's
// arguments. On POSIX, hand the installed `vibeyard-ctl` wrapper to /bin/sh as
// a script: arguments reach it as "$@" untouched, and it carries the Python
// interpreter the app resolved (src/main/python-bin.ts), so the terminal and
// the app can't disagree about which python3 runs. On Windows that wrapper is
// a .cmd, which needs shell:true (cmd.exe would expand %VAR% etc.), so run
// Python on ctl.py directly instead.
function ctlInvocation(home = os.homedir(), win = process.platform === 'win32') {
  const binDir = (win ? path.win32.join : path.posix.join)(home, '.vibeyard', 'run', 'bin');
  return win
    ? { command: 'python', script: path.win32.join(binDir, 'ctl.py') }
    : { command: '/bin/sh', script: path.posix.join(binDir, 'vibeyard-ctl') };
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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { isMac, isWin, pathSep, whichCmd } from './platform';
import { getPythonBin, isPythonUsable } from './python-bin';

/**
 * Check whether the Python interpreter the hook, statusLine and vibeyard-ctl
 * scripts run under is usable. Returns null if OK, or a warning message.
 */
export function checkPythonAvailable(): string | null {
  if (isPythonUsable()) return null;
  const install = isWin
    ? 'Install Python from https://www.python.org/downloads/ or via:\n  winget install Python.Python.3\n'
    : isMac
      ? 'Install Python 3 (e.g. `brew install python`) or the Command Line Tools (`xcode-select --install`), then restart Vibeyard.\n'
      : 'Install Python 3 with your package manager so `python3` is on your login shell\'s PATH, then restart Vibeyard.\n';
  return (
    'Python not found.\n\n' +
    'Vibeyard uses Python for session tracking (status, cost, context, session names) and vibeyard-ctl.\n' +
    `These features will not work until Python 3 is installed (looked for: ${getPythonBin()}).\n\n` +
    install
  );
}

export function validatePrerequisites(): { ok: boolean; message: string } {
  const home = os.homedir();

  const candidates = isWin
    ? [
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, 'scoop', 'shims', 'claude.cmd'),
        path.join(home, 'scoop', 'shims', 'claude.exe'),
        path.join(home, '.volta', 'bin', 'claude.exe'),
      ]
    : [
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.npm-global', 'bin', 'claude'),
      ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return { ok: true, message: '' };
    } catch {}
  }

  // Try `which`/`where` claude with augmented PATH
  try {
    const currentPath = process.env.PATH || '';
    const extraDirs = isWin
      ? [
          path.join(home, 'AppData', 'Roaming', 'npm'),
          path.join(home, '.local', 'bin'),
        ]
      : [
          '/usr/local/bin',
          '/opt/homebrew/bin',
          path.join(home, '.local', 'bin'),
          path.join(home, '.npm-global', 'bin'),
          '/usr/local/sbin',
          '/opt/homebrew/sbin',
        ];
    const pathSet = new Set(currentPath.split(pathSep));
    for (const dir of extraDirs) {
      pathSet.add(dir);
    }
    const augmentedPath = Array.from(pathSet).join(pathSep);

    const resolved = execSync(`${whichCmd} claude`, {
      env: { ...process.env, PATH: augmentedPath },
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (resolved) return { ok: true, message: '' };
  } catch {}

  return {
    ok: false,
    message:
      'Claude CLI not found.\n\n' +
      'Vibeyard requires the Claude Code CLI to be installed.\n\n' +
      'Install it with:\n' +
      '  npm install -g @anthropic-ai/claude-code\n\n' +
      'After installing, restart Vibeyard.',
  };
}

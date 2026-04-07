import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Check whether Python is available on Windows (needed for hook scripts).
 * Returns null if OK or not on Windows, or a warning message if missing.
 */
export function checkPythonAvailable(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    execSync('python --version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' });
    return null;
  } catch {
    return (
      'Python not found.\n\n' +
      'Vibeyard uses Python on Windows for session tracking (cost, status, events).\n' +
      'These features will not work until Python is installed and available on PATH.\n\n' +
      'Install Python from https://www.python.org/downloads/ or via:\n' +
      '  winget install Python.Python.3\n'
    );
  }
}

export function validatePrerequisites(): { ok: boolean; message: string } {
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const pathSep = isWin ? ';' : ':';

  const candidates = isWin
    ? [
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
        path.join(home, 'AppData', 'Roaming', 'npm', 'claude.exe'),
        path.join(home, '.local', 'bin', 'claude'),
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

    const cmd = isWin ? 'where claude' : 'which claude';
    const resolved = execSync(cmd, {
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

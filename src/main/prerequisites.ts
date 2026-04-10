import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync, execFileSync } from 'child_process';
import { isWin, pathSep, whichCmd, isWslMode } from './platform';
import { loadState } from './store';
import { getEffectiveDistro } from './wsl';

const WINDOWS_PYTHON_HELP =
  'Python not found.\n\n' +
  'Vibeyard uses Python on Windows for session tracking (cost, status, events).\n' +
  'These features will not work until Python is installed and available on PATH.\n\n' +
  'Install Python from https://www.python.org/downloads/ or via:\n' +
  '  winget install Python.Python.3\n';

const WSL_PYTHON_HELP =
  'Python 3 not found in WSL.\n\n' +
  'Vibeyard uses Python inside your WSL distro for session tracking (cost, status, events).\n\n' +
  'Install Python 3 in that distro, for example:\n' +
  '  sudo apt update && sudo apt install -y python3\n';

const WSL_DISTRO_HELP =
  'Could not determine the WSL distribution for Python.\n\n' +
  'Install a WSL distro or choose one in Preferences → WSL2 Integration.\n';

function checkWslPython(distro: string): string | null {
  const opts = { encoding: 'utf-8' as const, timeout: 5000, stdio: 'pipe' as const };
  for (const py of ['python3', '/usr/bin/python3']) {
    try {
      execFileSync('wsl.exe', ['-d', distro, '--', py, '--version'], opts);
      return null;
    } catch {
      // try next
    }
  }
  return WSL_PYTHON_HELP;
}

/**
 * Check whether Python is available for hook scripts.
 * On Windows without WSL mode: `python` on PATH.
 * On Windows with WSL mode: `python3` (or `/usr/bin/python3`) inside the chosen distro.
 * Returns null if OK or not on Windows, or a warning message if missing.
 */
export function checkPythonAvailable(): string | null {
  if (!isWin) return null;

  const state = loadState();
  if (isWslMode(state.preferences)) {
    const distro = getEffectiveDistro(state.preferences.wslDistro);
    if (!distro) return WSL_DISTRO_HELP;
    return checkWslPython(distro);
  }

  try {
    execSync('python --version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' });
    return null;
  } catch {
    return WINDOWS_PYTHON_HELP;
  }
}

export function validatePrerequisites(): { ok: boolean; message: string } {
  const home = os.homedir();

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

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { PersistedState } from '../shared/types';
import { isWin, isWslMode } from './platform';
import { getEffectiveDistro, normalizeProjectPathForWslStorage } from './wsl';

export type { SessionRecord, ProjectRecord, Preferences, PersistedState } from '../shared/types';

const STATE_DIR = path.join(os.homedir(), '.vibeyard');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function defaultState(): PersistedState {
  return {
    version: 1,
    projects: [],
    activeProjectId: null,
    preferences: { soundOnSessionWaiting: true, notificationsDesktop: true, debugMode: false, sessionHistoryEnabled: true, insightsEnabled: true, autoTitleEnabled: true },
  };
}

export function loadState(): PersistedState {
  for (const file of [STATE_FILE, STATE_FILE + '.tmp']) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.version !== 1) continue;
      migrateSessionIds(parsed);
      normalizeWslProjectPaths(parsed);
      if (file !== STATE_FILE) {
        console.warn('Recovered state from temp file');
      }
      return parsed;
    } catch {
      continue;
    }
  }
  console.warn('No valid state file found, using defaults');
  return defaultState();
}

/** When WSL mode is on, persist project paths as Linux paths (`/home/...`), not `\\wsl$\...`. */
export function normalizeWslProjectPaths(state: PersistedState): void {
  if (!isWin || !isWslMode(state.preferences)) return;
  const distro = getEffectiveDistro(state.preferences.wslDistro) ?? undefined;
  for (const p of state.projects) {
    p.path = normalizeProjectPathForWslStorage(p.path, distro);
    for (const s of p.sessions) {
      if (s.worktreePath) {
        s.worktreePath = normalizeProjectPathForWslStorage(s.worktreePath, distro);
      }
    }
  }
}

/** Migrate legacy claudeSessionId fields to cliSessionId */
function migrateSessionIds(state: PersistedState): void {
  for (const project of state.projects) {
    for (const session of project.sessions) {
      const s = session as unknown as Record<string, unknown>;
      if (s.claudeSessionId !== undefined && s.cliSessionId === undefined) {
        s.cliSessionId = s.claudeSessionId;
      }
      if (!s.providerId) {
        s.providerId = 'claude';
      }
    }
  }
}

export function saveState(state: PersistedState): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  lastState = state;
  saveTimer = setTimeout(() => {
    writeStateAtomically(state);
    saveTimer = null;
  }, 300);
}

let lastState: PersistedState | null = null;

export function flushState(): void {
  if (lastState) {
    saveStateSync(lastState);
  }
}

export function saveStateSync(state: PersistedState): void {
  writeStateAtomically(state);
}

function writeStateAtomically(state: PersistedState): void {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    const tmpFile = STATE_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

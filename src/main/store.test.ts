import { vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

import * as fs from 'fs';
import { loadState, saveState, flushState, saveStateSync } from './store';
import type { PersistedState } from './store';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

const DEFAULT_STATE: PersistedState = {
  version: 1,
  projects: [],
  activeProjectId: null,
  preferences: { soundOnSessionWaiting: true, notificationsDesktop: true, debugMode: false, sessionHistoryEnabled: true, insightsEnabled: true, autoTitleEnabled: true, dangerouslySkipPermissions: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadState', () => {
  it('returns default state when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadState()).toEqual(DEFAULT_STATE);
  });

  it('parses valid JSON', () => {
    const state: PersistedState = {
      version: 1,
      projects: [{ id: 'p1', name: 'Test', path: '/test', sessions: [], activeSessionId: null, layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' } }],
      activeProjectId: 'p1',
      preferences: { soundOnSessionWaiting: true },
    };
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(state));
    expect(loadState()).toEqual(state);
  });

  it('returns default state on invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not json');
    expect(loadState()).toEqual(DEFAULT_STATE);
  });

  it('returns default state on wrong version', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: 99 }));
    expect(loadState()).toEqual(DEFAULT_STATE);
  });
});

describe('saveState', () => {
  it('debounces writes by 300ms', () => {
    saveState(DEFAULT_STATE);
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(mockWriteFileSync).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('resets timer on rapid calls', () => {
    saveState(DEFAULT_STATE);
    vi.advanceTimersByTime(200);

    const updated = { ...DEFAULT_STATE, activeProjectId: 'p1' };
    saveState(updated);
    vi.advanceTimersByTime(300);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    expect(written.activeProjectId).toBe('p1');
  });

  it('creates directory if needed', () => {
    mockExistsSync.mockReturnValue(false);
    saveState(DEFAULT_STATE);
    vi.advanceTimersByTime(300);

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.vibeyard'),
      { recursive: true },
    );
  });
});

describe('saveStateSync', () => {
  it('writes immediately without debounce', () => {
    saveStateSync(DEFAULT_STATE);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });
});

describe('flushState', () => {
  it('writes pending state immediately', () => {
    saveState(DEFAULT_STATE);
    flushState();
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });
});

describe('migrateSessionIds', () => {
  function makeState(sessions: Record<string, unknown>[]): string {
    const state: PersistedState = {
      version: 1,
      projects: [{
        id: 'p1',
        name: 'Test',
        path: '/test',
        sessions: sessions as any,
        activeSessionId: null,
        layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
      }],
      activeProjectId: 'p1',
      preferences: { soundOnSessionWaiting: true, notificationsDesktop: true, debugMode: false, sessionHistoryEnabled: true, insightsEnabled: true, autoTitleEnabled: true, dangerouslySkipPermissions: false },
    };
    return JSON.stringify(state);
  }

  it('migrates claudeSessionId to cliSessionId', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeState([
      { id: 's1', name: 'S1', claudeSessionId: 'cs-123', createdAt: '2025-01-01' },
    ]));
    const loaded = loadState();
    const session = loaded.projects[0].sessions[0] as any;
    expect(session.cliSessionId).toBe('cs-123');
  });

  it('sets default providerId to claude', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeState([
      { id: 's1', name: 'S1', cliSessionId: null, createdAt: '2025-01-01' },
    ]));
    const loaded = loadState();
    const session = loaded.projects[0].sessions[0] as any;
    expect(session.providerId).toBe('claude');
  });

  it('preserves existing cliSessionId over claudeSessionId', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeState([
      { id: 's1', name: 'S1', claudeSessionId: 'old-id', cliSessionId: 'new-id', createdAt: '2025-01-01' },
    ]));
    const loaded = loadState();
    const session = loaded.projects[0].sessions[0] as any;
    expect(session.cliSessionId).toBe('new-id');
  });

  it('handles sessions with neither claudeSessionId nor cliSessionId', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(makeState([
      { id: 's1', name: 'S1', createdAt: '2025-01-01' },
    ]));
    const loaded = loadState();
    expect(loaded.projects[0].sessions[0]).toBeDefined();
  });
});

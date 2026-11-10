import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import type { PersistedState, Preferences } from '../shared/types';

const DEFAULT_DIR = path.join('/home/test', '.claude');
const PROFILE_DIR = path.join('/home/test', '.claude-work');
const OTHER_PROFILE_DIR = path.join('/home/test', '.claude-personal');
const FOREIGN = '/usr/local/bin/other-tool.sh';

const { mocks, ipc } = vi.hoisted(() => {
  const ipc = { handlers: [] as Array<(event: unknown, choice: string) => void> };
  return {
    ipc,
    mocks: {
      installHooksOnly: vi.fn(),
      installStatusLine: vi.fn(),
      readJsonSafe: vi.fn(),
      settingsByDir: new Map<string, Record<string, unknown>>(),
      state: { current: null as unknown as PersistedState },
    },
  };
});

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
  homedir: () => '/home/test',
}));

vi.mock('electron', () => ({
  BrowserWindow: {},
  ipcMain: {
    once: vi.fn((_channel: string, handler: (event: unknown, choice: string) => void) => {
      ipc.handlers.push(handler);
    }),
    removeListener: vi.fn(),
  },
}));

vi.mock('./claude-cli', async () => {
  const path = await import('path');
  return {
    HOOK_MARKER: '# vibeyard-hook',
    defaultClaudeDir: () => path.join('/home/test', '.claude'),
    installHooksOnly: mocks.installHooksOnly,
    installStatusLine: mocks.installStatusLine,
    getSupportedHookEvents: () => new Set<string>(),
  };
});

vi.mock('./hook-status', () => ({
  getStatusLineScriptPath: () => '/home/test/.vibeyard/run/statusline.sh',
}));

vi.mock('./fs-utils', () => ({
  readJsonSafe: (file: string) => mocks.settingsByDir.get(file) ?? null,
}));

vi.mock('./store', () => ({
  loadState: () => structuredClone(mocks.state.current),
  saveState: (state: PersistedState) => { mocks.state.current = structuredClone(state); },
}));

import { guardedInstall, getStatusLineConsent } from './settings-guard';

function setStatusLine(dir: string, command: string | null): void {
  const settings = command ? { statusLine: { type: 'command', command } } : {};
  mocks.settingsByDir.set(path.join(dir, 'settings.json'), settings);
}

function makeWindow() {
  return {
    isDestroyed: () => false,
    once: vi.fn(),
    removeListener: vi.fn(),
    webContents: { isLoading: () => false, once: vi.fn(), send: vi.fn() },
  };
}

type FakeWindow = ReturnType<typeof makeWindow>;

function install(win: FakeWindow | null, configDir?: string): Promise<void> {
  return guardedInstall(win as never, configDir);
}

function answer(choice: 'replace' | 'keep'): void {
  const handler = ipc.handlers.shift();
  if (!handler) throw new Error('no dialog is waiting for an answer');
  handler({}, choice);
}

function prefs(): Preferences {
  return mocks.state.current.preferences;
}

beforeEach(() => {
  vi.clearAllMocks();
  ipc.handlers.length = 0;
  mocks.settingsByDir.clear();
  mocks.state.current = { version: 1, projects: [], activeProjectId: null, preferences: {} as Preferences };
});

describe('guardedInstall in a profile config dir', () => {
  it('installs directly when the profile has no statusLine', async () => {
    setStatusLine(PROFILE_DIR, null);
    const win = makeWindow();

    await install(win, PROFILE_DIR);

    expect(mocks.installHooksOnly).toHaveBeenCalledWith(PROFILE_DIR);
    expect(mocks.installStatusLine).toHaveBeenCalledWith(PROFILE_DIR);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('asks before replacing a foreign statusLine and names the config dir', async () => {
    setStatusLine(PROFILE_DIR, FOREIGN);
    const win = makeWindow();

    const run = install(win, PROFILE_DIR);
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(1));

    expect(win.webContents.send).toHaveBeenCalledWith('settings:showConflictDialog', {
      foreignCommand: FOREIGN,
      configDir: path.resolve(PROFILE_DIR),
    });
    expect(mocks.installStatusLine).not.toHaveBeenCalled();

    answer('replace');
    await run;

    expect(mocks.installStatusLine).toHaveBeenCalledWith(PROFILE_DIR);
    expect(prefs().statusLineConsentByDir).toEqual({
      [path.resolve(PROFILE_DIR)]: { consent: 'granted', command: FOREIGN },
    });
  });

  it('keeps the foreign statusLine and stores the decision for that dir only', async () => {
    setStatusLine(PROFILE_DIR, FOREIGN);
    const win = makeWindow();

    const run = install(win, PROFILE_DIR);
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(1));
    answer('keep');
    await run;

    expect(mocks.installStatusLine).not.toHaveBeenCalled();
    expect(getStatusLineConsent(prefs(), PROFILE_DIR)).toEqual({ consent: 'declined', command: FOREIGN });
    expect(prefs().statusLineConsent).toBeUndefined();
    expect(prefs().statusLineConsentCommand).toBeUndefined();
  });

  it('respects an earlier decline for the same dir and command without asking', async () => {
    setStatusLine(PROFILE_DIR, FOREIGN);
    prefs().statusLineConsentByDir = { [path.resolve(PROFILE_DIR)]: { consent: 'declined', command: FOREIGN } };
    const win = makeWindow();

    await install(win, PROFILE_DIR);

    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(mocks.installStatusLine).not.toHaveBeenCalled();
  });

  it('does not apply the ~/.claude decision to a profile', async () => {
    setStatusLine(PROFILE_DIR, FOREIGN);
    prefs().statusLineConsent = 'declined';
    prefs().statusLineConsentCommand = FOREIGN;
    const win = makeWindow();

    const run = install(win, PROFILE_DIR);
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(1));
    answer('keep');
    await run;
  });

  it('leaves the foreign statusLine alone when there is no window to ask in', async () => {
    setStatusLine(PROFILE_DIR, FOREIGN);

    await install(null, PROFILE_DIR);

    expect(mocks.installHooksOnly).toHaveBeenCalledWith(PROFILE_DIR);
    expect(mocks.installStatusLine).not.toHaveBeenCalled();
    expect(prefs().statusLineConsentByDir).toBeUndefined();
  });
});

describe('guardedInstall in ~/.claude', () => {
  it('keeps storing the decision in the existing preference fields', async () => {
    setStatusLine(DEFAULT_DIR, FOREIGN);
    const win = makeWindow();

    const run = install(win);
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(1));
    expect(win.webContents.send).toHaveBeenCalledWith('settings:showConflictDialog', {
      foreignCommand: FOREIGN,
      configDir: undefined,
    });
    answer('keep');
    await run;

    expect(prefs().statusLineConsent).toBe('declined');
    expect(prefs().statusLineConsentCommand).toBe(FOREIGN);
    expect(prefs().statusLineConsentByDir).toBeUndefined();
  });

  it('treats a profile pointing at ~/.claude as the default dir', () => {
    prefs().statusLineConsent = 'granted';
    prefs().statusLineConsentCommand = FOREIGN;

    expect(getStatusLineConsent(prefs(), DEFAULT_DIR)).toEqual({ consent: 'granted', command: FOREIGN });
  });
});

describe('guardedInstall prompts', () => {
  it('asks once when several sessions of one profile spawn together', async () => {
    setStatusLine(PROFILE_DIR, FOREIGN);
    const win = makeWindow();

    const first = install(win, PROFILE_DIR);
    const second = install(win, PROFILE_DIR);
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(1));
    answer('replace');
    await Promise.all([first, second]);

    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(mocks.installStatusLine).toHaveBeenCalledTimes(1);
  });

  it('shows one dialog at a time and keeps both answers', async () => {
    setStatusLine(PROFILE_DIR, FOREIGN);
    setStatusLine(OTHER_PROFILE_DIR, FOREIGN);
    const win = makeWindow();

    const work = install(win, PROFILE_DIR);
    const personal = install(win, OTHER_PROFILE_DIR);
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(win.webContents.send).toHaveBeenCalledTimes(1);

    answer('keep');
    await vi.waitFor(() => expect(win.webContents.send).toHaveBeenCalledTimes(2));
    answer('replace');
    await Promise.all([work, personal]);

    expect(getStatusLineConsent(prefs(), PROFILE_DIR).consent).toBe('declined');
    expect(getStatusLineConsent(prefs(), OTHER_PROFILE_DIR).consent).toBe('granted');
  });
});

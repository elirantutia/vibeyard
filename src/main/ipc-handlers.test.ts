import { EventEmitter } from 'events';
import { searchSessions } from './session-deep-search';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CliProvider } from './providers/provider';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Focused on the `pty:create` lifecycle: which provider hook fires for a
 * fresh vs a resumed spawn, and the ORDER of the teardown calls in the PTY
 * exit callback / spawn-failure catch. pty-manager now suppresses a replaced
 * process's callback before it reaches this handler.
 *
 * `calls` records lifecycle events in the order they happen, so the
 * assertions are about sequence rather than membership.
 */

type ExitCallback = (exitCode: number, signal?: number, pid?: number) => void;

const calls = vi.hoisted(() => [] as string[]);
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const knownPaths = vi.hoisted(() => [] as string[]);
const fakeWin = vi.hoisted(() => ({
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
}));

const mockSpawnPty = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<void> => {}));
const mockRegisterSync = vi.hoisted(() => vi.fn());
const mockUnregisterSync = vi.hoisted(() => vi.fn(() => { calls.push('unregister'); }));
const mockGetProvider = vi.hoisted(() => vi.fn());
const mockGetSyncedPath = vi.hoisted(() => vi.fn(() => null));
const mockRegisterSession = vi.hoisted(() => vi.fn());

// Modules the handler-under-test imports but this suite never exercises: a
// Proxy of vi.fn()s keeps the module loadable without hand-listing exports.
const autoStub = vi.hoisted(() => () =>
  new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, key) => {
      if (key === '__esModule') return true;
      // Never stub `then`. A stubbed `then` makes the whole namespace a
      // thenable, so anything that awaits the import (vitest's own interop
      // included) resolves to a mock fn instead of the module.
      if (key === 'then' || key === 'catch' || key === 'finally') return undefined;
      if (typeof key === 'symbol') return target[key];
      if (!(key in target)) target[key] = vi.fn();
      return target[key];
    },
  })
);

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...a: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (...a: unknown[]) => unknown) => handlers.set(channel, fn),
    once: vi.fn(),
    removeListener: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [fakeWin],
    fromWebContents: () => fakeWin,
  },
  app: {
    getPath: () => '/mock/app',
    getName: () => 'vibeyard',
    getVersion: () => 'test',
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
    quit: vi.fn(),
  },
  dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) },
  shell: { openExternal: () => Promise.resolve() },
  clipboard: { writeText: vi.fn(), readText: () => '' },
}));

vi.mock('./pty-manager', () => ({
  spawnPty: mockSpawnPty,
  spawnShellPty: vi.fn(),
  writePty: vi.fn(),
  resizePty: vi.fn(),
  killPty: vi.fn(),
  getPtyCwd: vi.fn(),
  getFullPath: vi.fn(() => '/usr/bin'),
}));

vi.mock('./session-transcript-sync', () => ({
  registerTranscriptSync: mockRegisterSync,
  unregisterTranscriptSync: mockUnregisterSync,
  getSyncedTranscriptPath: mockGetSyncedPath,
}));

vi.mock('./providers/registry', () => ({
  getProvider: mockGetProvider,
  getProviderMeta: vi.fn(),
  getAllProviderMetas: vi.fn(),
  getAllProviders: vi.fn(),
}));

vi.mock('./store', () => ({
  loadState: vi.fn(() => ({ projects: [], preferences: {} })),
  saveState: vi.fn(),
  getKnownProjectPaths: () => knownPaths,
}));

vi.mock('./hook-status', () => ({
  startWatching: vi.fn(),
  cleanupSessionStatus: vi.fn(),
  resyncAllSessions: vi.fn(),
  registerSession: mockRegisterSession,
}));

vi.mock('./claude-cli', autoStub);
vi.mock('./providers/resume-handoff', autoStub);
vi.mock('./session-deep-search', autoStub);
vi.mock('./git-status', autoStub);
vi.mock('./git-watcher', autoStub);
vi.mock('./file-watcher', autoStub);
vi.mock('./mcp-ipc-handlers', autoStub);
vi.mock('./auto-updater', autoStub);
vi.mock('./menu', autoStub);
vi.mock('./readiness/analyzer', autoStub);
vi.mock('./github-cli', autoStub);
vi.mock('./fs-utils', () => ({
  expandUserPath: (p: string) => p,
  isBinaryBuffer: () => false,
  isMacPackagePath: () => false,
  BINARY_SNIFF_BYTES: 8000,
}));
vi.mock('./platform', autoStub);
vi.mock('./chrome-import/importer', autoStub);
vi.mock('./settings-guard', autoStub);
vi.mock('./vibeyardignore', autoStub);
vi.mock('./close-state', autoStub);
vi.mock('./profiles', autoStub);
vi.mock('./claude-keychain', autoStub);
vi.mock('../shared/token-estimate', autoStub);

import { registerIpcHandlers } from './ipc-handlers';
import { cleanupSessionStatus } from './hook-status';

function makeProvider(): CliProvider {
  return {
    // hookStatus off keeps the post-spawn settings-warning block out of the way.
    meta: { capabilities: { hookStatus: false } },
    onSessionStarted: vi.fn(() => { calls.push('started'); }),
    onSessionResumed: vi.fn(() => { calls.push('resumed'); }),
    onSessionExited: vi.fn(() => { calls.push('exited'); }),
    validateSettings: vi.fn(() => ({ statusLine: 'ok', hooks: 'complete' })),
    reinstallSettings: vi.fn(),
  } as unknown as CliProvider;
}

let provider: CliProvider;

/** Invoke the captured `pty:create` handler with the real positional shape. */
async function create(
  sessionId: string,
  cliSessionId: string | null,
  opts: { isResume?: boolean; providerId?: string; configDir?: string } = {}
): Promise<void> {
  const handler = handlers.get('pty:create');
  if (!handler) throw new Error('pty:create was not registered');
  await handler(
    {},
    sessionId,
    '/proj',
    cliSessionId,
    opts.isResume ?? false,
    '',
    opts.providerId ?? 'pi',
    undefined,
    undefined,
    '',
    opts.configDir
  );
}

/** The exit callback spawnPty was handed (positional arg 10). */
function exitCallback(): ExitCallback {
  return mockSpawnPty.mock.calls[0][10] as ExitCallback;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  handlers.clear();
  knownPaths.length = 0;
  provider = makeProvider();
  mockGetProvider.mockReturnValue(provider);
  registerIpcHandlers();
});

describe('project file read boundary', () => {
  it('rejects a link inside a project whose target is outside it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeyard-ipc-test-'));
    try {
      const project = path.join(root, 'project');
      const outside = path.join(root, 'outside');
      fs.mkdirSync(project);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'private');
      fs.symlinkSync(outside, path.join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      knownPaths.push(project);
      const read = handlers.get('fs:readFile')!;
      expect(read({}, path.join(project, 'linked', 'secret.txt'))).toEqual({ ok: false, reason: 'error' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a text file larger than the bounded reader limit', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeyard-ipc-test-'));
    try {
      const large = path.join(root, 'large.txt');
      const fd = fs.openSync(large, 'w');
      try { fs.ftruncateSync(fd, 8 * 1024 * 1024 + 1); } finally { fs.closeSync(fd); }
      knownPaths.push(root);
      const read = handlers.get('fs:readFile')!;
      expect(read({}, large)).toEqual({ ok: false, reason: 'error' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('pty:create provider hooks', () => {
  it('a fresh session registers for cli-session-id discovery', async () => {
    await create('ui-1', null);
    expect(calls).toEqual(['started']);
    expect(mockRegisterSync).not.toHaveBeenCalled();
  });

  it('a resumed session mirrors the transcript AND re-attaches the provider watcher', async () => {
    await create('ui-1', 'cli-1', { isResume: true, providerId: 'pi', configDir: '/profiles/work' });
    // Without onSessionResumed a resumed session never joins the Pi/OMP
    // sessions-tree watcher, so a later /clear is never re-adopted.
    expect(mockRegisterSync).toHaveBeenCalledWith('ui-1', 'pi', 'cli-1', '/proj', '/profiles/work', { sessionDir: expect.stringContaining('pi-sessions') });
    expect(provider.onSessionResumed).toHaveBeenCalledWith('ui-1', '/proj', fakeWin, '/profiles/work', 'cli-1');
    expect(calls).toEqual(['resumed']);
    expect(provider.onSessionStarted).not.toHaveBeenCalled();
  });

  it('a provider with no resume hook still spawns', async () => {
    delete provider.onSessionResumed;
    await create('ui-1', 'cli-1', { isResume: true });
    expect(mockRegisterSync).toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('session:syncRestored', () => {
  const syncRestored = (sessions: unknown[]) =>
    handlers.get('session:syncRestored')!({}, sessions);

  it('mirrors a known-id session title-only and registers it for forwarding', () => {
    mockRegisterSync.mockReturnValue(true);
    syncRestored([
      { sessionId: 'ui-1', providerId: 'omp', cliSessionId: 'cli-1', cwd: '/proj', createdAt: '2026-09-30T10:00:00.000Z' },
    ]);
    expect(mockRegisterSync).toHaveBeenCalledWith('ui-1', 'omp', 'cli-1', '/proj', undefined, { titleOnly: true, sessionDir: expect.stringContaining('omp-sessions') });
    expect(mockRegisterSession).toHaveBeenCalledWith('ui-1');
  });

  it('leaves a null-id session unresolved: no title mirror, no recovery', () => {
    mockRegisterSync.mockReturnValue(true);
    // A session whose cliSessionId was never persisted is left unresolved:
    // no title mirror, no recovery, no registration.
    syncRestored([
      { sessionId: 'ui-2', providerId: 'omp', cliSessionId: null, cwd: '/proj', createdAt: '2026-09-30T10:23:20.000Z' },
    ]);
    expect(mockRegisterSync).not.toHaveBeenCalled();
    expect(mockRegisterSession).not.toHaveBeenCalled();
  });

  it('skips a malformed record without aborting the valid one after it', () => {
    mockRegisterSync.mockReturnValue(true);
    syncRestored([
      { sessionId: 'bad', providerId: 'omp' }, // missing cliSessionId, cwd, createdAt
      { sessionId: 'ui-1', providerId: 'omp', cliSessionId: 'cli-1', cwd: '/proj', createdAt: '2026-09-30T10:00:00.000Z' },
    ]);
    expect(mockRegisterSync).toHaveBeenCalledTimes(1);
    expect(mockRegisterSync).toHaveBeenCalledWith('ui-1', 'omp', 'cli-1', '/proj', undefined, { titleOnly: true, sessionDir: expect.stringContaining('omp-sessions') });
  });

  it('skips a record with a non-finite creation timestamp', () => {
    mockRegisterSync.mockReturnValue(true);
    syncRestored([
      { sessionId: 'ui-1', providerId: 'omp', cliSessionId: 'cli-1', cwd: '/proj', createdAt: 'not-a-date' },
    ]);
    expect(mockRegisterSync).not.toHaveBeenCalled();
  });

  it('skips an unknown provider id without aborting the batch', () => {
    // The real registerTranscriptSync calls getProvider, which throws for an
    // unknown id; mirror that so the handler's per-record guard is exercised.
    mockRegisterSync.mockImplementation((...args) => {
      if (args[1] === 'bogus') throw new Error('Unknown CLI provider: bogus');
      return true;
    });
    syncRestored([
      { sessionId: 'ui-x', providerId: 'bogus', cliSessionId: 'cli-x', cwd: '/proj', createdAt: '2026-09-30T10:00:00.000Z' },
      { sessionId: 'ui-1', providerId: 'omp', cliSessionId: 'cli-1', cwd: '/proj', createdAt: '2026-09-30T10:00:00.000Z' },
    ]);
    // The valid record is still processed; the bogus one is dropped (no registration).
    expect(mockRegisterSync).toHaveBeenCalledWith('ui-1', 'omp', 'cli-1', '/proj', undefined, { titleOnly: true, sessionDir: expect.stringContaining('omp-sessions') });
    expect(mockRegisterSession).toHaveBeenCalledTimes(1);
    expect(mockRegisterSession).toHaveBeenCalledWith('ui-1');
  });

  it('registers the same copied CLI id in two profiles independently', () => {
    mockRegisterSync.mockReturnValue(true);
    syncRestored([
      { sessionId: 'ui-a', providerId: 'omp', cliSessionId: 'cli-1', cwd: '/proj', createdAt: '2026-09-30T10:00:00.000Z', configDir: '/profiles/a' },
      { sessionId: 'ui-b', providerId: 'omp', cliSessionId: 'cli-1', cwd: '/proj', createdAt: '2026-09-30T10:00:00.000Z', configDir: '/profiles/b' },
    ]);
    expect(mockRegisterSync).toHaveBeenCalledTimes(2);
    expect(mockRegisterSync).toHaveBeenCalledWith('ui-a', 'omp', 'cli-1', '/proj', '/profiles/a', { titleOnly: true, sessionDir: expect.stringContaining('omp-sessions') });
    expect(mockRegisterSync).toHaveBeenCalledWith('ui-b', 'omp', 'cli-1', '/proj', '/profiles/b', { titleOnly: true, sessionDir: expect.stringContaining('omp-sessions') });
  });

  it('skips registerSession when the provider polls neither title nor status', () => {
    mockRegisterSync.mockReturnValue(false);
    syncRestored([
      { sessionId: 'ui-3', providerId: 'omp', cliSessionId: 'cli-3', cwd: '/proj', createdAt: '2026-09-30T10:00:00.000Z' },
    ]);
    expect(mockRegisterSession).not.toHaveBeenCalled();
  });
});

describe('session:release', () => {
  it('unregisters the sync and cleans the status files', () => {
    const release = handlers.get('session:release')!;
    release({}, 'ui-1');
    expect(mockUnregisterSync).toHaveBeenCalledWith('ui-1');
    expect(cleanupSessionStatus).toHaveBeenCalledWith('ui-1');
  });
});

describe('pty exit teardown ordering', () => {
  it('unregisters the sync on a real exit', async () => {
    await create('ui-1', 'cli-1', { isResume: true });
    // The resumed spawn above legitimately pushed 'resumed' during setup;
    // this test is about the exit callback's ordering only.
    calls.length = 0;
    exitCallback()(0);
    expect(calls).toEqual(['unregister', 'exited']);
  });
});

describe('pty:exit crash reason', () => {
  it('sends the transcript reason on a non-zero exit when the sync resolved a path', async () => {
    provider.readSessionExitReason = vi.fn(() => ({ reason: 'unhandled_rejection', kind: 'fatal' }));
    mockGetSyncedPath.mockReturnValue('/sessions/dir-a/2026.jsonl');
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(1);
    expect(provider.readSessionExitReason).toHaveBeenCalledWith('/sessions/dir-a/2026.jsonl');
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('pty:exit', 'ui-1', 1, undefined, 'unhandled_rejection', undefined);
  });

  it('falls back to the exit code when no transcript path is resolved', async () => {
    provider.readSessionExitReason = vi.fn(() => ({ reason: 'dispose', kind: 'normal' }));
    mockGetSyncedPath.mockReturnValue(null);
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(2);
    expect(provider.readSessionExitReason).not.toHaveBeenCalled();
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('pty:exit', 'ui-1', 2, undefined, 'exited with code 2', undefined);
  });

  it('falls back to the exit code when the provider has no reason reader', async () => {
    mockGetSyncedPath.mockReturnValue('/sessions/dir-a/2026.jsonl');
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(1);
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('pty:exit', 'ui-1', 1, undefined, 'exited with code 1', undefined);
  });

  it('falls back to the exit code when the reason read throws', async () => {
    provider.readSessionExitReason = vi.fn(() => { throw new Error('read failed'); });
    mockGetSyncedPath.mockReturnValue('/sessions/dir-a/2026.jsonl');
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(3);
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('pty:exit', 'ui-1', 3, undefined, 'exited with code 3', undefined);
  });

  it('sends no exit reason on a clean exit', async () => {
    provider.readSessionExitReason = vi.fn(() => ({ reason: 'dispose', kind: 'normal' }));
    mockGetSyncedPath.mockReturnValue('/sessions/dir-a/2026.jsonl');
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(0);
    expect(provider.readSessionExitReason).toHaveBeenCalled();
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('pty:exit', 'ui-1', 0, undefined, undefined, undefined);
  });

  it('reports a fatal transcript reason even when the PTY exit code is zero', async () => {
    provider.readSessionExitReason = vi.fn(() => ({ reason: 'unhandled_rejection', kind: 'fatal' }));
    mockGetSyncedPath.mockReturnValue('/sessions/dir-a/2026.jsonl');
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(0, undefined, 2028);
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('pty:exit', 'ui-1', 0, undefined, 'unhandled_rejection', 2028);
  });

  it('keeps a signal exit distinct from a fatal rejection', async () => {
    provider.readSessionExitReason = vi.fn(() => ({ reason: 'sighup', kind: 'signal' }));
    mockGetSyncedPath.mockReturnValue('/sessions/dir-a/2026.jsonl');
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(0, 1, 2028);
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('pty:exit', 'ui-1', 0, 1, 'sighup', 2028);
  });

  it('does not reuse a fatal marker from before this launch', async () => {
    provider.readSessionExitReason = vi.fn(() => ({ reason: 'unhandled_rejection', kind: 'fatal', timestamp: '2020-01-01T00:00:00.000Z' }));
    mockGetSyncedPath.mockReturnValue('/sessions/dir-a/2026.jsonl');
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(0);
    expect(fakeWin.webContents.send).toHaveBeenCalledWith('pty:exit', 'ui-1', 0, undefined, undefined, undefined);
  });

  it('uses the provider lookup if the watcher has not resolved the transcript yet', async () => {
    mockGetSyncedPath.mockReturnValue(null);
    provider.getTranscriptPath = vi.fn(() => '/sessions/dir-a/2026.jsonl');
    provider.readSessionExitReason = vi.fn(() => ({ reason: 'unhandled_rejection', kind: 'fatal' }));
    await create('ui-1', 'cli-1', { isResume: true });
    exitCallback()(1);
    expect(provider.getTranscriptPath).toHaveBeenCalled();
    expect(provider.readSessionExitReason).toHaveBeenCalledWith('/sessions/dir-a/2026.jsonl');
  });
});

describe('failed spawn teardown', () => {
  it('unregisters the sync registered before spawnPty', async () => {
    mockSpawnPty.mockRejectedValueOnce(new Error('spawn failed'));
    await expect(create('ui-1', 'cli-1', { isResume: true })).rejects.toThrow('spawn failed');
    // The exit callback was never installed, so nothing else would clean this up.
    expect(mockUnregisterSync).toHaveBeenCalledWith('ui-1');
    expect(provider.onSessionExited).toHaveBeenCalledWith('ui-1');
  });

  it('still unwinds a fresh session whose spawn failed', async () => {
    mockSpawnPty.mockRejectedValueOnce(new Error('spawn failed'));
    await expect(create('ui-1', null)).rejects.toThrow('spawn failed');
    expect(provider.onSessionExited).toHaveBeenCalledWith('ui-1');
    expect(mockUnregisterSync).toHaveBeenCalledWith('ui-1');
  });
});


it('cancels superseded IPC searches, palette cancellation and window destruction', async () => {
  const sender = new EventEmitter();
  const signals: AbortSignal[] = [];
  const complete: Array<() => void> = [];
  vi.mocked(searchSessions).mockImplementation((_query, signal) => {
    signals.push(signal!);
    return new Promise(resolve => complete.push(() => resolve([])));
  });
  const handler = handlers.get('session:deepSearch')!;
  const first = handler({sender}, 'first');
  const second = handler({sender}, 'second');
  expect(signals[0].aborted).toBe(true);
  expect(signals[1].aborted).toBe(false);
  handlers.get('session:cancelDeepSearch')!({sender});
  expect(signals[1].aborted).toBe(true);
  const third = handler({sender}, 'third');
  sender.emit('destroyed');
  expect(signals[2].aborted).toBe(true);
  complete.forEach(resolve => resolve());
  await Promise.all([first, second, third]);
  expect(sender.listenerCount('destroyed')).toBe(0);
});

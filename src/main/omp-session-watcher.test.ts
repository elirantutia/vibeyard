import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  readdirSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  watch: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
  tmpdir: () => '/tmp',
}));

const electronMock = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => electronMock.windows },
}));

const { STATUS_DIR: MOCK_STATUS_DIR } = vi.hoisted(() => {
  const path = require('path');
  return { STATUS_DIR: path.join('/tmp', 'vibeyard') };
});

const mockRegisterTranscriptSync = vi.hoisted(() => vi.fn());

vi.mock('./hook-status', () => ({
  STATUS_DIR: MOCK_STATUS_DIR,
  writeCliSessionId: vi.fn(),
}));
vi.mock('./session-transcript-sync', () => ({
  registerTranscriptSync: mockRegisterTranscriptSync,
}));

import * as path from 'path';

import * as fs from 'fs';
import { writeCliSessionId } from './hook-status';
import {
  registerPendingOmpSession,
  unregisterOmpSession,
  startOmpSessionWatcher,
  stopOmpSessionWatcher,
} from './omp-session-watcher';

const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockReadSync = vi.mocked(fs.readSync);
const mockCloseSync = vi.mocked(fs.closeSync);
const mockWriteCliSessionId = vi.mocked(writeCliSessionId);
const mockWatch = vi.mocked(fs.watch);

const SESSIONS_ROOT = path.join('/mock/home', '.omp', 'agent', 'sessions');

/**
 * Mock the sessions tree: readdirSync(sessionsRoot) returns the dir names,
 * readdirSync(sessionsRoot/<dir>) returns that dir's files. Anything else
 * throws ENOENT, as a real missing path would.
 */
function mockSessionsTree(sessionsRoot: string, filesByDir: Record<string, string[]>): void {
  mockReaddirSync.mockImplementation((p: string) => {
    if (p === sessionsRoot) return Object.keys(filesByDir);
    for (const [dir, files] of Object.entries(filesByDir)) {
      if (p === path.join(sessionsRoot, dir)) return files;
    }
    throw new Error('ENOENT');
  });
}

/** Make openSync/readSync/closeSync serve `firstLine` for any file read. */
function mockFirstLine(firstLine: string | null): void {
  mockOpenSync.mockReturnValue(42);
  mockReadSync.mockImplementation((_fd, target: Buffer) => {
    if (firstLine === null) return 0;
    const buf = Buffer.from(firstLine);
    buf.copy(target);
    return buf.length;
  });
  mockCloseSync.mockReturnValue(true);
}

/**
 * Serve a DIFFERENT header line per file (keyed by basename), so a scan that
 * reads several transcripts at once sees each one's real id. Needed for the
 * /clear test where two files with different ids coexist.
 */
function mockFilesByHeader(lineByBasename: Record<string, string>): void {
  let fdCounter = 100;
  const fdToLine = new Map<number, string>();
  mockOpenSync.mockImplementation((p: string) => {
    const line = lineByBasename[path.basename(p)];
    if (line === undefined) return -1;
    const fd = fdCounter++;
    fdToLine.set(fd, line);
    return fd;
  });
  mockReadSync.mockImplementation((fd: number, target: Buffer) => {
    const line = fdToLine.get(fd);
    if (line === undefined) return 0;
    const buf = Buffer.from(line);
    buf.copy(target);
    return buf.length;
  });
  mockCloseSync.mockReturnValue(true);
}

function header(piId: string, cwd: string): string {
  return JSON.stringify({ type: 'session', version: 3, id: piId, timestamp: 't', cwd });
}

/** `<ISO timestamp>_<id>.jsonl` stamped `ageMs` before the (fake) current time. */
function transcript(ageMs: number, id: string): string {
  const d = new Date(Date.now() - ageMs);
  const p = (n: number) => String(n).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}-${ms}Z_${id}.jsonl`;
}

function startWatcher(): void {
  const mockWatcher = { close: vi.fn() };
  mockWatch.mockReturnValue(mockWatcher as any);
  startOmpSessionWatcher();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  stopOmpSessionWatcher();
  // A live main window is available for the per-tick window lookup
  electronMock.windows = [{ isDestroyed: () => false }];
});

afterEach(() => {
  stopOmpSessionWatcher();
  vi.useRealTimers();
});

describe('registerPendingOmpSession', () => {
  it('snapshots the existing files of the default sessions root', () => {
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['old.jsonl'] });

    registerPendingOmpSession('ui-1', '/proj');

    expect(mockReaddirSync).toHaveBeenCalledWith(SESSIONS_ROOT);
    expect(mockReaddirSync).toHaveBeenCalledWith(path.join(SESSIONS_ROOT, 'dir-a'));
  });

  it('snapshots the profile sessions root when a configDir is given', () => {
    const profileRoot = path.join('/profiles/work', 'sessions');
    mockSessionsTree(profileRoot, { 'dir-a': [] });

    registerPendingOmpSession('ui-1', '/proj', '/profiles/work');

    expect(mockReaddirSync).toHaveBeenCalledWith(profileRoot);
  });

  it('handles a missing sessions root gracefully', () => {
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => registerPendingOmpSession('ui-1', '/proj')).not.toThrow();
  });
});

describe('startOmpSessionWatcher', () => {
  it('starts fs.watch on the default sessions root', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    startOmpSessionWatcher();

    expect(mockWatch).toHaveBeenCalledWith(SESSIONS_ROOT, expect.any(Function));
  });

  it('also watches existing per-cwd subdirs (fs.watch is non-recursive off-macOS)', () => {
    mockReaddirSync.mockImplementation((p: string) => {
      if (p === SESSIONS_ROOT) return ['--C--Users-me--'];
      throw new Error('ENOENT');
    });
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    startOmpSessionWatcher();

    expect(mockWatch).toHaveBeenCalledWith(SESSIONS_ROOT, expect.any(Function));
    expect(mockWatch).toHaveBeenCalledWith(path.join(SESSIONS_ROOT, '--C--Users-me--'), expect.any(Function));
  });

  it('does not start a second watcher if already started', () => {
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    startOmpSessionWatcher();
    startOmpSessionWatcher();

    expect(mockWatch).toHaveBeenCalledTimes(1);
  });

  it('falls back to polling when fs.watch fails (dir missing)', () => {
    mockWatch.mockImplementation(() => { throw new Error('ENOENT'); });

    expect(() => startOmpSessionWatcher()).not.toThrow();

    // Polling still works: a new transcript is discovered on the 2s tick
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-1', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-1', 'pi-1');
  });
});

describe('session ID assignment', () => {
  it('assigns the pi session ID to a pending session on poll', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-session-1', '/proj');
    // The transcript appears after registration
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-abc-123', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-session-1', 'pi-abc-123');
    expect(mockCloseSync).toHaveBeenCalledWith(42);
  });

  it('assigns on a coalesced fs.watch event without waiting for the poll', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-watch', '/proj'));

    const watchCallback = mockWatch.mock.calls[0][1] as (...args: unknown[]) => void;
    watchCallback();
    // The event path is debounced, not synchronous; it still lands well
    // before the 2s polling fallback.
    vi.advanceTimersByTime(250);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-1', 'pi-watch');
  });

  it('does not scan when there are no pending sessions', () => {
    mockReaddirSync.mockReturnValue([] as any); // empty sessions root at start
    startWatcher();

    const watchCallback = mockWatch.mock.calls[0][1] as (...args: unknown[]) => void;
    watchCallback();
    vi.advanceTimersByTime(2000);

    // Only the one-time subdir enumeration at start — no scan on watch event or tick
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
    expect(mockReaddirSync).toHaveBeenNthCalledWith(1, SESSIONS_ROOT);
    expect(mockOpenSync).not.toHaveBeenCalled();
  });

  it('pairs simultaneous same-project sessions in filename (timestamp) order, not readdir order', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-first', '/proj');
    registerPendingOmpSession('ui-second', '/proj');

    // Both transcripts appear; readdir lists the NEWER one first.
    // Timestamps are relative to "now" so they fall inside the adoption
    // window (external runs stamped older than registration are skipped).
    const stamp = (ageSec: number) => {
      const d = new Date(Date.now() - ageSec * 1000);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}-${p(d.getUTCMilliseconds())}Z`;
    };
    const older = `${stamp(3)}_pi-older.jsonl`;
    const newer = `${stamp(0)}_pi-newer.jsonl`;
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [newer, older] });

    let currentFile = '';
    mockOpenSync.mockImplementation((p: string) => { currentFile = p; return 42; });
    mockReadSync.mockImplementation((_fd: number, target: Buffer) => {
      const line = currentFile.includes('pi-older') ? header('pi-older', '/proj') : header('pi-newer', '/proj');
      const buf = Buffer.from(line);
      buf.copy(target);
      return buf.length;
    });
    mockCloseSync.mockReturnValue(true);

    vi.advanceTimersByTime(2000);

    // Oldest pending session gets the oldest transcript, not the first in readdir order
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-first', 'pi-older');
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-second', 'pi-newer');
  });

  it('does not scan when no window is available', () => {
    // The poll looks the window up per tick and skips the scan without one.
    electronMock.windows = [];
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    startOmpSessionWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-1', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockOpenSync).not.toHaveBeenCalled();
    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });

  it('skips files that already existed at registration (knownFiles)', () => {
    startWatcher();

    // old.jsonl exists when the session registers — it must never be assigned
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['old.jsonl'] });
    mockFirstLine(header('pi-old', '/proj'));
    registerPendingOmpSession('ui-1', '/proj');

    // Only the pre-existing file is present — nothing new to assign
    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).not.toHaveBeenCalled();

    // A genuinely new file appears — it is the only candidate
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['old.jsonl', 'new.jsonl'] });
    mockFirstLine(header('pi-new', '/proj'));
    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-1', 'pi-new');
  });

  it('skips headers whose cwd does not match the pending project', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-other': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-other': ['new.jsonl'] });
    mockFirstLine(header('pi-other', '/other-project'));

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });

  it('skips non-session and malformed first lines', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['a.jsonl', 'b.jsonl'] });

    mockFirstLine(JSON.stringify({ type: 'message', id: 'pi-x', cwd: '/proj' }));
    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).not.toHaveBeenCalled();

    mockFirstLine('{not valid json');
    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });

  it('skips unreadable files without throwing', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['gone.jsonl'] });
    mockOpenSync.mockImplementation(() => { throw new Error('ENOENT'); });

    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });

  it('does not assign the same pi session ID twice', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-dup', '/proj'));

    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).toHaveBeenCalledTimes(1);

    // A second pending session for the same project: the only file is
    // already assigned, so nothing new can be handed out
    registerPendingOmpSession('ui-2', '/proj');
    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).toHaveBeenCalledTimes(1);
  });

  it('assigns the first matching file to the oldest pending session', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-older', '/proj');
    vi.advanceTimersByTime(100);
    registerPendingOmpSession('ui-newer', '/proj');
    // The transcript appears after both registrations
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-first', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).toHaveBeenCalledTimes(1);
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-older', 'pi-first');
  });

  it('scans the profile sessions root for profiled sessions', () => {
    startWatcher();

    const profileRoot = path.join('/profiles/work', 'sessions');
    mockSessionsTree(profileRoot, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj', '/profiles/work');
    mockSessionsTree(profileRoot, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-profile', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-1', 'pi-profile');
  });
});

describe('unregisterOmpSession', () => {
  it('removes a pending session so it is no longer assignable', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-gone', '/proj');
    unregisterOmpSession('ui-gone');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-orphan', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });

  it('is a no-op for unknown session ids', () => {
    expect(() => unregisterOmpSession('never-registered')).not.toThrow();
  });
});

describe('stopOmpSessionWatcher', () => {
  it('closes the watcher and clears pending state', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    startOmpSessionWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');

    stopOmpSessionWatcher();

    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('stops the polling fallback after stopping', () => {
    startWatcher();
    stopOmpSessionWatcher();

    // A late registration must not be picked up — the interval is gone
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-late', '/proj'));
    registerPendingOmpSession('ui-late', '/proj');

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });
});

/** Transcript head with OMP's title line prepended to the session header. */
function titleHead(title: string, piId: string, cwd: string): string {
  return [
    JSON.stringify({ type: 'title', v: 1, title, source: 'auto', updatedAt: 't' }),
    header(piId, cwd),
  ].join('\n');
}

describe('title sync wiring', () => {
  it('hands the adopted session to the transcript sync', () => {
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(titleHead('Fix the flaky test', 'pi-title-1', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-1', 'pi-title-1');
    expect(mockRegisterTranscriptSync).toHaveBeenCalledWith('ui-1', 'omp', 'pi-title-1', '/proj', undefined);
  });

  it('passes the profile configDir through to the transcript sync', () => {
    startWatcher();

    const profileRoot = path.join('/profiles/work', 'sessions');
    mockSessionsTree(profileRoot, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj', '/profiles/work');
    mockSessionsTree(profileRoot, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(titleHead('Profile title', 'pi-prof', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockRegisterTranscriptSync).toHaveBeenCalledWith('ui-1', 'omp', 'pi-prof', '/proj', '/profiles/work');
  });

  it('still adopts when the transcript sync callback throws', () => {
    mockRegisterTranscriptSync.mockImplementation(() => { throw new Error('boom'); });
    startWatcher();

    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': ['new.jsonl'] });
    mockFirstLine(header('pi-throw', '/proj'));

    vi.advanceTimersByTime(2000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-1', 'pi-throw');
  });
});

describe('/clear re-adoption', () => {
  it('re-adopts a newer transcript in the same cwd and re-fires the sync', () => {
    startWatcher();
    const t1 = 'new.jsonl'; // null fileTs → passes the fresh-adoption tolerance
    const t2 = transcript(2_000, 'cli-2');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-1', '/proj');

    // First transcript appears → adopt cli-1.
    mockFilesByHeader({ [t1]: header('cli-1', '/proj') });
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [t1] });
    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).toHaveBeenLastCalledWith('ui-1', 'cli-1');
    expect(mockRegisterTranscriptSync).toHaveBeenLastCalledWith('ui-1', 'omp', 'cli-1', '/proj', undefined);

    // /clear → a NEWER transcript with a new id in the same cwd.
    mockFilesByHeader({ [t1]: header('cli-1', '/proj'), [t2]: header('cli-2', '/proj') });
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [t1, t2] });
    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).toHaveBeenLastCalledWith('ui-1', 'cli-2');
    expect(mockRegisterTranscriptSync).toHaveBeenLastCalledWith('ui-1', 'omp', 'cli-2', '/proj', undefined);
  });

  it('does NOT re-adopt when two adopted sessions share the cwd (ambiguous)', () => {
    startWatcher();
    const a1 = 'a.jsonl';
    const b1 = 'b.jsonl';
    const clear = transcript(2_000, 'clear');
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [] });
    registerPendingOmpSession('ui-A', '/proj');
    registerPendingOmpSession('ui-B', '/proj');

    // Both adopt their first transcripts (paired by filename order).
    mockFilesByHeader({ [a1]: header('id-a', '/proj'), [b1]: header('id-b', '/proj') });
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [a1, b1] });
    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-A', 'id-a');
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-B', 'id-b');
    const callsAfterFresh = mockWriteCliSessionId.mock.calls.length;

    // A newer transcript appears — ambiguous which session cleared → skip.
    mockFilesByHeader({ [a1]: header('id-a', '/proj'), [b1]: header('id-b', '/proj'), [clear]: header('id-clear', '/proj') });
    mockSessionsTree(SESSIONS_ROOT, { 'dir-a': [a1, b1, clear] });
    vi.advanceTimersByTime(2000);
    expect(mockWriteCliSessionId).toHaveBeenCalledTimes(callsAfterFresh);
  });
});

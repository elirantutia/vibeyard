import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
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

const electronMock = vi.hoisted(() => ({ windows: [] as { isDestroyed(): boolean }[] }));
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => electronMock.windows },
}));

const { STATUS_DIR: MOCK_STATUS_DIR } = vi.hoisted(() => {
  const path = require('path');
  return { STATUS_DIR: path.join('/tmp', 'vibeyard') };
});

const onAdopted = vi.hoisted(() => vi.fn());

vi.mock('./hook-status', () => ({
  STATUS_DIR: MOCK_STATUS_DIR,
  writeCliSessionId: vi.fn(),
}));

import * as path from 'path';

import * as fs from 'fs';
import { writeCliSessionId } from './hook-status';
import { createCompatibleSessionWatcher } from './pi-compatible-session-watcher';
import type { CompatibleSessionWatcher } from './pi-compatible-session-watcher';

const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockStatSync = vi.mocked(fs.statSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockReadSync = vi.mocked(fs.readSync);
const mockCloseSync = vi.mocked(fs.closeSync);
const mockWriteCliSessionId = vi.mocked(writeCliSessionId);
const mockWatch = vi.mocked(fs.watch);

/**
 * Per-launch session dirs are FLAT: a transcript file appears directly in
 * the session's exclusive dir (see launch-session-dir.ts). The mock is a
 * map of full dir path → { files, mtimeMs }.
 */
const dirState = new Map<string, { files: string[]; mtimeMs: number }>();
const readdirCounts = new Map<string, number>();
const openedFiles: string[] = [];

function setDir(dir: string, files: string[], mtimeMs = 1_000): void {
  dirState.set(dir, { files, mtimeMs });
}

function mockFlatDirs(): void {
  mockReaddirSync.mockImplementation((p: string) => {
    const s = dirState.get(p);
    if (!s) throw new Error('ENOENT');
    readdirCounts.set(p, (readdirCounts.get(p) ?? 0) + 1);
    return s.files;
  });
  mockStatSync.mockImplementation((p: string) => {
    const s = dirState.get(p);
    if (!s) throw new Error('ENOENT');
    return { mtimeMs: s.mtimeMs };
  });
}

/** Serve a different header line per basename, so coexisting files keep their own ids. */
function mockFilesByHeader(lineByBasename: Record<string, string>): void {
  let fdCounter = 100;
  const fdToLine = new Map<number, string>();
  mockOpenSync.mockImplementation((p: string) => {
    openedFiles.push(p);
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

function header(id: string, cwd: string): string {
  return JSON.stringify({ type: 'session', version: 3, id, timestamp: 't', cwd });
}

/** `<ISO timestamp>_<id>.jsonl` stamped `ageMs` before the (fake) current time. */
function transcript(ageMs: number, id: string): string {
  const d = new Date(Date.now() - ageMs);
  const p = (n: number) => String(n).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}-${ms}Z_${id}.jsonl`;
}

const DIR_A = '/mock/sessions/ui-a';
const DIR_B = '/mock/sessions/ui-b';
const DIR_EXT = '/mock/sessions/external';

let watcher: CompatibleSessionWatcher;

function start(): void {
  mockWatch.mockReturnValue({ close: vi.fn() } as unknown as fs.FSWatcher);
  watcher = createCompatibleSessionWatcher({ onAdopted });
  watcher.start();
}

/** The watch callback wired to a specific dir (no-op if that dir is unwatched). Fires as a file-creation ('rename') event. */
function watchEventFor(dir: string): (...args: unknown[]) => void {
  const call = mockWatch.mock.calls.find((c) => c[0] === dir);
  return call ? (call[1] as (...args: unknown[]) => void) : () => {};
}

beforeEach(() => {
  vi.useFakeTimers();
  dirState.clear();
  readdirCounts.clear();
  openedFiles.length = 0;
  electronMock.windows = [{ isDestroyed: () => false }];
  mockFlatDirs();
});

afterEach(() => {
  watcher?.stop();
  vi.useRealTimers();
});

describe('process-scoped ownership (per-launch exclusive dirs)', () => {
  it('keeps a resumed tab on its seeded id while a fresh tab adopts its own file', () => {
    // Resumed A: seeded with its known id + existing transcript path.
    const fileA = transcript(60_000, 'cli-a');
    setDir(DIR_A, [fileA]);
    setDir(DIR_B, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A, knownCliId: 'cli-a', adoptedFile: path.join(DIR_A, fileA) });
    // Fresh B: exclusive dir, id discovered from the first file that lands there.
    watcher.registerPending('ui-b', '/proj', undefined, { sessionDir: DIR_B });

    const fileB = transcript(1_000, 'cli-b');
    setDir(DIR_B, [fileB]);
    mockFilesByHeader({ [fileB]: header('cli-b', '/proj') });

    vi.advanceTimersByTime(2_000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-b', 'cli-b');
    // A is never re-published: its seeded file is in its registration
    // generation, so it is not a candidate.
    expect(mockWriteCliSessionId).not.toHaveBeenCalledWith('ui-a', 'cli-a');
    expect(onAdopted).toHaveBeenCalledTimes(1);
    expect(onAdopted).toHaveBeenCalledWith('ui-b', 'cli-b', '/proj', undefined, DIR_B);
  });

  it('is unaffected by registration order (fresh B registered before resumed A)', () => {
    setDir(DIR_A, [transcript(60_000, 'cli-a')]);
    setDir(DIR_B, []);
    start();
    watcher.registerPending('ui-b', '/proj', undefined, { sessionDir: DIR_B });
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A, knownCliId: 'cli-a', adoptedFile: path.join(DIR_A, transcript(60_000, 'cli-a')) });

    const fileB = transcript(1_000, 'cli-b');
    setDir(DIR_B, [fileB]);
    mockFilesByHeader({ [fileB]: header('cli-b', '/proj') });

    vi.advanceTimersByTime(2_000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-b', 'cli-b');
    expect(mockWriteCliSessionId).not.toHaveBeenCalledWith('ui-a', expect.anything());
  });

  it('attributes each fresh tab to the file in its OWN dir, in any arrival order', () => {
    setDir(DIR_A, []);
    setDir(DIR_B, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    watcher.registerPending('ui-b', '/proj', undefined, { sessionDir: DIR_B });

    // B's first write lands first…
    const fileB = transcript(2_000, 'cli-b');
    setDir(DIR_B, [fileB]);
    mockFilesByHeader({ [fileB]: header('cli-b', '/proj') });
    vi.advanceTimersByTime(2_000);
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-b', 'cli-b');
    expect(mockWriteCliSessionId).not.toHaveBeenCalledWith('ui-a', expect.anything());

    // …then A's.
    const fileA = transcript(1_000, 'cli-a');
    setDir(DIR_A, [fileA]);
    mockFilesByHeader({ [fileA]: header('cli-a', '/proj') });
    vi.advanceTimersByTime(2_000);
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-a', 'cli-a');
  });

  it('never adopts a file from an unregistered (default-tree) dir', () => {
    setDir(DIR_A, []);
    setDir(DIR_EXT, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });

    const ext = transcript(1_000, 'cli-ext');
    setDir(DIR_EXT, [ext]);
    mockFilesByHeader({ [ext]: header('cli-ext', '/proj') });

    vi.advanceTimersByTime(6_000);

    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
    expect(onAdopted).not.toHaveBeenCalled();
  });

  it('attributes two profiles sharing one cwd to separate files in separate dirs', () => {
    setDir(DIR_A, []);
    setDir(DIR_B, []);
    start();
    watcher.registerPending('ui-a', '/proj', '/profiles/work', { sessionDir: DIR_A, knownCliId: 'cli-a' });
    watcher.registerPending('ui-b', '/proj', '/profiles/home', { sessionDir: DIR_B, knownCliId: 'cli-b' });

    const fileA = transcript(1_500, 'cli-a');
    const fileB = transcript(1_000, 'cli-b');
    setDir(DIR_A, [fileA]);
    setDir(DIR_B, [fileB]);
    mockFilesByHeader({
      [fileA]: header('cli-a', '/proj'),
      [fileB]: header('cli-b', '/proj'),
    });

    vi.advanceTimersByTime(2_000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-a', 'cli-a');
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-b', 'cli-b');
    expect(onAdopted).toHaveBeenCalledWith('ui-a', 'cli-a', '/proj', '/profiles/work', DIR_A);
    expect(onAdopted).toHaveBeenCalledWith('ui-b', 'cli-b', '/proj', '/profiles/home', DIR_B);
  });
});

describe('/clear re-adoption (ownership transition, same evidence)', () => {
  it('re-adopts only the tab whose own dir gained a newer file', () => {
    setDir(DIR_A, []);
    setDir(DIR_B, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A, knownCliId: 'cli-a' });
    watcher.registerPending('ui-b', '/proj', undefined, { sessionDir: DIR_B, knownCliId: 'cli-b' });

    const fileA = transcript(5_000, 'cli-a');
    const fileB = transcript(5_000, 'cli-b');
    setDir(DIR_A, [fileA]);
    setDir(DIR_B, [fileB]);
    mockFilesByHeader({
      [fileA]: header('cli-a', '/proj'),
      [fileB]: header('cli-b', '/proj'),
    });
    vi.advanceTimersByTime(2_000);
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-a', 'cli-a');
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-b', 'cli-b');
    mockWriteCliSessionId.mockClear();

    // A runs /clear: Pi writes a brand-new transcript (new id) in A's own dir.
    const fileA2 = transcript(1_000, 'cli-a2');
    setDir(DIR_A, [fileA, fileA2]);
    mockFilesByHeader({
      [fileA]: header('cli-a', '/proj'),
      [fileA2]: header('cli-a2', '/proj'),
    });
    vi.advanceTimersByTime(2_000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-a', 'cli-a2');
    // B is untouched — nothing new appeared in B's dir.
    expect(mockWriteCliSessionId).not.toHaveBeenCalledWith('ui-b', expect.anything());
  });
});

describe('registration lifecycle', () => {
  it('adopts nothing after unregister (failed spawn)', () => {
    setDir(DIR_A, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    watcher.unregister('ui-a');

    const fileA = transcript(1_000, 'cli-a');
    setDir(DIR_A, [fileA]);
    mockFilesByHeader({ [fileA]: header('cli-a', '/proj') });

    vi.advanceTimersByTime(4_000);

    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });

  it('re-registration re-baselines the generation: the previous launch files are excluded', () => {
    setDir(DIR_A, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });

    const fileA1 = transcript(5_000, 'cli-a1');
    setDir(DIR_A, [fileA1]);
    mockFilesByHeader({ [fileA1]: header('cli-a1', '/proj') });
    vi.advanceTimersByTime(2_000);
    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-a', 'cli-a1');
    mockWriteCliSessionId.mockClear();

    // Re-spawn of the same UI session reuses the dir: re-register.
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    vi.advanceTimersByTime(4_000);

    // The old file is in the new registration's generation — never re-adopted.
    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });

  it('unregister is idempotent', () => {
    setDir(DIR_A, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    expect(() => {
      watcher.unregister('ui-a');
      watcher.unregister('ui-a');
    }).not.toThrow();
  });

  it('never re-adopts a new file carrying an already-assigned id', () => {
    const fileA = transcript(60_000, 'cli-a');
    setDir(DIR_A, [fileA]);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A, knownCliId: 'cli-a', adoptedFile: path.join(DIR_A, fileA) });
    mockFilesByHeader({ [fileA]: header('cli-a', '/proj') });
    vi.advanceTimersByTime(2_000);
    mockWriteCliSessionId.mockClear();

    // A second file with the SAME id appears (e.g. a re-spawn reusing the
    // pinned id): the id is assigned, so it is not a candidate.
    const fileA2 = transcript(1_000, 'cli-a');
    setDir(DIR_A, [fileA, fileA2]);
    mockFilesByHeader({
      [fileA]: header('cli-a', '/proj'),
      [fileA2]: header('cli-a', '/proj'),
    });
    vi.advanceTimersByTime(4_000);

    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });

  it('treats a registration without a sessionDir as a no-op (legacy degrade)', () => {
    setDir(DIR_EXT, []);
    start();
    watcher.registerPending('ui-x', '/proj', undefined);

    const ext = transcript(1_000, 'cli-x');
    setDir(DIR_EXT, [ext]);
    mockFilesByHeader({ [ext]: header('cli-x', '/proj') });
    vi.advanceTimersByTime(4_000);

    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
    expect(mockWatch).not.toHaveBeenCalled();
  });
});

describe('event-driven scan coalescing', () => {
  it('collapses a burst of watch events into a single scan', () => {
    setDir(DIR_A, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });

    const before = readdirCounts.get(DIR_A) ?? 0;
    for (let i = 0; i < 50; i += 1) watchEventFor(DIR_A)('rename');
    expect(readdirCounts.get(DIR_A) ?? 0).toBe(before); // nothing ran synchronously

    vi.advanceTimersByTime(250);
    expect((readdirCounts.get(DIR_A) ?? 0) - before).toBe(1);
  });

  it('bounds the scan rate under a continuous stream of events', () => {
    setDir(DIR_A, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });

    const before = readdirCounts.get(DIR_A) ?? 0;
    // 5s of events every 10ms — hundreds of raw events.
    for (let i = 0; i < 500; i += 1) {
      watchEventFor(DIR_A)('rename');
      vi.advanceTimersByTime(10);
    }
    const scans = (readdirCounts.get(DIR_A) ?? 0) - before;

    // Never starved (at least one scan per second of the burst) and never
    // proportional to the event count (500 raw events).
    expect(scans).toBeGreaterThanOrEqual(4);
    expect(scans).toBeLessThanOrEqual(10);
  });

  it('still discovers a new transcript on the coalesced event path', () => {
    setDir(DIR_A, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    const fresh = transcript(1_000, 'cli-fast');
    setDir(DIR_A, [fresh]);
    mockFilesByHeader({ [fresh]: header('cli-fast', '/proj') });

    watchEventFor(DIR_A)('rename');
    vi.advanceTimersByTime(250);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-a', 'cli-fast');
  });

  it('does not scan at all when no session is registered', () => {
    setDir(DIR_EXT, ['x.jsonl']);
    start();

    const before = readdirCounts.get(DIR_EXT) ?? 0;
    watchEventFor(DIR_EXT)('rename');
    vi.advanceTimersByTime(5_000);

    expect(readdirCounts.get(DIR_EXT) ?? 0).toBe(before);
    expect(mockOpenSync).not.toHaveBeenCalled();
  });

  it('drops a pending coalesced scan on stop()', () => {
    setDir(DIR_A, []);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    const fileA = transcript(1_000, 'cli-late');
    setDir(DIR_A, [fileA]);
    mockFilesByHeader({});

    const before = readdirCounts.get(DIR_A) ?? 0;
    watchEventFor(DIR_A)('rename');
    watcher.stop();
    vi.advanceTimersByTime(10_000);

    expect(readdirCounts.get(DIR_A) ?? 0).toBe(before);
  });
});

describe('directory listing cache', () => {
  it('reuses an unchanged listing during idle polls', () => {
    setDir(DIR_A, [], 1_000);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    const afterRegister = readdirCounts.get(DIR_A) ?? 0;

    vi.advanceTimersByTime(6_000); // three idle polls, mtime unchanged

    expect(readdirCounts.get(DIR_A) ?? 0).toBe(afterRegister);
  });

  it('detects changed contents without a watch event when the mtime moves', () => {
    setDir(DIR_A, [], 1_000);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    const afterRegister = readdirCounts.get(DIR_A) ?? 0;
    vi.advanceTimersByTime(2_000);
    expect(readdirCounts.get(DIR_A) ?? 0).toBe(afterRegister);

    // The dir's mtime moves (a file was written) — the next poll re-reads.
    const fileA = transcript(1_000, 'cli-a');
    setDir(DIR_A, [fileA], 2_000);
    mockFilesByHeader({ [fileA]: header('cli-a', '/proj') });
    vi.advanceTimersByTime(2_000);

    expect(mockWriteCliSessionId).toHaveBeenCalledWith('ui-a', 'cli-a');
  });

  it('excludes pre-existing files at registration even if directory mtimes are unchanged', () => {
    const pre = transcript(60_000, 'cli-pre');
    setDir(DIR_A, [pre], 1_000);
    start();
    watcher.registerPending('ui-a', '/proj', undefined, { sessionDir: DIR_A });
    mockFilesByHeader({ [pre]: header('cli-pre', '/proj') });

    vi.advanceTimersByTime(4_000);

    expect(mockWriteCliSessionId).not.toHaveBeenCalled();
  });
});

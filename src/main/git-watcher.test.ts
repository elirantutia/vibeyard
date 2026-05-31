import { vi } from 'vitest';
import type { ExecFileException } from 'child_process';
import type { Dirent, FSWatcher, WatchListener } from 'fs';

// Mock fs and child_process before importing the module
vi.mock('fs', () => ({
  watch: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

// Mutable platform flag so tests can exercise the recursive (macOS/Windows) vs
// per-dir BFS (Linux) working-tree branch. Getters keep the live `import { isLinux }`
// binding in git-watcher in sync with reassignments.
const platform = vi.hoisted(() => ({ isLinux: false }));
vi.mock('./platform', () => ({
  get isLinux() { return platform.isLinux; },
  get isMac() { return !platform.isLinux; },
  get isWin() { return false; },
}));

import * as fs from 'fs';
import { execFile } from 'child_process';
import * as path from 'path';
import { startGitWatcher, stopGitWatcher, notifyGitChanged } from './git-watcher';

const mockWatch = vi.mocked(fs.watch);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockExecFile = vi.mocked(execFile);

type Tree = Record<string, string[]>; // dir path -> immediate subdir names

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as Dirent;
}

function installTree(tree: Tree) {
  mockReaddirSync.mockImplementation(((dir: unknown) => {
    const subs = tree[dir as string] ?? [];
    return subs.map((name) => makeDirent(name, true));
  }) as unknown as typeof fs.readdirSync);
}

function installWatch() {
  const watchers: Array<{
    path: string;
    listener: WatchListener<string>;
    close: () => void;
  }> = [];
  mockWatch.mockImplementation(((p: unknown, listenerOrOpts: unknown, maybeListener?: unknown) => {
    // Two call shapes used by the module: fs.watch(path, listener)
    const listener =
      typeof listenerOrOpts === 'function' ? listenerOrOpts : (maybeListener as WatchListener<string>);
    const entry = {
      path: String(p),
      listener: listener as WatchListener<string>,
      close: vi.fn(),
    };
    const watcher = {
      close: entry.close,
      on: vi.fn().mockReturnThis(),
    } as unknown as FSWatcher;
    watchers.push(entry);
    return watcher;
  }) as unknown as typeof fs.watch);
  return watchers;
}

function stubGitRevParse(gitDir: string) {
  mockExecFile.mockImplementationOnce(((_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
    (callback as (err: ExecFileException | null, stdout: string) => void)(null, `${gitDir}\n`);
    return undefined as never;
  }) as unknown as typeof execFile);
}

function makeWin() {
  return {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  platform.isLinux = false; // default to the recursive (macOS/Windows) branch
});

afterEach(() => {
  stopGitWatcher();
  vi.useRealTimers();
});

describe('startGitWatcher', () => {
  it('(Linux) never passes { recursive: true } to fs.watch', async () => {
    platform.isLinux = true;
    const root = path.join('/proj');
    installTree({ [root]: [] });
    installWatch();
    stubGitRevParse(path.join(root, '.git'));

    await startGitWatcher(makeWin() as never, root);

    for (const call of mockWatch.mock.calls) {
      // Second arg is either a listener function or options; if options, must not have recursive: true
      const second = call[1];
      if (second && typeof second === 'object' && 'recursive' in second) {
        expect((second as { recursive?: boolean }).recursive).not.toBe(true);
      }
    }
  });

  it('(Linux) does not descend into ignored directories', async () => {
    platform.isLinux = true;
    const root = path.join('/proj');
    const tree: Tree = {
      [root]: ['src', 'node_modules', '.venv', '.git', 'target', '__pycache__', 'lib'],
      [path.join(root, 'src')]: ['components'],
      [path.join(root, 'src', 'components')]: [],
      [path.join(root, 'lib')]: [],
      // These should never be read because they're filtered before queueing:
      [path.join(root, 'node_modules')]: ['some-pkg'],
      [path.join(root, '.venv')]: ['lib'],
    };
    installTree(tree);
    installWatch();
    stubGitRevParse(path.join(root, '.git'));

    await startGitWatcher(makeWin() as never, root);

    const watchedPaths = mockWatch.mock.calls.map((c) => String(c[0]));
    expect(watchedPaths).toContain(root);
    expect(watchedPaths).toContain(path.join(root, 'src'));
    expect(watchedPaths).toContain(path.join(root, 'src', 'components'));
    expect(watchedPaths).toContain(path.join(root, 'lib'));

    // Verify ignored dirs are never watched (walk-time exclusion, not just event filter)
    expect(watchedPaths).not.toContain(path.join(root, 'node_modules'));
    expect(watchedPaths).not.toContain(path.join(root, 'node_modules', 'some-pkg'));
    expect(watchedPaths).not.toContain(path.join(root, '.venv'));
    expect(watchedPaths).not.toContain(path.join(root, '.venv', 'lib'));
    expect(watchedPaths).not.toContain(path.join(root, 'target'));
    expect(watchedPaths).not.toContain(path.join(root, '__pycache__'));
    // .git itself is ignored by the working-tree walker but watched separately below
    // (non-recursive on .git dir) — assert here that we did NOT walk INTO .git
    expect(mockReaddirSync).not.toHaveBeenCalledWith(path.join(root, '.git'), expect.anything());
  });

  it('(Linux) caps the number of working-tree watches', async () => {
    platform.isLinux = true;
    const root = path.join('/proj');
    // Build a fan-out tree with > MAX_WATCHES (2000) total dirs
    const tree: Tree = { [root]: [] };
    const childNames: string[] = [];
    // 60 children x 60 grandchildren = 3600 directories under the root
    for (let i = 0; i < 60; i++) {
      const name = `d${i}`;
      childNames.push(name);
      const child = path.join(root, name);
      const grandNames: string[] = [];
      for (let j = 0; j < 60; j++) grandNames.push(`g${j}`);
      tree[child] = grandNames;
      for (const g of grandNames) tree[path.join(child, g)] = [];
    }
    tree[root] = childNames;

    installTree(tree);
    installWatch();
    stubGitRevParse(path.join(root, '.git'));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startGitWatcher(makeWin() as never, root);

    // Working-tree walk should stop at MAX_WATCHES; the module also adds a handful
    // of .git-internal watches afterwards. Total fs.watch calls should not exceed
    // MAX_WATCHES + a small constant (4: .git dir + 3 refs subdirs + HEAD = 5 ish).
    expect(mockWatch.mock.calls.length).toBeLessThanOrEqual(2010);
    expect(mockWatch.mock.calls.length).toBeGreaterThanOrEqual(2000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('MAX_WATCHES'));
    warn.mockRestore();
  });

  it('debounces and sends git:changed when a watched dir fires an event', async () => {
    const root = path.join('/proj');
    installTree({ [root]: [] });
    const watchers = installWatch();
    stubGitRevParse(path.join(root, '.git'));

    const win = makeWin();
    await startGitWatcher(win as never, root);

    // Fire an event on the root working-tree watcher
    const rootEntry = watchers.find((w) => w.path === root)!;
    rootEntry.listener('change', 'src/foo.ts');

    expect(win.webContents.send).not.toHaveBeenCalled(); // debounced
    vi.advanceTimersByTime(300);
    expect(win.webContents.send).toHaveBeenCalledWith('git:changed');
  });

  it('.git/ watcher only notifies for allow-listed filenames', async () => {
    const root = path.join('/proj');
    const gitDir = path.join(root, '.git');
    installTree({ [root]: [] });
    const watchers = installWatch();
    stubGitRevParse(gitDir);

    const win = makeWin();
    await startGitWatcher(win as never, root);

    const gitEntry = watchers.find((w) => w.path === gitDir)!;

    // Noise inside .git/ (e.g., objects pack write) should NOT notify
    gitEntry.listener('change', 'objects/pack/pack-abc.pack');
    vi.advanceTimersByTime(300);
    expect(win.webContents.send).not.toHaveBeenCalled();

    // Allow-listed files SHOULD notify
    for (const allowed of ['index', 'HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'packed-refs', 'FETCH_HEAD']) {
      (win.webContents.send as ReturnType<typeof vi.fn>).mockClear();
      gitEntry.listener('change', allowed);
      vi.advanceTimersByTime(300);
      expect(win.webContents.send).toHaveBeenCalledWith('git:changed');
    }
  });

  it('stopGitWatcher closes every watcher and clears the timer', async () => {
    const root = path.join('/proj');
    installTree({ [root]: ['src'], [path.join(root, 'src')]: [] });
    const watchers = installWatch();
    stubGitRevParse(path.join(root, '.git'));

    await startGitWatcher(makeWin() as never, root);
    const createdCount = watchers.length;
    expect(createdCount).toBeGreaterThan(0);

    stopGitWatcher();

    for (const w of watchers) {
      expect(w.close).toHaveBeenCalled();
    }
  });

  it('is idempotent for the same project path', async () => {
    const root = path.join('/proj');
    installTree({ [root]: [] });
    installWatch();
    stubGitRevParse(path.join(root, '.git'));

    const win = makeWin();
    await startGitWatcher(win as never, root);
    const firstCallCount = mockWatch.mock.calls.length;

    // Second call with the same path is a no-op (no extra watchers, no extra git rev-parse)
    await startGitWatcher(win as never, root);
    expect(mockWatch.mock.calls.length).toBe(firstCallCount);
  });
});

describe('startGitWatcher (macOS/Windows recursive working tree)', () => {
  it('uses a single recursive watch for the working tree (no BFS walk)', async () => {
    const root = path.join('/proj');
    installTree({ [root]: ['src', 'lib'] }); // would be walked on Linux; must be ignored here
    installWatch();
    stubGitRevParse(path.join(root, '.git'));

    await startGitWatcher(makeWin() as never, root);

    const rootCalls = mockWatch.mock.calls.filter((c) => String(c[0]) === root);
    expect(rootCalls.length).toBe(1);
    const opts = rootCalls[0][1] as { recursive?: boolean };
    expect(opts.recursive).toBe(true);
    // No per-dir BFS: the tree is never read, and subdirs are never watched.
    expect(mockReaddirSync).not.toHaveBeenCalled();
    expect(mockWatch.mock.calls.map((c) => String(c[0]))).not.toContain(path.join(root, 'src'));
  });

  it('filters ignored segments, notifies on tracked paths and on null (coalesced)', async () => {
    const root = path.join('/proj');
    installTree({ [root]: [] });
    const watchers = installWatch();
    stubGitRevParse(path.join(root, '.git'));

    const win = makeWin();
    await startGitWatcher(win as never, root);
    const tree = watchers.find((w) => w.path === root)!;

    tree.listener('change', path.join('node_modules', 'foo.js'));
    vi.advanceTimersByTime(300);
    expect(win.webContents.send).not.toHaveBeenCalled();

    tree.listener('change', path.join('src', 'app.ts'));
    vi.advanceTimersByTime(300);
    expect(win.webContents.send).toHaveBeenCalledWith('git:changed');

    (win.webContents.send as ReturnType<typeof vi.fn>).mockClear();
    tree.listener('change', null as never); // OS coalesced — notify conservatively
    vi.advanceTimersByTime(300);
    expect(win.webContents.send).toHaveBeenCalledWith('git:changed');
  });

  it('closes the recursive handle on stop', async () => {
    const root = path.join('/proj');
    installTree({ [root]: [] });
    const watchers = installWatch();
    stubGitRevParse(path.join(root, '.git'));

    await startGitWatcher(makeWin() as never, root);
    stopGitWatcher();

    for (const w of watchers) expect(w.close).toHaveBeenCalled();
  });
});

describe('notifyGitChanged', () => {
  it('sends git:changed after debounce', async () => {
    const root = path.join('/proj');
    installTree({ [root]: [] });
    installWatch();
    stubGitRevParse(path.join(root, '.git'));

    const win = makeWin();
    await startGitWatcher(win as never, root);

    notifyGitChanged();
    expect(win.webContents.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(win.webContents.send).toHaveBeenCalledWith('git:changed');
  });
});

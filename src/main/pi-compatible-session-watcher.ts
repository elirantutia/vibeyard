import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { writeCliSessionId } from './hook-status';
import { readSessionHeaderSync } from './providers/pi-compatible-transcripts';

/**
 * Shared transcript-ownership watcher for Pi-compatible providers (Pi and
 * OMP).
 *
 * Ownership is process-scoped, not inferred: every launch runs with
 * `--session-dir <dir>` pointing at a directory that only that launch
 * writes to (see launch-session-dir.ts). A registration therefore names
 * its exclusive directory, and a transcript file is attributed the moment
 * it appears IN THAT DIRECTORY — no cwd matching, no timestamp freshness
 * window, no cross-tab ambiguity. An external CLI run in the same project
 * (or the same profile) writes to the user's default sessions tree, never
 * into a per-launch dir, so it can never be adopted.
 *
 * Two attribution modes per registration:
 *  - knownCliId: the CLI id is known before the first write (Pi fresh
 *    launches pass a Vibeyard-generated id via `--session-id`; every
 *    resume knows its id). The watcher adopts the file carrying exactly
 *    that id.
 *  - unknown id (OMP fresh launches): the first transcript to appear in
 *    the exclusive dir is adopted — the directory guarantees it is this
 *    process's.
 *
 * A `/clear` (the CLI starting a brand-new transcript in the same storage
 * root) is an ownership TRANSITION with the same evidence: a NEWER file
 * appears in the session's own dir, and the adopted id follows it. Files
 * that already existed at registration (a re-spawn reusing the same UI
 * session dir) are snapshotted into the registration generation and can
 * never be adopted.
 */

export interface CompatibleSessionWatcherOptions {
  /** Called after a session id is adopted, for follow-up wiring (title sync). */
  onAdopted?: (
    uiSessionId: string,
    cliSessionId: string,
    projectPath: string,
    configDir: string | undefined,
    sessionDir: string | undefined
  ) => void;
}

export interface RegisterPendingOptions {
  /** Exclusive per-launch session dir; transcripts of this session appear only here. */
  sessionDir?: string;
  /** Known CLI session id (Pi fresh launches, every resume). */
  knownCliId?: string;
  /** Existing transcript path to seed as already adopted (resumes). */
  adoptedFile?: string;
}

export interface CompatibleSessionWatcher {
  start(): void;
  registerPending(sessionId: string, projectPath: string, configDir: string | undefined, opts?: RegisterPendingOptions): void;
  unregister(sessionId: string): void;
  stop(): void;
}

interface WatchedSession {
  projectPath: string;
  configDir?: string;
  /** Exclusive per-launch dir this session's transcripts appear in. */
  sessionDir: string;
  /** CLI id known before the first write; undefined = first file wins. */
  knownCliId?: string;
  /** Transcript files that existed at registration — never adopted. */
  knownGeneration: number;
  registeredAt: number;
  /**
   * Set once this session's transcript is adopted (seeded on resume, or
   * adopted on first write). Kept (not deleted) so a later `/clear` — a
   * newer transcript under a new id in the SAME dir — can be re-adopted,
   * keeping the synced title/status on the live conversation.
   */
  adoptedFile?: string;
  adoptedCliId?: string;
  adoptedFileTs?: number | null;
}

interface Candidate {
  file: string;
  sessionId: string;
  /** ISO timestamp parsed from the filename, or null when absent/unparseable. */
  fileTs: number | null;
}

/**
 * Filenames are <ISO-timestamp>_<uuid>.jsonl with ':' and '.' rewritten as
 * '-' (e.g. 2026-08-15T23-09-32-005Z). Returns the timestamp in ms, or null
 * when the filename doesn't start with one.
 */
function filenameTimestampMs(file: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/.exec(path.basename(file));
  if (!m) return null;
  const ts = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * Event-driven scan pacing. A transcript is appended continuously during
 * an agent turn, so every per-launch-dir watcher fires many times per
 * second; scanning on each event would re-read the header (open + 8KB read
 * + JSON.parse) of every transcript in the tree.
 *
 *  - SCAN_DEBOUNCE_MS coalesces a burst into one scan. The timer is NOT
 *    re-armed while pending, so the window is measured from the burst's
 *    first event and a continuous stream can never starve discovery.
 *  - SCAN_MIN_SPACING_MS is the floor between consecutive event-driven
 *    scans, capping the steady-state rate at ~1/sec no matter how chatty
 *    the watchers are.
 *
 * The POLL_INTERVAL_MS fallback stays the correctness guarantee, so events
 * dropped by the coalescing cost at most one poll tick of latency.
 */
const SCAN_DEBOUNCE_MS = 250;
const SCAN_MIN_SPACING_MS = 1_000;
const POLL_INTERVAL_MS = 2_000;

export function createCompatibleSessionWatcher(
  options: CompatibleSessionWatcherOptions = {}
): CompatibleSessionWatcher {
  const watchedSessions = new Map<string, WatchedSession>();
  const assignedIds = new Set<string>();
  // One registration history per dir (files seen so far + generation
  // counter), so a re-spawn reusing the same UI session dir cannot adopt
  // the previous launch's transcripts.
  const histories = new Map<string, { generation: number; files: Map<string, number> }>();
  const directoryCache = new Map<string, { mtime: number; checked: number; names: string[] }>();
  const dirtyDirectories = new Set<string>();
  // One native watcher per per-launch dir, shared by every session that
  // uses it (a re-spawn reuses the dir).
  const dirWatchers = new Map<string, fs.FSWatcher>();

  function readDirectory(dir: string, force = false): string[] {
    const cached = directoryCache.get(dir);
    let mtime = Number.NaN;
    try { mtime = fs.statSync(dir).mtimeMs; } catch { /* Fall back to enumeration. */ }
    if (!force && cached && cached.mtime === mtime && !dirtyDirectories.has(dir) && Date.now() - cached.checked < 30_000) return cached.names;
    try {
      const names = fs.readdirSync(dir);
      directoryCache.set(dir, { mtime, checked: Date.now(), names });
      dirtyDirectories.delete(dir);
      return names;
    } catch { directoryCache.delete(dir); return []; }
  }

  /** Flat listing: per-launch dirs hold transcripts directly (no per-cwd subdirs). */
  function refreshHistory(dir: string, force = false): { generation: number; files: Map<string, number>; current: string[] } {
    let history = histories.get(dir);
    if (!history) { history = { generation: 0, files: new Map() }; histories.set(dir, history); }
    const current: string[] = [];
    for (const name of readDirectory(dir, force)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(dir, name);
      if (!history.files.has(file)) history.files.set(file, ++history.generation);
      current.push(file);
    }
    return { ...history, current };
  }

  // Bounded: the set exists to dedupe ids already adopted; evict oldest
  // (Sets preserve insertion order) so it can't grow for the app's lifetime.
  const MAX_ASSIGNED_IDS = 1000;
  function rememberAssignedId(id: string): void {
    if (assignedIds.size >= MAX_ASSIGNED_IDS) {
      const oldest = assignedIds.values().next().value;
      if (oldest !== undefined) assignedIds.delete(oldest);
    }
    assignedIds.add(id);
  }

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  /** Pending coalesced scan; non-null while a burst is being collapsed. */
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the last scan actually ran, so pacing sees poll scans too. */
  let lastScanAt = 0;

  /**
   * Commit an adoption: publish the id to the renderer, mark it assigned,
   * record it on the watched session, and fire the follow-up wiring. A
   * failed id write leaves the session in its prior state so the next scan
   * retries (never crash the timer/watch callback).
   */
  function adopt(uiId: string, p: WatchedSession, cand: Candidate): boolean {
    try {
      writeCliSessionId(uiId, cand.sessionId);
    } catch {
      // Disk full / permissions — keep prior state, retry on the next scan.
      return false;
    }
    rememberAssignedId(cand.sessionId);
    p.adoptedFile = cand.file;
    p.adoptedCliId = cand.sessionId;
    p.adoptedFileTs = cand.fileTs;
    // Follow-up wiring (e.g. starting the transcript sync) must not undo an
    // adoption if the callback throws.
    try {
      options.onAdopted?.(uiId, cand.sessionId, p.projectPath, p.configDir, p.sessionDir);
    } catch { /* best-effort */ }
    return true;
  }

  function collectCandidates(dir: string, knownGeneration: number): Candidate[] {
    const history = refreshHistory(dir);
    const out: Candidate[] = [];
    for (const full of history.current) {
      if ((history.files.get(full) ?? 0) <= knownGeneration) continue;
      const header = readSessionHeaderSync(full);
      if (!header || assignedIds.has(header.id)) continue;
      out.push({ file: full, sessionId: header.id, fileTs: filenameTimestampMs(full) });
    }
    return out;
  }

  function scanForNewSessions(): void {
    if (watchedSessions.size === 0) return;

    for (const [uiId, p] of watchedSessions) {
      const candidates = collectCandidates(p.sessionDir, p.knownGeneration);
      if (candidates.length === 0) continue;

      if (!p.adoptedFile) {
        // Fresh adoption: claim this session's first transcript.
        const match = p.knownCliId
          ? candidates.find((c) => c.sessionId === p.knownCliId)
          : candidates[0];
        if (match) adopt(uiId, p, match);
        continue;
      }

      // `/clear` re-adoption: a NEWER transcript in this session's own dir
      // is its fresh start. The dir is exclusive to this session, so there
      // is no ambiguity to resolve and no freshness window to bound — any
      // new file here is this process's.
      const match = candidates.find((c) => c.sessionId !== p.adoptedCliId);
      if (match) adopt(uiId, p, match);
    }
  }

  function registerPending(sessionId: string, projectPath: string, configDir: string | undefined, opts: RegisterPendingOptions = {}): void {
    const { sessionDir, knownCliId, adoptedFile } = opts;
    if (!sessionDir) return;
    // A re-registration (re-spawn of the same UI session) replaces the
    // entry: the fresh snapshot below re-baselines the generation, so the
    // previous launch's files are excluded again.
    const knownGeneration = refreshHistory(sessionDir, true).generation;
    const seeded = adoptedFile
      ? { adoptedFile, adoptedCliId: knownCliId, adoptedFileTs: filenameTimestampMs(adoptedFile) }
      : {};
    watchedSessions.set(sessionId, {
      projectPath,
      configDir,
      sessionDir,
      knownCliId,
      knownGeneration,
      registeredAt: Date.now(),
      ...seeded,
    });
    if (adoptedFile && knownCliId) rememberAssignedId(knownCliId);
    watchDir(sessionDir);
  }

  function unregister(sessionId: string): void {
    const p = watchedSessions.get(sessionId);
    watchedSessions.delete(sessionId);
    if (!p) return;
    // Close the dir's watcher only when no other session uses it.
    const stillUsed = [...watchedSessions.values()].some((s) => s.sessionDir === p.sessionDir);
    if (!stillUsed) {
      const w = dirWatchers.get(p.sessionDir);
      if (w) {
        try { w.close(); } catch { /* already closed */ }
        dirWatchers.delete(p.sessionDir);
      }
      histories.delete(p.sessionDir);
      for (const dir of directoryCache.keys()) {
        if (dir === p.sessionDir) { directoryCache.delete(dir); dirtyDirectories.delete(dir); }
      }
    }
  }

  /**
   * Run one scan and record when it ran, so the event-driven pacing also
   * sees poll-driven scans: a poll that just ran means a following burst can
   * wait out its full spacing instead of scanning again immediately.
   */
  function runScan(): void {
    lastScanAt = Date.now();
    if (watchedSessions.size > 0) scanForNewSessions();
  }

  /**
   * Coalesce watch events into one scan (see SCAN_DEBOUNCE_MS /
   * SCAN_MIN_SPACING_MS). The pending timer is never re-armed, so a
   * continuous stream of events collapses to one scan per window rather
   * than one per event, and the window can never be pushed out
   * indefinitely — discovery is never starved.
   */
  function scheduleScan(): void {
    if (scanTimer) return;
    const delay = Math.max(
      SCAN_DEBOUNCE_MS,
      SCAN_MIN_SPACING_MS - (Date.now() - lastScanAt)
    );
    scanTimer = setTimeout(() => {
      scanTimer = null;
      runScan();
    }, delay);
  }

  function start(): void {
    if (pollInterval) return;

    // Look the window up per tick — a window destroyed and recreated (macOS
    // dock re-activate) must not kill the polling fallback for good.
    pollInterval = setInterval(() => {
      if (watchedSessions.size === 0) return;
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) runScan();
    }, POLL_INTERVAL_MS);
  }

  function watchDir(dir: string): void {
    const existing = dirWatchers.get(dir);
    if (existing) return;
    try {
      dirWatchers.set(dir, fs.watch(dir, (event) => {
        if (event === 'rename') dirtyDirectories.add(dir);
        scheduleScan();
      }));
    } catch {
      // Directory might not exist yet; the polling fallback covers it.
      dirWatchers.delete(dir);
    }
  }

  function stop(): void {
    for (const w of dirWatchers.values()) {
      try { w.close(); } catch { /* already closed */ }
    }
    dirWatchers.clear();
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    lastScanAt = 0;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    watchedSessions.clear();
    histories.clear();
    directoryCache.clear();
    dirtyDirectories.clear();
    assignedIds.clear();
  }

  return { start, registerPending, unregister, stop };
}

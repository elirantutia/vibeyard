import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { TranscriptDescriptor } from './provider';
import type { CliSessionStatus } from '../../shared/types';
import { isWin, isMac } from '../platform';
import {
  MAX_INDEX_BYTES,
  MAX_INDEX_FILE_BYTES,
  IndexTextBudget,
  TRANSCRIPT_IO_CONCURRENCY,
  mapWithConcurrency,
} from './transcript-utils';

/**
 * Shared on-disk contract for Pi-compatible transcripts (Pi and OMP speak
 * the same format, including PI_CODING_AGENT_DIR as the agent-dir override),
 * used by both the providers (global search / resume) and the session
 * watchers (id discovery):
 *   <agentDir>/sessions/<cwd-as-dashes>/<ISO-timestamp>_<uuid>.jsonl
 * whose first line is a session header carrying id and cwd.
 */

/**
 * Transcript headers are short (id, timestamp, cwd). Header readers pull
 * only this many bytes — a first line longer than this (effectively
 * impossible) simply fails to parse and is skipped.
 */
export const HEADER_READ_BYTES = 8 * 1024;

/** Read the head of a file (bounded, never the whole transcript). */
export function readHeaderWindowSync(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEADER_READ_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/** Async twin of readHeaderWindowSync. Per-call buffer: safe under Promise.all. */
export async function readHeaderWindowAsync(filePath: string): Promise<string | null> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(HEADER_READ_BYTES);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } catch {
    return null;
  } finally {
    if (handle) {
      try { await handle.close(); } catch { /* already closed */ }
    }
  }
}

/**
 * Status is derived from the LAST few entries of a transcript, which live at
 * the end of the file. Pull only this many trailing bytes — a single entry
 * longer than this simply fails to parse and is skipped.
 */
export const TAIL_READ_BYTES = 16 * 1024;

/**
 * Fallback window for status derivation when the last entry is larger than
 * TAIL_READ_BYTES (a big tool output / message fills the whole window, so
 * no complete line is present to parse). Bounded so a pathological huge
 * transcript can't make the poller read unboundedly.
 */
export const MAX_STATUS_TAIL_BYTES = 1024 * 1024;

/** Read the tail of a file (bounded, never the whole transcript). */
export function readTranscriptTailSync(filePath: string, bytes = TAIL_READ_BYTES): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    const readLen = Math.min(bytes, size);
    const start = size - readLen;
    const buf = Buffer.alloc(readLen);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf-8', 0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/**
 * Derive a session's current status from the last entries of its transcript.
 *
 * Pi-compatible CLIs append one JSON line per event. The last *meaningful*
 * entry (a `message` or a `custom` lifecycle marker) tells us where the
 * conversation is, mirroring the hook convention the other tools use:
 *   - mid-turn (assistant `toolUse`, or a `user` / `toolResult` /
 *     `tool_execution_start` marker) → `working`
 *   - clean finish (assistant `stop`) → `completed`
 *   - failed turn (assistant `error`) → `waiting`
 * A trailing `session_exit` maps to null: the session is removed on PTY exit,
 * so there is nothing to report. Non-event lines (title, model_change, …) are
 * skipped.
 */
export function transcriptStatusFromTail(tail: string | null): CliSessionStatus | null {
  if (!tail) return null;
  const lines = tail.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: Record<string, any>;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      // A mid-write tail line (the writer is mid-flush) — ignore and keep
      // scanning backwards for the last complete line.
      continue;
    }
    if (entry.type === 'custom' && entry.customType === 'session_exit') return null;
    const status = statusFromEntry(entry);
    if (status) return status;
  }
  return null;
}

function statusFromEntry(entry: Record<string, any>): CliSessionStatus | null {
  if (entry.type === 'custom') {
    if (entry.customType === 'session_exit') return null; // session is removed on PTY exit; nothing to report
    if (entry.customType === 'tool_execution_start') return 'working';
    return null;
  }
  if (entry.type === 'message') {
    const role = entry.message?.role;
    if (role === 'assistant') {
      const stop = entry.message?.stopReason;
      // Mirrors the hook convention: a clean finish (stop) is `completed`, a
      // failed turn (error) is `waiting` — same as Claude's Stop/StopFailure.
      // Anything else (toolUse / mid-turn) is still `working`.
      if (stop === 'error') return 'waiting';
      return stop === 'stop' ? 'completed' : 'working';
    }
    if (role === 'user' || role === 'toolResult') return 'working';
    return null;
  }
  return null;
}

/**
 * Fallback-read cache: when the 16KB window has no complete entry (the
 * normal mid-turn state with a big final entry), the 1MB fallback read
 * is expensive, so its result is cached with the file size at read time.
 * An unchanged file is served from the cache; a changed size re-reads and
 * refreshes it. The entry is dropped the moment the small window yields a
 * status again (the file moved past the big entry), which bounds memory.
 */
const statusTailCache = new Map<string, { size: number; status: CliSessionStatus | null }>();

/**
 * Convenience: read a transcript's tail and derive its status in one call.
 * If the default 16KB window yields no complete meaningful entry — the last
 * entry is larger than the window — retry with a larger bounded window so a
 * big final entry (large tool output / message) doesn't leave the poller on
 * a stale status.
 */
export function readTranscriptStatusSync(filePath: string): CliSessionStatus | null {
  const status = transcriptStatusFromTail(readTranscriptTailSync(filePath));
  if (status !== null) {
    // The small window works again — any cached fallback is stale.
    statusTailCache.delete(filePath);
    return status;
  }
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    // File vanished between the tail read and now — nothing to report.
    return null;
  }
  const cached = statusTailCache.get(filePath);
  if (cached && cached.size === size) return cached.status;
  const fallback = transcriptStatusFromTail(readTranscriptTailSync(filePath, MAX_STATUS_TAIL_BYTES));
  statusTailCache.set(filePath, { size, status: fallback });
  return fallback;
}

export function _resetStatusTailCacheForTesting(): void {
  statusTailCache.clear();
}

/**
 * The CLI's own explanation of an abnormal process exit. Pi-compatible
 * CLIs append a trailing `session_exit` custom entry when the process
 * dies (e.g. an unhandled rejection), recording why it died.
 */
export interface SessionExitReason {
  /** Why the process exited, e.g. 'unhandled_rejection'. */
  reason: string;
  /** Severity marker the CLI recorded, e.g. 'fatal'. Absent when it recorded none. */
  kind?: string;
  /** CLI timestamp of the exit marker, when present in the transcript. */
  timestamp?: string;
}

/**
 * Derive the exit reason from a transcript tail.
 *
 * The LAST parseable JSON line decides: it must be a `session_exit`
 * custom entry, otherwise the transcript ends with normal activity and
 * there is no reason to report. A mid-write tail line (the writer is
 * mid-flush) is ignored, scanning backwards for the last complete line.
 */
export function sessionExitReasonFromTail(tail: string | null): SessionExitReason | null {
  if (!tail) return null;
  const lines = tail.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: unknown;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      // A mid-write tail line (the writer is mid-flush) — ignore and keep
      // scanning backwards for the last complete line.
      continue;
    }
    if (!entry || typeof entry !== 'object') return null;
    const e = entry as { type?: unknown; customType?: unknown; timestamp?: unknown; data?: { reason?: unknown; kind?: unknown } };
    if (e.type === 'custom' && e.customType === 'session_exit') {
      return {
        reason: String(e.data?.reason ?? 'unknown'),
        ...(e.data?.kind !== undefined ? { kind: String(e.data.kind) } : {}),
        ...(typeof e.timestamp === 'string' ? { timestamp: e.timestamp } : {}),
      };
    }
    // The last parseable line is ordinary activity, not a crash marker.
    return null;
  }
  return null;
}

/**
 * Convenience: read a transcript's tail and derive its exit reason in one
 * call. If the default 16KB window has no complete entry — the last entry
 * is larger than the window — retry with a larger bounded window so a big
 * final entry doesn't hide a trailing `session_exit`.
 */
export function readSessionExitReasonSync(filePath: string): SessionExitReason | null {
  const reason = sessionExitReasonFromTail(readTranscriptTailSync(filePath));
  if (reason !== null) return reason;
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    // File vanished between the tail read and now — nothing to report.
    return null;
  }
  if (size <= TAIL_READ_BYTES) return null;
  return sessionExitReasonFromTail(readTranscriptTailSync(filePath, MAX_STATUS_TAIL_BYTES));
}

/**
 * OMP (18.4+) prepends a `{"type":"title",...}` line before the session
 * header and rewrites it in place when the title changes, so the header is
 * not always line 1. Parse the JSON entries of the first few lines.
 */
function headEntries(window: string | null): Array<Record<string, any>> {
  if (!window) return [];
  const out: Array<Record<string, any>> = [];
  const lines = window.split('\n');
  for (let i = 0; i < lines.length && out.length < 4; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === 'object') out.push(entry);
    } catch { /* not JSON */ }
  }
  return out;
}

/**
 * Accepted shape for a transcript's session id. Pi and OMP emit a UUIDv7
 * (`01a007b0-07e5-7eb4-b41b-438d945f89f3`); the charset is deliberately
 * wider than a UUID so a future id format doesn't break resume, but it
 * excludes every character that could break out of an argv token on the
 * Windows cmd.exe spawn path (`"`, space, `&`, `|`, `%`, path separators).
 *
 * This is a trust boundary: the id parsed here becomes the session's
 * `cliSessionId`, later passed to `--session` / `--resume` and used to
 * build filename suffixes, so a transcript file is untrusted input.
 * Every other provider gates its discovered ids on a UUID shape
 * (claude-provider.ts, copilot-provider.ts); this is the Pi-lineage twin.
 */
export const COMPATIBLE_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Session header from a transcript head: {"type":"session","version":3,"id","timestamp","cwd"}. */
export function sessionHeaderFromWindow(window: string | null): CompatibleSessionHeader | null {
  for (const entry of headEntries(window)) {
    if (entry.type !== 'session') continue;
    // A session entry with a missing or malformed id is rejected outright
    // rather than adopted and handed downstream as resumable state.
    if (typeof entry.id === 'string' && COMPATIBLE_SESSION_ID_RE.test(entry.id)) {
      return entry as CompatibleSessionHeader;
    }
    return null;
  }
  return null;
}

export function readSessionHeaderSync(filePath: string): CompatibleSessionHeader | null {
  return sessionHeaderFromWindow(readHeaderWindowSync(filePath));
}

export async function readSessionHeaderAsync(filePath: string): Promise<CompatibleSessionHeader | null> {
  return sessionHeaderFromWindow(await readHeaderWindowAsync(filePath));
}

/**
 * The CLI's own session title from a transcript head: the `type:"title"`
 * entry (OMP) wins, falling back to the header's `title` field (OMP mirrors
 * it there). Null when the session has no title (e.g. every Pi transcript).
 */
export function transcriptTitleFromWindow(window: string | null): string | null {
  let headerTitle: string | null = null;
  for (const entry of headEntries(window)) {
    if (typeof entry.title !== 'string' || !entry.title.trim()) continue;
    if (entry.type === 'title') return entry.title.trim();
    if (entry.type === 'session' && headerTitle === null) headerTitle = entry.title.trim();
  }
  return headerTitle;
}

export function readTranscriptTitleSync(filePath: string): string | null {
  return transcriptTitleFromWindow(readHeaderWindowSync(filePath));
}

/**
 * Session header entry: {"type":"session","version":3,"id","timestamp","cwd"}.
 * OMP also mirrors the current title into `title`/`titleSource`.
 */
export interface CompatibleSessionHeader {
  type: string;
  id: string;
  cwd?: string;
  title?: string;
}

/**
 * Parameterized agent-dir / sessions-root helpers. The default agent dir is
 * fixed at construction (e.g. ~/.pi/agent vs ~/.omp/agent); a configDir
 * argument (profiles) relocates the whole tree.
 */
export function createCompatibleTranscriptModule(defaultAgentDir: string): {
  agentDir: (configDir?: string) => string;
  sessionsRoot: (configDir?: string) => string;
} {
  const agentDir = (configDir?: string): string => configDir ?? defaultAgentDir;
  const sessionsRoot = (configDir?: string): string => path.join(agentDir(configDir), 'sessions');
  return { agentDir, sessionsRoot };
}

// --- Shared provider transcript helpers (parameterized by sessions root) ---

const CASE_INSENSITIVE_PATHS = isWin || isMac;

/**
 * Directory identity for cwd comparison: trailing separators ignored, and
 * case folded on Windows/macOS, where the same directory can legitimately
 * be spelled with different case (drive letter, Finder-vs-CLI path).
 */
function sameCwd(a: string | undefined, b: string): boolean {
  if (typeof a !== 'string' || !a) return false;
  const strip = (p: string): string => {
    const trimmed = p.replace(/[\\/]+$/, '');
    return trimmed || p; // keep a filesystem root ('/' or 'C:\') intact
  };
  const x = strip(a);
  const y = strip(b);
  return CASE_INSENSITIVE_PATHS ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * Find one transcript by cli session id: match the id in the filename
 * first, then read only the header to confirm the cwd.
 *
 * The cwd match is AUTHORITATIVE — a cwd-mismatched file is never
 * returned. The old fallback handed back a transcript whose header `id`
 * matched but whose `cwd` belonged to a different project; the
 * transcript-sync caches whatever path this returns, so that fallback
 * mirrored the foreign project's title and working/completed/waiting
 * state into the requesting session and persisted the foreign title to
 * state.json. No cwd match reports nothing, which is the honest outcome.
 *
 * Matching is case-insensitive on Windows/macOS so a legitimate
 * drive-letter/case difference is not turned into a false negative by this
 * stricter rule.
 */
export function findTranscriptPathSync(
  sessionsRootOf: (configDir?: string) => string,
  cliSessionId: string,
  projectPath: string,
  configDir?: string
): string | null {
  try {
    const sessionsRoot = sessionsRootOf(configDir);
    if (!fs.existsSync(sessionsRoot)) return null;

    // Filenames are <ISO-timestamp>_<uuid>.jsonl — match the id in the
    // name first, then confirm the cwd from the header alone.
    const suffix = `_${cliSessionId}.jsonl`;
    for (const dir of fs.readdirSync(sessionsRoot)) {
      const dirPath = path.join(sessionsRoot, dir);
      let files: string[];
      try { files = fs.readdirSync(dirPath); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(suffix)) continue;
        const full = path.join(dirPath, f);
        const header = readSessionHeaderSync(full);
        if (!header || header.id !== cliSessionId) continue;
        if (sameCwd(header.cwd, projectPath)) return full;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Flat-layout twin of findTranscriptPathSync: per-launch session dirs
 * (see launch-session-dir.ts) hold transcripts directly, with no per-cwd
 * subdirs. Same authoritative cwd rule — a cwd-mismatched file is never
 * returned.
 */
export function findTranscriptPathInFlatDir(
  flatDir: string,
  cliSessionId: string,
  projectPath: string
): string | null {
  try {
    if (!fs.existsSync(flatDir)) return null;
    const suffix = `_${cliSessionId}.jsonl`;
    for (const f of fs.readdirSync(flatDir)) {
      if (!f.endsWith(suffix)) continue;
      const full = path.join(flatDir, f);
      const header = readSessionHeaderSync(full);
      if (!header || header.id !== cliSessionId) continue;
      if (sameCwd(header.cwd, projectPath)) return full;
    }
    return null;
  } catch {
    return null;
  }
}

/** Emit a descriptor per .jsonl in a sessions root, from the session header. */
export async function scanTranscriptSessionsRoot(
  sessionsRoot: string,
  profileId: string | undefined,
  signal?: AbortSignal
): Promise<TranscriptDescriptor[]> {
  let dirs: string[];
  try {
    dirs = await fs.promises.readdir(sessionsRoot);
  } catch {
    return [];
  }
  const out: TranscriptDescriptor[] = [];
  for (const dir of dirs) {
    if (signal?.aborted) return out;
    const dirPath = path.join(sessionsRoot, dir);
    let files: string[];
    try { files = await fs.promises.readdir(dirPath); } catch { continue; }
    // Header reads are independent, but one project dir can hold hundreds
    // of transcripts — cap the fan-out so a search never opens them all
    // at once.
    const descriptors = await mapWithConcurrency(
      files.filter((f) => f.endsWith('.jsonl')),
      TRANSCRIPT_IO_CONCURRENCY,
      async (f) => {
        if (signal?.aborted) return null;
        const transcriptPath = path.join(dirPath, f);
        const header = await readSessionHeaderAsync(transcriptPath);
        return header
          ? { cliSessionId: header.id, transcriptPath, projectCwd: header.cwd ?? '', profileId }
          : null;
      }
    );
    for (const d of descriptors) if (d) out.push(d);
  }
  return out;
}

/**
 * Flat-layout twin of scanTranscriptSessionsRoot: per-launch session dirs
 * (see launch-session-dir.ts) hold transcripts directly. One dir holds a
 * handful of files (one launch), so no concurrency cap is needed.
 */
export async function scanFlatSessionDir(
  flatDir: string,
  profileId: string | undefined,
  signal?: AbortSignal
): Promise<TranscriptDescriptor[]> {
  let files: string[];
  try {
    files = await fs.promises.readdir(flatDir);
  } catch {
    return [];
  }
  const out: TranscriptDescriptor[] = [];
  for (const f of files) {
    if (signal?.aborted) return out;
    if (!f.endsWith('.jsonl')) continue;
    const transcriptPath = path.join(flatDir, f);
    const header = await readSessionHeaderAsync(transcriptPath);
    if (header) out.push({ cliSessionId: header.id, transcriptPath, projectCwd: header.cwd ?? '', profileId });
  }
  return out;
}

/**
 * Index a Pi/OMP transcript for global search: user-typed text only,
 * capped at the per-session char budget.
 *
 * The read is byte-bounded and streamed. `readFile` + `split` put the
 * whole transcript in memory — plus a second full copy as the array of
 * lines — before the char budget could stop it, so capping the extracted
 * output was never a cap on bytes read. Here `stat` rejects an absurd
 * file before it is opened at all, and the read stream stops at
 * MAX_INDEX_BYTES, so only the head window is ever resident. The 50 KiB
 * char budget is reached far earlier, so nothing searchable is lost.
 */
export async function indexCompatibleTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
  let size: number;
  try {
    size = (await fs.promises.stat(transcriptPath)).size;
  } catch {
    return { text: '', cwd: '' };
  }
  if (size > MAX_INDEX_FILE_BYTES) return { text: '', cwd: '' };

  let cwd = '';
  const budget = new IndexTextBudget();

  const input = fs.createReadStream(transcriptPath, { end: MAX_INDEX_BYTES - 1 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let entry: { type?: string; cwd?: string; message?: { role?: string; content?: unknown } };
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type === 'session' && typeof entry.cwd === 'string') {
        cwd = entry.cwd;
        continue;
      }
      if (entry.type !== 'message') continue;
      if (budget.full) break;
      if (entry.message?.role !== 'user') continue;
      let text = '';
      const c = entry.message.content;
      if (typeof c === 'string') {
        text = c;
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
            && typeof (block as { text?: unknown }).text === 'string') {
            text += (block as { text: string }).text + '\n';
          }
        }
      }
      if (text) budget.push(text);
    }
  } catch {
    // Best-effort: keep whatever was extracted before the stream failed.
  } finally {
    lines.close();
    input.destroy();
  }
  return { text: budget.join(), cwd };
}

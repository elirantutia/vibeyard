import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CliProvider, TranscriptDescriptor } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { getGeminiConfig } from '../gemini-config';
import { installGeminiHooks, validateGeminiHooks, cleanupGeminiHooks, SESSION_ID_VAR } from '../gemini-hooks';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';
import { MAX_INDEX_FILE_BYTES, IndexTextBudget } from './transcript-utils';
import { writeAgentFile, deleteAgentFile } from './agent-files';
import type { BrowserWindow } from 'electron';

const binaryCache = { path: null as string | null };

/** Read at most `bytes` from the head of a file (bounded, sync). */
function readHeadSync(filePath: string, bytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf-8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Discovery reads only this much from the head of a session file to
 * extract the id. Gemini writes sessionId near the top; a file whose id
 * falls outside this window (odd field ordering) falls back to a full
 * read, which the caller has already bounded by MAX_INDEX_FILE_BYTES.
 */
const DISCOVERY_HEADER_BYTES = 64 * 1024;

const SESSION_ID_RE = /"sessionId"\s*:\s*"([0-9a-f-]+)"/i;

/** Extract the sessionId from a session file without reading the whole transcript. */
async function readSessionId(transcriptPath: string, size: number): Promise<string | null> {
  let raw: string;
  if (size <= DISCOVERY_HEADER_BYTES) {
    // Small file: the header window is the whole file, one read suffices.
    raw = await fs.promises.readFile(transcriptPath, 'utf-8');
  } else {
    const handle = await fs.promises.open(transcriptPath, 'r');
    try {
      const buffer = Buffer.alloc(DISCOVERY_HEADER_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      raw = buffer.toString('utf-8', 0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  const id = raw.match(SESSION_ID_RE)?.[1];
  if (id) return id;
  if (size <= DISCOVERY_HEADER_BYTES) return parseSessionId(raw);
  raw = await fs.promises.readFile(transcriptPath, 'utf-8');
  const full = raw.match(SESSION_ID_RE)?.[1];
  if (full) return full;
  return parseSessionId(raw);
}

function parseSessionId(raw: string): string | null {
  try {
    const parsed: { sessionId?: unknown } = JSON.parse(raw);
    return typeof parsed?.sessionId === 'string' ? parsed.sessionId : null;
  } catch {
    return null;
  }
}

export class GeminiProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'gemini',
    displayName: 'Gemini CLI',
    binaryName: 'gemini',
    capabilities: {
      sessionResume: true,
      costTracking: false,
      contextWindow: false,
      hookStatus: true,
      configReading: true,
      shiftEnterNewline: false,
      pendingPromptTrigger: 'startup-arg',
      planModeArg: '--approval-mode=plan',
      systemPromptInjection: false,
      profiles: false,
      selfTitles: false,
      polledStatus: false,
    },
    defaultContextWindowSize: 1_000_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('gemini', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('gemini');
  }

  buildEnv(sessionId: string, baseEnv: Record<string, string>, _opts?: { configDir?: string }): Record<string, string> {
    const env = { ...baseEnv };
    env[SESSION_ID_VAR] = sessionId;
    env.PATH = getFullPath();
    return env;
  }

  buildArgs(opts: { sessionId: string; cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string; systemPrompt?: string }): string[] {
    const args: string[] = [];
    if (opts.isResume && opts.cliSessionId) {
      args.push('-r', opts.cliSessionId);
    }
    if (opts.extraArgs) {
      args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    }
    if (opts.initialPrompt) {
      args.push('-i', opts.initialPrompt);
    }
    return args;
  }

  async installHooks(): Promise<void> {
    installGeminiHooks();
  }

  installStatusScripts(): void {}

  cleanup(): void {
    stopConfigWatch();
    cleanupGeminiHooks();
  }

  startConfigWatcher(win: BrowserWindow, projectPath: string): void {
    startConfigWatch(win, projectPath, 'gemini');
  }

  stopConfigWatcher(): void {
    stopConfigWatch();
  }

  async getConfig(projectPath: string): Promise<ProviderConfig> {
    return getGeminiConfig(projectPath);
  }

  getShiftEnterSequence(): string | null {
    return null;
  }

  validateSettings(): SettingsValidationResult {
    return validateGeminiHooks();
  }

  reinstallSettings(): void {
    installGeminiHooks();
  }

  agentsDir(): string {
    return path.join(os.homedir(), '.gemini', 'agents');
  }

  async installAgent(slug: string, content: string): Promise<{ filePath: string }> {
    return writeAgentFile(this.agentsDir(), slug, content);
  }

  async removeAgent(slug: string): Promise<void> {
    return deleteAgentFile(this.agentsDir(), slug);
  }

  getTranscriptPath(cliSessionId: string, projectPath: string): string | null {
    try {
      const tmpRoot = path.join(os.homedir(), '.gemini', 'tmp');
      if (!fs.existsSync(tmpRoot)) return null;

      // Find the project key dir whose .project_root matches our projectPath
      let chatsDir: string | null = null;
      for (const entry of fs.readdirSync(tmpRoot)) {
        const projectRootFile = path.join(tmpRoot, entry, '.project_root');
        try {
          const contents = fs.readFileSync(projectRootFile, 'utf-8').trim();
          if (contents === projectPath) {
            chatsDir = path.join(tmpRoot, entry, 'chats');
            break;
          }
        } catch {
          // missing or unreadable .project_root — skip
        }
      }
      if (!chatsDir || !fs.existsSync(chatsDir)) return null;

      // Filenames only encode the first 8 chars of the id (session-<ts>-<shortId>.json),
      // so an 8-char prefix can collide. Prefer matching the full sessionId recorded
      // inside the file; fall back to newest-mtime if we can't read any JSON.
      const shortId = cliSessionId.slice(0, 8);
      const suffix = `-${shortId}.json`;
      const candidates = fs.readdirSync(chatsDir)
        .filter((f) => f.startsWith('session-') && f.endsWith(suffix))
        .map((f) => {
          const full = path.join(chatsDir!, f);
          let mtime = 0;
          try { mtime = fs.statSync(full).mtimeMs; } catch {}
          return { full, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);

      for (const c of candidates) {
        try {
          // Gemini transcripts are JSON; session id typically appears near the top.
          // Read only a bounded head (cheap substring check avoids a full parse
          // and keeps this sync interface from blocking on a whole file).
          const raw = readHeadSync(c.full, 8 * 1024);
          if (raw.includes(cliSessionId)) return c.full;
        } catch {
          // unreadable — skip
        }
      }
      return candidates[0]?.full ?? null;
    } catch {
      return null;
    }
  }

  async discoverTranscripts(signal?: AbortSignal): Promise<TranscriptDescriptor[]> {
    const tmpRoot = path.join(os.homedir(), '.gemini', 'tmp');
    let keys: string[];
    try {
      keys = await fs.promises.readdir(tmpRoot);
    } catch {
      return [];
    }
    const out: TranscriptDescriptor[] = [];
    for (const key of keys) {
      if (signal?.aborted) return out;
      const projectDir = path.join(tmpRoot, key);
      let projectCwd = '';
      try {
        projectCwd = (await fs.promises.readFile(path.join(projectDir, '.project_root'), 'utf-8')).trim();
      } catch {
        continue;
      }
      const chatsDir = path.join(projectDir, 'chats');
      let files: string[];
      try {
        files = await fs.promises.readdir(chatsDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (signal?.aborted) return out;
        if (!file.startsWith('session-') || !file.endsWith('.json')) continue;
        const transcriptPath = path.join(chatsDir, file);
        // The indexer indexes files above MAX_INDEX_FILE_BYTES to empty text,
        // so skip them here too — reading a whole oversized transcript just
        // to extract its id would pay for content search can never use.
        let size: number;
        try {
          size = (await fs.promises.stat(transcriptPath)).size;
        } catch {
          continue;
        }
        if (size > MAX_INDEX_FILE_BYTES) continue;
        let cliSessionId: string | null = null;
        try {
          cliSessionId = await readSessionId(transcriptPath, size);
        } catch {
          continue;
        }
        if (!cliSessionId) continue;
        out.push({ cliSessionId, transcriptPath, projectCwd, projectSlug: key });
      }
    }
    return out;
  }

  async indexTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
    let size: number;
    try {
      size = (await fs.promises.stat(transcriptPath)).size;
    } catch {
      return { text: '', cwd: '' };
    }
    if (size > MAX_INDEX_FILE_BYTES) return { text: '', cwd: '' };
    let parsed: { messages?: Array<{ type?: string; content?: unknown }> };
    try {
      parsed = JSON.parse(await fs.promises.readFile(transcriptPath, 'utf-8'));
    } catch {
      return { text: '', cwd: '' };
    }
    const budget = new IndexTextBudget();
    for (const msg of parsed.messages ?? []) {
      if (budget.full) break;
      if (msg?.type !== 'user') continue;
      let text = '';
      const c = msg.content;
      if (typeof c === 'string') {
        text = c;
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (block && typeof (block as { text?: unknown }).text === 'string') {
            text += (block as { text: string }).text + '\n';
          }
        }
      }
      if (text) budget.push(text);
    }
    return { text: budget.join(), cwd: '' };
  }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

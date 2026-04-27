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
import { MAX_INDEX_CHARS_PER_SESSION, TRANSCRIPT_TEXT_SEPARATOR } from './transcript-utils';
import type { BrowserWindow } from 'electron';

const binaryCache = { path: null as string | null };

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
    },
    defaultContextWindowSize: 1_000_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('gemini', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('gemini');
  }

  buildEnv(sessionId: string, baseEnv: Record<string, string>): Record<string, string> {
    const env = { ...baseEnv };
    env[SESSION_ID_VAR] = sessionId;
    env.PATH = getFullPath();
    return env;
  }

  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string }): string[] {
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
          const raw = fs.readFileSync(c.full, 'utf-8');
          // Gemini transcripts are JSON; session id typically appears near the top.
          // Cheap substring check avoids a full parse.
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

  async discoverTranscripts(): Promise<TranscriptDescriptor[]> {
    const tmpRoot = path.join(os.homedir(), '.gemini', 'tmp');
    let keys: string[];
    try {
      keys = await fs.promises.readdir(tmpRoot);
    } catch {
      return [];
    }
    const out: TranscriptDescriptor[] = [];
    for (const key of keys) {
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
        if (!file.startsWith('session-') || !file.endsWith('.json')) continue;
        const transcriptPath = path.join(chatsDir, file);
        // The full sessionId lives inside the JSON; the filename only encodes the first 8 chars.
        let cliSessionId: string | null = null;
        try {
          const raw = await fs.promises.readFile(transcriptPath, 'utf-8');
          const m = raw.match(/"sessionId"\s*:\s*"([0-9a-f-]+)"/i);
          if (m) cliSessionId = m[1];
          else cliSessionId = JSON.parse(raw)?.sessionId ?? null;
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
    let parsed: { messages?: Array<{ type?: string; content?: unknown }> };
    try {
      parsed = JSON.parse(await fs.promises.readFile(transcriptPath, 'utf-8'));
    } catch {
      return { text: '', cwd: '' };
    }
    const texts: string[] = [];
    let totalChars = 0;
    for (const msg of parsed.messages ?? []) {
      if (totalChars >= MAX_INDEX_CHARS_PER_SESSION) break;
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
      if (text) {
        texts.push(text.trim());
        totalChars += text.length;
      }
    }
    return { text: texts.join(TRANSCRIPT_TEXT_SEPARATOR), cwd: '' };
  }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

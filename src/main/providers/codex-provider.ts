import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CliProvider, TranscriptDescriptor } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { getCodexConfig } from '../codex-config';
import { installCodexHooks, validateCodexHooks, cleanupCodexHooks, SESSION_ID_VAR } from '../codex-hooks';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';
import { MAX_INDEX_CHARS_PER_SESSION, TRANSCRIPT_TEXT_SEPARATOR } from './transcript-utils';
import type { BrowserWindow } from 'electron';

const CODEX_FILE_RE = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

const binaryCache = { path: null as string | null };

export class CodexProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'codex',
    displayName: 'Codex CLI',
    binaryName: 'codex',
    capabilities: {
      sessionResume: true,
      costTracking: false,
      contextWindow: false,
      hookStatus: true,
      configReading: true,
      shiftEnterNewline: false,
      pendingPromptTrigger: 'startup-arg',
    },
    defaultContextWindowSize: 200_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('codex', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('codex');
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
      args.push('resume', opts.cliSessionId);
    } else if (opts.initialPrompt) {
      args.push(opts.initialPrompt);
    }
    if (opts.extraArgs) {
      args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    }
    return args;
  }

  async installHooks(): Promise<void> {
    installCodexHooks();
  }

  installStatusScripts(): void {}

  cleanup(): void {
    stopConfigWatch();
    cleanupCodexHooks();
  }

  startConfigWatcher(win: BrowserWindow, projectPath: string): void {
    startConfigWatch(win, projectPath, 'codex');
  }

  stopConfigWatcher(): void {
    stopConfigWatch();
  }

  async getConfig(projectPath: string): Promise<ProviderConfig> {
    return getCodexConfig(projectPath);
  }

  getShiftEnterSequence(): string | null {
    return null;
  }

  validateSettings(): SettingsValidationResult {
    return validateCodexHooks();
  }

  reinstallSettings(): void {
    installCodexHooks();
  }

  getTranscriptPath(cliSessionId: string, _projectPath: string): string | null {
    try {
      const root = path.join(os.homedir(), '.codex', 'sessions');
      const suffix = `-${cliSessionId}.jsonl`;
      // sessions are partitioned as YYYY/MM/DD/rollout-<ts>-<id>.jsonl.
      // Walk newest-first and return on first match.
      for (const year of descSortedReaddir(root)) {
        const yearDir = path.join(root, year);
        for (const month of descSortedReaddir(yearDir)) {
          const monthDir = path.join(yearDir, month);
          for (const day of descSortedReaddir(monthDir)) {
            const dayDir = path.join(monthDir, day);
            for (const file of descSortedReaddir(dayDir)) {
              if (file.endsWith(suffix)) return path.join(dayDir, file);
            }
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async discoverTranscripts(): Promise<TranscriptDescriptor[]> {
    const root = path.join(os.homedir(), '.codex', 'sessions');
    const out: TranscriptDescriptor[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (depth === 3) {
        for (const entry of entries) {
          const m = entry.name.match(CODEX_FILE_RE);
          if (!m) continue;
          out.push({ cliSessionId: m[1], transcriptPath: path.join(dir, entry.name) });
        }
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), depth + 1);
      }
    };
    await walk(root, 0);
    return out;
  }

  async indexTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
    const content = await fs.promises.readFile(transcriptPath, 'utf8');
    const texts: string[] = [];
    let cwd = '';
    let totalChars = 0;
    for (const line of content.split('\n')) {
      if (!line.trim() || totalChars >= MAX_INDEX_CHARS_PER_SESSION) continue;
      try {
        const entry = JSON.parse(line);
        if (!cwd && entry.type === 'session_meta' && entry.payload?.cwd) cwd = entry.payload.cwd;
        if (entry.type !== 'response_item') continue;
        const p = entry.payload;
        if (!p || p.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) continue;
        let text = '';
        for (const block of p.content) {
          if (block && typeof block.text === 'string') text += block.text + '\n';
        }
        if (text) {
          texts.push(text.trim());
          totalChars += text.length;
        }
      } catch {
        // partial-write tolerance
      }
    }
    return { text: texts.join(TRANSCRIPT_TEXT_SEPARATOR), cwd };
  }
}

function descSortedReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir).sort().reverse(); } catch { return []; }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

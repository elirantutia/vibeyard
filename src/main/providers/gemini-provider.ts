import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { getGeminiConfig } from '../gemini-config';
import { installGeminiHooks, validateGeminiHooks, cleanupGeminiHooks, SESSION_ID_VAR } from '../gemini-hooks';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';
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

  validatePrerequisites(): { ok: boolean; message: string } {
    return validateBinaryExists('gemini', 'Gemini CLI', 'npm install -g @google/gemini-cli');
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
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

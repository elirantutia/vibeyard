import * as fs from 'fs';
import * as path from 'path';
import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { getCodexConfig } from '../codex-config';
import { getEffectiveCliUserHome } from '../claude-cli';
import { installCodexHooks, validateCodexHooks, cleanupCodexHooks, SESSION_ID_VAR } from '../codex-hooks';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';
import type { BrowserWindow } from 'electron';

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

  validatePrerequisites(): { ok: boolean; message: string } {
    return validateBinaryExists('codex', 'Codex CLI', 'npm install -g @openai/codex');
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
      const root = path.join(getEffectiveCliUserHome(), '.codex', 'sessions');
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
}

function descSortedReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir).sort().reverse(); } catch { return []; }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

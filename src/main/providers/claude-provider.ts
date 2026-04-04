import type { BrowserWindow } from 'electron';
import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { installStatusLineScript, cleanupAll as cleanupHookStatus } from '../hook-status';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';
import { installHooksOnly, installStatusLine, getClaudeConfig } from '../claude-cli';
import { guardedInstall, validateSettings, reinstallSettings } from '../settings-guard';
import { resolveBinary, validateBinaryExists } from './resolve-binary';

const binaryCache = { path: null as string | null };

export class ClaudeProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'claude',
    displayName: 'Claude Code',
    binaryName: 'claude',
    capabilities: {
      sessionResume: true,
      costTracking: true,
      contextWindow: true,
      hookStatus: true,
      configReading: true,
      shiftEnterNewline: true,
      pendingPromptTrigger: 'startup-arg',
      planModeArg: '--permission-mode plan',
    },
    defaultContextWindowSize: 200_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('claude', binaryCache);
  }

  validatePrerequisites(): { ok: boolean; message: string } {
    return validateBinaryExists('claude', 'Claude Code CLI', 'npm install -g @anthropic-ai/claude-code');
  }

  buildEnv(sessionId: string, baseEnv: Record<string, string>): Record<string, string> {
    const env = { ...baseEnv };
    delete env.CLAUDE_CODE; // avoid subprocess detection conflicts
    env.CLAUDE_IDE_SESSION_ID = sessionId;
    env.PATH = getFullPath();
    return env;
  }

  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string }): string[] {
    const args: string[] = [];
    if (opts.cliSessionId) {
      if (opts.isResume) {
        args.push('-r', opts.cliSessionId);
      } else {
        args.push('--session-id', opts.cliSessionId);
      }
    }
    if (opts.initialPrompt) {
      args.push(opts.initialPrompt);
    }
    if (opts.extraArgs) {
      args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    }
    return args;
  }

  async installHooks(win?: BrowserWindow | null): Promise<void> {
    await guardedInstall(win ?? null);
  }

  installStatusScripts(): void {
    installStatusLineScript();
  }

  cleanup(): void {
    stopConfigWatch();
    cleanupHookStatus();
  }

  startConfigWatcher(win: BrowserWindow, projectPath: string): void {
    startConfigWatch(win, projectPath, 'claude');
  }

  stopConfigWatcher(): void {
    stopConfigWatch();
  }

  async getConfig(projectPath: string): Promise<ProviderConfig> {
    return getClaudeConfig(projectPath);
  }

  validateSettings(): SettingsValidationResult {
    return validateSettings();
  }

  reinstallSettings(): void {
    reinstallSettings();
    installStatusLineScript();
  }

  getShiftEnterSequence(): string | null {
    return '\x1b[13;2u';
  }

  parseCostFromOutput(rawText: string): { totalCostUsd: number } | null {
    const COST_RE = /\$(\d+\.\d{2,})/g;
    let match: RegExpExecArray | null;
    let lastCost: string | null = null;
    while ((match = COST_RE.exec(rawText)) !== null) {
      lastCost = match[0];
    }
    if (lastCost) {
      return { totalCostUsd: parseFloat(lastCost.replace('$', '')) };
    }
    return null;
  }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

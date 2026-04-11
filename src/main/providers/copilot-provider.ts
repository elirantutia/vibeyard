import type { BrowserWindow } from 'electron';
import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { getCopilotConfig } from '../copilot-config';
import { installCopilotHooks, validateCopilotHooks, cleanupCopilotHooks, SESSION_ID_VAR } from '../copilot-hooks';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';

const binaryCache = { path: null as string | null };

export class CopilotProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    binaryName: 'copilot',
    capabilities: {
      sessionResume: true,
      costTracking: false,
      contextWindow: false,
      hookStatus: true,
      configReading: true,
      shiftEnterNewline: false,
      pendingPromptTrigger: 'startup-arg',
      planModeArg: '--mode plan',
    },
    defaultContextWindowSize: 128_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('copilot', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('copilot');
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
      args.push(`--resume=${opts.cliSessionId}`);
    } else if (opts.initialPrompt) {
      args.push('-i', opts.initialPrompt);
    }
    if (opts.extraArgs) {
      args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    }
    return args;
  }

  async installHooks(_win?: BrowserWindow | null, projectPath?: string): Promise<void> {
    installCopilotHooks(projectPath);
  }

  installStatusScripts(): void {}

  cleanup(): void {
    stopConfigWatch();
    cleanupCopilotHooks();
  }

  startConfigWatcher(win: BrowserWindow, projectPath: string): void {
    startConfigWatch(win, projectPath, 'copilot');
  }

  stopConfigWatcher(): void {
    stopConfigWatch();
  }

  async getConfig(projectPath: string): Promise<ProviderConfig> {
    return Promise.resolve(getCopilotConfig(projectPath));
  }

  getShiftEnterSequence(): string | null {
    return null;
  }

  validateSettings(): SettingsValidationResult {
    return validateCopilotHooks();
  }

  reinstallSettings(): void {
    installCopilotHooks();
  }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

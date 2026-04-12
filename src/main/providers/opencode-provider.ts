import type { BrowserWindow } from 'electron';
import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { getOpenCodeConfig } from '../opencode-config';
import { installOpenCodeHooks, validateOpenCodeHooks, cleanupOpenCodeHooks, SESSION_ID_VAR } from '../opencode-hooks';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';

const binaryCache = { path: null as string | null };

export class OpenCodeProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'opencode',
    displayName: 'OpenCode',
    binaryName: 'opencode',
    capabilities: {
      sessionResume: true,
      costTracking: false,
      contextWindow: false,
      hookStatus: true,
      configReading: true,
      shiftEnterNewline: false,
      pendingPromptTrigger: 'startup-arg',
      planModeArg: '--agent plan',
    },
    defaultContextWindowSize: 200_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('opencode', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('opencode');
  }

  buildEnv(sessionId: string, baseEnv: Record<string, string>): Record<string, string> {
    const env = { ...baseEnv };
    env[SESSION_ID_VAR] = sessionId;
    env.OPENCODE_CLIENT = 'vibeyard';
    env.PATH = getFullPath();
    return env;
  }

  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string }): string[] {
    const args: string[] = [];
    if (opts.isResume && opts.cliSessionId) {
      args.push('--session', opts.cliSessionId);
    } else if (opts.initialPrompt) {
      args.push('--prompt', opts.initialPrompt);
    }
    if (opts.extraArgs) {
      args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    }
    return args;
  }

  async installHooks(_win?: BrowserWindow | null, projectPath?: string): Promise<void> {
    installOpenCodeHooks(projectPath);
  }

  installStatusScripts(): void {}

  cleanup(): void {
    stopConfigWatch();
    cleanupOpenCodeHooks();
  }

  startConfigWatcher(win: BrowserWindow, projectPath: string): void {
    startConfigWatch(win, projectPath, 'opencode');
  }

  stopConfigWatcher(): void {
    stopConfigWatch();
  }

  async getConfig(projectPath: string): Promise<ProviderConfig> {
    return getOpenCodeConfig(projectPath);
  }

  getShiftEnterSequence(): string | null {
    return null;
  }

  validateSettings(projectPath?: string): SettingsValidationResult {
    return validateOpenCodeHooks(projectPath);
  }

  reinstallSettings(): void {
    installOpenCodeHooks();
  }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

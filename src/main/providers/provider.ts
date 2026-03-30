import type { BrowserWindow } from 'electron';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';

export interface CliProvider {
  readonly meta: CliProviderMeta;
  resolveBinaryPath(): string;
  validatePrerequisites(): { ok: boolean; message: string };
  buildEnv(sessionId: string, baseEnv: Record<string, string>): Record<string, string>;
  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string }): string[];
  installHooks(win?: BrowserWindow | null): Promise<void>;
  installStatusScripts(): void;
  cleanup(): void;
  getConfig(projectPath: string): Promise<ProviderConfig>;
  getShiftEnterSequence(): string | null;
  validateSettings(): SettingsValidationResult;
  reinstallSettings(): void;
  parseCostFromOutput?(rawText: string): { totalCostUsd: number } | null;
  startConfigWatcher?(win: BrowserWindow, projectPath: string): void;
  stopConfigWatcher?(): void;
}

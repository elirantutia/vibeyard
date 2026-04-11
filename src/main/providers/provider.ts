import type { BrowserWindow } from 'electron';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';

export interface CliProvider {
  readonly meta: CliProviderMeta;
  resolveBinaryPath(): string;
  validatePrerequisites(): boolean;
  buildEnv(sessionId: string, baseEnv: Record<string, string>): Record<string, string>;
  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string }): string[];
  installHooks(win?: BrowserWindow | null, projectPath?: string): Promise<void>;
  installStatusScripts(): void;
  cleanup(): void;
  getConfig(projectPath: string): Promise<ProviderConfig>;
  getShiftEnterSequence(): string | null;
  validateSettings(): SettingsValidationResult;
  reinstallSettings(): void;
  parseCostFromOutput?(rawText: string): { totalCostUsd: number } | null;
  /** Return the absolute path to the source transcript file for a prior session, if any. */
  getTranscriptPath?(cliSessionId: string, projectPath: string): string | null;
  startConfigWatcher?(win: BrowserWindow, projectPath: string): void;
  stopConfigWatcher?(): void;
}

import type { BrowserWindow } from 'electron';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';

/** Lightweight pointer to one on-disk transcript, used by global session search. */
export interface TranscriptDescriptor {
  cliSessionId: string;
  /** Absolute path used as the cache key and mtime source for indexing. */
  transcriptPath: string;
  /** Pre-computed cwd, when the format makes it cheap (e.g. read from a sidecar). */
  projectCwd?: string;
  /** Provider-specific project key (Claude slug, Gemini project hash, etc.). Display fallback. */
  projectSlug?: string;
  /** Profile whose config dir this transcript was found under, so resume can reuse it. */
  profileId?: string;
}

export interface CliProvider {
  readonly meta: CliProviderMeta;
  resolveBinaryPath(): string;
  validatePrerequisites(): boolean;
  buildEnv(sessionId: string, baseEnv: Record<string, string>, opts?: { configDir?: string }): Record<string, string>;
  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string; systemPrompt?: string }): string[];
  installHooks(win?: BrowserWindow | null, projectPath?: string): Promise<void>;
  installStatusScripts(): void;
  cleanup(): void;
  getConfig(projectPath: string): Promise<ProviderConfig>;
  getShiftEnterSequence(): string | null;
  validateSettings(projectPath?: string, configDir?: string): SettingsValidationResult;
  reinstallSettings(): void;
  parseCostFromOutput?(rawText: string): { totalCostUsd: number } | null;
  /** Return the absolute path to the source transcript file for a prior session, if any. */
  getTranscriptPath?(cliSessionId: string, projectPath: string, configDir?: string): string | null;
  /** Cheap enumeration of every on-disk transcript for global session search. */
  discoverTranscripts?(): Promise<TranscriptDescriptor[]>;
  /** Read user-visible text (and optionally the cwd) out of one transcript file. */
  indexTranscript?(transcriptPath: string): Promise<{ text: string; cwd: string }>;
  startConfigWatcher?(win: BrowserWindow, projectPath: string): void;
  stopConfigWatcher?(): void;
  /** Absolute path to the user-global agents directory (e.g. ~/.claude/agents). */
  agentsDir?(): string;
  /** Write `<slug>.md` into the agents dir with the given markdown content. */
  installAgent?(slug: string, content: string): Promise<{ filePath: string }>;
  /** Remove `<slug>.md` from the agents dir. Best-effort: missing file is not an error. */
  removeAgent?(slug: string): Promise<void>;
}

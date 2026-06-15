import type { CliProvider } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';

const binaryCache = { path: null as string | null };

/**
 * Google Antigravity CLI (`agy`, the successor to Gemini CLI).
 *
 * MVP integration: launches an interactive `agy` session and supports an
 * initial prompt. Advanced capabilities (resume, cost, context window, config
 * reading, hooks/status line, agent install, transcript search) are OFF and
 * deferred — they depend on Antigravity's on-disk layout, which isn't documented.
 * The binary name and flags below are confirmed against `agy --help`.
 */
export class AntigravityProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'antigravity',
    displayName: 'Antigravity CLI',
    binaryName: 'agy', // confirmed via `agy --help` (agy.exe on Windows)
    capabilities: {
      // DEFERRED: `agy` resumes by id (`--conversation <id>`), but exposes no way to pin/capture
      // the conversation id at start, and `-c`/`--continue` only continues the global most-recent
      // conversation (unsafe across multiple Vibeyard sessions). Needs hook/transcript work first.
      sessionResume: false,
      costTracking: false,
      contextWindow: false,
      hookStatus: false,
      configReading: false,
      shiftEnterNewline: false,
      pendingPromptTrigger: 'startup-arg',
      systemPromptInjection: false, // confirmed: `agy` has no system-prompt flag (matches Copilot/Gemini)
    },
    defaultContextWindowSize: 1_000_000, // Gemini-3-class context (assumption)
  };

  resolveBinaryPath(): string {
    return resolveBinary('agy', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('agy');
  }

  buildEnv(_sessionId: string, baseEnv: Record<string, string>, _opts?: { configDir?: string }): Record<string, string> {
    // Ensure `agy` and its dependencies resolve inside the PTY.
    return { ...baseEnv, PATH: getFullPath() };
  }

  buildArgs(opts: { cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string; systemPrompt?: string }): string[] {
    const args: string[] = [];
    // extraArgs first so user-supplied flags can precede the prompt.
    if (opts.extraArgs) {
      args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    }
    // `-i` / `--prompt-interactive`: run an initial prompt, then continue interactively (per `agy --help`).
    if (opts.initialPrompt) {
      args.push('-i', opts.initialPrompt);
    }
    // No resume branch in v1 (sessionResume capability is off) and no system-prompt flag.
    return args;
  }

  async installHooks(): Promise<void> {}

  installStatusScripts(): void {}

  cleanup(): void {}

  async getConfig(_projectPath: string): Promise<ProviderConfig> {
    return { mcpServers: [], agents: [], skills: [], commands: [] };
  }

  getShiftEnterSequence(): string | null {
    return null;
  }

  validateSettings(): SettingsValidationResult {
    return { statusLine: 'missing', hooks: 'missing', hookDetails: {} };
  }

  reinstallSettings(): void {}
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

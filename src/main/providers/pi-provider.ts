import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import type { CliProvider, TranscriptDescriptor } from './provider';
import type { CliProviderMeta, CliSessionStatus, McpServer, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { removeEnvKey } from '../../shared/env-vars';
import { tokenizeArgs } from '../../shared/launch-args';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { collectProfileRoots } from './transcript-utils';
import { piAgentDir, piSessionsRoot } from './pi-transcripts';
import { findTranscriptPathSync, findTranscriptPathInFlatDir, scanTranscriptSessionsRoot, scanFlatSessionDir, indexCompatibleTranscript, readTranscriptStatusSync, readSessionExitReasonSync } from './pi-compatible-transcripts';
import type { SessionExitReason } from './pi-compatible-transcripts';
import { startPiSessionWatcher, registerPendingPiSession, unregisterPiSession, stopPiSessionWatcher } from '../pi-session-watcher';
import { launchSessionDir, launchSessionBaseDir, ensureLaunchSessionDir, writeLaunchSessionMeta, readLaunchSessionMeta, listLaunchSessionDirs, profileIdForConfigDir } from '../launch-session-dir';

const binaryCache = { path: null as string | null };

/**
 * Per-launch identity, established by onSessionStarted/onSessionResumed
 * BEFORE spawnPty runs (the pty:create handler calls the hook first):
 *  - sessionDir: the exclusive `--session-dir` for this launch.
 *  - knownCliId: Pi's fresh launches pin a Vibeyard-generated id via
 *    `--session-id`, so the transcript id is known before the first write;
 *    resumes carry the id they were resumed with.
 *  - resumeTarget: the transcript to resume — the resolved path when the
 *    file is still on disk (Pi appends to it in place), else the bare id
 *    (Pi then fails with a clear "no session found" message).
 */
interface PiLaunchState {
  sessionDir: string;
  knownCliId: string | null;
  resumeTarget: string | null;
}

const launchStates = new Map<string, PiLaunchState>();
export class PiProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'pi',
    displayName: 'Pi',
    binaryName: 'pi',
    capabilities: {
      sessionResume: true,
      costTracking: false,
      contextWindow: false,
      hookStatus: false,
      configReading: true,
      shiftEnterNewline: false,
      pendingPromptTrigger: 'startup-arg',
      systemPromptInjection: true,
      profiles: true,
      selfTitles: false,
      polledStatus: true,
    },
    defaultContextWindowSize: 200_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('pi', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('pi');
  }

  buildEnv(_sessionId: string, baseEnv: Record<string, string>, opts?: { configDir?: string }): Record<string, string> {
    const env = { ...baseEnv };
    env.PATH = getFullPath();
    // Strip inherited profile/storage selectors case-insensitively so the
    // pinned profile (below) is the single effective identity: a native
    // profile or relocated dir in the user's global environment must not
    // silently repoint the child away from the tree Vibeyard tracks.
    removeEnvKey(env, 'PI_CODING_AGENT_DIR');
    removeEnvKey(env, 'PI_CONFIG_DIR');
    removeEnvKey(env, 'PI_PROFILE');
    removeEnvKey(env, 'PI_CODING_AGENT_SESSION_DIR');
    if (opts?.configDir) {
      // Pi's equivalent of CLAUDE_CONFIG_DIR — relocates the whole agent dir.
      env.PI_CODING_AGENT_DIR = opts.configDir;
    }
    return env;
  }

  buildArgs(opts: { sessionId: string; cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string; systemPrompt?: string }): string[] {
    const args: string[] = [];
    // Every launch stores its transcripts in its own dir — the
    // process-scoped ownership signal the sessions watcher adopts by.
    const state = launchStates.get(opts.sessionId);
    const sessionDir = state?.sessionDir ?? launchSessionDir('pi', opts.sessionId);
    args.push('--session-dir', sessionDir);
    if (opts.isResume && opts.cliSessionId) {
      // Resume the exact transcript: the resolved path when it is still on
      // disk (Pi appends to it in place), else the bare id.
      args.push('--session', state?.resumeTarget ?? opts.cliSessionId);
    } else if (!opts.isResume) {
      // Fresh launch: pin the Vibeyard-generated id so the transcript is
      // attributable before its first write.
      const knownCliId = state?.knownCliId;
      if (knownCliId) args.push('--session-id', knownCliId);
    }
    if (opts.extraArgs) {
      args.push(...tokenizeArgs(opts.extraArgs));
    }
    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt);
    }
    if (opts.initialPrompt) {
      // Pi takes the initial prompt as a positional message arg.
      args.push(opts.initialPrompt);
    }
    return args;
  }

  // Pi has no hook system — nothing to install or tear down.
  async installHooks(): Promise<void> {}

  installStatusScripts(): void {}

  cleanup(): void {
    stopPiSessionWatcher();
    launchStates.clear();
  }

  reinstallSettings(): void {}

  async getConfig(_projectPath: string, configDir?: string): Promise<ProviderConfig> {
    const empty: ProviderConfig = { mcpServers: [], agents: [], skills: [], commands: [] };
    // Pi's settings.json only carries display prefs (theme, quietStartup, …);
    // its MCP servers live in mcp.json — the only config the ProviderConfig
    // shape can surface. Read it from the pinned profile's own agent tree:
    // falling back to the default dir for a profiled project would surface a
    // different login's servers, tokens included.
    const mcpPath = path.join(configDir ? path.resolve(configDir) : piAgentDir(), 'mcp.json');
    try {
      const raw = JSON.parse(await fs.promises.readFile(mcpPath, 'utf-8'));
      const servers = raw?.mcpServers;
      if (!servers || typeof servers !== 'object') return empty;
      const mcpServers: McpServer[] = Object
        .entries(servers as Record<string, unknown>)
        // A null/malformed entry must not throw and wipe the valid ones.
        .filter(([, cfg]) => typeof cfg === 'string' || (cfg !== null && typeof cfg === 'object'))
        .map(([name, cfg]) => ({
          name,
          url: serverUrl(cfg),
          status: 'configured',
          scope: 'user',
          filePath: mcpPath,
        }));
      return { ...empty, mcpServers };
    } catch {
      return empty;
    }
  }

  getShiftEnterSequence(): string | null {
    return null;
  }

  validateSettings(): SettingsValidationResult {
    // Nothing to validate — Pi has no hooks or status line.
    return { statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} };
  }

  // Pi has no hook system to report the session id. A fresh launch pins a
  // Vibeyard-generated id (`--session-id`) into its exclusive `--session-dir`
  // before spawn, so the id is known up front and the watcher adopts the
  // file carrying exactly that id — no cwd/time inference.
  onSessionStarted(sessionId: string, cwd: string, _win: BrowserWindow, configDir?: string): void {
    const sessionDir = launchSessionDir('pi', sessionId);
    ensureLaunchSessionDir(sessionDir);
    const knownCliId = randomUUID();
    launchStates.set(sessionId, { sessionDir, knownCliId, resumeTarget: null });
    writeLaunchSessionMeta(sessionDir, { providerId: 'pi', cwd, configDir, createdAt: new Date().toISOString() });
    startPiSessionWatcher();
    registerPendingPiSession(sessionId, cwd, configDir, { sessionDir, knownCliId });
  }

  // A resumed session already knows its cli id, so it is seeded as an
  // ADOPTED entry (known id + its existing transcript path) — never as an
  // unidentified pending entry. That is what lets a later `/clear` — a
  // brand-new transcript under a new id in the launch's own dir — be
  // re-adopted instead of the tab freezing on the pre-clear file.
  onSessionResumed(sessionId: string, cwd: string, _win: BrowserWindow, configDir: string | undefined, cliSessionId: string): void {
    const sessionDir = launchSessionDir('pi', sessionId);
    ensureLaunchSessionDir(sessionDir);
    // Legacy transcripts live in the default/profile trees; a post-`/clear`
    // one lives in a previous launch's dir. Resolve before seeding.
    const adoptedFile = this.getTranscriptPath(cliSessionId, cwd, configDir, sessionDir);
    launchStates.set(sessionId, { sessionDir, knownCliId: cliSessionId, resumeTarget: adoptedFile ?? cliSessionId });
    writeLaunchSessionMeta(sessionDir, { providerId: 'pi', cwd, configDir, createdAt: new Date().toISOString() });
    startPiSessionWatcher();
    registerPendingPiSession(sessionId, cwd, configDir, { sessionDir, knownCliId: cliSessionId, adoptedFile: adoptedFile ?? undefined });
  }

  onSessionExited(sessionId: string): void {
    launchStates.delete(sessionId);
    unregisterPiSession(sessionId);
  }
  getTranscriptPath(cliSessionId: string, projectPath: string, configDir?: string, sessionDir?: string): string | null {
    // The launch's own dir first (post-`/clear` transcripts live there),
    // then the legacy default/profile trees.
    if (sessionDir) {
      const inDir = findTranscriptPathInFlatDir(sessionDir, cliSessionId, projectPath);
      if (inDir) return inDir;
    }
    return findTranscriptPathSync(piSessionsRoot, cliSessionId, projectPath, configDir);
  }

  /**
   * Derive the session's status from a resolved transcript path (Pi has no
   * hooks). The merged transcript-sync resolves the path once via
   * getTranscriptPath() and polls this for polledStatus providers.
   */
  readSessionStatus(transcriptPath: string): CliSessionStatus | null {
    return readTranscriptStatusSync(transcriptPath);
  }

  /**
   * The CLI's own explanation of an abnormal exit, from the trailing
   * `session_exit` entry of a resolved transcript path. The pty:create
   * exit callback reads this on a non-zero exit before the session is
   * torn down, so the renderer can surface why the CLI died.
   */
  readSessionExitReason(transcriptPath: string): SessionExitReason | null {
    return readSessionExitReasonSync(transcriptPath);
  }

  async discoverTranscripts(signal?: AbortSignal): Promise<TranscriptDescriptor[]> {
    // Search the default agent dir plus every pi profile's config dir, so
    // global session search surfaces transcripts created under an isolated
    // profile. Each root carries its profileId (undefined = default) so
    // resume can reopen against the right config dir.
    const roots = collectProfileRoots('pi', piSessionsRoot(), 'sessions');
    const results: TranscriptDescriptor[] = [];
    for (const [root, profileId] of roots) {
      if (signal?.aborted) break;
      results.push(...await scanTranscriptSessionsRoot(root, profileId, signal));
    }
    // Plus every per-launch dir this app created (flat layout). Legacy
    // history above is untouched; the sidecar carries each dir's profile.
    for (const sessionDir of listLaunchSessionDirs(launchSessionBaseDir('pi'))) {
      if (signal?.aborted) break;
      const meta = readLaunchSessionMeta(sessionDir);
      const profileId = profileIdForConfigDir('pi', meta?.configDir);
      results.push(...await scanFlatSessionDir(sessionDir, profileId, signal));
    }
    return results;
  }

  async indexTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
    return indexCompatibleTranscript(transcriptPath);
  }
}

/** Flatten one mcp.json server entry to the display string ProviderConfig carries. */
function serverUrl(cfg: unknown): string {
  if (typeof cfg === 'string') return cfg;
  const c = cfg as { url?: unknown; command?: unknown; args?: unknown };
  if (typeof c.url === 'string' && c.url) return c.url;
  return [typeof c.command === 'string' ? c.command : undefined,
    ...(Array.isArray(c.args) ? c.args.filter((a): a is string => typeof a === 'string') : [])]
    .filter(Boolean).join(' ');
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

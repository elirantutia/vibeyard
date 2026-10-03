import type { BrowserWindow } from 'electron';
import type { CliProvider, TranscriptDescriptor } from './provider';
import type { CliProviderMeta, CliSessionStatus, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { removeEnvKey } from '../../shared/env-vars';
import { tokenizeArgs } from '../../shared/launch-args';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { collectProfileRoots } from './transcript-utils';
import { ompSessionsRoot, readTranscriptTitleSync } from './omp-transcripts';
import { findTranscriptPathSync, findTranscriptPathInFlatDir, scanTranscriptSessionsRoot, scanFlatSessionDir, indexCompatibleTranscript, readTranscriptStatusSync, readSessionExitReasonSync } from './pi-compatible-transcripts';
import type { SessionExitReason } from './pi-compatible-transcripts';
import { startOmpSessionWatcher, registerPendingOmpSession, unregisterOmpSession, stopOmpSessionWatcher } from '../omp-session-watcher';
import { launchSessionDir, launchSessionBaseDir, ensureLaunchSessionDir, writeLaunchSessionMeta, readLaunchSessionMeta, listLaunchSessionDirs, profileIdForConfigDir } from '../launch-session-dir';

const binaryCache = { path: null as string | null };

/**
 * Per-launch identity, established by onSessionStarted/onSessionResumed
 * BEFORE spawnPty runs (the pty:create handler calls the hook first):
 *  - sessionDir: the exclusive `--session-dir` for this launch — the
 *    process-scoped ownership signal the sessions watcher adopts by.
 *  - resumeTarget: the transcript to resume — the resolved path when the
 *    file is still on disk (OMP loads it in place), else the bare id.
 *
 * OMP (unlike Pi) generates the session id itself and has no `--session-id`
 * flag, so a fresh launch's id is discovered from the first transcript in
 * the exclusive dir.
 */
interface OmpLaunchState {
  sessionDir: string;
  resumeTarget: string | null;
}

const launchStates = new Map<string, OmpLaunchState>();

export class OmpProvider implements CliProvider {
  readonly meta: CliProviderMeta = {
    id: 'omp',
    displayName: 'Oh my Pi',
    binaryName: 'omp',
    capabilities: {
      sessionResume: true,
      costTracking: false,
      contextWindow: false,
      hookStatus: false,
      configReading: false,
      shiftEnterNewline: false,
      pendingPromptTrigger: 'startup-arg',
      systemPromptInjection: true,
      profiles: true,
      selfTitles: true,
      polledStatus: true,
    },
    defaultContextWindowSize: 200_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('omp', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('omp');
  }

  buildEnv(_sessionId: string, baseEnv: Record<string, string>, opts?: { configDir?: string }): Record<string, string> {
    const env = { ...baseEnv };
    env.PATH = getFullPath();
    // Strip inherited profile/storage selectors case-insensitively so the
    // pinned profile (below) is the single effective identity: the installed
    // OMP resolver honors OMP_PROFILE (and legacy PI_PROFILE) over any
    // relocated dir, so an inherited native profile must not silently
    // repoint the child away from the tree Vibeyard tracks.
    removeEnvKey(env, 'PI_CODING_AGENT_DIR');
    removeEnvKey(env, 'PI_CONFIG_DIR');
    removeEnvKey(env, 'PI_PROFILE');
    removeEnvKey(env, 'OMP_PROFILE');
    removeEnvKey(env, 'PI_CODING_AGENT_SESSION_DIR');
    if (opts?.configDir) {
      // OMP honors Pi's PI_CODING_AGENT_DIR — relocates the whole agent dir
      // (default ~/.omp/agent).
      env.PI_CODING_AGENT_DIR = opts.configDir;
    }
    return env;
  }
  buildArgs(opts: { sessionId: string; cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string; systemPrompt?: string }): string[] {
    const args: string[] = [];
    // Every launch stores its transcripts in its own dir — the
    // process-scoped ownership signal the sessions watcher adopts by.
    const state = launchStates.get(opts.sessionId);
    const sessionDir = state?.sessionDir ?? launchSessionDir('omp', opts.sessionId);
    args.push('--session-dir', sessionDir);
    if (opts.isResume && opts.cliSessionId) {
      // Resume the exact transcript: the resolved path when it is still on
      // disk, else the bare id.
      args.push('--resume', state?.resumeTarget ?? opts.cliSessionId);
    }
    if (opts.extraArgs) {
      args.push(...tokenizeArgs(opts.extraArgs));
    }
    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt);
    }
    if (opts.initialPrompt) {
      // OMP takes the initial prompt as a positional message arg.
      args.push(opts.initialPrompt);
    }
    return args;
  }

  // OMP has no hook system — nothing to install or tear down.
  async installHooks(): Promise<void> {}

  installStatusScripts(): void {}

  cleanup(): void {
    stopOmpSessionWatcher();
    launchStates.clear();
  }

  reinstallSettings(): void {}

  async getConfig(_projectPath: string): Promise<ProviderConfig> {
    // OMP's config is config.yml (YAML) — nothing the ProviderConfig shape
    // can surface without a YAML parser, so report an empty config.
    return { mcpServers: [], agents: [], skills: [], commands: [] };
  }

  getShiftEnterSequence(): string | null {
    return null;
  }

  validateSettings(): SettingsValidationResult {
    // Nothing to validate — OMP has no hooks or status line.
    return { statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} };
  }

  // OMP has no hook system to report the session id, and (unlike Pi) no
  // `--session-id` flag: the CLI generates the id itself. Ownership is
  // still exact — the launch's exclusive `--session-dir` is the only
  // place its transcript can appear, so the first file there is adopted.
  onSessionStarted(sessionId: string, cwd: string, _win: BrowserWindow, configDir?: string): void {
    const sessionDir = launchSessionDir('omp', sessionId);
    ensureLaunchSessionDir(sessionDir);
    launchStates.set(sessionId, { sessionDir, resumeTarget: null });
    writeLaunchSessionMeta(sessionDir, { providerId: 'omp', cwd, configDir, createdAt: new Date().toISOString() });
    startOmpSessionWatcher();
    registerPendingOmpSession(sessionId, cwd, configDir, { sessionDir });
  }

  // A resumed session already knows its cli id, so it is seeded as an
  // ADOPTED entry (known id + its existing transcript path) — never as an
  // unidentified pending entry. That is what lets a later `/clear` — a
  // brand-new transcript under a new id in the launch's own dir — be
  // re-adopted instead of the tab freezing on the pre-clear file.
  onSessionResumed(sessionId: string, cwd: string, _win: BrowserWindow, configDir: string | undefined, cliSessionId: string): void {
    const sessionDir = launchSessionDir('omp', sessionId);
    ensureLaunchSessionDir(sessionDir);
    // Legacy transcripts live in the default/profile trees; a post-`/clear`
    // one lives in a previous launch's dir. Resolve before seeding.
    const adoptedFile = this.getTranscriptPath(cliSessionId, cwd, configDir, sessionDir);
    launchStates.set(sessionId, { sessionDir, resumeTarget: adoptedFile ?? cliSessionId });
    writeLaunchSessionMeta(sessionDir, { providerId: 'omp', cwd, configDir, createdAt: new Date().toISOString() });
    startOmpSessionWatcher();
    registerPendingOmpSession(sessionId, cwd, configDir, { sessionDir, knownCliId: cliSessionId, adoptedFile: adoptedFile ?? undefined });
  }

  /**
   * The CLI's own title from a resolved transcript path. OMP keeps it in
   * the transcript head (a `type:"title"` line, mirrored into the session
   * header); the merged transcript-sync resolves the path once and polls
   * this for self-titling providers.
   */
  readSessionTitle(transcriptPath: string): string | null {
    return readTranscriptTitleSync(transcriptPath);
  }

  /**
   * Derive the session's status from a resolved transcript path (OMP has no
   * hooks). The merged transcript-sync resolves the path once and polls
   * this for polledStatus providers, mirroring the result into the
   * `.status` channel.
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

  onSessionExited(sessionId: string): void {
    launchStates.delete(sessionId);
    unregisterOmpSession(sessionId);
  }

  getTranscriptPath(cliSessionId: string, projectPath: string, configDir?: string, sessionDir?: string): string | null {
    // The launch's own dir first (post-`/clear` transcripts live there),
    // then the legacy default/profile trees.
    if (sessionDir) {
      const inDir = findTranscriptPathInFlatDir(sessionDir, cliSessionId, projectPath);
      if (inDir) return inDir;
    }
    return findTranscriptPathSync(ompSessionsRoot, cliSessionId, projectPath, configDir);
  }

  async discoverTranscripts(signal?: AbortSignal): Promise<TranscriptDescriptor[]> {
    // Search the default agent dir plus every omp profile's config dir, so
    // global session search surfaces transcripts created under an isolated
    // profile. Each root carries its profileId (undefined = default) so
    // resume can reopen against the right config dir.
    const roots = collectProfileRoots('omp', ompSessionsRoot(), 'sessions');
    const results: TranscriptDescriptor[] = [];
    for (const [root, profileId] of roots) {
      if (signal?.aborted) break;
      results.push(...await scanTranscriptSessionsRoot(root, profileId, signal));
    }
    // Plus every per-launch dir this app created (flat layout). Legacy
    // history above is untouched; the sidecar carries each dir's profile.
    for (const sessionDir of listLaunchSessionDirs(launchSessionBaseDir('omp'))) {
      if (signal?.aborted) break;
      const meta = readLaunchSessionMeta(sessionDir);
      const profileId = profileIdForConfigDir('omp', meta?.configDir);
      results.push(...await scanFlatSessionDir(sessionDir, profileId, signal));
    }
    return results;
  }

  async indexTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
    return indexCompatibleTranscript(transcriptPath);
  }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

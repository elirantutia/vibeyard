import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import type { BrowserWindow } from 'electron';
import type { CliProvider, TranscriptDescriptor } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { removeEnvKey } from '../../shared/env-vars';
import { getFullPath } from '../pty-manager';
import { installStatusLineScript, cleanupAll as cleanupHookStatus } from '../hook-status';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';
import { installHooksOnly, installStatusLine, getClaudeConfig } from '../claude-cli';
import { guardedInstall, validateSettings, reinstallSettings } from '../settings-guard';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { MAX_INDEX_BYTES, MAX_INDEX_FILE_BYTES, IndexTextBudget, UUID_RE, collectProfileRoots } from './transcript-utils';
import { writeAgentFile, deleteAgentFile } from './agent-files';

const binaryCache = { path: null as string | null };

/** Enumerate every on-disk transcript under one `.../projects` root, tagged with its profile. */
async function scanProjectsRoot(root: string, profileId?: string, signal?: AbortSignal): Promise<TranscriptDescriptor[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: TranscriptDescriptor[] = [];
  for (const slugEntry of entries) {
    if (signal?.aborted) return out;
    if (!slugEntry.isDirectory()) continue;
    const slug = slugEntry.name;
    const slugPath = path.join(root, slug);
    let files: string[];
    try {
      files = await fs.promises.readdir(slugPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const cliSessionId = file.slice(0, -6);
      if (!UUID_RE.test(cliSessionId)) continue;
      out.push({ cliSessionId, transcriptPath: path.join(slugPath, file), projectSlug: slug, profileId });
    }
  }
  return out;
}

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
      systemPromptInjection: true,
      profiles: true,
      selfTitles: true,
      polledStatus: false,
    },
    defaultContextWindowSize: 200_000,
  };

  resolveBinaryPath(): string {
    return resolveBinary('claude', binaryCache);
  }

  validatePrerequisites(): boolean {
    return validateBinaryExists('claude');
  }

  buildEnv(sessionId: string, baseEnv: Record<string, string>, opts?: { configDir?: string }): Record<string, string> {
    const env = { ...baseEnv };
    delete env.CLAUDE_CODE; // avoid subprocess detection conflicts
    env.CLAUDE_IDE_SESSION_ID = sessionId;
    env.PATH = getFullPath();
    // Profile support: point Claude Code at an isolated config dir (separate
    // credentials/license, settings, hooks, transcripts). Absent = default ~/.claude.
    removeEnvKey(env, 'CLAUDE_CONFIG_DIR');
    if (opts?.configDir) env.CLAUDE_CONFIG_DIR = opts.configDir;
    return env;
  }

  buildArgs(opts: { sessionId: string; cliSessionId: string | null; isResume: boolean; extraArgs: string; initialPrompt?: string; systemPrompt?: string }): string[] {
    const args: string[] = [];
    if (opts.cliSessionId) {
      if (opts.isResume) {
        args.push('-r', opts.cliSessionId);
      } else {
        args.push('--session-id', opts.cliSessionId);
      }
    }
    if (opts.systemPrompt) {
      args.push('--append-system-prompt', opts.systemPrompt);
    }
    if (opts.initialPrompt) {
      args.push(opts.initialPrompt);
    }
    if (opts.extraArgs) {
      args.push(...opts.extraArgs.split(/\s+/).filter(Boolean));
    }
    return args;
  }

  async installHooks(win?: BrowserWindow | null, _projectPath?: string): Promise<void> {
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

  validateSettings(_projectPath?: string, configDir?: string): SettingsValidationResult {
    // For a profile session, validate the profile's config dir (where spawnPty
    // installed hooks + statusLine), not the default ~/.claude.
    return validateSettings(configDir);
  }

  reinstallSettings(): void {
    reinstallSettings();
    installStatusLineScript();
  }

  getShiftEnterSequence(): string | null {
    return '\x1b[13;2u';
  }

  getTranscriptPath(cliSessionId: string, projectPath: string, configDir?: string): string | null {
    // Claude encodes the project path by replacing any non-alphanumeric char with '-'
    const slug = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
    const root = configDir ?? path.join(os.homedir(), '.claude');
    const filePath = path.join(root, 'projects', slug, `${cliSessionId}.jsonl`);
    return fs.existsSync(filePath) ? filePath : null;
  }

  async discoverTranscripts(signal?: AbortSignal): Promise<TranscriptDescriptor[]> {
    // Search the default config dir plus every claude profile's config dir, so
    // global session search surfaces transcripts created under an isolated profile.
    // Each root carries its profileId (undefined = default ~/.claude) so resume
    // can reopen against the right config dir.
    const roots = collectProfileRoots('claude', path.join(os.homedir(), '.claude', 'projects'), 'projects');
    const out: TranscriptDescriptor[] = [];
    for (const [root, profileId] of roots) {
      if (signal?.aborted) return out;
      out.push(...await scanProjectsRoot(root, profileId, signal));
    }
    return out;
  }

  async indexTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
    let size: number;
    try {
      size = (await fs.promises.stat(transcriptPath)).size;
    } catch {
      return { text: '', cwd: '' };
    }
    if (size > MAX_INDEX_FILE_BYTES) return { text: '', cwd: '' };

    let cwd = '';
    const budget = new IndexTextBudget();

    const input = fs.createReadStream(transcriptPath, { end: MAX_INDEX_BYTES - 1 });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.trim() || budget.full) continue;
        try {
          const entry = JSON.parse(line);
          if (!cwd && entry.cwd) cwd = entry.cwd;
          if (entry.type !== 'user' || !entry.message?.content) continue;
          const c = entry.message.content;
          let text = '';
          if (typeof c === 'string') {
            text = c;
          } else if (Array.isArray(c)) {
            for (const block of c) {
              if (block.type === 'text') text += block.text + '\n';
            }
          }
          if (text) budget.push(text);
        } catch {
          // partial-write tolerance: skip malformed lines
        }
      }
    } catch {
      // Best-effort: keep whatever was extracted before the stream failed.
    } finally {
      lines.close();
      input.destroy();
    }
    return { text: budget.join(), cwd };
  }

  agentsDir(): string {
    return path.join(os.homedir(), '.claude', 'agents');
  }

  async installAgent(slug: string, content: string): Promise<{ filePath: string }> {
    return writeAgentFile(this.agentsDir(), slug, content);
  }

  async removeAgent(slug: string): Promise<void> {
    return deleteAgentFile(this.agentsDir(), slug);
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

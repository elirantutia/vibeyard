import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BrowserWindow } from 'electron';
import type { CliProvider, TranscriptDescriptor } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { installStatusLineScript, cleanupAll as cleanupHookStatus } from '../hook-status';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';
import { installHooksOnly, installStatusLine, getClaudeConfig } from '../claude-cli';
import { guardedInstall, validateSettings, reinstallSettings } from '../settings-guard';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { MAX_INDEX_CHARS_PER_SESSION, TRANSCRIPT_TEXT_SEPARATOR, UUID_RE } from './transcript-utils';

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

  validatePrerequisites(): boolean {
    return validateBinaryExists('claude');
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

  getTranscriptPath(cliSessionId: string, projectPath: string): string | null {
    // Claude encodes the project path by replacing any non-alphanumeric char with '-'
    const slug = projectPath.replace(/[^a-zA-Z0-9]/g, '-');
    const filePath = path.join(os.homedir(), '.claude', 'projects', slug, `${cliSessionId}.jsonl`);
    return fs.existsSync(filePath) ? filePath : null;
  }

  async discoverTranscripts(): Promise<TranscriptDescriptor[]> {
    const root = path.join(os.homedir(), '.claude', 'projects');
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: TranscriptDescriptor[] = [];
    for (const slugEntry of entries) {
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
        out.push({ cliSessionId, transcriptPath: path.join(slugPath, file), projectSlug: slug });
      }
    }
    return out;
  }

  async indexTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
    const content = await fs.promises.readFile(transcriptPath, 'utf8');
    const texts: string[] = [];
    let cwd = '';
    let totalChars = 0;
    for (const line of content.split('\n')) {
      if (!line.trim() || totalChars >= MAX_INDEX_CHARS_PER_SESSION) continue;
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
        if (text) {
          texts.push(text.trim());
          totalChars += text.length;
        }
      } catch {
        // partial-write tolerance: skip malformed lines
      }
    }
    return { text: texts.join(TRANSCRIPT_TEXT_SEPARATOR), cwd };
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

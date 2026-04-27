import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BrowserWindow } from 'electron';
import type { CliProvider, TranscriptDescriptor } from './provider';
import type { CliProviderMeta, ProviderConfig, SettingsValidationResult } from '../../shared/types';
import { getFullPath } from '../pty-manager';
import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { getCopilotConfig } from '../copilot-config';
import { installCopilotHooks, validateCopilotHooks, cleanupCopilotHooks, SESSION_ID_VAR } from '../copilot-hooks';
import { startConfigWatcher as startConfigWatch, stopConfigWatcher as stopConfigWatch } from '../config-watcher';
import { MAX_INDEX_CHARS_PER_SESSION, TRANSCRIPT_TEXT_SEPARATOR, UUID_RE } from './transcript-utils';

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

  validateSettings(projectPath?: string): SettingsValidationResult {
    return validateCopilotHooks(projectPath);
  }

  reinstallSettings(): void {
    installCopilotHooks();
  }

  getTranscriptPath(cliSessionId: string, _projectPath: string): string | null {
    const filePath = path.join(os.homedir(), '.copilot', 'session-state', cliSessionId, 'events.jsonl');
    return fs.existsSync(filePath) ? filePath : null;
  }

  async discoverTranscripts(): Promise<TranscriptDescriptor[]> {
    const root = path.join(os.homedir(), '.copilot', 'session-state');
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: TranscriptDescriptor[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_RE.test(entry.name)) continue;
      const cliSessionId = entry.name;
      const dir = path.join(root, cliSessionId);
      const transcriptPath = path.join(dir, 'events.jsonl');
      let projectCwd = '';
      try {
        const yaml = await fs.promises.readFile(path.join(dir, 'workspace.yaml'), 'utf-8');
        const m = yaml.match(/^cwd:\s*"?([^"\n]+?)"?\s*$/m);
        if (m) projectCwd = m[1].trim();
      } catch {
        // workspace.yaml may be absent on partial-init sessions; cwd stays empty
      }
      out.push({ cliSessionId, transcriptPath, projectCwd });
    }
    return out;
  }

  async indexTranscript(transcriptPath: string): Promise<{ text: string; cwd: string }> {
    const content = await fs.promises.readFile(transcriptPath, 'utf-8');
    const texts: string[] = [];
    let totalChars = 0;
    for (const line of content.split('\n')) {
      if (!line.trim() || totalChars >= MAX_INDEX_CHARS_PER_SESSION) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'user.message') continue;
        const c = entry.data?.content;
        if (typeof c !== 'string' || !c) continue;
        texts.push(c.trim());
        totalChars += c.length;
      } catch {
        // partial-write tolerance
      }
    }
    return { text: texts.join(TRANSCRIPT_TEXT_SEPARATOR), cwd: '' };
  }
}

/** @internal Test-only: reset cached binary path */
export function _resetCachedPath(): void {
  binaryCache.path = null;
}

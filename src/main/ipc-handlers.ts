import { ipcMain, BrowserWindow, app, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { spawnPty, spawnShellPty, writePty, resizePty, killPty, isSilencedExit, getPtyCwd } from './pty-manager';
import { addMcpServer, removeMcpServer } from './claude-cli';
import type { McpServerConfig } from './claude-cli';
import { loadState, saveState, PersistedState } from './store';
import { startWatching, cleanupSessionStatus } from './hook-status';
import { startCodexSessionWatcher, registerPendingCodexSession, unregisterCodexSession } from './codex-session-watcher';
import { getGitStatus, getGitFiles, getGitDiff, getGitWorktrees, gitStageFile, gitUnstageFile, gitDiscardFile, getGitRemoteUrl, listGitBranches, checkoutGitBranch, createGitBranch } from './git-status';
import { startGitWatcher, stopGitWatcher, notifyGitChanged } from './git-watcher';
import { watchFile as watchFileForChanges, unwatchFile as unwatchFileForChanges, setFileWatcherWindow } from './file-watcher';
import { registerMcpHandlers } from './mcp-ipc-handlers';
import { checkForUpdates, quitAndInstall } from './auto-updater';
import { createAppMenu } from './menu';
import { getProvider, getProviderMeta, getAllProviderMetas } from './providers/registry';
import type { ProviderId, GitFileEntry, SettingsValidationResult } from '../shared/types';
import { analyzeReadiness } from './readiness/analyzer';
import { expandUserPath } from './fs-utils';

/**
 * Check if a resolved path is within one of the known project directories.
 */
function isWithinKnownProject(resolvedPath: string): boolean {
  const state = loadState();
  return state.projects.some(p => resolvedPath.startsWith(p.path + path.sep) || resolvedPath === p.path);
}

/**
 * Check if a resolved path is allowed for reading:
 * within a known project directory OR a known config location.
 */
function isAllowedReadPath(resolvedPath: string): boolean {
  // Allow files within known project directories
  if (isWithinKnownProject(resolvedPath)) {
    return true;
  }

  // Allow known config files/directories used by supported CLIs
  const home = os.homedir();
  const allowedPaths = [
    path.join(home, '.claude.json'),
    path.join(home, '.mcp.json'),
    path.join(home, '.claude') + path.sep,
    path.join(home, '.codex') + path.sep,
  ];

  if (process.platform === 'darwin') {
    allowedPaths.push('/Library/Application Support/ClaudeCode/');
  } else if (process.platform === 'win32') {
    allowedPaths.push('C:\\Program Files\\ClaudeCode\\');
  } else {
    allowedPaths.push('/etc/claude-code/');
  }

  return allowedPaths.some(allowed => resolvedPath === allowed || resolvedPath.startsWith(allowed));
}

let hookWatcherStarted = false;

export function resetHookWatcher(): void {
  hookWatcherStarted = false;
}

export function registerIpcHandlers(): void {
  ipcMain.handle('pty:create', (_event, sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean, extraArgs: string, providerId: ProviderId = 'claude', initialPrompt?: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    // Start hook status watcher on first PTY creation (window is guaranteed to exist)
    if (!hookWatcherStarted) {
      startWatching(win);
      hookWatcherStarted = true;
    }

    // Validate provider settings and warn renderer if missing/tampered
    const provider = getProvider(providerId);
    if (provider.meta.capabilities.hookStatus) {
      const validation = provider.validateSettings();
      if (validation.statusLine !== 'vibeyard' || validation.hooks !== 'complete') {
        win.webContents.send('settings:warning', {
          sessionId,
          statusLine: validation.statusLine,
          hooks: validation.hooks,
        });
      }
    }

    // For Codex sessions without a cliSessionId, start watching history.jsonl
    if (providerId === 'codex' && !cliSessionId) {
      startCodexSessionWatcher(win);
      registerPendingCodexSession(sessionId);
    }

    spawnPty(
      sessionId,
      cwd,
      cliSessionId,
      isResume,
      extraArgs,
      providerId,
      initialPrompt,
      (data) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) {
          w.webContents.send('pty:data', sessionId, data);
        }
      },
      (exitCode, signal) => {
        cleanupSessionStatus(sessionId);
        unregisterCodexSession(sessionId);
        if (isSilencedExit(sessionId)) return; // old PTY killed for re-spawn
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) {
          w.webContents.send('pty:exit', sessionId, exitCode, signal);
        }
      }
    );
  });

  ipcMain.handle('pty:createShell', (_event, sessionId: string, cwd: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    spawnShellPty(
      sessionId,
      cwd,
      (data) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) {
          w.webContents.send('pty:data', sessionId, data);
        }
      },
      (exitCode, signal) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) {
          w.webContents.send('pty:exit', sessionId, exitCode, signal);
        }
      }
    );
  });

  ipcMain.on('pty:write', (_event, sessionId: string, data: string) => {
    writePty(sessionId, data);
  });

  ipcMain.on('pty:resize', (_event, sessionId: string, cols: number, rows: number) => {
    resizePty(sessionId, cols, rows);
  });

  ipcMain.handle('pty:kill', (_event, sessionId: string) => {
    killPty(sessionId);
  });

  ipcMain.handle('fs:isDirectory', (_event, filePath: string) => {
    try {
      return fs.statSync(expandUserPath(filePath)).isDirectory();
    } catch {
      return false;
    }
  });

  ipcMain.handle('fs:expandPath', (_event, filePath: string): string => {
    return expandUserPath(filePath);
  });

  ipcMain.handle('fs:listDirs', (_event, dirPath: string, prefix?: string) => {
    try {
      const expanded = expandUserPath(dirPath);
      const entries = fs.readdirSync(expanded, { withFileTypes: true });
      const lowerPrefix = prefix?.toLowerCase();
      return entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.') && (!lowerPrefix || e.name.toLowerCase().startsWith(lowerPrefix)))
        .map(e => path.join(expanded, e.name))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 20);
    } catch {
      return [];
    }
  });

  ipcMain.handle('store:load', () => {
    return loadState();
  });

  ipcMain.handle('store:save', (_event, state: PersistedState) => {
    saveState(state);
  });

  ipcMain.handle('menu:rebuild', (_event, debugMode: boolean) => {
    createAppMenu(debugMode);
  });

  ipcMain.handle('provider:getConfig', async (_event, providerId: ProviderId, projectPath: string) => {
    const provider = getProvider(providerId);
    return provider.getConfig(projectPath);
  });

  // Backward compatibility alias
  ipcMain.handle('claude:getConfig', async (_event, projectPath: string) => {
    const provider = getProvider('claude');
    return provider.getConfig(projectPath);
  });

  ipcMain.on('config:watchProject', (_event, providerId: ProviderId, projectPath: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    const provider = getProvider(providerId);
    provider.startConfigWatcher?.(win, projectPath);
  });

  ipcMain.handle('provider:getMeta', (_event, providerId: ProviderId) => {
    return getProviderMeta(providerId);
  });

  ipcMain.handle('provider:listProviders', () => {
    return getAllProviderMetas();
  });

  ipcMain.handle('provider:checkBinary', (_event, providerId: ProviderId = 'claude') => {
    const provider = getProvider(providerId);
    return provider.validatePrerequisites();
  });

  ipcMain.handle('fs:browseDirectory', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.on('app:focus', () => {
    app.focus({ steal: true });
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:openExternal', (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only HTTP(S) URLs are allowed');
    }
    return shell.openExternal(url);
  });

  ipcMain.handle('git:getStatus', (_event, projectPath: string) => getGitStatus(projectPath));

  ipcMain.handle('git:getRemoteUrl', (_event, projectPath: string) => getGitRemoteUrl(projectPath));

  ipcMain.handle('git:getFiles', (_event, projectPath: string) => getGitFiles(projectPath));

  ipcMain.handle('git:getDiff', (_event, projectPath: string, filePath: string, area: string) => getGitDiff(projectPath, filePath, area));

  ipcMain.handle('git:getWorktrees', (_event, projectPath: string) => getGitWorktrees(projectPath));

  ipcMain.handle('git:stageFile', async (_event, projectPath: string, filePath: string) => {
    await gitStageFile(projectPath, filePath);
    notifyGitChanged();
  });

  ipcMain.handle('git:unstageFile', async (_event, projectPath: string, filePath: string) => {
    await gitUnstageFile(projectPath, filePath);
    notifyGitChanged();
  });

  ipcMain.handle('git:discardFile', async (_event, projectPath: string, filePath: string, area: string) => {
    await gitDiscardFile(projectPath, filePath, area as GitFileEntry['area']);
    notifyGitChanged();
  });

  ipcMain.on('git:watchProject', (_event, projectPath: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    startGitWatcher(win, projectPath);
  });

  ipcMain.handle('git:listBranches', (_event, projectPath: string) => listGitBranches(projectPath));

  ipcMain.handle('git:checkoutBranch', async (_event, projectPath: string, branch: string) => {
    await checkoutGitBranch(projectPath, branch);
    notifyGitChanged();
  });

  ipcMain.handle('git:createBranch', async (_event, projectPath: string, branch: string) => {
    await createGitBranch(projectPath, branch);
    notifyGitChanged();
  });

  ipcMain.handle('git:openInEditor', (_event, projectPath: string, filePath: string) => {
    const fullPath = path.join(projectPath, filePath);
    return shell.openPath(fullPath);
  });

  ipcMain.handle('pty:getCwd', (_event, sessionId: string) => getPtyCwd(sessionId));

  ipcMain.handle('fs:listFiles', (_event, cwd: string, query: string) => {
    try {
      const resolvedCwd = path.resolve(cwd);
      if (!isWithinKnownProject(resolvedCwd)) {
        return [];
      }
      let files: string[];
      try {
        const output = execSync('git ls-files --cached --others --exclude-standard', { cwd: resolvedCwd, encoding: 'utf-8', timeout: 5000 });
        files = output.split('\n').filter(Boolean);
      } catch {
        // Not a git repo — fallback to recursive readdir with depth limit
        files = [];
        const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '__pycache__']);
        const MAX_DEPTH = 5;
        const MAX_FILES = 5000;
        function walk(dir: string, depth: number): void {
          if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
          let entries: fs.Dirent[];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const entry of entries) {
            if (files.length >= MAX_FILES) return;
            if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
            const rel = path.relative(resolvedCwd, path.join(dir, entry.name));
            if (entry.isDirectory()) {
              walk(path.join(dir, entry.name), depth + 1);
            } else {
              files.push(rel);
            }
          }
        }
        walk(resolvedCwd, 0);
      }

      if (query) {
        const lower = query.toLowerCase();
        const exact: string[] = [];
        const startsWith: string[] = [];
        const nameContains: string[] = [];
        const pathContains: string[] = [];
        for (const f of files) {
          const fileName = path.basename(f).toLowerCase();
          if (fileName === lower) exact.push(f);
          else if (fileName.startsWith(lower)) startsWith.push(f);
          else if (fileName.includes(lower)) nameContains.push(f);
          else if (f.toLowerCase().includes(lower)) pathContains.push(f);
        }
        files = [...exact, ...startsWith, ...nameContains, ...pathContains];
      }
      return files.slice(0, 50);
    } catch (err) {
      console.warn('fs:listFiles failed:', err);
      return [];
    }
  });

  ipcMain.handle('fs:readFile', (_event, filePath: string) => {
    try {
      // Security: resolve to absolute and check it's within a known project directory
      const resolved = path.resolve(filePath);
      if (!isAllowedReadPath(resolved)) {
        console.warn(`fs:readFile blocked: ${resolved} is not within an allowed path`);
        return '';
      }
      return fs.readFileSync(resolved, 'utf-8');
    } catch (err) {
      console.warn('fs:readFile failed:', err);
      return '';
    }
  });

  ipcMain.on('fs:watchFile', (event, filePath: string) => {
    const resolved = path.resolve(filePath);
    if (!isAllowedReadPath(resolved)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) setFileWatcherWindow(win);
    watchFileForChanges(resolved);
  });

  ipcMain.on('fs:unwatchFile', (_event, filePath: string) => {
    const resolved = path.resolve(filePath);
    unwatchFileForChanges(resolved);
  });

  ipcMain.handle('stats:getCache', () => {
    try {
      const statsPath = path.join(os.homedir(), '.claude', 'stats-cache.json');
      const raw = fs.readFileSync(statsPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  ipcMain.handle('readiness:analyze', (_event, projectPath: string, excludedProviders?: ProviderId[]) => analyzeReadiness(projectPath, excludedProviders));

  ipcMain.handle('update:checkNow', () => checkForUpdates());
  ipcMain.handle('update:install', () => quitAndInstall());

  ipcMain.handle('settings:reinstall', (_event, providerId: ProviderId = 'claude') => {
    try {
      const provider = getProvider(providerId);
      provider.reinstallSettings();
      return { success: true };
    } catch (err) {
      console.error('settings:reinstall failed:', err);
      return { success: false };
    }
  });

  ipcMain.handle('settings:validate', (_event, providerId: ProviderId = 'claude'): SettingsValidationResult => {
    const provider = getProvider(providerId);
    return provider.validateSettings();
  });

  ipcMain.handle('mcp:addServer', (_event, name: string, config: McpServerConfig, scope: 'user' | 'project', projectPath?: string) => {
    try {
      addMcpServer(name, config, scope, projectPath);
      return { success: true };
    } catch (err) {
      console.error('mcp:addServer failed:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('mcp:removeServer', (_event, name: string, filePath: string, scope: 'user' | 'project', projectPath?: string) => {
    try {
      removeMcpServer(name, filePath, scope, projectPath);
      return { success: true };
    } catch (err) {
      console.error('mcp:removeServer failed:', err);
      return { success: false, error: String(err) };
    }
  });

  registerMcpHandlers();
}

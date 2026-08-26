import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
import type { CostData, ProviderId, CliProviderMeta, StatsCache, ReadinessResult, ToolFailureData, SettingsWarningData, SettingsValidationResult, StatusLineConflictData, InspectorEvent, ProviderConfig, ReadFileResult, FileStatResult, TopFilesResult, FsChange, DeepSearchResult, GithubFetchResult, GithubRepo, ChromeProfile, ChromeImportOptions, ChromeImportProgress, ChromeImportResult, ClipboardSource } from '../shared/types';
import { ZOOM_MIN, ZOOM_MAX } from '../shared/types';

export type { CostData } from '../shared/types';

export interface VibeyardApi {
  pty: {
    create(sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean, extraArgs?: string, providerId?: ProviderId, initialPrompt?: string, systemPrompt?: string, envVars?: string, configDir?: string): Promise<void>;
    createShell(sessionId: string, cwd: string): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    getCwd(sessionId: string): Promise<string | null>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number, signal?: number) => void): () => void;
  };
  session: {
    buildResumeWithPrompt(sourceProviderId: ProviderId, sourceCliSessionId: string | null, projectPath: string, sessionName: string, configDir?: string): Promise<string>;
    transcriptExists(providerId: ProviderId, cliSessionId: string | null, projectPath: string, configDir?: string): Promise<boolean>;
    transcriptExistsSync(providerId: ProviderId, cliSessionId: string | null, projectPath: string, configDir?: string): boolean;
    deepSearch(query: string): Promise<DeepSearchResult[]>;
    onHookStatus(callback: (sessionId: string, status: 'working' | 'waiting' | 'completed' | 'input', hookName: string) => void): () => void;
    onCliSessionId(callback: (sessionId: string, cliSessionId: string) => void): () => void;
    /** @deprecated Use onCliSessionId instead */
    onClaudeSessionId(callback: (sessionId: string, claudeSessionId: string) => void): () => void;
    onCostData(callback: (sessionId: string, costData: CostData) => void): () => void;
    onSessionName(callback: (sessionId: string, name: string, cliSessionId: string) => void): () => void;
    resyncStatus(): void;
    onToolFailure(callback: (sessionId: string, data: ToolFailureData) => void): () => void;
    onInspectorEvents(callback: (sessionId: string, events: InspectorEvent[]) => void): () => void;
  };
  fs: {
    isDirectory(path: string): Promise<boolean>;
    expandPath(path: string): Promise<string>;
    listDirs(dirPath: string, prefix?: string): Promise<string[]>;
    listDir(dirPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
    browseDirectory(): Promise<string | null>;
    listFiles(cwd: string, query: string): Promise<string[]>;
    topFilesByTokens(cwd: string, limit: number): Promise<TopFilesResult>;
    exists(filePath: string): Promise<boolean>;
    readFile(filePath: string): Promise<ReadFileResult>;
    stat(filePath: string): Promise<FileStatResult>;
    readImage(filePath: string): Promise<{ dataUrl: string } | null>;
    trashItem(filePath: string): Promise<{ ok: boolean; error?: string }>;
    showInFolder(targetPath: string): Promise<{ ok: boolean; error?: string }>;
    watchDir(dirPath: string): void;
    unwatchDir(dirPath: string): void;
    onFsChange(callback: (changes: FsChange[]) => void): () => void;
    getDroppedFilePath(file: File): string;
  };
  store: {
    load(): Promise<unknown>;
    save(state: unknown): Promise<void>;
  };
  profiles: {
    provision(profileId: string, customPath?: string): Promise<{ configDir: string; managed: boolean }>;
    keychainStatus(): Promise<{ status: 'supported' | 'unsupported' | 'unknown'; version: string | null }>;
  };
  provider: {
    getConfig(providerId: ProviderId, projectPath: string): Promise<ProviderConfig>;
    getMeta(providerId: ProviderId): Promise<CliProviderMeta>;
    listProviders(): Promise<CliProviderMeta[]>;
    checkBinary(providerId?: ProviderId): Promise<boolean>;
    watchProject(providerId: ProviderId, projectPath: string): void;
    onConfigChanged(callback: () => void): () => void;
    installAgent(slug: string, content: string): Promise<Array<{ providerId: ProviderId; ok: boolean; filePath?: string; error?: string }>>;
    removeAgent(slug: string): Promise<void>;
  };
  /** @deprecated Use provider namespace instead */
  claude: {
    getConfig(projectPath: string): Promise<ProviderConfig>;
  };
  git: {
    getStatus(path: string): Promise<unknown>;
    getFiles(path: string): Promise<unknown>;
    getDiff(path: string, file: string, area: string): Promise<string>;
    getWorktrees(path: string): Promise<unknown>;
    getRemoteUrl(path: string): Promise<string | null>;
    stageFile(path: string, file: string): Promise<void>;
    unstageFile(path: string, file: string): Promise<void>;
    discardFile(path: string, file: string, area: string): Promise<void>;
    openInEditor(path: string, file: string): Promise<void>;
    listBranches(path: string): Promise<{ name: string; current: boolean }[]>;
    checkoutBranch(path: string, branch: string): Promise<void>;
    createBranch(path: string, branch: string): Promise<void>;
    watchProject(path: string): void;
    onChanged(callback: () => void): () => void;
  };
  update: {
    checkNow(): Promise<void>;
    install(): Promise<void>;
    onAvailable(cb: (info: { version: string }) => void): () => void;
    onDownloadProgress(cb: (info: { percent: number }) => void): () => void;
    onDownloaded(cb: (info: { version: string }) => void): () => void;
    onError(cb: (info: { message: string }) => void): () => void;
  };
  app: {
    focus(): void;
    getVersion(): Promise<string>;
    openExternal(url: string): Promise<void>;
    getBrowserPreloadPath(): Promise<string>;
    onQuitting(callback: () => void): () => void;
    onConfirmClose(callback: () => void): () => void;
    closeConfirmed(): void;
  };
  browser: {
    saveScreenshot(sessionId: string, dataUrl: string): Promise<string>;
  };
  chromeImport: {
    listProfiles(): Promise<ChromeProfile[]>;
    run(options: ChromeImportOptions): Promise<ChromeImportResult>;
    onProgress(callback: (progress: ChromeImportProgress) => void): () => void;
    summary(): Promise<{ cookieCount: number; lastImportedAt: number }>;
    clearCookies(): Promise<void>;
  };
  mcp: {
    connect(id: string, url: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    disconnect(id: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    listTools(id: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    listResources(id: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    listPrompts(id: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    callTool(id: string, name: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }>;
    readResource(id: string, uri: string): Promise<{ success: boolean; data?: unknown; error?: string }>;
    getPrompt(id: string, name: string, args: Record<string, string>): Promise<{ success: boolean; data?: unknown; error?: string }>;
    addServer(name: string, config: unknown, scope: 'user' | 'project', projectPath?: string): Promise<{ success: boolean; error?: string }>;
    removeServer(name: string, filePath: string, scope: 'user' | 'project', projectPath?: string): Promise<{ success: boolean; error?: string }>;
  };
  readiness: {
    analyze(projectPath: string, excludedProviders?: string[]): Promise<ReadinessResult>;
  };
  github: {
    isAvailable(): Promise<boolean>;
    detectRepo(projectPath: string): Promise<GithubRepo | null>;
    listPRs(repo: string, state: 'open' | 'closed' | 'all', max: number): Promise<GithubFetchResult>;
    listIssues(repo: string, state: 'open' | 'closed' | 'all', max: number): Promise<GithubFetchResult>;
  };
  stats: {
    getCache(): Promise<StatsCache | null>;
  };
  settings: {
    onWarning(callback: (data: SettingsWarningData) => void): () => void;
    onConflictDialog(callback: (data: StatusLineConflictData) => void): () => void;
    respondConflictDialog(choice: 'replace' | 'keep'): void;
    reinstall(providerId?: ProviderId): Promise<{ success: boolean }>;
    validate(providerId?: ProviderId): Promise<SettingsValidationResult>;
  };
  clipboard: {
    write(text: string, source?: ClipboardSource): Promise<void>;
  };
  zoom: {
    set(factor: number): void;
  };
  menu: {
    onNewProject(callback: () => void): () => void;
    onNewSession(callback: () => void): () => void;
    onToggleSplit(callback: () => void): () => void;
    onNextSession(callback: () => void): () => void;
    onPrevSession(callback: () => void): () => void;
    onGotoSession(callback: (index: number) => void): () => void;
    onToggleDebug(callback: () => void): () => void;
    onToggleInspector(callback: () => void): () => void;
    onCloseSession(callback: () => void): () => void;
    rebuild(debugMode: boolean): Promise<void>;
  };
}

function onChannel(channel: string, callback: (...args: unknown[]) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: VibeyardApi = {
  pty: {
    create: (sessionId, cwd, cliSessionId, isResume, extraArgs, providerId, initialPrompt, systemPrompt, envVars, configDir) =>
      ipcRenderer.invoke('pty:create', sessionId, cwd, cliSessionId, isResume, extraArgs || '', providerId || 'claude', initialPrompt, systemPrompt, envVars || '', configDir),
    createShell: (sessionId, cwd) =>
      ipcRenderer.invoke('pty:createShell', sessionId, cwd),
    write: (sessionId, data) =>
      ipcRenderer.send('pty:write', sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.send('pty:resize', sessionId, cols, rows),
    kill: (sessionId) =>
      ipcRenderer.invoke('pty:kill', sessionId),
    getCwd: (sessionId: string) =>
      ipcRenderer.invoke('pty:getCwd', sessionId),
    onData: (callback) =>
      onChannel('pty:data', (sessionId, data) => callback(sessionId as string, data as string)),
    onExit: (callback) =>
      onChannel('pty:exit', (sessionId, exitCode, signal) =>
        callback(sessionId as string, exitCode as number, signal as number | undefined)),
  },
  session: {
    buildResumeWithPrompt: (sourceProviderId, sourceCliSessionId, projectPath, sessionName, configDir) =>
      ipcRenderer.invoke('session:buildResumeWithPrompt', sourceProviderId, sourceCliSessionId, projectPath, sessionName, configDir),
    transcriptExists: (providerId, cliSessionId, projectPath, configDir) =>
      ipcRenderer.invoke('session:transcriptExists', providerId, cliSessionId, projectPath, configDir),
    transcriptExistsSync: (providerId, cliSessionId, projectPath, configDir) =>
      ipcRenderer.sendSync('session:transcriptExistsSync', providerId, cliSessionId, projectPath, configDir),
    deepSearch: (query) =>
      ipcRenderer.invoke('session:deepSearch', query),
    onHookStatus: (callback) =>
      onChannel('session:hookStatus', (sessionId, status, hookName) =>
        callback(sessionId as string, status as 'working' | 'waiting' | 'completed' | 'input', (hookName as string) || '')),
    onCliSessionId: (callback) =>
      onChannel('session:cliSessionId', (sessionId, cliSessionId) =>
        callback(sessionId as string, cliSessionId as string)),
    onClaudeSessionId: (callback) =>
      onChannel('session:claudeSessionId', (sessionId, claudeSessionId) =>
        callback(sessionId as string, claudeSessionId as string)),
    onCostData: (callback) =>
      onChannel('session:costData', (sessionId, costData) =>
        callback(sessionId as string, costData as CostData)),
    onSessionName: (callback) =>
      onChannel('session:sessionName', (sessionId, name, cliSessionId) =>
        callback(sessionId as string, name as string, (cliSessionId as string) || '')),
    resyncStatus: () => ipcRenderer.send('session:resyncStatus'),
    onToolFailure: (callback) =>
      onChannel('session:toolFailure', (sessionId, data) =>
        callback(sessionId as string, data as ToolFailureData)),
    onInspectorEvents: (callback) =>
      onChannel('session:inspectorEvents', (sessionId, events) =>
        callback(sessionId as string, events as InspectorEvent[])),
  },
  fs: {
    isDirectory: (path) => ipcRenderer.invoke('fs:isDirectory', path),
    expandPath: (path: string) => ipcRenderer.invoke('fs:expandPath', path),
    listDirs: (dirPath: string, prefix?: string) => ipcRenderer.invoke('fs:listDirs', dirPath, prefix),
    listDir: (dirPath: string) => ipcRenderer.invoke('fs:listDir', dirPath),
    browseDirectory: () => ipcRenderer.invoke('fs:browseDirectory'),
    listFiles: (cwd: string, query: string) => ipcRenderer.invoke('fs:listFiles', cwd, query),
    topFilesByTokens: (cwd: string, limit: number) => ipcRenderer.invoke('fs:topFilesByTokens', cwd, limit),
    exists: (filePath: string) => ipcRenderer.invoke('fs:exists', filePath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
    stat: (filePath: string) => ipcRenderer.invoke('fs:stat', filePath),
    readImage: (filePath: string) => ipcRenderer.invoke('fs:readImage', filePath),
    trashItem: (filePath: string) => ipcRenderer.invoke('fs:trashItem', filePath),
    showInFolder: (targetPath: string) => ipcRenderer.invoke('fs:showInFolder', targetPath),
    watchDir: (dirPath: string) => ipcRenderer.send('fs:watchDir', dirPath),
    unwatchDir: (dirPath: string) => ipcRenderer.send('fs:unwatchDir', dirPath),
    onFsChange: (callback: (changes: FsChange[]) => void) => onChannel('fs:changed', (changes) => callback(changes as FsChange[])),
    getDroppedFilePath: (file: File) => webUtils.getPathForFile(file),
  },
  provider: {
    getConfig: (providerId, projectPath) => ipcRenderer.invoke('provider:getConfig', providerId, projectPath),
    getMeta: (providerId) => ipcRenderer.invoke('provider:getMeta', providerId),
    listProviders: () => ipcRenderer.invoke('provider:listProviders'),
    checkBinary: (providerId) => ipcRenderer.invoke('provider:checkBinary', providerId || 'claude'),
    watchProject: (providerId, projectPath) => ipcRenderer.send('config:watchProject', providerId, projectPath),
    onConfigChanged: (callback) => onChannel('config:changed', callback),
    installAgent: (slug, content) => ipcRenderer.invoke('provider:installAgent', slug, content),
    removeAgent: (slug) => ipcRenderer.invoke('provider:removeAgent', slug),
  },
  claude: {
    getConfig: (projectPath) => ipcRenderer.invoke('claude:getConfig', projectPath),
  },
  store: {
    load: () => ipcRenderer.invoke('store:load'),
    save: (state) => ipcRenderer.invoke('store:save', state),
  },
  profiles: {
    provision: (profileId, customPath) => ipcRenderer.invoke('profiles:provision', profileId, customPath),
    keychainStatus: () => ipcRenderer.invoke('profiles:keychainStatus'),
  },
  git: {
    getStatus: (path) => ipcRenderer.invoke('git:getStatus', path),
    getFiles: (path) => ipcRenderer.invoke('git:getFiles', path),
    getDiff: (path: string, file: string, area: string) => ipcRenderer.invoke('git:getDiff', path, file, area),
    getWorktrees: (path: string) => ipcRenderer.invoke('git:getWorktrees', path),
    getRemoteUrl: (path: string) => ipcRenderer.invoke('git:getRemoteUrl', path),
    stageFile: (path: string, file: string) => ipcRenderer.invoke('git:stageFile', path, file),
    unstageFile: (path: string, file: string) => ipcRenderer.invoke('git:unstageFile', path, file),
    discardFile: (path: string, file: string, area: string) => ipcRenderer.invoke('git:discardFile', path, file, area),
    openInEditor: (path: string, file: string) => ipcRenderer.invoke('git:openInEditor', path, file),
    listBranches: (path: string) => ipcRenderer.invoke('git:listBranches', path),
    checkoutBranch: (path: string, branch: string) => ipcRenderer.invoke('git:checkoutBranch', path, branch),
    createBranch: (path: string, branch: string) => ipcRenderer.invoke('git:createBranch', path, branch),
    watchProject: (path: string) => ipcRenderer.send('git:watchProject', path),
    onChanged: (callback: () => void) => onChannel('git:changed', callback),
  },
  update: {
    checkNow: () => ipcRenderer.invoke('update:checkNow'),
    install: () => ipcRenderer.invoke('update:install'),
    onAvailable: (cb) => onChannel('update:available', (info) => cb(info as { version: string })),
    onDownloadProgress: (cb) => onChannel('update:download-progress', (info) => cb(info as { percent: number })),
    onDownloaded: (cb) => onChannel('update:downloaded', (info) => cb(info as { version: string })),
    onError: (cb) => onChannel('update:error', (info) => cb(info as { message: string })),
  },
  app: {
    focus: () => { ipcRenderer.send('app:focus'); },
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    getBrowserPreloadPath: () => ipcRenderer.invoke('app:getBrowserPreloadPath'),
    onQuitting: (cb: () => void) => onChannel('app:quitting', cb),
    onConfirmClose: (cb: () => void) => onChannel('app:confirmClose', cb),
    closeConfirmed: () => { ipcRenderer.send('app:closeConfirmed'); },
  },
  browser: {
    saveScreenshot: (sessionId: string, dataUrl: string) =>
      ipcRenderer.invoke('browser:saveScreenshot', sessionId, dataUrl),
  },
  chromeImport: {
    listProfiles: () => ipcRenderer.invoke('chromeImport:listProfiles'),
    run: (options: ChromeImportOptions) => ipcRenderer.invoke('chromeImport:run', options),
    onProgress: (callback) =>
      onChannel('chromeImport:progress', (progress) => callback(progress as ChromeImportProgress)),
    summary: () => ipcRenderer.invoke('chromeImport:summary'),
    clearCookies: () => ipcRenderer.invoke('chromeImport:clearCookies'),
  },
  mcp: {
    connect: (id: string, url: string) => ipcRenderer.invoke('mcp:connect', id, url),
    disconnect: (id: string) => ipcRenderer.invoke('mcp:disconnect', id),
    listTools: (id: string) => ipcRenderer.invoke('mcp:listTools', id),
    listResources: (id: string) => ipcRenderer.invoke('mcp:listResources', id),
    listPrompts: (id: string) => ipcRenderer.invoke('mcp:listPrompts', id),
    callTool: (id: string, name: string, args: Record<string, unknown>) => ipcRenderer.invoke('mcp:callTool', id, name, args),
    readResource: (id: string, uri: string) => ipcRenderer.invoke('mcp:readResource', id, uri),
    getPrompt: (id: string, name: string, args: Record<string, string>) => ipcRenderer.invoke('mcp:getPrompt', id, name, args),
    addServer: (name: string, config: unknown, scope: 'user' | 'project', projectPath?: string) => ipcRenderer.invoke('mcp:addServer', name, config, scope, projectPath),
    removeServer: (name: string, filePath: string, scope: 'user' | 'project', projectPath?: string) => ipcRenderer.invoke('mcp:removeServer', name, filePath, scope, projectPath),
  },
  readiness: {
    analyze: (projectPath: string, excludedProviders?: string[]) => ipcRenderer.invoke('readiness:analyze', projectPath, excludedProviders),
  },
  github: {
    isAvailable: () => ipcRenderer.invoke('github:isAvailable'),
    detectRepo: (projectPath: string) => ipcRenderer.invoke('github:detectRepo', projectPath),
    listPRs: (repo: string, state: 'open' | 'closed' | 'all', max: number) => ipcRenderer.invoke('github:listPRs', repo, state, max),
    listIssues: (repo: string, state: 'open' | 'closed' | 'all', max: number) => ipcRenderer.invoke('github:listIssues', repo, state, max),
  },
  stats: {
    getCache: () => ipcRenderer.invoke('stats:getCache'),
  },
  settings: {
    onWarning: (cb) => onChannel('settings:warning', (data) => cb(data as SettingsWarningData)),
    onConflictDialog: (cb) => onChannel('settings:showConflictDialog', (data) => cb(data as StatusLineConflictData)),
    respondConflictDialog: (choice) => ipcRenderer.send('settings:conflictDialogResponse', choice),
    reinstall: (providerId) => ipcRenderer.invoke('settings:reinstall', providerId || 'claude'),
    validate: (providerId) => ipcRenderer.invoke('settings:validate', providerId || 'claude'),
  },
  clipboard: {
    write: (text: string, source?: ClipboardSource) => ipcRenderer.invoke('clipboard:write', text, source),
  },
  zoom: {
    set: (factor: number) => {
      webFrame.setZoomFactor(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor)));
    },
  },
  menu: {
    onNewProject: (cb) => onChannel('menu:new-project', cb),
    onNewSession: (cb) => onChannel('menu:new-session', cb),
    onToggleSplit: (cb) => onChannel('menu:toggle-split', cb),
    onNextSession: (cb) => onChannel('menu:next-session', cb),
    onPrevSession: (cb) => onChannel('menu:prev-session', cb),
    onGotoSession: (cb) => onChannel('menu:goto-session', (index) => cb(index as number)),
    onToggleDebug: (cb) => onChannel('menu:toggle-debug', cb),
    onToggleInspector: (cb) => onChannel('menu:toggle-inspector', cb),
    onCloseSession: (cb) => onChannel('menu:close-session', cb),
    rebuild: (debugMode) => ipcRenderer.invoke('menu:rebuild', debugMode),
  },
};

contextBridge.exposeInMainWorld('vibeyard', api);

import { contextBridge, ipcRenderer } from 'electron';
import type { CostData, ProviderId, CliProviderMeta, StatsCache } from '../shared/types';

export type { CostData } from '../shared/types';

export interface ClaudeIdeApi {
  pty: {
    create(sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean, extraArgs?: string, providerId?: ProviderId): Promise<void>;
    createShell(sessionId: string, cwd: string): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    getCwd(sessionId: string): Promise<string | null>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number, signal?: number) => void): () => void;
  };
  session: {
    onHookStatus(callback: (sessionId: string, status: 'working' | 'waiting' | 'completed' | 'permission') => void): () => void;
    onCliSessionId(callback: (sessionId: string, cliSessionId: string) => void): () => void;
    /** @deprecated Use onCliSessionId instead */
    onClaudeSessionId(callback: (sessionId: string, claudeSessionId: string) => void): () => void;
    onCostData(callback: (sessionId: string, costData: CostData) => void): () => void;
  };
  fs: {
    isDirectory(path: string): Promise<boolean>;
    browseDirectory(): Promise<string | null>;
    listFiles(cwd: string, query: string): Promise<string[]>;
    readFile(filePath: string): Promise<string>;
  };
  store: {
    load(): Promise<unknown>;
    save(state: unknown): Promise<void>;
  };
  provider: {
    getConfig(providerId: ProviderId, projectPath: string): Promise<unknown>;
    getMeta(providerId: ProviderId): Promise<CliProviderMeta>;
    listProviders(): Promise<CliProviderMeta[]>;
  };
  /** @deprecated Use provider namespace instead */
  claude: {
    getConfig(projectPath: string): Promise<unknown>;
  };
  git: {
    getStatus(path: string): Promise<unknown>;
    getFiles(path: string): Promise<unknown>;
    getDiff(path: string, file: string, area: string): Promise<string>;
    getWorktrees(path: string): Promise<unknown>;
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
    getVersion(): Promise<string>;
    onQuitting(callback: () => void): () => void;
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
  };
  stats: {
    getCache(): Promise<StatsCache | null>;
  };
  menu: {
    onNewProject(callback: () => void): () => void;
    onNewSession(callback: () => void): () => void;
    onToggleSplit(callback: () => void): () => void;
    onNextSession(callback: () => void): () => void;
    onPrevSession(callback: () => void): () => void;
    onGotoSession(callback: (index: number) => void): () => void;
    onToggleDebug(callback: () => void): () => void;
    onUsageStats(callback: () => void): () => void;
  };
}

function onChannel(channel: string, callback: (...args: unknown[]) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ClaudeIdeApi = {
  pty: {
    create: (sessionId, cwd, cliSessionId, isResume, extraArgs, providerId) =>
      ipcRenderer.invoke('pty:create', sessionId, cwd, cliSessionId, isResume, extraArgs || '', providerId || 'claude'),
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
    onHookStatus: (callback) =>
      onChannel('session:hookStatus', (sessionId, status) =>
        callback(sessionId as string, status as 'working' | 'waiting' | 'completed' | 'permission')),
    onCliSessionId: (callback) =>
      onChannel('session:cliSessionId', (sessionId, cliSessionId) =>
        callback(sessionId as string, cliSessionId as string)),
    onClaudeSessionId: (callback) =>
      onChannel('session:claudeSessionId', (sessionId, claudeSessionId) =>
        callback(sessionId as string, claudeSessionId as string)),
    onCostData: (callback) =>
      onChannel('session:costData', (sessionId, costData) =>
        callback(sessionId as string, costData as CostData)),
  },
  fs: {
    isDirectory: (path) => ipcRenderer.invoke('fs:isDirectory', path),
    browseDirectory: () => ipcRenderer.invoke('fs:browseDirectory'),
    listFiles: (cwd: string, query: string) => ipcRenderer.invoke('fs:listFiles', cwd, query),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  },
  provider: {
    getConfig: (providerId, projectPath) => ipcRenderer.invoke('provider:getConfig', providerId, projectPath),
    getMeta: (providerId) => ipcRenderer.invoke('provider:getMeta', providerId),
    listProviders: () => ipcRenderer.invoke('provider:listProviders'),
  },
  claude: {
    getConfig: (projectPath) => ipcRenderer.invoke('claude:getConfig', projectPath),
  },
  store: {
    load: () => ipcRenderer.invoke('store:load'),
    save: (state) => ipcRenderer.invoke('store:save', state),
  },
  git: {
    getStatus: (path) => ipcRenderer.invoke('git:getStatus', path),
    getFiles: (path) => ipcRenderer.invoke('git:getFiles', path),
    getDiff: (path: string, file: string, area: string) => ipcRenderer.invoke('git:getDiff', path, file, area),
    getWorktrees: (path: string) => ipcRenderer.invoke('git:getWorktrees', path),
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
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    onQuitting: (cb: () => void) => onChannel('app:quitting', cb),
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
  },
  stats: {
    getCache: () => ipcRenderer.invoke('stats:getCache'),
  },
  menu: {
    onNewProject: (cb) => onChannel('menu:new-project', cb),
    onNewSession: (cb) => onChannel('menu:new-session', cb),
    onToggleSplit: (cb) => onChannel('menu:toggle-split', cb),
    onNextSession: (cb) => onChannel('menu:next-session', cb),
    onPrevSession: (cb) => onChannel('menu:prev-session', cb),
    onGotoSession: (cb) => onChannel('menu:goto-session', (index) => cb(index as number)),
    onToggleDebug: (cb) => onChannel('menu:toggle-debug', cb),
    onUsageStats: (cb) => onChannel('menu:usage-stats', cb),
  },
};

contextBridge.exposeInMainWorld('claudeIde', api);

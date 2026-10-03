export type { McpServer, Agent, Skill, Command, ProviderConfig, ClaudeConfig, GitWorktree, GitFileEntry, CostData, McpResult, ProviderId, CliProviderMeta, CliProviderCapabilities, StatsCache, ReadinessResult, ReadinessCategory, ReadinessCheck, ReadinessCheckStatus, ChromeProfile, ChromeImportOptions, ChromeImportProgress, ChromeImportResult, ClipboardSource } from '../shared/types.js';
import type { CostData, ProviderConfig, GitWorktree, McpResult, ProviderId, CliProviderMeta, StatsCache, ReadinessResult, TopFilesResult, FsChange, ChromeProfile, ChromeImportOptions, ChromeImportProgress, ChromeImportResult, ClipboardSource, InspectorEvent, ToolFailureData, SettingsWarningData, SettingsValidationResult, StatusLineConflictData, ReadFileResult, FileStatResult, DeepSearchResult, GithubFetchResult, GithubRepo } from '../shared/types.js';

export interface VibeyardApi {
  pty: {
    create(sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean, extraArgs?: string, providerId?: ProviderId, initialPrompt?: string, systemPrompt?: string, envVars?: string, configDir?: string): Promise<void>;
    createShell(sessionId: string, cwd: string): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    getCwd(sessionId: string): Promise<string | null>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number, signal?: number, exitReason?: string, pid?: number) => void): () => void;
  };
  session: {
    transcriptExists(providerId: ProviderId, cliSessionId: string | null, projectPath: string, configDir?: string): Promise<boolean>;
    transcriptExistsSync(providerId: ProviderId, cliSessionId: string | null, projectPath: string, configDir?: string): boolean;
    buildResumeWithPrompt(sourceProviderId: ProviderId, sourceCliSessionId: string | null, projectPath: string, sessionName: string, configDir?: string): Promise<string>;
    onHookStatus(callback: (sessionId: string, status: 'working' | 'waiting' | 'completed' | 'input', hookName: string) => void): () => void;
    onCliSessionId(callback: (sessionId: string, cliSessionId: string) => void): () => void;
    deepSearch(query: string): Promise<DeepSearchResult[]>;
    cancelDeepSearch(): void;
    onClaudeSessionId(callback: (sessionId: string, claudeSessionId: string) => void): () => void;
    onCostData(callback: (sessionId: string, costData: CostData) => void): () => void;
    onSessionName(callback: (sessionId: string, name: string, cliSessionId: string) => void): () => void;
    onInspectorEvents(callback: (sessionId: string, events: InspectorEvent[]) => void): () => void;
    onToolFailure(callback: (sessionId: string, data: ToolFailureData) => void): () => void;
    resyncStatus(): void;
    syncRestored(sessions: { sessionId: string; providerId: ProviderId; cliSessionId: string | null; cwd: string; configDir?: string; createdAt: string }[]): Promise<void>;
    release(sessionId: string): void;
  };
  fs: {
    isDirectory(path: string): Promise<boolean>;
    expandPath(path: string): Promise<string>;
    listDir(dirPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
    listDirs(dirPath: string, prefix?: string): Promise<string[]>;
    browseDirectory(): Promise<string | null>;
    listFiles(cwd: string, query: string): Promise<string[]>;
    topFilesByTokens(cwd: string, limit: number): Promise<TopFilesResult>;
    exists(filePath: string): Promise<boolean>;
    readFile(filePath: string): Promise<ReadFileResult>;
    stat(filePath: string): Promise<FileStatResult>;
    trashItem(filePath: string): Promise<{ ok: boolean; error?: string }>;
    readImage(filePath: string): Promise<{ dataUrl: string } | null>;
    showInFolder(targetPath: string): Promise<{ ok: boolean; error?: string }>;
    watchDir(dirPath: string): void;
    unwatchDir(dirPath: string): void;
    getDroppedFilePath(file: File): string;
    onFsChange(callback: (changes: FsChange[]) => void): () => void;
  };
  store: {
    load(): Promise<unknown>;
    save(state: unknown): Promise<void>;
  };
  profiles: {
    provision(profileId: string, customPath?: string, providerId?: ProviderId): Promise<{ configDir: string; managed: boolean }>;
    keychainStatus(): Promise<{ status: 'supported' | 'unsupported' | 'unknown'; version: string | null }>;
  };
  provider: {
    getConfig(providerId: ProviderId, projectPath: string, configDir?: string): Promise<ProviderConfig>;
    getMeta(providerId: ProviderId): Promise<CliProviderMeta>;
    listProviders(): Promise<CliProviderMeta[]>;
    checkBinary(providerId?: ProviderId): Promise<boolean>;
    watchProject(providerId: ProviderId, projectPath: string): void;
    onConfigChanged(callback: () => void): () => void;
    installAgent(slug: string, content: string): Promise<Array<{ providerId: ProviderId; ok: boolean; filePath?: string; error?: string }>>;
    removeAgent(slug: string): Promise<void>;
  };
  /** @deprecated Use provider namespace */
  claude: {
    getConfig(projectPath: string): Promise<ProviderConfig>;
  };
  git: {
    getStatus(path: string): Promise<unknown>;
    getFiles(path: string): Promise<unknown>;
    getDiff(path: string, file: string, area: string): Promise<string>;
    getWorktrees(path: string): Promise<GitWorktree[]>;
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
    connect(id: string, url: string): Promise<McpResult>;
    disconnect(id: string): Promise<McpResult>;
    listTools(id: string): Promise<McpResult>;
    listResources(id: string): Promise<McpResult>;
    listPrompts(id: string): Promise<McpResult>;
    callTool(id: string, name: string, args: Record<string, unknown>): Promise<McpResult>;
    readResource(id: string, uri: string): Promise<McpResult>;
    getPrompt(id: string, name: string, args: Record<string, string>): Promise<McpResult>;
    // Preload exposes these (see the mcp block in preload.ts); the renderer's
    // copy of the interface had drifted and omitted them, so the widget's
    // calls type-errored.
    addServer(name: string, config: unknown, scope: 'user' | 'project', projectPath?: string): Promise<McpResult>;
    removeServer(name: string, filePath: string, scope: 'user' | 'project', projectPath?: string): Promise<McpResult>;
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
  settings: {
    onWarning(callback: (data: SettingsWarningData) => void): () => void;
    onConflictDialog(callback: (data: StatusLineConflictData) => void): () => void;
    respondConflictDialog(choice: 'replace' | 'keep'): void;
    reinstall(providerId?: ProviderId): Promise<{ success: boolean }>;
    validate(providerId?: ProviderId): Promise<SettingsValidationResult>;
  };
  stats: {
    getCache(): Promise<StatsCache | null>;
  };
  clipboard: {
    write(text: string, source?: ClipboardSource): Promise<void>;
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
  zoom: {
    set(factor: number): void;
  };
}

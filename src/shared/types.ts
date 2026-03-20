// Shared type definitions used across main, preload, and renderer processes.

// --- Provider ---

export type ProviderId = 'claude' | 'copilot' | 'gemini';

export interface CliProviderCapabilities {
  sessionResume: boolean;
  costTracking: boolean;
  contextWindow: boolean;
  hookStatus: boolean;
  configReading: boolean;
  shiftEnterNewline: boolean;
}

export interface CliProviderMeta {
  id: ProviderId;
  displayName: string;
  binaryName: string;
  capabilities: CliProviderCapabilities;
  defaultContextWindowSize: number;
}

// --- Git ---

export interface GitWorktree {
  path: string;
  head: string;
  branch: string | null;
  isBare: boolean;
}

export interface GitFileEntry {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
  area: 'staged' | 'working' | 'untracked' | 'conflicted';
}

// --- Claude Config ---

export interface McpServer { name: string; url: string; status: string; scope: 'user' | 'project'; filePath: string }
export interface Agent { name: string; model: string; category: 'plugin' | 'built-in'; scope: 'user' | 'project'; filePath: string }
export interface Skill { name: string; description: string; scope: 'user' | 'project'; filePath: string }
export interface Command { name: string; description: string; scope: 'user' | 'project'; filePath: string }
export interface ClaudeConfig { mcpServers: McpServer[]; agents: Agent[]; skills: Skill[]; commands: Command[] }

// --- Session / State ---

export interface SessionRecord {
  id: string;
  name: string;
  type?: 'claude' | 'mcp-inspector' | 'diff-viewer' | 'file-reader';
  providerId?: ProviderId;
  args?: string;
  cliSessionId: string | null;
  /** @deprecated Use cliSessionId instead. Kept for state migration compatibility. */
  claudeSessionId?: string | null;
  mcpServerUrl?: string;
  diffFilePath?: string;
  diffArea?: string;
  worktreePath?: string;
  fileReaderPath?: string;
  fileReaderLine?: number;
  createdAt: string;
}

export interface ArchivedSession {
  id: string;
  name: string;
  providerId: ProviderId;
  cliSessionId: string | null;
  createdAt: string;
  closedAt: string;
  cost: {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
  } | null;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  sessions: SessionRecord[];
  activeSessionId: string | null;
  layout: {
    mode: 'tabs' | 'split';
    splitPanes: string[];
    splitDirection: 'horizontal' | 'vertical';
  };
  sessionHistory?: ArchivedSession[];
  terminalPanelOpen?: boolean;
  terminalPanelHeight?: number;
}

export interface Preferences {
  soundOnSessionWaiting: boolean;
  debugMode: boolean;
  keybindings?: Record<string, string>;
}

export interface PersistedState {
  version: 1;
  projects: ProjectRecord[];
  activeProjectId: string | null;
  preferences: Preferences;
  sidebarWidth?: number;
}

// --- Cost / Context ---

export interface CostData {
  cost: { total_cost_usd: number; total_duration_ms: number; total_api_duration_ms: number };
  context_window: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_tokens?: number;
    current_usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  };
}

// --- MCP ---

export interface McpResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

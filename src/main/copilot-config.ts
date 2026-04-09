import * as path from 'path';
import { homedir } from 'os';
import { readJsonSafe } from './fs-utils';
import type { McpServer, ProviderConfig } from '../shared/types';

function readMcpServersFromJson(filePath: string, scope: 'user' | 'project'): McpServer[] {
  const json = readJsonSafe(filePath);
  if (!json?.mcpServers || typeof json.mcpServers !== 'object') return [];

  const servers: McpServer[] = [];
  for (const [name, config] of Object.entries(json.mcpServers as Record<string, Record<string, unknown>>)) {
    // url: HTTP/SSE endpoint; command: stdio binary path — both map to McpServer.url for display
    const url = (config?.url as string) || (config?.command as string) || '';
    if (url) {
      servers.push({ name, url, status: 'configured', scope, filePath });
    }
  }
  return servers;
}

export function getCopilotConfig(_projectPath: string): Promise<ProviderConfig> {
  // Copilot CLI only supports user-level config; project-level config is not available.
  const copilotDir = path.join(homedir(), '.copilot');

  const userMcp = readMcpServersFromJson(path.join(copilotDir, 'mcp-config.json'), 'user');

  return Promise.resolve({
    mcpServers: userMcp,
    agents: [],
    skills: [],
    commands: [],
  });
}

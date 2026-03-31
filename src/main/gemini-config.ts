import * as path from 'path';
import { homedir } from 'os';
import { readJsonSafe } from './fs-utils';
import type { McpServer, ProviderConfig } from '../shared/types';

function readMcpServersFromJson(filePath: string, scope: 'user' | 'project'): McpServer[] {
  const json = readJsonSafe(filePath);
  if (!json?.mcpServers || typeof json.mcpServers !== 'object') return [];

  const servers: McpServer[] = [];
  for (const [name, config] of Object.entries(json.mcpServers as Record<string, Record<string, unknown>>)) {
    const url = (config?.url as string) || (config?.command as string) || '';
    if (url) {
      servers.push({ name, url, status: 'configured', scope, filePath });
    }
  }
  return servers;
}

export async function getGeminiConfig(projectPath: string): Promise<ProviderConfig> {
  const geminiDir = path.join(homedir(), '.gemini');
  const projectGeminiDir = path.join(projectPath, '.gemini');

  const userMcp = readMcpServersFromJson(path.join(geminiDir, 'settings.json'), 'user');
  const projectMcp = readMcpServersFromJson(path.join(projectGeminiDir, 'settings.json'), 'project');

  const serverMap = new Map<string, McpServer>();
  for (const server of userMcp) serverMap.set(server.name, server);
  for (const server of projectMcp) serverMap.set(server.name, server);

  return {
    mcpServers: Array.from(serverMap.values()),
    agents: [],
    skills: [],
    commands: [],
  };
}

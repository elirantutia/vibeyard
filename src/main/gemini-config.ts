import * as path from 'path';
import { homedir } from 'os';
import { readMcpServersFromJson } from './provider-config-utils';
import type { McpServer, ProviderConfig } from '../shared/types';

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

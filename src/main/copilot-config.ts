import * as path from 'path';
import { homedir } from 'os';
import { readDirSafe, readJsonSafe } from './fs-utils';
import { parseFrontmatter } from './frontmatter';
import { dedupeByName, readSkillsFromDir } from './provider-config-utils';
import type { Agent, McpServer, ProviderConfig } from '../shared/types';

const AGENT_EXT = '.agent.md';

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

function readAgentsFromDir(dirPath: string, scope: 'user' | 'project'): Agent[] {
  const agents: Agent[] = [];
  for (const file of readDirSafe(dirPath)) {
    if (!file.endsWith(AGENT_EXT)) continue;
    const filePath = path.join(dirPath, file);
    const fm = parseFrontmatter(filePath);
    const name = fm.name || file.slice(0, -AGENT_EXT.length);
    agents.push({
      name,
      model: fm.model || '',
      category: 'built-in',
      scope,
      filePath,
    });
  }
  return agents;
}

export function getCopilotConfig(projectPath: string): ProviderConfig {
  const copilotDir = path.join(homedir(), '.copilot');
  const projectCopilotDir = path.join(projectPath, '.copilot');
  const projectGithubDir = path.join(projectPath, '.github');

  const userMcp = readMcpServersFromJson(path.join(copilotDir, 'mcp-config.json'), 'user');
  const projectMcp = readMcpServersFromJson(path.join(projectCopilotDir, 'mcp-config.json'), 'project');

  const serverMap = new Map<string, McpServer>();
  for (const server of userMcp) serverMap.set(server.name, server);
  for (const server of projectMcp) serverMap.set(server.name, server);

  // Per Copilot CLI docs, user-level entries win over project-level on name collision.
  const agents = dedupeByName(
    readAgentsFromDir(path.join(copilotDir, 'agents'), 'user'),
    readAgentsFromDir(path.join(projectGithubDir, 'agents'), 'project'),
  );

  const skills = dedupeByName(
    readSkillsFromDir(path.join(copilotDir, 'skills'), 'user'),
    readSkillsFromDir(path.join(projectGithubDir, 'skills'), 'project'),
  );

  return {
    mcpServers: Array.from(serverMap.values()),
    agents,
    skills,
    commands: [],
  };
}

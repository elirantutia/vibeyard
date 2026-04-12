import * as path from 'path';
import { homedir } from 'os';
import { readDirSafe } from './fs-utils';
import { parseFrontmatter } from './frontmatter';
import { dedupeByName, readSkillsFromDir } from './provider-config-utils';
import { readJsonSafe } from './fs-utils';
import type { Agent, Command, McpServer, ProviderConfig } from '../shared/types';

function readMcpFromJson(filePath: string, scope: 'user' | 'project'): McpServer[] {
  const json = readJsonSafe(filePath);
  if (!json?.mcp || typeof json.mcp !== 'object') return [];

  const servers: McpServer[] = [];
  for (const [name, config] of Object.entries(json.mcp as Record<string, Record<string, unknown>>)) {
    const url = (config?.url as string) || (config?.command as string) || '';
    if (url) {
      servers.push({ name, url, status: 'configured', scope, filePath });
    }
  }
  return servers;
}

function readAgentsFromJson(filePath: string, scope: 'user' | 'project'): Agent[] {
  const json = readJsonSafe(filePath);
  if (!json?.agent || typeof json.agent !== 'object') return [];

  const agents: Agent[] = [];
  for (const [name, config] of Object.entries(json.agent as Record<string, Record<string, unknown>>)) {
    const model = (config?.model as string) || '';
    agents.push({ name, model, category: 'built-in', scope, filePath });
  }
  return agents;
}

function readAgentsFromDir(dirPath: string, scope: 'user' | 'project'): Agent[] {
  // Agents without a 'name' frontmatter key are intentionally skipped: an unnamed
  // agent cannot be selected by the user, unlike commands where the filename serves
  // as a reasonable fallback display name.
  const agents: Agent[] = [];
  for (const file of readDirSafe(dirPath)) {
    if (!file.endsWith('.md')) continue;
    const filePath = path.join(dirPath, file);
    const fm = parseFrontmatter(filePath);
    if (!fm.name) continue;
    agents.push({
      name: fm.name,
      model: fm.model || '',
      category: 'plugin',
      scope,
      filePath,
    });
  }
  return agents;
}

function readCommandsFromDir(dirPath: string, scope: 'user' | 'project'): Command[] {
  const commands: Command[] = [];
  for (const file of readDirSafe(dirPath)) {
    if (!file.endsWith('.md')) continue;
    const filePath = path.join(dirPath, file);
    const fm = parseFrontmatter(filePath);
    const name = fm.name || file.slice(0, -3);
    commands.push({ name, description: fm.description || '', scope, filePath });
  }
  return commands;
}

export async function getOpenCodeConfig(projectPath: string): Promise<ProviderConfig> {
  const userConfigDir = path.join(homedir(), '.config', 'opencode');
  const userConfigFile = path.join(userConfigDir, 'opencode.json');
  const projectConfigFile = path.join(projectPath, 'opencode.json');
  const projectOpenCodeDir = path.join(projectPath, '.opencode');

  // MCP servers: user config + project config; project overrides user on name collision.
  // Note: this intentionally differs from agents/skills/commands where user wins. MCP
  // uses project-wins semantics to match OpenCode's own behavior for server resolution.
  const userMcp = readMcpFromJson(userConfigFile, 'user');
  const projectMcp = readMcpFromJson(projectConfigFile, 'project');

  const serverMap = new Map<string, McpServer>();
  for (const server of userMcp) serverMap.set(server.name, server);
  for (const server of projectMcp) serverMap.set(server.name, server);

  // Agents: JSON config keys (built-in) + markdown files (custom).
  // User-level agent markdown dir (~/.config/opencode/agents/) follows the same
  // convention OpenCode uses for project-level agents (.opencode/agents/), applied
  // globally. If OpenCode's spec changes, this dir read is harmless when absent.
  const agents = dedupeByName(
    readAgentsFromJson(userConfigFile, 'user'),
    readAgentsFromDir(path.join(userConfigDir, 'agents'), 'user'),
    readAgentsFromJson(projectConfigFile, 'project'),
    readAgentsFromDir(path.join(projectOpenCodeDir, 'agents'), 'project'),
  );

  // Skills: global + project; global wins on name collision (user-first)
  const skills = dedupeByName(
    readSkillsFromDir(path.join(userConfigDir, 'skills'), 'user'),
    readSkillsFromDir(path.join(projectOpenCodeDir, 'skills'), 'project'),
  );

  // Commands: global + project
  const commands = dedupeByName(
    readCommandsFromDir(path.join(userConfigDir, 'commands'), 'user'),
    readCommandsFromDir(path.join(projectOpenCodeDir, 'commands'), 'project'),
  );

  return {
    mcpServers: Array.from(serverMap.values()),
    agents,
    skills,
    commands,
  };
}

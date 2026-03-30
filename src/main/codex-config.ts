import * as path from 'path';
import { homedir } from 'os';
import { fileExists, readDirSafe, readFileSafe } from './fs-utils';
import type { Agent, McpServer, ProviderConfig, Skill } from '../shared/types';

function parseFrontmatter(filePath: string): Record<string, string> {
  const content = readFileSafe(filePath);
  if (!content) return {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

function readAgentsFromDir(dirPath: string, scope: 'user' | 'project'): Agent[] {
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

function readSkillsFromDir(dirPath: string, scope: 'user' | 'project'): Skill[] {
  const skills: Skill[] = [];
  for (const skillName of readDirSafe(dirPath)) {
    if (skillName.startsWith('.')) continue;
    const filePath = path.join(dirPath, skillName, 'SKILL.md');
    if (!fileExists(filePath)) continue;
    const fm = parseFrontmatter(filePath);
    skills.push({
      name: fm.name || skillName,
      description: fm.description || '',
      scope,
      filePath,
    });
  }
  return skills;
}

function splitTomlSectionPath(sectionPath: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < sectionPath.length; i++) {
    const char = sectionPath[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === '.' && !inQuotes) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current) parts.push(current);
  return parts;
}

function parseTomlString(rawValue: string): string {
  const value = rawValue.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1);
  }
  return value;
}

function readMcpServersFromToml(filePath: string, scope: 'user' | 'project'): McpServer[] {
  const content = readFileSafe(filePath);
  if (!content) return [];

  const servers = new Map<string, McpServer>();
  let currentServerName: string | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      const sectionPath = splitTomlSectionPath(sectionMatch[1].trim());
      currentServerName = sectionPath[0] === 'mcp_servers' && sectionPath[1] ? sectionPath[1] : null;
      if (currentServerName && !servers.has(currentServerName)) {
        servers.set(currentServerName, {
          name: currentServerName,
          url: '',
          status: 'configured',
          scope,
          filePath,
        });
      }
      continue;
    }

    if (!currentServerName) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = parseTomlString(line.slice(eqIndex + 1));
    if (key !== 'url' && key !== 'command') continue;

    const server = servers.get(currentServerName);
    if (!server) continue;
    if (!server.url || key === 'url') {
      server.url = value;
    }
  }

  return Array.from(servers.values()).filter(server => server.url);
}

export async function getCodexConfig(projectPath: string): Promise<ProviderConfig> {
  const codexDir = path.join(homedir(), '.codex');
  const projectCodexDir = path.join(projectPath, '.codex');

  const userMcp = readMcpServersFromToml(path.join(codexDir, 'config.toml'), 'user');
  const projectMcp = readMcpServersFromToml(path.join(projectCodexDir, 'config.toml'), 'project');

  const serverMap = new Map<string, McpServer>();
  for (const server of userMcp) serverMap.set(server.name, server);
  for (const server of projectMcp) serverMap.set(server.name, server);

  const agentNames = new Set<string>();
  const agents: Agent[] = [];
  for (const list of [
    readAgentsFromDir(path.join(codexDir, 'agents'), 'user'),
    readAgentsFromDir(path.join(projectCodexDir, 'agents'), 'project'),
  ]) {
    for (const agent of list) {
      if (agentNames.has(agent.name)) continue;
      agentNames.add(agent.name);
      agents.push(agent);
    }
  }

  const skillNames = new Set<string>();
  const skills: Skill[] = [];
  for (const list of [
    readSkillsFromDir(path.join(codexDir, 'skills'), 'user'),
    readSkillsFromDir(path.join(projectCodexDir, 'skills'), 'project'),
  ]) {
    for (const skill of list) {
      if (skillNames.has(skill.name)) continue;
      skillNames.add(skill.name);
      skills.push(skill);
    }
  }

  return {
    mcpServers: Array.from(serverMap.values()),
    agents,
    skills,
    commands: [],
  };
}

import * as path from 'path';
import { readDirSafe, readFileSafe, readJsonSafe } from './fs-utils';
import { parseFrontmatterContent } from './frontmatter';
import type { McpServer, Skill } from '../shared/types';

export function readMcpServersFromJson(filePath: string, scope: 'user' | 'project'): McpServer[] {
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

/**
 * Read agent skills from a directory of subdirectories, each expected to contain a SKILL.md file.
 * Used by Codex and Copilot providers (Claude has its own plugin-aware variant).
 */
export function readSkillsFromDir(dirPath: string, scope: 'user' | 'project'): Skill[] {
  const skills: Skill[] = [];
  for (const skillName of readDirSafe(dirPath)) {
    if (skillName.startsWith('.')) continue;
    const filePath = path.join(dirPath, skillName, 'SKILL.md');
    const content = readFileSafe(filePath);
    if (content === null) continue;
    const fm = parseFrontmatterContent(content);
    skills.push({
      name: fm.name || skillName,
      description: fm.description || '',
      scope,
      filePath,
    });
  }
  return skills;
}

/**
 * Merge multiple lists of named items, keeping the first occurrence of each name.
 * Earlier lists win on collision.
 */
export function dedupeByName<T extends { name: string }>(...lists: T[][]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      result.push(item);
    }
  }
  return result;
}

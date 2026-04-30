import type { TeamMember } from '../../../shared/types.js';

export interface ParsedTeamFile {
  meta: Record<string, string>;
  body: string;
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export function parseTeamMarkdown(raw: string): ParsedTeamFile {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { meta: {}, body: raw.trim() };
  }
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta, body: match[2].trim() };
}

export function memberFromMarkdown(
  raw: string,
  opts: { fallbackId: string; sourceUrl?: string; source: TeamMember['source'] },
): TeamMember | null {
  const { meta, body } = parseTeamMarkdown(raw);
  const name = meta.name?.trim();
  const role = meta.role?.trim();
  if (!name || !role || !body) return null;
  const now = Date.now();
  return {
    id: meta.id?.trim() || opts.fallbackId,
    name,
    role,
    description: meta.description?.trim() || undefined,
    systemPrompt: body,
    source: opts.source,
    sourceUrl: opts.sourceUrl,
    createdAt: now,
    updatedAt: now,
  };
}


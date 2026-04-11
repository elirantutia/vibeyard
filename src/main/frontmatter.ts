import { readFileSafe } from './fs-utils';

/** Parse YAML-ish frontmatter from a Markdown file (between --- delimiters) */
export function parseFrontmatter(filePath: string): Record<string, string> {
  const content = readFileSafe(filePath);
  if (content === null) return {};
  return parseFrontmatterContent(content);
}

/** Parse YAML-ish frontmatter from already-loaded Markdown content */
export function parseFrontmatterContent(content: string): Record<string, string> {
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

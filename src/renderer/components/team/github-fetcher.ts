import type { TeamMember } from '../../../shared/types.js';
import { buildContentsApiUrl } from '../../../shared/team-config.js';
import { memberFromMarkdown } from './frontmatter.js';

interface GithubContentEntry {
  name: string;
  type: string;
  download_url: string | null;
}

const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchPredefinedMembers(): Promise<TeamMember[]> {
  const apiUrl = buildContentsApiUrl();
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const listResp = await fetch(apiUrl, { headers });
  if (!listResp.ok) {
    throw new Error(`GitHub API returned ${listResp.status}: ${await listResp.text().catch(() => '')}`);
  }
  const entries = (await listResp.json()) as GithubContentEntry[];
  const mdEntries = entries.filter((e) => e.type === 'file' && e.name.toLowerCase().endsWith('.md'));

  const results = await Promise.all(
    mdEntries.map(async (entry): Promise<TeamMember | null> => {
      if (!entry.download_url) return null;
      try {
        const resp = await fetch(entry.download_url);
        if (!resp.ok) return null;
        const raw = await resp.text();
        return memberFromMarkdown(raw, {
          fallbackId: entry.name.replace(/\.md$/i, ''),
          sourceUrl: entry.download_url,
          source: 'predefined',
        });
      } catch {
        return null;
      }
    }),
  );

  return results.filter((m): m is TeamMember => m !== null);
}

export function isCacheFresh(cache?: { fetchedAt: number }): boolean {
  if (!cache) return false;
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { DeepSearchResult } from '../shared/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CHARS_PER_SESSION = 50 * 1024;
const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  text: string;
  cwd: string;
  mtime: number;
}

const textCache = new Map<string, CacheEntry>();

export function _resetForTesting(): void {
  textCache.clear();
}

async function extractSessionText(jsonlPath: string): Promise<{ text: string; cwd: string }> {
  const content = await fs.promises.readFile(jsonlPath, 'utf8');
  const texts: string[] = [];
  let cwd = '';
  let totalChars = 0;

  for (const line of content.split('\n')) {
    if (!line.trim() || totalChars >= MAX_CHARS_PER_SESSION) continue;
    try {
      const entry = JSON.parse(line);
      if (!cwd && entry.cwd) cwd = entry.cwd;
      if (entry.type !== 'user' || !entry.message?.content) continue;
      const c = entry.message.content;
      let text = '';
      if (typeof c === 'string') {
        text = c;
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (block.type === 'text') text += block.text + '\n';
        }
      }
      if (text) {
        texts.push(text.trim());
        totalChars += text.length;
      }
    } catch {
      // JSONL entries can be partially written on crash; skip gracefully
    }
  }

  return { text: texts.join('\n---\n'), cwd };
}

async function getCachedEntry(jsonlPath: string): Promise<CacheEntry> {
  try {
    const stat = await fs.promises.stat(jsonlPath);
    const mtime = stat.mtimeMs;
    const cached = textCache.get(jsonlPath);
    if (cached && cached.mtime === mtime) return cached;

    if (textCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = textCache.keys().next().value;
      if (oldest) textCache.delete(oldest);
    }

    const { text, cwd } = await extractSessionText(jsonlPath);
    const entry: CacheEntry = { text, cwd, mtime };
    textCache.set(jsonlPath, entry);
    return entry;
  } catch {
    return { text: '', cwd: '', mtime: 0 };
  }
}

function scoreFuzzy(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (t.includes(q)) return 100;

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const matched = words.filter(w => t.includes(w));
    if (matched.length === words.length) return 80;
    if (matched.length > 0) return Math.round((matched.length / words.length) * 50);
  }

  // char subsequence fallback
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 10 : 0;
}

function extractSnippet(text: string, query: string): string {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  let idx = t.indexOf(q);
  if (idx === -1) {
    const firstWord = q.split(/\s+/)[0];
    idx = firstWord ? t.indexOf(firstWord) : -1;
  }
  if (idx === -1) idx = 0;

  const RADIUS = 60;
  const start = Math.max(0, idx - RADIUS);
  const end = Math.min(text.length, idx + q.length + RADIUS);
  let snippet = text.slice(start, end).replace(/\n+/g, ' ').trim();
  if (start > 0) snippet = '\u2026' + snippet;
  if (end < text.length) snippet = snippet + '\u2026';
  return snippet;
}

export async function searchSessions(query: string): Promise<DeepSearchResult[]> {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

  let slugDirs: string[];
  try {
    slugDirs = await fs.promises.readdir(claudeProjectsDir);
  } catch {
    return [];
  }

  const results: DeepSearchResult[] = [];

  for (const slug of slugDirs) {
    const slugPath = path.join(claudeProjectsDir, slug);
    try {
      if (!(await fs.promises.stat(slugPath)).isDirectory()) continue;
    } catch {
      continue;
    }

    let files: string[];
    try {
      files = await fs.promises.readdir(slugPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const cliSessionId = file.slice(0, -6);
      if (!UUID_RE.test(cliSessionId)) continue;

      const entry = await getCachedEntry(path.join(slugPath, file));
      if (!entry.text) continue;

      const score = scoreFuzzy(entry.text, query);
      if (score === 0) continue;

      results.push({
        cliSessionId,
        projectSlug: slug,
        projectCwd: entry.cwd,
        snippet: extractSnippet(entry.text, query),
        score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

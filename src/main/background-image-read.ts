import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import type { Preferences } from '../shared/types';
import { expandUserPath } from './fs-utils';
import { isWin, isWslMode } from './platform';
import { resolvePathForMainProcess } from './project-fs-path';
import { getDefaultWslDistro, getEffectiveDistro, wslPathToWin } from './wsl';

/**
 * Normalize user/IPC input into a filesystem path string.
 */
export function sanitizeBackgroundImagePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('file://')) {
    try {
      s = fileURLToPath(s);
    } catch {
      return null;
    }
  }
  return s.length > 0 ? s : null;
}

/**
 * Paths to try in order when reading a backdrop image (first hit wins).
 * Handles `~`, `file://`, Windows long paths, `/mnt/c/...`, and (when WSL2 mode is on) POSIX paths under the distro via `\\wsl$\...`.
 */
export function collectBackgroundImageCandidates(s: string, prefs?: Preferences): string[] {
  const expanded = expandUserPath(s);
  const out: string[] = [];
  const add = (p: string) => {
    if (!p) return;
    const n = path.normalize(p);
    const resolved = path.isAbsolute(n) ? n : path.resolve(n);
    if (!out.includes(resolved)) out.push(resolved);
  };

  if (isWin) {
    // `/mnt/c/Users/...` from synced prefs / WSL-style paths — resolve before `path.resolve('/')` quirks
    const mnt = expanded.match(/^\/mnt\/([a-z])\/(.*)/i);
    if (mnt) {
      const drive = mnt[1].toUpperCase();
      const tail = mnt[2].replace(/\//g, '\\');
      add(`${drive}:\\${tail}`);
    }
    // Unix absolute under a WSL distro — try UNC(s) only when WSL2 execution mode is enabled
    if (
      isWslMode(prefs) &&
      expanded.startsWith('/') &&
      !expanded.startsWith('//') &&
      !mnt
    ) {
      const d1 = getEffectiveDistro(prefs?.wslDistro) ?? getDefaultWslDistro();
      if (d1) add(wslPathToWin(expanded, d1));
      const d2 = getDefaultWslDistro();
      if (d2 && d2 !== d1) add(wslPathToWin(expanded, d2));
    }
    // Avoid `path.resolve('/mnt/...')` on win32 (non-drive "absolute" paths mis-resolve)
    const unixy = expanded.startsWith('/') && !expanded.startsWith('//');
    if (!unixy) {
      add(expanded);
    }
  } else {
    add(expanded);
  }

  if (isWin) {
    const primary = out[0];
    if (
      primary &&
      /^[A-Za-z]:\\/.test(primary) &&
      primary.length >= 240 &&
      !primary.startsWith('\\\\?\\')
    ) {
      add(`\\\\?\\${primary}`);
    }
  }

  return out;
}

/** Extensions accepted for terminal backdrop images (main + renderer browse filters). */
export const BACKGROUND_IMAGE_EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

export type BackgroundImageReadResult = { mime: string; data: Buffer };

/** Extra strings to try for `fs.stat` (Windows drive paths + mixed slashes). */
function fsPathStatVariants(candidate: string): string[] {
  const out: string[] = [];
  const add = (p: string) => {
    if (p && !out.includes(p)) out.push(p);
  };
  add(candidate);
  if (isWin) {
    try {
      add(path.win32.normalize(candidate));
    } catch {
      /* ignore */
    }
    const m = candidate.match(/^([A-Za-z]):[\\/]+(.*)$/);
    if (m) {
      add(`${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`);
    }
  }
  return out;
}

/** Read image bytes from disk (used for renderer Blob URLs — avoids huge data: strings over IPC/CSS). */
export async function readBackgroundImageBuffer(
  raw: unknown,
  prefs: Preferences | undefined,
  options: { maxBytes: number; extToMime?: Record<string, string> },
): Promise<BackgroundImageReadResult | null> {
  const s = sanitizeBackgroundImagePath(raw);
  if (!s) return null;
  const extToMime = { ...BACKGROUND_IMAGE_EXT_TO_MIME, ...options.extToMime };
  const expanded = expandUserPath(s);

  /** Try dialog-style Windows paths before `resolvePathForMainProcess` (avoids rare resolve quirks). */
  const head: string[] = [];
  if (isWin && /^[A-Za-z]:[\\/]/.test(expanded)) {
    head.push(path.win32.normalize(expanded));
  }

  const primary = resolvePathForMainProcess(expanded);
  const rest = collectBackgroundImageCandidates(s, prefs);
  const candidates = [...head, primary, ...rest.filter((c) => c !== primary && !head.includes(c))];

  for (const candidate of candidates) {
    for (const tryPath of fsPathStatVariants(candidate)) {
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(tryPath);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size > options.maxBytes) continue;
      const ext = path.extname(tryPath).toLowerCase();
      const mime = extToMime[ext];
      if (!mime) continue;
      try {
        const data = await fs.readFile(tryPath);
        return { mime, data };
      } catch {
        continue;
      }
    }
  }
  return null;
}

export async function readBackgroundImageAsDataUrl(
  raw: unknown,
  prefs: Preferences | undefined,
  options: { maxBytes: number; extToMime?: Record<string, string> },
): Promise<string | null> {
  const hit = await readBackgroundImageBuffer(raw, prefs, options);
  if (!hit) return null;
  return `data:${hit.mime};base64,${hit.data.toString('base64')}`;
}

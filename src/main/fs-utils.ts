import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function expandUserPath(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

export function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function readDirSafe(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export const BINARY_SNIFF_BYTES = 8000;

export function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

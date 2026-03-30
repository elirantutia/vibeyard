import * as fs from 'fs';
import { execSync } from 'child_process';
import type { ReadinessCheck } from '../../shared/types';

export { readFileSafe, fileExists, dirExists, readDirSafe } from '../fs-utils';

export function getTrackedFiles(projectPath: string): string[] {
  try {
    const output = execSync('git ls-files', { cwd: projectPath, encoding: 'utf-8', timeout: 5000 });
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Counts lines in a file without reading the entire content into a single string.
 * Uses a buffer-based approach to avoid large string allocations.
 */
export function countFileLines(filePath: string): number {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let lines = 0;
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0x0a) lines++;
      }
    }
    // Account for final line without trailing newline
    const stat = fs.fstatSync(fd);
    if (stat.size > 0) lines++;
    return lines;
  } finally {
    fs.closeSync(fd);
  }
}

export function computeCategoryScore(checks: ReadinessCheck[]): number {
  const totalMax = checks.reduce((sum, c) => sum + c.maxScore, 0);
  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  return totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
}


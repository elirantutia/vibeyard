import * as fs from 'fs';
import { vi } from 'vitest';
import type { AnalysisContext } from './types';
import { buildVibeyardignoreMatcher } from '../vibeyardignore';

/**
 * Stubs the filesystem for readiness checkers against an in-memory `suffix -> content` map.
 * Keys are matched with `endsWith`, so the first key that matches wins — order a nested path
 * ahead of the bare filename when a test needs both.
 *
 * Covers both read paths the checkers use: `readFileSync` (whole-file reads) and the
 * `openSync`/`readSync`/`fstatSync`/`closeSync` quartet that `countFileLines` streams through.
 */
export function mockInstructionFiles(
  mockFs: typeof fs,
  files: Record<string, string>,
): void {
  const contentFor = (filePath: unknown): string | undefined =>
    Object.entries(files).find(([key]) => String(filePath).endsWith(key))?.[1];

  vi.mocked(mockFs.statSync).mockImplementation((filePath: fs.PathLike) => {
    if (contentFor(filePath) !== undefined) {
      return { isFile: () => true, isDirectory: () => false } as fs.Stats;
    }

    throw new Error('ENOENT');
  });

  vi.mocked(mockFs.readFileSync).mockImplementation((filePath: fs.PathOrFileDescriptor) => {
    const content = contentFor(filePath);

    if (content !== undefined) {
      return content;
    }

    throw new Error('ENOENT');
  });

  // Open file descriptors, keyed by the fd number handed back to the caller.
  const open = new Map<number, { buffer: Buffer; offset: number }>();
  let nextFd = 1;

  vi.mocked(mockFs.openSync).mockImplementation((filePath: fs.PathLike) => {
    const content = contentFor(filePath);
    if (content === undefined) throw new Error('ENOENT');
    const fd = nextFd++;
    open.set(fd, { buffer: Buffer.from(content, 'utf-8'), offset: 0 });
    return fd;
  });

  vi.mocked(mockFs.readSync).mockImplementation((fd: number, target: NodeJS.ArrayBufferView) => {
    const handle = open.get(fd);
    if (!handle) throw new Error('EBADF');
    const view = target as Buffer;
    // Buffer.copy clamps sourceEnd to the source length, so a short final read returns
    // fewer bytes and the next one returns 0, terminating countFileLines' loop.
    const copied = handle.buffer.copy(view, 0, handle.offset, handle.offset + view.length);
    handle.offset += copied;
    return copied;
  });

  vi.mocked(mockFs.fstatSync).mockImplementation((fd: number) => {
    const handle = open.get(fd);
    if (!handle) throw new Error('EBADF');
    return { size: handle.buffer.length } as fs.Stats;
  });

  vi.mocked(mockFs.closeSync).mockImplementation((fd: number) => {
    open.delete(fd);
  });
}

/**
 * An `AnalysisContext` for checker tests. `isIgnored` is built from the mocked filesystem,
 * so a test that stubs `.vibeyardignore` gets a real matcher; with no stub nothing is ignored.
 */
export function makeAnalysisContext(trackedFiles: string[] = [], projectPath = '/test/project'): AnalysisContext {
  return { trackedFiles, isIgnored: buildVibeyardignoreMatcher(projectPath) };
}

/** `n` lines of filler — for exercising the instruction-file size thresholds. */
export function linesOf(n: number): string {
  return Array(n).fill('line').join('\n');
}

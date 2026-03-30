import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { genericContextProducer } from './context-optimization';
import type { AnalysisContext } from '../types';

vi.mock('fs');
vi.mock('child_process');

const mockFs = vi.mocked(fs);
const mockCp = vi.mocked(child_process);

beforeEach(() => {
  vi.resetAllMocks();
});

function makeCtx(trackedFiles: string[]): AnalysisContext {
  return { trackedFiles };
}

/** Mock .vibeyardignore auto-creation: writeFileSync captures content, readFileSync returns it after creation. */
function mockVibeyardignoreAutoCreate(): void {
  let vibeyardignoreContent: string | null = null;
  mockFs.writeFileSync.mockImplementation((_p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
    if (String(_p).endsWith('.vibeyardignore')) vibeyardignoreContent = String(data);
  });
  mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
    if (String(p).endsWith('.vibeyardignore') && vibeyardignoreContent) return vibeyardignoreContent;
    throw new Error('ENOENT');
  });
}

/** Mock fs.openSync/readSync/fstatSync/closeSync to simulate reading a file with countFileLines. */
function mockCountFileLines(fileContents: Record<string, string>): void {
  const buffers = new Map<string, Buffer>();
  for (const [name, content] of Object.entries(fileContents)) {
    buffers.set(name, Buffer.from(content, 'utf-8'));
  }

  let nextFd = 10;
  const fdToFile = new Map<number, string>();
  const fdOffset = new Map<number, number>();

  mockFs.openSync.mockImplementation((p: fs.PathLike) => {
    const filePath = String(p);
    const match = [...buffers.keys()].find(name => filePath.endsWith(name));
    if (!match) throw new Error('ENOENT');
    const fd = nextFd++;
    fdToFile.set(fd, match);
    fdOffset.set(fd, 0);
    return fd;
  });

  mockFs.readSync.mockImplementation((fd: number, buf: NodeJS.ArrayBufferView) => {
    const fileName = fdToFile.get(fd);
    if (!fileName) return 0;
    const src = buffers.get(fileName)!;
    const offset = fdOffset.get(fd) ?? 0;
    if (offset >= src.length) return 0;
    const target = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const chunk = Math.min(target.length, src.length - offset);
    src.copy(target, 0, offset, offset + chunk);
    fdOffset.set(fd, offset + chunk);
    return chunk;
  });

  mockFs.fstatSync.mockImplementation((fd: number) => {
    const fileName = fdToFile.get(fd);
    const size = fileName ? (buffers.get(fileName)?.length ?? 0) : 0;
    return { size } as fs.Stats;
  });

  mockFs.closeSync.mockImplementation(() => {});
}

describe('genericContextProducer', () => {
  it('returns tagged check with context category', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = genericContextProducer.produce('/test/project', makeCtx([]));

    expect(tagged).toHaveLength(1);
    expect(tagged[0].category).toBe('context');
    expect(tagged[0].check.id).toBe('large-files');
    expect(tagged[0].check.providerIds).toBeUndefined();
  });

  it('creates .vibeyardignore with default patterns when it does not exist', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockVibeyardignoreAutoCreate();
    mockCountFileLines({ 'small.ts': Array(100).fill('line').join('\n') });

    genericContextProducer.produce('/test/project', makeCtx(['small.ts']));

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.vibeyardignore'),
      expect.stringContaining('package-lock.json'),
      'utf-8',
    );
    const writtenContent = String(mockFs.writeFileSync.mock.calls[0][1]);
    expect(writtenContent).toContain('*.min.js');
    expect(writtenContent).toContain('*.generated.*');
  });

  it('does not overwrite existing .vibeyardignore', () => {
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('.vibeyardignore')) return 'custom-pattern.ts\n';
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.vibeyardignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockFs.writeFileSync.mockImplementation(() => {});
    mockCountFileLines({ 'small.ts': Array(100).fill('line').join('\n') });

    genericContextProducer.produce('/test/project', makeCtx(['small.ts']));

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('detects large files', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockVibeyardignoreAutoCreate();
    mockCountFileLines({ 'big.ts': Array(6000).fill('line').join('\n') });

    const tagged = genericContextProducer.produce('/test/project', makeCtx(['big.ts', 'small.ts']));
    const check = tagged.find(t => t.check.id === 'large-files')!.check;
    expect(check.status).toBe('warning');
    expect(check.description).toContain('.vibeyardignore');
  });

  it('passes when no large files found', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockVibeyardignoreAutoCreate();
    mockCountFileLines({ 'small.ts': Array(100).fill('line').join('\n') });

    const tagged = genericContextProducer.produce('/test/project', makeCtx(['small.ts']));
    const check = tagged.find(t => t.check.id === 'large-files')!.check;
    expect(check.status).toBe('pass');
  });

  it('ignores package-lock.json via auto-created .vibeyardignore defaults', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockVibeyardignoreAutoCreate();
    mockCountFileLines({ 'package-lock.json': Array(20000).fill('{}').join('\n') });

    const tagged = genericContextProducer.produce('/test/project', makeCtx(['package-lock.json']));
    const check = tagged.find(t => t.check.id === 'large-files')!.check;
    expect(check.status).toBe('pass');
  });

  it('applies custom .vibeyardignore patterns', () => {
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('.vibeyardignore')) return 'generated-data.json\n';
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.vibeyardignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockFs.writeFileSync.mockImplementation(() => {});
    mockCountFileLines({ 'generated-data.json': Array(8000).fill('data').join('\n') });

    const tagged = genericContextProducer.produce('/test/project', makeCtx(['generated-data.json']));
    const check = tagged.find(t => t.check.id === 'large-files')!.check;
    expect(check.status).toBe('pass');
  });

  it('still flags large files not matching any ignore pattern', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockVibeyardignoreAutoCreate();
    mockCountFileLines({
      'big-module.ts': Array(6000).fill('line').join('\n'),
      'package-lock.json': Array(20000).fill('{}').join('\n'),
    });

    const tagged = genericContextProducer.produce('/test/project', makeCtx(['big-module.ts', 'package-lock.json']));
    const check = tagged.find(t => t.check.id === 'large-files')!.check;
    expect(check.status).toBe('warning');
    expect(check.description).toContain('big-module.ts');
    expect(check.description).not.toContain('package-lock.json');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { contextOptimizationChecker } from './context-optimization';

vi.mock('fs');
vi.mock('child_process');

const mockFs = vi.mocked(fs);
const mockCp = vi.mocked(child_process);

beforeEach(() => {
  vi.resetAllMocks();
});

/** Mock .ccideignore auto-creation: writeFileSync captures content, readFileSync returns it after creation. */
function mockCcideignoreAutoCreate(): void {
  let ccideignoreContent: string | null = null;
  mockFs.writeFileSync.mockImplementation((_p: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView) => {
    if (String(_p).endsWith('.ccideignore')) ccideignoreContent = String(data);
  });
  mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
    if (String(p).endsWith('.ccideignore') && ccideignoreContent) return ccideignoreContent;
    throw new Error('ENOENT');
  });
}

/** Mock fs.openSync/readSync/fstatSync/closeSync to simulate reading a file with countFileLines. */
function mockCountFileLines(fileContents: Record<string, string>): void {
  const buffers = new Map<string, Buffer>();
  for (const [name, content] of Object.entries(fileContents)) {
    buffers.set(name, Buffer.from(content, 'utf-8'));
  }

  // Track which fd maps to which file, and current read offset per fd
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

describe('contextOptimizationChecker', () => {
  it('returns pass when no CLAUDE.md and small project', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('a.ts\nb.ts\nc.ts\n');

    const result = await contextOptimizationChecker.analyze('/test/project');

    expect(result.id).toBe('context-optimization');
    expect(result.weight).toBe(0.2);
    // claude-md-bloat: pass (no file), claudeignore: pass (small project), large-files: pass
    expect(result.score).toBe(100);
  });

  it('warns for CLAUDE.md between 300-500 lines', async () => {
    const content = Array(400).fill('line').join('\n');
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('CLAUDE.md')) return content;
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-bloat')!;
    expect(check.status).toBe('warning');
    expect(check.score).toBe(50);
  });

  it('fails for CLAUDE.md over 500 lines', async () => {
    const content = Array(600).fill('line').join('\n');
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('CLAUDE.md')) return content;
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-bloat')!;
    expect(check.status).toBe('fail');
    expect(check.score).toBe(0);
  });

  it('passes .claudeignore check for small projects without file', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue(Array(50).fill(0).map((_, i) => `file${i}.ts`).join('\n'));

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claudeignore')!;
    expect(check.status).toBe('pass');
  });

  it('fails .claudeignore check for small projects with sensitive files', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('src/index.ts\n.env\ncredentials.json\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claudeignore')!;
    expect(check.status).toBe('fail');
    expect(check.description).toContain('sensitive files');
    expect(check.description).toContain('.env');
    expect(check.fixPrompt).toContain('.env');
  });

  it('fails .claudeignore check for small projects with .pem key files', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('src/app.ts\ncerts/server.pem\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claudeignore')!;
    expect(check.status).toBe('fail');
    expect(check.description).toContain('server.pem');
  });

  it('passes .claudeignore check for small projects with sensitive files when .claudeignore exists', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.claudeignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockCp.execSync.mockReturnValue('src/index.ts\n.env\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claudeignore')!;
    expect(check.status).toBe('pass');
  });

  it('fails .claudeignore check for large projects without file', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue(Array(300).fill(0).map((_, i) => `file${i}.ts`).join('\n'));

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claudeignore')!;
    expect(check.status).toBe('fail');
  });

  it('passes .claudeignore check when file exists', async () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.claudeignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockCp.execSync.mockReturnValue(Array(300).fill(0).map((_, i) => `file${i}.ts`).join('\n'));

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claudeignore')!;
    expect(check.status).toBe('pass');
  });

  it('creates .ccideignore with default patterns when it does not exist', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCcideignoreAutoCreate();
    mockCountFileLines({ 'small.ts': Array(100).fill('line').join('\n') });
    mockCp.execSync.mockReturnValue('small.ts\n');

    await contextOptimizationChecker.analyze('/test/project');

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.ccideignore'),
      expect.stringContaining('package-lock.json'),
      'utf-8',
    );
    // Verify all default patterns are in the written content
    const writtenContent = String(mockFs.writeFileSync.mock.calls[0][1]);
    expect(writtenContent).toContain('*.min.js');
    expect(writtenContent).toContain('*.generated.*');
    expect(writtenContent).toContain('# Files and patterns to exclude');
  });

  it('does not overwrite existing .ccideignore', async () => {
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('.ccideignore')) return 'custom-pattern.ts\n';
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.ccideignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockFs.writeFileSync.mockImplementation(() => {});
    mockCountFileLines({ 'small.ts': Array(100).fill('line').join('\n') });
    mockCp.execSync.mockReturnValue('small.ts\n');

    await contextOptimizationChecker.analyze('/test/project');

    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });

  it('loads patterns solely from .ccideignore file', async () => {
    // .ccideignore exists with only one pattern — default patterns should NOT be included
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('.ccideignore')) return 'custom-only.json\n';
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.ccideignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockFs.writeFileSync.mockImplementation(() => {});
    // package-lock.json is NOT in the .ccideignore, so it should be scanned
    mockCountFileLines({ 'package-lock.json': Array(20000).fill('{}').join('\n') });
    mockCp.execSync.mockReturnValue('package-lock.json\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'large-files')!;
    // package-lock.json is .json extension which is in TEXT_EXTENSIONS, and not ignored
    expect(check.status).toBe('warning');
    expect(check.description).toContain('package-lock.json');
  });

  it('detects large files', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCcideignoreAutoCreate();
    mockCountFileLines({ 'big.ts': Array(6000).fill('line').join('\n') });
    mockCp.execSync.mockReturnValue('big.ts\nsmall.ts\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'large-files')!;
    expect(check.status).toBe('warning');
    expect(check.description).toContain('.ccideignore');
  });

  it('passes when no large files found', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCcideignoreAutoCreate();
    mockCountFileLines({ 'small.ts': Array(100).fill('line').join('\n') });
    mockCp.execSync.mockReturnValue('small.ts\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'large-files')!;
    expect(check.status).toBe('pass');
  });

  it('ignores package-lock.json via auto-created .ccideignore defaults', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCcideignoreAutoCreate();
    mockCountFileLines({ 'package-lock.json': Array(20000).fill('{}').join('\n') });
    mockCp.execSync.mockReturnValue('package-lock.json\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'large-files')!;
    expect(check.status).toBe('pass');
  });

  it('ignores files matching *.min.js via auto-created .ccideignore defaults', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCcideignoreAutoCreate();
    mockCountFileLines({ 'vendor.min.js': Array(10000).fill('x').join('\n') });
    mockCp.execSync.mockReturnValue('vendor.min.js\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'large-files')!;
    expect(check.status).toBe('pass');
  });

  it('applies custom .ccideignore patterns', async () => {
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('.ccideignore')) return 'generated-data.json\n';
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.ccideignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockFs.writeFileSync.mockImplementation(() => {});
    mockCountFileLines({ 'generated-data.json': Array(8000).fill('data').join('\n') });
    mockCp.execSync.mockReturnValue('generated-data.json\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'large-files')!;
    expect(check.status).toBe('pass');
  });

  it('handles comments and blank lines in .ccideignore', async () => {
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('.ccideignore')) return '# ignore big data\n\ndata-dump.json\n  \n# end\n';
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.ccideignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockFs.writeFileSync.mockImplementation(() => {});
    mockCountFileLines({ 'data-dump.json': Array(8000).fill('data').join('\n') });
    mockCp.execSync.mockReturnValue('data-dump.json\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'large-files')!;
    expect(check.status).toBe('pass');
  });

  it('still flags large files not matching any ignore pattern', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCcideignoreAutoCreate();
    mockCountFileLines({
      'big-module.ts': Array(6000).fill('line').join('\n'),
      'package-lock.json': Array(20000).fill('{}').join('\n'),
    });
    mockCp.execSync.mockReturnValue('big-module.ts\npackage-lock.json\n');

    const result = await contextOptimizationChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'large-files')!;
    expect(check.status).toBe('warning');
    expect(check.description).toContain('big-module.ts');
    expect(check.description).not.toContain('package-lock.json');
  });
});

import { vi } from 'vitest';
import * as path from 'path';

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

import { expandUserPath, isBinaryBuffer } from './fs-utils';

const home = '/mock/home';

describe('expandUserPath', () => {
  it('expands ~ alone to homedir', () => {
    expect(expandUserPath('~')).toBe(path.join(home));
  });

  it('expands ~/subdir to homedir/subdir', () => {
    expect(expandUserPath('~/git/my-project')).toBe(path.join(home, 'git/my-project'));
  });

  it('expands ~/ (trailing slash only) to homedir with trailing slash', () => {
    expect(expandUserPath('~/')).toBe(path.join(home, '/'));
  });

  it('leaves absolute paths unchanged', () => {
    expect(expandUserPath('/absolute/path/to/project')).toBe('/absolute/path/to/project');
  });

  it('leaves relative paths unchanged', () => {
    expect(expandUserPath('relative/path')).toBe('relative/path');
  });

  it('does not expand ~username paths', () => {
    expect(expandUserPath('~otheruser/projects')).toBe('~otheruser/projects');
  });

  it('does not expand empty string', () => {
    expect(expandUserPath('')).toBe('');
  });
});

describe('isBinaryBuffer', () => {
  it('returns false for empty buffer', () => {
    expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false);
  });

  it('returns false for plain ASCII text', () => {
    expect(isBinaryBuffer(Buffer.from('hello world\nline two'))).toBe(false);
  });

  it('returns false for UTF-8 with multi-byte codepoints', () => {
    expect(isBinaryBuffer(Buffer.from('héllo 你好 🚀', 'utf-8'))).toBe(false);
  });

  it('returns true when a null byte is present in the first chunk', () => {
    const buf = Buffer.concat([Buffer.from('header'), Buffer.from([0x00]), Buffer.from('rest')]);
    expect(isBinaryBuffer(buf)).toBe(true);
  });

  it('only sniffs the first 8000 bytes', () => {
    const head = Buffer.alloc(8000, 0x41);
    const tail = Buffer.from([0x00]);
    expect(isBinaryBuffer(Buffer.concat([head, tail]))).toBe(false);
  });

  it('flags a buffer that starts with a null byte', () => {
    expect(isBinaryBuffer(Buffer.from([0x00, 0x01, 0x02]))).toBe(true);
  });
});

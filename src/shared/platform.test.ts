import { describe, it, expect } from 'vitest';
import { basename, dirname, isAbsolutePath, isPathUnder, lastSeparatorIndex, samePath } from './platform';

describe('basename', () => {
  it('extracts last segment from POSIX paths', () => {
    expect(basename('/home/user/project')).toBe('project');
    expect(basename('/usr/local/bin')).toBe('bin');
  });

  it('extracts last segment from Windows paths', () => {
    expect(basename('C:\\Users\\me\\MyProject')).toBe('MyProject');
    expect(basename('D:\\dev\\app')).toBe('app');
  });

  it('handles mixed separators', () => {
    expect(basename('C:\\Users/me\\project')).toBe('project');
    expect(basename('/home\\user/project')).toBe('project');
  });

  it('handles trailing separators', () => {
    expect(basename('/home/user/project/')).toBe('project');
    expect(basename('C:\\Users\\me\\project\\')).toBe('project');
  });

  it('handles single segment', () => {
    expect(basename('project')).toBe('project');
  });

  it('returns the path for empty string', () => {
    expect(basename('')).toBe('');
  });

  it('handles root paths', () => {
    expect(basename('/')).toBe('');
    expect(basename('C:\\')).toBe('C:');
  });
});

describe('lastSeparatorIndex', () => {
  it('finds last forward slash', () => {
    expect(lastSeparatorIndex('/home/user/project')).toBe(10);
  });

  it('finds last backslash', () => {
    expect(lastSeparatorIndex('C:\\Users\\me')).toBe(8);
  });

  it('finds whichever separator comes last in mixed paths', () => {
    expect(lastSeparatorIndex('C:\\Users/me')).toBe(8);
    expect(lastSeparatorIndex('C:/Users\\me')).toBe(8);
  });

  it('returns -1 when no separator present', () => {
    expect(lastSeparatorIndex('project')).toBe(-1);
    expect(lastSeparatorIndex('')).toBe(-1);
  });
});

describe('isAbsolutePath', () => {
  it('detects POSIX absolute paths', () => {
    expect(isAbsolutePath('/home/user/project')).toBe(true);
    expect(isAbsolutePath('/')).toBe(true);
  });

  it('detects Windows drive-letter paths with backslash', () => {
    expect(isAbsolutePath('C:\\Users\\me')).toBe(true);
    expect(isAbsolutePath('D:\\dev\\app\\file.ts')).toBe(true);
    expect(isAbsolutePath('z:\\lower\\case')).toBe(true);
  });

  it('detects Windows drive-letter paths with forward slash', () => {
    expect(isAbsolutePath('C:/Users/me')).toBe(true);
    expect(isAbsolutePath('D:/dev/app')).toBe(true);
  });

  it('detects UNC and backslash-rooted paths', () => {
    expect(isAbsolutePath('\\\\server\\share')).toBe(true);
    expect(isAbsolutePath('\\Windows\\System32')).toBe(true);
  });

  it('rejects relative paths', () => {
    expect(isAbsolutePath('src/file.ts')).toBe(false);
    expect(isAbsolutePath('file.ts')).toBe(false);
    expect(isAbsolutePath('./file.ts')).toBe(false);
    expect(isAbsolutePath('../file.ts')).toBe(false);
  });

  it('rejects drive letter without trailing separator', () => {
    expect(isAbsolutePath('C:')).toBe(false);
    expect(isAbsolutePath('C:file.ts')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAbsolutePath('')).toBe(false);
  });
});

describe('dirname', () => {
  it('returns parent for POSIX paths', () => {
    expect(dirname('/home/user/project')).toBe('/home/user');
    expect(dirname('/home/user/file.ts')).toBe('/home/user');
  });

  it('returns parent for Windows paths', () => {
    expect(dirname('C:\\Users\\me\\file.ts')).toBe('C:\\Users\\me');
  });

  it('handles trailing separators', () => {
    expect(dirname('/home/user/project/')).toBe('/home/user');
  });

  it('returns root for top-level entries', () => {
    expect(dirname('/file.ts')).toBe('/');
  });

  it('returns . when no separator present', () => {
    expect(dirname('file.ts')).toBe('.');
  });
});

describe('isPathUnder', () => {
  it('matches a path against itself', () => {
    expect(isPathUnder('/a/b', '/a/b')).toBe(true);
  });

  it('matches nested descendants', () => {
    expect(isPathUnder('/a/b/c', '/a/b')).toBe(true);
    expect(isPathUnder('C:\\a\\b\\c', 'C:\\a\\b')).toBe(true);
  });

  it('does not false-match a sibling sharing a name prefix', () => {
    expect(isPathUnder('/a/bcd', '/a/b')).toBe(false);
    expect(isPathUnder('/proj/srcfoo', '/proj/src')).toBe(false);
  });

  it('matches across separator styles right after the parent', () => {
    expect(isPathUnder('/a/b\\c', '/a/b')).toBe(true);
  });
});

describe('samePath', () => {
  it('is true for identical paths', () => {
    expect(samePath('/a/b/c.ts', '/a/b/c.ts')).toBe(true);
  });

  it('ignores separator style (the Windows mixed-separator case)', () => {
    expect(samePath('C:\\proj/file.ts', 'C:\\proj\\file.ts')).toBe(true);
    expect(samePath('/a/b/c', '\\a\\b\\c')).toBe(true);
  });

  it('is false for genuinely different paths', () => {
    expect(samePath('/a/b/c.ts', '/a/b/d.ts')).toBe(false);
  });
});

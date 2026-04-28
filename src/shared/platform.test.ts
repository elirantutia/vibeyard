import { describe, it, expect } from 'vitest';
import { basename, isAbsolutePath, lastSeparatorIndex, samePath } from './platform';

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

describe('samePath', () => {
  it('returns true for identical paths', () => {
    expect(samePath('/home/user/project', '/home/user/project', false)).toBe(true);
    expect(samePath('C:\\Users\\me', 'C:\\Users\\me', true)).toBe(true);
  });

  it('treats / and \\ as equivalent separators', () => {
    expect(samePath('C:/Users/me', 'C:\\Users\\me', true)).toBe(true);
    expect(samePath('/home/user', '\\home\\user', false)).toBe(true);
  });

  it('ignores casing when caseInsensitive is true', () => {
    expect(samePath('C:\\Users\\Me', 'c:\\users\\me', true)).toBe(true);
    expect(samePath('/Home/User', '/home/user', true)).toBe(true);
  });

  it('respects casing when caseInsensitive is false', () => {
    expect(samePath('/Home/User', '/home/user', false)).toBe(false);
    expect(samePath('C:\\Users\\Me', 'c:\\users\\me', false)).toBe(false);
  });

  it('ignores a single trailing separator', () => {
    expect(samePath('/home/user/', '/home/user', false)).toBe(true);
    expect(samePath('C:\\Users\\me\\', 'C:\\Users\\me', true)).toBe(true);
  });

  it('returns false when either side is empty or nullish', () => {
    expect(samePath(null, '/home', false)).toBe(false);
    expect(samePath('/home', undefined, false)).toBe(false);
    expect(samePath('', '/home', false)).toBe(false);
    expect(samePath('/home', '', false)).toBe(false);
  });

  it('rejects paths that differ beyond casing/separators', () => {
    expect(samePath('/home/user', '/home/other', false)).toBe(false);
    expect(samePath('C:\\Users\\me', 'D:\\Users\\me', true)).toBe(false);
  });
});

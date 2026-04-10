import { describe, it, expect } from 'vitest';
import { basename, lastSeparatorIndex } from './platform';

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

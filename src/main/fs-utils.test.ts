import { vi } from 'vitest';

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

import { expandUserPath } from './fs-utils';

describe('expandUserPath', () => {
  it('expands ~ alone to homedir', () => {
    expect(expandUserPath('~')).toBe('/mock/home');
  });

  it('expands ~/subdir to homedir/subdir', () => {
    expect(expandUserPath('~/git/my-project')).toBe('/mock/home/git/my-project');
  });

  it('expands ~/ (trailing slash only) to homedir with trailing slash', () => {
    expect(expandUserPath('~/')).toBe('/mock/home/');
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

import { vi } from 'vitest';
import * as path from 'path';

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

import { expandUserPath } from './fs-utils';

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

import { describe, it, expect } from 'vitest';
import { localProjectFolder } from './project-folder';

describe('localProjectFolder', () => {
  it('returns the path of a local project', () => {
    expect(localProjectFolder({ path: '/repo/app' })).toBe('/repo/app');
  });

  it('has no local folder for a remote project, the Temporary project, or an empty path', () => {
    expect(localProjectFolder({ path: '/srv/app', remoteHost: 'box' })).toBeUndefined();
    expect(localProjectFolder({ path: '', temporary: true })).toBeUndefined();
    expect(localProjectFolder({ path: '' })).toBeUndefined();
  });
});

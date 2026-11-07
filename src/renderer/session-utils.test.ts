import { describe, it, expect } from 'vitest';
import { isCliSession, isProjectVisible, locationFields, sessionLocation } from './session-utils';
import type { SessionType } from '../shared/types';

describe('isCliSession', () => {
  it('returns true when type is undefined (regular CLI session)', () => {
    expect(isCliSession({ type: undefined })).toBe(true);
    expect(isCliSession({})).toBe(true);
  });

  it.each<SessionType>([
    'mcp-inspector',
    'diff-viewer',
    'file-reader',
    'remote-terminal',
    'browser-tab',
    'project-tab',
    'kanban',
  ])('returns false for special pane type %s', (type) => {
    expect(isCliSession({ type })).toBe(false);
  });
});

describe('sessionLocation', () => {
  const local = { path: '/repo/app' };
  const remote = { path: '/srv/app', remoteHost: 'dev-linux' };

  it('uses the project path and no host for a plain local session', () => {
    expect(sessionLocation(local, {})).toEqual({ cwd: '/repo/app', host: undefined });
    expect(sessionLocation(local, undefined)).toEqual({ cwd: '/repo/app', host: undefined });
  });

  it('inherits the project remote host', () => {
    expect(sessionLocation(remote, {})).toEqual({ cwd: '/srv/app', host: 'dev-linux' });
  });

  it('lets an ad-hoc SSH session override a local or remote project', () => {
    const ssh = { sshHost: 'box', runPath: '/home/u/scratch' };
    expect(sessionLocation(local, ssh)).toEqual({ cwd: '/home/u/scratch', host: 'box' });
    expect(sessionLocation(remote, ssh)).toEqual({ cwd: '/home/u/scratch', host: 'box' });
  });

  it('runs a local ad-hoc session in its own folder, even in a remote project', () => {
    expect(sessionLocation(remote, { runPath: '/tmp/x' })).toEqual({ cwd: '/tmp/x', host: undefined });
  });

  it('ignores a host without a path', () => {
    expect(sessionLocation(local, { sshHost: 'box' })).toEqual({ cwd: '/repo/app', host: undefined });
  });
});

describe('locationFields', () => {
  it('copies a remote or local location and nothing else', () => {
    expect(locationFields({ runPath: '/p', sshHost: 'box' })).toEqual({ runPath: '/p', sshHost: 'box' });
    expect(locationFields({ runPath: '/p' })).toEqual({ runPath: '/p' });
    expect(locationFields({ sshHost: 'box' })).toEqual({});
  });
});

describe('isProjectVisible', () => {
  it('always shows a regular project', () => {
    expect(isProjectVisible({ sessions: [] })).toBe(true);
  });

  it('shows the Temporary project only while it holds a CLI session', () => {
    expect(isProjectVisible({ temporary: true, sessions: [] })).toBe(false);
    expect(isProjectVisible({ temporary: true, sessions: [{ id: 'k', type: 'kanban' } as never] })).toBe(false);
    expect(isProjectVisible({ temporary: true, sessions: [{ id: 's' } as never] })).toBe(true);
    expect(isProjectVisible({ temporary: true, sessions: [{ id: 's', detached: true } as never] })).toBe(true);
  });
});

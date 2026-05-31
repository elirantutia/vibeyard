import { describe, it, expect, beforeEach } from 'vitest';
import { getProjectStatus, projectInitial } from './project-status.js';
import {
  initSession,
  setHookStatus,
  setIdle,
  _resetForTesting,
} from './session-activity.js';

const project = (...ids: string[]) => ({ sessions: ids.map((id) => ({ id })) });

describe('getProjectStatus', () => {
  beforeEach(() => _resetForTesting());

  it('returns idle for a project with no sessions', () => {
    expect(getProjectStatus({ sessions: [] })).toBe('idle');
  });

  it('reflects a single session status', () => {
    initSession('s1'); // seeds 'waiting'
    expect(getProjectStatus(project('s1'))).toBe('waiting');
    setHookStatus('s1', 'working');
    expect(getProjectStatus(project('s1'))).toBe('working');
  });

  it('treats unknown/untracked sessions as idle', () => {
    expect(getProjectStatus(project('ghost'))).toBe('idle');
  });

  it('prioritises input > working > waiting > completed > idle', () => {
    initSession('input');
    setHookStatus('input', 'input');
    initSession('working');
    setHookStatus('working', 'working');
    initSession('waiting'); // 'waiting'
    initSession('completed');
    setHookStatus('completed', 'completed');
    initSession('idle');
    setIdle('idle');

    // All present → highest priority wins.
    expect(getProjectStatus(project('idle', 'completed', 'waiting', 'working', 'input'))).toBe('input');
    // Drop input → working wins.
    expect(getProjectStatus(project('idle', 'completed', 'waiting', 'working'))).toBe('working');
    // Drop working → waiting wins.
    expect(getProjectStatus(project('idle', 'completed', 'waiting'))).toBe('waiting');
    // Drop waiting → completed wins.
    expect(getProjectStatus(project('idle', 'completed'))).toBe('completed');
    // Only idle remains.
    expect(getProjectStatus(project('idle'))).toBe('idle');
  });
});

describe('projectInitial', () => {
  it('returns the uppercased first character', () => {
    expect(projectInitial('vibeyard')).toBe('V');
    expect(projectInitial('  forty-api')).toBe('F');
  });

  it('handles emoji/multibyte first characters', () => {
    expect(projectInitial('🚀 launcher')).toBe('🚀');
  });

  it('falls back to ? for an empty name', () => {
    expect(projectInitial('   ')).toBe('?');
    expect(projectInitial('')).toBe('?');
  });
});

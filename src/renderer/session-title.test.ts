import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: mockLoad, save: mockSave },
  },
});

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

vi.mock('./session-cost.js', () => ({
  getCost: vi.fn().mockReturnValue(null),
  restoreCost: vi.fn(),
}));

vi.mock('./session-context.js', () => ({
  restoreContext: vi.fn(),
}));

import { appState, _resetForTesting as resetAppState } from './state';
import { parseTitle, clearSession, _resetForTesting } from './session-title';

beforeEach(() => {
  _resetForTesting();
  resetAppState();
  uuidCounter = 0;
});

function addProjectAndSession(sessionName = 'Session 1') {
  appState.addProject('Test', '/test');
  const project = appState.activeProject!;
  const session = appState.addSession(project.id, sessionName)!;
  return { project, session };
}

describe('parseTitle', () => {
  it('extracts title from a valid separator line', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '───────────── my-conversation-title ──');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('my-conversation-title');
  });

  it('handles ANSI-wrapped separator lines', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '\x1b[90m───────────── styled-title ──\x1b[0m');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('styled-title');
  });

  it('ignores data without separator pattern', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, 'Hello, how can I help you?');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('Session 1');
  });

  it('does not extract text spanning across separate separator lines', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '────────────────────\r\n› i got a feedback from a user\r\n────────────────────');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('Session 1');
  });

  it('does not extract text between separator lines joined by \\r', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '────────────────────\reliran\r────────────────────');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('Session 1');
  });

  it('ignores plain separator lines without a title', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '────────────────────────────────────────────────────');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('Session 1');
    // Should still be able to pick up a real title later
    parseTitle(session.id, '───────────── real-title ──');
    expect(project.sessions.find((s) => s.id === session.id)!.name).toBe('real-title');
  });

  it('skips rename when userRenamed is true', () => {
    const { project, session } = addProjectAndSession();
    appState.renameSession(project.id, session.id, 'My Custom Name', true);
    parseTitle(session.id, '───────────── auto-title ──');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('My Custom Name');
  });

  it('stops scanning after first title found', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '───────────── first-title ──');
    parseTitle(session.id, '───────────── second-title ──');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('first-title');
  });

  it('respects autoTitleEnabled preference', () => {
    const { project, session } = addProjectAndSession();
    appState.setPreference('autoTitleEnabled', false);
    parseTitle(session.id, '───────────── should-not-apply ──');
    const updated = project.sessions.find((s) => s.id === session.id)!;
    expect(updated.name).toBe('Session 1');
  });

  it('ignores Claude Code version splash as auto-title', () => {
    const { project, session } = addProjectAndSession('upload');
    parseTitle(session.id, '───────────── Claude Code v2.1.108 ──');
    expect(project.sessions.find((s) => s.id === session.id)!.name).toBe('upload');
  });

  it('ignores Claude Code version splash without a v prefix', () => {
    const { project, session } = addProjectAndSession('Session 5');
    parseTitle(session.id, '───────────── Claude Code 2.1.108 ──');
    expect(project.sessions.find((s) => s.id === session.id)!.name).toBe('Session 5');
  });

  it('ignores Claude Code splash wrapped in markdown emphasis', () => {
    const { project, session } = addProjectAndSession('login');
    parseTitle(session.id, '───────────── *Claude Code v2.1.108* ──');
    expect(project.sessions.find((s) => s.id === session.id)!.name).toBe('login');
  });

  it('still applies a real title after skipping the Claude Code splash', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '───────────── Claude Code v2.1.108 ──');
    parseTitle(session.id, '───────────── mp3-upload-feature ──');
    expect(project.sessions.find((s) => s.id === session.id)!.name).toBe('mp3-upload-feature');
  });
});

describe('clearSession', () => {
  it('allows re-scanning after clear', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '───────────── first-title ──');
    expect(project.sessions.find((s) => s.id === session.id)!.name).toBe('first-title');
    clearSession(session.id);
    parseTitle(session.id, '───────────── second-title ──');
    expect(project.sessions.find((s) => s.id === session.id)!.name).toBe('second-title');
  });
});

describe('_resetForTesting', () => {
  it('clears all state', () => {
    const { project, session } = addProjectAndSession();
    parseTitle(session.id, '───────────── a-title ──');
    _resetForTesting();
    // After reset, same session can be titled again
    parseTitle(session.id, '───────────── new-title ──');
    expect(project.sessions.find((s) => s.id === session.id)!.name).toBe('new-title');
  });
});

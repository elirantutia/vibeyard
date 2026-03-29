import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleToolFailure, onLargeFileAlert, _resetForTesting, type LargeFileAlert } from './large-file-detector.js';
import { appState, _resetForTesting as resetState } from '../state.js';
import type { ToolFailureData } from '../../shared/types.js';

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: vi.fn().mockResolvedValue(null), save: vi.fn() },
    session: { onToolFailure: vi.fn() },
  },
});

beforeEach(() => {
  _resetForTesting();
  resetState();
});

function setupProject(): string {
  const project = appState.addProject('Test', '/tmp/test');
  return project.id;
}

function makeReadFailure(filePath: string, tokens = 28897, maxTokens = 10000): ToolFailureData {
  return {
    tool_name: 'Read',
    tool_input: { file_path: filePath },
    error: `File content (${tokens} tokens) exceeds maximum allowed tokens (${maxTokens}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
  };
}

describe('handleToolFailure', () => {
  it('emits alert when Read tool fails with token limit error', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].filePath).toBe('/path/to/styles.css');
    expect(alerts[0].projectId).toBe(projectId);
    expect(alerts[0].sessionId).toBe(session.id);
  });

  it('does not alert for non-Read tool failures', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, {
      tool_name: 'Bash',
      tool_input: { command: 'cat /path/to/styles.css' },
      error: 'File content (28897 tokens) exceeds maximum allowed tokens (10000).',
    });

    expect(alerts).toHaveLength(0);
  });

  it('does not alert for Read failures with other errors', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, {
      tool_name: 'Read',
      tool_input: { file_path: '/path/to/missing.txt' },
      error: 'ENOENT: no such file or directory',
    });

    expect(alerts).toHaveLength(0);
  });

  it('deduplicates: only alerts once per file per session', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));
    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));

    expect(alerts).toHaveLength(1);
  });

  it('alerts for different files in same session', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));
    handleToolFailure(session.id, makeReadFailure('/path/to/bundle.js'));

    expect(alerts).toHaveLength(2);
    expect(alerts[0].filePath).toBe('/path/to/styles.css');
    expect(alerts[1].filePath).toBe('/path/to/bundle.js');
  });

  it('alerts for same file in different sessions', () => {
    const projectId = setupProject();
    const s1 = appState.addSession(projectId, 'Session 1')!;
    const s2 = appState.addSession(projectId, 'Session 2')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(s1.id, makeReadFailure('/path/to/styles.css'));
    handleToolFailure(s2.id, makeReadFailure('/path/to/styles.css'));

    expect(alerts).toHaveLength(2);
  });

  it('does not alert when insight is dismissed', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    appState.dismissInsight(projectId, 'large-file-read:/path/to/styles.css');

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert when insights are disabled', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    appState.preferences.insightsEnabled = false;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));

    expect(alerts).toHaveLength(0);

    appState.preferences.insightsEnabled = true;
  });

  it('does not alert when session has no project', () => {
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure('orphan-session', makeReadFailure('/path/to/styles.css'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert when file_path is missing from tool_input', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, {
      tool_name: 'Read',
      tool_input: {},
      error: 'File content (28897 tokens) exceeds maximum allowed tokens (10000).',
    });

    expect(alerts).toHaveLength(0);
  });

  it('clears dedup state on session-removed', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));
    expect(alerts).toHaveLength(1);

    // Simulate session removal
    appState.emit('session-removed', { sessionId: session.id });

    // Same file in re-created session with same id should alert again
    const session2 = appState.addSession(projectId, 'Session 2')!;
    handleToolFailure(session2.id, makeReadFailure('/path/to/styles.css'));
    expect(alerts).toHaveLength(2);
  });

  it('_resetForTesting clears all state', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));
    expect(alerts).toHaveLength(1);

    _resetForTesting();

    const alerts2: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts2.push(alert));

    handleToolFailure(session.id, makeReadFailure('/path/to/styles.css'));
    expect(alerts2).toHaveLength(1);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleToolFailure, onToolAlert, classifyError, _resetForTesting, type ToolAlert } from './missing-tool-detector.js';
import { appState, _resetForTesting as resetState } from '../state.js';
import type { ToolFailureData } from '../../shared/types.js';
import type { ToolInfo } from './tool-catalog.js';

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

function makeFailure(command: string, error = 'Command exited with non-zero status code 127'): ToolFailureData {
  return {
    tool_name: 'Bash',
    tool_input: { command },
    error,
  };
}

describe('classifyError', () => {
  const baseTool: ToolInfo = { command: 'gh', name: 'GitHub CLI', description: 'test' };
  const toolWithAuth: ToolInfo = { ...baseTool, authPatterns: ['gh auth login', 'gh auth status'] };

  it('classifies "command not found" as not-found', () => {
    expect(classifyError('bash: gh: command not found', baseTool)).toBe('not-found');
  });

  it('classifies exit code 127 as not-found', () => {
    expect(classifyError('Command exited with non-zero status code 127', baseTool)).toBe('not-found');
  });

  it('classifies "/usr/bin/thing: not found" as not-found', () => {
    expect(classifyError('/usr/bin/thing: not found', baseTool)).toBe('not-found');
  });

  it('classifies "Permission denied" as permission-denied', () => {
    expect(classifyError('bash: ./script.sh: Permission denied', baseTool)).toBe('permission-denied');
  });

  it('classifies exit code 126 as permission-denied', () => {
    expect(classifyError('Command exited with non-zero status code 126', baseTool)).toBe('permission-denied');
  });

  it('classifies auth error with matching pattern as auth-required', () => {
    expect(classifyError('To get started with GitHub CLI, please run: gh auth login', toolWithAuth)).toBe('auth-required');
  });

  it('classifies auth status pattern as auth-required', () => {
    expect(classifyError('Try authenticating with: gh auth status', toolWithAuth)).toBe('auth-required');
  });

  it('does not classify auth error when tool has no authPatterns', () => {
    expect(classifyError('To get started with GitHub CLI, please run: gh auth login', baseTool)).toBe('other');
  });

  it('classifies "sh: gh: not found" as not-found', () => {
    expect(classifyError('sh: gh: not found', baseTool)).toBe('not-found');
  });

  it('does not classify GitHub API 404 as not-found', () => {
    expect(classifyError('Exit code 1 --- {"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}', baseTool)).toBe('other');
  });

  it('does not classify HTTP 404 as not-found', () => {
    expect(classifyError('Not Found (HTTP 404)', baseTool)).toBe('other');
  });

  it('does not classify "gh: Not Found (HTTP 404)" as not-found', () => {
    expect(classifyError('Exit code 1 gh: Not Found (HTTP 404) base64: stdin: (null): error decoding base64 input stream', baseTool)).toBe('other');
  });

  it('classifies generic errors as other', () => {
    expect(classifyError("error: pathspec 'foo' did not match any file(s)", baseTool)).toBe('other');
  });

  it('classifies empty error as other', () => {
    expect(classifyError('', baseTool)).toBe('other');
  });

  it('auth pattern matching is case-insensitive', () => {
    const tool: ToolInfo = { command: 'gcloud', name: 'Google Cloud CLI', description: 'test', authPatterns: ['unauthenticated'] };
    expect(classifyError('Error: UNAUTHENTICATED request', tool)).toBe('auth-required');
  });
});

describe('handleToolFailure', () => {
  it('emits alert for known missing tool (gh)', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].tool.command).toBe('gh');
    expect(alerts[0].projectId).toBe(projectId);
    expect(alerts[0].reason).toBe('not-found');
  });

  it('emits alert for known missing tool (jq)', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('jq .name file.json'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].tool.command).toBe('jq');
    expect(alerts[0].reason).toBe('not-found');
  });

  it('does not alert for unknown commands', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('some-unknown-tool --flag'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert for non-Bash tool failures', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, {
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/test.txt' },
      error: 'Permission denied',
    });

    expect(alerts).toHaveLength(0);
  });

  it('deduplicates: only alerts once per tool+reason per session', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list'));
    handleToolFailure(session.id, makeFailure('gh issue list'));

    expect(alerts).toHaveLength(1);
  });

  it('alerts separately for different tools in same session', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list'));
    handleToolFailure(session.id, makeFailure('jq .name file.json'));

    expect(alerts).toHaveLength(2);
  });

  it('alerts separately for same tool in different sessions', () => {
    const projectId = setupProject();
    const s1 = appState.addSession(projectId, 'Session 1')!;
    const s2 = appState.addSession(projectId, 'Session 2')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(s1.id, makeFailure('gh pr list'));
    handleToolFailure(s2.id, makeFailure('gh pr list'));

    expect(alerts).toHaveLength(2);
  });

  it('does not alert when insight is dismissed (new key)', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    appState.dismissInsight(projectId, 'tool-issue:gh:not-found');

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert when insight is dismissed (legacy key)', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    appState.dismissInsight(projectId, 'missing-tool:gh');

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert when insights are disabled', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    appState.preferences.insightsEnabled = false;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert when session has no project', () => {
    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure('orphan-session', makeFailure('gh pr list'));

    expect(alerts).toHaveLength(0);
  });

  it('handles empty command gracefully', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, {
      tool_name: 'Bash',
      tool_input: { command: '' },
      error: 'error',
    });

    expect(alerts).toHaveLength(0);
  });

  it('handles missing command field gracefully', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, {
      tool_name: 'Bash',
      tool_input: {},
      error: 'error',
    });

    expect(alerts).toHaveLength(0);
  });

  it('extracts command after sudo', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('sudo gh pr list'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].tool.command).toBe('gh');
    expect(alerts[0].reason).toBe('not-found');
  });

  it('extracts command after env vars', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('FOO=bar gh pr list'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].tool.command).toBe('gh');
    expect(alerts[0].reason).toBe('not-found');
  });

  it('falls back to first part when all parts are env vars', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    // All parts look like env vars — falls back to first part which is not a known tool
    handleToolFailure(session.id, makeFailure('FOO=bar BAZ=qux'));

    expect(alerts).toHaveLength(0);
  });

  it('clears dedup state when session is removed', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list'));
    expect(alerts).toHaveLength(1);

    // Simulate session removal
    appState.removeSession(projectId, session.id);

    // Re-add session with same ID pattern and try again
    const session2 = appState.addSession(projectId, 'Session 2')!;
    handleToolFailure(session2.id, makeFailure('gh pr list'));
    expect(alerts).toHaveLength(2);
  });

  it('does not alert for generic errors (classified as other)', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list', 'error: pathspec foo did not match'));

    expect(alerts).toHaveLength(0);
  });

  it('emits alert with permission-denied reason', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list', 'bash: /usr/local/bin/gh: Permission denied'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].reason).toBe('permission-denied');
  });

  it('emits alert with auth-required reason', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list', 'To get started with GitHub CLI, please run: gh auth login'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].reason).toBe('auth-required');
  });

  it('alerts for different reasons of same tool in same session', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list', 'bash: gh: command not found'));
    handleToolFailure(session.id, makeFailure('gh pr list', 'To get started: gh auth login'));

    expect(alerts).toHaveLength(2);
    expect(alerts[0].reason).toBe('not-found');
    expect(alerts[1].reason).toBe('auth-required');
  });
});

describe('_resetForTesting', () => {
  it('clears all module state', () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: ToolAlert[] = [];
    onToolAlert((alert) => alerts.push(alert));

    handleToolFailure(session.id, makeFailure('gh pr list'));
    expect(alerts).toHaveLength(1);

    _resetForTesting();

    // After reset, listeners cleared — new listener needed
    const alerts2: ToolAlert[] = [];
    onToolAlert((alert) => alerts2.push(alert));

    // Should alert again since dedup state is cleared
    handleToolFailure(session.id, makeFailure('gh pr list'));
    expect(alerts2).toHaveLength(1);
  });
});

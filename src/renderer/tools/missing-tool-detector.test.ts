import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleToolFailure, onToolAlert, _resetForTesting, type ToolAlert } from './missing-tool-detector.js';
import { appState, _resetForTesting as resetState } from '../state.js';
import type { ToolFailureData } from '../../shared/types.js';

vi.stubGlobal('window', {
  claudeIde: {
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

function makeFailure(command: string): ToolFailureData {
  return {
    tool_name: 'Bash',
    tool_input: { command },
    error: 'Command exited with non-zero status code 127',
  };
}

describe('missing-tool-detector', () => {
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
    });

    it('emits alert for known missing tool (jq)', () => {
      const projectId = setupProject();
      const session = appState.addSession(projectId, 'Session 1')!;

      const alerts: ToolAlert[] = [];
      onToolAlert((alert) => alerts.push(alert));

      handleToolFailure(session.id, makeFailure('jq .name file.json'));

      expect(alerts).toHaveLength(1);
      expect(alerts[0].tool.command).toBe('jq');
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

    it('deduplicates: only alerts once per tool per session', () => {
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

    it('does not alert when insight is dismissed', () => {
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
    });

    it('extracts command after env vars', () => {
      const projectId = setupProject();
      const session = appState.addSession(projectId, 'Session 1')!;

      const alerts: ToolAlert[] = [];
      onToolAlert((alert) => alerts.push(alert));

      handleToolFailure(session.id, makeFailure('FOO=bar gh pr list'));

      expect(alerts).toHaveLength(1);
      expect(alerts[0].tool.command).toBe('gh');
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
});

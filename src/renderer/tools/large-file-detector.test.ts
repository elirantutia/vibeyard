import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleToolFailure, onLargeFileAlert, _resetForTesting, type LargeFileAlert } from './large-file-detector.js';
import { appState, _resetForTesting as resetState } from '../state.js';
import type { ToolFailureData } from '../../shared/types.js';

const mockReadFile = vi.fn().mockResolvedValue('');

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: vi.fn().mockResolvedValue(null), save: vi.fn() },
    session: { onToolFailure: vi.fn() },
    fs: { readFile: mockReadFile },
  },
});

beforeEach(() => {
  _resetForTesting();
  resetState();
  mockReadFile.mockResolvedValue('');
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
  it('emits alert when Read tool fails with token limit error', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0].filePath).toBe('/tmp/test/styles.css');
    expect(alerts[0].projectId).toBe(projectId);
    expect(alerts[0].sessionId).toBe(session.id);
  });

  it('does not alert for non-Read tool failures', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, {
      tool_name: 'Bash',
      tool_input: { command: 'cat /tmp/test/styles.css' },
      error: 'File content (28897 tokens) exceeds maximum allowed tokens (10000).',
    });

    expect(alerts).toHaveLength(0);
  });

  it('does not alert for Read failures with other errors', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, {
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test/missing.txt' },
      error: 'ENOENT: no such file or directory',
    });

    expect(alerts).toHaveLength(0);
  });

  it('deduplicates: only alerts once per file per session', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));
    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));

    expect(alerts).toHaveLength(1);
  });

  it('alerts for different files in same session', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));
    await handleToolFailure(session.id, makeReadFailure('/tmp/test/app.ts'));

    expect(alerts).toHaveLength(2);
    expect(alerts[0].filePath).toBe('/tmp/test/styles.css');
    expect(alerts[1].filePath).toBe('/tmp/test/app.ts');
  });

  it('alerts for same file in different sessions', async () => {
    const projectId = setupProject();
    const s1 = appState.addSession(projectId, 'Session 1')!;
    const s2 = appState.addSession(projectId, 'Session 2')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(s1.id, makeReadFailure('/tmp/test/styles.css'));
    await handleToolFailure(s2.id, makeReadFailure('/tmp/test/styles.css'));

    expect(alerts).toHaveLength(2);
  });

  it('does not alert for files outside the project path', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/Users/someone/.claude/projects/-foo/tool-results/b2r1bcdof.txt'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert for files in .claude/ within the project', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/.claude/settings.json'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert when insight is dismissed', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    appState.dismissInsight(projectId, 'large-file-read:/tmp/test/styles.css');

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert when insights are disabled', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    appState.preferences.insightsEnabled = false;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));

    expect(alerts).toHaveLength(0);

    appState.preferences.insightsEnabled = true;
  });

  it('does not alert when session has no project', async () => {
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure('orphan-session', makeReadFailure('/tmp/test/styles.css'));

    expect(alerts).toHaveLength(0);
  });

  it('does not alert when file_path is missing from tool_input', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, {
      tool_name: 'Read',
      tool_input: {},
      error: 'File content (28897 tokens) exceeds maximum allowed tokens (10000).',
    });

    expect(alerts).toHaveLength(0);
  });

  it('clears dedup state on session-removed', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));
    expect(alerts).toHaveLength(1);

    // Simulate session removal
    appState.emit('session-removed', { sessionId: session.id });

    // Same file in re-created session with same id should alert again
    const session2 = appState.addSession(projectId, 'Session 2')!;
    await handleToolFailure(session2.id, makeReadFailure('/tmp/test/styles.css'));
    expect(alerts).toHaveLength(2);
  });

  it('_resetForTesting clears all state', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;

    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));
    expect(alerts).toHaveLength(1);

    _resetForTesting();

    const alerts2: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts2.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/styles.css'));
    expect(alerts2).toHaveLength(1);
  });

  // --- Directory exclusions ---

  it('does not alert for files in node_modules/', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/node_modules/lodash/index.js'));
    expect(alerts).toHaveLength(0);
  });

  it('does not alert for files in dist/', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/dist/bundle.js'));
    expect(alerts).toHaveLength(0);
  });

  it.each(['build', 'out', '.next', 'coverage'])('does not alert for files in %s/', async (dir) => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure(`/tmp/test/${dir}/large-file.js`));
    expect(alerts).toHaveLength(0);
  });

  it('does not alert for deeply nested excluded directory', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/packages/web/node_modules/react/index.js'));
    expect(alerts).toHaveLength(0);
  });

  // --- File pattern exclusions ---

  it.each([
    ['package-lock.json', '/tmp/test/package-lock.json'],
    ['yarn.lock', '/tmp/test/yarn.lock'],
    ['pnpm-lock.yaml', '/tmp/test/pnpm-lock.yaml'],
  ])('does not alert for lock file: %s', async (_name, filePath) => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure(filePath));
    expect(alerts).toHaveLength(0);
  });

  it.each([
    ['*.min.js', '/tmp/test/vendor/jquery.min.js'],
    ['*.min.css', '/tmp/test/styles/app.min.css'],
    ['*.map', '/tmp/test/dist-local/app.js.map'],
    ['*.wasm', '/tmp/test/pkg/module.wasm'],
    ['*.bundle.*', '/tmp/test/assets/main.bundle.css'],
  ])('does not alert for pattern %s', async (_pattern, filePath) => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    await handleToolFailure(session.id, makeReadFailure(filePath));
    expect(alerts).toHaveLength(0);
  });

  // --- .vibeyardignore exclusions ---

  it('does not alert for files matching .vibeyardignore patterns', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    mockReadFile.mockResolvedValue('# Large generated files\nsrc/generated/**\n');

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/src/generated/schema.ts'));
    expect(alerts).toHaveLength(0);
  });

  it('still alerts for files not matching .vibeyardignore patterns', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    mockReadFile.mockResolvedValue('src/generated/**\n');

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/src/app/main.ts'));
    expect(alerts).toHaveLength(1);
  });

  it('handles missing .vibeyardignore gracefully', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/src/app.ts'));
    expect(alerts).toHaveLength(1);
  });

  it('caches .vibeyardignore patterns per project', async () => {
    const projectId = setupProject();
    const session = appState.addSession(projectId, 'Session 1')!;
    const alerts: LargeFileAlert[] = [];
    onLargeFileAlert((alert) => alerts.push(alert));

    mockReadFile.mockResolvedValue('*.test.ts\n');
    mockReadFile.mockClear();

    await handleToolFailure(session.id, makeReadFailure('/tmp/test/src/app.ts'));
    await handleToolFailure(session.id, makeReadFailure('/tmp/test/src/utils.ts'));

    // readFile should only be called once (cached)
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(alerts).toHaveLength(2);
  });
});

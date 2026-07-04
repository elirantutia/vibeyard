import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('window', {
  vibeyard: { store: { load: vi.fn(), save: vi.fn() } },
});

let uuidCounter = 0;
vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++uuidCounter}` });

const mockGetCost = vi.fn().mockReturnValue(null);
const mockGetContext = vi.fn().mockReturnValue(null);

vi.mock('../../session-cost.js', () => ({
  getCost: (...args: unknown[]) => mockGetCost(...args),
  restoreCost: vi.fn(),
  formatTokens: (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'm';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  },
}));
vi.mock('../../session-context.js', () => ({
  getContext: (...args: unknown[]) => mockGetContext(...args),
  restoreContext: vi.fn(),
  getContextSeverity: (pct: number) => (pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : ''),
}));
vi.mock('../../session-activity.js', () => ({
  getStatus: vi.fn().mockReturnValue(null),
  onChange: vi.fn(() => () => {}),
}));
vi.mock('../../provider-availability.js', () => ({
  getProviderCapabilities: vi.fn(),
  hasMultipleAvailableProviders: vi.fn(() => false),
}));
vi.mock('../terminal-pane.js', () => ({ setPendingPrompt: vi.fn() }));
vi.mock('./board-task-modal.js', () => ({ showTaskModal: vi.fn() }));
vi.mock('./board-context-menu.js', () => ({ showContextMenu: vi.fn() }));
vi.mock('../modal.js', () => ({ showConfirmModal: vi.fn() }));

// Minimal DOM stubs (mirrors share-dialog.test.ts approach)
type StubEl = {
  tagName: string;
  className: string;
  textContent: string;
  innerHTML: string;
  title: string;
  draggable: boolean;
  dataset: Record<string, string>;
  children: StubEl[];
  _listeners: Record<string, Function[]>;
  appendChild(child: StubEl): StubEl;
  addEventListener(event: string, cb: Function): void;
  querySelector(): null;
};

function makeEl(tag = 'div'): StubEl {
  const el: StubEl = {
    tagName: tag,
    className: '',
    textContent: '',
    innerHTML: '',
    title: '',
    draggable: false,
    dataset: {},
    children: [],
    _listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(event, cb) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(cb);
    },
    querySelector: () => null,
  };
  return el;
}

vi.stubGlobal('document', {
  createElement: (tag: string) => makeEl(tag),
  createTextNode: (text: string) => ({ textContent: text, nodeType: 3 }),
});

import { appState, _resetForTesting } from '../../state';
import { addTask } from '../../board-state';
import {
  createCardElement,
  updateMetricsRow,
  runTask,
} from './board-card';
import { hasMultipleAvailableProviders } from '../../provider-availability.js';
import type { CostInfo, ContextWindowInfo } from '../../../shared/types.js';

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  _resetForTesting();
  mockGetCost.mockReturnValue(null);
  mockGetContext.mockReturnValue(null);

  const project = appState.addProject('Test', '/test');
  project.board = {
    columns: [
      { id: 'col-backlog', title: 'Backlog', order: 0, behavior: 'inbox' },
      { id: 'col-active', title: 'Active', order: 1, behavior: 'active' },
      { id: 'col-done', title: 'Done', order: 2, behavior: 'terminal' },
    ],
    tasks: [],
  };
});

const fullCost: CostInfo = {
  totalCostUsd: 0.0034,
  totalInputTokens: 1200,
  totalOutputTokens: 300,
  cacheReadTokens: 500,
  cacheCreationTokens: 100,
  totalDurationMs: 4500,
  totalApiDurationMs: 2200,
  model: 'sonnet',
};

const fullCtx: ContextWindowInfo = {
  totalTokens: 100_000,
  contextWindowSize: 200_000,
  usedPercentage: 50,
};

describe('updateMetricsRow', () => {
  it('renders cost, tokens, and ctx % when all available', () => {
    const row = makeEl() as unknown as HTMLElement;
    updateMetricsRow(row, fullCost, fullCtx);
    const stub = row as unknown as StubEl;
    expect(stub.children).toHaveLength(3);
    expect(stub.children[0].textContent).toBe('$0.0034');
    expect(stub.children[1].textContent).toBe('1.5k');
    expect(stub.children[2].textContent).toBe('50%');
    expect(stub.children[2].className).toBe('card-ctx');
  });

  it('omits ctx when null', () => {
    const row = makeEl() as unknown as HTMLElement;
    updateMetricsRow(row, fullCost, null);
    const stub = row as unknown as StubEl;
    expect(stub.children).toHaveLength(2);
    expect(stub.children[0].textContent).toBe('$0.0034');
    expect(stub.children[1].textContent).toBe('1.5k');
  });

  it('omits tokens when total is 0', () => {
    const row = makeEl() as unknown as HTMLElement;
    const noTokens: CostInfo = { ...fullCost, totalInputTokens: 0, totalOutputTokens: 0 };
    updateMetricsRow(row, noTokens, null);
    const stub = row as unknown as StubEl;
    expect(stub.children).toHaveLength(1);
    expect(stub.children[0].textContent).toBe('$0.0034');
  });

  it('uses archivedCost when live cost is null', () => {
    const row = makeEl() as unknown as HTMLElement;
    const archived = {
      totalCostUsd: 0.05,
      totalInputTokens: 800,
      totalOutputTokens: 200,
      totalDurationMs: 3000,
    };
    updateMetricsRow(row, null, null, archived);
    const stub = row as unknown as StubEl;
    expect(stub.children).toHaveLength(2);
    expect(stub.children[0].textContent).toBe('$0.0500');
    expect(stub.children[1].textContent).toBe('1k');
  });

  it('applies critical class at 90%+', () => {
    const row = makeEl() as unknown as HTMLElement;
    updateMetricsRow(row, fullCost, { ...fullCtx, usedPercentage: 92 });
    const stub = row as unknown as StubEl;
    expect(stub.children[2].className).toBe('card-ctx critical');
    expect(stub.children[2].textContent).toBe('92%');
  });

  it('renders nothing when all sources empty', () => {
    const row = makeEl() as unknown as HTMLElement;
    updateMetricsRow(row, null, null, null);
    const stub = row as unknown as StubEl;
    expect(stub.children).toHaveLength(0);
  });
});

describe('createCardElement metrics row', () => {
  it('builds metrics row when sessionId has live cost', () => {
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-active' })!;
    task.sessionId = 'sess-1';
    mockGetCost.mockReturnValue(fullCost);
    mockGetContext.mockReturnValue(fullCtx);

    const card = createCardElement(task) as unknown as StubEl;
    const row = card.children.find((c) => c.className === 'board-card-metrics');
    expect(row).toBeTruthy();
    expect(row!.dataset.sessionId).toBe('sess-1');
    expect(row!.children).toHaveLength(3);
  });

  it('builds metrics row from archived cost when only cliSessionId', () => {
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-done' })!;
    task.cliSessionId = 'cli-archived-1';
    appState.activeProject!.sessionHistory = [{
      id: 'arch-1',
      name: 'old',
      providerId: 'claude',
      cliSessionId: 'cli-archived-1',
      createdAt: '2024-01-01',
      closedAt: '2024-01-02',
      cost: {
        totalCostUsd: 0.123,
        totalInputTokens: 5000,
        totalOutputTokens: 2000,
        totalDurationMs: 10_000,
      },
    }];

    const card = createCardElement(task) as unknown as StubEl;
    const row = card.children.find((c) => c.className === 'board-card-metrics');
    expect(row).toBeTruthy();
    expect(row!.dataset.cliSessionId).toBe('cli-archived-1');
    expect(row!.children[0].textContent).toBe('$0.1230');
    expect(row!.children[1].textContent).toBe('7k');
  });

  it('omits metrics row when pref disabled', () => {
    appState.setPreference('boardCardMetrics', false);
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-active' })!;
    task.sessionId = 'sess-1';
    mockGetCost.mockReturnValue(fullCost);

    const card = createCardElement(task) as unknown as StubEl;
    const row = card.children.find((c) => c.className === 'board-card-metrics');
    expect(row).toBeUndefined();
  });

  it('omits metrics row when no sessionId or cliSessionId', () => {
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-backlog' })!;
    const card = createCardElement(task) as unknown as StubEl;
    const row = card.children.find((c) => c.className === 'board-card-metrics');
    expect(row).toBeUndefined();
  });
});

describe('runTask profile threading', () => {
  it('passes task.profileId to addSession on fresh spawn', async () => {
    const spy = vi.spyOn(appState, 'addSession').mockReturnValue({ id: 'new-sess' } as never);
    const task = addTask({ title: 'T', prompt: 'do it', columnId: 'col-backlog', providerId: 'claude', profileId: 'prof-work' })!;

    await runTask(task);

    expect(spy).toHaveBeenCalledWith(
      appState.activeProject!.id,
      expect.any(String),
      undefined,
      'claude',
      'prof-work',
    );
  });

  it('passes task.profileId to addPlanSession when planMode', async () => {
    const spy = vi.spyOn(appState, 'addPlanSession').mockReturnValue({ id: 'new-sess' } as never);
    const task = addTask({ title: 'T', prompt: 'do it', columnId: 'col-backlog', providerId: 'claude', profileId: 'prof-work' })!;
    task.planMode = true;

    await runTask(task);

    expect(spy).toHaveBeenCalledWith(
      appState.activeProject!.id,
      expect.any(String),
      true,
      'claude',
      'prof-work',
    );
  });

  it('passes undefined profile when task has none', async () => {
    const spy = vi.spyOn(appState, 'addSession').mockReturnValue({ id: 'new-sess' } as never);
    const task = addTask({ title: 'T', prompt: 'do it', columnId: 'col-backlog', providerId: 'claude' })!;

    await runTask(task);

    expect(spy).toHaveBeenCalledWith(
      appState.activeProject!.id,
      expect.any(String),
      undefined,
      'claude',
      undefined,
    );
  });
});

describe('createCardElement provider icon', () => {
  function topRow(task: ReturnType<typeof addTask>): StubEl {
    const card = createCardElement(task!) as unknown as StubEl;
    return card.children.find((c) => c.className === 'board-card-top')!;
  }

  function findIcon(row: StubEl): (StubEl & { src?: string; alt?: string }) | undefined {
    return row.children.find((c) => c.className === 'tab-provider-icon') as
      | (StubEl & { src?: string; alt?: string })
      | undefined;
  }

  it('omits icon when only one provider is available', () => {
    vi.mocked(hasMultipleAvailableProviders).mockReturnValue(false);
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-backlog', providerId: 'codex' });
    expect(findIcon(topRow(task))).toBeUndefined();
  });

  it('renders icon for task.providerId when multiple providers available', () => {
    vi.mocked(hasMultipleAvailableProviders).mockReturnValue(true);
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-backlog', providerId: 'codex' });
    const icon = findIcon(topRow(task));
    expect(icon).toBeTruthy();
    expect(icon!.src).toBe('assets/providers/codex.png');
    expect(icon!.alt).toBe('codex');
  });

  it('falls back to default provider when task has no providerId', () => {
    vi.mocked(hasMultipleAvailableProviders).mockReturnValue(true);
    appState.setPreference('defaultProvider', 'gemini');
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-backlog' });
    const icon = findIcon(topRow(task));
    expect(icon!.src).toBe('assets/providers/gemini.png');
  });

  it('falls back to claude when no task or default provider', () => {
    vi.mocked(hasMultipleAvailableProviders).mockReturnValue(true);
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-backlog' });
    const icon = findIcon(topRow(task));
    expect(icon!.src).toBe('assets/providers/claude.png');
  });

  it('prefers live session providerId over task.providerId', () => {
    vi.mocked(hasMultipleAvailableProviders).mockReturnValue(true);
    const project = appState.activeProject!;
    project.sessions.push({
      id: 'sess-live',
      name: 's',
      providerId: 'copilot',
      createdAt: '2024-01-01',
    } as unknown as typeof project.sessions[number]);
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-active', providerId: 'codex' })!;
    task.sessionId = 'sess-live';
    const icon = findIcon(topRow(task));
    expect(icon!.src).toBe('assets/providers/copilot.png');
  });
});

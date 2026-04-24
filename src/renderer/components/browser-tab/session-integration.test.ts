import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserTabInstance } from './types.js';
import type { SessionRecord } from '../../state.js';

const setActiveSession = vi.fn();
const promptNewSession = vi.fn();
const pickExistingSession = vi.fn();
const setPendingPrompt = vi.fn();
const injectPromptIntoRunningSession = vi.fn();
const addPlanSession = vi.fn();
const getTerminalInstance = vi.fn<[string], { spawned: boolean; exited: boolean } | undefined>();
const getLastActiveCliSessionInProject = vi.fn<[string], unknown>();
const dismissInspect = vi.fn();
const dismissFlow = vi.fn();
const dismissDraw = vi.fn();
const hideDrawError = vi.fn();
const showDrawError = vi.fn();
const captureScreenshotPath = vi.fn<[BrowserTabInstance], Promise<string | null>>();

let projectSessions: Array<{ id: string; name: string; type?: string }> = [];
let activeProjectValue: { id: string; sessions: typeof projectSessions } | null = { id: 'proj-1', sessions: projectSessions };

vi.mock('../../state.js', () => ({
  appState: {
    get activeProject() { return activeProjectValue; },
    setActiveSession,
    addPlanSession,
    getLastActiveCliSessionInProject,
  },
}));

vi.mock('../tab-bar.js', () => ({
  promptNewSession,
  pickExistingSession,
}));

vi.mock('../terminal-pane.js', () => ({
  getTerminalInstance,
  setPendingPrompt,
  injectPromptIntoRunningSession,
}));

vi.mock('./inspect-mode.js', () => ({
  buildPrompt: (inst: BrowserTabInstance) => inst.instructionInput.value.trim() || null,
  dismissInspect,
}));

vi.mock('./flow-recording.js', () => ({
  buildFlowPrompt: (inst: BrowserTabInstance) => inst.flowInstructionInput.value.trim() || null,
  dismissFlow,
}));

const sendDrawToNewSession = vi.fn();
vi.mock('./draw-mode.js', () => ({
  buildDrawPrompt: (_inst: BrowserTabInstance, path: string) => `draw:${path}`,
  captureScreenshotPath,
  dismissDraw,
  hideDrawError,
  sendDrawToNewSession,
  showDrawError,
}));

function makeSession(id: string, name = id): SessionRecord {
  return { id, name } as unknown as SessionRecord;
}

function makeInstance(overrides: Partial<Record<string, unknown>> = {}): BrowserTabInstance {
  return {
    instructionInput: { value: 'inspect me' } as HTMLTextAreaElement,
    flowInstructionInput: { value: 'replay flow' } as HTMLTextAreaElement,
    drawInstructionInput: { value: 'annotate this' } as HTMLTextAreaElement,
    inspectPlanModeCheckbox: { checked: false } as HTMLInputElement,
    flowPlanModeCheckbox: { checked: false } as HTMLInputElement,
    drawPlanModeCheckbox: { checked: false } as HTMLInputElement,
    selectedElement: {
      tagName: 'DIV',
      id: '',
      classes: [],
      textContent: '',
      selectors: [],
      activeSelector: { type: 'css' as const, label: 'css', value: '.foo' },
      pageUrl: 'https://example.com',
    },
    ...overrides,
  } as unknown as BrowserTabInstance;
}

function setProject(sessions: Array<{ id: string; name: string; type?: string }>): void {
  projectSessions = sessions;
  activeProjectValue = { id: 'proj-1', sessions: projectSessions };
}

describe('deliverInspect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProject([]);
    injectPromptIntoRunningSession.mockReset();
  });

  it('injects into a spawned target session and dismisses inspect', async () => {
    injectPromptIntoRunningSession.mockReturnValueOnce(true);
    const { deliverInspect } = await import('./session-integration.js');

    deliverInspect(makeInstance(), makeSession('sess-A'));

    expect(injectPromptIntoRunningSession).toHaveBeenCalledWith('sess-A', 'inspect me');
    expect(setPendingPrompt).not.toHaveBeenCalled();
    expect(dismissInspect).toHaveBeenCalledTimes(1);
  });

  it('falls back to setPendingPrompt when inject returns false (dormant target)', async () => {
    injectPromptIntoRunningSession.mockReturnValueOnce(false);
    const { deliverInspect } = await import('./session-integration.js');

    deliverInspect(makeInstance(), makeSession('sess-B'));

    expect(setPendingPrompt).toHaveBeenCalledWith('sess-B', 'inspect me');
  });

  it('activates the target session so the user sees the result', async () => {
    injectPromptIntoRunningSession.mockReturnValueOnce(true);
    const { deliverInspect } = await import('./session-integration.js');

    deliverInspect(makeInstance(), makeSession('sess-C'));

    expect(setActiveSession).toHaveBeenCalledWith('proj-1', 'sess-C');
  });

  it('bails when the instruction input is empty', async () => {
    const { deliverInspect } = await import('./session-integration.js');

    deliverInspect(makeInstance({ instructionInput: { value: '' } as HTMLTextAreaElement }), makeSession('s'));

    expect(injectPromptIntoRunningSession).not.toHaveBeenCalled();
    expect(dismissInspect).not.toHaveBeenCalled();
  });
});

describe('deliverFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProject([]);
    injectPromptIntoRunningSession.mockReset();
  });

  it('delivers the flow prompt and dismisses the flow panel', async () => {
    injectPromptIntoRunningSession.mockReturnValueOnce(true);
    const { deliverFlow } = await import('./session-integration.js');

    deliverFlow(makeInstance(), makeSession('sess-D'));

    expect(injectPromptIntoRunningSession).toHaveBeenCalledWith('sess-D', 'replay flow');
    expect(dismissFlow).toHaveBeenCalledTimes(1);
  });

  it('bails when no prompt can be built', async () => {
    const { deliverFlow } = await import('./session-integration.js');

    deliverFlow(makeInstance({ flowInstructionInput: { value: '' } as HTMLTextAreaElement }), makeSession('s'));

    expect(injectPromptIntoRunningSession).not.toHaveBeenCalled();
    expect(dismissFlow).not.toHaveBeenCalled();
  });
});

describe('deliverDraw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProject([]);
    injectPromptIntoRunningSession.mockReset();
    captureScreenshotPath.mockReset();
  });

  it('captures a screenshot and delivers the built prompt', async () => {
    captureScreenshotPath.mockResolvedValueOnce('/tmp/shot.png');
    injectPromptIntoRunningSession.mockReturnValueOnce(true);
    const { deliverDraw } = await import('./session-integration.js');

    await deliverDraw(makeInstance(), makeSession('sess-E'));

    expect(captureScreenshotPath).toHaveBeenCalledTimes(1);
    expect(injectPromptIntoRunningSession).toHaveBeenCalledWith('sess-E', 'draw:/tmp/shot.png');
    expect(dismissDraw).toHaveBeenCalledTimes(1);
  });

  it('shows an error and does not deliver when screenshot capture fails', async () => {
    captureScreenshotPath.mockResolvedValueOnce(null);
    const { deliverDraw } = await import('./session-integration.js');

    await deliverDraw(makeInstance(), makeSession('sess-F'));

    expect(showDrawError).toHaveBeenCalledTimes(1);
    expect(injectPromptIntoRunningSession).not.toHaveBeenCalled();
    expect(dismissDraw).not.toHaveBeenCalled();
  });

  it('bails when the draw instruction is empty', async () => {
    const { deliverDraw } = await import('./session-integration.js');

    await deliverDraw(makeInstance({ drawInstructionInput: { value: '' } as HTMLTextAreaElement }), makeSession('s'));

    expect(captureScreenshotPath).not.toHaveBeenCalled();
    expect(injectPromptIntoRunningSession).not.toHaveBeenCalled();
  });
});

describe('getDefaultTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProject([]);
    getTerminalInstance.mockReset();
    getLastActiveCliSessionInProject.mockReset();
    // Default: no history match — tests that don't care about history fall through to running/dormant logic
    getLastActiveCliSessionInProject.mockReturnValue(null);
  });

  it('returns null when the project has no CLI sessions', async () => {
    setProject([
      { id: 'b1', name: 'Browser', type: 'browser-tab' },
      { id: 'm1', name: 'MCP', type: 'mcp-inspector' },
    ]);
    const { getDefaultTarget } = await import('./session-integration.js');

    expect(getDefaultTarget()).toBeNull();
  });

  it('returns null when there is no active project', async () => {
    activeProjectValue = null;
    const { getDefaultTarget } = await import('./session-integration.js');

    expect(getDefaultTarget()).toBeNull();
    // Restore so other tests keep working
    activeProjectValue = { id: 'proj-1', sessions: projectSessions };
  });

  it('prefers the most recently active CLI session (from nav history) over running/dormant order', async () => {
    setProject([
      { id: 's-run', name: 'Running' },
      { id: 's-last', name: 'LastActive' },
    ]);
    getTerminalInstance.mockImplementation((id) =>
      id === 's-run' ? { spawned: true, exited: false } : undefined,
    );
    getLastActiveCliSessionInProject.mockReturnValue({ id: 's-last', name: 'LastActive' });
    const { getDefaultTarget } = await import('./session-integration.js');

    // History wins even though s-run is the only running session
    expect(getDefaultTarget()?.id).toBe('s-last');
  });

  it('ignores last-active when it has exited; falls through to first running', async () => {
    setProject([
      { id: 's-run', name: 'Running' },
      { id: 's-last', name: 'LastActiveExited' },
    ]);
    getTerminalInstance.mockImplementation((id) => {
      if (id === 's-run') return { spawned: true, exited: false };
      if (id === 's-last') return { spawned: true, exited: true };
      return undefined;
    });
    getLastActiveCliSessionInProject.mockReturnValue({ id: 's-last', name: 'LastActiveExited' });
    const { getDefaultTarget } = await import('./session-integration.js');

    expect(getDefaultTarget()?.id).toBe('s-run');
  });

  it('prefers a running CLI session over a dormant one when there is no history match', async () => {
    setProject([
      { id: 's-dorm', name: 'Dormant' },
      { id: 's-run', name: 'Running' },
    ]);
    getTerminalInstance.mockImplementation((id) =>
      id === 's-run' ? { spawned: true, exited: false } : undefined,
    );
    const { getDefaultTarget } = await import('./session-integration.js');

    expect(getDefaultTarget()?.id).toBe('s-run');
  });

  it('falls back to first dormant CLI session when none are running', async () => {
    setProject([
      { id: 's-a', name: 'A' },
      { id: 's-b', name: 'B' },
    ]);
    getTerminalInstance.mockReturnValue(undefined);
    const { getDefaultTarget } = await import('./session-integration.js');

    expect(getDefaultTarget()?.id).toBe('s-a');
  });

  it('skips exited sessions entirely when picking a dormant fallback', async () => {
    setProject([
      { id: 's-exited', name: 'Exited' },
      { id: 's-dorm', name: 'Dormant' },
    ]);
    getTerminalInstance.mockImplementation((id) =>
      id === 's-exited' ? { spawned: true, exited: true } : undefined,
    );
    const { getDefaultTarget } = await import('./session-integration.js');

    // Exited is filtered out; falls through to s-dorm.
    expect(getDefaultTarget()?.id).toBe('s-dorm');
  });
});

describe('sendToDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProject([]);
    getTerminalInstance.mockReset();
  });

  it('delivers to the default target when one exists', async () => {
    setProject([{ id: 's-run', name: 'Running' }]);
    getTerminalInstance.mockReturnValue({ spawned: true, exited: false });
    injectPromptIntoRunningSession.mockReturnValueOnce(true);
    const { sendToDefault } = await import('./session-integration.js');

    sendToDefault(makeInstance());

    expect(injectPromptIntoRunningSession).toHaveBeenCalledWith('s-run', 'inspect me');
    expect(setActiveSession).toHaveBeenCalledWith('proj-1', 's-run');
    expect(dismissInspect).toHaveBeenCalledTimes(1);
  });

  it('uses the pending-prompt fallback when the default target is dormant', async () => {
    setProject([{ id: 's-dorm', name: 'Dormant' }]);
    getTerminalInstance.mockReturnValue(undefined);
    injectPromptIntoRunningSession.mockReturnValueOnce(false);
    const { sendToDefault } = await import('./session-integration.js');

    sendToDefault(makeInstance());

    expect(setPendingPrompt).toHaveBeenCalledWith('s-dorm', 'inspect me');
  });

  it('falls through to new-session creation when no CLI sessions exist', async () => {
    setProject([{ id: 'b1', name: 'Browser', type: 'browser-tab' }]);
    addPlanSession.mockReturnValueOnce({ id: 'new-1', name: 'Session 1' });
    const { sendToDefault } = await import('./session-integration.js');

    sendToDefault(makeInstance());

    expect(addPlanSession).toHaveBeenCalledTimes(1);
    expect(setPendingPrompt).toHaveBeenCalledWith('new-1', 'inspect me');
    expect(injectPromptIntoRunningSession).not.toHaveBeenCalled();
  });

  it('bails when the instruction is empty', async () => {
    setProject([{ id: 's-run', name: 'Running' }]);
    const { sendToDefault } = await import('./session-integration.js');

    sendToDefault(makeInstance({ instructionInput: { value: '' } as HTMLTextAreaElement }));

    expect(injectPromptIntoRunningSession).not.toHaveBeenCalled();
    expect(addPlanSession).not.toHaveBeenCalled();
  });
});

describe('sendFlowToDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProject([]);
    getTerminalInstance.mockReset();
  });

  it('delivers the flow prompt to the default target', async () => {
    setProject([{ id: 's-run', name: 'Running' }]);
    getTerminalInstance.mockReturnValue({ spawned: true, exited: false });
    injectPromptIntoRunningSession.mockReturnValueOnce(true);
    const { sendFlowToDefault } = await import('./session-integration.js');

    sendFlowToDefault(makeInstance());

    expect(injectPromptIntoRunningSession).toHaveBeenCalledWith('s-run', 'replay flow');
    expect(dismissFlow).toHaveBeenCalledTimes(1);
  });

  it('falls through to new-session creation when no CLI sessions exist', async () => {
    setProject([]);
    addPlanSession.mockReturnValueOnce({ id: 'new-f', name: 'flow-new' });
    const { sendFlowToDefault } = await import('./session-integration.js');

    sendFlowToDefault(makeInstance());

    expect(addPlanSession).toHaveBeenCalledTimes(1);
    expect(setPendingPrompt).toHaveBeenCalledWith('new-f', 'replay flow');
  });
});

describe('sendDrawToDefault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setProject([]);
    getTerminalInstance.mockReset();
    captureScreenshotPath.mockReset();
    injectPromptIntoRunningSession.mockReset();
    addPlanSession.mockReset();
  });

  it('captures a screenshot and delivers the prompt to the default target', async () => {
    setProject([{ id: 's-run', name: 'Running' }]);
    getTerminalInstance.mockReturnValue({ spawned: true, exited: false });
    captureScreenshotPath.mockResolvedValueOnce('/tmp/shot.png');
    injectPromptIntoRunningSession.mockReturnValueOnce(true);
    const { sendDrawToDefault } = await import('./session-integration.js');

    await sendDrawToDefault(makeInstance());

    expect(captureScreenshotPath).toHaveBeenCalledTimes(1);
    expect(injectPromptIntoRunningSession).toHaveBeenCalledWith('s-run', 'draw:/tmp/shot.png');
    expect(dismissDraw).toHaveBeenCalledTimes(1);
  });

  it('delegates to sendDrawToNewSession when no CLI sessions exist', async () => {
    setProject([]);
    const { sendDrawToDefault } = await import('./session-integration.js');

    await sendDrawToDefault(makeInstance());

    expect(sendDrawToNewSession).toHaveBeenCalledTimes(1);
    // The fallthrough happens BEFORE screenshot capture, so captureScreenshotPath is not reached.
    expect(captureScreenshotPath).not.toHaveBeenCalled();
  });

  it('shows an error and does not fall through when screenshot capture fails', async () => {
    setProject([{ id: 's-run', name: 'Running' }]);
    getTerminalInstance.mockReturnValue({ spawned: true, exited: false });
    captureScreenshotPath.mockResolvedValueOnce(null);
    const { sendDrawToDefault } = await import('./session-integration.js');

    await sendDrawToDefault(makeInstance());

    expect(showDrawError).toHaveBeenCalledTimes(1);
    expect(injectPromptIntoRunningSession).not.toHaveBeenCalled();
  });
});

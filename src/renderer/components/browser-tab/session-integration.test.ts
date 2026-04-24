import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserTabInstance } from './types.js';
import type { SessionRecord } from '../../state.js';

const setActiveSession = vi.fn();
const promptNewSession = vi.fn();
const setPendingPrompt = vi.fn();
const injectPromptIntoRunningSession = vi.fn();
const addPlanSession = vi.fn();
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
  },
}));

vi.mock('../tab-bar.js', () => ({
  promptNewSession,
}));

vi.mock('../terminal-pane.js', () => ({
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


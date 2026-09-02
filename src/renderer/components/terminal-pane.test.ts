import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextWindowInfo, CostInfo } from '../../shared/types.js';

const providerCaps = new Map([
  ['claude', { costTracking: true, contextWindow: true, pendingPromptTrigger: 'startup-arg' }],
  ['gemini', { costTracking: false, contextWindow: false, pendingPromptTrigger: 'startup-arg' }],
  ['codex', { costTracking: false, contextWindow: false, pendingPromptTrigger: 'startup-arg' }],
]);

const mockPtyWrite = vi.fn();
const mockPtyKill = vi.fn();

class FakeTerminal {
  cols = 120;
  rows = 30;
  options: Record<string, unknown>;
  private keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  private _selection = '';
  dataHandlers: Array<(data: string) => void> = [];
  keyHandlers: Array<(e: { key: string; domEvent: KeyboardEvent }) => void> = [];
  focusCount = 0;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }

  loadAddon(): void {}
  attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void {
    this.keyHandler = handler;
  }
  simulateKey(event: Partial<KeyboardEvent>): boolean {
    return this.keyHandler ? this.keyHandler(event as KeyboardEvent) : true;
  }
  getSelection(): string { return this._selection; }
  setSelection(s: string): void { this._selection = s; }
  registerLinkProvider(): void {}
  onData(cb: (data: string) => void): void { this.dataHandlers.push(cb); }
  onKey(cb: (e: { key: string; domEvent: KeyboardEvent }) => void): void { this.keyHandlers.push(cb); }
  onSelectionChange(): void {}
  open(): void {}
  write(): void {}
  focus(): void { this.focusCount++; }
  dispose(): void {}
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FakeFitAddon {
    fit(): void {}
  },
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class FakeWebglAddon {
    onContextLoss = (_: () => void) => ({ dispose() {} });
    dispose() {}
  },
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class FakeSearchAddon {},
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class FakeWebLinksAddon {
    constructor(_cb: unknown) {}
  },
}));

vi.mock('../session-activity.js', () => ({
  initSession: vi.fn(),
  removeSession: vi.fn(),
}));

vi.mock('../session-insights.js', () => ({
  markFreshSession: vi.fn(),
}));

vi.mock('../session-cost.js', () => ({
  removeSession: vi.fn(),
  getCost: vi.fn(() => null),
  formatTokens: (n: number) => String(n),
}));

vi.mock('../session-context.js', () => ({
  removeSession: vi.fn(),
  getContext: vi.fn(() => null),
  getContextSeverity: vi.fn((pct: number) => (pct >= 90 ? 'critical' : pct >= 70 ? 'warning' : '')),
}));

vi.mock('../provider-availability.js', () => ({
  getProviderCapabilities: vi.fn((providerId: string) => providerCaps.get(providerId) ?? null),
}));

vi.mock('./terminal-link-provider.js', () => ({
  FilePathLinkProvider: class FakeFilePathLinkProvider {},
  GithubLinkProvider: class FakeGithubLinkProvider {},
}));

vi.mock('./terminal-context-menu.js', () => ({
  showTerminalContextMenu: vi.fn(),
}));

class FakeClassList {
  private values = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) this.values.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) this.values.delete(token);
  }

  toggle(token: string, force?: boolean): boolean {
    const shouldAdd = force ?? !this.values.has(token);
    if (shouldAdd) this.values.add(token);
    else this.values.delete(token);
    return shouldAdd;
  }

  contains(token: string): boolean {
    return this.values.has(token);
  }

  get value(): string {
    return [...this.values].join(' ');
  }

  set value(v: string) {
    this.values = new Set(v.split(/\s+/).filter(Boolean));
  }
}

class FakeElement {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  textContent = '';

  constructor(public tagName: string) {}

  // One source of truth, as in the DOM: production reads classList while most
  // setup writes className, and letting them drift makes these tests lie.
  get className(): string {
    return this.classList.value;
  }

  set className(value: string) {
    this.classList.value = value;
  }

  appendChild(child: FakeElement): FakeElement {
    // Mirror the DOM: appending a node that already has a parent moves it.
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...children: FakeElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  addEventListener(): void {}

  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const sel = part.trim();
      if (sel.startsWith('.')) return this.hasClass(sel.slice(1));
      return this.tagName.toLowerCase() === sel.toLowerCase();
    });
  }

  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this as FakeElement;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  hasClass(name: string): boolean {
    return this.classList.contains(name);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.find((child) => child.hasClass(className));
    }
    return null;
  }

  private find(predicate: (el: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeDocument {
  body = new FakeElement('body');
  activeElement: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

const mockClipboardWrite = vi.fn().mockResolvedValue(undefined);
// Terminal copies go through the main process, not navigator.clipboard (#160).
const mockVibeyardClipboardWrite = vi.fn().mockResolvedValue(undefined);

function makeWindowStub() {
  return {
    vibeyard: {
      pty: {
        write: mockPtyWrite,
        kill: mockPtyKill,
        resize: vi.fn(),
        create: vi.fn(),
      },
      git: { getRemoteUrl: vi.fn(async () => null) },
      clipboard: { write: mockVibeyardClipboardWrite },
      app: { openExternal: vi.fn() },
    },
  };
}

describe('terminal pending prompt injection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  it('passes pending prompt as initialPrompt to pty.create for claude', async () => {
    const { createTerminalPane, setPendingPrompt, spawnTerminal } = await import('./terminal-pane.js');
    const mockPtyCreate = (window as any).vibeyard.pty.create;

    createTerminalPane('claude-1', '/project', null, false, '', 'claude');
    setPendingPrompt('claude-1', 'fix the bug');
    await spawnTerminal('claude-1');

    expect(mockPtyCreate).toHaveBeenCalledWith('claude-1', '/project', null, false, '', 'claude', 'fix the bug', undefined, '', undefined);
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('passes pending prompt as initialPrompt to pty.create for codex', async () => {
    const { createTerminalPane, setPendingPrompt, spawnTerminal } = await import('./terminal-pane.js');
    const mockPtyCreate = (window as any).vibeyard.pty.create;

    createTerminalPane('codex-1', '/project', null, false, '', 'codex');
    setPendingPrompt('codex-1', 'fix the bug');
    await spawnTerminal('codex-1');

    expect(mockPtyCreate).toHaveBeenCalledWith('codex-1', '/project', null, false, '', 'codex', 'fix the bug', undefined, '', undefined);
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('does not pass initialPrompt when no pending prompt is set', async () => {
    const { createTerminalPane, spawnTerminal } = await import('./terminal-pane.js');
    const mockPtyCreate = (window as any).vibeyard.pty.create;

    createTerminalPane('claude-2', '/project', null, false, '', 'claude');
    await spawnTerminal('claude-2');

    expect(mockPtyCreate).toHaveBeenCalledWith('claude-2', '/project', null, false, '', 'claude', undefined, undefined, '', undefined);
  });

  it('does not inject pending prompt from PTY output', async () => {
    const { createTerminalPane, setPendingPrompt, handlePtyData, spawnTerminal } = await import('./terminal-pane.js');

    createTerminalPane('codex-2', '/project', null, false, '', 'codex');
    setPendingPrompt('codex-2', 'some prompt');
    await spawnTerminal('codex-2');

    handlePtyData('codex-2', 'some output');
    await vi.runAllTimersAsync();
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });
});

describe('terminal focus tracking', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  it('does not steal focus when the terminal emits a query-response via onData', async () => {
    // Regression: CLAUDE_CODE_NO_FLICKER=1 makes the CLI emit cursor-position
    // queries every frame; xterm answers them through onData. Focus tracking must
    // ignore that data so it does not yank focus away from e.g. the search input.
    const { createTerminalPane, getTerminalInstance, getFocusedSessionId } = await import('./terminal-pane.js');

    createTerminalPane('noflicker-1', '/project', null, false, '', 'claude');
    const term = getTerminalInstance('noflicker-1')!.terminal as unknown as FakeTerminal;

    // Exactly one onData handler (input → PTY) and one onKey handler (focus tracking).
    expect(term.dataHandlers).toHaveLength(1);
    expect(term.keyHandlers).toHaveLength(1);

    // Simulate a terminal-generated response arriving via onData.
    term.dataHandlers.forEach((cb) => cb('\x1b[24;80R'));

    expect(getFocusedSessionId()).toBeNull();
    expect(term.focusCount).toBe(0);
  });

  it('marks the session focused on a real keystroke via onKey', async () => {
    const { createTerminalPane, getTerminalInstance, getFocusedSessionId } = await import('./terminal-pane.js');

    createTerminalPane('key-1', '/project', null, false, '', 'claude');
    const term = getTerminalInstance('key-1')!.terminal as unknown as FakeTerminal;

    term.keyHandlers.forEach((cb) => cb({ key: 'a', domEvent: {} as KeyboardEvent }));

    expect(getFocusedSessionId()).toBe('key-1');
  });
});

describe('pane attach, focus and fit are idempotent', () => {
  // Background session chatter (a statusLine tick, a status change) re-runs
  // renderLayout(). Anything it does to the pane's DOM on a render that changed
  // nothing is felt by the user as focus loss or a lost selection.
  let doc: FakeDocument;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    doc = new FakeDocument();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  /** Stand in for the .xterm node terminal.open() would have created. */
  function markOpened(element: FakeElement): void {
    const wrap = element.querySelector('.xterm-wrap')!;
    const screen = new FakeElement('div');
    screen.className = 'xterm';
    wrap.appendChild(screen);
  }

  it('does not re-append a pane that is already in the container', async () => {
    const { createTerminalPane, attachToContainer, getTerminalInstance } = await import('./terminal-pane.js');
    const container = doc.createElement('div') as unknown as HTMLElement;

    createTerminalPane('attach-1', '/project', null, false, '', 'claude');
    attachToContainer('attach-1', container);

    const element = getTerminalInstance('attach-1')!.element as unknown as FakeElement;
    markOpened(element);

    // A focused input inside the pane — the Cmd+F find bar lives here.
    const input = new FakeElement('input');
    element.appendChild(input);
    doc.activeElement = input;

    attachToContainer('attach-1', container);
    attachToContainer('attach-1', container);

    expect((container as unknown as FakeElement).children).toEqual([element]);
    expect(doc.activeElement).toBe(input);
  });

  it('moves a pane that is attached to a different container', async () => {
    const { createTerminalPane, attachToContainer, getTerminalInstance } = await import('./terminal-pane.js');
    const first = doc.createElement('div') as unknown as HTMLElement;
    const second = doc.createElement('div') as unknown as HTMLElement;

    createTerminalPane('attach-2', '/project', null, false, '', 'claude');
    attachToContainer('attach-2', first);

    const element = getTerminalInstance('attach-2')!.element as unknown as FakeElement;
    markOpened(element);

    attachToContainer('attach-2', second);

    expect((first as unknown as FakeElement).children).toEqual([]);
    expect((second as unknown as FakeElement).children).toEqual([element]);
  });

  it('leaves focus alone when it sits outside every pane', async () => {
    // The project terminal panel, a modal, the sidebar — none of them are a pane.
    const { createTerminalPane, setFocused, showPane, getTerminalInstance } = await import('./terminal-pane.js');

    createTerminalPane('focus-1', '/project', null, false, '', 'claude');
    showPane('focus-1', false);
    const instance = getTerminalInstance('focus-1')!;
    const term = instance.terminal as unknown as FakeTerminal;

    const elsewhere = new FakeElement('input');
    doc.body.appendChild(elsewhere);
    doc.activeElement = elsewhere;

    setFocused('focus-1');

    expect(term.focusCount).toBe(0);
    expect((instance.element as unknown as FakeElement).classList.contains('focused')).toBe(true);
  });

  it('takes focus from body, and from another pane on a tab switch', async () => {
    // A find bar in the outgoing pane must not block the incoming one — the find
    // bar is protected by not calling setFocused at all (see pane-focus.ts), not here.
    const { createTerminalPane, setFocused, showPane, getTerminalInstance } = await import('./terminal-pane.js');

    createTerminalPane('focus-2', '/project', null, false, '', 'claude');
    createTerminalPane('focus-3', '/project', null, false, '', 'claude');
    showPane('focus-2', false);
    const paneA = getTerminalInstance('focus-3')!.element as unknown as FakeElement;
    const term = getTerminalInstance('focus-2')!.terminal as unknown as FakeTerminal;

    doc.activeElement = null;
    setFocused('focus-2');
    expect(term.focusCount).toBe(1);

    const findBarInput = new FakeElement('input');
    paneA.appendChild(findBarInput);
    doc.activeElement = findBarInput;
    setFocused('focus-2');
    expect(term.focusCount).toBe(2);
  });

  it('resizes the PTY only when the geometry actually changed', async () => {
    const { createTerminalPane, fitTerminal, showPane, getTerminalInstance } = await import('./terminal-pane.js');
    const mockResize = (window as any).vibeyard.pty.resize;

    createTerminalPane('fit-1', '/project', null, false, '', 'claude');
    showPane('fit-1', false); // fitTerminal skips a hidden pane
    const term = getTerminalInstance('fit-1')!.terminal as unknown as FakeTerminal;

    fitTerminal('fit-1');
    fitTerminal('fit-1');
    expect(mockResize).toHaveBeenCalledTimes(1);
    expect(mockResize).toHaveBeenCalledWith('fit-1', 120, 30);

    term.rows = 24;
    fitTerminal('fit-1');
    expect(mockResize).toHaveBeenCalledTimes(2);
    expect(mockResize).toHaveBeenLastCalledWith('fit-1', 120, 24);
  });

  it('re-sends the size once the PTY exists, even if the pane was fitted mid-spawn', async () => {
    // Callers fire spawnTerminal() un-awaited and fit immediately after, so the
    // first resize can reach main while pty:create is still suspended (Copilot
    // awaits a hook install before registering the PTY) — resizePty drops it.
    // Without a re-fit the memo would make that drop permanent and the CLI would
    // wrap at the 120x30 spawn default forever.
    const { createTerminalPane, fitTerminal, showPane, spawnTerminal, getTerminalInstance } = await import('./terminal-pane.js');
    const mockResize = (window as any).vibeyard.pty.resize;
    let releaseCreate: () => void;
    (window as any).vibeyard.pty.create = vi.fn(
      () => new Promise<void>((resolve) => { releaseCreate = resolve; }),
    );

    createTerminalPane('fit-2', '/project', null, false, '', 'claude');
    showPane('fit-2', false);
    (getTerminalInstance('fit-2')!.terminal as unknown as FakeTerminal).cols = 200;

    const spawning = spawnTerminal('fit-2');
    fitTerminal('fit-2'); // the resize main never sees
    expect(mockResize).toHaveBeenCalledTimes(1);

    releaseCreate!();
    await spawning;

    expect(mockResize).toHaveBeenCalledTimes(2);
    expect(mockResize).toHaveBeenLastCalledWith('fit-2', 200, 30);
  });

});

describe('applyThemeToAllTerminals()', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  it('updates existing terminal instances to the selected theme', async () => {
    const { createTerminalPane, applyThemeToAllTerminals, getTerminalInstance } = await import('./terminal-pane.js');
    const { darkTerminalTheme, lightTerminalTheme } = await import('../terminal-theme.js');

    createTerminalPane('claude-theme-1', '/project', null, false, '', 'claude');
    const instance = getTerminalInstance('claude-theme-1')!;

    expect((instance.terminal as unknown as FakeTerminal).options.theme).toBe(darkTerminalTheme);

    applyThemeToAllTerminals('light');

    expect((instance.terminal as unknown as FakeTerminal).options.theme).toBe(lightTerminalTheme);
  });

  it('uses the current light theme for newly created terminal instances', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane, getTerminalInstance } = await import('./terminal-pane.js');
    const { lightTerminalTheme } = await import('../terminal-theme.js');

    appState.preferences.theme = 'light';

    createTerminalPane('claude-theme-2', '/project', null, false, '', 'claude');
    const instance = getTerminalInstance('claude-theme-2')!;

    expect((instance.terminal as unknown as FakeTerminal).options.theme).toBe(lightTerminalTheme);
  });
});

describe('terminal Ctrl+Shift+C clipboard copy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  it('copies selected text to clipboard on Ctrl+Shift+C keydown', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');
    const instance = createTerminalPane('s1', '/project', null);
    const term = instance.terminal as unknown as FakeTerminal;

    term.setSelection('hello world');
    term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(mockVibeyardClipboardWrite).toHaveBeenCalledWith('hello world', 'explicit');
  });

  it('does not copy on keyup', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');
    const instance = createTerminalPane('s2', '/project', null);
    const term = instance.terminal as unknown as FakeTerminal;

    term.setSelection('hello world');
    term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keyup' });

    expect(mockVibeyardClipboardWrite).not.toHaveBeenCalled();
  });

  it('does not copy when nothing is selected', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');
    const instance = createTerminalPane('s3', '/project', null);
    const term = instance.terminal as unknown as FakeTerminal;

    term.setSelection('');
    term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(mockVibeyardClipboardWrite).not.toHaveBeenCalled();
  });

  it('returns false to prevent default on Ctrl+Shift+C', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');
    const instance = createTerminalPane('s4', '/project', null);
    const term = instance.terminal as unknown as FakeTerminal;

    const result = term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(result).toBe(false);
  });
});

describe('injectTextIntoRunningSession', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  it('returns false and writes nothing when the session is not spawned', async () => {
    const { createTerminalPane, injectTextIntoRunningSession } = await import('./terminal-pane.js');
    createTerminalPane('inj-text-1', '/project', null, false, '', 'claude');

    const result = injectTextIntoRunningSession('inj-text-1', '/abs/path.ts ');

    expect(result).toBe(false);
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('returns false when no instance exists for the session id', async () => {
    const { injectTextIntoRunningSession } = await import('./terminal-pane.js');

    const result = injectTextIntoRunningSession('does-not-exist', 'hello');

    expect(result).toBe(false);
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('wraps payload in bracketed-paste escapes when bracketedPasteMode is on, without sending Enter', async () => {
    const { createTerminalPane, spawnTerminal, injectTextIntoRunningSession } = await import('./terminal-pane.js');
    const instance = createTerminalPane('inj-text-2', '/project', null, false, '', 'claude');
    await spawnTerminal('inj-text-2');
    (instance.terminal as unknown as { modes: { bracketedPasteMode: boolean } }).modes = { bracketedPasteMode: true };
    mockPtyWrite.mockClear();

    const result = injectTextIntoRunningSession('inj-text-2', '/abs/path.ts ');

    expect(result).toBe(true);
    expect(mockPtyWrite).toHaveBeenCalledTimes(1);
    expect(mockPtyWrite).toHaveBeenCalledWith('inj-text-2', '\x1b[200~/abs/path.ts \x1b[201~');
  });

  it('writes the raw payload without Enter when bracketedPasteMode is off', async () => {
    const { createTerminalPane, spawnTerminal, injectTextIntoRunningSession } = await import('./terminal-pane.js');
    const instance = createTerminalPane('inj-text-3', '/project', null, false, '', 'claude');
    await spawnTerminal('inj-text-3');
    (instance.terminal as unknown as { modes: { bracketedPasteMode: boolean } }).modes = { bracketedPasteMode: false };
    mockPtyWrite.mockClear();

    const result = injectTextIntoRunningSession('inj-text-3', '/abs/path.ts ');

    expect(result).toBe(true);
    expect(mockPtyWrite).toHaveBeenCalledTimes(1);
    expect(mockPtyWrite).toHaveBeenCalledWith('inj-text-3', '/abs/path.ts ');
  });
});

describe('profile label in status-line cost string', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  function makeProfile(id: string, name: string, providerId = 'claude') {
    return { id, name, providerId, configDir: `/cfg/${id}`, managed: true, createdAt: 0 };
  }

  // The cost cluster is span-composed, and FakeElement.textContent does not aggregate
  // children — assert the segments, not the container's text.
  function costParts(instance: any) {
    const cd = instance.element.querySelector('.cost-display')!;
    return {
      pill: cd.querySelector('.ssl-pill')?.textContent ?? null,
      cost: cd.querySelector('.ssl-cost')?.textContent ?? null,
    };
  }

  // createTerminalPane(sessionId, projectPath, cliSessionId, isResume, args, providerId, projectId?, envVars?, configDir?)
  function makePane(create: any, sessionId: string, providerId: string, configDir?: string) {
    return create(sessionId, '/project', null, false, '', providerId, undefined, '', configDir);
  }

  it('omits the profile prefix when at most one profile exists for the provider', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane } = await import('./terminal-pane.js');
    appState.profiles.push(makeProfile('work', 'Work'));

    const instance = makePane(createTerminalPane, 'pb-1', 'claude', '/cfg/work');

    expect(costParts(instance)).toEqual({ pill: null, cost: '$0.0000' });
  });

  it('prefixes the cost string with the profile matching the spawned config dir', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane } = await import('./terminal-pane.js');
    appState.profiles.push(makeProfile('work', 'Work'), makeProfile('personal', 'Personal'));

    const instance = makePane(createTerminalPane, 'pb-2', 'claude', '/cfg/personal');

    expect(costParts(instance)).toEqual({ pill: 'Personal', cost: '$0.0000' });
  });

  it('labels a session on the base config dir (no configDir) as "Default"', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane } = await import('./terminal-pane.js');
    appState.profiles.push(makeProfile('work', 'Work'), makeProfile('personal', 'Personal'));

    const instance = makePane(createTerminalPane, 'pb-3', 'claude', undefined); // base ~/.claude

    expect(costParts(instance)).toEqual({ pill: 'Default', cost: '$0.0000' });
  });

  it('folds the profile in front of the model name once cost data arrives', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane, updateCostDisplay } = await import('./terminal-pane.js');
    appState.profiles.push(makeProfile('work', 'Work'), makeProfile('personal', 'Personal'));

    const instance = makePane(createTerminalPane, 'pb-2b', 'claude', '/cfg/personal');
    updateCostDisplay('pb-2b', {
      totalCostUsd: 1.5, totalInputTokens: 0, totalOutputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalDurationMs: 0, totalApiDurationMs: 0,
      model: 'Opus 4.8',
    });

    const cd = instance.element.querySelector('.cost-display')!;
    expect(cd.querySelector('.ssl-pill')!.textContent).toBe('Personal');
    expect(cd.querySelector('.ssl-model')!.textContent).toBe('Opus 4.8');
    expect(cd.querySelector('.ssl-cost')!.textContent).toBe('$1.5000');
  });

  it('renders a "Context" label as the first item, before the meter', async () => {
    const { createTerminalPane, updateContextDisplay } = await import('./terminal-pane.js');
    const instance = makePane(createTerminalPane, 'ctx-label', 'claude', undefined);

    updateContextDisplay('ctx-label', { totalTokens: 90000, contextWindowSize: 200000, usedPercentage: 45 });

    const ind = instance.element.querySelector('.context-indicator')! as any;
    const label = ind.querySelector('.ssl-label')!;
    expect(label.textContent).toBe('Context');
    // The label must be the first child, immediately before the meter.
    expect(ind.children[0]).toBe(label);
    expect(ind.children[1].className).toBe('ssl-meter');
  });

  it('holds the peak output-token count so a per-turn reset does not flicker the rail down', async () => {
    const { createTerminalPane, updateCostDisplay } = await import('./terminal-pane.js');
    const instance = makePane(createTerminalPane, 'pb-peak', 'claude', undefined);
    const io = () => instance.element.querySelector('.ssl-io')!.textContent as string;

    const base = {
      totalCostUsd: 1, totalInputTokens: 5000,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalDurationMs: 0, totalApiDurationMs: 0,
      model: 'Opus 4.8',
    };

    // Turn output climbs to 185...
    updateCostDisplay('pb-peak', { ...base, totalOutputTokens: 185 });
    expect(io()).toBe('5000 in / 185 out');

    // ...then Claude reports the next turn's tiny starting value — display must not regress.
    updateCostDisplay('pb-peak', { ...base, totalOutputTokens: 2 });
    expect(io()).toBe('5000 in / 185 out');

    // A genuinely higher value still ratchets the peak up.
    updateCostDisplay('pb-peak', { ...base, totalOutputTokens: 300 });
    expect(io()).toBe('5000 in / 300 out');
  });

  it('ignores profiles belonging to a different provider', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane } = await import('./terminal-pane.js');
    // Two profiles, but only one targets claude — claude sessions get no prefix.
    appState.profiles.push(makeProfile('work', 'Work', 'claude'), makeProfile('gem', 'Gem', 'gemini'));

    const instance = makePane(createTerminalPane, 'pb-4', 'claude', '/cfg/work');

    expect(costParts(instance)).toEqual({ pill: null, cost: '$0.0000' });
  });

  it('refreshProfileLabels re-renders the prefix after a second profile is added', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane, refreshProfileLabels } = await import('./terminal-pane.js');
    appState.profiles.push(makeProfile('work', 'Work'));

    const instance = makePane(createTerminalPane, 'pb-5', 'claude', '/cfg/work');
    expect(costParts(instance)).toEqual({ pill: null, cost: '$0.0000' });

    appState.profiles.push(makeProfile('personal', 'Personal'));
    refreshProfileLabels();

    const cd = instance.element.querySelector('.cost-display')!;
    expect(cd.querySelector('.ssl-pill')!.textContent).toBe('Work');
    expect(cd.querySelector('.ssl-cost')!.textContent).toBe('$0.0000');
  });
});

describe('injectPromptIntoRunningSession', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  it('returns false and writes nothing when the session is not spawned', async () => {
    const { createTerminalPane, injectPromptIntoRunningSession } = await import('./terminal-pane.js');
    createTerminalPane('inj-1', '/project', null, false, '', 'claude');

    const result = injectPromptIntoRunningSession('inj-1', 'fix the bug');

    expect(result).toBe(false);
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('returns false when no instance exists for the session id', async () => {
    const { injectPromptIntoRunningSession } = await import('./terminal-pane.js');

    const result = injectPromptIntoRunningSession('does-not-exist', 'hello');

    expect(result).toBe(false);
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('wraps payload in bracketed-paste escapes when bracketedPasteMode is on, then sends Enter', async () => {
    const { createTerminalPane, spawnTerminal, injectPromptIntoRunningSession } = await import('./terminal-pane.js');
    const instance = createTerminalPane('inj-2', '/project', null, false, '', 'claude');
    await spawnTerminal('inj-2');
    (instance.terminal as unknown as { modes: { bracketedPasteMode: boolean } }).modes = { bracketedPasteMode: true };
    mockPtyWrite.mockClear();

    const result = injectPromptIntoRunningSession('inj-2', 'fix the bug');

    expect(result).toBe(true);
    expect(mockPtyWrite).toHaveBeenNthCalledWith(1, 'inj-2', '\x1b[200~fix the bug\x1b[201~');
    expect(mockPtyWrite).toHaveBeenNthCalledWith(2, 'inj-2', '\r');
  });

  it('writes the raw payload and Enter when bracketedPasteMode is off', async () => {
    const { createTerminalPane, spawnTerminal, injectPromptIntoRunningSession } = await import('./terminal-pane.js');
    const instance = createTerminalPane('inj-3', '/project', null, false, '', 'claude');
    await spawnTerminal('inj-3');
    (instance.terminal as unknown as { modes: { bracketedPasteMode: boolean } }).modes = { bracketedPasteMode: false };
    mockPtyWrite.mockClear();

    const result = injectPromptIntoRunningSession('inj-3', 'fix the bug');

    expect(result).toBe(true);
    expect(mockPtyWrite).toHaveBeenNthCalledWith(1, 'inj-3', 'fix the bug');
    expect(mockPtyWrite).toHaveBeenNthCalledWith(2, 'inj-3', '\r');
  });
});

describe('status rail is primed from restored cost/context', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();

    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('window', makeWindowStub());
    vi.stubGlobal('navigator', { platform: 'MacIntel', clipboard: { writeText: mockClipboardWrite } });
  });

  const q = (root: unknown, selector: string): FakeElement =>
    (root as FakeElement).querySelector(selector) as FakeElement;

  async function primeStores(cost: CostInfo | null = null, context: ContextWindowInfo | null = null): Promise<void> {
    const { getCost } = await import('../session-cost.js');
    const { getContext } = await import('../session-context.js');
    vi.mocked(getCost).mockReturnValue(cost);
    vi.mocked(getContext).mockReturnValue(context);
  }

  // The meter has to be right the moment the pane exists: a resumed session reports the
  // context that was already persisted, so `setContextData` dedupes it away and no
  // change event ever arrives to build it.
  it.each([
    [14, 'ok'],
    [95, 'crit'],
  ])('paints the restored context meter and its severity state (%i%%)', async (pct, state) => {
    const totalTokens = pct * 10_000;
    await primeStores(null, { totalTokens, contextWindowSize: 1_000_000, usedPercentage: pct });
    const { createTerminalPane } = await import('./terminal-pane.js');

    const instance = createTerminalPane(`restored-${pct}`, '/project', 'cli-1', true, '', 'claude');

    const indicator = q(instance.element, '.context-indicator');
    expect(q(indicator, '.ssl-meter-fill').style.width).toBe(`${pct}%`);
    expect(q(indicator, '.ssl-pct').textContent).toBe(`${pct}%`);
    expect(q(indicator, '.ssl-tok').textContent).toBe(String(totalTokens));
    expect(q(instance.element, '.session-status-bar').dataset.state).toBe(state);
  });

  it('renders restored cost instead of the $0.0000 placeholder', async () => {
    await primeStores({
      totalCostUsd: 4.5619,
      totalInputTokens: 150_458,
      totalOutputTokens: 1352,
      cacheReadTokens: 149_745,
      cacheCreationTokens: 711,
      totalDurationMs: 298_140_212,
      totalApiDurationMs: 782_216,
      model: 'Opus 5',
    });
    const { createTerminalPane } = await import('./terminal-pane.js');

    const instance = createTerminalPane('restored-cost', '/project', 'cli-3', true, '', 'claude');

    const costDisplay = q(instance.element, '.cost-display');
    expect(q(costDisplay, '.ssl-model').textContent).toBe('Opus 5');
    expect(q(costDisplay, '.ssl-cost').textContent).toBe('$4.5619');
    expect(q(costDisplay, '.ssl-io').textContent).toBe('150458 in / 1352 out');
  });

  it('leaves the context indicator empty for a brand-new session with nothing restored', async () => {
    await primeStores();
    const { createTerminalPane } = await import('./terminal-pane.js');

    const instance = createTerminalPane('fresh-1', '/project', null, false, '', 'claude');

    expect(q(instance.element, '.context-indicator').children.length).toBe(0);
    expect(q(instance.element, '.ssl-cost').textContent).toBe('$0.0000');
  });

  it('does not paint a meter for a provider without context-window support', async () => {
    await primeStores(null, { totalTokens: 10_000, contextWindowSize: 200_000, usedPercentage: 5 });
    const { createTerminalPane } = await import('./terminal-pane.js');

    const instance = createTerminalPane('restored-codex', '/project', 'cli-4', true, '', 'codex');

    expect(q(instance.element, '.context-indicator').children.length).toBe(0);
  });
});

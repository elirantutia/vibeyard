import { beforeEach, describe, expect, it, vi } from 'vitest';

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
}

class FakeElement {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  className = '';
  classList = new FakeClassList();
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  textContent = '';

  constructor(public tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
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

  querySelector(selector: string): FakeElement | null {
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.find((child) => child.className.split(/\s+/).includes(className) || child.classList.contains(className));
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

  function costText(instance: any) {
    return instance.element.querySelector('.cost-display')!.textContent as string;
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

    expect(costText(instance)).toBe('$0.0000');
  });

  it('prefixes the cost string with the profile matching the spawned config dir', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane } = await import('./terminal-pane.js');
    appState.profiles.push(makeProfile('work', 'Work'), makeProfile('personal', 'Personal'));

    const instance = makePane(createTerminalPane, 'pb-2', 'claude', '/cfg/personal');

    expect(costText(instance)).toBe('Personal  ·  $0.0000');
  });

  it('labels a session on the base config dir (no configDir) as "Default"', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane } = await import('./terminal-pane.js');
    appState.profiles.push(makeProfile('work', 'Work'), makeProfile('personal', 'Personal'));

    const instance = makePane(createTerminalPane, 'pb-3', 'claude', undefined); // base ~/.claude

    expect(costText(instance)).toBe('Default  ·  $0.0000');
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

    expect(costText(instance)).toBe('$0.0000');
  });

  it('refreshProfileLabels re-renders the prefix after a second profile is added', async () => {
    const { appState } = await import('../state.js');
    const { createTerminalPane, refreshProfileLabels } = await import('./terminal-pane.js');
    appState.profiles.push(makeProfile('work', 'Work'));

    const instance = makePane(createTerminalPane, 'pb-5', 'claude', '/cfg/work');
    expect(costText(instance)).toBe('$0.0000');

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

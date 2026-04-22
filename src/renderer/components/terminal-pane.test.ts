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
  onData(): void {}
  open(): void {}
  write(): void {}
  focus(): void {}
  dispose(): void {}
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FakeFitAddon {
    fit(): void {}
  },
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class FakeWebglAddon {},
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
}));

vi.mock('../session-context.js', () => ({
  removeSession: vi.fn(),
}));

vi.mock('../provider-availability.js', () => ({
  getProviderCapabilities: vi.fn((providerId: string) => providerCaps.get(providerId) ?? null),
}));

vi.mock('./terminal-link-provider.js', () => ({
  FilePathLinkProvider: class FakeFilePathLinkProvider {},
  GithubLinkProvider: class FakeGithubLinkProvider {},
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
  textContent = '';

  constructor(public tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
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

    expect(mockPtyCreate).toHaveBeenCalledWith('claude-1', '/project', null, false, '', 'claude', 'fix the bug');
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('passes pending prompt as initialPrompt to pty.create for codex', async () => {
    const { createTerminalPane, setPendingPrompt, spawnTerminal } = await import('./terminal-pane.js');
    const mockPtyCreate = (window as any).vibeyard.pty.create;

    createTerminalPane('codex-1', '/project', null, false, '', 'codex');
    setPendingPrompt('codex-1', 'fix the bug');
    await spawnTerminal('codex-1');

    expect(mockPtyCreate).toHaveBeenCalledWith('codex-1', '/project', null, false, '', 'codex', 'fix the bug');
    expect(mockPtyWrite).not.toHaveBeenCalled();
  });

  it('does not pass initialPrompt when no pending prompt is set', async () => {
    const { createTerminalPane, spawnTerminal } = await import('./terminal-pane.js');
    const mockPtyCreate = (window as any).vibeyard.pty.create;

    createTerminalPane('claude-2', '/project', null, false, '', 'claude');
    await spawnTerminal('claude-2');

    expect(mockPtyCreate).toHaveBeenCalledWith('claude-2', '/project', null, false, '', 'claude', undefined);
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

    expect(mockClipboardWrite).toHaveBeenCalledWith('hello world');
  });

  it('does not copy on keyup', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');
    const instance = createTerminalPane('s2', '/project', null);
    const term = instance.terminal as unknown as FakeTerminal;

    term.setSelection('hello world');
    term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keyup' });

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it('does not copy when nothing is selected', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');
    const instance = createTerminalPane('s3', '/project', null);
    const term = instance.terminal as unknown as FakeTerminal;

    term.setSelection('');
    term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it('returns false to prevent default on Ctrl+Shift+C', async () => {
    const { createTerminalPane } = await import('./terminal-pane.js');
    const instance = createTerminalPane('s4', '/project', null);
    const term = instance.terminal as unknown as FakeTerminal;

    const result = term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(result).toBe(false);
  });
});

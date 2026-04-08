import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockClipboardWrite = vi.fn();
const mockPtyWrite = vi.fn();

class FakeTerminal {
  cols = 120;
  rows = 30;
  private keyHandler: ((e: KeyboardEvent) => boolean) | null = null;
  private _selection = '';

  loadAddon(): void {}
  attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void {
    this.keyHandler = handler;
  }
  simulateKey(event: Partial<KeyboardEvent>): boolean {
    return this.keyHandler ? this.keyHandler(event as KeyboardEvent) : true;
  }
  getSelection(): string { return this._selection; }
  setSelection(s: string): void { this._selection = s; }
  onData(_cb: (data: string) => void): void {}
  open(): void {}
  write(): void {}
  focus(): void {}
  dispose(): void {}
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }));
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }));

const mockStateOn = vi.fn();

vi.mock('../state.js', () => ({
  appState: {
    projects: [],
    activeProject: null,
    on: (...args: unknown[]) => mockStateOn(...args),
    setTerminalPanelOpen: vi.fn(),
    setTerminalPanelHeight: vi.fn(),
  },
}));

vi.mock('./terminal-pane.js', () => ({ fitAllVisible: vi.fn() }));
vi.mock('./search-bar.js', () => ({ destroySearchBar: vi.fn(), hideSearchBar: vi.fn() }));
vi.mock('../shortcuts.js', () => ({
  shortcutManager: { getKeys: vi.fn(() => []) },
  displayKeys: vi.fn(() => ''),
  shortcutMatchesEvent: vi.fn((id: string, e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (id === 'terminal-copy') return ctrl && !e.shiftKey && e.key.toLowerCase() === 'c';
    if (id === 'terminal-copy-legacy') return ctrl && e.shiftKey && e.key === 'C';
    if (id === 'terminal-paste') return ctrl && !e.shiftKey && e.key.toLowerCase() === 'v';
    return false;
  }),
}));

class FakeEl {
  style: Record<string, string> = {};
  classList = { add: vi.fn(), remove: vi.fn(), contains: vi.fn(() => false) };
  children: FakeEl[] = [];
  offsetHeight = 200;

  addEventListener(): void {}
  appendChild(child: FakeEl): FakeEl { this.children.push(child); return child; }
  contains(): boolean { return false; }
  querySelector(): null { return null; }
  observe(): void {}
}

function makeFakeDocument() {
  const els = new Map<string, FakeEl>();
  return {
    getElementById: (id: string) => {
      if (!els.has(id)) els.set(id, new FakeEl());
      return els.get(id)!;
    },
    createElement: () => new FakeEl(),
    addEventListener: vi.fn(),
    body: new FakeEl(),
  };
}

describe('project-terminal Ctrl+Shift+C clipboard copy', () => {
  let stateHandlers: Record<string, (() => void)[]>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    stateHandlers = {};
    mockStateOn.mockImplementation((event: string, cb: () => void) => {
      if (!stateHandlers[event]) stateHandlers[event] = [];
      stateHandlers[event].push(cb);
    });

    vi.stubGlobal('document', makeFakeDocument());
    vi.stubGlobal('window', {
      vibeyard: {
        pty: { write: mockPtyWrite, kill: vi.fn(), resize: vi.fn(), createShell: vi.fn() },
      },
    });
    vi.stubGlobal('navigator', { clipboard: { writeText: mockClipboardWrite } });
    vi.stubGlobal('ResizeObserver', class { observe(): void {} });
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => cb());
  });

  async function setupTerminal() {
    const { appState } = await import('../state.js');
    const { initProjectTerminal, getShellTerminalInstance } = await import('./project-terminal.js');

    const project = { id: 'proj1', path: '/project', terminalPanelOpen: true, terminalPanelHeight: 200, sessions: [] };
    (appState as any).activeProject = project;
    (appState as any).projects = [project];

    initProjectTerminal();

    // Trigger state-loaded → showPanel → ensureShell
    stateHandlers['state-loaded']?.forEach(cb => cb());

    return getShellTerminalInstance('shell-proj1');
  }

  it('copies selected text to clipboard on Ctrl+Shift+C keydown', async () => {
    const instance = await setupTerminal();
    const term = instance!.terminal as unknown as FakeTerminal;

    term.setSelection('copied text');
    term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(mockClipboardWrite).toHaveBeenCalledWith('copied text');
  });

  it('does not copy on keyup', async () => {
    const instance = await setupTerminal();
    const term = instance!.terminal as unknown as FakeTerminal;

    term.setSelection('some text');
    term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keyup' });

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it('does not copy when nothing is selected', async () => {
    const instance = await setupTerminal();
    const term = instance!.terminal as unknown as FakeTerminal;

    term.setSelection('');
    term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(mockClipboardWrite).not.toHaveBeenCalled();
  });

  it('returns false to prevent default on Ctrl+Shift+C', async () => {
    const instance = await setupTerminal();
    const term = instance!.terminal as unknown as FakeTerminal;

    const result = term.simulateKey({ ctrlKey: true, shiftKey: true, key: 'C', type: 'keydown' });

    expect(result).toBe(false);
  });
});

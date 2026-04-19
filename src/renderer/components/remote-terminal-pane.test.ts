import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeTerminal {
  options: Record<string, unknown>;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }

  loadAddon(): void {}
  onData(): void {}
  open(): void {}
  write(): void {}
  dispose(): void {}
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {} }));

class FakeClassList {
  private values = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) this.values.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) this.values.delete(token);
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
  innerHTML = '';

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(): void {}

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    return this.find((child) => child.className.split(/\s+/).includes(className));
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
  createElement(): FakeElement {
    return new FakeElement();
  }
}

describe('applyThemeToAllRemoteTerminals()', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('document', new FakeDocument());
  });

  it('updates existing remote terminals to the selected theme', async () => {
    const { darkTerminalTheme, lightTerminalTheme } = await import('../terminal-theme.js');
    const { createRemoteTerminalPane, getRemoteTerminalInstance, applyThemeToAllRemoteTerminals, _resetForTesting } = await import('./remote-terminal-pane.js');

    _resetForTesting();
    createRemoteTerminalPane('remote-1', 'readonly', 80, 24, () => {});
    const instance = getRemoteTerminalInstance('remote-1')!;

    expect((instance.terminal as unknown as FakeTerminal).options.theme).toBe(darkTerminalTheme);

    applyThemeToAllRemoteTerminals('light');

    expect((instance.terminal as unknown as FakeTerminal).options.theme).toBe(lightTerminalTheme);
  });
});

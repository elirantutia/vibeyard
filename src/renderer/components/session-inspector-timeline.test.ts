import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../session-inspector-state.js', () => ({
  getEvents: vi.fn(),
  getCostDeltas: vi.fn(() => []),
}));

vi.mock('./session-inspector-state-ui.js', () => ({
  inspectorState: {
    inspectedSessionId: 'session-1',
    expandedRows: new Set<string>(),
    autoScroll: false,
    programmaticScroll: false,
  },
}));

import { getEvents } from '../session-inspector-state.js';
import { renderTimeline } from './session-inspector-timeline.js';

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
  textContent = '';
  innerHTML = '';
  scrollTop = 0;
  scrollHeight = 0;
  listeners = new Map<string, Array<() => void>>();

  constructor(public tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(event: string, cb: () => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(cb);
    this.listeners.set(event, listeners);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = [];
    const className = selector.startsWith('.') ? selector.slice(1) : null;
    this.walk((node) => {
      if (className && node.className.split(/\s+/).includes(className)) matches.push(node);
    });
    return matches;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  private walk(cb: (node: FakeElement) => void): void {
    for (const child of this.children) {
      cb(child);
      child.walk(cb);
    }
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

describe('session-inspector timeline MCP badges', () => {
  beforeEach(() => {
    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it('renders an MCP badge and friendly label for Claude MCP tools', () => {
    vi.mocked(getEvents).mockReturnValue([
      {
        type: 'permission_denied',
        timestamp: 1000,
        hookEvent: 'PermissionDenied',
        tool_name: 'mcp__memory__create_entities',
        tool_input: { entities: ['a'] },
      },
    ]);

    const container = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(container);

    const badges = (container as unknown as FakeElement)
      .querySelectorAll('.inspector-badge')
      .map((el) => el.textContent);
    const desc = (container as unknown as FakeElement).querySelector('.inspector-desc');

    expect(badges).toContain('Denied');
    expect(badges).toContain('MCP');
    expect(desc?.textContent).toBe('memory / create_entities');
  });

  it('does not add an MCP badge for regular tools', () => {
    vi.mocked(getEvents).mockReturnValue([
      {
        type: 'tool_use',
        timestamp: 1000,
        hookEvent: 'PostToolUse',
        tool_name: 'Bash',
      },
    ]);

    const container = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(container);

    const badges = (container as unknown as FakeElement)
      .querySelectorAll('.inspector-badge')
      .map((el) => el.textContent);

    expect(badges).toContain('Tool');
    expect(badges).not.toContain('MCP');
  });
});

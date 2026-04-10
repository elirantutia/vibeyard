import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shortcuts.js', () => ({
  shortcutManager: { matchesAnyShortcut: () => false },
}));

vi.mock('../session-inspector-state.js', () => ({
  getEvents: vi.fn(),
  getCostDeltas: vi.fn(() => []),
}));

vi.mock('./session-inspector-state-ui.js', () => ({
  inspectorState: {
    inspectedSessionId: 'session-1',
    expandedRows: new Set<string>(),
    autoExpandedAgentGroups: new Set<string>(),
    autoScroll: false,
    programmaticScroll: false,
  },
}));

import { getEvents } from '../session-inspector-state.js';
import { renderTimeline, buildAgentModel } from './session-inspector-timeline.js';
import { inspectorState } from './session-inspector-state-ui.js';
import type { InspectorEvent } from '../../shared/types.js';

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

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
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

// Helper to create minimal InspectorEvent
function ev(type: InspectorEvent['type'], timestamp: number, extra?: Partial<InspectorEvent>): InspectorEvent {
  return { type, timestamp, hookEvent: type, ...extra };
}

describe('buildAgentModel', () => {
  it('pairs sequential agents correctly', () => {
    const events: InspectorEvent[] = [
      ev('subagent_start', 1000, { agent_id: 'A' }),
      ev('tool_use', 1100, { tool_name: 'Bash', agent_id: 'A' }),
      ev('subagent_stop', 1200, { agent_id: 'A' }),
      ev('subagent_start', 1300, { agent_id: 'B' }),
      ev('tool_use', 1400, { tool_name: 'Read', agent_id: 'B' }),
      ev('subagent_stop', 1500, { agent_id: 'B' }),
    ];
    const model = buildAgentModel(events, 0);

    expect(model.spans.get('A')!.startIdx).toBe(0);
    expect(model.spans.get('A')!.stopIdx).toBe(2);
    expect(model.spans.get('B')!.startIdx).toBe(3);
    expect(model.spans.get('B')!.stopIdx).toBe(5);

    // Both top-level
    expect(model.spans.get('A')!.parentAgentId).toBeNull();
    expect(model.spans.get('B')!.parentAgentId).toBeNull();

    // Event attribution
    expect(model.eventOwner.get(1)).toBe('A');
    expect(model.eventOwner.get(4)).toBe('B');
  });

  it('renders overlapping agents as siblings and trusts event agent_id ownership', () => {
    const events: InspectorEvent[] = [
      ev('subagent_start', 1000, { agent_id: 'A' }),
      ev('subagent_start', 1100, { agent_id: 'B' }),
      ev('tool_use', 1200, { tool_name: 'Bash', agent_id: 'A' }),
      ev('tool_use', 1300, { tool_name: 'Read', agent_id: 'B' }),
      ev('subagent_stop', 1400, { agent_id: 'A' }),
      ev('subagent_stop', 1500, { agent_id: 'B' }),
    ];
    const model = buildAgentModel(events, 0);

    expect(model.spans.get('A')!.parentAgentId).toBeNull();
    expect(model.spans.get('B')!.parentAgentId).toBeNull();

    expect(model.eventOwner.get(2)).toBe('A');
    expect(model.eventOwner.get(3)).toBe('B');
    expect(model.spans.get('A')!.childEventIndices).toEqual([2]);
    expect(model.spans.get('B')!.childEventIndices).toEqual([3]);
  });

  it('keeps events without agent_id at the top level even while agents are open', () => {
    const events: InspectorEvent[] = [
      ev('subagent_start', 1000, { agent_id: 'A' }),
      ev('subagent_start', 1100, { agent_id: 'B' }),
      ev('tool_use', 1200, { tool_name: 'Bash' }),
      ev('subagent_stop', 1300, { agent_id: 'B' }),
      ev('tool_use', 1400, { tool_name: 'Read', agent_id: 'A' }),
      ev('subagent_stop', 1500, { agent_id: 'A' }),
    ];
    const model = buildAgentModel(events, 0);

    expect(model.spans.get('A')!.parentAgentId).toBeNull();
    expect(model.spans.get('B')!.parentAgentId).toBeNull();
    expect(model.eventOwner.has(2)).toBe(false);
    expect(model.eventOwner.get(4)).toBe('A');
    expect(model.spans.get('A')!.childEventIndices).toEqual([4]);
    expect(model.spans.get('B')!.childEventIndices).toEqual([]);
  });

  it('handles running agents (no stop event)', () => {
    const events: InspectorEvent[] = [
      ev('subagent_start', 1000, { agent_id: 'A' }),
      ev('tool_use', 1100, { tool_name: 'Bash', agent_id: 'A' }),
    ];
    const model = buildAgentModel(events, 0);

    expect(model.spans.get('A')!.isRunning).toBe(true);
    expect(model.spans.get('A')!.stopIdx).toBe(events.length);
    expect(model.eventOwner.get(1)).toBe('A');
  });

  it('top-level events before any agent are not attributed', () => {
    const events: InspectorEvent[] = [
      ev('user_prompt', 900),
      ev('tool_use', 950, { tool_name: 'Read' }),
      ev('subagent_start', 1000, { agent_id: 'A' }),
      ev('subagent_stop', 1100, { agent_id: 'A' }),
    ];
    const model = buildAgentModel(events, 0);

    expect(model.eventOwner.has(0)).toBe(false);
    expect(model.eventOwner.has(1)).toBe(false);
  });

  it('attaches non-lifecycle agent events by their own agent_id', () => {
    const events: InspectorEvent[] = [
      ev('subagent_start', 1000, { agent_id: 'A' }),
      ev('subagent_start', 1100, { agent_id: 'B' }),
      ev('teammate_idle', 1200, { agent_id: 'A', agent_type: 'Explore' }),
      ev('notification', 1300, { message: 'top-level notice' }),
      ev('teammate_idle', 1400, { agent_id: 'B', agent_type: 'Plan' }),
      ev('subagent_stop', 1500, { agent_id: 'A' }),
      ev('subagent_stop', 1600, { agent_id: 'B' }),
    ];
    const model = buildAgentModel(events, 0);

    expect(model.eventOwner.get(2)).toBe('A');
    expect(model.eventOwner.has(3)).toBe(false);
    expect(model.eventOwner.get(4)).toBe('B');
    expect(model.spans.get('A')!.childEventIndices).toEqual([2]);
    expect(model.spans.get('B')!.childEventIndices).toEqual([4]);
  });

  it('stopIndices contains all stop event indices', () => {
    const events: InspectorEvent[] = [
      ev('subagent_start', 1000, { agent_id: 'A' }),
      ev('subagent_stop', 1100, { agent_id: 'A' }),
      ev('subagent_start', 1200, { agent_id: 'B' }),
      ev('subagent_stop', 1300, { agent_id: 'B' }),
    ];
    const model = buildAgentModel(events, 0);

    expect(model.stopIndices).toEqual(new Set([1, 3]));
  });
});

describe('renderTimeline agent grouping', () => {
  beforeEach(() => {
    vi.stubGlobal('document', new FakeDocument());
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    inspectorState.expandedRows.clear();
    inspectorState.autoExpandedAgentGroups.clear();
  });

  it('renders overlapping agents as sibling groups', () => {
    inspectorState.expandedRows.clear();
    inspectorState.expandedRows.add('agent-group:A');
    inspectorState.expandedRows.add('agent-group:B');

    vi.mocked(getEvents).mockReturnValue([
      ev('subagent_start', 1000, { agent_id: 'A', agent_type: 'Explore' }),
      ev('subagent_start', 1100, { agent_id: 'B', agent_type: 'Plan' }),
      ev('tool_use', 1200, { tool_name: 'Bash', agent_id: 'A' }),
      ev('subagent_stop', 1300, { agent_id: 'A' }),
      ev('subagent_stop', 1400, { agent_id: 'B' }),
    ]);

    const container = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(container);

    const timeline = (container as unknown as FakeElement).querySelector('.inspector-timeline');
    const topGroups = timeline!.children.filter(
      (c) => c.className.includes('inspector-agent-group')
    );
    expect(topGroups.length).toBe(2);
    expect(topGroups[0].querySelectorAll('.inspector-agent-group')).toHaveLength(0);
    expect(topGroups[1].querySelectorAll('.inspector-agent-group')).toHaveLength(0);
  });

  it('renders only matching child events inside each expanded agent group', () => {
    inspectorState.expandedRows.add('agent-group:A');
    inspectorState.expandedRows.add('agent-group:B');

    vi.mocked(getEvents).mockReturnValue([
      ev('subagent_start', 1000, { agent_id: 'A', agent_type: 'Explore' }),
      ev('subagent_start', 1100, { agent_id: 'B', agent_type: 'Plan' }),
      ev('tool_use', 1200, { tool_name: 'Bash', agent_id: 'A' }),
      ev('tool_use', 1250, { tool_name: 'Read', agent_id: 'B' }),
      ev('notification', 1275, { message: 'top-level notice' }),
      ev('subagent_stop', 1300, { agent_id: 'B' }),
      ev('subagent_stop', 1400, { agent_id: 'A' }),
    ]);

    const container = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(container);

    const timeline = (container as unknown as FakeElement).querySelector('.inspector-timeline');
    const topGroups = timeline!.children.filter(
      (c) => c.className.includes('inspector-agent-group')
    );
    expect(topGroups.length).toBe(2);

    const topLevelDescs = timeline!.children
      .flatMap((c) => c.querySelectorAll('.inspector-desc'))
      .map((el) => el.textContent);
    expect(topLevelDescs).toContain('top-level notice');

    const groupTexts = topGroups.map((group) =>
      group.querySelectorAll('.inspector-desc').map((row) => row.textContent).join(' | ')
    );
    expect(groupTexts[0]).toContain('Bash');
    expect(groupTexts[0]).not.toContain('Read');
    expect(groupTexts[1]).toContain('Read');
    expect(groupTexts[1]).not.toContain('Bash');
  });

  it('auto-expands a running agent group only once', () => {
    vi.mocked(getEvents).mockReturnValue([
      ev('subagent_start', 1000, { agent_id: 'A', agent_type: 'Explore' }),
      ev('tool_use', 1100, { tool_name: 'Bash', agent_id: 'A' }),
    ]);

    const container = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(container);

    const firstGroup = (container as unknown as FakeElement).querySelector('.inspector-agent-group');
    expect(firstGroup?.querySelector('.inspector-agent-children')).not.toBeNull();
    expect(inspectorState.expandedRows.has('agent-group:A')).toBe(true);
    expect(inspectorState.autoExpandedAgentGroups.has('session-1:agent-group:A')).toBe(true);

    const header = firstGroup?.querySelector('.inspector-agent-header') as FakeElement;
    header.listeners.get('click')?.[0]?.();
    expect(inspectorState.expandedRows.has('agent-group:A')).toBe(false);

    vi.mocked(getEvents).mockReturnValue([
      ev('subagent_start', 1000, { agent_id: 'A', agent_type: 'Explore' }),
      ev('tool_use', 1100, { tool_name: 'Bash', agent_id: 'A' }),
      ev('tool_use', 1200, { tool_name: 'Read', agent_id: 'A' }),
    ]);

    const rerenderedContainer = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(rerenderedContainer);

    const rerenderedGroup = (rerenderedContainer as unknown as FakeElement).querySelector('.inspector-agent-group');
    expect(rerenderedGroup?.querySelector('.inspector-agent-children')).toBeNull();
    expect(inspectorState.expandedRows.has('agent-group:A')).toBe(false);
  });

  it('keeps a manually reopened running agent group open across rerenders', () => {
    inspectorState.autoExpandedAgentGroups.add('session-1:agent-group:A');

    vi.mocked(getEvents).mockReturnValue([
      ev('subagent_start', 1000, { agent_id: 'A', agent_type: 'Explore' }),
      ev('tool_use', 1100, { tool_name: 'Bash', agent_id: 'A' }),
    ]);

    const container = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(container);

    const group = (container as unknown as FakeElement).querySelector('.inspector-agent-group');
    const header = group?.querySelector('.inspector-agent-header') as FakeElement;
    header.listeners.get('click')?.[0]?.();
    expect(inspectorState.expandedRows.has('agent-group:A')).toBe(true);

    vi.mocked(getEvents).mockReturnValue([
      ev('subagent_start', 1000, { agent_id: 'A', agent_type: 'Explore' }),
      ev('tool_use', 1100, { tool_name: 'Bash', agent_id: 'A' }),
      ev('tool_use', 1200, { tool_name: 'Read', agent_id: 'A' }),
    ]);

    const rerenderedContainer = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(rerenderedContainer);

    const rerenderedGroup = (rerenderedContainer as unknown as FakeElement).querySelector('.inspector-agent-group');
    expect(rerenderedGroup?.querySelector('.inspector-agent-children')).not.toBeNull();
    expect(inspectorState.expandedRows.has('agent-group:A')).toBe(true);
  });

  it('still auto-expands a different newly seen running agent', () => {
    inspectorState.autoExpandedAgentGroups.add('session-1:agent-group:A');

    vi.mocked(getEvents).mockReturnValue([
      ev('subagent_start', 1000, { agent_id: 'A', agent_type: 'Explore' }),
      ev('tool_use', 1100, { tool_name: 'Bash', agent_id: 'A' }),
      ev('subagent_start', 1200, { agent_id: 'B', agent_type: 'Plan' }),
      ev('tool_use', 1300, { tool_name: 'Read', agent_id: 'B' }),
    ]);

    const container = new FakeElement('div') as unknown as HTMLElement;
    renderTimeline(container);

    const groups = (container as unknown as FakeElement).querySelectorAll('.inspector-agent-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.querySelector('.inspector-agent-children')).toBeNull();
    expect(groups[1]?.querySelector('.inspector-agent-children')).not.toBeNull();
    expect(inspectorState.expandedRows.has('agent-group:A')).toBe(false);
    expect(inspectorState.expandedRows.has('agent-group:B')).toBe(true);
    expect(inspectorState.autoExpandedAgentGroups.has('session-1:agent-group:B')).toBe(true);
  });
});

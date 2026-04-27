import { describe, expect, it, vi } from 'vitest';

vi.mock('../shortcuts.js', () => ({
  shortcutManager: { matchesAnyShortcut: () => false },
}));

import { isMcpToolEvent, parseMcpToolName } from './session-inspector-utils.js';

describe('parseMcpToolName', () => {
  it('parses Claude MCP tool names into server and tool labels', () => {
    expect(parseMcpToolName('mcp__memory__create_entities')).toEqual({
      rawToolName: 'mcp__memory__create_entities',
      server: 'memory',
      tool: 'create_entities',
      displayLabel: 'memory / create_entities',
    });
  });

  it('returns null for non-MCP or malformed tool names', () => {
    expect(parseMcpToolName('Bash')).toBeNull();
    expect(parseMcpToolName('mcp__memory')).toBeNull();
    expect(parseMcpToolName('mcp____tool')).toBeNull();
  });
});

describe('isMcpToolEvent', () => {
  it('only marks documented Claude tool hook event types as MCP tool events', () => {
    expect(isMcpToolEvent({ type: 'pre_tool_use', tool_name: 'mcp__github__search_repositories' })).toBe(true);
    expect(isMcpToolEvent({ type: 'permission_request', tool_name: 'mcp__github__search_repositories' })).toBe(true);
    expect(isMcpToolEvent({ type: 'permission_denied', tool_name: 'mcp__github__search_repositories' })).toBe(true);
    expect(isMcpToolEvent({ type: 'session_start', tool_name: 'mcp__github__search_repositories' })).toBe(false);
    expect(isMcpToolEvent({ type: 'tool_use', tool_name: 'Bash' })).toBe(false);
  });
});

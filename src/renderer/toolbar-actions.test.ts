import { describe, expect, it } from 'vitest';
import { AVAILABLE_ACTION_OPTIONS, DEFAULT_AVAILABLE_ACTIONS, getAvailableActions } from './toolbar-actions.js';

describe('toolbar-actions', () => {
  it('lists all user-configurable available actions', () => {
    expect(AVAILABLE_ACTION_OPTIONS.map((option) => option.key)).toEqual([
      'sessionIndicators',
      'usageStats',
      'terminal',
      'mcp',
      'swarmMode',
      'newSession',
      'browserTab',
      'remoteSession',
    ]);
  });

  it('merges saved action visibility over defaults', () => {
    expect(getAvailableActions({
      availableActions: {
        ...DEFAULT_AVAILABLE_ACTIONS,
        usageStats: false,
        remoteSession: false,
      },
    })).toEqual({
      sessionIndicators: true,
      usageStats: false,
      terminal: true,
      mcp: true,
      swarmMode: true,
      newSession: true,
      browserTab: true,
      remoteSession: false,
    });
  });
});

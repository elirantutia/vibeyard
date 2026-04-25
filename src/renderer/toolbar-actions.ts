import type { Preferences } from '../shared/types.js';

export type AvailableActionKey = keyof NonNullable<Preferences['availableActions']>;
export type AvailableActions = NonNullable<Preferences['availableActions']>;

export interface AvailableActionOption {
  key: AvailableActionKey;
  label: string;
}

export const DEFAULT_AVAILABLE_ACTIONS: AvailableActions = {
  sessionIndicators: true,
  usageStats: true,
  terminal: true,
  mcp: true,
  swarmMode: true,
  newSession: true,
  browserTab: true,
  remoteSession: true,
};

export const AVAILABLE_ACTION_OPTIONS: AvailableActionOption[] = [
  { key: 'sessionIndicators', label: 'Session Indicators' },
  { key: 'usageStats', label: 'Usage Stats' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'mcp', label: 'MCP' },
  { key: 'swarmMode', label: 'Swarm Mode' },
  { key: 'newSession', label: 'New Session' },
  { key: 'browserTab', label: 'Browser Tab' },
  { key: 'remoteSession', label: 'Remote Session' },
];

export function getAvailableActions(preferences: Pick<Preferences, 'availableActions'>): AvailableActions {
  return {
    ...DEFAULT_AVAILABLE_ACTIONS,
    ...(preferences.availableActions ?? {}),
  };
}

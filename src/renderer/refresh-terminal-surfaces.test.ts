import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Preferences } from '../shared/types.js';

const {
  sessionTerminal,
  getAllInstances,
  applyShellTerminalsSurface,
  applyRemoteTerminalsSurface,
  syncSessionTerminalsWebglFromPreferences,
  syncShellTerminalsWebglFromPreferences,
  syncRemoteTerminalsWebglFromPreferences,
} = vi.hoisted(() => {
  const sessionTerminal: { options: { theme: Record<string, string> } } = {
    options: { theme: { foreground: '#e0e0e0' } },
  };
  return {
    sessionTerminal,
    getAllInstances: vi.fn(() => new Map([['s1', { terminal: sessionTerminal }]])),
    applyShellTerminalsSurface: vi.fn(),
    applyRemoteTerminalsSurface: vi.fn(),
    syncSessionTerminalsWebglFromPreferences: vi.fn(),
    syncShellTerminalsWebglFromPreferences: vi.fn(),
    syncRemoteTerminalsWebglFromPreferences: vi.fn(),
  };
});

vi.mock('./components/terminal-pane.js', () => ({
  getAllInstances,
  syncSessionTerminalsWebglFromPreferences,
}));
vi.mock('./components/project-terminal.js', () => ({
  applyShellTerminalsSurface,
  syncShellTerminalsWebglFromPreferences,
}));
vi.mock('./components/remote-terminal-pane.js', () => ({
  applyRemoteTerminalsSurface,
  syncRemoteTerminalsWebglFromPreferences,
}));

import { refreshTerminalSurfacesFromPreferences } from './refresh-terminal-surfaces.js';

function prefs(p: Partial<Preferences>): Preferences {
  return {
    soundOnSessionWaiting: true,
    notificationsDesktop: true,
    debugMode: false,
    sessionHistoryEnabled: true,
    insightsEnabled: true,
    autoTitleEnabled: true,
    ...p,
  } as Preferences;
}

describe('refreshTerminalSurfacesFromPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionTerminal.options.theme = { foreground: '#e0e0e0' };
  });

  it('sets opaque cell background when backdrop is off', () => {
    const p = prefs({ terminalBackgroundMode: 'none' });
    refreshTerminalSurfacesFromPreferences(p);
    expect(sessionTerminal.options.theme.background).toBe('#000000');
    expect(applyShellTerminalsSurface).toHaveBeenCalledWith('#000000');
    expect(applyRemoteTerminalsSurface).toHaveBeenCalledWith('#000000');
    expect(getAllInstances).toHaveBeenCalled();
    expect(syncSessionTerminalsWebglFromPreferences).toHaveBeenCalledWith(p);
    expect(syncShellTerminalsWebglFromPreferences).toHaveBeenCalledWith(p);
    expect(syncRemoteTerminalsWebglFromPreferences).toHaveBeenCalledWith(p);
  });

  it('sets translucent cell background when preset backdrop is active', () => {
    const p = prefs({ terminalBackgroundMode: 'preset', terminalBackgroundSurfaceAlpha: 0.5 });
    refreshTerminalSurfacesFromPreferences(p);
    expect(sessionTerminal.options.theme.background).toBe('rgba(0,0,0,0.5)');
    expect(applyShellTerminalsSurface).toHaveBeenCalledWith('rgba(0,0,0,0.5)');
    expect(syncSessionTerminalsWebglFromPreferences).toHaveBeenCalledWith(p);
  });
});

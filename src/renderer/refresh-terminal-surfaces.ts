import type { Preferences } from '../shared/types.js';
import { getTerminalSurfaceBackgroundColor } from './terminal-background-helpers.js';
import { getAllInstances, syncSessionTerminalsWebglFromPreferences } from './components/terminal-pane.js';
import { applyShellTerminalsSurface, syncShellTerminalsWebglFromPreferences } from './components/project-terminal.js';
import { applyRemoteTerminalsSurface, syncRemoteTerminalsWebglFromPreferences } from './components/remote-terminal-pane.js';

/** Push current preferences into every live xterm instance. */
export function refreshTerminalSurfacesFromPreferences(prefs: Preferences): void {
  const bg = getTerminalSurfaceBackgroundColor(prefs);
  for (const [, inst] of getAllInstances()) {
    inst.terminal.options.theme = { ...inst.terminal.options.theme, background: bg };
  }
  applyShellTerminalsSurface(bg);
  applyRemoteTerminalsSurface(bg);
  syncSessionTerminalsWebglFromPreferences(prefs);
  syncShellTerminalsWebglFromPreferences(prefs);
  syncRemoteTerminalsWebglFromPreferences(prefs);
}

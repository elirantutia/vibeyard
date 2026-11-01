import { appState } from './state.js';
import { closeSessionWithConfirm, needsCloseConfirmation } from './session-close.js';
import { getStatus } from './session-activity.js';
import { getTerminalInstance } from './components/terminal-pane.js';
import { resolveCliProvider } from './state/specialized-sessions.js';
import { getProviderCapabilities } from './provider-availability.js';
import { handleCtlCommand, type CtlHandlerDeps } from './ctl-handler.js';
import { ctlError, type CtlResult } from '../shared/ctl-protocol.js';
import type { ProviderId } from '../shared/types.js';

const deps: CtlHandlerDeps = {
  projects: () => appState.projects,
  addExternalSession: (projectId, opts) => appState.addExternalSession(projectId, opts),
  renameSession: (projectId, sessionId, name, userRenamed) => appState.renameSession(projectId, sessionId, name, userRenamed),
  closeSessionWithConfirm,
  needsCloseConfirmation,
  hookStatus: (id) => getStatus(id),
  terminalState: (id) => {
    const t = getTerminalInstance(id);
    return t ? { spawned: t.spawned, exited: t.exited } : undefined;
  },
  isKnownProvider: (id) => getProviderCapabilities(id as ProviderId) !== null,
  effectiveProvider: (requested) => resolveCliProvider(appState.preferences, requested as ProviderId | undefined),
  profileProvider: (profileId) => appState.profiles.find((p) => p.id === profileId)?.providerId,
};

export function initCtlBridge(): void {
  window.vibeyard.ctl.onCommand((reqId, callerId, command) => {
    let result: CtlResult;
    try {
      result = handleCtlCommand(deps, callerId, command);
      if (!result) result = ctlError('invalid_request', 'unknown command');
    } catch (e) {
      result = ctlError('invalid_request', (e as Error).message);
    }
    window.vibeyard.ctl.reply(reqId, result);
  });

  let last = appState.preferences.externalControlEnabled === true;
  window.vibeyard.ctl.setEnabled(last);
  appState.on('preferences-changed', () => {
    const now = appState.preferences.externalControlEnabled === true;
    if (now !== last) {
      last = now;
      window.vibeyard.ctl.setEnabled(now);
    }
  });
  window.vibeyard.ctl.rendererReady();
}

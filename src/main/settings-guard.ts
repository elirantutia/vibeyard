import * as path from 'path';
import { homedir } from 'os';
import { ipcMain, BrowserWindow } from 'electron';
import { getStatusLineScriptPath } from './hook-status';
import { HOOK_MARKER, installHooksOnly, installStatusLine, getSupportedHookEvents } from './claude-cli';
import { readJsonSafe } from './fs-utils';
import { loadState, saveState } from './store';
import type { SettingsValidationResult } from '../shared/types';

const LEGACY_STATUSLINE_RE = /[/\\]vibeyard[/\\]statusline\.(sh|cmd)$/;

const CANDIDATE_HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PostToolUse',
  'PostToolUseFailure', 'Stop', 'StopFailure', 'PermissionRequest',
];

/**
 * Hook events the guard expects to find installed, filtered by which events
 * the currently-installed Claude CLI version actually supports. Events that
 * the CLI does not support are dropped so the guard does not flag them as
 * "missing" and trigger a reinstall loop.
 */
function getExpectedHookEvents(): string[] {
  const supported = getSupportedHookEvents();
  return CANDIDATE_HOOK_EVENTS.filter(e => supported.has(e));
}

function readClaudeSettings(): Record<string, unknown> {
  return readJsonSafe(path.join(homedir(), '.claude', 'settings.json')) ?? {};
}

export function isVibeyardStatusLine(statusLine: unknown): boolean {
  if (!statusLine || typeof statusLine !== 'object') return false;
  const sl = statusLine as Record<string, unknown>;
  if (sl.command === getStatusLineScriptPath()) return true;
  // Recognize legacy Vibeyard statusline paths (e.g. /tmp/vibeyard/statusline.sh)
  // so upgrades silently replace them without showing a conflict dialog.
  if (typeof sl.command === 'string') {
    return LEGACY_STATUSLINE_RE.test(sl.command);
  }
  return false;
}

export function validateSettings(): SettingsValidationResult {
  const settings = readClaudeSettings();
  const expectedHookEvents = getExpectedHookEvents();

  let statusLine: SettingsValidationResult['statusLine'] = 'missing';
  let foreignStatusLineCommand: string | undefined;
  if (settings.statusLine) {
    if (isVibeyardStatusLine(settings.statusLine)) {
      statusLine = 'vibeyard';
    } else {
      statusLine = 'foreign';
      const sl = settings.statusLine as Record<string, unknown>;
      foreignStatusLineCommand = String(sl.command ?? sl.url ?? JSON.stringify(settings.statusLine));
    }
  }

  let hooks: SettingsValidationResult['hooks'] = 'missing';
  const hookDetails: Record<string, boolean> = Object.fromEntries(expectedHookEvents.map(e => [e, false]));
  const existingHooks = settings.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>> | undefined;
  if (existingHooks) {
    let found = 0;
    for (const event of expectedHookEvents) {
      const matchers = existingHooks[event];
      const installed = matchers?.some(m => m.hooks?.some(h => h.command?.includes(HOOK_MARKER))) ?? false;
      hookDetails[event] = installed;
      if (installed) found++;
    }
    if (found === expectedHookEvents.length) {
      hooks = 'complete';
    } else if (found > 0) {
      hooks = 'partial';
    }
  }

  return { statusLine, hooks, foreignStatusLineCommand, hookDetails };
}

/**
 * Whether the per-session warning banner should flag the statusLine state.
 *
 * Consent is bound to the specific foreign command the user was asked about.
 * A different foreign command is a new conflict and still warrants a warning,
 * even if the user previously declined a different one.
 */
export function shouldWarnStatusLine(
  statusLine: SettingsValidationResult['statusLine'],
  consent: 'granted' | 'declined' | null | undefined,
  consentCommand: string | null | undefined,
  currentForeignCommand: string | null | undefined,
): boolean {
  if (statusLine === 'vibeyard') return false;
  if (
    statusLine === 'foreign' &&
    consent === 'declined' &&
    !!consentCommand &&
    !!currentForeignCommand &&
    consentCommand === currentForeignCommand
  ) {
    return false;
  }
  return true;
}

/**
 * Guarded hook/statusLine installation. Shows a dialog if a foreign statusLine
 * is detected and the user hasn't previously granted/declined consent for
 * that specific foreign command.
 */
export async function guardedInstall(win: BrowserWindow | null): Promise<void> {
  const validation = validateSettings();

  // Always install hooks (additive, non-destructive)
  installHooksOnly();

  if (validation.statusLine === 'vibeyard' || validation.statusLine === 'missing') {
    installStatusLine();
    return;
  }

  // Foreign statusLine detected — check stored consent
  const state = loadState();
  const consent = state.preferences.statusLineConsent;
  const consentCommand = state.preferences.statusLineConsentCommand;
  const currentForeign = validation.foreignStatusLineCommand ?? '';

  // Legacy 'declined' without recorded command: assume the current foreign
  // is what the user originally chose to keep, and freeze it. Future edits
  // to a different command will re-prompt.
  if (consent === 'declined' && !consentCommand) {
    state.preferences.statusLineConsentCommand = currentForeign;
    saveState(state);
    return;
  }

  // Consent applies only to the specific foreign command it was given for.
  // A different (or unknown) foreign command is a new conflict — re-prompt.
  if (consent === 'granted' && consentCommand && consentCommand === currentForeign) {
    installStatusLine();
    return;
  }
  if (consent === 'declined' && consentCommand === currentForeign) {
    return;
  }

  // No prior decision for this foreign command — ask the user via in-app modal
  if (!win) return;

  // Wait for renderer to be ready before sending IPC
  if (win.webContents.isLoading()) {
    await new Promise<void>(resolve => win.webContents.once('did-finish-load', resolve));
  }

  const foreignCmd = validation.foreignStatusLineCommand ?? '(unknown)';
  const channel = 'settings:conflictDialogResponse';
  const choice = await new Promise<'replace' | 'keep'>((resolve) => {
    const onResponse = (_event: Electron.IpcMainEvent, c: string) => {
      win.removeListener('closed', onClose);
      resolve(c === 'replace' ? 'replace' : 'keep');
    };
    const onClose = () => {
      ipcMain.removeListener(channel, onResponse);
      resolve('keep');
    };
    ipcMain.once(channel, onResponse);
    win.once('closed', onClose);
    win.webContents.send('settings:showConflictDialog', { foreignCommand: foreignCmd });
  });

  state.preferences.statusLineConsent = choice === 'replace' ? 'granted' : 'declined';
  state.preferences.statusLineConsentCommand = currentForeign;
  saveState(state);

  if (choice === 'replace') {
    installStatusLine();
  }
}

/**
 * Force reinstall both hooks and statusLine (for "Fix Settings" CTA).
 * Resets consent to granted since this is an explicit user action.
 */
export function reinstallSettings(): void {
  installHooksOnly();
  installStatusLine();

  const state = loadState();
  state.preferences.statusLineConsent = 'granted';
  // No specific foreign command anymore — Vibeyard now owns the statusLine.
  state.preferences.statusLineConsentCommand = null;
  saveState(state);
}

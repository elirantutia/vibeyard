import * as path from 'path';
import { homedir } from 'os';
import { ipcMain, BrowserWindow } from 'electron';
import { getStatusLineScriptPath } from './hook-status';
import { HOOK_MARKER, defaultClaudeDir, installHooksOnly, installStatusLine, getSupportedHookEvents } from './claude-cli';
import { readJsonSafe } from './fs-utils';
import { loadState, saveState } from './store';
import type { Preferences, SettingsValidationResult, StatusLineConflictData } from '../shared/types';

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

function readClaudeSettings(configDir: string = path.join(homedir(), '.claude')): Record<string, unknown> {
  return readJsonSafe(path.join(configDir, 'settings.json')) ?? {};
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

export function validateSettings(configDir?: string): SettingsValidationResult {
  const settings = readClaudeSettings(configDir);
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

/** Key of a profile config dir in `statusLineConsentByDir`; null for ~/.claude. */
function profileConsentKey(configDir: string | undefined): string | null {
  if (!configDir) return null;
  const key = path.resolve(configDir);
  return key === path.resolve(defaultClaudeDir()) ? null : key;
}

/** Stored statusLine consent for a config dir (~/.claude when omitted). */
export function getStatusLineConsent(
  prefs: Preferences,
  configDir?: string,
): { consent: 'granted' | 'declined' | null | undefined; command: string | null | undefined } {
  const key = profileConsentKey(configDir);
  if (key === null) {
    return { consent: prefs.statusLineConsent, command: prefs.statusLineConsentCommand };
  }
  const record = prefs.statusLineConsentByDir?.[key];
  return { consent: record?.consent, command: record?.command };
}

function setStatusLineConsent(
  prefs: Preferences,
  configDir: string | undefined,
  consent: 'granted' | 'declined',
  command: string,
): void {
  const key = profileConsentKey(configDir);
  if (key === null) {
    prefs.statusLineConsent = consent;
    prefs.statusLineConsentCommand = command;
    return;
  }
  prefs.statusLineConsentByDir = { ...prefs.statusLineConsentByDir, [key]: { consent, command } };
}

// The renderer has a single conflict modal (opening a second one answers the
// first with 'keep') and replies on one shared channel, so prompts must never
// overlap: each waits for the previous one to be answered.
let dialogChain: Promise<unknown> = Promise.resolve();

function askConflict(win: BrowserWindow, data: StatusLineConflictData): Promise<'replace' | 'keep'> {
  const ask = dialogChain.then(() => showConflictDialog(win, data));
  dialogChain = ask.catch(() => undefined);
  return ask;
}

async function showConflictDialog(win: BrowserWindow, data: StatusLineConflictData): Promise<'replace' | 'keep'> {
  if (win.isDestroyed()) return 'keep';

  // Wait for renderer to be ready before sending IPC
  if (win.webContents.isLoading()) {
    await new Promise<void>(resolve => win.webContents.once('did-finish-load', resolve));
  }

  const channel = 'settings:conflictDialogResponse';
  return new Promise<'replace' | 'keep'>((resolve) => {
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
    win.webContents.send('settings:showConflictDialog', data);
  });
}

// Several sessions of one profile can spawn at once (e.g. restore on launch);
// they share one guarded install instead of each prompting.
const inFlight = new Map<string, Promise<void>>();

/**
 * Guarded hook/statusLine installation into `configDir` (~/.claude when
 * omitted). Shows a dialog if a foreign statusLine is detected and the user
 * hasn't previously granted/declined consent for that specific foreign
 * command in that config dir.
 */
export function guardedInstall(win: BrowserWindow | null, configDir?: string): Promise<void> {
  const key = path.resolve(configDir ?? defaultClaudeDir());
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = runGuardedInstall(win, configDir).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function runGuardedInstall(win: BrowserWindow | null, configDir: string | undefined): Promise<void> {
  const validation = validateSettings(configDir);

  // Always install hooks (additive, non-destructive)
  installHooksOnly(configDir);

  if (validation.statusLine === 'vibeyard' || validation.statusLine === 'missing') {
    installStatusLine(configDir);
    return;
  }

  // Foreign statusLine detected — check stored consent
  const state = loadState();
  const { consent, command: consentCommand } = getStatusLineConsent(state.preferences, configDir);
  const currentForeign = validation.foreignStatusLineCommand ?? '';

  // Legacy 'declined' without recorded command: assume the current foreign
  // is what the user originally chose to keep, and freeze it. Future edits
  // to a different command will re-prompt.
  if (consent === 'declined' && !consentCommand) {
    setStatusLineConsent(state.preferences, configDir, 'declined', currentForeign);
    saveState(state);
    return;
  }

  // Consent applies only to the specific foreign command it was given for.
  // A different (or unknown) foreign command is a new conflict — re-prompt.
  if (consent === 'granted' && consentCommand && consentCommand === currentForeign) {
    installStatusLine(configDir);
    return;
  }
  if (consent === 'declined' && consentCommand === currentForeign) {
    return;
  }

  // No prior decision for this foreign command — ask the user via in-app modal
  if (!win) return;

  const choice = await askConflict(win, {
    foreignCommand: validation.foreignStatusLineCommand ?? '(unknown)',
    configDir: profileConsentKey(configDir) ?? undefined,
  });

  // Reload rather than reuse `state`: the prompt may have waited behind
  // others whose answers were saved in the meantime.
  const fresh = loadState();
  setStatusLineConsent(fresh.preferences, configDir, choice === 'replace' ? 'granted' : 'declined', currentForeign);
  saveState(fresh);

  if (choice === 'replace') {
    installStatusLine(configDir);
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

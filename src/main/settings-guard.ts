import * as path from 'path';
import { homedir } from 'os';
import { dialog, BrowserWindow } from 'electron';
import { getStatusLineScriptPath } from './hook-status';
import { HOOK_MARKER, installHooksOnly, installStatusLine } from './claude-cli';
import { readJsonSafe } from './fs-utils';
import { loadState, saveState } from './store';
import type { SettingsValidationResult } from '../shared/types';

const EXPECTED_HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PostToolUse',
  'PostToolUseFailure', 'Stop', 'StopFailure', 'PermissionRequest',
];

function readClaudeSettings(): Record<string, unknown> {
  return readJsonSafe(path.join(homedir(), '.claude', 'settings.json')) ?? {};
}

export function isVibeyardStatusLine(statusLine: unknown): boolean {
  if (!statusLine || typeof statusLine !== 'object') return false;
  const sl = statusLine as Record<string, unknown>;
  return sl.command === getStatusLineScriptPath();
}

export function validateSettings(): SettingsValidationResult {
  const settings = readClaudeSettings();

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
  const hookDetails: Record<string, boolean> = Object.fromEntries(EXPECTED_HOOK_EVENTS.map(e => [e, false]));
  const existingHooks = settings.hooks as Record<string, Array<{ hooks?: Array<{ command?: string }> }>> | undefined;
  if (existingHooks) {
    let found = 0;
    for (const event of EXPECTED_HOOK_EVENTS) {
      const matchers = existingHooks[event];
      const installed = matchers?.some(m => m.hooks?.some(h => h.command?.includes(HOOK_MARKER))) ?? false;
      hookDetails[event] = installed;
      if (installed) found++;
    }
    if (found === EXPECTED_HOOK_EVENTS.length) {
      hooks = 'complete';
    } else if (found > 0) {
      hooks = 'partial';
    }
  }

  return { statusLine, hooks, foreignStatusLineCommand, hookDetails };
}

/**
 * Guarded hook/statusLine installation. Shows a dialog if a foreign statusLine
 * is detected and the user hasn't previously granted/declined consent.
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

  if (consent === 'granted') {
    installStatusLine();
    return;
  }

  if (consent === 'declined') {
    return;
  }

  // No prior decision — ask the user
  const foreignCmd = validation.foreignStatusLineCommand ?? '(unknown)';
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: 'Vibeyard \u2014 Settings Conflict',
    message: 'Claude Code already has a statusLine setting configured.',
    detail:
      `Vibeyard needs to set its own statusLine for cost tracking and context window monitoring.\n\n` +
      `Current statusLine:\n${foreignCmd}\n\n` +
      `If you keep the existing setting, cost tracking and context window features will be unavailable in Vibeyard.`,
    buttons: ['Replace', 'Keep Existing'],
    defaultId: 1,
    cancelId: 1,
  };

  let response: number;
  if (win) {
    const result = await dialog.showMessageBox(win, options);
    response = result.response;
  } else {
    response = dialog.showMessageBoxSync(options);
  }

  state.preferences.statusLineConsent = response === 0 ? 'granted' : 'declined';
  saveState(state);

  if (response === 0) {
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
  saveState(state);
}

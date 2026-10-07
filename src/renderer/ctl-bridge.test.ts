import { describe, it, expect, vi, beforeEach } from 'vitest';

const listeners: Record<string, (...a: unknown[]) => void> = {};
const prefs = { externalControlEnabled: false };
let projectsList: unknown[] = [];
let profilesList: Array<{ id: string; providerId: string }> = [];
const ctl = {
  onCommand: vi.fn((cb) => { listeners.command = cb; return () => {}; }),
  reply: vi.fn(),
  setEnabled: vi.fn(),
  rendererReady: vi.fn(),
};
vi.stubGlobal('window', { vibeyard: { ctl } });
vi.mock('./state.js', () => ({
  appState: {
    get preferences() { return prefs; },
    get projects() { return projectsList; },
    get profiles() { return profilesList; },
    on: vi.fn((evt: string, cb: () => void) => { listeners[evt] = cb; }),
    addExternalSession: vi.fn(),
    renameSession: vi.fn(),
  },
}));
vi.mock('./session-close.js', () => ({ closeSessionWithConfirm: vi.fn(), needsCloseConfirmation: vi.fn(() => false) }));
vi.mock('./session-activity.js', () => ({ getStatus: vi.fn(() => 'idle') }));
vi.mock('./components/terminal-pane.js', () => ({ getTerminalInstance: vi.fn(() => undefined) }));
vi.mock('./provider-availability.js', () => ({ getProviderCapabilities: vi.fn(() => ({})) }));

import { initCtlBridge } from './ctl-bridge';
import { getTerminalInstance } from './components/terminal-pane.js';

beforeEach(() => { vi.clearAllMocks(); prefs.externalControlEnabled = false; projectsList = []; profilesList = []; });

describe('initCtlBridge', () => {
  it('reports the preference, then readiness, and follows preference changes', () => {
    initCtlBridge();
    expect(ctl.setEnabled).toHaveBeenLastCalledWith(false);
    expect(ctl.rendererReady).toHaveBeenCalledTimes(1);
    expect(ctl.setEnabled.mock.invocationCallOrder[0]).toBeLessThan(ctl.rendererReady.mock.invocationCallOrder[0]);
    prefs.externalControlEnabled = true;
    listeners['preferences-changed']();
    expect(ctl.setEnabled).toHaveBeenLastCalledWith(true);
    listeners['preferences-changed']();
    expect(ctl.setEnabled).toHaveBeenCalledTimes(2); // unchanged value is not re-sent
  });

  it('answers every command, turning handler exceptions into invalid_request', () => {
    initCtlBridge();
    listeners.command('req-1', 'caller', { action: 'list' });
    expect(ctl.reply).toHaveBeenCalledWith('req-1', { ok: true, result: [] });
    listeners.command('req-2', 'caller', { action: 'bogus' });
    expect(ctl.reply).toHaveBeenLastCalledWith('req-2', expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'invalid_request' }) }));
  });

  it('turns a throwing dependency into invalid_request with the exception message', () => {
    projectsList = [{ id: 'p1', path: '/p', sessions: [{ id: 's1', name: 's1', cliSessionId: null, createdAt: 'x' }] }];
    vi.mocked(getTerminalInstance).mockImplementationOnce(() => { throw new Error('boom'); });
    initCtlBridge();
    listeners.command('req-3', 'caller', { action: 'list' });
    expect(ctl.reply).toHaveBeenCalledWith('req-3', { ok: false, error: { code: 'invalid_request', message: 'boom' } });
  });

  it('checks --profile against appState.profiles, against the effective (requested or default) provider', () => {
    projectsList = [{ id: 'p1', path: '/p', sessions: [{ id: 'caller', name: 'c', cliSessionId: null, createdAt: 'x' }] }];
    profilesList = [{ id: 'work', providerId: 'claude' }];
    initCtlBridge();
    listeners.command('req-4', 'caller', { action: 'new-session', name: 'n', profile: 'ghost' });
    expect(ctl.reply).toHaveBeenLastCalledWith('req-4', { ok: false, error: { code: 'invalid_request', message: "unknown profile 'ghost'" } });
    listeners.command('req-5', 'caller', { action: 'new-session', name: 'n', provider: 'codex', profile: 'work' });
    expect(ctl.reply).toHaveBeenLastCalledWith('req-5', { ok: false, error: { code: 'invalid_request', message: "profile 'work' is for provider 'claude', not 'codex'; pass --provider claude" } });
    listeners.command('req-6', 'caller', { action: 'new-session', name: 'n', provider: 'claude', profile: 'work' });
    expect(ctl.reply).toHaveBeenLastCalledWith('req-6', expect.not.objectContaining({ error: expect.objectContaining({ message: "unknown profile 'work'" }) }));
    // no --provider: the effective provider is the default, so a codex profile is rejected
    profilesList = [{ id: 'cx', providerId: 'codex' }];
    listeners.command('req-7', 'caller', { action: 'new-session', name: 'n', profile: 'cx' });
    expect(ctl.reply).toHaveBeenLastCalledWith('req-7', { ok: false, error: { code: 'invalid_request', message: "profile 'cx' is for provider 'codex', not 'claude'; pass --provider codex" } });
  });
});

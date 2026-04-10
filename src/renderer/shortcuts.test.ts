import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAppState = {
  preferences: { keybindings: {} as Record<string, string> },
  setPreference: vi.fn(),
};

vi.mock('./state.js', () => ({
  appState: mockAppState,
}));

/** Create a mock KeyboardEvent-like object for testing in Node environment. */
function makeKeyEvent(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  return {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe('shortcuts (Mac)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    mockAppState.preferences.keybindings = {};
    mockAppState.setPreference.mockClear();
  });

  it('displayKeys converts CmdOrCtrl+S to ⌘S', async () => {
    const { displayKeys } = await import('./shortcuts');
    expect(displayKeys('CmdOrCtrl+S')).toBe('⌘S');
  });

  it('displayKeys converts CmdOrCtrl+Shift+N to ⌘⇧N', async () => {
    const { displayKeys } = await import('./shortcuts');
    expect(displayKeys('CmdOrCtrl+Shift+N')).toBe('⌘⇧N');
  });

  it('displayKeys converts Ctrl+` to ⌃`', async () => {
    const { displayKeys } = await import('./shortcuts');
    expect(displayKeys('Ctrl+`')).toBe('⌃`');
  });

  it('displayKeys converts Alt+X to ⌥X', async () => {
    const { displayKeys } = await import('./shortcuts');
    expect(displayKeys('Alt+X')).toBe('⌥X');
  });

  it('displayKeys converts CmdOrCtrl+\\ correctly', async () => {
    const { displayKeys } = await import('./shortcuts');
    expect(displayKeys('CmdOrCtrl+\\')).toBe('⌘\\');
  });

  it('eventToAccelerator returns null for bare modifier Meta', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'Meta' }))).toBeNull();
  });

  it('eventToAccelerator returns null for bare modifier Control', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'Control' }))).toBeNull();
  });

  it('eventToAccelerator returns null for bare modifier Shift', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'Shift' }))).toBeNull();
  });

  it('eventToAccelerator returns null for bare modifier Alt', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'Alt' }))).toBeNull();
  });

  it('eventToAccelerator maps metaKey to CmdOrCtrl on Mac', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 's', metaKey: true }))).toBe('CmdOrCtrl+S');
  });

  it('eventToAccelerator maps ctrlKey to Ctrl on Mac', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 's', ctrlKey: true }))).toBe('Ctrl+S');
  });

  it('eventToAccelerator includes Shift modifier', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'n', metaKey: true, shiftKey: true }))).toBe('CmdOrCtrl+Shift+N');
  });

  it('eventToAccelerator includes Alt modifier', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'x', metaKey: true, altKey: true }))).toBe('CmdOrCtrl+Alt+X');
  });

  it('eventToAccelerator handles both ctrl and meta pressed', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'a', ctrlKey: true, metaKey: true }))).toBe('Ctrl+Cmd+A');
  });

  it('eventToAccelerator uppercases single char keys', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'p', metaKey: true }))).toBe('CmdOrCtrl+P');
  });

  it('eventToAccelerator preserves F-keys as-is', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 'F1' }))).toBe('F1');
  });
});

describe('shortcuts (non-Mac)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { platform: 'Win32' });
    mockAppState.preferences.keybindings = {};
    mockAppState.setPreference.mockClear();
  });

  it('displayKeys converts CmdOrCtrl+S to Ctrl+S', async () => {
    const { displayKeys } = await import('./shortcuts');
    expect(displayKeys('CmdOrCtrl+S')).toBe('Ctrl+S');
  });

  it('displayKeys converts CmdOrCtrl+Shift+N to Ctrl+Shift+N', async () => {
    const { displayKeys } = await import('./shortcuts');
    expect(displayKeys('CmdOrCtrl+Shift+N')).toBe('Ctrl+Shift+N');
  });

  it('displayKeys leaves Ctrl+` unchanged on non-Mac', async () => {
    const { displayKeys } = await import('./shortcuts');
    expect(displayKeys('Ctrl+`')).toBe('Ctrl+`');
  });

  it('eventToAccelerator maps ctrlKey to CmdOrCtrl on non-Mac', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 's', ctrlKey: true }))).toBe('CmdOrCtrl+S');
  });

  it('eventToAccelerator maps metaKey to Cmd on non-Mac', async () => {
    const { eventToAccelerator } = await import('./shortcuts');
    expect(eventToAccelerator(makeKeyEvent({ key: 's', metaKey: true }))).toBe('Cmd+S');
  });
});

describe('SHORTCUT_DEFAULTS', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
  });

  it('is a non-empty array', async () => {
    const { SHORTCUT_DEFAULTS } = await import('./shortcuts');
    expect(Array.isArray(SHORTCUT_DEFAULTS)).toBe(true);
    expect(SHORTCUT_DEFAULTS.length).toBeGreaterThan(0);
  });

  it('each entry has id, label, category, and defaultKeys', async () => {
    const { SHORTCUT_DEFAULTS } = await import('./shortcuts');
    for (const def of SHORTCUT_DEFAULTS) {
      expect(def).toHaveProperty('id');
      expect(def).toHaveProperty('label');
      expect(def).toHaveProperty('category');
      expect(def).toHaveProperty('defaultKeys');
      expect(typeof def.id).toBe('string');
      expect(typeof def.label).toBe('string');
      expect(typeof def.category).toBe('string');
      expect(typeof def.defaultKeys).toBe('string');
    }
  });

  it('has unique ids', async () => {
    const { SHORTCUT_DEFAULTS } = await import('./shortcuts');
    const ids = SHORTCUT_DEFAULTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ShortcutManager', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    mockAppState.preferences.keybindings = {};
    mockAppState.setPreference.mockClear();
  });

  it('registerHandler sets handler for known id and matchEvent invokes it', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const handler = vi.fn();
    mgr.registerHandler('new-session', handler);
    // CmdOrCtrl+T on Mac = metaKey + 't'
    const e = makeKeyEvent({ key: 't', metaKey: true });
    const matched = mgr.matchEvent(e);
    expect(matched).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('registerHandler is no-op for unknown id', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    // Should not throw
    mgr.registerHandler('nonexistent-shortcut', vi.fn());
  });

  it('matchEvent calls preventDefault on matched event', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    mgr.registerHandler('new-session', vi.fn());
    const e = makeKeyEvent({ key: 't', metaKey: true });
    mgr.matchEvent(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('matchEvent returns false when no shortcut matches', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    mgr.registerHandler('new-session', vi.fn());
    const e = makeKeyEvent({ key: 'z' });
    expect(mgr.matchEvent(e)).toBe(false);
  });

  it('matchEvent returns false when handler is not registered', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    // No handler registered for new-session
    const e = makeKeyEvent({ key: 's', metaKey: true });
    expect(mgr.matchEvent(e)).toBe(false);
  });

  it('getKeys returns default keys when no override', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    expect(mgr.getKeys('new-session')).toBe('CmdOrCtrl+T');
  });

  it('getKeys returns override when set in appState', async () => {
    mockAppState.preferences.keybindings = { 'new-session': 'CmdOrCtrl+K' };
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    expect(mgr.getKeys('new-session')).toBe('CmdOrCtrl+K');
  });

  it('getKeys returns empty string for unknown id', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    expect(mgr.getKeys('nonexistent')).toBe('');
  });

  it('getAll returns grouped shortcuts by category', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const all = mgr.getAll();
    expect(all).toBeInstanceOf(Map);
    expect(all.has('Sessions')).toBe(true);
    expect(all.has('Panels')).toBe(true);
    expect(all.has('Search & Help')).toBe(true);
  });

  it('getAll entries have resolvedKeys property', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const all = mgr.getAll();
    const sessions = all.get('Sessions')!;
    expect(sessions.length).toBeGreaterThan(0);
    for (const entry of sessions) {
      expect(entry).toHaveProperty('resolvedKeys');
      expect(typeof entry.resolvedKeys).toBe('string');
    }
  });

  it('getAll uses override keys when available', async () => {
    mockAppState.preferences.keybindings = { 'new-session': 'CmdOrCtrl+K' };
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const all = mgr.getAll();
    const sessions = all.get('Sessions')!;
    const newSession = sessions.find((s) => s.id === 'new-session');
    expect(newSession?.resolvedKeys).toBe('CmdOrCtrl+K');
  });

  it('setOverride calls setPreference with updated keybindings', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    mgr.setOverride('new-session', 'CmdOrCtrl+K');
    expect(mockAppState.setPreference).toHaveBeenCalledWith('keybindings', { 'new-session': 'CmdOrCtrl+K' });
  });

  it('setOverride preserves existing overrides', async () => {
    mockAppState.preferences.keybindings = { 'toggle-split': 'CmdOrCtrl+T' };
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    mgr.setOverride('new-session', 'CmdOrCtrl+K');
    expect(mockAppState.setPreference).toHaveBeenCalledWith('keybindings', {
      'toggle-split': 'CmdOrCtrl+T',
      'new-session': 'CmdOrCtrl+K',
    });
  });

  it('resetOverride removes key and calls setPreference', async () => {
    mockAppState.preferences.keybindings = { 'new-session': 'CmdOrCtrl+K' };
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    mgr.resetOverride('new-session');
    expect(mockAppState.setPreference).toHaveBeenCalledWith('keybindings', {});
  });

  it('hasOverride returns true when override exists', async () => {
    mockAppState.preferences.keybindings = { 'new-session': 'CmdOrCtrl+K' };
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    expect(mgr.hasOverride('new-session')).toBe(true);
  });

  it('hasOverride returns false when no override', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    expect(mgr.hasOverride('toggle-split')).toBe(false);
  });

  it('matchEvent uses override keys', async () => {
    mockAppState.preferences.keybindings = { 'new-session': 'CmdOrCtrl+K' };
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const handler = vi.fn();
    mgr.registerHandler('new-session', handler);

    // Old default key should not match
    const oldEvent = makeKeyEvent({ key: 's', metaKey: true });
    expect(mgr.matchEvent(oldEvent)).toBe(false);

    // New override key should match
    const newEvent = makeKeyEvent({ key: 'k', metaKey: true });
    expect(mgr.matchEvent(newEvent)).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('matchEvent handles F-key shortcuts', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const handler = vi.fn();
    mgr.registerHandler('help', handler);
    const e = makeKeyEvent({ key: 'F1' });
    expect(mgr.matchEvent(e)).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('matchEvent handles number key shortcuts', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const handler = vi.fn();
    mgr.registerHandler('goto-session-1', handler);
    const e = makeKeyEvent({ key: '1', metaKey: true });
    expect(mgr.matchEvent(e)).toBe(true);
    expect(handler).toHaveBeenCalled();
  });
});

describe('ShortcutManager.matchesAnyShortcut', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    mockAppState.preferences.keybindings = {};
    mockAppState.setPreference.mockClear();
  });

  it('returns true for a matching shortcut key', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    // CmdOrCtrl+T on Mac = metaKey + 't' (new-session shortcut)
    const e = makeKeyEvent({ key: 't', metaKey: true });
    expect(mgr.matchesAnyShortcut(e)).toBe(true);
  });

  it('returns true even without a registered handler', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    // CmdOrCtrl+J on Mac = metaKey + 'j' (project-terminal-alt), no handler registered
    const e = makeKeyEvent({ key: 'j', metaKey: true });
    expect(mgr.matchesAnyShortcut(e)).toBe(true);
  });

  it('returns false for a non-shortcut key', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const e = makeKeyEvent({ key: 'z', metaKey: true });
    expect(mgr.matchesAnyShortcut(e)).toBe(false);
  });

  it('does not execute handler or call preventDefault', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const handler = vi.fn();
    mgr.registerHandler('new-session', handler);
    const e = makeKeyEvent({ key: 't', metaKey: true });
    mgr.matchesAnyShortcut(e);
    expect(handler).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('respects keybinding overrides', async () => {
    mockAppState.preferences.keybindings = { 'new-session': 'CmdOrCtrl+K' };
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    // Old default key should not match
    expect(mgr.matchesAnyShortcut(makeKeyEvent({ key: 't', metaKey: true }))).toBe(false);
    // New override key should match
    expect(mgr.matchesAnyShortcut(makeKeyEvent({ key: 'k', metaKey: true }))).toBe(true);
  });
});

describe('ShortcutManager.matchesAnyShortcut (Windows)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { platform: 'Win32' });
    mockAppState.preferences.keybindings = {};
    mockAppState.setPreference.mockClear();
  });

  it('matches Ctrl+J for project-terminal-alt', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const e = makeKeyEvent({ key: 'j', ctrlKey: true });
    expect(mgr.matchesAnyShortcut(e)).toBe(true);
  });

  it('matches Ctrl+B for toggle-sidebar', async () => {
    const { ShortcutManager } = await import('./shortcuts');
    const mgr = new ShortcutManager();
    const e = makeKeyEvent({ key: 'b', ctrlKey: true });
    expect(mgr.matchesAnyShortcut(e)).toBe(true);
  });
});

describe('shortcutManager singleton', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    mockAppState.preferences.keybindings = {};
  });

  it('exports a ShortcutManager instance', async () => {
    const { shortcutManager, ShortcutManager } = await import('./shortcuts');
    expect(shortcutManager).toBeInstanceOf(ShortcutManager);
  });
});

import { appState } from './state.js';

export interface ShortcutDef {
  id: string;
  label: string;
  category: string;
  defaultKeys: string;
  handler: (() => void) | null;
}

interface ShortcutDefault {
  id: string;
  label: string;
  category: string;
  defaultKeys: string;
}

export const SHORTCUT_DEFAULTS: ShortcutDefault[] = [
  { id: 'new-session', label: 'New Session', category: 'Sessions', defaultKeys: 'CmdOrCtrl+T' },
  { id: 'new-session-alt', label: 'New Session (Alt)', category: 'Sessions', defaultKeys: 'CmdOrCtrl+Shift+N' },
  { id: 'new-project', label: 'New Project', category: 'Sessions', defaultKeys: 'CmdOrCtrl+Shift+P' },
  { id: 'goto-session-1', label: 'Go to Session 1', category: 'Sessions', defaultKeys: 'CmdOrCtrl+1' },
  { id: 'goto-session-2', label: 'Go to Session 2', category: 'Sessions', defaultKeys: 'CmdOrCtrl+2' },
  { id: 'goto-session-3', label: 'Go to Session 3', category: 'Sessions', defaultKeys: 'CmdOrCtrl+3' },
  { id: 'goto-session-4', label: 'Go to Session 4', category: 'Sessions', defaultKeys: 'CmdOrCtrl+4' },
  { id: 'goto-session-5', label: 'Go to Session 5', category: 'Sessions', defaultKeys: 'CmdOrCtrl+5' },
  { id: 'goto-session-6', label: 'Go to Session 6', category: 'Sessions', defaultKeys: 'CmdOrCtrl+6' },
  { id: 'goto-session-7', label: 'Go to Session 7', category: 'Sessions', defaultKeys: 'CmdOrCtrl+7' },
  { id: 'goto-session-8', label: 'Go to Session 8', category: 'Sessions', defaultKeys: 'CmdOrCtrl+8' },
  { id: 'goto-session-9', label: 'Go to Session 9', category: 'Sessions', defaultKeys: 'CmdOrCtrl+9' },
  { id: 'next-session', label: 'Next Session', category: 'Sessions', defaultKeys: 'CmdOrCtrl+Shift+]' },
  { id: 'prev-session', label: 'Previous Session', category: 'Sessions', defaultKeys: 'CmdOrCtrl+Shift+[' },
  { id: 'tab-back', label: 'Back (Tab History)', category: 'Sessions', defaultKeys: 'CmdOrCtrl+[' },
  { id: 'tab-forward', label: 'Forward (Tab History)', category: 'Sessions', defaultKeys: 'CmdOrCtrl+]' },
  { id: 'toggle-sidebar', label: 'Toggle Sidebar', category: 'Panels', defaultKeys: 'CmdOrCtrl+B' },
  { id: 'toggle-split', label: 'Toggle Split Mode', category: 'Panels', defaultKeys: 'CmdOrCtrl+\\' },
  { id: 'project-terminal', label: 'Project Terminal', category: 'Panels', defaultKeys: 'Ctrl+`' },
  { id: 'project-terminal-alt', label: 'Project Terminal (Alt)', category: 'Panels', defaultKeys: 'CmdOrCtrl+J' },
  { id: 'debug-panel', label: 'Debug Panel', category: 'Panels', defaultKeys: 'CmdOrCtrl+Shift+D' },
  { id: 'git-panel', label: 'Git Panel', category: 'Panels', defaultKeys: 'CmdOrCtrl+Shift+G' },
  { id: 'quick-open', label: 'Quick Open File', category: 'Search & Help', defaultKeys: 'CmdOrCtrl+P' },
  { id: 'find-in-terminal', label: 'Find', category: 'Search & Help', defaultKeys: 'CmdOrCtrl+F' },
  { id: 'goto-line', label: 'Go to Line', category: 'Search & Help', defaultKeys: 'CmdOrCtrl+L' },
  { id: 'help', label: 'Help', category: 'Search & Help', defaultKeys: 'F1' },
  { id: 'ui-zoom-in', label: 'Increase Scale (+5% UI, +1px terminal)', category: 'Display', defaultKeys: 'CmdOrCtrl+Plus' },
  { id: 'ui-zoom-out', label: 'Decrease Scale (−5% UI, −1px terminal)', category: 'Display', defaultKeys: 'CmdOrCtrl+Minus' },
];

const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

/** Convert accelerator string to platform-specific display string */
export function displayKeys(accelerator: string): string {
  if (accelerator === 'CmdOrCtrl+Plus') {
    return isMac ? '\u2318+' : 'Ctrl++';
  }
  if (accelerator === 'CmdOrCtrl+Minus') {
    return isMac ? '\u2318\u2212' : 'Ctrl+-';
  }

  let display = accelerator.replace(/\+Plus$/g, '++').replace(/\+Minus$/g, '+-');
  if (isMac) {
    display = display.replace(/CmdOrCtrl/g, 'Cmd');
    display = display.replace(/Ctrl\+/g, 'Ctrl+');
  } else {
    display = display.replace(/CmdOrCtrl/g, 'Ctrl');
  }
  if (isMac) {
    display = display
      .replace(/Cmd/g, '\u2318')
      .replace(/Shift/g, '\u21E7')
      .replace(/Alt/g, '\u2325')
      .replace(/Ctrl/g, '\u2303');
    display = display.replace(/\+/g, '');
  }
  return display;
}

/** Parse an accelerator string into modifier flags and a key */
function parseAccelerator(accelerator: string): { ctrl: boolean; meta: boolean; shift: boolean; alt: boolean; key: string } {
  const lastPlus = accelerator.lastIndexOf('+');
  const key = lastPlus === -1 ? accelerator : accelerator.slice(lastPlus + 1);
  const modPart = lastPlus === -1 ? '' : accelerator.slice(0, lastPlus);

  let ctrl = false;
  let meta = false;
  let shift = false;
  let alt = false;

  if (modPart) {
    for (const part of modPart.split('+')) {
      const lower = part.toLowerCase();
      if (lower === 'cmdorctrl') {
        if (isMac) meta = true;
        else ctrl = true;
      } else if (lower === 'ctrl') {
        ctrl = true;
      } else if (lower === 'cmd') {
        meta = true;
      } else if (lower === 'shift') {
        shift = true;
      } else if (lower === 'alt') {
        alt = true;
      }
    }
  }

  return { ctrl, meta, shift, alt, key };
}

/** Check if a KeyboardEvent matches an accelerator string */
function matchesAccelerator(e: KeyboardEvent, accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);

  const eventCtrl = e.ctrlKey;
  const eventMeta = e.metaKey;
  const eventShift = e.shiftKey;
  const eventAlt = e.altKey;

  if (parsed.ctrl !== eventCtrl) return false;
  if (parsed.meta !== eventMeta) return false;
  if (parsed.alt !== eventAlt) return false;

  const parsedKey = parsed.key;
  const isZoomChord =
    parsedKey === 'Plus' || parsedKey === '+' || parsedKey === 'Minus' || parsedKey === '-';
  if (parsed.shift !== eventShift) {
    const allowShiftMismatch = isZoomChord && !parsed.shift;
    if (!allowShiftMismatch) return false;
  }

  // Compare key - handle special cases
  const eventKey = e.key;

  if (parsedKey === 'Plus' || parsedKey === '+') {
    if (eventKey === '+') return true;
    if (eventKey === '=') return true;
    if (e.code === 'NumpadAdd') return true;
    return false;
  }
  if (parsedKey === 'Minus' || parsedKey === '-') {
    if (eventKey === '-') return true;
    if (e.code === 'NumpadSubtract') return true;
    return false;
  }

  // Direct match
  if (eventKey === parsedKey) return true;
  // Case-insensitive for letters
  if (eventKey.length === 1 && parsedKey.length === 1 && eventKey.toLowerCase() === parsedKey.toLowerCase()) return true;
  // Number keys
  if (/^\d$/.test(parsedKey) && eventKey === parsedKey) return true;
  // F-keys
  if (parsedKey.startsWith('F') && eventKey === parsedKey) return true;

  return false;
}

/** Convert a KeyboardEvent to an accelerator string */
export function eventToAccelerator(e: KeyboardEvent): string | null {
  const key = e.key;

  // Ignore bare modifier keys
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey && e.metaKey) {
    // Both ctrl and meta
    parts.push('Ctrl');
    parts.push('Cmd');
  } else if (e.metaKey) {
    parts.push(isMac ? 'CmdOrCtrl' : 'Cmd');
  } else if (e.ctrlKey) {
    parts.push(isMac ? 'Ctrl' : 'CmdOrCtrl');
  }
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  // Normalize key name
  let normalizedKey = key;
  if (key.length === 1) {
    normalizedKey = key.toUpperCase();
  }

  parts.push(normalizedKey);
  return parts.join('+');
}

export class ShortcutManager {
  private shortcuts: ShortcutDef[] = [];

  constructor() {
    this.shortcuts = SHORTCUT_DEFAULTS.map((d) => ({ ...d, handler: null }));
  }

  /** Register a handler for a shortcut id */
  registerHandler(id: string, handler: () => void): void {
    const shortcut = this.shortcuts.find((s) => s.id === id);
    if (shortcut) {
      shortcut.handler = handler;
    }
  }

  /** Get resolved keys (override or default) for a shortcut */
  getKeys(id: string): string {
    const overrides = appState.preferences.keybindings ?? {};
    const shortcut = this.shortcuts.find((s) => s.id === id);
    if (!shortcut) return '';
    return overrides[id] ?? shortcut.defaultKeys;
  }

  /** Get all shortcuts with resolved keys, grouped by category */
  getAll(): Map<string, Array<ShortcutDef & { resolvedKeys: string }>> {
    const overrides = appState.preferences.keybindings ?? {};
    const groups = new Map<string, Array<ShortcutDef & { resolvedKeys: string }>>();

    for (const shortcut of this.shortcuts) {
      const resolvedKeys = overrides[shortcut.id] ?? shortcut.defaultKeys;
      const entry = { ...shortcut, resolvedKeys };
      if (!groups.has(shortcut.category)) {
        groups.set(shortcut.category, []);
      }
      groups.get(shortcut.category)!.push(entry);
    }

    return groups;
  }

  /** Set a custom keybinding override */
  setOverride(id: string, keys: string): void {
    const current = { ...(appState.preferences.keybindings ?? {}) };
    current[id] = keys;
    appState.setPreference('keybindings', current);
  }

  /** Reset a keybinding to its default */
  resetOverride(id: string): void {
    const current = { ...(appState.preferences.keybindings ?? {}) };
    delete current[id];
    appState.setPreference('keybindings', current);
  }

  /** Check if a shortcut has a custom override */
  hasOverride(id: string): boolean {
    const overrides = appState.preferences.keybindings ?? {};
    return id in overrides;
  }

  /** Match a keyboard event to a shortcut and execute its handler */
  matchEvent(e: KeyboardEvent): boolean {
    const overrides = appState.preferences.keybindings ?? {};

    // Display / zoom chords first so they win over session shortcuts that share Ctrl+= etc.
    const priorityIds = new Set(['ui-zoom-in', 'ui-zoom-out']);
    const ordered = [...this.shortcuts].sort((a, b) => {
      const ap = priorityIds.has(a.id) ? 0 : 1;
      const bp = priorityIds.has(b.id) ? 0 : 1;
      return ap - bp;
    });

    for (const shortcut of ordered) {
      const keys = overrides[shortcut.id] ?? shortcut.defaultKeys;
      if (matchesAccelerator(e, keys) && shortcut.handler) {
        e.preventDefault();
        shortcut.handler();
        return true;
      }
    }
    return false;
  }
}

export const shortcutManager = new ShortcutManager();

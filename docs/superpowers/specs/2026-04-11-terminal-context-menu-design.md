# Terminal Right-Click Context Menu

## Overview

Add a right-click context menu to terminal panes with Copy, Paste, Select All, and Clear Terminal actions. DOM-based implementation following the existing context menu pattern used by tabs, sidebar, and git panel.

## Menu Items

### Group 1 — Clipboard

| Item | Action | Enabled | Shortcut Hint |
|------|--------|---------|---------------|
| Copy | `terminal.getSelection()` → `navigator.clipboard.writeText()` | Only when `terminal.hasSelection()` is true (greyed out otherwise) | `Ctrl+Shift+C` / `⇧⌘C` |
| Paste | `navigator.clipboard.readText()` → `writeToPty()` with bracketed paste | Always | `Ctrl+V` / `⌘V` |

### Group 2 — Selection

| Item | Action | Enabled | Shortcut Hint |
|------|--------|---------|---------------|
| Select All | `terminal.selectAll()` | Always | — |

### Group 3 — Terminal

| Item | Action | Enabled | Shortcut Hint |
|------|--------|---------|---------------|
| Clear Terminal | `terminal.clear()` | Always | — |

Separators between each group. Platform-appropriate shortcut hints (detect macOS via `navigator.platform` in renderer).

## Architecture

### New File

`src/renderer/components/terminal-context-menu.ts`

Exports:
- `showTerminalContextMenu(x, y, terminal, writeToPty)` — builds, positions, and displays the menu
- `hideTerminalContextMenu()` — removes the active menu from DOM

### Integration Point

`terminal-pane.ts` — add a `contextmenu` event listener on the terminal's `.xterm` element inside `createTerminalPane()`. Calls `e.preventDefault()` and invokes `showTerminalContextMenu()`.

### No IPC Required

All actions use renderer-side APIs: xterm.js Terminal methods and `navigator.clipboard`.

## Menu Behavior

### Rendering

- DOM-based, using existing `tab-context-menu`, `tab-context-menu-item`, and `tab-context-menu-separator` CSS classes from `tabs.css`
- Positioned at `e.clientX`, `e.clientY` with viewport bounds checking (shift left/up if overflow)

### Dismissal

- Click on a menu item (action fires, menu closes)
- Click anywhere outside the menu
- Press Escape
- Right-click again (old menu replaced by new one at new position)

### Global Listeners

`document.addEventListener('click', hideTerminalContextMenu)` and Escape keydown handler at module scope, matching `tab-bar.ts` and `sidebar.ts` patterns.

### Focus

Terminal retains focus after menu closes. No special handling needed — existing `mousedown` listener in `terminal-pane.ts` handles re-focus.

### Cross-Menu Interaction

No coordination needed. Each menu's `show` calls its own `hide` first, and document click listeners naturally dismiss other open menus.

## Scope

- Terminal panes only. Browser tab panes retain their native browser context menu.
- Paste reuses existing bracketed paste logic from `terminal-utils.ts`.

## Testing

Unit tests in `src/renderer/components/terminal-context-menu.test.ts`:

- Menu renders with all 4 items on `showTerminalContextMenu()`
- Copy item disabled when `terminal.hasSelection()` returns false
- Copy item enabled when `terminal.hasSelection()` returns true
- `hideTerminalContextMenu()` removes menu from DOM
- Calling show twice replaces the first menu (no stacking)
- Bounds checking shifts menu when it would overflow viewport
- Escape keydown dismisses the menu
- Click outside dismisses the menu

Mocks: Terminal object with `hasSelection()`, `getSelection()`, `selectAll()`, `clear()` stubs. `navigator.clipboard` for `writeText`/`readText`. `writeToPty` callback.

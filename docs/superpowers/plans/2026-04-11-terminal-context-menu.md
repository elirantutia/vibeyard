# Terminal Right-Click Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click context menu to terminal panes with Copy, Paste, Select All, and Clear Terminal actions.

**Architecture:** DOM-based context menu following the existing pattern used by tab, sidebar, and git panel menus. New module `terminal-context-menu.ts` handles menu rendering and actions. Integration via a single `contextmenu` event listener in `terminal-pane.ts`.

**Tech Stack:** TypeScript, xterm.js Terminal API, navigator.clipboard, existing `tab-context-menu` CSS classes.

---

### Task 1: Create terminal-context-menu module with tests

**Files:**
- Create: `src/renderer/components/terminal-context-menu.ts`
- Create: `src/renderer/components/terminal-context-menu.test.ts`

- [ ] **Step 1: Write the failing test for showTerminalContextMenu**

In `src/renderer/components/terminal-context-menu.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showTerminalContextMenu, hideTerminalContextMenu } from './terminal-context-menu.js';

function makeMockTerminal(hasSelection = false, selection = '') {
  return {
    hasSelection: vi.fn(() => hasSelection),
    getSelection: vi.fn(() => selection),
    selectAll: vi.fn(),
    clear: vi.fn(),
  } as any;
}

describe('terminal-context-menu', () => {
  let writeToPty: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeToPty = vi.fn();
  });

  afterEach(() => {
    hideTerminalContextMenu();
  });

  it('renders menu with four items', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const menu = document.querySelector('.tab-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();

    const items = menu.querySelectorAll('.tab-context-menu-item');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain('Copy');
    expect(items[1].textContent).toContain('Paste');
    expect(items[2].textContent).toContain('Select All');
    expect(items[3].textContent).toContain('Clear Terminal');
  });

  it('positions menu at given coordinates', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(200, 300, terminal, writeToPty);

    const menu = document.querySelector('.tab-context-menu') as HTMLElement;
    expect(menu.style.left).toBe('200px');
    expect(menu.style.top).toBe('300px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/terminal-context-menu.test.ts`
Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Write minimal implementation of showTerminalContextMenu and hideTerminalContextMenu**

In `src/renderer/components/terminal-context-menu.ts`:

```typescript
import type { Terminal } from '@xterm/xterm';
import { isMac } from '../platform.js';

let activeMenu: HTMLElement | null = null;

export function showTerminalContextMenu(
  x: number,
  y: number,
  terminal: Terminal,
  writeToPty: (data: string) => void
): void {
  hideTerminalContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const hasSelection = terminal.hasSelection();

  // Copy
  const copyItem = document.createElement('div');
  copyItem.className = 'tab-context-menu-item' + (hasSelection ? '' : ' disabled');
  copyItem.innerHTML = `<span>Copy</span><span class="shortcut-hint">${isMac ? '⇧⌘C' : 'Ctrl+Shift+C'}</span>`;
  if (hasSelection) {
    copyItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTerminalContextMenu();
      const selection = terminal.getSelection();
      if (selection) navigator.clipboard.writeText(selection).catch(() => {});
    });
  }
  menu.appendChild(copyItem);

  // Paste
  const pasteItem = document.createElement('div');
  pasteItem.className = 'tab-context-menu-item';
  pasteItem.innerHTML = `<span>Paste</span><span class="shortcut-hint">${isMac ? '⌘V' : 'Ctrl+V'}</span>`;
  pasteItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTerminalContextMenu();
    navigator.clipboard.readText().then((text) => {
      if (!text) return;
      const modes = (terminal as any).modes;
      const bp = modes?.bracketedPasteMode;
      writeToPty(bp ? `\x1b[200~${text}\x1b[201~` : text);
    }).catch(() => {});
  });
  menu.appendChild(pasteItem);

  // Separator
  const sep1 = document.createElement('div');
  sep1.className = 'tab-context-menu-separator';
  menu.appendChild(sep1);

  // Select All
  const selectAllItem = document.createElement('div');
  selectAllItem.className = 'tab-context-menu-item';
  selectAllItem.textContent = 'Select All';
  selectAllItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTerminalContextMenu();
    terminal.selectAll();
  });
  menu.appendChild(selectAllItem);

  // Separator
  const sep2 = document.createElement('div');
  sep2.className = 'tab-context-menu-separator';
  menu.appendChild(sep2);

  // Clear Terminal
  const clearItem = document.createElement('div');
  clearItem.className = 'tab-context-menu-item';
  clearItem.textContent = 'Clear Terminal';
  clearItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTerminalContextMenu();
    terminal.clear();
  });
  menu.appendChild(clearItem);

  document.body.appendChild(menu);
  activeMenu = menu;

  // Adjust if menu goes off-screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

export function hideTerminalContextMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

// Global dismiss listeners
document.addEventListener('click', hideTerminalContextMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTerminalContextMenu(); });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/terminal-context-menu.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```
git add src/renderer/components/terminal-context-menu.ts src/renderer/components/terminal-context-menu.test.ts
```

Message: `add terminal context menu module with show/hide and basic tests`

---

### Task 2: Add remaining unit tests

**Files:**
- Modify: `src/renderer/components/terminal-context-menu.test.ts`

- [ ] **Step 1: Add test for Copy disabled state**

Append to the `describe` block in `terminal-context-menu.test.ts`:

```typescript
  it('disables Copy when no selection', () => {
    const terminal = makeMockTerminal(false);
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    expect(items[0].classList.contains('disabled')).toBe(true);
  });

  it('enables Copy when selection exists', () => {
    const terminal = makeMockTerminal(true, 'selected text');
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    expect(items[0].classList.contains('disabled')).toBe(false);
  });
```

- [ ] **Step 2: Add test for hide removing menu from DOM**

```typescript
  it('hideTerminalContextMenu removes menu from DOM', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);
    expect(document.querySelector('.tab-context-menu')).toBeTruthy();

    hideTerminalContextMenu();
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });
```

- [ ] **Step 3: Add test for no stacking (show twice replaces)**

```typescript
  it('calling show twice replaces the first menu', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);
    showTerminalContextMenu(200, 200, terminal, writeToPty);

    const menus = document.querySelectorAll('.tab-context-menu');
    expect(menus).toHaveLength(1);
    expect((menus[0] as HTMLElement).style.left).toBe('200px');
  });
```

- [ ] **Step 4: Add test for Escape dismissal**

```typescript
  it('Escape key dismisses the menu', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);
    expect(document.querySelector('.tab-context-menu')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });
```

- [ ] **Step 5: Add test for click-outside dismissal**

```typescript
  it('click outside dismisses the menu', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);
    expect(document.querySelector('.tab-context-menu')).toBeTruthy();

    document.dispatchEvent(new MouseEvent('click'));
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });
```

- [ ] **Step 6: Add test for Select All action**

```typescript
  it('Select All calls terminal.selectAll()', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    (items[2] as HTMLElement).click();
    expect(terminal.selectAll).toHaveBeenCalled();
  });
```

- [ ] **Step 7: Add test for Clear Terminal action**

```typescript
  it('Clear Terminal calls terminal.clear()', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    (items[3] as HTMLElement).click();
    expect(terminal.clear).toHaveBeenCalled();
  });
```

- [ ] **Step 8: Run all tests to verify they pass**

Run: `npx vitest run src/renderer/components/terminal-context-menu.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 9: Commit**

```
git add src/renderer/components/terminal-context-menu.test.ts
```

Message: `add comprehensive tests for terminal context menu`

---

### Task 3: Add shortcut hint CSS

**Files:**
- Modify: `src/renderer/styles/tabs.css` (after line ~251, end of existing context menu styles)

- [ ] **Step 1: Add shortcut-hint style to tabs.css**

Append after the `.tab-context-menu-separator` rule (around line 251):

```css
.tab-context-menu-item .shortcut-hint {
  color: var(--text-muted);
  font-size: 11px;
  margin-left: 24px;
}

.tab-context-menu-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
```

Note: The existing `.tab-context-menu-item` rule sets `padding`, `font-size`, `color`, and `cursor`. This addition adds `display: flex` layout for items that contain a shortcut hint. Since items without a shortcut hint are plain text, flex layout won't affect their appearance. Merge the `display`/`justify-content`/`align-items` properties into the existing `.tab-context-menu-item` rule rather than creating a duplicate selector.

- [ ] **Step 2: Run full test suite to verify no regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```
git add src/renderer/styles/tabs.css
```

Message: `add shortcut hint styling for context menu items`

---

### Task 4: Integrate context menu into terminal-pane.ts

**Files:**
- Modify: `src/renderer/components/terminal-pane.ts:1` (add import)
- Modify: `src/renderer/components/terminal-pane.ts:157-170` (add contextmenu listener after existing event listeners)

- [ ] **Step 1: Add import at top of terminal-pane.ts**

After the existing import of `attachClipboardCopyHandler` (line 13), add:

```typescript
import { showTerminalContextMenu } from './terminal-context-menu.js';
```

- [ ] **Step 2: Add contextmenu event listener**

After the focus tracking block (line 170, after the closing `});` of `terminal.onData`), add:

```typescript
  // Right-click context menu
  xtermWrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTerminalContextMenu(e.clientX, e.clientY, terminal, writeToPty);
  });
```

The listener is on `xtermWrap` (the div wrapping the xterm.js terminal) rather than `element` (which also contains the status bar). This ensures the context menu only triggers over the terminal area.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Build and smoke test**

Run: `npm run build && npm start`

Manual verification:
1. Right-click in terminal → menu appears at cursor position
2. Menu shows Copy (disabled if no text selected), Paste, Select All, Clear Terminal
3. Select text in terminal, right-click → Copy is enabled
4. Click Copy → text is on clipboard
5. Click Paste → clipboard content appears in terminal
6. Click Select All → all terminal content selected
7. Click Clear Terminal → scrollback cleared
8. Click outside menu → menu dismissed
9. Press Escape → menu dismissed
10. Right-click on tab → tab context menu still works (not affected)

- [ ] **Step 5: Commit**

```
git add src/renderer/components/terminal-pane.ts
```

Message: `integrate terminal context menu into terminal pane`

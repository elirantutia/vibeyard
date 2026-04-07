---
name: ui-dev
description: This skill MUST be used whenever the task involves UI development, renderer code changes, adding or modifying components, creating modals or dialogs, working with CSS styles, building new UI features, or touching any file in src/renderer/. Use this skill when the user asks to "add a button", "create a modal", "add a dropdown", "update the sidebar", "style a component", "add a new UI feature", or any renderer/frontend work.
---

# UI Development Guide

This project uses **vanilla TypeScript DOM manipulation** — no framework. All UI lives in `src/renderer/`. Follow the patterns and reuse the components documented below.

## Custom Dropdown / Select

**Never use native `<select>`.** Always use the custom select component:

```typescript
import { createCustomSelect } from './components/custom-select';

const select = createCustomSelect('my-select', [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
  { value: 'c', label: 'Disabled', disabled: true },
], 'a'); // default value

// select.getValue() — get current value
// select.destroy() — cleanup
```

- **File**: `src/renderer/components/custom-select.ts`
- **CSS classes**: `.custom-select`, `.custom-select-trigger`, `.custom-select-dropdown`, `.custom-select-item`
- Supports keyboard navigation (Arrow keys, Enter, Escape, Tab)

## Modals

Use `showModal()` for generic modals with form fields:

```typescript
import { showModal, closeModal, setModalError } from './components/modal';

showModal('My Title', [
  { id: 'name', label: 'Name', type: 'text', placeholder: 'Enter name' },
  { id: 'option', label: 'Option', type: 'select', options: [...] },
  { id: 'enabled', label: 'Enable feature', type: 'checkbox' },
], (values) => {
  // values is Record<string, string>
  if (!values.name) {
    setModalError('name', 'Name is required');
    return;
  }
  // ... handle confirm
  closeModal();
});
```

- **File**: `src/renderer/components/modal.ts`
- Exports: `showModal()`, `closeModal()`, `setModalError()`
- Supports field types: `text`, `checkbox`, `select` (uses custom select internally)
- Supports field buttons (e.g., a "Browse" button next to a text input)
- Keyboard: Enter to confirm, Escape to cancel

For specialized modals (complex layout, multi-pane, unique behavior), create a dedicated file in `src/renderer/components/` following the existing pattern (e.g., `preferences-modal.ts`, `usage-modal.ts`).

## Alert Banners

For in-context alerts shown above the terminal:

```typescript
import { showAlertBanner, removeAlertBanner } from './components/alert-banner';

showAlertBanner({
  icon: '⚠️',
  message: 'Something happened',
  ctaLabel: 'Fix it',
  onCta: () => { /* handle action */ },
  dismissLabel: 'Dismiss',
  onDismiss: () => { removeAlertBanner(); },
});
```

- **File**: `src/renderer/components/alert-banner.ts`
- **CSS classes**: `.insight-alert`, `.insight-alert-icon`, `.insight-alert-message`, `.insight-alert-cta`, `.insight-alert-dismiss`
- Use `.insight-alert-info` variant for informational (blue) alerts

## Buttons

Use existing CSS classes — do not create new button styles:

| Class | Use for |
|-------|---------|
| `.icon-btn` | Small 26×26px icon buttons (tab bar, sidebar actions) |
| `.modal-btn` | Standard modal action buttons |
| `.modal-btn.primary` | Primary/confirm modal button (accent color) |
| `.modal-field-btn` | Inline button next to a modal field (e.g., "Browse") |
| `.config-section-add-btn` | Add button in config sections |

## Badges

| Class | Use for |
|-------|---------|
| `.scope-badge.user` / `.scope-badge.project` | Scope indicators |
| `.readiness-badge` | Status badges |
| `.git-file-badge` | Git status letter indicators |
| `.file-viewer-area-badge` | Git area badges (staged, working, etc.) |

## CSS Theming

**Never hardcode colors.** Always use CSS variables from `src/renderer/styles/base.css`:

```css
/* Backgrounds */
var(--bg-primary)    /* #000000 — main background */
var(--bg-secondary)  /* #0a0a0a — secondary background */
var(--bg-tertiary)   /* #1a1a1a — tertiary / elevated surfaces */
var(--bg-hover)      /* #222222 — hover state */

/* Text */
var(--text-primary)  /* #e0e0e0 */
var(--text-secondary) /* #a0a0b0 */
var(--text-muted)    /* #606070 */

/* Accents & borders */
var(--accent)        /* #e94560 — primary accent (red) */
var(--accent-dim)    /* #c73e55 */
var(--border)        /* #333333 */
var(--bookmark)      /* #e8a317 */
```

**Semantic status colors** (these are not CSS variables — use the hex values directly):
- Working/Active: `var(--accent)` with pulse animation
- Waiting: `#f4b400` (yellow)
- Completed/Success: `#34a853` (green)
- Input: `#e67e22` (orange)
- Info: `#4285f4` (blue)
- Idle: `var(--text-muted)`

## Styling Conventions

- **Class naming**: `.component-child` pattern (e.g., `.modal-field`, `.tab-status`)
- **State modifiers**: `.active`, `.disabled`, `.hidden`, `.focused` (e.g., `.tab-item.active`)
- **Border radius**: `4px` standard, `2-3px` small, `8px` rounded/pills, `50%` circular
- **Transitions**: `0.15s` for hover/focus states
- **Font**: System sans-serif for UI, monospace (`JetBrains Mono`, `Fira Code`, etc.) for code/terminal
- **Font sizes**: 9-13px for UI elements, 13px base
- **Scrollbars**: Use webkit custom scrollbar (6px width, `var(--border)` thumb, 3px radius)

## Component Architecture Patterns

### Factory functions
Components use factory functions that return an instance object:

```typescript
export function createMyComponent(id: string, options: Options): MyComponentInstance {
  const el = document.createElement('div');
  // ... build DOM ...
  return {
    element: el,
    getValue() { /* ... */ },
    destroy() { /* cleanup listeners, remove DOM */ },
  };
}
```

### State subscriptions
Use `appState` event emitter for reactive updates:

```typescript
import { appState } from '../state';
appState.on('session-changed', (sessionId) => { /* update UI */ });
```

### Cleanup
Always provide a `destroy()` method that removes event listeners and DOM nodes. This prevents memory leaks when sessions/tabs are closed.

### DOM creation
- Prefer `document.createElement()` + property assignment over `innerHTML`
- When using `innerHTML`, always escape user content with `esc()` from `src/renderer/components/dom-utils.ts`
- Use `classList.toggle()` / `classList.add()` / `classList.remove()` for conditional classes
- Use `element.dataset.*` for data attributes

### Text selection preservation
Components that re-render periodically (timers, event-driven updates) must check for active text selection before wiping the DOM. Destroying DOM nodes while the user is selecting text clears their selection. Guard re-renders like this:

```typescript
const sel = window.getSelection();
if (sel && sel.rangeCount > 0 && !sel.isCollapsed && container.contains(sel.anchorNode)) {
  return; // skip render — user is selecting text
}
```

Also ensure clickable containers that hold selectable text use `stopPropagation()` on the text element to prevent click-to-select from triggering the parent's click handler, and set `user-select: text; cursor: text;` in CSS.

## CSS File Organization

Add styles to the appropriate existing CSS file — do not create new CSS files unless introducing a wholly new component area:

| File | Contents |
|------|----------|
| `styles/base.css` | CSS variables, resets, global styles |
| `styles/modals.css` | Modal, custom select, config sections, path autocomplete |
| `styles/tabs.css` | Tab bar, icon buttons, context menus |
| `styles/sidebar.css` | Sidebar, project list, update banner |
| `styles/terminal.css` | Terminal pane, status bar, exit overlay |
| `styles/alerts.css` | Alert banners, insight alerts, readiness badges |
| `styles/search.css` | Search bar, toggle buttons, match highlighting |
| `styles/dialogs.css` | Help dialog |
| `styles/preferences.css` | Preferences modal, sections |
| `styles/session-history.css` | Session history list |
| `styles/file-viewer.css` | File viewer, diff display |
| `styles/git-panel.css` | Git panel, worktree selector |
| `styles/mcp-inspector.css` | MCP inspector pane |
| `styles/session-inspector.css` | Session inspector panel |

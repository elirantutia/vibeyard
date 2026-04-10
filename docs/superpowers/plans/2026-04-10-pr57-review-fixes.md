# PR #57 Review Fixes — Sidebar Navigation + Bug Fixes + Code Quality

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all review feedback on PR #57 — move board access into the sidebar, fix 4 bugs, resolve 4 code quality issues, and clean up unused type stubs.

**Architecture:** The sidebar currently renders flat project items. We add expandable sub-items (Board / Sessions) under the active project. Bug fixes are isolated per-module changes. Type cleanup removes dead code paths.

**Tech Stack:** Vanilla TypeScript, Electron renderer process, CSS custom properties for theming.

---

### Task 1: Fix `updateTask` caller mutation bug

**Files:**
- Modify: `src/renderer/board-state.ts:65-75`
- Test: `src/renderer/board-state.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/renderer/board-state.test.ts`, inside the `updateTask` describe block, add:

```typescript
it('does not mutate the caller updates object', () => {
  const task = addTask({ title: 'Mutation test', prompt: 'p', cwd: '/tmp' });
  const updates: Partial<BoardTask> = { columnId: 'nonexistent-col-id', title: 'New' };
  updateTask(task.id, updates);
  // The caller's object should still have the invalid columnId
  expect(updates.columnId).toBe('nonexistent-col-id');
  // But the task should not have the invalid columnId applied
  expect(task.columnId).not.toBe('nonexistent-col-id');
  // The title should still be updated
  expect(task.title).toBe('New');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/board-state.test.ts -t "does not mutate"`
Expected: FAIL — `updates.columnId` is `undefined` because `delete updates.columnId` mutates it.

- [ ] **Step 3: Implement the fix**

In `src/renderer/board-state.ts`, replace the `updateTask` function body:

```typescript
export function updateTask(taskId: string, updates: Partial<BoardTask>): void {
  const board = getBoard();
  if (!board) return;
  const task = board.tasks.find(t => t.id === taskId);
  if (!task) return;
  const safeUpdates = { ...updates };
  if (safeUpdates.columnId && !board.columns.some(c => c.id === safeUpdates.columnId)) {
    delete safeUpdates.columnId;
  }
  Object.assign(task, safeUpdates, { updatedAt: Date.now() });
  appState.notifyBoardChanged();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/board-state.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/board-state.ts src/renderer/board-state.test.ts
git commit -m "fix updateTask mutating caller's updates object"
```

---

### Task 2: Fix `shortenPath` missing Linux home directories

**Files:**
- Modify: `src/renderer/components/board/board-card.ts:200-201`
- Test: `src/renderer/components/board/board-card.test.ts` (create if none exists, or add to existing)

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/board/board-card.test.ts` if it doesn't exist. Since `shortenPath` is a private function, we need to export it for testing or test it through `createBoardCard`. The simplest approach: export `shortenPath` and test directly.

First, in `board-card.ts`, change `function shortenPath` to `export function shortenPath`.

Then write the test:

```typescript
import { describe, it, expect } from 'vitest';
import { shortenPath } from './board-card';

describe('shortenPath', () => {
  it('abbreviates macOS home dirs', () => {
    expect(shortenPath('/Users/alice/projects/foo')).toBe('~/projects/foo');
  });

  it('abbreviates Linux home dirs', () => {
    expect(shortenPath('/home/alice/projects/foo')).toBe('~/projects/foo');
  });

  it('abbreviates Windows home dirs', () => {
    expect(shortenPath('C:\\Users\\alice\\projects\\foo')).toBe('~\\projects\\foo');
  });

  it('shortens long paths', () => {
    expect(shortenPath('/home/alice/a/b/c/d')).toBe('~/.../c/d');
  });

  it('returns empty string for empty input', () => {
    expect(shortenPath('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/board/board-card.test.ts`
Expected: FAIL on "abbreviates Linux home dirs" — `/home/alice/projects/foo` is not shortened.

- [ ] **Step 3: Fix the regex**

In `src/renderer/components/board/board-card.ts`, change:

```typescript
const HOME_RE_UNIX = /^\/Users\/[^/]+/;
```

to:

```typescript
const HOME_RE_UNIX = /^(?:\/Users|\/home)\/[^/]+/;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/board/board-card.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/board/board-card.ts src/renderer/components/board/board-card.test.ts
git commit -m "fix shortenPath to handle Linux /home/ directories"
```

---

### Task 3: Fix context menu event listener leak

**Files:**
- Modify: `src/renderer/components/board/board-context-menu.ts`

- [ ] **Step 1: Read the current file**

Read `src/renderer/components/board/board-context-menu.ts` in full.

- [ ] **Step 2: Add listener tracking**

Add a module-level variable to track pending close handlers, and clean them up at the start of `showContextMenu`:

```typescript
let pendingClose: { click: (e: Event) => void; keydown: (e: Event) => void } | null = null;

export function showContextMenu(/* existing params */) {
  // Clean up previous listeners before anything else
  if (pendingClose) {
    document.removeEventListener('click', pendingClose.click);
    document.removeEventListener('keydown', pendingClose.keydown);
    pendingClose = null;
  }
  hideContextMenu();
  // ... existing menu building code ...

  const close = (e: Event) => {
    // ... existing close logic ...
    pendingClose = null;
  };

  requestAnimationFrame(() => {
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    pendingClose = { click: close, keydown: close };
  });
}
```

- [ ] **Step 3: Run all board tests**

Run: `npx vitest run src/renderer/`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/board/board-context-menu.ts
git commit -m "fix context menu event listener leak on rapid right-clicks"
```

---

### Task 4: Fix hardcoded "Backlog" in delete-column confirmation

**Files:**
- Modify: `src/renderer/components/board/board-column.ts:115-122`

- [ ] **Step 1: Update the import**

In `board-column.ts`, ensure `getColumnByBehavior` is imported from `../../board-state.js`. Check existing imports — it may already be imported.

- [ ] **Step 2: Fix the message**

Change:

```typescript
const message = taskCount > 0
  ? `Delete column "${column.title}"? Its ${taskCount} task(s) will be moved to Backlog.`
  : `Delete column "${column.title}"?`;
```

to:

```typescript
const inboxTitle = getColumnByBehavior('inbox')?.title ?? 'Backlog';
const message = taskCount > 0
  ? `Delete column "${column.title}"? Its ${taskCount} task(s) will be moved to ${inboxTitle}.`
  : `Delete column "${column.title}"?`;
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/board/board-column.ts
git commit -m "fix delete-column message to use actual inbox column title"
```

---

### Task 5: Deduplicate `TAG_COLORS`

**Files:**
- Modify: `src/renderer/board-state.ts:203` — export the constant
- Modify: `src/renderer/components/board/board-view.ts:136` — import instead of redefine

- [ ] **Step 1: Export from board-state.ts**

In `src/renderer/board-state.ts`, change:

```typescript
const TAG_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'cyan', 'pink', 'gray'];
```

to:

```typescript
export const TAG_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'cyan', 'pink', 'gray'];
```

- [ ] **Step 2: Import in board-view.ts**

In `src/renderer/components/board/board-view.ts`, add `TAG_COLORS` to the existing import from `../../board-state.js`:

```typescript
import { getBoard, addTag, removeTag, updateTagColor, getTagCount, TAG_COLORS } from '../../board-state.js';
```

Then delete the local `const TAG_COLORS = [...]` line (~line 136).

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/board-state.ts src/renderer/components/board/board-view.ts
git commit -m "deduplicate TAG_COLORS — export from board-state, import in board-view"
```

---

### Task 6: Move inline styles to CSS classes

**Files:**
- Modify: `src/renderer/components/board/board-task-modal.ts` — replace inline `style.cssText` with class names
- Modify: `src/renderer/styles/kanban.css` — add new classes

- [ ] **Step 1: Add CSS classes to kanban.css**

Add to the end of `src/renderer/styles/kanban.css`:

```css
/* Task modal tag input */
.board-modal-tag-input {
  padding: 4px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  width: 100%;
  box-sizing: border-box;
  outline: none;
}

/* Task modal run button */
.board-modal-run-btn {
  margin-right: auto;
  padding: 6px 14px;
  background: var(--accent);
  color: var(--accent-text, #fff);
  border: 1px solid var(--accent);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
```

- [ ] **Step 2: Replace inline styles in board-task-modal.ts**

Replace the tag input inline style:

```typescript
// Before:
tagInput.style.cssText = 'padding:4px 8px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;color:var(--text-primary);font-size:12px;width:100%;box-sizing:border-box;outline:none;';

// After:
tagInput.className = 'board-modal-tag-input';
```

Replace the run button inline style:

```typescript
// Before:
runBtn.style.cssText = 'margin-right:auto;padding:6px 14px;background:var(--accent);color:#fff;border:1px solid var(--accent);border-radius:6px;cursor:pointer;font-size:13px;';

// After:
runBtn.className = 'board-modal-run-btn';
```

- [ ] **Step 3: Run tests and verify build**

Run: `npx vitest run src/renderer/ && npm run build`
Expected: All PASS, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/board/board-task-modal.ts src/renderer/styles/kanban.css
git commit -m "move inline styles to CSS classes for theme compatibility"
```

---

### Task 7: Fix DnD drop-target cache timing

**Files:**
- Modify: `src/renderer/components/board/board-dnd.ts`

- [ ] **Step 1: Read the current file around the cache initialization**

Read `src/renderer/components/board/board-dnd.ts` around the `requestAnimationFrame` cache section.

- [ ] **Step 2: Populate cache synchronously**

The drop targets are injected synchronously by `injectDropTargets()`, so `querySelectorAll` can find them immediately. Move the cache population out of `requestAnimationFrame`:

```typescript
// Before:
injectDropTargets(dragTaskId);
requestAnimationFrame(() => {
  cachedTargets = [];
  for (const el of document.querySelectorAll('.board-drop-target')) {
    const rect = el.getBoundingClientRect();
    cachedTargets.push({ el: el as HTMLElement, left: rect.left, right: rect.right, centerY: rect.top + rect.height / 2 });
  }
});

// After:
injectDropTargets(dragTaskId);
cachedTargets = [];
for (const el of document.querySelectorAll('.board-drop-target')) {
  const rect = el.getBoundingClientRect();
  cachedTargets.push({ el: el as HTMLElement, left: rect.left, right: rect.right, centerY: rect.top + rect.height / 2 });
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/renderer/`
Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/board/board-dnd.ts
git commit -m "fix DnD drop-target cache populated synchronously to avoid empty cache on fast drags"
```

---

### Task 8: Remove unused type stubs and add prompt maxLength

**Files:**
- Modify: `src/shared/types.ts` — remove `dangerousMode`, `autoInject`, `attachments`, and `TaskAttachment`
- Modify: `src/renderer/board-state.ts` — remove `shouldAutoInject` function
- Modify: `src/renderer/board-state.test.ts` — remove `shouldAutoInject` tests
- Modify: `src/renderer/components/board/board-task-modal.ts` — add `maxLength` to prompt textarea

- [ ] **Step 1: Remove fields from BoardTask interface**

In `src/shared/types.ts`, remove these three fields from the `BoardTask` interface:

```typescript
  attachments?: TaskAttachment[];
  autoInject?: boolean;
  dangerousMode?: boolean;
```

Also remove the `TaskAttachment` interface if it exists and is only used by `BoardTask`.

- [ ] **Step 2: Remove `shouldAutoInject` from board-state.ts**

Delete the `shouldAutoInject` function (lines ~289-295) from `src/renderer/board-state.ts`. Also remove it from the module's exports if listed.

- [ ] **Step 3: Remove `shouldAutoInject` tests**

In `src/renderer/board-state.test.ts`, delete the `describe('shouldAutoInject', ...)` block and remove `shouldAutoInject` from the import statement.

- [ ] **Step 4: Add maxLength to prompt textarea**

In `src/renderer/components/board/board-task-modal.ts`, add `maxLength` to the prompt field definition:

```typescript
{
  label: 'Prompt',
  id: 'prompt',
  type: 'textarea',
  placeholder: 'Instructions for Claude...',
  defaultValue: task?.prompt ?? '',
  rows: 4,
  maxLength: 10000,
},
```

Check if the modal's `showModal` function supports `maxLength` on textarea fields. If not, it needs to be wired up where the textarea element is created.

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run && npm run build`
Expected: All PASS, no type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/board-state.ts src/renderer/board-state.test.ts src/renderer/components/board/board-task-modal.ts
git commit -m "remove unused type stubs (dangerousMode, autoInject, attachments) and add prompt maxLength"
```

---

### Task 9: Thread task `cwd` into session spawning

**Files:**
- Modify: `src/shared/types.ts` — add optional `cwd` field to `SessionRecord`
- Modify: `src/renderer/state.ts` — accept `cwd` param in `addSession`
- Modify: `src/renderer/components/board/board-card.ts` — pass `task.cwd` to `addSession`
- Modify: `src/renderer/components/split-layout.ts` — use `session.cwd || project.path` for terminal pane

- [ ] **Step 1: Add `cwd` to `SessionRecord`**

In `src/shared/types.ts`, add to the `SessionRecord` interface:

```typescript
export interface SessionRecord {
  id: string;
  name: string;
  // ... existing fields ...
  cwd?: string;  // Override project path for task-specific working directory
  createdAt: string;
}
```

- [ ] **Step 2: Accept `cwd` in `addSession`**

In `src/renderer/state.ts`, update the `addSession` signature and implementation:

```typescript
addSession(projectId: string, name: string, args?: string, providerId?: ProviderId, cwd?: string): SessionRecord | undefined {
  const project = this.state.projects.find((p) => p.id === projectId);
  if (!project) return undefined;

  const effectiveArgs = args ?? project.defaultArgs;
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    name,
    providerId: providerId ?? this.state.preferences.defaultProvider ?? 'claude',
    ...(effectiveArgs ? { args: effectiveArgs } : {}),
    ...(cwd ? { cwd } : {}),
    cliSessionId: null,
    createdAt: new Date().toISOString(),
  };
  // ... rest unchanged
```

- [ ] **Step 3: Pass task.cwd in board-card.ts**

In `src/renderer/components/board/board-card.ts`, update the `runTask` function:

```typescript
// Before:
const session = appState.addSession(project.id, sessionName);

// After:
const taskCwd = task.cwd && task.cwd !== project.path ? task.cwd : undefined;
const session = appState.addSession(project.id, sessionName, undefined, undefined, taskCwd);
```

- [ ] **Step 4: Use session.cwd in split-layout.ts**

In `src/renderer/components/split-layout.ts`, update both `createTerminalPane` calls to use `session.cwd`:

```typescript
// Line ~123 (session-added handler):
createTerminalPane(session.id, session.cwd || project.path, session.cliSessionId, ...);

// Line ~194 (renderLayout):
createTerminalPane(session.id, session.cwd || project.path, session.cliSessionId, ...);
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run && npm run build`
Expected: All PASS, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/state.ts src/renderer/components/board/board-card.ts src/renderer/components/split-layout.ts
git commit -m "fix task cwd threaded through session to PTY spawn"
```

---

### Task 10: Add Board/Sessions sub-items to sidebar

**Files:**
- Modify: `src/renderer/components/sidebar.ts` — restructure active project rendering
- Modify: `src/renderer/styles/sidebar.css` (or wherever sidebar styles live) — add sub-item styles

- [ ] **Step 1: Identify sidebar CSS file**

Find the CSS file that styles `.project-item` and the sidebar. Check `src/renderer/styles/` for sidebar-related files.

- [ ] **Step 2: Add CSS for sub-items**

Add styles for the new project sub-navigation:

```css
.project-sub-items {
  display: flex;
  flex-direction: column;
  padding-left: 16px;
}

.project-sub-item {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.project-sub-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.project-sub-item.active {
  color: var(--accent);
  background: var(--bg-hover);
}
```

- [ ] **Step 3: Modify sidebar render for active project**

In `src/renderer/components/sidebar.ts`, update the `render()` function. For the active project, add sub-items below the project item:

```typescript
projectListEl.appendChild(el);

// Add sub-navigation for the active project
if (project.id === appState.activeProjectId) {
  const subItems = document.createElement('div');
  subItems.className = 'project-sub-items';

  const boardItem = document.createElement('div');
  boardItem.className = 'project-sub-item' + (project.layout.mode === 'board' ? ' active' : '');
  boardItem.textContent = 'Board';
  boardItem.addEventListener('click', (e) => {
    e.stopPropagation();
    if (project.layout.mode !== 'board') {
      appState.toggleBoard();
    }
  });

  const sessionsItem = document.createElement('div');
  sessionsItem.className = 'project-sub-item' + (project.layout.mode !== 'board' ? ' active' : '');
  sessionsItem.textContent = 'Sessions';
  sessionsItem.addEventListener('click', (e) => {
    e.stopPropagation();
    if (project.layout.mode === 'board') {
      appState.toggleBoard();
    }
  });

  subItems.appendChild(boardItem);
  subItems.appendChild(sessionsItem);
  projectListEl.appendChild(subItems);
}
```

- [ ] **Step 4: Listen for layout-changed**

In `initSidebar()`, add a listener so the sidebar re-renders when the layout mode changes (to update the active sub-item):

```typescript
appState.on('layout-changed', render);
```

- [ ] **Step 5: Build and manually test**

Run: `npm run build && npm start`
Verify: Active project shows Board/Sessions sub-items. Clicking "Board" switches to board view. Clicking "Sessions" switches back.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/sidebar.ts src/renderer/styles/*.css
git commit -m "add Board/Sessions sub-items to sidebar under active project"
```

---

### Task 11: Final test run and PR description update

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Update PR description**

Update the PR description to note the review feedback addressed. Add a section listing all changes made in response to the reviews.

- [ ] **Step 4: Push and request re-review**

```bash
git push
```

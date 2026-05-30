# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A terminal-centric IDE desktop app built on Electron that wraps CLI tool sessions. Users manage projects and sessions, each backed by a PTY running a CLI tool (currently Claude Code, with an abstraction layer for future providers like Copilot CLI and Gemini CLI), rendered via xterm.js.

## Build & Run

```bash
npm run build    # Compile all three targets (main, preload, renderer) + copy assets
npm start        # Build then launch Electron app (alias: npm run dev)
```

No hot reload — changes require rebuild + app restart.

Requires Node v24 (see `.nvmrc`). No lint tooling is configured.

Cross-platform: builds and runs on macOS, Linux, and Windows. Release artifacts (via electron-builder) include `.dmg`/`.zip` (mac), `.deb`/`.AppImage` (linux), and NSIS installer + portable `.exe` (win). CI covers all three platforms.

## Testing

```bash
npm test             # Run all tests once
npm run test:watch   # Watch mode (re-runs on file changes)
npm run test:coverage # Run with coverage report (terminal + HTML)
```

Uses **Vitest** with v8 coverage. Tests are co-located with source files as `*.test.ts`. Coverage HTML report outputs to `coverage/index.html`.

Test files are excluded from production builds via `exclude` in `tsconfig.main.json` and `tsconfig.renderer.json`.

Three renderer modules (`session-cost.ts`, `session-activity.ts`, `session-context.ts`) expose `_resetForTesting()` to clear module-level state between tests. Main process tests mock `fs`, `child_process`, `node-pty`, and `os` via `vi.mock()`.

## Architecture

Three-process Electron architecture with strict context isolation:

- **Main process** (`src/main/`) — Node.js side: window creation, PTY lifecycle via `node-pty`, filesystem access, persistent state (`~/.vibeyard/state.json`). IPC handlers in `ipc-handlers.ts` dispatch to `pty-manager.ts` and `store.ts`. CLI tool behavior is abstracted via the provider system (`src/main/providers/`).
- **Preload** (`src/preload/preload.ts`) — Secure bridge exposing `window.vibeyard` API via `contextBridge` with namespaces: `pty`, `session`, `store`, `fs`, `provider`, `menu`.
- **Renderer** (`src/renderer/`) — Vanilla TypeScript DOM UI (no framework). `AppState` singleton in `state.ts` uses an event emitter pattern; components in `components/` subscribe to state changes.

### Data Flow

Renderer → IPC invoke/send → Main process → PTY/filesystem → IPC send back → Renderer updates xterm terminal.

### Build Targets

Each process has its own `tsconfig.*.json`. Main and preload compile via `tsc` (CommonJS). Renderer bundles via esbuild (IIFE format, browser platform, with sourcemaps).

### CLI Provider System

CLI-specific behavior is encapsulated behind a `CliProvider` interface (`src/main/providers/provider.ts`). Each provider handles binary resolution, env vars, args, hooks, config reading, and cleanup. Providers are registered in a registry (`src/main/providers/registry.ts`) at app startup.

- **Provider per-session**: Each `SessionRecord` has a `providerId` (defaults to `'claude'`). A project can contain sessions from multiple providers.
- **Capabilities pattern**: Providers declare what they support via `CliProviderCapabilities`. UI can conditionally enable features per-session.
- **Current providers**: `ClaudeProvider` (`src/main/providers/claude-provider.ts`) — extracts all Claude-specific logic from `pty-manager.ts`, `prerequisites.ts`, `claude-cli.ts`, and `hook-status.ts`.
- **System prompt**: `buildArgs` accepts `systemPrompt?: string` and every provider must honor it (used by the Team feature). Claude maps it to `--append-system-prompt`; Codex to `-c developer_instructions=<value>`; Copilot/Gemini to `--system-prompt`. The renderer passes it via the transient `pendingSystemPrompt` field on `SessionRecord`, which is consumed once on the first PTY spawn and stripped from `state.json` so it is never re-injected on resume.
- **Agent files**: providers expose optional `agentsDir()`, `installAgent(slug, content)`, and `removeAgent(slug)` methods (default impls delegate to `src/main/providers/agent-files.ts`, which accepts an optional extension — Copilot passes `.agent.md`; everyone else uses the default `.md`). Each provider's user-global agents directory is `~/.<cli>/agents/` (e.g. `~/.claude/agents/`). The Team feature uses these via the `provider:installAgent` / `provider:removeAgent` IPC channels to mirror a `TeamMember` (with `installAsAgent: true`) as a `<slug>.md` (or `<slug>.agent.md` for Copilot) file across every installed provider, making it invokable as `/<slug>` inside CLI sessions. Slug is sticky on the member (`agentSlug` field) so renames preserve the same file. Filename collisions with non-Vibeyard agents at the same slug will overwrite — the renderer only deduplicates within team members.

### Key Components

- `terminal-pane.ts` — xterm.js wrapper per session, handles PTY data streaming and WebGL rendering with software fallback
- `state.ts` — Reactive AppState singleton; debounced persistence (300ms) to `~/.vibeyard/state.json`
- `split-layout.ts` — Manages tab mode (single terminal) vs split mode (side-by-side)
- `session-activity.ts` — Tracks working/waiting/idle status with debounced transitions
- `session-cost.ts` — Structured cost tracking via Claude CLI status line (`statusLine` setting), with regex fallback for older CLI versions. Provides per-session and aggregate cost data (USD, tokens, cache, duration)
- `components/git-panel.ts` — Git changes for the **active project**, rendered inside its sidebar card as a `git` panel-toggle tab (a third `ProjectPanel` alongside `history`/`files` in `sidebar.ts`), not a standalone bottom panel. The "Git" tab carries a `.project-action-badge` count of total changes (badge + click-to-open); `Cmd/Ctrl+Shift+G` (`toggleGitPanel`, exported from `sidebar.ts`) toggles it. `mountGitPanel(project, container)` reparents a single persistent node into `.project-panel-git` so file rows/scroll survive sidebar re-renders; `closeGitPanel()` detaches it. The shared `loadFiles`/worktree-selector logic is unchanged; `sidebarViews.gitPanel` now gates the tab button. There is no `#git-panel` node in `index.html`.
- `browser-tab/` — Browser tab pane split into focused modules: `types.ts`, `instance.ts` (registry + preload path), `navigation.ts`, `viewport.ts`, `selector-ui.ts`, `inspect-mode.ts`, `flow-recording.ts`, `flow-picker.ts`, `session-integration.ts`, and `pane.ts` (DOM build + event wiring). `browser-tab-pane.ts` is a re-export shim for backward compatibility.
- `board-state.ts` — Kanban board CRUD: tasks, columns, tags, reorder. Mutates `appState.activeProject.board` in place, calls `appState.notifyBoardChanged()`.
- `board-filter.ts` — Module-level search query and tag filter state for the board. Observer pattern via `onFilterChange()`.
- `board-session-sync.ts` — Listens to session lifecycle events and auto-moves board tasks (e.g. to Done on session complete).
- `components/board/` — Board UI: `board-view.ts` (container + header with the search box and "New task" button in a right-aligned actions group, plus a dedicated "Filter" tag row below), `board-column.ts` (column with header/rename), `board-card.ts` (card with run/resume/focus), `board-task-modal.ts` (create/edit dialog with tags), `board-dnd.ts` (drag-and-drop with injected DOM drop targets), `board-context-menu.ts`.
- `styles/kanban.css` — All kanban board styles including cards, columns, DnD drop targets, tag pills, and filter UI.
- `components/team/` — Team tab: `instance.ts` + `pane.ts` (tab plumbing mirroring kanban), `team-view.ts` (header + card grid + empty state), `member-card.ts` (Chat/Edit/Sessions/Delete actions), `member-modal.ts` (create/edit form using the shared `showModal`), `predefined-picker.ts` (fetches suggestions from this repo's `personas/` folder, marks already-installed members), `github-fetcher.ts` (Contents API + raw download, 1 hour cache), `frontmatter.ts` (Markdown → `TeamMember` parser).
- `styles/team.css` — Team grid, cards, predefined-picker dialog. Uses CSS variables only.
- Team state lives at the top level of `~/.vibeyard/state.json` as `state.team.members` (global, not per-project). Predefined suggestions cache at `state.team.predefinedCache`. Predefined personas live in the top-level `personas/` directory of this repo and are fetched at runtime via the GitHub Contents API; the location is configured by the single constant `TEAM_MEMBERS_REPO` in `src/shared/team-config.ts` — flip its `owner`/`repo`/`path` to retarget.
- `components/project-tab/` — Customizable Overview page driven by a gridstack.js drag-and-drop grid. `pane.ts` builds the toolbar (`+ Add Widget`, `Edit layout` toggle) + grid root. `grid.ts` wraps gridstack and owns tile chrome (header, drag handle, refresh/settings/remove buttons). Per-project layout persists at `ProjectRecord.overviewLayout` with widget records `{ id, type, x, y, w, h, config? }` — lazy-defaulted on first render to mirror the legacy 2-column layout, no migration code. Each widget is a `WidgetFactory` registered in `widgets/widget-registry.ts`; current types: `readiness`, `provider-tools` (refactors of the old columns), `github-prs`, `github-issues`, `team` (reuses `createMemberCard` from `components/team/member-card.ts`, listens to `'team-changed'`), `kanban` (reuses `createCardElement` from `components/board/board-card.ts`, groups by column, listens only to `'board-changed'` — live per-session metrics are intentionally omitted to avoid full-rerender storms; the full kanban tab covers that), `sessions` (active CLI sessions + recent archived split into two sections; filtered through `isCliSession`; click-to-focus calls `setActiveSession`, click-to-resume calls `resumeFromHistory`; subscribes to `session-activity`/`session-cost`/`session-unread` observers with surgical row updates for status/cost ticks; settings modal at `widgets/sessions-settings-modal.ts` with config in `widgets/sessions-types.ts` lets users tune `recentLimit`), `usage-stats` (Claude-Code-only summary of sessions/messages/model token usage and a 7-day + by-hour activity heatmap; reads `~/.claude/stats-cache.json` via `window.vibeyard.stats.getCache()`; styled with `styles/usage.css`; refresh wired through the widget chrome's refresh button — no in-content button). GitHub widgets use `window.vibeyard.github.*` IPC backed by `src/main/github-cli.ts` which shells out to the user's local `gh` CLI (auto-detected; PATH is the augmented `getFullPath()` from `pty-manager`). Repo defaults to the project's git origin via `getGitRemoteUrl`; per-widget settings (`widgets/github-settings-modal.ts`) override repo, state, max items, and refresh interval. Read/unread tracking lives in `github-unread.ts` (Set + observer mirroring `session-unread.ts`); per-item lastSeen timestamps persist at `ProjectRecord.githubLastSeen`. The tab-bar surfaces unread by branching on `project-tab` to consult `hasUnreadInProject`. Gridstack CSS is bundled by copying `node_modules/gridstack/dist/gridstack.min.css` to `dist/renderer/vendor/` (esbuild has no CSS loader); `<link>`ed from `index.html`. `styles/widgets.css` holds shared widget chrome.
- `terminal-context-menu.ts` — Right-click context menu for terminal panes (Copy, Paste, Select All). DOM-based using shared `tab-context-menu` CSS classes. `showTerminalContextMenu()` / `hideTerminalContextMenu()` exports; integrated via `contextmenu` listener on `xtermWrap` in `terminal-pane.ts`. Every action handler calls `terminal.focus()` after closing the menu so keyboard input resumes immediately (clicking a menu item otherwise leaves focus on the document, e.g. typing after Paste would be dropped). Note: the flex layout (`display:flex; justify-content:space-between; align-items:center`) lives on the shared `.tab-context-menu-item` selector in `styles/tabs.css`, so it affects every menu reusing that class — existing single-label items are unaffected since `space-between` has nothing to push.

### Platform Checks

Platform detection is centralized in `src/main/platform.ts`. Import
`isWin`/`isMac`/`isLinux` (and derived constants `pathSep`, `whichCmd`,
`pythonBin`) from there — do **not** inline `process.platform === 'win32'`
or redefine `isWin`/`isMac` locally in source or test files. The
three-way managed-path branch in `claude-cli.ts` is the one intentional
exception.

### Cross-platform paths in tests

When asserting on a path that the implementation produced via `path.join`,
`path.resolve`, or `path.normalize`, **never hardcode forward-slash literals**
like `'/repo/foo.ts'` in the assertion — they pass on macOS/Linux but fail
on `windows-latest` because Node yields `\repo\foo.ts` there. Build the
expected value with the same primitive the implementation uses:

```ts
import * as path from 'path';
// good — matches whatever path.join produces on the running platform
expect(mockRm).toHaveBeenCalledWith(path.join('/repo', 'foo.ts'), opts);

// bad — hidden Windows-only failure
expect(mockRm).toHaveBeenCalledWith('/repo/foo.ts', opts);
```

This applies to any assertion on arguments to `fs.*`, `child_process` calls,
or anything else that flows a joined path through. CI runs on all three
platforms, so a forward-slash literal will eventually fail on Windows.

### File Watching

Live filesystem updates for the file tree, file reader, and diff viewer are backed by a single **chokidar** watcher in `src/main/file-watcher.ts` (chokidar is ESM-only but `require`-able under Electron's Node ≥22.12). It watches **directories non-recursively** (`depth: 0`), ref-counted per dir via `watchDir(dir)` / `unwatchDir(dir)` (IPC `fs:watchDir` / `fs:unwatchDir`). Watching the parent dir — not the file inode — is deliberate: it survives atomic save/replace (write-temp + rename), which silently kills an inode watch. Changes are coalesced and debounced (150ms) into a single batched `fs:changed` IPC carrying `FsChange[]` (`{ path, dir, type }`, type ∈ add/addDir/change/unlink/unlinkDir; see `src/shared/types.ts`). The renderer subscribes via `window.vibeyard.fs.onFsChange`. `stopAllFileWatchers()` is wired into `main.ts` teardown (window `closed` + `before-quit`).

Scope is **lazy**: only expanded tree folders and the parent dirs of open reader/viewer files are watched (cheap on huge repos). The file tree (`file-tree.ts`) reacts by **incremental reconciliation** (`reconcileChildren`), not full rebuilds: rows are keyed by `data-entry-path`, vanished entries are removed (unwatching their subtree via `unwatchSubtree`), new entries are inserted at the sorted position, and unchanged rows — with their expanded subtrees, scroll, and selection — are left untouched. Change bursts are flushed once per `requestAnimationFrame`. Cross-platform path helpers (`dirname`, `isPathUnder`) live in `src/shared/platform.ts`. Note: this is separate from `git-watcher.ts`, which watches the whole working tree and emits `git:changed` for the git-status UI. To avoid the macOS FSEvents teardown storm on project switch (#142), `git-watcher.ts` uses a **single recursive `fs.watch`** on macOS + Windows (`watchRecursiveWorkingTree`, one OS handle, events filtered via `hasIgnoredSegment`) and keeps the **capped per-dir BFS** (`walkAndWatch`, `MAX_WATCHES`) on Linux, where recursive `fs.watch` is unsupported and previously leaked inotify watches (#139). Fine-grained `.git` watches and the 60s git-status poll are unchanged.

### State Persistence

App state (projects, sessions, layout) persists to `~/.vibeyard/state.json` via the main process store. Saves are debounced and flushed on quit. Sessions track `cliSessionId` for CLI session resume capability.

## UI Development

When working on renderer/UI code, the `/ui-dev` skill is automatically invoked. It documents all custom components (dropdowns, modals, alerts, badges), CSS theming variables, styling conventions, and component architecture patterns. Always follow it — never use native `<select>`, never hardcode colors, always reuse existing components.

## Planning

When entering plan mode for a new feature, consider whether the feature (or aspects of it) should be exposed as a user-configurable option in Preferences. If it's relevant, ask the user whether they'd like it added as a config in the prefs before finalizing the plan.

## Post-Implementation

After completing an implementation task, always:

1. Run `/simplify` to review changed code for reuse, quality, and efficiency.
2. Add or update tests as needed to cover the changes.

## Git Workflow

Always use the `/commit` command when committing changes to this project. Do not create commits manually.

Never commit, push, or create pull requests unless the user explicitly asks for it.

## Maintaining This File

When your changes affect the architecture, build process, key components, data flow, or any other information documented above, update this CLAUDE.md to reflect the new state. This includes adding/removing/renaming files, changing IPC namespaces, modifying the build pipeline, or introducing new patterns. Keep this file accurate so future sessions start with correct context.

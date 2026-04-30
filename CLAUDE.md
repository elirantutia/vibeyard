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
- **Preload** (`src/preload/preload.ts`) — Secure bridge exposing `window.vibeyard` API via `contextBridge` with namespaces: `pty`, `session`, `fs`, `store`, `provider`, `claude`, `git`, `update`, `app`, `browser`, `mcp`, `readiness`, `stats`, `settings`, `menu`.
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

### Key Components

- `terminal-pane.ts` — xterm.js wrapper per session, handles PTY data streaming and WebGL rendering with software fallback
- `state.ts` — Reactive AppState singleton; debounced persistence (300ms) to `~/.vibeyard/state.json`
- `split-layout.ts` — Manages tab mode (single terminal) vs split mode (side-by-side)
- `session-activity.ts` — Tracks working/waiting/idle status with debounced transitions
- `session-cost.ts` — Structured cost tracking via Claude CLI status line (`statusLine` setting), with regex fallback for older CLI versions. Provides per-session and aggregate cost data (USD, tokens, cache, duration, `contextWindowSize` reported by Claude). Listeners can use `cost.model` as a marker to discriminate structured data (always set) vs the regex fallback (never sets it).
- `browser-tab/` — Browser tab pane split into focused modules: `types.ts`, `instance.ts` (registry + preload path), `navigation.ts`, `viewport.ts`, `selector-ui.ts`, `inspect-mode.ts`, `flow-recording.ts`, `flow-picker.ts`, `session-integration.ts`, and `pane.ts` (DOM build + event wiring). `browser-tab-pane.ts` is a re-export shim for backward compatibility.
- `confirm-dialog.ts` — Promise-based confirmation dialog (`showConfirmDialog()`) returning `true`/`false`. Separate from `modal.ts` (which handles form inputs). Supports optional warning banner via `detail` HTML.
- `confirm-helpers.ts` — Utility functions `countActiveStatuses()` and `buildWarningBannerDetail()` for building session status warning banners in close confirmation dialogs.
- `close-guard.ts` — Window close guard; listens for `app:confirmClose` IPC from main process, checks active session status and `confirmCloseActive` preference, shows warning banner dialog if needed, responds with `app:closeConfirmed` or `app:closeCancelled`.
- `terminal-context-menu.ts` — Right-click context menu for terminal panes (Copy, Paste, Select All, Clear Terminal). DOM-based using shared `tab-context-menu` CSS classes. `showTerminalContextMenu()` / `hideTerminalContextMenu()` exports; integrated via `contextmenu` listener on `xtermWrap` in `terminal-pane.ts`.
- `sidebar-usage.ts` — Sidebar context-window usage indicator (issue #68). **Phase 1** (top row): subscribes to `session-cost.onChange` + active-session events; reads authoritative limit from `CostInfo.contextWindowSize` (falls back to model-name lookup), displays a progress bar + percent with amber/danger thresholds and ARIA `progressbar` role. **Phase 2** (bottom row): subscribes to `window.vibeyard.usage.onBlockChange`; renders `$X.XX · resets in HhMMm` for the active 5h block (fixed-anchor — see "5-hour Usage Block Tracking" below). Click anywhere on the widget to force a refresh (debounce-bypass). 60s renderer-side ticker keeps the countdown updating between block-change events. Mounted between `#sidebar-content` and `#sidebar-footer`; hidden when no active session, no structured cost data (no `cost.model`), or `sidebarViews.usageIndicator === false`.

### 5-hour Usage Block Tracking

`src/main/usage-blocks.ts` scans `~/.claude/projects/<hash>/*.jsonl` and aggregates Claude API spend in fixed-anchor 5-hour blocks: a block is anchored to its first entry's exact timestamp, lasts exactly 5h, and the next entry past the boundary opens a fresh block. (ccusage hour-floors the anchor; we don't, because the Claude web UI also doesn't — verified empirically against `/c/Users/User/.claude/projects` JSONL data.) With continuous activity, the countdown resets to ~5h at each boundary crossing instead of hovering near zero. Per-model rates live in `src/main/pricing.ts` (opus/sonnet/haiku 4.x families with separate 5m/1h ephemeral cache-write rates). Refresh cadence: debounced (250ms) on the internal `cost-events` bus + 30s wall-clock ticker + startup scan + on-demand `usage:refresh` IPC (used by the widget's click handler). mtime cache skips files older than `now - 5h - 5min`.

**JSONL dedup:** Claude appends prior turns when sessions resume, so the same usage entry can appear multiple times across (or within) JSONL files. `computeBlock()` dedupes by `message.id` (Anthropic's API response identifier). Without this dedup, observed over-counting was ~40% (1.6× inflated cost). Entries lacking `message.id` (older format) fall through and are counted as-is.

**SDK CLI filter:** Entries with `entrypoint === 'sdk-cli'` (e.g. claude-mem's observer agent calling Anthropic via the SDK with its own API key) are excluded at the parse layer (`parseFile()`). Those calls bill against `ANTHROPIC_API_KEY` rather than the user's claude.ai subscription quota and don't appear in the Claude web UI's 5h block view. Including them shifted the block start as much as ~1.5h earlier than the website. All other `entrypoint` values (including `cli`, missing, or unknown) fall through.

IPC: `usage:getBlock` (one-shot), `usage:refresh` (force recompute), `usage:blockChanged` (push). Renderer receives via `window.vibeyard.usage` namespace.

### Close Confirmation System

Three close actions are gated by confirmation dialogs when active sessions (working/waiting/input) exist:
- **Tab close** (X button, middle-click, context menu) — minimal dialog with session name and status dot
- **Project removal** (sidebar context menu) — warning banner with aggregated status counts
- **Window close** (X / Alt+F4) — warning banner via IPC round-trip (`app:confirmClose` → renderer checks → `app:closeConfirmed`/`app:closeCancelled`)

Two preferences in General section: `confirmCloseActive` (default: on), `confirmCloseInactive` (default: off). The `forceClose` flag in `main.ts` is module-scoped and reset on cancel; `before-quit` sets it to bypass the dialog during Cmd+Q/menu quit.

### Platform Checks

Platform detection is centralized in `src/main/platform.ts`. Import
`isWin`/`isMac`/`isLinux` (and derived constants `pathSep`, `whichCmd`,
`pythonBin`) from there — do **not** inline `process.platform === 'win32'`
or redefine `isWin`/`isMac` locally in source or test files. The
three-way managed-path branch in `claude-cli.ts` is the one intentional
exception.

### State Persistence

App state (projects, sessions, layout) persists to `~/.vibeyard/state.json` via the main process store. Saves are debounced and flushed on quit. Sessions track `cliSessionId` for CLI session resume capability. Legacy `claudeSessionId` fields are auto-migrated on load.

Hook scripts in `~/.vibeyard/run/` (Python helpers for status writing, session ID capture, etc.) are **not** cleaned up on app exit — they persist across restarts. This is intentional: hooks registered in `~/.claude/settings.json` reference these scripts and must work even when Vibeyard isn't running (e.g. standalone `claude` sessions). The scripts are small and idempotent; `installHookScripts()` overwrites them on next launch. Only session-specific runtime files in the temp `STATUS_DIR` are cleaned up on exit.

### Status-line invocation pipeline

Claude Code's `statusLine.command` runs **without going through cmd.exe/sh**, so on Windows the command must be a directly executable program (`python "..."`), **not** a `.cmd` wrapper. A `.cmd` path silently fails — Claude makes no error noise, no `.cost` files get written, and the cost footer stays empty. The python script reads JSON from stdin, looks up `CLAUDE_IDE_SESSION_ID` from the env Vibeyard injects, and writes `<sid>.cost` to `STATUS_DIR`. Main-process logic in `hook-status.ts` watches `STATUS_DIR`, forwards `.cost` payloads to the renderer via `session:costData` IPC, and lets `appState.hasSession()` in the renderer be the single gate for which sessions get updated. There is **no** `knownSessionIds` filter in main — that gate was removed because it dropped events for any session whose PTY hadn't yet been spawned in the current process. `startWatching()` calls `resyncAllSessions()` immediately so pre-existing `.cost` files propagate at startup rather than waiting for a fresh write.

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

## Maintaining This File

When your changes affect the architecture, build process, key components, data flow, or any other information documented above, update this CLAUDE.md to reflect the new state. This includes adding/removing/renaming files, changing IPC namespaces, modifying the build pipeline, or introducing new patterns. Keep this file accurate so future sessions start with correct context.

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

### Key Components

- `terminal-pane.ts` — xterm.js wrapper per session, handles PTY data streaming and WebGL rendering with software fallback
- `state.ts` — Reactive AppState singleton; debounced persistence (300ms) to `~/.vibeyard/state.json`
- `split-layout.ts` — Manages tab mode (single terminal) vs split mode (side-by-side)
- `session-activity.ts` — Tracks working/waiting/idle status with debounced transitions
- `session-cost.ts` — Structured cost tracking via Claude CLI status line (`statusLine` setting), with regex fallback for older CLI versions. Provides per-session and aggregate cost data (USD, tokens, cache, duration)
- `browser-tab/` — Browser tab pane split into focused modules: `types.ts`, `instance.ts` (registry + preload path), `navigation.ts`, `viewport.ts`, `selector-ui.ts`, `inspect-mode.ts`, `flow-recording.ts`, `flow-picker.ts`, `session-integration.ts`, and `pane.ts` (DOM build + event wiring). `browser-tab-pane.ts` is a re-export shim for backward compatibility.

### Platform Checks

Platform detection is centralized in `src/main/platform.ts`. Import
`isWin`/`isMac`/`isLinux` (and derived constants `pathSep`, `whichCmd`,
`pythonBin`) from there — do **not** inline `process.platform === 'win32'`
or redefine `isWin`/`isMac` locally in source or test files. The
three-way managed-path branch in `claude-cli.ts` is the one intentional
exception.

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

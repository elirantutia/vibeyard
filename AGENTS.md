# AGENTS.md

## Project Overview

Vibeyard is a terminal-centric IDE desktop app built on Electron that wraps CLI tool sessions. Users manage projects and sessions, each backed by a PTY running a CLI tool (Claude Code, Codex CLI, Gemini CLI), rendered via xterm.js.

**Tech stack:** Electron 41, TypeScript, xterm.js, node-pty, vanilla DOM (no UI framework), esbuild (renderer), tsc (main/preload).

## Prerequisites

- **Node.js v24** (see `.nvmrc`)
- No lint tooling is configured
- No hot reload — changes require rebuild + app restart

## Build & Run

```bash
npm run build    # Compile all three targets (main, preload, renderer) + copy assets
npm start        # Build then launch Electron app (alias: npm run dev)
```

## Testing

```bash
npm test             # Run all tests once
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report (terminal + HTML at coverage/index.html)
```

- **Framework:** Vitest with v8 coverage
- **Test location:** Co-located with source as `*.test.ts`
- **Main process tests:** Mock `fs`, `child_process`, `node-pty`, `os`, and `electron` via `vi.mock()`
- **Renderer tests:** DOM-based via jsdom environment
- **State reset:** Three renderer modules (`session-cost.ts`, `session-activity.ts`, `session-context.ts`) expose `_resetForTesting()` to clear module-level state between tests
- **Coverage exclusions:** `main.ts`, `ipc-handlers.ts`, `mcp-ipc-handlers.ts`, `menu.ts`, `mcp-client.ts`, `renderer/index.ts`, `components/**`, `keybindings.ts`, `notification-sound.ts`, `git-status.ts`, `preload/**`

## Architecture

Three-process Electron architecture with strict context isolation:

```
Renderer ──IPC invoke/send──▶ Main process ──▶ PTY / filesystem
                                    │
                                    ▼
Renderer ◀──IPC send back─── Main process ◀── PTY data / fs results
```

### Main Process (`src/main/`)

Node.js side: window creation, PTY lifecycle via `node-pty`, filesystem access, persistent state. IPC handlers in `ipc-handlers.ts` dispatch to `pty-manager.ts` and `store.ts`.

### Preload (`src/preload/preload.ts`)

Secure bridge exposing `window.vibeyard` API via `contextBridge` with namespaces: `pty`, `session`, `fs`, `store`, `provider`, `claude`, `git`, `update`, `app`, `browser`, `mcp`, `readiness`, `stats`, `settings`, `menu`.

### Renderer (`src/renderer/`)

Vanilla TypeScript DOM UI (no framework). `AppState` singleton in `state.ts` uses an event emitter pattern; components in `components/` subscribe to state changes.

### Build Targets

Each process has its own `tsconfig.*.json`:
- **Main/Preload:** `tsc` → CommonJS
- **Renderer:** `esbuild` → IIFE format, browser platform, ES2022, with sourcemaps

## Source Structure

```
src/
├── main/                        # Main process (Node.js)
│   ├── main.ts                  # App entry, window creation
│   ├── ipc-handlers.ts          # IPC dispatch hub
│   ├── pty-manager.ts           # PTY lifecycle management
│   ├── store.ts                 # State persistence (~/.vibeyard/state.json)
│   ├── claude-cli.ts            # Claude CLI binary resolution
│   ├── prerequisites.ts         # Startup checks
│   ├── auto-updater.ts          # Electron auto-update
│   ├── platform.ts              # Centralized platform detection
│   ├── mcp-client.ts            # MCP protocol client
│   ├── menu.ts                  # Application menu
│   ├── providers/               # CLI provider system
│   │   ├── provider.ts          # CliProvider interface + capabilities
│   │   ├── registry.ts          # Provider registration
│   │   ├── claude-provider.ts   # Claude Code provider
│   │   ├── codex-provider.ts    # Codex CLI provider
│   │   ├── gemini-provider.ts   # Gemini CLI provider
│   │   ├── resolve-binary.ts    # Binary path resolution
│   │   └── nvm.ts               # NVM path handling
│   └── *.test.ts                # Co-located tests
├── preload/
│   ├── preload.ts               # Main window preload (contextBridge)
│   └── browser-tab-preload.ts   # Browser tab isolated preload
├── renderer/                    # Renderer process (browser)
│   ├── index.ts                 # Entry point
│   ├── state.ts                 # AppState singleton (event emitter)
│   ├── keybindings.ts           # Keyboard shortcut handling
│   ├── platform.ts              # Renderer-side platform utils
│   ├── session-activity.ts      # Working/waiting/idle tracking
│   ├── session-cost.ts          # Cost tracking (USD, tokens, cache)
│   ├── session-context.ts       # Session context management
│   ├── components/
│   │   ├── terminal-pane.ts     # xterm.js wrapper per session
│   │   ├── split-layout.ts      # Tab mode vs split mode
│   │   ├── modal.ts             # Form input modals
│   │   ├── confirm-dialog.ts    # Promise-based confirmation dialogs
│   │   ├── custom-select.ts     # Custom dropdown select
│   │   ├── browser-tab/         # Browser tab pane (14 focused modules)
│   │   ├── sidebar-usage.ts     # Context-window % indicator in sidebar
│   │   ├── terminal-context-menu.ts # Right-click menu for terminal panes
│   │   └── ...                  # Other UI components
│   ├── styles/                  # CSS stylesheets
│   └── assets/                  # Icons, provider assets
└── shared/                      # Shared between processes
    ├── types.ts                 # IPC and app type definitions
    ├── constants.ts
    └── platform.ts              # Cross-process platform utils
```

## CLI Provider System

CLI-specific behavior is encapsulated behind a `CliProvider` interface (`src/main/providers/provider.ts`). Each provider handles binary resolution, env vars, args, hooks, config reading, and cleanup.

- **Per-session:** Each `SessionRecord` has a `providerId` (defaults to `'claude'`). A project can contain sessions from multiple providers.
- **Capabilities pattern:** Providers declare supported features via `CliProviderCapabilities`. UI conditionally enables features per-session.
- **Current providers:** Claude (`claude-provider.ts`), Codex (`codex-provider.ts`), Gemini (`gemini-provider.ts`)
- **Registration:** Providers register in `registry.ts` at app startup.

## Key Components

| Component | File | Purpose |
|-----------|------|---------|
| Terminal Pane | `components/terminal-pane.ts` | xterm.js wrapper, PTY data streaming, WebGL rendering with software fallback |
| AppState | `state.ts` | Reactive singleton, debounced persistence (300ms) |
| Split Layout | `components/split-layout.ts` | Tab mode (single terminal) vs split mode (side-by-side) |
| Session Activity | `session-activity.ts` | Working/waiting/idle status with debounced transitions |
| Session Cost | `session-cost.ts` | Per-session and aggregate cost data (USD, tokens, cache, duration, `contextWindowSize`) via Claude `statusLine` JSON; regex fallback for older CLIs |
| Sidebar Usage | `components/sidebar-usage.ts` | Context-window % indicator (issue #68 Phase 1) — reads `CostInfo.contextWindowSize`, amber/danger thresholds, ARIA `progressbar` |
| Browser Tab | `components/browser-tab/` | 14 focused modules: instance, navigation, viewport, inspect-mode, flow-recording, etc. |
| Confirm Dialog | `components/confirm-dialog.ts` | Promise-based, returns `true`/`false`, optional warning banner via `detail` HTML |
| Close Guard | `close-guard.ts` | Window close guard via IPC round-trip (`app:confirmClose` → check → respond) |

## Close Confirmation System

Three close actions are gated by confirmation dialogs when active sessions exist:
- **Tab close** (X button, middle-click, context menu) — minimal dialog
- **Project removal** (sidebar context menu) — warning banner with status counts
- **Window close** (X / Alt+F4) — warning banner via IPC round-trip

Two preferences: `confirmCloseActive` (default: on), `confirmCloseInactive` (default: off). The `forceClose` flag in `main.ts` is module-scoped and reset on cancel; `before-quit` sets it to bypass during Cmd+Q/menu quit.

## State Persistence

App state (projects, sessions, layout) persists to `~/.vibeyard/state.json` via the main process store. Saves are debounced and flushed on quit. Sessions track `cliSessionId` for CLI session resume. Legacy `claudeSessionId` fields are auto-migrated on load.

Hook scripts in `~/.vibeyard/run/` persist across app restarts — they are **not** cleaned up on exit. Hooks in `~/.claude/settings.json` reference these scripts and must work even outside Vibeyard. Only session-specific runtime files in `/tmp/vibeyard/` are cleaned up.

## Status-line Invocation

Claude Code spawns `statusLine.command` directly without going through cmd.exe/sh. On Windows the command must therefore be `python "<abs path>/statusline.py"`, **not** a `.cmd` wrapper — a `.cmd` path silently fails and no `.cost` files get written. `getStatusLineCommand()` in `hook-status.ts` builds the platform-correct command; `installStatusLine()` writes it into `~/.claude/settings.json`. The renderer's `appState.hasSession()` is the single gate for which `.cost` events are applied — no `knownSessionIds` filter exists in main.

## Platform Checks

Platform detection is centralized in `src/main/platform.ts`. Import `isWin`/`isMac`/`isLinux` (and derived constants `pathSep`, `whichCmd`, `pythonBin`) from there. **Do not** inline `process.platform === 'win32'` or redefine these locally. The three-way managed-path branch in `claude-cli.ts` is the one intentional exception.

## Coding Conventions

- **No UI framework** — vanilla TypeScript with direct DOM manipulation
- **Event emitter pattern** — `AppState` emits events, components subscribe
- **Component architecture** — each component manages its own DOM subtree
- **CSS theming** — use CSS custom properties (variables), never hardcode colors
- **Custom components** — use `custom-select.ts` instead of native `<select>`, use `confirm-dialog.ts` for confirmations, `modal.ts` for form inputs
- **HTML sanitization** — use DOMPurify for any user-generated HTML
- **No unnecessary abstractions** — prefer direct, simple code over premature patterns
- **Test co-location** — tests live next to their source files as `*.test.ts`

## CI/CD

- **CI** (`ci.yml`): Builds and tests on push/PR across macOS, Ubuntu, and Windows (Node v24)
- **Release** (`release.yml`): Manual trigger — version bump, changelog generation, cross-platform electron-builder (code signing + notarization on macOS), npm publish
- **Publish target:** GitHub Releases (elirantutia/vibeyard)
- **Platform artifacts:** `.dmg`/`.zip` (macOS), `.AppImage`/`.deb` (Linux), NSIS installer + portable `.exe` (Windows)

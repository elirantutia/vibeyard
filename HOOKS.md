# Hooks & Session State Map

## 26 Hook Events (7 core + 19 inspector-only)

### Core Hook Events → Session Status

| Hook Event | Session Status | Description |
|---|---|---|
| `SessionStart` | `waiting` | CLI session initialized, waiting for user input |
| `UserPromptSubmit` | `working` | User submitted a prompt, CLI is processing |
| `PostToolUse` | `working` | Tool finished, CLI still processing |
| `PostToolUseFailure` | `working` | Tool failed, CLI still processing (also captures failure details) |
| `Stop` | `completed` | CLI finished responding |
| `StopFailure` | `waiting` | Response stopped with error, back to waiting |
| `PermissionRequest` | `input` | CLI is waiting for user input (permission, plan acceptance, etc.) |

## Session State Machine

```
idle (default/no activity)
  │
  ▼  SessionStart
waiting ◄──── StopFailure
  │
  ▼  UserPromptSubmit
working ◄──── PostToolUse / PostToolUseFailure
  │
  ▼  Stop
completed
  │
  ▼  (new prompt or PTY exit)
waiting
```

## Smart Transition Rules (`session-activity.ts`)

1. **Completed is sticky** — `waiting` from Stop/StopFailure won't overwrite `completed`
2. **Interrupt guard** — stale `working` hooks (PostToolUse after Escape) are ignored when `interrupted` flag is set
3. **Interrupt clear** — any non-`working` hook clears the `interrupted` flag

## How It Works End-to-End

1. **Hook installation** (`claude-cli.ts`) — Each hook is a shell command that writes a `.status` file to `/tmp/vibeyard/{sessionId}.status`
2. **File watching** (`hook-status.ts`) — Main process watches `/tmp/vibeyard/` via `fs.watch()` + 2s polling fallback
3. **IPC broadcast** — Main sends `session:hookStatus` to renderer
4. **State update** (`session-activity.ts`) — Renderer applies the transition rules above

## Script Persistence

Hook scripts live in `~/.vibeyard/run/` (`SCRIPT_DIR`) and are **not** cleaned up on app exit. This is intentional — hooks registered in `~/.claude/settings.json` reference these scripts by absolute path, and they must work even when Vibeyard isn't running (e.g. standalone `claude` sessions). Deleting scripts while hooks remain causes "No such file" errors that block all user input in the CLI.

Only session-specific runtime files (`.status`, `.sessionid`, `.cost`, `.toolfailure`) in the temp `STATUS_DIR` (`/tmp/vibeyard/`) are cleaned up on exit. The scripts are small and idempotent; `installHookScripts()` overwrites them on next launch.

## Additional Data Captured by Hooks

| File Extension | Source | Data |
|---|---|---|
| `.status` | Hook commands | Session status string |
| `.sessionid` | `SessionStart` + `UserPromptSubmit` hooks | CLI session ID for resume |
| `.cost` | `statusline.py` (invoked directly via Claude's `statusLine` setting) | Cost, tokens, context window size, model |
| `.toolfailure` | `PostToolUseFailure` + `PostToolUse` (error results) | tool_name, tool_input, error |

## Inspector-Only Hook Events (19 additional)

These hooks write only to the `.events` inspector log — they do NOT change session status.

| Hook Event | Inspector Event Type | Description |
|---|---|---|
| `PreToolUse` | `pre_tool_use` | Before a tool executes |
| `PermissionDenied` | `permission_denied` | Tool call denied by Claude auto permissions |
| `SubagentStart` | `subagent_start` | Subagent spawned |
| `SubagentStop` | `subagent_stop` | Subagent finished |
| `Notification` | `notification` | Claude sent a notification |
| `PreCompact` | `pre_compact` | Context compaction starting |
| `PostCompact` | `post_compact` | Context compaction finished |
| `SessionEnd` | `session_end` | Session terminated |
| `TaskCreated` | `task_created` | Background task created |
| `TaskCompleted` | `task_completed` | Background task finished |
| `WorktreeCreate` | `worktree_create` | Git worktree created |
| `WorktreeRemove` | `worktree_remove` | Git worktree removed |
| `CwdChanged` | `cwd_changed` | Working directory changed |
| `FileChanged` | `file_changed` | File modification detected |
| `ConfigChange` | `config_change` | Configuration changed |
| `Elicitation` | `elicitation` | MCP server requests user input |
| `ElicitationResult` | `elicitation_result` | User answered elicitation |
| `InstructionsLoaded` | `instructions_loaded` | CLAUDE.md / instructions loaded |
| `TeammateIdle` | `teammate_idle` | Teammate agent became idle |

## Validation (`settings-guard.ts`)

On each PTY creation, the app validates the 7 core hooks are installed and the statusLine is configured. Returns `'missing'`, `'partial'`, or `'complete'` — shows a warning banner if incomplete. Inspector-only hooks are not validated.

`isVibeyardStatusLine()` recognises the current command (`python "<abs path>/statusline.py"` on Windows; the `.sh` wrapper on Unix) and a legacy regex (`statusline.{sh,cmd,py}` under `vibeyard/` or `.vibeyard/run/`) so upgrades silently replace the old `.cmd` form without surfacing the foreign-statusLine consent dialog.

## Windows-Specific Status-line Note

Claude Code spawns `statusLine.command` directly (no shell). A `.cmd` wrapper therefore silently fails to execute on Windows — Claude logs nothing, no `.cost` files are written, and the cost UI stays empty. Vibeyard installs the python script directly and wires the command as `python "<abs path>/statusline.py"` so the spawn succeeds.

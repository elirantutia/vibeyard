# Hooks & Session State Map

Verified against Claude Code **2.1.327**. The per-event payload schemas below come
from the [hooks reference](https://code.claude.com/docs/en/hooks); every field name
Vibeyard reads is in that reference. An invented field name costs nothing at write
time and renders a blank timeline row forever, so treat this file as the contract
and re-check it against the docs whenever a hook changes.

## 25 Hook Events (9 core + 16 inspector-only)

Installation is **version-gated**: `claude-hook-versions.ts` maps each event to the
CLI version that introduced it, and `getSupportedHookEvents()` drops anything the
installed binary is too old for. An undetectable version installs nothing, so an
unrecognized key can never land in a user's `settings.json`.

### Core Hook Events → Session Status

| Hook Event | Session Status | Description |
|---|---|---|
| `SessionStart` | `waiting` | CLI session initialized, waiting for user input |
| `UserPromptSubmit` | `working` | User submitted a prompt, CLI is processing |
| `PostToolUse` | `working` | Tool finished **successfully**, CLI still processing |
| `PostToolUseFailure` | `working` | Tool failed, CLI still processing (also captures failure details) |
| `Stop` | `completed` *or* `working` | See [Stop resolution](#stop-resolution) — a Stop is not always a completion |
| `StopFailure` | `waiting` | Response stopped with an API error, back to waiting |
| `PermissionRequest` | `input` | CLI is waiting for user input (permission, plan acceptance, etc.) |
| `Elicitation` | `input` | An MCP server opened a form or URL prompt; the turn waits on the user |
| `ElicitationResult` | `working` | The user answered the elicitation; the tool call resumes |
| `PreToolUse` (matcher `AskUserQuestion\|ExitPlanMode`) | `input` | See [Tools that always wait on the user](#tools-that-always-wait-on-the-user) |

`PostToolUse` fires **only on success**; a tool that ran and failed fires
`PostToolUseFailure` instead. Tool calls rejected before execution — unknown tool,
schema/tool-specific validation failure, permission denial — fire neither.

`UserPromptSubmit` does not mean the user typed something. It also fires on
turns Claude Code starts itself: a `/loop` or cron firing, a background subagent
reporting back, a message from another session. All of them correctly flip the
session to `working`; the inspector labels the row "Prompt" rather than "User
prompt" for that reason.

Since 2.1.319 `PostToolUse` also runs (10s budget) on a tool that finishes after
a Ctrl+Enter message interrupted the turn. Its stale `working` is swallowed by
the same interrupt latch as below.

`PostToolUseFailure`'s status writer is `statusCmd`, a plain `sh -c echo` that
cannot read stdin, so it writes `working` even for an `is_interrupt` (user-abort)
failure. The renderer's `interrupted` latch (`session-activity.ts`) swallows that.

### Tools that always wait on the user

`AskUserQuestion` and `ExitPlanMode` stop for the user in every permission mode,
but the docs do not promise a `PermissionRequest` for them, and in
`bypassPermissions`/`auto` mode nothing else would flip the session to `input`.
A second `PreToolUse` entry, scoped by `USER_INTERACTION_TOOLS_MATCHER`
(`claude-cli.ts`), writes `PreToolUse:input` with the stdin-free `statusCmd`;
the unmatched `PreToolUse` entry stays inspector-only so ordinary tool calls pay
no status write. When `PermissionRequest` fires too, both write `input`. The
answer arrives as that tool's `PostToolUse`, which flips back to `working`.

Known gap: no hook fires when the user *approves* a permission prompt, so a long
approved tool (a 5-minute Bash) stays `input` until its `PostToolUse`.

## Session State Machine

```
idle (default/no activity)
  │
  ▼  SessionStart
waiting ◄──── StopFailure
  │
  ▼  UserPromptSubmit (typed, /loop, cron, background-agent report, cross-session message)
working ◄──── PostToolUse / PostToolUseFailure / ElicitationResult
  │  ▲
  │  └── input ◄── PermissionRequest / Elicitation / PreToolUse(AskUserQuestion|ExitPlanMode)
  │
  ▼  Stop (with nothing in flight)
completed
  │
  ▼  (new prompt or PTY exit)
waiting
```

## Stop resolution

The main agent fires a top-level `Stop` **every time it pauses to wait on parallel
subagents**, so a naive `Stop → completed` produces false completion notifications
mid-orchestration. `stop_status_writer.py` decides which kind of Stop this is.

**Primary signal — `background_tasks` on the Stop payload.** Each entry is
`{id, type, status, description, ...}` with `type` one of `shell`, `subagent`,
`monitor`, `workflow`, `teammate`, `cloud session`, `MCP task`. The session is held
in `working` only for the types that mean *the model itself will produce more
output in this turn*:

| `type` | Holds `working`? | Why |
|---|---|---|
| `subagent`, `teammate`, `workflow` | yes | The turn is blocked on it |
| `shell`, `monitor`, `MCP task`, `cloud session` | no | May wake a *future* turn; the user is free to type now |
| unknown | no | Fail toward `completed` — a missed notification beats a stuck session |

An entry in a terminal `status` (`completed`, `failed`, `cancelled`, …) is not in
flight.

**Background work is shown, not held.** Running entries of the types that die
with the tab, `shell` (a `run_in_background` script), `monitor` and `MCP task`, are
written to `<sid>.background` as `{"tasks": [{type, description}]}` (`description`
falls back to `command`, capped at 120 chars). Every other type is ignored,
mirroring Claude Code's own internal-task filter (verified in the 2.1.330 binary:
`cloud session`, `dream`, `auto-mode scan`, `memory save`), and so is a type added
later: a ring that never clears also blocks close and quit. Claude Code's ambient
artifact watcher ("live updates for artifact …", re-armed on every resume) is
reported as a `monitor` too; it is told apart by shape, since a user's monitor
always carries a `command` (a shell monitor) or a `server` (an MCP monitor) and the
ambient one carries neither. The tab keeps its `completed` status and draws a spinning ring
around the dot, with the list in its tooltip. The file is rewritten only when the
list changes, only from a main-agent Stop that carries `background_tasks`, never
created for an empty list, written atomically (temp file + `os.replace`), and
reset by a `SessionStart` with `source` `clear` (a fresh process finds no file,
since PTY exit deletes it; a resume or fork may keep the process's tasks). The renderer shows it only while the tab is
`completed` (a new turn makes the list stale until its own Stop) and drops it when
the PTY exits. Since that work dies with the PTY, closing such a tab (or quitting,
or `vibeyard-ctl close`) asks for confirmation like a working one. It only refreshes on a `Stop`: it clears when the turn that a
finished script wakes up ends, and a task that ends without waking a turn (killed
from `/tasks`) leaves the ring up until the next Stop. `session_crons` is deliberately **never** consulted: a `/loop` session
always has a pending cron and would otherwise never report completed.

**Only a non-empty array is authoritative.** An empty `background_tasks` is *not*
proof of an idle session: the CLI filters the list on an `isBackgrounded` flag
that Task-spawned subagents acquire only after an optional auto-background timer,
so a spurious Stop fired the instant the main agent pauses on freshly-dispatched
foreground subagents can report `[]` with several still running — the exact false
completion this writer exists to prevent. So an empty (or absent) array falls
through to the registry below, and the two signals are OR'd. Erring this way costs
at most a late notification, bounded by the renderer backstop; erring the other
way fires a completion mid-orchestration.

**Fallback — `<sid>.subagents`.** When `background_tasks` is empty or absent, the
writer falls back to a per-session **registry of in-flight agent ids**,
`{"ids": {agent_id: last_seen_ms}}`, that `captureEventCmd` maintains:
`SubagentStart` adds its `agent_id`, `SubagentStop` removes it (only if present),
`PostToolUse` with a registered `agent_id` refreshes its time, and `SessionStart`
clears it unless `source == "compact"` (`startup`/`resume`/`clear`/`fork` all
reset). Each entry ages out on its own after `STOP_STALE_MS` (10 min).

It is a set, not a counter, because the two events stopped pairing up:

- `SubagentStart` also fires when a subagent is **resumed** and **each time an
  in-process teammate handles a new message** — a counter over-counts, delaying
  completion until the stale timeout.
- `SubagentStop` also fires for Claude Code's **own internal agents** (prompt
  suggestions, `/btw`), with an empty `agent_type` and no matching start — a
  counter under-counts, firing a completion mid-orchestration.

Keyed by id, a repeated start is idempotent and an unknown stop is a no-op. A
pre-registry `{n, t}` file is still honoured by the Stop writer so an upgrade
mid-orchestration cannot fire a false completion. The read-modify-write is
unlocked and can race, which is why it is a fallback.

`force_working` keys on **`agent_id` only**, never `agent_type`: `agent_type` is
also set on the *main thread* of a session started with `--agent` (reachable
through a session's extra args), so keying on it would wedge such a session in
`working` until the backstop fired.

**Backstop — `STOP_FALLBACK_MS`** (`session-activity.ts`, 10 min). Whenever a Stop
resolves to `working`, the renderer arms a timer that forces `completed` if the
session then goes silent. Both hook branches can be wrong — a hung `subagent` entry
that never leaves the registry has no timestamp to age it out — so this is the only
guarantee of eventual completion. Any later hook event cancels it.

## Smart Transition Rules (`session-activity.ts`)

1. **Completed is sticky** — `waiting` from Stop/StopFailure won't overwrite `completed`
2. **Interrupt guard** — stale `working` hooks (PostToolUse after Escape) are ignored when the `interrupted` flag is set
3. **Interrupt clear** — any non-`working` hook clears the `interrupted` flag

## How It Works End-to-End

1. **Hook installation** (`claude-cli.ts`) — each event gets a status writer, and
   `SessionStart`/`UserPromptSubmit` also get a session-id capture,
   `PostToolUseFailure` a failure capture, and every event an inspector event
   capture. Commands carry the `# vibeyard-hook` marker so reinstallation is
   idempotent and never touches a user's own hooks.
2. **File watching** (`hook-status.ts`) — the main process watches `STATUS_DIR`
   (`<tmpdir>/vibeyard`) via `fs.watch()` plus a 2s polling fallback.
3. **IPC broadcast** — main sends `session:hookStatus`, `session:costData`,
   `session:sessionName`, `session:toolFailure`, `session:inspectorEvents`, …
4. **State update** (`session-activity.ts`) — the renderer applies the rules above.

## Files Written into STATUS_DIR

| File Extension | Source | Data |
|---|---|---|
| `.status` | Status-writer hooks | `"<HookEvent>:<status>"` |
| `.sessionid` | `SessionStart` + `UserPromptSubmit` hooks, and the statusLine | CLI session ID, for resume |
| `.cost` | `statusline.py` (via the `statusLine` setting) | Cost, tokens, context window, model, and `rate_limits` when Claude sends them |
| `.name` | `statusline.py` | `session_name` for tab auto-titling |
| `.toolfailure` | `PostToolUseFailure`, plus a token-capped `Read` (see below) | `tool_name`, `tool_input`, `error` |
| `.events` | Every event's capture script | JSONL inspector timeline |
| `.subagents` | `SubagentStart`/`SubagentStop`/`PostToolUse`/`SessionStart` | `{ids: {agent_id: ms}}` in-flight registry (Stop fallback only; never forwarded to the renderer) |
| `.background` | `Stop`/`SessionStart` | `{tasks: [{type, description}]}` work outliving the turn → `session:backgroundTasks` → tab ring |

### The token-capped `Read` case

An oversized `Read` is no longer an error. Claude Code truncates it and returns a
**successful** `PostToolUse` whose `tool_response.file.truncatedByTokenCap` is
`true`, so the old `file content (N tokens) exceeds maximum allowed tokens` text no
longer exists. The `PostToolUse` script detects that one structured flag — scoped
to `tool_name == "Read"`, so it does no IO for any other tool — and writes a small
synthetic `.toolfailure` tagged with `TOKEN_TRUNCATION_SENTINEL`
(`shared/constants.ts`), which `large-file-detector.ts` keys on — shared by the
Python emitter and the TS detector so the two cannot drift.

`TOKEN_TRUNCATION_KEY` (the payload key, owned by Claude Code) is a *separate*
constant from `TOKEN_TRUNCATION_SENTINEL` (our message prefix, owned by us). One
constant doing both jobs meant rewording the message silently broke the payload
lookup, with every test still green because both sides moved together.

## Inspector-Only Hook Events (16 additional)

These write only to the `.events` log — they do NOT change session status.

| Hook Event | Inspector Event Type | Description |
|---|---|---|
| `PreToolUse` | `pre_tool_use` | Before a tool executes (plus the matcher-scoped `input` writer above) |
| `PermissionDenied` | `permission_denied` | Tool call denied by Claude auto permissions |
| `SubagentStart` | `subagent_start` | Subagent spawned |
| `SubagentStop` | `subagent_stop` | Subagent finished |
| `Notification` | `notification` | Claude sent a notification |
| `PreCompact` | `pre_compact` | Context compaction starting |
| `PostCompact` | `post_compact` | Context compaction finished |
| `SessionEnd` | `session_end` | Session terminated |
| `TaskCreated` | `task_created` | Background task created |
| `TaskCompleted` | `task_completed` | Background task finished |
| `WorktreeRemove` | `worktree_remove` | Git worktree removed |
| `CwdChanged` | `cwd_changed` | Working directory changed |
| `FileChanged` | `file_changed` | Watched file modified on disk |
| `ConfigChange` | `config_change` | Configuration changed |
| `InstructionsLoaded` | `instructions_loaded` | CLAUDE.md / rules loaded |
| `TeammateIdle` | `teammate_idle` | Teammate agent became idle |

`SessionEnd` carries an explicit `timeout: 5`. SessionEnd hooks share a 1.5s budget
by default — tight enough for a cold Python start to miss — and Claude Code raises
the budget to the highest configured per-hook timeout. It is a ceiling, not a wait.

### Events deliberately NOT installed

| Event | Why not |
|---|---|
| `WorktreeCreate` | A *path-replacement* hook: configuring it replaces Claude Code's own `git worktree` behavior, and the hook must create the worktree and print its path. An observer hook breaks worktree creation (#110). |
| `UserPromptExpansion` | Same class — its stdout can rewrite the user's prompt. |
| `MessageDisplay` | Fires once per assistant message with a 10s timeout. Each hook spawns a Python interpreter, so this roughly doubles hook overhead for data already on `Stop`'s `last_assistant_message`. |
| `Setup` | Runs at CLI setup, outside a session, so `CLAUDE_IDE_SESSION_ID` is unset and every script exits immediately. |
| `PostToolBatch` | Duplicates the per-tool events and would double-count in `getToolStats`. |
| `DirectoryAdded` | Cheap but near-zero value today; revisit if `/add-dir` becomes user-visible. |
| `PreModelSwitch` | Same class as `UserPromptExpansion`: it runs before a model switch and can block it, so a cold Python start would delay every `/model`. |
| `PostModelSwitch` | The status line already reports the model on the next render; nothing reads a timeline row for it. |

## Behavior worth knowing (2.1.327)

- **Idle compaction.** A 200K+ token conversation left idle ~54 minutes is
  compacted in the background, firing `PreCompact` → `SessionStart`
  (`source: "compact"`) → `PostCompact` with nobody at the keyboard. The sticky
  `completed` rule keeps the `SessionStart:waiting` from clearing a completed
  badge, and the registry is not reset on `compact`.
- **`SessionStart.source`** gained `"fork"` (`--fork-session`, `/fork`, `/branch`,
  moving a conversation to the background). It resets the registry like a new
  session.
- **`SessionEnd.reason`** no longer sends `bypass_permissions_disabled` (removed
  in 2.1.234). Nothing here matched on it.
- **Nested `claude` processes** started from a tab's Bash tool, hooks or scripts
  inherit `CLAUDE_IDE_SESSION_ID`, so their `SessionStart`/`UserPromptSubmit`
  write into the parent tab's `.status` and `.sessionid`. Unverified in practice;
  no guard yet.

## Inspector Payload Fields

`INSPECTOR_FIELDS` in `claude-cli.ts` is the single list of hook-payload fields
copied into an inspector event. A one-line assertion
(`readonly (keyof InspectorEvent)[] = INSPECTOR_FIELDS`) makes a field that isn't
on `InspectorEvent` a **compile error**, so the two can't drift silently the way
`config_key`/`question`/`answer` did. Strings are truncated at 2000 chars so a
long `last_assistant_message` doesn't bloat `.events` on every Stop.

The list is deliberately limited to fields something actually **reads**. There is
no generic payload viewer, so an unread field is written to disk, parsed, sent
over IPC and typed for nothing.

`reason` is intentionally shared across events (SessionEnd and PermissionDenied),
which is safe because the consuming timeline branch is selected by `ev.type`.

Deliberately not copied: `cwd` (a common field on every event, constant per
session — `CwdChanged` uses `new_cwd`/`old_cwd` instead), `requested_schema` /
`properties`, `compact_summary` / `custom_instructions`, and `background_tasks` /
`session_crons` (consumed by `stop_status_writer.py`).

**Watch for nested keys when reading the docs.** The Elicitation example contains
`requested_schema.properties.username.type`, which scans like top-level `type` and
`username` fields. Neither exists — an earlier pass added both and they were dead
on arrival. Elicitation's real discriminator is `mode` (`'form' | 'url'`).

## Validation (`settings-guard.ts`)

On each PTY creation the app validates that the core hooks are installed and the
statusLine is configured, returning `'missing'`, `'partial'`, or `'complete'` and
showing a warning banner if incomplete. Inspector-only hooks are not validated.

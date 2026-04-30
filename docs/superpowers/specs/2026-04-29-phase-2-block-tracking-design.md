# Phase 2 — 5-Hour Rolling-Window Block Tracking

**Issue:** [#68](https://github.com/elirantutia/vibeyard/issues/68) Phase 2
**Date:** 2026-04-29
**Status:** Design approved, ready for implementation plan

## Goal

Extend the Phase 1 sidebar usage widget with a second row showing the
user's current 5-hour Claude usage block: dollars spent so far in the
window and time until the window rolls. No plan-tier configuration, no
progress bar on this row — just the raw numbers users actually need to
judge whether they are about to hit a rate limit.

## Display

The existing `sidebar-usage` widget (Phase 1) gains a second row beneath
the existing context-window bar:

```
▓▓▓▓▓░░ 62%           ← Phase 1: context window (per-session)
$3.47 · resets 2:14    ← Phase 2: 5-hour block (global, all sessions)
```

- The top row is unchanged from Phase 1.
- The bottom row shows `$X.XX · resets H:MM` where `H:MM` is the
  duration until the oldest entry in the window ages out.
- When the rolling window is empty (no Claude usage in the last 5
  hours), the bottom row is hidden but the top row still renders.
- A single `sidebarViews.usageIndicator` preference still controls the
  whole widget — Phase 2 does not introduce a new toggle.

Tooltip on the bottom row: absolute reset timestamp, entry count, and a
short note that this reflects local Claude usage only (multi-machine
usage is not visible).

## Decisions and Rationale

### Q1: Plan-tier discovery — answered: skip the percentage

We do not show "X% of your block used" because Anthropic does not
expose the user's plan tier (Pro / Max-5x / Max-20x / API)
programmatically, and a manual setting in Preferences would be
fragile (users can pick wrong; Anthropic can change limits without
our table updating). Showing the raw dollar amount + countdown gives
users what they need to act ("am I about to be throttled?") without
the maintenance burden. A plan-tier setting can be layered on later
as an additive feature without breaking this design.

### Q2: Data source — answered: scan local JSONL transcripts

The source of truth is `~/.claude/projects/<hash>/*.jsonl`, the same
transcripts Anthropic's CLI writes for every session including
standalone `claude` runs outside Vibeyard. Aggregating only
Vibeyard's in-process `session-cost` data was rejected because it
would silently lie to users who run `claude` in a regular terminal.
A hybrid approach was rejected as premature optimization — JSONL
scans are cheap when results are cached by mtime.

Refresh cadence:

- Recompute on every `session:costData` IPC arrival (usage just
  changed, so the block changed).
- 30-second wall-clock ticker so the countdown stays live and old
  entries roll out of the window without user interaction.
- Full scan at app startup to surface pre-existing usage.

### Q3: Render location — answered: stack inside the existing widget

The block row lives inside the same `sidebar-usage` component as the
context-window bar, not a separate widget. Both are "how much am I
using right now" from the user's perspective, even though one is
per-session and the other is global. One component, one preference,
one CSS module. Splitting can happen later if a user asks.

## Architecture

### Main process

New module `src/main/usage-blocks.ts`:

- **Scan:** walks every `*.jsonl` under `~/.claude/projects/`. For
  each file, reads usage entries (lines containing token / cost
  data) and extracts `{ timestamp, costUSD }`.
- **Cache:** keeps a `Map<filePath, { mtime, entries }>`. On
  recompute, `fs.statSync` each file; if mtime is unchanged, reuse
  the cached entries. Drops cache entries for files that no longer
  exist.
- **Window math:** given the cached entries, filters to those with
  `now - timestamp <= 5h`, sums `costUSD`, and computes
  `resetsAt = oldestInWindow.timestamp + 5h`.
- **API:**
  - `getCurrentBlock(): { usdSpent: number, resetsAt: number, entryCount: number } | null`
    — returns `null` when the window is empty.
  - Event emitter so callers can subscribe to changes.
- **Triggers:** the module exposes `recompute()`. Callers schedule
  it; the module itself does not own timers or hooks.

### IPC

New namespace `window.vibeyard.usage` exposed via the preload
bridge:

- `getBlock(): Promise<BlockInfo | null>` — current snapshot.
- `onBlockChange(cb: (info: BlockInfo | null) => void): () => void`
  — subscribe to recompute events; returns an unsubscribe.

The main-process side wires `usage-blocks.recompute()` to:

- The existing `session:costData` event flow in `hook-status.ts`
  (after forwarding the cost event to the renderer, also call
  `recompute()` and emit a `usage:blockChanged` IPC if the block
  result changed).
- A `setInterval(recompute, 30_000)` started at app ready.
- A one-shot recompute during app startup, after
  `usage-blocks.ts` is initialized.

### Renderer

Extend `src/renderer/sidebar-usage.ts`:

- Subscribe to `window.vibeyard.usage.onBlockChange` in addition to
  the existing `session-cost.onChange` and active-session events.
- Render two rows in a single container; second row is hidden when
  block info is `null`.
- Format helper for the countdown: `formatCountdown(resetsAt: number,
  now: number)` returns `H:MM` (e.g. `2:14`, `0:07`). Edge cases:
  if `resetsAt <= now`, treat as "0:00" briefly until the next
  recompute drops the entry from the window.
- Tooltip: `"$X.XX in current 5h block · resets at HH:MM:SS · N
  entries · local usage only"`.
- The existing `sidebarViews.usageIndicator` preference still gates
  the whole widget; no new pref.

## Data Flow

```
Claude CLI writes JSONL  ─┐
                          │
session:costData IPC ─────┼──> usage-blocks.recompute()
30s ticker ───────────────┤        │
app startup ──────────────┘        ├── reads JSONL (mtime cache)
                                   ├── filters to last 5h
                                   ├── sums cost, finds oldest
                                   └── emits BlockInfo if changed
                                              │
                                              v
                          IPC: usage:blockChanged ──> renderer
                                              │
                                              v
                          sidebar-usage.ts re-renders bottom row
```

## Error Handling

- Malformed JSONL lines are skipped silently (one bad line in a
  long-running session must not blank the indicator).
- Missing or unreadable files are dropped from the cache (not an
  error; happens during session deletion).
- A scan that throws is caught at the `recompute()` boundary; the
  prior `BlockInfo` is preserved and a debug log is written.
  Renderer never receives a partial / corrupt update.

## Testing

`src/main/usage-blocks.test.ts`:

- Rolling-window math: entries inside / outside 5h boundary, exact
  boundary handling, empty input returns `null`.
- mtime cache: file unchanged → cached entries reused (assert no
  re-read); file changed → re-parsed.
- Malformed JSONL: bad line in middle of file is skipped, surrounding
  entries still counted.
- File deletion: removed file dropped from cache on next recompute.
- `resetsAt` computed as `oldestInWindow.timestamp + 5h`.

`src/renderer/sidebar-usage.test.ts` (extend Phase 1 tests):

- Two-row rendering when both context cost and block info are
  present.
- Bottom row hidden when block info is `null`; top row still
  renders.
- Countdown formatting (`H:MM`), zero-pad minutes.
- Tooltip content includes entry count and "local usage only" note.

## Out of Scope

- Multi-machine usage aggregation (would require a server / sync
  layer; documented as a known limitation in the tooltip).
- Plan-tier `%` display (deliberately deferred — see Q1).
- Per-project block breakdowns (the block is global by design).
- Notifications when nearing the block boundary.

## Known Limitations

- Block usage reflects local-machine Claude transcripts only. Users
  who run Claude on multiple machines under the same account will
  see a partial picture. This is surfaced in the tooltip.
- Block math depends on the schema of Claude's JSONL transcripts,
  which is not a public contract. Schema drift is mitigated by
  silent-skip on malformed lines and a tolerant entry parser.

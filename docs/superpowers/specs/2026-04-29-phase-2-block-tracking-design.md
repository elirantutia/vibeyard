# Phase 2 — 5-Hour Rolling-Window Block Tracking

**Issue:** [#68](https://github.com/elirantutia/vibeyard/issues/68) Phase 2
**Phase 1 baseline:** commit `ae87fa9` (`add sidebar context-window
usage indicator and fix windows statusline`)
**Date:** 2026-04-29 (revised after QA review)
**Status:** Design approved, ready for implementation plan

## Goal

Extend the Phase 1 sidebar usage widget with a second row showing the
user's current 5-hour Claude usage block: dollars spent so far in the
window and time until the window rolls. No plan-tier configuration, no
progress bar on this row — just the raw numbers users actually need to
judge whether they are about to hit a rate limit.

## Display

The existing `sidebar-usage` widget (Phase 1, at
`src/renderer/components/sidebar-usage.ts`) gains a second row beneath
the existing context-window bar:

```
▓▓▓▓▓░░ 62%             ← Phase 1: context window (per-session)
$3.47 · resets in 2h14m  ← Phase 2: 5-hour block (global)
```

- The top row is unchanged from Phase 1.
- The bottom row shows `$X.XX · resets in HhMMm` (duration form, not a
  wall-clock time, to avoid the "2:14" / "2:14 PM" ambiguity flagged
  in QA).
- When the rolling window is empty (no Claude usage in the last 5
  hours), the bottom row is hidden but the top row still renders.
- When the whole widget is hidden by Phase 1 rules (no active session,
  no structured cost data, or `sidebarViews.usageIndicator === false`)
  the block row is hidden too — Phase 2 does not introduce an
  independent visibility gate.
- A single `sidebarViews.usageIndicator` preference still controls the
  whole widget — Phase 2 does not introduce a new toggle.

Tooltip on the bottom row: absolute reset timestamp (local time),
entry count, and a short note that this reflects local Claude usage
only (multi-machine usage is not visible).

## Decisions and Rationale

### Q1: Plan-tier discovery — answered: skip the percentage

We do not show "X% of your block used" because Anthropic does not
expose the user's plan tier (Pro / Max-5x / Max-20x / API)
programmatically, and a manual setting in Preferences would be
fragile. Showing the raw dollar amount + countdown gives users what
they need to act ("am I about to be throttled?") without the
maintenance burden. A plan-tier setting can be layered on later as an
additive feature.

### Q2: Data source — answered: scan local JSONL transcripts, compute cost client-side

The source of truth is `~/.claude/projects/<hash>/*.jsonl`. Each
assistant entry contains `timestamp` (ISO8601 UTC), `message.model`,
and `message.usage.{input_tokens, cache_creation_input_tokens,
cache_read_input_tokens, output_tokens}`. **It does not contain a
cost field.** Phase 2 therefore computes cost client-side using a
per-model price table.

The Phase 1 `.cost` files cannot be used as the source of truth: they
live in `os.tmpdir()/vibeyard/` and are cleaned up on app exit (see
`hook-status.ts:cleanupDir`), so they cannot represent usage from
prior sessions or app restarts. JSONL transcripts persist
indefinitely under `~/.claude/projects/` and are the only viable
historical record.

**Pricing schema-drift risk** is acknowledged: prices change when
Anthropic updates them. We mitigate by:

- Centralizing the price table in `src/main/pricing.ts` with a clear
  comment naming the source URL and a "last verified" date.
- For unknown models (model ID not in the table), the entry is
  *skipped* rather than counted as zero, and a debug log records the
  unknown model. This produces an under-report rather than a silent
  $0.00, and makes drift visible during testing.

Refresh cadence:

- Recompute is **debounced** (250 ms trailing-edge) so a burst of
  cost events from concurrent sessions collapses into one scan.
- Triggered on every `session:costData` IPC arrival (usage just
  changed), via an internal listener inside `usage-blocks.ts` — *not*
  by hard-wiring `hook-status.ts` to call into `usage-blocks`. This
  keeps `hook-status.ts` provider-agnostic.
- 30-second wall-clock ticker so the countdown stays live and old
  entries roll out of the window without user interaction. The
  ticker is registered in app-ready and cleared in
  `before-quit`.
- Full scan at app startup to surface pre-existing usage.

### Q3: Render location — answered: stack inside the existing widget

The block row lives inside the same `sidebar-usage` component as the
context-window bar, not a separate widget. One component, one
preference, one CSS module.

## Architecture

### Main process

**New module `src/main/usage-blocks.ts`:**

- **Home directory resolution:** `path.join(os.homedir(), '.claude',
  'projects')`. Works identically on Windows, macOS, and Linux
  because Anthropic's CLI uses the same convention everywhere; no
  branch in `platform.ts` is needed.
- **Performance budget for cold scan:**
  - Skip any file whose `mtime < now - 5h - 5min` (5-min margin
    covers clock skew). These cannot contribute to the current
    window.
  - For files within the window, parse line-by-line and bail on the
    first entry whose timestamp is older than `now - 5h` from the
    *end* of the file (timestamps are monotonic within a transcript).
    In practice this means we read only the trailing portion of long
    transcripts.
  - Target: cold scan completes in < 200ms on a directory with 100
    transcripts totalling 50 MB. Documented in test plan; not
    asserted in tests (timing-flaky).
- **Cache:** `Map<filePath, { mtime, entries }>`. On recompute,
  `fs.statSync` each file; if mtime unchanged, reuse cached
  entries. Drops cache entries for files that no longer exist.
- **Window math:** filter cached entries to `now - timestamp <= 5h`,
  sum cost (computed via pricing table), compute
  `resetsAt = oldestInWindow.timestamp + 5h`.
- **Clock handling:**
  - All timestamps are parsed with `Date.parse(iso)` and stored as
    UTC milliseconds.
  - "Now" is `Date.now()` (UTC ms by definition).
  - Future timestamps (clock skew, NTP jumps) are clamped to `now`
    so they cannot stick in the window forever.
  - DST transitions are irrelevant because we only operate on UTC
    epochs; the renderer's countdown formatter is also DST-agnostic
    (it formats a duration, not a wall-clock).
- **Change detection:** `usdSpent` is rounded to cents (2 decimals)
  before comparing against the previously-emitted value to avoid
  floating-point jitter causing constant re-emits. `resetsAt` is
  compared as integer ms; `entryCount` as integer. An emit fires
  only when at least one of the three rounded values differs.
- **API:**
  - `getCurrentBlock(): { usdSpent: number, resetsAt: number, entryCount: number } | null`
  - Internal event emitter for IPC bridge subscription.
  - `_resetForTesting(): void` — clears cache, stops timers, drops
    listeners. Required because module-level state is held.

**New module `src/main/pricing.ts`:**

- Exports `computeCost(model: string, usage: UsageEntry): number | null`.
- Returns `null` for unknown models (caller skips the entry).
- Single source of truth for per-model `{input, output, cacheRead,
  cacheWrite}` rates per million tokens. Header comment states the
  source URL (Anthropic pricing page) and a "verified on
  YYYY-MM-DD" date so drift is visible in `git blame`.

### Trigger wiring (no `hook-status.ts` changes)

`usage-blocks.ts` registers itself with the existing main-side cost
event flow by **subscribing**, not being called. Concretely: the
IPC handler that forwards `session:costData` to the renderer also
emits an internal Node `EventEmitter` event (e.g.
`costEvents.emit('costData', payload)`) that `usage-blocks.ts`
listens for. This keeps `hook-status.ts` Claude-agnostic. If a
future provider has its own usage record, it can publish to the
same internal bus or wire its own block tracker.

The 30-second ticker and startup scan are registered from
`main.ts` at app-ready. Both are cleared in `before-quit` to
avoid leaks (called out in QA finding N3).

### IPC

New namespace `window.vibeyard.usage`:

- `getBlock(): Promise<BlockInfo | null>` — current snapshot.
- `onBlockChange(cb: (info: BlockInfo | null) => void): () => void`
  — subscribe; returns unsubscribe.

### Renderer

Extend `src/renderer/components/sidebar-usage.ts` (the actual Phase 1
path — corrected from the previous spec revision):

- Subscribe to `window.vibeyard.usage.onBlockChange`.
- Render two rows in a single container.
- Format helper `formatCountdown(resetsAt: number, now: number)`
  returns `"HhMMm"` (e.g. `"2h14m"`, `"0h07m"`). When
  `resetsAt <= now`, render `"0h00m"` until the next recompute drops
  the entry from the window.
- Tooltip: `"$X.XX in current 5h block · resets at HH:MM:SS · N
  entries · local Claude usage only"`.
- The renderer **does not** subscribe to `session-cost.onChange`
  for block updates — only the existing context-window logic uses
  that. Block updates arrive solely via `usage:blockChanged`,
  avoiding the dual-trigger race flagged in QA finding S4.

## Data Flow

```
Claude CLI writes JSONL  ──────────┐
                                   │
session:costData IPC ──> internal cost-event bus ──> usage-blocks.recompute() (debounced 250ms)
30s ticker ────────────────────────┤        │
app startup ───────────────────────┘        ├── stat each JSONL (skip mtime < now-5h-5m)
                                            ├── re-parse only changed files (mtime cache)
                                            ├── compute cost via pricing.ts (skip unknown models)
                                            ├── filter to last 5h, sum, find oldest
                                            └── emit BlockInfo if rounded value changed
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
- Missing or unreadable files are dropped from the cache.
- Unknown model IDs in `pricing.ts` cause that entry to be skipped
  and logged at debug level (under-reports rather than silently
  corrupting the total).
- A scan that throws is caught at the `recompute()` boundary; the
  prior `BlockInfo` is preserved.

## Testing

`src/main/usage-blocks.test.ts`:

- Rolling-window math: entries inside / outside 5h boundary, exact
  boundary handling, empty input returns `null`.
- mtime cache hit / miss; mtime older than (now − 5h − 5min) skipped
  entirely.
- Malformed JSONL: bad line skipped, surrounding entries still
  counted.
- Unknown model ID: entry skipped, debug logged, total under-reports
  but does not throw.
- Future-dated timestamp: clamped to `now`.
- File deletion: removed file dropped from cache on next recompute.
- `resetsAt = oldestInWindow.timestamp + 5h`.
- Change detection: cents-rounded equality suppresses no-op emits.
- `_resetForTesting()` clears cache, timers, listeners.

`src/main/pricing.test.ts`:

- Cost math for at least one model from each family (Sonnet, Opus,
  Haiku) using fixed token counts.
- Unknown model returns `null`.
- Cache-read / cache-write pricing differs from input pricing.

`src/renderer/components/sidebar-usage.test.ts` (extend Phase 1
tests):

- Two-row rendering when both context cost and block info are
  present.
- Bottom row hidden when block info is `null`; top row still
  renders.
- Whole-widget hide rules (Phase 1) still hide both rows.
- Countdown formatting (`HhMMm`), zero-pad minutes,
  `resetsAt <= now` renders `0h00m`.
- Tooltip content includes entry count and "local Claude usage
  only" note.

## Out of Scope

- Multi-machine usage aggregation.
- Plan-tier `%` display.
- Per-project block breakdowns.
- Notifications when nearing the block boundary.
- Non-Claude providers (the design is explicitly Claude-specific;
  other providers can publish to the internal cost-event bus if
  they want their own tracker).

## Known Limitations

- Block usage reflects local-machine Claude transcripts only.
  Surfaced in the tooltip; not repeated in Out of Scope to avoid the
  duplication flagged in QA.
- Block math depends on Claude's JSONL schema and on the Anthropic
  pricing table. Both can drift; mitigations are documented above
  (silent-skip on bad lines, skip-and-log on unknown models, dated
  comment in `pricing.ts`).

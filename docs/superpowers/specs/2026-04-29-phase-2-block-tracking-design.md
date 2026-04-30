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
    window and are dropped without opening.
  - Files within the window are streamed forward line-by-line in
    full. There is no early-bail on the read path: timestamps are
    monotonic within a transcript, but the cache stores *all*
    parsed entries so that the next recompute can re-filter against
    a moving 5h window without re-reading. Subsequent recomputes hit
    the mtime cache and read nothing.
  - The "trailing region" optimization considered earlier was
    rejected (would have required reverse line iteration, which
    Node has no clean primitive for and is fragile with multi-line
    JSONL).
  - Target: cold scan completes in < 200ms on a directory with 100
    transcripts whose mtime is within the 5h window. Not asserted in
    tests (timing-flaky); documented as a budget.
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
  - `getCurrentBlock(): Promise<BlockInfo | null>` where
    `BlockInfo = { usdSpent, resetsAt, entryCount }`. Awaits the
    initial startup scan via a one-shot `ready` promise so a
    pre-ready call from the renderer does not falsely return `null`.
    Subsequent calls resolve immediately from the cache.
  - Internal event emitter for IPC bridge subscription
    (`'block-changed'` event).
  - `_resetForTesting(): void` — clears cache, stops timers, drops
    listeners, resets the `ready` promise. Required because
    module-level state is held.

**New module `src/main/pricing.ts`:**

- Exports `computeCost(model: string, usage: UsageEntry): number | null`.
- Returns `null` for unknown models (caller skips the entry).
- **Model-key strategy:** the table is keyed on Anthropic's family
  aliases as written in the JSONL (verified sample shows
  `"model":"claude-opus-4-7"` — no date suffix). A small
  normalization step strips any `-YYYYMMDD` date suffix and any
  trailing `[1m]`-style variant tag, mapping dated IDs back to the
  alias before lookup. Aliases not in the table return `null` (skip
  + debug log).
- **Cache-write rates:** Anthropic prices 5-minute and 1-hour cache
  writes differently. The JSONL `usage` object exposes both as
  `cache_creation.ephemeral_5m_input_tokens` and
  `cache_creation.ephemeral_1h_input_tokens`. The pricing table
  carries separate `cacheWrite5m` and `cacheWrite1h` rates per
  model; `computeCost` reads both ephemeral fields when present and
  falls back to `cache_creation_input_tokens` × `cacheWrite5m` when
  the breakdown is absent (older transcript schema).
- **Inputs:**
  `{ input_tokens, cache_read_input_tokens, output_tokens,
  cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens },
  cache_creation_input_tokens }` — fields exactly as they appear in
  JSONL.
- Single source of truth for per-model rates. Header comment names
  the Anthropic pricing page URL and a "verified on YYYY-MM-DD" date
  so drift is visible in `git blame`.

### Trigger wiring (one small change to `hook-status.ts`)

QA confirmed there is no pre-existing internal cost-event bus —
`session:costData` is sent directly via `win.webContents.send(...)`
from `hook-status.ts:processFile`. To avoid hard-wiring `hook-status`
to a Claude-specific module, Phase 2 introduces a tiny shared
`src/main/cost-events.ts` containing a single `EventEmitter`
singleton:

```ts
// cost-events.ts
import { EventEmitter } from 'node:events';
export const costEvents = new EventEmitter();
```

`hook-status.ts` is modified in exactly one place: immediately after
the existing `webContents.send('session:costData', payload)` call,
also `costEvents.emit('costData', payload)`. That is the only
change to `hook-status.ts`. The module remains provider-agnostic
because the bus is generic — any future provider's cost pipeline
can publish to the same emitter.

`usage-blocks.ts` subscribes to `costEvents` on initialization. The
30-second ticker and startup scan are registered from `main.ts` at
`app.whenReady`. Both are cleared in `before-quit`.

**Race between `.cost` write and JSONL append:** the statusline
hook writes the `.cost` file before Claude's CLI flushes the
matching line to the JSONL transcript, so a `recompute()` triggered
by `costData` may scan a JSONL that does not yet contain the new
turn. Mitigation: every `costData`-triggered recompute is followed
by a one-shot retry 1.5 seconds later, sufficient for the JSONL
write to land. The 30-second ticker also catches anything missed.
Duplicate-turn protection comes from the mtime cache (a re-read
that produces the same `(timestamp, model, usage)` tuples is a
no-op via cents-rounded change detection).

**Postmortem amendment (2026-04-30):** the mtime cache prevents
re-counting a single file's contents but does **not** catch the
larger source of duplicates — Claude appends prior turns to JSONL
files when sessions resume, so the same logical API call appears
multiple times across (and sometimes within) files. Empirical
measurement showed ~40% of entries in a 5-hour window were
duplicates by `message.id`. Dedup now happens in `computeBlock()`
via a `Set<string>` of seen `message.id` values; entries lacking
an id (older format) fall through unchanged. Without this dedup
the widget over-reports by ~1.6×.

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
- A `costData` event arriving before its JSONL line has been flushed
  is not an error — the 1.5s retry plus the 30s ticker will pick up
  the missing entry on the next pass.

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
- `_resetForTesting()` clears cache, timers, listeners, and resets
  the `ready` promise.
- `getCurrentBlock()` called before startup scan resolves awaits the
  scan rather than returning a premature `null`.
- `costData` event with no matching JSONL line yet (race) does not
  emit a stale block; the 1.5s retry picks up the line and emits.

`src/main/pricing.test.ts`:

- Cost math for at least one model from each family (Sonnet, Opus,
  Haiku) using fixed token counts.
- Unknown model returns `null`.
- Cache-read / cache-write pricing differs from input pricing.
- Dated suffix (`claude-opus-4-7-20260101`) normalizes to alias and
  hits the table.
- 1h vs 5m ephemeral cache rates applied separately when both
  fields present.
- Falls back to aggregate `cache_creation_input_tokens` × 5m rate
  when the per-window breakdown is missing.

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

## Postmortem amendment (2026-04-30): rolling window → fixed-anchor blocks

The original spec defined `resetsAt = oldestInWindow.timestamp + 5h`,
where `oldestInWindow` is the oldest entry whose timestamp falls in
`[now - 5h, now]`. With continuous Claude activity that produced a
"stuck at `0h00m`" countdown indefinitely: the oldest entry in the
last 5h is always ≈ `now − 5h`, so `resetsAt ≈ now`, so
`formatCountdown` returned `"0h00m"` on every tick. Once the original
"first entry" rolled out, the next-oldest entry took its place
within the same minute, never giving the countdown a chance to
"reset" to a fresh ~5h window.

**Fix:** switched `computeBlock()` from rolling window to
fixed-anchor blocks (matching ccusage):

1. Walk all entries chronologically (deduped by `message.id`).
2. The first entry anchors a block: `blockStart = entry.timestamp`,
   `blockEnd = blockStart + 5h`. (An interim "fix" hour-floored the
   anchor to match ccusage's convention. That made the widget read
   ~30 minutes earlier than the Claude web UI in practice — the web
   UI does not hour-floor either. Direct comparison against
   `~/.claude/projects/*.jsonl` showed the unfloored, exact-timestamp
   anchor matches the web UI to the second; the original 4-min
   discrepancy that prompted the hour-flooring attempt was cache
   staleness, fixable with click-to-refresh.)
3. Each subsequent entry whose timestamp `>= blockEnd` opens a new
   block at its own timestamp.
4. The active block is the latest one. If `now >= activeBlock.end`,
   no entry has arrived to start a successor yet — return `null`
   (widget hides bottom row until activity resumes).

Behavioural difference: with continuous use, the countdown now
jumps back to ~5h at each block boundary instead of hovering near
zero. Expired-with-no-followup is the only path that reports
`null`; previously the widget reported a phantom block whose
`resetsAt` was perpetually in the past. The renderer-side
`formatCountdown` clamp (`max(0, resetsAt - now)`) is retained as a
safety net but is no longer the load-bearing piece of the
"countdown reaches zero" UX.

Tests in `src/main/usage-blocks.test.ts` were unaffected — the
existing assertions on `usdSpent`, `entryCount`, and (where
checked) `resetsAt` hold under both semantics for the inputs used,
because each test's first entry happens to be the active-block
anchor.

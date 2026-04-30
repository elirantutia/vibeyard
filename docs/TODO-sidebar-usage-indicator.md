# TODO: Sidebar Usage Indicator (issue #68)

Tracks the persistent session-usage indicator in the sidebar requested in
[upstream issue #68](https://github.com/elirantutia/vibeyard/issues/68).

Split into two phases so Phase 1 can ship quickly using existing data, with
Phase 2 layered on later.

---

## Phase 1 — Sidebar widget (context window %)

**Goal:** small, always-visible bar at the bottom of the sidebar showing the
active session's context-window usage. Matches the mockup in #68.

**Data source:** existing `src/renderer/session-cost.ts`
(`CostInfo.totalInputTokens` + `cacheReadTokens` + `cacheCreationTokens`)
divided by the active model's context-window limit (e.g. 200K for Sonnet,
1M for Opus 1M). No new infrastructure needed.

**Scope:**
- New component `src/renderer/components/sidebar-usage.ts`
- Subscribe to `session-cost.onChange` + `AppState` active-session changes
- Read model name from `CostInfo.model`; map model → context-window limit in a
  small table (extend over time)
- Render: progress bar + percentage label, e.g. `▓▓▓▓▓░░ 62%`
- Tooltip on hover: tokens used / limit, current model
- Hide when no active session or no cost data yet
- Add a sidebarViews toggle in Preferences (`usageIndicator: true` default)
  alongside existing `configSections` / `gitPanel` toggles
- CSS in `src/renderer/styles/` using existing theme variables

**Out of scope for Phase 1:**
- 5-hour rate-limit tracking
- USD spend display (already in Usage Stats modal)
- Per-project aggregation

**Estimated size:** ~1 component file, CSS additions, prefs wiring,
co-located test. Roughly 200-300 LOC.

### Phase 1 — concrete implementation plan

**Files to create:**
- `src/renderer/components/sidebar-usage.ts` — widget component
- `src/renderer/components/sidebar-usage.test.ts` — co-located test

**Files to modify:**
- `src/renderer/state.ts` (~line 47) — add `usageIndicator: true` to the default
  `sidebarViews` object
- `src/renderer/components/preferences-modal.ts` (lines ~69, ~236–256, ~721) —
  add `usageIndicator` to the `sidebarCheckboxes` map, the toggle list, and the
  `setPreference('sidebarViews', …)` save handler
- `src/renderer/components/sidebar.ts` — mount the new widget (above
  `sidebar-footer`), subscribe to `session-cost.onChange` and the relevant
  `appState` active-session events, respect `sidebarViews.usageIndicator`
- `src/renderer/styles/` — new CSS (or append to existing) for the progress
  bar; reuse theme variables
- `index.html` — add `<div id="sidebar-usage">` slot inside the sidebar shell

**Component behavior:**
- Pure-DOM module mirroring the existing `renderCostFooter()` pattern
- Reads active session via `appState.activeSessionId`, then `getCost(sessionId)`
  for `CostInfo.model` + token fields
- Model → context-window limit table:
  - `sonnet` → 200_000
  - `opus` → 200_000 (1M variant detected via suffix `[1m]` → 1_000_000)
  - `haiku` → 200_000
- `used = totalInputTokens + cacheReadTokens + cacheCreationTokens`
- Renders progress bar + percentage label (e.g. `▓▓▓▓▓░░ 62%`)
- Tooltip (`title` attr): `"123,456 / 200,000 tokens · Sonnet 4.6"`
- Hidden when: no active session, no cost data yet, or
  `sidebarViews.usageIndicator === false`

**Theming:**
- All colors via existing CSS variables (`--accent`, `--text-muted`,
  `--bg-secondary`)
- Progress fill turns amber > 70%, red > 90%

**Test coverage:**
- Model → limit mapping (incl. `[1m]` Opus variant)
- Percentage math
- Hide-when-empty behavior
- Uses jsdom; calls `_resetForTesting()` on `session-cost`

**Estimated diff:** ~250 LOC including test.

---

## Phase 2 — 5-hour block tracking (Claude Pro/Max rolling-window quota)

**Goal:** show fraction of the rolling 5-hour usage window consumed,
aggregated across all sessions on the machine. This is what users typically
mean by "how much have I spent this session."

**Approach:** native Vibeyard implementation, *not* an integration with
[ccstatusline](https://github.com/sirmalloc/ccstatusline). Reasons documented
below.

**Why not integrate ccstatusline:**
1. Architectural conflict — Vibeyard already uses Claude's `statusLine` slot
   to emit structured cost JSON parsed by `session-cost.ts`. ccstatusline
   *is* a statusLine. Installing it would break or compete with Vibeyard's
   cost pipeline. Vibeyard already detects competing statuslines via
   `statusline-conflict-modal.ts`.
2. Wrong rendering target — ccstatusline draws inside the xterm pane.
   Issue #68 needs a sidebar DOM widget, so the renderer-side component
   from Phase 1 is required either way.
3. The block-tracking logic is ~50 lines: read Claude's transcripts at
   `~/.claude/projects/<hash>/<sid>.jsonl`, bucket entries into rolling
   5-hour windows. Vibeyard already touches that directory for session
   history; no need to shell out to a third-party binary.

**Data source:** Claude's JSONL transcripts. Walk all session files,
extract usage entries with timestamps, aggregate within the active rolling
5-hour window.

**Scope:**
- New main-process module `src/main/usage-blocks.ts` to scan JSONL files
  and compute current-window usage. Cached, refreshed on a timer or when
  a session emits new cost data.
- IPC handler exposed via `window.vibeyard.stats` (or a new `usage` namespace)
- Renderer reads block data and updates the sidebar widget — same component
  as Phase 1, with a toggle or stacked display (context window % +
  block %)
- Preference for which metric is displayed (or both)

**Open questions for Phase 2:**
- How to discover the user's plan tier (Pro / Max / API) to compute the
  correct block limit? Possibly a manual setting in Preferences with a
  sensible default.
- Whether to surface block resets (countdown to next window) in the tooltip
- Multi-machine usage is not visible from local JSONL — flag this as a
  known limitation

---

## Phase 3 (separate, later) — optional ccstatusline as alternative statusLine provider

If users want a richer in-terminal status line, ccstatusline could be offered
as an opt-in *alternative* to Vibeyard's built-in statusLine — disabling
Vibeyard's structured cost parsing in exchange for ccstatusline's display.
This is unrelated to #68 and only worth doing if there's user demand.

---

## Status

- [x] Phase 1: sidebar widget with context window % — verified working 2026-04-29
- [x] Phase 2: design spec written and QA-reviewed (twice) — 2026-04-30
- [ ] Phase 2: implementation (pricing.ts, usage-blocks.ts, cost-events.ts, widget extension)
- [ ] Phase 3: optional ccstatusline integration (only if requested)

---

## Follow-up tasks (discovered during Phase 1 verification)

### ✅ Fixed: `installStatusLine()` `.cmd` → `python "..."` (2026-04-29)

`STATUSLINE_SCRIPT` now ends in `.py` on Windows and `installStatusLineScript()`
writes the python script directly (no `.cmd` wrapper). New
`getStatusLineCommand()` returns `python "<abs path>"` on Windows, the `.sh`
path on Unix, and is what `installStatusLine()` writes into `settings.json`.
`isVibeyardStatusLine()` compares against `getStatusLineCommand()`; the
legacy regex now matches `statusline.{sh,cmd,py}` under `vibeyard/` or
`.vibeyard/run/` so `.cmd` installs migrate cleanly without showing a
foreign-statusLine dialog.

**Cross-platform:** Linux/macOS still uses `.sh` because the kernel honors
the shebang on direct exec — only Windows had the no-shell problem.

### Pending: re-do Phase 1 commit

Phase 1 ships with several main-process fixes discovered during
verification:

- Removed the `knownSessionIds` gate in `hook-status.ts:handleFileChange`
  (renderer's `appState.hasSession()` is now the single source of truth)
- `startWatching()` now calls `resyncAllSessions()` so existing `.cost`
  files at startup propagate immediately
- Added `contextWindowSize` to `CostInfo` and used it as the
  authoritative limit in the widget (instead of guessing from model
  name, which was wrong for the 1M Opus variant)
- `prettyModel()` passes through pre-formatted display names
- Widget guard rewritten to require `cost.model` (structured data
  marker) instead of `totalInputTokens > 0`, which falsely hid the
  widget for sessions whose only token usage was cache reads

Run `/commit` to land all of the above as a single commit.

### Phase 2 brainstorm — resolved 2026-04-30

All three open questions answered. Full design at
[`docs/superpowers/specs/2026-04-29-phase-2-block-tracking-design.md`](superpowers/specs/2026-04-29-phase-2-block-tracking-design.md)
(commit `def8736`, after two QA-review passes).

1. **Plan-tier discovery:** skipped. Display is raw `$X.XX · resets
   in HhMMm` — no plan-tier setting, no progress bar on the block
   row. Avoids the maintenance burden of a tier table that
   Anthropic could change without notice.
2. **Data source:** local JSONL transcripts at
   `~/.claude/projects/<hash>/*.jsonl`. Cost is computed
   client-side via a new `src/main/pricing.ts` (per-model rate
   table; 5m vs 1h ephemeral cache-write rates split). Phase 1
   `.cost` files were ruled out — they live in `os.tmpdir()/vibeyard/`
   and are wiped on app exit. Refresh cadence: debounced (250ms)
   on internal cost-event bus + 30s wall-clock ticker + startup
   scan. mtime gating skips files older than `now - 5h - 5min`.
3. **Render location:** same `sidebar-usage` widget, second row
   beneath the existing context bar. Single
   `sidebarViews.usageIndicator` preference still controls both.

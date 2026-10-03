# Vibeyard audit status — 2026-10-03

This is the current work queue for a local LLM. It describes the uncommitted working tree. Read the current code and diff before editing. Code and unit-test coverage do not establish behavior in a running or packaged Electron app.

## Next work, in order

1. **Restore the full test gate.** The 2026-10-03 full Vitest run had 79 failures across eight files, 2,271 passes, and one skip. Most failures were older Pi/OMP watcher and provider assertions expecting the previous session layout. Determine whether each failure reflects a stale assertion or a real regression; update the test or implementation accordingly. Then run `npm test`, `npm run build`, `npx tsc -p tsconfig.renderer.json --noEmit`, and `git diff --check`. Do not report the suite green until it is rerun and passes.
2. **Fix Pi/OMP cancellation status (PO-04).** In `src/main/providers/pi-compatible-transcripts.ts`, `stopReason: "aborted"` still maps to `working`. Map terminal cancellation to an idle state consistent with the renderer's interrupt latch. Add a regression test for the transcript update after cancellation, including the next turn.
3. **Bound the fallback status cache (PO-07).** `statusTailCache` in the same file is module-global and has no capacity or expiry. Its entries hold metadata, not transcript text, but closed files with oversized final records can persist. Add a bounded eviction policy and tests for many distinct paths and file changes.
4. **Measure and reduce remaining watcher cost (PO-06).** `pi-compatible-session-watcher.ts` still forces a synchronous listing at registration and polls cached filenames. Per-launch session directories reduce the usual scope, but real main-thread delay, RSS, and watcher-handle counts have not been measured at increasing tab/history sizes. Measure first, then change the cost shown by the measurements without losing ownership or same-timestamp safeguards.
5. **Exercise live integration.** In a built app, test project provider/profile selection, OMP arrow keys, Pi/OMP new/resumed/restored tabs, `/clear`, cancellation, external CLI runs, abnormal exits, and MCP/P2P teardown. Record the CLI version, profile, tab ID, process ID, and outcome. Reproduce the OMP drop workload after the pi-lens uninstall; a prompt-free startup alone does not settle it. See [OMP session drops](OMP_SESSION_DROPS_2026-10-03.md).

For each completed item, record the exact tests and observed runtime result here. Keep unverified runtime behavior marked as unverified.

Copyable starting prompt: “Read `CLAUDE.md`, `docs/AUDIT_STATUS.md`, and the current diff. Start with item 1 only. Classify each failing test as a stale assertion or a real regression, make the smallest corresponding fix, and rerun the full gate. Update this file with exact counts, files changed, and the next unfinished item. Preserve unrelated working-tree changes.”

## Implemented in the working tree; runtime verification remains

| Area | Current implementation |
| --- | --- |
| Restored identity (N-01) | Unknown CLI IDs remain unresolved; known IDs use title-only sync. No timestamp-based identity recovery. |
| MCP connection lifetime (N-02) | Pending connections are owned through disconnect/disposal; deferred-handshake and timeout tests exist in `mcp-client.test.ts`. |
| P2P teardown (N-03) | Host teardown closes the data channel and peer connection; `peer-host.test.ts` covers cleanup. |
| Profile and arguments (PO-01, PO-05, PO-08) | OMP native profile selectors are removed from launch env; quoted extra arguments are parsed; unsupported storage overrides are rejected; launches use exclusive session directories. |
| Pi/OMP ownership (PO-02, PO-03) | Resume registration carries the known CLI ID, and each launch has its own session directory. External processes do not share that launch directory. |
| Project settings and OMP keys | Project Settings exposes provider/profile selection; terminal input adapts arrow keys to ConPTY Win32 mode. |
| OMP exit recovery | Exit metadata includes PID, code, signal, and transcript reason when available. Stale exit markers are rejected; crash history offers Resume when a transcript exists. |

The older A-01–A-13, F-01–F-09, and R-01–R-04 audit items were implemented in this working tree and removed from the active queue. Their current contracts are in [provider contracts](provider-contracts.md), [session lifecycle](session-lifecycle.md), [performance](performance.md), and [security boundaries](security-boundaries.md).

## Last recorded validation

- `npm run build`, renderer `tsc --noEmit`, and `git diff --check` passed on 2026-10-03.
- Five focused exit/recovery suites passed: 145 tests, one skipped.
- The full suite remains red on 2026-10-03: 79 failures across eight files, 2,271 passed, one skipped.
- Fresh `omp --print --no-session --no-title` exited 0 after the OMP pi-lens copy was uninstalled. The intermittent workload and packaged UI were not verified.
- `dist/Vibeyard 0.3.9-dev.exe` was rebuilt on 2026-10-03. It is unsigned; interactive behavior was not verified. Artifact details are in [OMP session drops](OMP_SESSION_DROPS_2026-10-03.md).

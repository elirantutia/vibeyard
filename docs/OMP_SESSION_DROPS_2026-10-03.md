# OMP session drops: pi-lens investigation (2026-10-03)

## Applied mitigation (2026-10-03)

First disabled pi-lens using `omp plugin disable pi-lens`. Then, at the user's request, uninstalled **the OMP copy only** using `omp plugin uninstall pi-lens`. OMP's `plugin list --json` no longer lists pi-lens. Its OMP package directory, `package.json` dependency, and plugin-lock entry are gone. The remaining plugins' versions and enabled states match the pre-uninstall backup. Pi's separate main installation remains present.

The plugin lock before disable is backed up at `C:\Users\Leo\.omp\plugins\omp-plugins.lock.json.backup-20261003-before-pi-lens-disable`. `package.json`, `bun.lock`, and `omp-plugins.lock.json` were also backed up in the same directory with suffix `.backup-20261003-before-pi-lens-uninstall` before removal.

Already running OMP processes may have pi-lens loaded; start a new OMP session to use this mitigation. A live workload and the original intermittent crash have not yet been reproduced after the change, so the longer-term pi-lens transport fix is still unverified. A future reinstall should use the original `pi-lens` package only after compatibility and the stream failure are resolved.

## Vibeyard recovery and diagnostics change (working tree)

- The PTY exit callback now passes the spawned process PID. On the installed OMP `.exe` path, node-pty spawns that executable directly; if a launch instead uses a shell wrapper, the captured PID is the wrapper's PID.
- On OMP exit, the main process logs a bounded metadata record: timestamp, Vibeyard tab ID, PID, exit code, signal, reason, and whether a transcript path was found. It contains no prompt or transcript text.
- Exit-reason lookup now tries the provider's transcript path when the watcher has not resolved one yet. It recognizes a fatal or signal `session_exit` even with exit code 0, while normal `dispose` remains a clean exit. A timestamped exit marker older than the current launch is ignored, so resuming a previously crashed transcript cannot relabel a new clean exit.
- Crashed sessions retain PID/code/signal in history. A crash with no resumable transcript still gets a history entry, but no Resume button. A resumable crash shows a visible Resume button and PID/code/signal in the badge tooltip.

Validation: `npm run build`, renderer `tsc --noEmit`, and `git diff --check` passed; the five focused exit/recovery suites passed with 145 tests and one skipped. A fresh `omp --print --no-session --no-title` process exited 0 with no prompt or model call after about 22 seconds. Its OMP log (`omp.2026-10-03.26076.log`) had no pi-lens reference or fatal entry. This is a startup check, not a reproduction of the user's intermittent workload. The full Vitest suite remains red in this dirty working tree: 79 failures across eight files, primarily older watcher/provider tests expecting the previous session layout; 2,268 tests passed and one skipped. Do not claim a full test gate or live Vibeyard UI verification.

Portable artifact: `dist/Vibeyard 0.3.9-dev.exe` was rebuilt on 2026-10-03. SHA-256: `FEFBD8C770D7023D3F9A141E3187BD015FF00B7AB16AAB1D19A40F974C0E7870`. The prior portable executable was copied to `dist/Vibeyard 0.3.9-dev.before-omp-recovery.exe` first. The packaged `app.asar` contains the new exit record and Resume action. Windows reports the new portable executable as `NotSigned`; the NSIS setup executable was not rebuilt. No interactive packaged-app test was run.

## Finding

**Confirmed:** six OMP processes recorded fatal `unhandled_rejection` session exits between 2026-09-29 and 2026-10-02. Their seven logged unhandled errors all have stack frames in the bundled pi-lens LSP JSON-RPC stream writer. The errors are `EPIPE: broken pipe, write` (three) and `Cannot call write after a stream was destroyed` (four). Two errors came from one process, so the count of affected processes is six, not seven.

**Assessment:** pi-lens is a strong contributor to at least these OMP session drops. The stack proves that its bundled transport attempted the failed write. It does not prove what first closed/destroyed the LSP stream, nor that every reported tab drop has this cause. OMP also records `sighup` exits and normal `dispose` exits; do not count those as pi-lens crashes without separate evidence.

## Evidence from this machine

- OMP log directory: `C:\Users\Leo\.omp\logs`. The affected files are `omp.2026-09-29.2660.log`, `omp.2026-09-29.20920.log`, `omp.2026-09-29.25220.log`, `omp.2026-09-30.26348.log`, `omp.2026-10-01.34444.log`, and `omp.2026-10-02.2028.log`.
- Most recent instance: `omp.2026-10-02.2028.log` records two `Session exit recorded` events with `reason=unhandled_rejection`, `kind=fatal` at 23:14:49+02:00, followed by `Unhandled rejection: Cannot call write after a stream was destroyed` at 23:14:49.264. The stack includes `pi-lens/dist/index.js:58467` and `:56832`.
- The installed pi-lens bundle at `C:\Users\Leo\.omp\plugins\node_modules\pi-lens\dist\index.js` identifies these frames as the `vscode-jsonrpc` writable stream wrapper and message writer. The failing call is `this.stream.write(data, encoding, callback)` after or during a broken LSP pipe. This is bundled code inside pi-lens; it is not evidence of a Vibeyard PTY write.
- pi-lens version is 4.3.0. Its declared peer range for `@earendil-works/pi-tui` is `^0.84.1 || ^0.85.0`; the OMP plugin tree contains 0.87.1. This is a compatibility mismatch, but the logs do not connect it to the stream failure.
- Installed `omp.exe --version` reports 18.4.12 on 2026-10-03. The exact OMP version at the time of every older log is unverified.
- Recent logs also contain `olla/medium` `404 model_not_found` responses. Those are provider request failures and should be investigated separately when they match a user's reported drop time.
- Across the inspected 2026-09-29 through 2026-10-02 logs, `session_exit` entries group as 19 fatal `unhandled_rejection` entries from six processes, 27 `sighup` entries from 27 processes, and 37 normal `dispose` entries from nine processes. One process can record multiple session exits, so entry counts are not drop counts. At least 68 log lines mention `olla` and `model_not_found`; these may repeat one failed request and are not counted as process exits.

## Limits of the correlation

The logs do not identify the calling Vibeyard tab or prove whether the affected OMP processes were launched through Vibeyard or another terminal. This checkout's new per-launch `omp-sessions` directory does not yet exist under the installed Vibeyard user-data directory, so current working-tree session isolation changes cannot be assumed to be running in the installed app. No reproducible live crash was triggered during this read-only investigation.

## Next actions for a local LLM/operator

1. Reproduce the same OMP workload with the current plugin set. Record the OMP PID, exact time, launch source, Vibeyard tab ID if applicable, and whether a `session_exit` is written. Use the new `[omp-session-exit]` main-process record for correlation in a build containing this working-tree change. Collect only metadata and error stack, not prompt/transcript content.
2. Run a comparable OMP session with `omp --no-extensions` (the installed CLI confirms this disables extension discovery). If the crash persists, investigate OMP/core/LSP process shutdown independently. If it disappears, isolate pi-lens from other extensions in a disposable OMP profile and repeat. This comparison is not proof on its own because `--no-extensions` removes every extension.
3. For a pi-lens-specific reproduction, inspect the LSP child process exit/close event and outstanding `connection.sendNotification`/`sendRequest` calls immediately before the failed stream write. Ensure shutdown/pipe errors settle the async operation without an unhandled rejection. Add a regression test for an LSP stream destroyed while an outbound notification is pending.
4. Check pi-lens/OMP peer compatibility and evaluate a compatible pi-lens build or OMP plugin dependency set. Preserve the current plugin-lock backup and other installed packages when testing a repaired release.
5. In a built Vibeyard app, verify that the new `[omp-session-exit]` record and history badge match the OMP PID, log timestamp, and transcript `session_exit`. A prompt-free CLI startup alone does not verify the UI path.

## Pass condition

With a controlled reproduction, the affected OMP session stays alive when the LSP child closes or crashes, no unhandled rejection appears in its OMP log, and other live sessions remain usable. Repeat under the same workload with pi-lens enabled and verify the exact installed version and peer set. Keep ordinary `sighup`, `dispose`, and model 404 events categorized separately.

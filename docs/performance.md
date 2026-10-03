# Performance and resource limits

These behaviours apply to the current source working tree. They have build and automated-test coverage; packaged-app performance has not been measured. See [audit status](AUDIT_STATUS.md) for recorded validation and remaining work.

## File previews and search

The file reader accepts text files up to 8 MiB. It displays a bounded page instead of building a document for every line at once. Use Previous, Next, or raw-view go-to-line to reach another part of the file.

| Surface | Limit | What the user sees |
| --- | --- | --- |
| Text and Markdown preview | Page budget of 2,000 lines or 128 Ki characters | A partial-preview notice and navigation controls. Long lines may be cut short. Rendered Markdown can end inside a block at a page boundary. |
| Find within a file preview | Displayed page only | Matches outside the current page are not searched. Change pages to search another section. |
| Untracked Git diff | 256 KiB and 5,000 split lines | An explanatory message instead of an oversized diff. Files containing NUL bytes receive a binary-file message. |
| Global session search | Best 20 results; indexed text capped at 50 Ki characters per transcript, join separators included | Results search extracted user text, not every byte of a conversation. |

`KiB` means 1,024 bytes. Character budgets use JavaScript string length (UTF-16 code units), not bytes or displayed symbols. These limits are code constants, not Preferences settings.

Sources: [file read boundary](../src/main/ipc-handlers.ts), [preview paging](../src/renderer/file-preview.ts), [file reader](../src/renderer/components/file-reader.ts), [Git diffs](../src/main/git-status.ts), and [transcript index limits](../src/main/providers/transcript-utils.ts).

## Session search work and storage

Editing the search query, closing the palette, starting a newer search in the same window, or destroying that window cancels obsolete work. Discovery checks the abort signal. Gemini discovery stats each transcript, skips files above the indexer's 64 MiB file limit, and extracts the session ID from a bounded 64 KiB header read instead of loading whole transcripts. Workers stop scheduling new indexing when cancelled; already-submitted reads can finish and populate the cache. Concurrent requests share in-flight reads and a four-operation indexing budget. This budget does not describe every filesystem operation in discovery or the rest of the app.

Workers score each transcript immediately and retain compact results. Result snippets and names are copied so short string slices cannot retain whole transcript strings. The text cache holds at most 500 entries and 8 Mi characters in total, counting original and lowercase forms together. These payload budgets are not a measurement of total application heap usage.

The derived disk index lives at:

```text
<Electron userData>/search-index-v2/<provider>/<SHA-256-of-source-path>.json
```

The index contains extracted user text, its working directory and source version metadata. It is local plaintext data; hashed filenames do not encrypt its contents. Source mtime, size and ctime determine reuse. Each record's text is capped at 50 Ki characters, and its serialized JSON must fit within 332 KiB. Records for sources absent from a completed, uncancelled provider discovery/index pass are pruned. A cancelled pass can leave them until a later completed pass.

Disk usage scales with history; there is no fixed aggregate disk quota. Eviction from the in-memory cache does not require reparsing an unchanged transcript when its disk index remains valid. Search still performs discovery and reads index records, so it is not free of filesystem work.

To rebuild the index, close VibeYard and remove only `search-index-v2` from its Electron user-data directory. The next search rebuilds the required entries. This does not delete provider transcripts or the separate `~/.vibeyard/state.json` file. There is currently no in-app cache-clear control. Developers must change the index directory version when extraction semantics change.

Sources: [search coordinator](../src/main/session-deep-search.ts), [disk index](../src/main/session-search-index.ts), [IPC cancellation](../src/main/ipc-handlers.ts), and [palette](../src/renderer/components/session-search-palette.ts).

## Inspector event retention

Hook `.events` files are read in at most 64 KiB of new bytes per turn. Unfinished lines remain buffered, including partial UTF-8 sequences. Backlogs schedule further reads without requiring a new file notification. Individual JSONL records over 64 KiB are skipped through their next newline; malformed complete records are also skipped. The reader resets when the file becomes shorter than its current byte offset.

The renderer keeps the newest events within both a 2,000-event limit and a 2 Mi-character budget per session, measured using serialized JSON length. Individual renderer events over 64 Ki characters are skipped. Oldest events are removed first. The inspector is a bounded recent-history view, not a complete event archive. These retention limits do not rotate the source event file; session cleanup removes its hook files and pending continuation state.

Sources: [event reader](../src/main/bounded-event-reader.ts), [hook lifecycle](../src/main/hook-status.ts), and [inspector state](../src/renderer/session-inspector-state.ts).

## Pi/OMP discovery and remaining costs

Pi/OMP launches use an exclusive session directory for transcript ownership. Live registrations share one filename/generation history per watched directory. Each registration records its generation instead of retaining its own complete filename set. Registration still takes a fresh synchronous listing so pre-existing transcripts remain excluded even on filesystems with coarse timestamps.

During polling, unchanged directory listings are reused. Directory mtime changes and watched rename events invalidate listings; the next scan also refreshes a listing after its 30-second cache lifetime. The two-second poll remains in place. Polling still visits cached filenames and checks directory metadata. Root history is released when no registration uses it.

This removes duplicate per-session snapshots and reduces idle directory enumeration. The per-launch directory and known resume ID address the earlier cross-tab attribution paths in code. Registration scans still run on the main thread, and watcher allocation and runtime resource use have not been measured at scale. **PO-06 remains partially addressed.** See the [audit status](AUDIT_STATUS.md) for the next measurement and validation work.

Source: [Pi-compatible watcher](../src/main/pi-compatible-session-watcher.ts).

## Evidence and open measurement

Automated tests cover repeated search beyond the memory-cache budget, shared indexing/cancellation, growing diff files, split UTF-8 event records, oversized events, navigation within a 200,000-line file, and directory-cache invalidation.

Still needed: live Electron heap/RSS, main-thread delay, frame-time and watcher-handle measurements at increasing history/tab sizes; packaged preview/navigation checks; and sustained terminal-output profiling. Passing unit tests does not establish a speedup percentage or complete the broader Pi/OMP integration audit.

# Security boundaries

The renderer sends privileged work through preload and main-process IPC. Validate project paths, including symlinks, before filesystem access. `statusFilePath()` validates UI session IDs before using them as filenames in the hook-status directory under `os.tmpdir()/vibeyard`.

PTY arguments and environment variables cross a trust boundary. Keep `shell: false`, Windows argument quoting/rejection, and provider-owned environment filtering described in [provider contracts](provider-contracts.md). The embedded webview and Chrome-cookie import handle third-party content and account data; keep browser partitions and permission checks separate from terminal state.

P2P sharing is opt-in. The host chooses read-only or read-write access; read-write gives the peer terminal command execution. A generated 128-bit share key encrypts connection codes and authenticates the data channel. Do not send scrollback, live output or resize frames before host verification. Treat both the key and codes as sensitive and end a share when the user closes it.

Global search writes derived plaintext user text and working directories to `search-index-v2` under Electron user data. Source-path hashes obscure filenames but are not encryption. The index is rebuildable and separate from provider transcripts and the persisted application state. See [performance and resource limits](performance.md) for retention, invalidation and rebuild instructions.

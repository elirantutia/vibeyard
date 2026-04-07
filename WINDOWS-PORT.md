# Windows Port

This document describes all changes made to port Vibeyard from macOS/Linux to Windows.

## Overview

Vibeyard is an Electron app that was originally built for macOS and Linux only. The port adds Windows support by introducing platform-aware branches (`process.platform === 'win32'`) throughout the codebase. All existing Unix/macOS behavior is preserved unchanged.

## Production Code Changes

### 1. `package.json`

- **`copy-assets` script**: Replaced Unix shell commands (`cp`, `rm -rf`, `mkdir -p`, `cp -r`) with `node scripts/copy-assets.js` (cross-platform Node.js script).
- **`postinstall` script**: Replaced `test -f ... && ... || true` (Unix shell) with an inline Node.js one-liner that does the same check cross-platform.
- **`build.win` section**: Added Windows electron-builder target with `nsis` (installer) and `portable` (standalone exe) formats.
- **`build.nsis` section**: Configured the NSIS installer to allow custom install directory.

### 2. `scripts/copy-assets.js` (new file)

Cross-platform Node.js replacement for the Unix shell `copy-assets` command. Uses `fs.copyFileSync`, `fs.mkdirSync`, and a recursive `copyDir` helper to replicate the original behavior of copying renderer assets (HTML, CSS, styles directory, xterm.css, icon, changelog, provider assets) into `dist/renderer/`.

### 3. `src/main/pty-manager.ts`

- **`getFullPath()`**: On Windows, uses `;` as PATH separator (instead of `:`) and adds Windows-specific directories (`AppData/Roaming/npm`, `.local/bin`) instead of Unix ones (`/usr/local/bin`, `/opt/homebrew/bin`). Skips the login shell PATH resolution (`$SHELL -ilc`) which doesn't apply on Windows.
- **`spawnShellPty()`**: Defaults to `process.env.COMSPEC || 'cmd.exe'` on Windows instead of `process.env.SHELL || '/bin/zsh'`.
- **`getPtyCwd()`**: On Windows, returns `null` immediately (Windows doesn't expose process cwd reliably via standard APIs). On Unix, the existing `pgrep`/`lsof` approach is preserved.
- **`getPtyCwdWindows()`**: New function (no-op placeholder) that documents the Windows limitation.

### 4. `src/main/hook-status.ts`

- **`STATUSLINE_SCRIPT`**: Uses `.cmd` extension on Windows, `.sh` on Unix.
- **`installStatusLineScript()`**: On Windows, writes a Python helper script (`statusline.py`) and a `.cmd` wrapper that calls `python statusline.py`. On Unix, the original `#!/bin/sh` inline Python script is preserved. The Python script uses `os.path.join` for paths and `r''` raw strings for Windows backslash paths.
- **`cleanupAll()`**: Now also cleans up `.py`, `.cmd`, and `.sh` files in the status directory. Replaced deprecated `fs.rmdirSync` with `fs.rmSync({ recursive: true })`.

### 5. `src/main/hook-commands.ts` (new file)

Shared module for generating platform-aware hook commands used by all three CLI providers (Claude, Codex, Gemini). Provides:

- **`installHookScripts()`**: On Windows, writes Python helper scripts (`status_writer.py`, `session_id_capture.py`, `tool_failure_capture.py`) to the status directory. No-op on Unix.
- **`statusCmd()`**: Generates a status-writing hook command. Uses `cmd /c "python ..."` on Windows, `sh -c '...'` on Unix.
- **`captureSessionIdCmd()`**: Generates a session ID capture hook command.
- **`captureToolFailureCmd()`**: Generates a tool failure capture hook command.
- **`wrapPythonHookCmd()`**: Wraps arbitrary Python code as a platform-appropriate hook command. On Windows, writes the Python to a `.py` file and calls it via `cmd /c`. On Unix, inlines the Python in `sh -c`.
- **`cleanupHookScripts()`**: Removes all Python helper scripts from the status directory.

### 6. `src/main/providers/resolve-binary.ts`

- **`COMMON_BIN_DIRS`**: On Windows, searches `AppData/Roaming/npm`, `AppData/Local/Programs`, `.local/bin`. On Unix, the original dirs are preserved.
- **`findBinaryInDir()`**: New helper that on Windows tries `.cmd`, `.exe`, `.ps1`, and bare extensions when looking for binaries. On Unix, looks for the bare binary name.
- **`whichBinary()`**: Uses `where` command on Windows, `which` on Unix. Handles `where` returning multiple lines (takes the first).
- **`resolveBinary()` and `validateBinaryExists()`**: Refactored to use `findBinaryInDir()` and `whichBinary()` helpers.

### 7. `src/main/prerequisites.ts`

- **Candidate paths**: On Windows, checks `AppData/Roaming/npm/claude.cmd`, `AppData/Roaming/npm/claude.exe`, `.local/bin/claude`. On Unix, original paths preserved.
- **PATH augmentation**: Uses `;` separator on Windows, `:` on Unix.
- **Binary lookup**: Uses `where claude` on Windows, `which claude` on Unix.

### 8. `src/main/claude-cli.ts`

- **`installHooksOnly()`**: Replaced inline `sh -c` hook commands with calls to shared `hook-commands.ts` module (`mkStatusCmd`, `mkCaptureSessionIdCmd`, `mkCaptureToolFailureCmd`). The complex `captureEventCmd` uses `wrapPythonHookCmd()` with the Python code as a string, generating either a `.py` file + `cmd /c` wrapper (Windows) or inline Python in `sh -c` (Unix).
- Added import for `hook-commands.ts` module.

### 9. `src/main/codex-hooks.ts`

- Same pattern as claude-cli.ts: replaced inline `sh -c` hook commands with shared `hook-commands.ts` calls.
- `statusCmd`, `captureSessionIdCmd`, and `captureEventCmd` now use the shared platform-aware generators.
- Added `installHookScripts()` call at the start of `installCodexHooks()`.

### 10. `src/main/gemini-hooks.ts`

- Same pattern: replaced inline `sh -c` hook commands with shared `hook-commands.ts` calls.
- All three command generators (`statusCmd`, `captureEventCmd`, `captureSessionIdCmd`) now use the shared module.
- Added `installHookScripts()` call at the start of `installGeminiHooks()`.

### 11. `bin/vibeyard.js`

- **Platform detection**: Added `isWin` and `isMac` constants. Removed the hard `process.platform !== 'darwin'` exit — now allows both macOS and Windows, with Linux getting a helpful "download from releases" message.
- **`getAssetName()`**: Returns platform-appropriate asset names (`.zip` for Windows/macOS, `.AppImage` for Linux).
- **`APP_PATH`**: Points to `Vibeyard.exe` on Windows, `Vibeyard.app` on macOS.
- **`extract()`**: Uses PowerShell `Expand-Archive` on Windows, `unzip` on Unix. Skips macOS-specific `xattr` quarantine removal on non-macOS platforms.
- **`launch()`**: Spawns the exe directly on Windows, uses `open` command on macOS.

## Test Changes

14 test files were updated to work cross-platform. The changes follow consistent patterns:

### Path normalization

Added a `n()` helper function to normalize backslashes to forward slashes for cross-platform path comparison:
```typescript
const n = (p: string) => p.replace(/\\/g, '/');
```

Used in mock implementations where test code compares paths against hardcoded forward-slash strings:
```typescript
mockReadFileSync.mockImplementation((p: any) => {
  const content = files[n(String(p))];
  // ...
});
```

### `mockFiles` pattern

For test files using a `mockFiles()` helper, normalized both the lookup keys and the query:
```typescript
function mockFiles(rawFiles: Record<string, string>): void {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFiles)) files[n(k)] = v;
  mockReadFileSync.mockImplementation((p: any) => {
    const content = files[n(String(p))];
    // ...
  });
}
```

### Platform-aware assertions

For values that legitimately differ by platform (PATH separator, binary paths, shell defaults):
```typescript
const isWin = process.platform === 'win32';
expect(env.PATH).toBe(isWin ? '/usr/local/bin;/usr/bin' : '/usr/local/bin:/usr/bin');
```

### `filePath` assertions

Replaced hardcoded forward-slash paths in assertions with `path.join()`:
```typescript
// Before
filePath: '/mock/home/.claude/settings.json'
// After
filePath: path.join('/mock/home', '.claude', 'settings.json')
```

### Hook command mocking

For test files that test hook installation, added a mock for the new `hook-commands.ts` module to prevent it from writing real files during tests:
```typescript
vi.mock('./hook-commands', () => ({
  installHookScripts: vi.fn(),
  statusCmd: vi.fn((e, s, _v, marker) => `echo ${e}:${s} > .status ${marker}`),
  // ...
}));
```

### Files updated

| Test file | Changes |
|-----------|---------|
| `src/main/providers/claude-provider.test.ts` | Platform-aware PATH mock, binary path assertions, `isWin` conditional |
| `src/main/providers/codex-provider.test.ts` | Same pattern as claude-provider |
| `src/main/providers/gemini-provider.test.ts` | Same pattern as claude-provider |
| `src/main/pty-manager.test.ts` | Platform-aware PATH dirs, `getPtyCwd` returns null on Windows, binary path assertions |
| `src/main/prerequisites.test.ts` | No changes needed (passed after production fix) |
| `src/main/hook-status.test.ts` | `STATUS_DIR`/`STATUSLINE_SCRIPT` via `path.join`, `rmSync` mock, path normalization |
| `src/main/claude-cli.test.ts` | `n()` normalizer, `path.join` assertions, `hook-commands` mock, relaxed inline Python assertions |
| `src/main/codex-hooks.test.ts` | `n()` normalizer, `mockFiles` normalization, `hook-commands` mock, `path.join` constants |
| `src/main/gemini-hooks.test.ts` | Same pattern as codex-hooks |
| `src/main/codex-config.test.ts` | `n()` normalizer, `path.join` filePath assertions |
| `src/main/gemini-config.test.ts` | `n()` normalizer in `mockFiles` |
| `src/main/config-watcher.test.ts` | `n()` normalizer for watch callback map keys |
| `src/main/codex-session-watcher.test.ts` | `vi.hoisted` for STATUS_DIR, `path.join` assertions |
| `src/main/fs-utils.test.ts` | Platform-aware `expandUserPath` assertions |

## Known Limitations

- **`getPtyCwd()` on Windows**: Always returns `null`. Windows does not expose process working directories reliably via standard APIs. This means the "detect PTY working directory" feature is unavailable on Windows. The rest of the app functions normally without it.
- **Python dependency**: The hook system requires Python to be installed and available as `python` on PATH. On some Windows installs, `python` may not be on PATH or may be the Microsoft Store stub. Users may need to install Python and ensure it's on PATH.
- **`bin/vibeyard.js` launcher**: The npm global launcher now supports Windows but assumes electron-builder produces a `Vibeyard.exe` at the root of the zip archive. This should be verified against the actual build output.

## How to Build for Windows

```bash
npm install
npm run build
npx electron-builder --win
```

This produces both an NSIS installer and a portable exe in the `dist/` directory.

## How to Test

```bash
npm test
```

All 826 tests pass on Windows. Tests are cross-platform — they also pass on macOS/Linux (all platform-specific assertions use `isWin` conditionals).

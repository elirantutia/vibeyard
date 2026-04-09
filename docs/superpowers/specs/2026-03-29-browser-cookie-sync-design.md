# Browser Cookie Sync Design

**Date:** 2026-03-29
**Feature:** Import system browser cookies into the embedded browser pane
**Approach:** On-demand "Sync" button with persistent Electron session

---

## Overview

The embedded browser pane currently uses an ephemeral in-memory Electron session, so users must re-login to sites (e.g. GitHub) every time Vibeyard restarts. This feature adds a "Sync" button that imports cookies from the user's system browser (Chrome, Arc, Firefox, or Safari) into a persistent Electron session shared by all browser pane webviews.

---

## Architecture

Three layers of changes:

1. **`src/main/browser-cookies.ts`** (new) — all browser detection, SQLite reading, decryption, and cookie injection into `session.fromPartition('persist:vibeyard')`. No new npm dependencies: uses the macOS system `sqlite3` binary, `security` CLI for keychain access, and Node's built-in `crypto` module.

2. **IPC + Preload** — two new channels registered in `src/main/ipc-handlers.ts`, exposed via a new `browser` namespace in `src/preload/preload.ts`:
   - `browser:detectBrowsers` → `{ id: string; name: string }[]`
   - `browser:importCookies(browserId?)` → `{ imported: number; browser: string }` or throws

3. **`src/renderer/components/browser-pane.ts`** (modified) — sync button added to the nav bar; webview gets `partition="persist:vibeyard"`.

---

## Browser Detection & Cookie Reading

Each browser is identified by checking for its cookie file at the known macOS path:

| Browser | Cookie file |
|---------|-------------|
| Chrome | `~/Library/Application Support/Google/Chrome/Default/Cookies` |
| Arc | `~/Library/Application Support/Arc/User Data/Default/Cookies` |
| Firefox | `~/Library/Application Support/Firefox/Profiles/*/cookies.sqlite` (first match) |
| Safari | `~/Library/Cookies/Cookies.binarycookies` |

**SQLite browsers (Chrome, Arc, Firefox):** Copy the file to a temp path first (handles Chrome/Arc file lock while browser is running), then query using the system `sqlite3` binary. Binary BLOB fields (`encrypted_value` for Chrome/Arc) are fetched via SQLite's `hex()` function, returned as a hex string, and converted to a `Buffer` in Node.js.

**Safari:** Read `Cookies.binarycookies` directly with a custom Node.js binary parser. Format: fixed-size header, page offsets, cookie records with fixed-size headers followed by variable-length string data.

---

## Cookie Decryption

**Chrome & Arc** (AES-128-CBC on macOS):
1. Fetch keychain password: `security find-generic-password -s "Chrome Safe Storage" -w` (or `"Arc Safe Storage"`)
2. Derive 16-byte key: `PBKDF2(password, salt="saltysalt", iterations=1003, keylen=16, digest="sha1")` via `crypto.pbkdf2Sync`
3. Decrypt: strip the 3-byte `v10` prefix, apply AES-128-CBC with derived key and IV = 16 space bytes (`\x20` × 16)
4. Strip PKCS#7 padding from the result
5. Cookies with empty `encrypted_value` use the plaintext `value` column directly

**Firefox:** No decryption — `value` column is plaintext.

**Safari:** No decryption — values are plain strings in the binary record.

---

## UI — Sync Button

A sync button is added to the right of the browser nav bar (alongside the existing reload button).

**Interaction flow:**
1. **Click** → `detectBrowsers()`. One browser detected: import immediately. Multiple browsers: show an inline dropdown for the user to pick one.
2. **During import** → button disabled, tooltip shows `"Syncing…"`.
3. **On success** → inline label: `"✓ 342 cookies from Chrome"`, fades out after 3 seconds.
4. **On error** → inline label: `"✗ Failed: <reason>"` in red, fades after 5 seconds.

No modals. Everything stays in the nav bar.

---

## Webview Partition

`createBrowserPane` sets `webview.partition = 'persist:vibeyard'` before the webview is attached to the DOM (partition is immutable after first load). All browser pane webviews across all sessions share this single persistent Chromium session stored in Vibeyard's user data directory.

**Consequences:**
- Imported cookies and manually-set cookies survive Vibeyard restarts
- All project sessions share the same browser login state
- User only needs to sync once per browser login cycle (not per Vibeyard launch)

---

## Error Handling

- **SQLite copy fails** (permissions): surface as `"✗ Failed: cannot read <browser> cookies"`.
- **Keychain access denied** (user declines prompt): surface as `"✗ Failed: keychain access denied"`.
- **`sqlite3` binary not found**: surface as `"✗ Failed: sqlite3 not available"` (extremely unlikely on macOS).
- **Safari parse error**: surface as `"✗ Failed: cannot parse Safari cookies"`.
- Individual bad cookies are skipped silently; only a total failure aborts the import.

---

## Out of Scope

- Windows / Linux support (macOS-only paths and `security` CLI)
- Auto-sync on startup
- Selective cookie import (domain filtering)
- Cookie export back to the system browser

# Browser Cookie Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Sync" button to the embedded browser pane that imports cookies from Chrome, Arc, Firefox, or Safari into a persistent Electron session, so users stay logged in without re-logging in to sites like GitHub.

**Architecture:** A new `src/main/browser-cookies.ts` module handles all browser detection, SQLite reading (via system `sqlite3` binary), decryption (via `security` CLI + Node `crypto`), and Safari binary parsing. Two IPC channels (`browser:detectBrowsers`, `browser:importCookies`) expose this to the renderer via a new `browser` namespace in the preload. The webview is changed to use `partition="persist:vibeyard"` so cookies survive restarts.

**Tech Stack:** Electron `session` API, Node.js `child_process.execSync`, Node.js `crypto` (PBKDF2 + AES-128-CBC), macOS `sqlite3` and `security` CLI binaries, Vitest for tests.

---

## File Map

| File | Change | Responsibility |
|------|--------|---------------|
| `src/main/browser-cookies.ts` | Create | Browser detection, SQLite reading, decryption, Safari parsing, cookie injection |
| `src/main/browser-cookies.test.ts` | Create | Unit tests for all browser-cookies functions |
| `src/main/ipc-handlers.ts` | Modify | Register `browser:detectBrowsers` and `browser:importCookies` handlers |
| `src/preload/preload.ts` | Modify | Add `browser` namespace to `VibeyardApi` |
| `src/renderer/components/browser-pane.ts` | Modify | Set persistent partition on webview; add sync button UI |

---

## Task 1: Set Webview to Persistent Partition

**Files:**
- Modify: `src/renderer/components/browser-pane.ts`

- [ ] **Step 1: Read the current file**

```
Read src/renderer/components/browser-pane.ts
```

- [ ] **Step 2: Add partition before src assignment**

In `createBrowserPane`, add `webview.partition = 'persist:vibeyard'` before `webview.src = url`:

```typescript
  const webview = document.createElement('webview') as Electron.WebviewTag;
  webview.className = 'browser-webview';
  webview.partition = 'persist:vibeyard';
  webview.src = url;
  el.appendChild(webview);
```

- [ ] **Step 3: Build and verify no compile errors**

```bash
npm run build 2>&1 | tail -20
```
Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/browser-pane.ts
git commit -m "feat: set browser pane webview to persistent partition"
```

---

## Task 2: Browser Detection

**Files:**
- Create: `src/main/browser-cookies.ts`
- Create: `src/main/browser-cookies.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/browser-cookies.test.ts`:

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockExistsSync, mockReaddirSync, mockCopyFileSync, mockMkdtempSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => false),
  mockReaddirSync: vi.fn(() => []),
  mockCopyFileSync: vi.fn(),
  mockMkdtempSync: vi.fn(() => '/tmp/vibeyard-cookies-test'),
  mockReadFileSync: vi.fn(),
}));

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readdirSync: mockReaddirSync,
  copyFileSync: mockCopyFileSync,
  mkdtempSync: mockMkdtempSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
  tmpdir: () => '/tmp',
}));

vi.mock('electron', () => ({
  session: {
    fromPartition: vi.fn(() => ({
      cookies: { set: vi.fn().mockResolvedValue(undefined) },
    })),
  },
}));

import { detectBrowsers } from './browser-cookies';

describe('detectBrowsers', () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
  });

  it('returns empty array when no browsers are installed', () => {
    expect(detectBrowsers()).toEqual([]);
  });

  it('detects Chrome when cookie file exists', () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === '/mock/home/Library/Application Support/Google/Chrome/Default/Cookies'
    );
    const browsers = detectBrowsers();
    expect(browsers).toContainEqual({ id: 'chrome', name: 'Chrome' });
  });

  it('detects Arc when cookie file exists', () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === '/mock/home/Library/Application Support/Arc/User Data/Default/Cookies'
    );
    const browsers = detectBrowsers();
    expect(browsers).toContainEqual({ id: 'arc', name: 'Arc' });
  });

  it('detects Safari when binarycookies file exists', () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === '/mock/home/Library/Cookies/Cookies.binarycookies'
    );
    const browsers = detectBrowsers();
    expect(browsers).toContainEqual({ id: 'safari', name: 'Safari' });
  });

  it('detects Firefox when cookies.sqlite exists in a profile directory', () => {
    mockExistsSync.mockImplementation((p: string) => {
      return (
        p === '/mock/home/Library/Application Support/Firefox/Profiles' ||
        p === '/mock/home/Library/Application Support/Firefox/Profiles/abc.default/cookies.sqlite'
      );
    });
    mockReaddirSync.mockReturnValue([
      { name: 'abc.default', isDirectory: () => true },
    ] as any);
    const browsers = detectBrowsers();
    expect(browsers).toContainEqual({ id: 'firefox', name: 'Firefox' });
  });

  it('detects multiple browsers', () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === '/mock/home/Library/Application Support/Google/Chrome/Default/Cookies' ||
      p === '/mock/home/Library/Application Support/Arc/User Data/Default/Cookies'
    );
    const browsers = detectBrowsers();
    expect(browsers).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- browser-cookies 2>&1 | tail -20
```
Expected: FAIL — `browser-cookies` module not found.

- [ ] **Step 3: Create `src/main/browser-cookies.ts` with detection logic**

```typescript
import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { session } from 'electron';

export const PARTITION = 'persist:vibeyard';

export interface BrowserInfo {
  id: string;
  name: string;
}

export interface BrowserCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

function findFirefoxCookiesPath(): string | null {
  const profilesDir = join(homedir(), 'Library/Application Support/Firefox/Profiles');
  if (!existsSync(profilesDir)) return null;
  try {
    const entries = readdirSync(profilesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const cookiesPath = join(profilesDir, entry.name, 'cookies.sqlite');
      if (existsSync(cookiesPath)) return cookiesPath;
    }
  } catch { /* ignore */ }
  return null;
}

const BROWSER_DEFS: Record<string, { name: string; cookiePath: () => string | null }> = {
  chrome: {
    name: 'Chrome',
    cookiePath: () => {
      const p = join(homedir(), 'Library/Application Support/Google/Chrome/Default/Cookies');
      return existsSync(p) ? p : null;
    },
  },
  arc: {
    name: 'Arc',
    cookiePath: () => {
      const p = join(homedir(), 'Library/Application Support/Arc/User Data/Default/Cookies');
      return existsSync(p) ? p : null;
    },
  },
  firefox: {
    name: 'Firefox',
    cookiePath: () => findFirefoxCookiesPath(),
  },
  safari: {
    name: 'Safari',
    cookiePath: () => {
      const p = join(homedir(), 'Library/Cookies/Cookies.binarycookies');
      return existsSync(p) ? p : null;
    },
  },
};

export function detectBrowsers(): BrowserInfo[] {
  return Object.entries(BROWSER_DEFS)
    .filter(([, def]) => def.cookiePath() !== null)
    .map(([id, def]) => ({ id, name: def.name }));
}

// Remaining functions will be added in subsequent tasks.
// Placeholder exports so the file compiles:
export async function importCookies(_browserId?: string): Promise<{ imported: number; browser: string }> {
  throw new Error('not implemented');
}
```

- [ ] **Step 4: Run tests to confirm detection tests pass**

```bash
npm test -- browser-cookies 2>&1 | tail -20
```
Expected: detection tests PASS, others show "not implemented" or skip.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser-cookies.ts src/main/browser-cookies.test.ts
git commit -m "feat: add browser detection for cookie sync"
```

---

## Task 3: SQLite Reader Helper

**Files:**
- Modify: `src/main/browser-cookies.ts`
- Modify: `src/main/browser-cookies.test.ts`

- [ ] **Step 1: Add SQLite reader tests**

Append to the `describe` block in `browser-cookies.test.ts`:

```typescript
import { readSqliteForTest } from './browser-cookies';

describe('readSqlite', () => {
  beforeEach(() => {
    mockMkdtempSync.mockReturnValue('/tmp/vibeyard-cookies-test');
    mockCopyFileSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReset();
  });

  it('copies db to temp dir before querying', () => {
    mockExecSync.mockReturnValue('');
    readSqliteForTest('/some/Cookies', 'SELECT 1');
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      '/some/Cookies',
      '/tmp/vibeyard-cookies-test/cookies.db'
    );
  });

  it('also copies WAL file if it exists', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/some/Cookies-wal');
    mockExecSync.mockReturnValue('');
    readSqliteForTest('/some/Cookies', 'SELECT 1');
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      '/some/Cookies-wal',
      '/tmp/vibeyard-cookies-test/cookies.db-wal'
    );
  });

  it('also copies SHM file if it exists', () => {
    mockExistsSync.mockImplementation((p: string) => p === '/some/Cookies-shm');
    mockExecSync.mockReturnValue('');
    readSqliteForTest('/some/Cookies', 'SELECT 1');
    expect(mockCopyFileSync).toHaveBeenCalledWith(
      '/some/Cookies-shm',
      '/tmp/vibeyard-cookies-test/cookies.db-shm'
    );
  });

  it('parses tab-separated rows from sqlite3 output', () => {
    mockExecSync.mockReturnValue('foo\tbar\nbaz\tqux\n');
    const rows = readSqliteForTest('/some/db', 'SELECT a, b FROM t');
    expect(rows).toEqual([['foo', 'bar'], ['baz', 'qux']]);
  });

  it('returns empty array for empty output', () => {
    mockExecSync.mockReturnValue('');
    const rows = readSqliteForTest('/some/db', 'SELECT 1');
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
npm test -- browser-cookies 2>&1 | grep -E "FAIL|readSqlite"
```
Expected: FAIL — `readSqliteForTest` not exported.

- [ ] **Step 3: Implement `readSqlite` and export it for testing**

Add to `src/main/browser-cookies.ts` (after the `detectBrowsers` function, before the placeholder `importCookies`):

```typescript
export function readSqliteForTest(dbPath: string, query: string): string[][] {
  return readSqlite(dbPath, query);
}

function readSqlite(dbPath: string, query: string): string[][] {
  const tmpDir = mkdtempSync(join(tmpdir(), 'vibeyard-cookies-'));
  const tmpDb = join(tmpDir, 'cookies.db');
  copyFileSync(dbPath, tmpDb);
  for (const ext of ['-wal', '-shm']) {
    const src = dbPath + ext;
    if (existsSync(src)) copyFileSync(src, tmpDb + ext);
  }
  const output = execSync(`sqlite3 -separator '\t' '${tmpDb}' "${query}"`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  }) as string;
  return output
    .trim()
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => l.split('\t'));
}
```

- [ ] **Step 4: Run tests to confirm SQLite tests pass**

```bash
npm test -- browser-cookies 2>&1 | tail -20
```
Expected: all SQLite reader tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser-cookies.ts src/main/browser-cookies.test.ts
git commit -m "feat: add SQLite reader helper for browser cookie sync"
```

---

## Task 4: Chrome/Arc Key Derivation and Decryption

**Files:**
- Modify: `src/main/browser-cookies.ts`
- Modify: `src/main/browser-cookies.test.ts`

- [ ] **Step 1: Add decryption tests**

Append to `browser-cookies.test.ts`:

```typescript
import { createCipheriv, pbkdf2Sync } from 'crypto';
import { getChromiumKeyForTest, decryptChromiumValueForTest } from './browser-cookies';

describe('getChromiumKey', () => {
  it('calls security CLI and derives PBKDF2 key', () => {
    mockExecSync.mockReturnValue('testpassword\n');
    const key = getChromiumKeyForTest('Chrome Safe Storage');
    expect(mockExecSync).toHaveBeenCalledWith(
      'security find-generic-password -s "Chrome Safe Storage" -w',
      { encoding: 'utf8' }
    );
    const expected = pbkdf2Sync('testpassword', 'saltysalt', 1003, 16, 'sha1');
    expect(key).toEqual(expected);
  });
});

describe('decryptChromiumValue', () => {
  it('decrypts a v10-prefixed AES-128-CBC encrypted value', () => {
    const password = 'testpassword';
    const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, 0x20);
    const plaintext = 'my_session_token';
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    const encrypted = Buffer.concat([
      Buffer.from('v10'),
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const result = decryptChromiumValueForTest(encrypted.toString('hex'), key);
    expect(result).toBe(plaintext);
  });

  it('returns empty string for empty encrypted value', () => {
    const key = Buffer.alloc(16);
    expect(decryptChromiumValueForTest('', key)).toBe('');
  });

  it('returns empty string for value shorter than 4 bytes', () => {
    const key = Buffer.alloc(16);
    expect(decryptChromiumValueForTest('aabb', key)).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- browser-cookies 2>&1 | grep -E "FAIL|getChromiumKey|decryptChromium"
```
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement key derivation and decryption**

Add to `src/main/browser-cookies.ts`:

```typescript
export function getChromiumKeyForTest(safeStorageName: string): Buffer {
  return getChromiumKey(safeStorageName);
}

export function decryptChromiumValueForTest(encryptedHex: string, key: Buffer): string {
  return decryptChromiumValue(encryptedHex, key);
}

function getChromiumKey(safeStorageName: string): Buffer {
  const password = (execSync(
    `security find-generic-password -s "${safeStorageName}" -w`,
    { encoding: 'utf8' }
  ) as string).trim();
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

function decryptChromiumValue(encryptedHex: string, key: Buffer): string {
  if (!encryptedHex || encryptedHex.length < 8) return '';
  const encrypted = Buffer.from(encryptedHex, 'hex');
  if (encrypted.length < 4) return '';
  const prefix = encrypted.slice(0, 3).toString('ascii');
  if (prefix !== 'v10') return encrypted.toString('utf8');
  const ciphertext = encrypted.slice(3);
  const iv = Buffer.alloc(16, 0x20);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- browser-cookies 2>&1 | tail -20
```
Expected: all decryption tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser-cookies.ts src/main/browser-cookies.test.ts
git commit -m "feat: add Chrome/Arc key derivation and AES decryption for cookie sync"
```

---

## Task 5: Chromium Cookie Reader

**Files:**
- Modify: `src/main/browser-cookies.ts`
- Modify: `src/main/browser-cookies.test.ts`

- [ ] **Step 1: Add Chromium reader tests**

Append to `browser-cookies.test.ts`:

```typescript
import { readChromiumCookiesForTest } from './browser-cookies';

describe('readChromiumCookies', () => {
  beforeEach(() => {
    mockMkdtempSync.mockReturnValue('/tmp/vibeyard-cookies-test');
    mockCopyFileSync.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  it('reads and maps chromium cookies to BrowserCookie objects', () => {
    // Row format: host_key, name, hex(encrypted_value), value, path, expires_utc, is_secure, is_httponly, samesite
    // Using empty encHex so it falls back to the value column
    mockExecSync
      .mockReturnValueOnce('testpassword\n')  // security call
      .mockReturnValueOnce('.example.com\tsession_id\t\tmy_token\t/\t13355164800000000\t1\t0\t1\n');

    const cookies = readChromiumCookiesForTest('/tmp/Cookies', 'Chrome Safe Storage');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: 'session_id',
      value: 'my_token',
      domain: '.example.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
    });
    expect(cookies[0].url).toBe('https://example.com/');
    // expires_utc 13355164800000000 µs → (13355164800000000/1e6) - 11644473600 = 1710691200
    expect(cookies[0].expirationDate).toBe(1710691200);
  });

  it('treats expires_utc of 0 as session cookie (no expirationDate)', () => {
    mockExecSync
      .mockReturnValueOnce('testpassword\n')
      .mockReturnValueOnce('.example.com\tsid\t\tval\t/\t0\t0\t0\t-1\n');

    const cookies = readChromiumCookiesForTest('/tmp/Cookies', 'Chrome Safe Storage');
    expect(cookies[0].expirationDate).toBeUndefined();
    expect(cookies[0].secure).toBe(false);
    expect(cookies[0].sameSite).toBe('unspecified');
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- browser-cookies 2>&1 | grep -E "FAIL|readChromiumCookies"
```
Expected: FAIL — export not found.

- [ ] **Step 3: Implement `readChromiumCookies`**

Add to `src/main/browser-cookies.ts`:

```typescript
export function readChromiumCookiesForTest(dbPath: string, safeStorageName: string): BrowserCookie[] {
  return readChromiumCookies(dbPath, safeStorageName);
}

const CHROMIUM_SAMESITE: Record<string, BrowserCookie['sameSite']> = {
  '-1': 'unspecified',
  '0': 'no_restriction',
  '1': 'lax',
  '2': 'strict',
};

function chromiumExpiryToUnix(expiresUtc: string): number | undefined {
  const microseconds = parseInt(expiresUtc, 10);
  if (microseconds === 0) return undefined;
  return Math.floor(microseconds / 1_000_000) - 11_644_473_600;
}

function readChromiumCookies(dbPath: string, safeStorageName: string): BrowserCookie[] {
  const key = getChromiumKey(safeStorageName);
  const rows = readSqlite(
    dbPath,
    'SELECT host_key, name, hex(encrypted_value), value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies'
  );
  return rows.map(([host, name, encHex, value, path, expires, isSecure, isHttpOnly, sameSite]) => {
    const decrypted = encHex ? decryptChromiumValue(encHex, key) : value;
    const secure = isSecure === '1';
    const cleanDomain = host.startsWith('.') ? host.slice(1) : host;
    return {
      url: `http${secure ? 's' : ''}://${cleanDomain}${path}`,
      name,
      value: decrypted,
      domain: host,
      path,
      secure,
      httpOnly: isHttpOnly === '1',
      expirationDate: chromiumExpiryToUnix(expires),
      sameSite: CHROMIUM_SAMESITE[sameSite] ?? 'unspecified',
    };
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- browser-cookies 2>&1 | tail -20
```
Expected: all Chromium reader tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser-cookies.ts src/main/browser-cookies.test.ts
git commit -m "feat: add Chromium cookie reader for cookie sync"
```

---

## Task 6: Firefox Cookie Reader

**Files:**
- Modify: `src/main/browser-cookies.ts`
- Modify: `src/main/browser-cookies.test.ts`

- [ ] **Step 1: Add Firefox reader tests**

Append to `browser-cookies.test.ts`:

```typescript
import { readFirefoxCookiesForTest } from './browser-cookies';

describe('readFirefoxCookies', () => {
  beforeEach(() => {
    mockMkdtempSync.mockReturnValue('/tmp/vibeyard-cookies-test');
    mockCopyFileSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReset();
  });

  it('reads Firefox cookies without decryption', () => {
    // Row format: host, name, value, path, expiry, isSecure, isHttpOnly, sameSite
    mockExecSync.mockReturnValue('.firefox.com\tauth\ttoken123\t/\t1710691200\t1\t1\t1\n');
    const cookies = readFirefoxCookiesForTest('/tmp/cookies.sqlite');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: 'auth',
      value: 'token123',
      domain: '.firefox.com',
      path: '/',
      secure: true,
      httpOnly: true,
      expirationDate: 1710691200,
      sameSite: 'lax',
    });
    expect(cookies[0].url).toBe('https://firefox.com/');
  });

  it('maps Firefox sameSite=3 (none) to no_restriction', () => {
    mockExecSync.mockReturnValue('example.com\tc\tv\t/\t0\t0\t0\t3\n');
    const cookies = readFirefoxCookiesForTest('/tmp/cookies.sqlite');
    expect(cookies[0].sameSite).toBe('no_restriction');
    expect(cookies[0].expirationDate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- browser-cookies 2>&1 | grep -E "FAIL|readFirefoxCookies"
```
Expected: FAIL — export not found.

- [ ] **Step 3: Implement `readFirefoxCookies`**

Add to `src/main/browser-cookies.ts`:

```typescript
export function readFirefoxCookiesForTest(dbPath: string): BrowserCookie[] {
  return readFirefoxCookies(dbPath);
}

const FIREFOX_SAMESITE: Record<string, BrowserCookie['sameSite']> = {
  '0': 'unspecified',
  '1': 'lax',
  '2': 'strict',
  '3': 'no_restriction',
};

function readFirefoxCookies(dbPath: string): BrowserCookie[] {
  const rows = readSqlite(
    dbPath,
    'SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies'
  );
  return rows.map(([host, name, value, path, expiry, isSecure, isHttpOnly, sameSite]) => {
    const secure = isSecure === '1';
    const cleanDomain = host.startsWith('.') ? host.slice(1) : host;
    const expirySec = parseInt(expiry, 10);
    return {
      url: `http${secure ? 's' : ''}://${cleanDomain}${path}`,
      name,
      value,
      domain: host,
      path,
      secure,
      httpOnly: isHttpOnly === '1',
      expirationDate: expirySec > 0 ? expirySec : undefined,
      sameSite: FIREFOX_SAMESITE[sameSite] ?? 'unspecified',
    };
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- browser-cookies 2>&1 | tail -20
```
Expected: all Firefox reader tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser-cookies.ts src/main/browser-cookies.test.ts
git commit -m "feat: add Firefox cookie reader for cookie sync"
```

---

## Task 7: Safari Binary Cookie Parser

**Files:**
- Modify: `src/main/browser-cookies.ts`
- Modify: `src/main/browser-cookies.test.ts`

- [ ] **Step 1: Add Safari parser tests**

Append to `browser-cookies.test.ts`:

```typescript
import { parseSafariBinaryCookiesForTest } from './browser-cookies';

// Helper: build a minimal valid .binarycookies buffer with one cookie
function buildSafariBinary({
  domain = 'example.com',
  name = 'session',
  path = '/',
  value = 'abc123',
  secure = false,
  httpOnly = false,
  expiryMac = 750000000,
} = {}): Buffer {
  // String data (null-terminated)
  const domainBuf = Buffer.from(domain + '\0', 'utf8');
  const nameBuf = Buffer.from(name + '\0', 'utf8');
  const pathBuf = Buffer.from(path + '\0', 'utf8');
  const valueBuf = Buffer.from(value + '\0', 'utf8');

  const fixedSize = 56; // cookie record fixed header size
  const domainOff = fixedSize;
  const nameOff = domainOff + domainBuf.length;
  const pathOff = nameOff + nameBuf.length;
  const valueOff = pathOff + pathBuf.length;
  const recordSize = valueOff + valueBuf.length;

  // Cookie record
  const record = Buffer.alloc(recordSize, 0);
  record.writeUInt32LE(recordSize, 0);
  record.writeUInt32LE(0, 4);
  const flags = (secure ? 1 : 0) | (httpOnly ? 4 : 0);
  record.writeUInt32LE(flags, 8);
  record.writeUInt32LE(0, 12);
  record.writeUInt32LE(domainOff, 16);
  record.writeUInt32LE(nameOff, 20);
  record.writeUInt32LE(pathOff, 24);
  record.writeUInt32LE(valueOff, 28);
  // bytes 32-39: unknown (zeroed)
  record.writeDoubleLE(expiryMac, 40);
  record.writeDoubleLE(0, 48);
  domainBuf.copy(record, domainOff);
  nameBuf.copy(record, nameOff);
  pathBuf.copy(record, pathOff);
  valueBuf.copy(record, valueOff);

  // Page: 4 (magic) + 4 (numCookies) + 4 (offset) + record
  const cookieOffsetInPage = 12;
  const page = Buffer.alloc(cookieOffsetInPage + recordSize);
  page.write('100Y', 0, 'ascii');
  page.writeUInt32LE(1, 4);
  page.writeUInt32LE(cookieOffsetInPage, 8);
  record.copy(page, cookieOffsetInPage);

  // File header: magic + numPages + pageSize
  const fileHeader = Buffer.alloc(12);
  fileHeader.write('cook', 0, 'ascii');
  fileHeader.writeUInt32BE(1, 4);
  fileHeader.writeUInt32BE(page.length, 8);

  return Buffer.concat([fileHeader, page]);
}

describe('parseSafariBinaryCookies', () => {
  it('parses a single cookie from binary format', () => {
    const buf = buildSafariBinary({ domain: 'example.com', name: 'session', value: 'tok', path: '/' });
    mockReadFileSync.mockReturnValue(buf);
    const cookies = parseSafariBinaryCookiesForTest('/mock/home/Library/Cookies/Cookies.binarycookies');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      name: 'session',
      value: 'tok',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: 'unspecified',
    });
    // expiryMac 750000000 + 978307200 = 1728307200
    expect(cookies[0].expirationDate).toBe(1728307200);
    expect(cookies[0].url).toBe('http://example.com/');
  });

  it('sets secure flag correctly', () => {
    const buf = buildSafariBinary({ secure: true, httpOnly: true });
    mockReadFileSync.mockReturnValue(buf);
    const cookies = parseSafariBinaryCookiesForTest('/path');
    expect(cookies[0].secure).toBe(true);
    expect(cookies[0].httpOnly).toBe(true);
    expect(cookies[0].url).toMatch(/^https:\/\//);
  });

  it('throws on invalid magic bytes', () => {
    mockReadFileSync.mockReturnValue(Buffer.from('invalid'));
    expect(() => parseSafariBinaryCookiesForTest('/path')).toThrow('Not a valid Safari cookies file');
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- browser-cookies 2>&1 | grep -E "FAIL|parseSafari"
```
Expected: FAIL — export not found.

- [ ] **Step 3: Implement `parseSafariBinaryCookies`**

Add to `src/main/browser-cookies.ts`:

```typescript
export function parseSafariBinaryCookiesForTest(filePath: string): BrowserCookie[] {
  return parseSafariBinaryCookies(filePath);
}

// Seconds between 2001-01-01 (Mac epoch) and 1970-01-01 (Unix epoch)
const MAC_EPOCH_OFFSET = 978307200;

function parseSafariBinaryCookies(filePath: string): BrowserCookie[] {
  const buf = readFileSync(filePath) as Buffer;
  if (buf.slice(0, 4).toString('ascii') !== 'cook') {
    throw new Error('Not a valid Safari cookies file');
  }

  const numPages = buf.readUInt32BE(4);
  const pageSizes: number[] = [];
  for (let i = 0; i < numPages; i++) {
    pageSizes.push(buf.readUInt32BE(8 + i * 4));
  }

  const cookies: BrowserCookie[] = [];
  let offset = 8 + numPages * 4;

  for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {
    const pageStart = offset;
    const numCookies = buf.readUInt32LE(pageStart + 4);
    const cookieOffsets: number[] = [];
    for (let i = 0; i < numCookies; i++) {
      cookieOffsets.push(buf.readUInt32LE(pageStart + 8 + i * 4));
    }

    for (const cookieOffset of cookieOffsets) {
      const recStart = pageStart + cookieOffset;
      // Fixed-size cookie record header layout:
      // 0-3:   record size
      // 4-7:   unknown
      // 8-11:  flags (bit 0 = secure, bit 2 = httpOnly)
      // 12-15: unknown
      // 16-19: domain offset from recStart
      // 20-23: name offset from recStart
      // 24-27: path offset from recStart
      // 28-31: value offset from recStart
      // 32-39: unknown (8 bytes)
      // 40-47: expiry (float64 LE, Mac absolute time in seconds)
      // 48-55: creation (float64 LE)
      // 56+:   null-terminated string data
      const flags = buf.readUInt32LE(recStart + 8);
      const secure = Boolean(flags & 1);
      const httpOnly = Boolean(flags & 4);
      const domainOff = buf.readUInt32LE(recStart + 16);
      const nameOff = buf.readUInt32LE(recStart + 20);
      const pathOff = buf.readUInt32LE(recStart + 24);
      const valueOff = buf.readUInt32LE(recStart + 28);
      const expiryMac = buf.readDoubleLE(recStart + 40);
      const expiryUnix = expiryMac > 0 ? Math.floor(expiryMac + MAC_EPOCH_OFFSET) : undefined;

      const readStr = (off: number): string => {
        const start = recStart + off;
        let end = start;
        while (end < buf.length && buf[end] !== 0) end++;
        return buf.slice(start, end).toString('utf8');
      };

      const domain = readStr(domainOff);
      const name = readStr(nameOff);
      const path = readStr(pathOff) || '/';
      const value = readStr(valueOff);

      if (!domain || !name) continue;

      const cleanDomain = domain.startsWith('.') ? domain.slice(1) : domain;
      cookies.push({
        url: `http${secure ? 's' : ''}://${cleanDomain}${path}`,
        name,
        value,
        domain,
        path,
        secure,
        httpOnly,
        expirationDate: expiryUnix,
        sameSite: 'unspecified',
      });
    }

    offset += pageSizes[pageIdx];
  }

  return cookies;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- browser-cookies 2>&1 | tail -20
```
Expected: all Safari parser tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/browser-cookies.ts src/main/browser-cookies.test.ts
git commit -m "feat: add Safari binary cookie parser for cookie sync"
```

---

## Task 8: `importCookies()` Orchestrator

**Files:**
- Modify: `src/main/browser-cookies.ts`
- Modify: `src/main/browser-cookies.test.ts`

- [ ] **Step 1: Add orchestrator tests**

Append to `browser-cookies.test.ts`:

```typescript
import { session } from 'electron';
import { importCookies } from './browser-cookies';

describe('importCookies', () => {
  let mockSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSet = vi.fn().mockResolvedValue(undefined);
    (session.fromPartition as ReturnType<typeof vi.fn>).mockReturnValue({
      cookies: { set: mockSet },
    });
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockMkdtempSync.mockReturnValue('/tmp/vibeyard-cookies-test');
    mockCopyFileSync.mockReset();
    mockExecSync.mockReset();
  });

  it('throws when no browsers are installed', async () => {
    await expect(importCookies()).rejects.toThrow('No supported browser found');
  });

  it('throws for unknown browserId', async () => {
    await expect(importCookies('netscape')).rejects.toThrow('Unknown browser: netscape');
  });

  it('throws when the specified browser cookie file is missing', async () => {
    // arc is in BROWSER_DEFS but its cookie file does not exist
    await expect(importCookies('arc')).rejects.toThrow('Arc cookies not found');
  });

  it('imports Firefox cookies and calls session.cookies.set for each', async () => {
    // Make Firefox path exist
    mockExistsSync.mockImplementation((p: string) => {
      return (
        p === '/mock/home/Library/Application Support/Firefox/Profiles' ||
        p === '/mock/home/Library/Application Support/Firefox/Profiles/abc.default/cookies.sqlite'
      );
    });
    mockReaddirSync.mockReturnValue([
      { name: 'abc.default', isDirectory: () => true },
    ] as any);
    // sqlite3 returns two rows
    mockExecSync.mockReturnValue(
      '.example.com\tsid\ttoken\t/\t1710691200\t1\t0\t0\n' +
      '.other.com\tauth\tval\t/\t0\t0\t0\t0\n'
    );

    const result = await importCookies('firefox');
    expect(result).toEqual({ imported: 2, browser: 'Firefox' });
    expect(session.fromPartition).toHaveBeenCalledWith('persist:vibeyard');
    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  it('skips individual cookies that fail to set', async () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === '/mock/home/Library/Application Support/Firefox/Profiles' ||
      p === '/mock/home/Library/Application Support/Firefox/Profiles/abc.default/cookies.sqlite'
    );
    mockReaddirSync.mockReturnValue([
      { name: 'abc.default', isDirectory: () => true },
    ] as any);
    mockExecSync.mockReturnValue('.example.com\tsid\ttoken\t/\t0\t0\t0\t0\n');
    mockSet.mockRejectedValueOnce(new Error('invalid url'));

    const result = await importCookies('firefox');
    expect(result.imported).toBe(0); // skipped due to error
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
npm test -- browser-cookies 2>&1 | grep -E "FAIL|importCookies"
```
Expected: FAIL — `importCookies` throws "not implemented".

- [ ] **Step 3: Replace the placeholder `importCookies` with the real implementation**

Replace the placeholder at the bottom of `src/main/browser-cookies.ts`:

```typescript
export async function importCookies(browserId?: string): Promise<{ imported: number; browser: string }> {
  const browsers = detectBrowsers();
  const targetId = browserId ?? browsers[0]?.id;
  if (!targetId) throw new Error('No supported browser found');

  const def = BROWSER_DEFS[targetId];
  if (!def) throw new Error(`Unknown browser: ${targetId}`);

  const cookiePath = def.cookiePath();
  if (!cookiePath) throw new Error(`${def.name} cookies not found`);

  let cookies: BrowserCookie[];
  switch (targetId) {
    case 'chrome':
      cookies = readChromiumCookies(cookiePath, 'Chrome Safe Storage');
      break;
    case 'arc':
      cookies = readChromiumCookies(cookiePath, 'Arc Safe Storage');
      break;
    case 'firefox':
      cookies = readFirefoxCookies(cookiePath);
      break;
    case 'safari':
      cookies = parseSafariBinaryCookies(cookiePath);
      break;
    default:
      throw new Error(`Unsupported browser: ${targetId}`);
  }

  const ses = session.fromPartition(PARTITION);
  let imported = 0;
  for (const cookie of cookies) {
    try {
      await ses.cookies.set(cookie);
      imported++;
    } catch { /* skip invalid cookies silently */ }
  }
  return { imported, browser: def.name };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- browser-cookies 2>&1 | tail -20
```
Expected: all `importCookies` tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/browser-cookies.ts src/main/browser-cookies.test.ts
git commit -m "feat: implement importCookies orchestrator"
```

---

## Task 9: IPC Handlers and Preload

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/preload/preload.ts`

- [ ] **Step 1: Register IPC handlers**

In `src/main/ipc-handlers.ts`, add the import at the top with the other imports:

```typescript
import { detectBrowsers, importCookies } from './browser-cookies';
```

Then inside `registerIpcHandlers()`, add before the closing brace:

```typescript
  ipcMain.handle('browser:detectBrowsers', () => detectBrowsers());

  ipcMain.handle('browser:importCookies', (_event, browserId?: string) =>
    importCookies(browserId)
  );
```

- [ ] **Step 2: Add the `browser` namespace to the preload**

In `src/preload/preload.ts`, add to the `VibeyardApi` interface (after `mcp`, before `readiness`):

```typescript
  browser: {
    detectBrowsers(): Promise<{ id: string; name: string }[]>;
    importCookies(browserId?: string): Promise<{ imported: number; browser: string }>;
  };
```

And add the implementation to the `api` object (after the `mcp` block):

```typescript
  browser: {
    detectBrowsers: () => ipcRenderer.invoke('browser:detectBrowsers'),
    importCookies: (browserId) => ipcRenderer.invoke('browser:importCookies', browserId),
  },
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```
Expected: clean build.

- [ ] **Step 4: Run tests**

```bash
npm test 2>&1 | tail -10
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts src/preload/preload.ts
git commit -m "feat: register browser IPC handlers and expose preload API"
```

---

## Task 10: Renderer Sync Button UI

**Files:**
- Modify: `src/renderer/components/browser-pane.ts`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Read styles.css to understand existing nav bar styles**

```
Read src/renderer/styles.css — search for .browser-nav
```

- [ ] **Step 2: Add sync button styles**

In `src/renderer/styles.css`, add after the existing `.browser-nav-btn` rules:

```css
.browser-sync-btn {
  font-size: 14px;
  padding: 0 8px;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.7;
  border-radius: 4px;
  margin-left: auto;
}
.browser-sync-btn:hover { opacity: 1; background: rgba(128,128,128,0.15); }
.browser-sync-btn:disabled { opacity: 0.3; cursor: default; }

.browser-sync-feedback {
  font-size: 11px;
  padding: 0 6px;
  white-space: nowrap;
  overflow: hidden;
  max-width: 0;
  opacity: 0;
  transition: max-width 0.2s ease, opacity 0.2s ease;
}
.browser-sync-feedback.visible {
  max-width: 200px;
  opacity: 1;
}
.browser-sync-feedback.error { color: #e05c5c; }

.browser-picker {
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--bg-secondary, #2d2d2d);
  border: 1px solid rgba(128,128,128,0.3);
  border-radius: 6px;
  overflow: hidden;
  z-index: 100;
  min-width: 140px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}
.browser-picker-item {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
  color: inherit;
}
.browser-picker-item:hover { background: rgba(128,128,128,0.15); }
```

- [ ] **Step 3: Add sync button to `createBrowserPane`**

In `src/renderer/components/browser-pane.ts`, update the `BrowserPaneInstance` interface to include the new elements:

```typescript
interface BrowserPaneInstance {
  element: HTMLElement;
  webview: Electron.WebviewTag;
  addressBar: HTMLInputElement;
  backBtn: HTMLButtonElement;
  forwardBtn: HTMLButtonElement;
  syncBtn: HTMLButtonElement;
  syncFeedback: HTMLSpanElement;
}
```

Then in `createBrowserPane`, after the `reloadBtn` block and before `nav.appendChild(backBtn)`:

```typescript
  const syncBtn = document.createElement('button');
  syncBtn.className = 'browser-sync-btn';
  syncBtn.title = 'Sync cookies from browser';
  syncBtn.textContent = '⟳ Sync';

  const syncFeedback = document.createElement('span');
  syncFeedback.className = 'browser-sync-feedback';
```

Update the `nav.appendChild` calls to include the new elements at the end:

```typescript
  nav.appendChild(backBtn);
  nav.appendChild(forwardBtn);
  nav.appendChild(reloadBtn);
  nav.appendChild(addressBar);
  nav.appendChild(syncFeedback);
  nav.appendChild(syncBtn);
```

Update the instance construction:

```typescript
  const instance: BrowserPaneInstance = { element: el, webview, addressBar, backBtn, forwardBtn, syncBtn, syncFeedback };
```

- [ ] **Step 4: Wire up the sync button click handler**

Add this helper function before `createBrowserPane`:

```typescript
function showSyncFeedback(feedback: HTMLSpanElement, message: string, isError: boolean, durationMs: number): void {
  feedback.textContent = message;
  feedback.className = `browser-sync-feedback visible${isError ? ' error' : ''}`;
  setTimeout(() => {
    feedback.className = 'browser-sync-feedback';
  }, durationMs);
}
```

Add the sync button event listener inside `createBrowserPane`, after the `addressBar` focus listener:

```typescript
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.title = 'Syncing…';

    try {
      const browsers = await window.vibeyard.browser.detectBrowsers();
      if (browsers.length === 0) {
        showSyncFeedback(syncFeedback, '✗ No supported browser found', true, 5000);
        return;
      }

      let browserId: string;
      if (browsers.length === 1) {
        browserId = browsers[0].id;
      } else {
        browserId = await pickBrowser(nav, browsers);
        if (!browserId) return; // user dismissed picker
      }

      const { imported, browser } = await window.vibeyard.browser.importCookies(browserId);
      showSyncFeedback(syncFeedback, `✓ ${imported} cookies from ${browser}`, false, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showSyncFeedback(syncFeedback, `✗ Failed: ${msg}`, true, 5000);
    } finally {
      syncBtn.disabled = false;
      syncBtn.title = 'Sync cookies from browser';
    }
  });
```

- [ ] **Step 5: Implement `pickBrowser` helper**

Add before `createBrowserPane`:

```typescript
function pickBrowser(nav: HTMLElement, browsers: { id: string; name: string }[]): Promise<string> {
  return new Promise((resolve) => {
    const picker = document.createElement('div');
    picker.className = 'browser-picker';
    nav.style.position = 'relative';

    for (const b of browsers) {
      const btn = document.createElement('button');
      btn.className = 'browser-picker-item';
      btn.textContent = b.name;
      btn.addEventListener('click', () => {
        picker.remove();
        resolve(b.id);
      });
      picker.appendChild(btn);
    }

    const dismiss = (e: MouseEvent) => {
      if (!picker.contains(e.target as Node)) {
        picker.remove();
        document.removeEventListener('click', dismiss);
        resolve('');
      }
    };

    nav.appendChild(picker);
    // Defer listener so the triggering click doesn't immediately dismiss it
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  });
}
```

- [ ] **Step 6: Build and verify**

```bash
npm run build 2>&1 | tail -20
```
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/browser-pane.ts src/renderer/styles.css
git commit -m "feat: add sync button UI to browser pane for cookie import"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Browser detection (Chrome, Arc, Firefox, Safari)
- ✅ On-demand sync button in nav bar
- ✅ Multi-browser picker when more than one is installed
- ✅ SQLite copy before read (handles Chrome file lock)
- ✅ Chrome/Arc AES-128-CBC decryption via keychain
- ✅ Firefox plaintext read
- ✅ Safari binary parser
- ✅ Persistent webview partition (`persist:vibeyard`)
- ✅ Inline success/error feedback
- ✅ No new npm dependencies

**Type consistency check:**
- `BrowserInfo` used consistently: `{ id: string; name: string }` in all tasks
- `BrowserCookie` used consistently across readers and `importCookies`
- `PARTITION = 'persist:vibeyard'` constant used in `importCookies`
- `readSqliteForTest`, `getChromiumKeyForTest`, etc. are test-only exports following the `*ForTest` naming convention

# Background Music Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a background music toggle button to the tab bar that streams ambient lo-fi radio, with a right-click volume popover and persistent state.

**Architecture:** A new `music-player.ts` renderer module manages a single `HTMLAudioElement`, reacts to `preferences-changed` events, and handles stream retries. The tab bar gets a new music button (left-click toggles, right-click shows volume popover). Two new fields — `musicEnabled` and `musicVolume` — are added to `Preferences` and persist automatically via the existing store mechanism.

**Tech Stack:** Vanilla TypeScript, Web Audio API (`HTMLAudioElement`), Vitest (node environment), SomaFM Groove Salad stream (`https://ice2.somafm.com/groovesalad-256-mp3`).

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/shared/types.ts` | Add `musicEnabled`, `musicVolume` to `Preferences` |
| Modify | `src/renderer/state.ts` | Add defaults for new preference fields |
| Modify | `src/renderer/index.html` | Add `media-src` to CSP; add music button to `#tab-actions` |
| **Create** | `src/renderer/music-player.ts` | Audio lifecycle: play/pause/retry/volume sync |
| **Create** | `src/renderer/music-player.test.ts` | Unit tests for music player logic |
| Modify | `src/renderer/components/tab-bar.ts` | Wire music button click/right-click + volume popover |
| Modify | `src/renderer/styles/tabs.css` | Styles for `.icon-btn.active` and `.music-volume-popover` |
| Modify | `src/renderer/index.ts` | Import and call `initMusicPlayer()` |

---

### Task 1: Extend Preferences type and defaults

**Files:**
- Modify: `src/shared/types.ts:139-155`
- Modify: `src/renderer/state.ts:35-43`

- [ ] **Step 1: Add fields to Preferences interface**

In `src/shared/types.ts`, update the `Preferences` interface (currently lines 139–155):

```typescript
export interface Preferences {
  soundOnSessionWaiting: boolean;
  notificationsDesktop: boolean;
  debugMode: boolean;
  sessionHistoryEnabled: boolean;
  insightsEnabled: boolean;
  autoTitleEnabled: boolean;
  musicEnabled: boolean;
  musicVolume: number;
  statusLineConsent?: 'granted' | 'declined' | null;
  keybindings?: Record<string, string>;
  sidebarViews?: {
    configSections: boolean;
    gitPanel: boolean;
    sessionHistory: boolean;
    costFooter: boolean;
    readinessSection: boolean;
  };
}
```

- [ ] **Step 2: Add defaults in state.ts**

In `src/renderer/state.ts`, update `defaultPreferences` (currently lines 35–43):

```typescript
const defaultPreferences: Preferences = {
  soundOnSessionWaiting: true,
  notificationsDesktop: true,
  debugMode: false,
  sessionHistoryEnabled: true,
  insightsEnabled: true,
  autoTitleEnabled: true,
  musicEnabled: false,
  musicVolume: 60,
  sidebarViews: { configSections: true, gitPanel: true, sessionHistory: true, costFooter: true, readinessSection: true },
};
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts src/renderer/state.ts
git commit -m "feat: add musicEnabled and musicVolume to Preferences"
```

---

### Task 2: Update CSP and add button to HTML

**Files:**
- Modify: `src/renderer/index.html:5` (CSP meta tag)
- Modify: `src/renderer/index.html:37-44` (`#tab-actions` div)

- [ ] **Step 1: Update CSP meta tag**

Replace line 5 of `src/renderer/index.html`:

```html
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self' http: https:; media-src http: https:">
```

- [ ] **Step 2: Add music button to tab-actions**

In `src/renderer/index.html`, add the music button inside `#tab-actions` before `btn-toggle-swarm`:

```html
        <div id="tab-actions">
          <button id="btn-help" class="icon-btn" title="Session Indicators Help (F1)" style="font-size:13px;">?</button>
          <button id="btn-usage-stats" class="icon-btn" title="Usage Stats (Ctrl+Shift+U)" style="font-size:12px;">&#x2261;</button>
          <button id="btn-toggle-terminal" class="icon-btn" title="Toggle Terminal (Ctrl+`)" style="font-size:13px;">&#x2588;</button>
          <button id="btn-add-mcp-inspector" class="icon-btn" title="MCP Inspector" style="font-size:11px;font-weight:600;">MCP</button>
          <button id="btn-music" class="icon-btn" title="Background Music (right-click for volume)" style="font-size:14px;">&#x266A;</button>
          <button id="btn-toggle-swarm" class="icon-btn" title="Toggle Swarm Mode (Ctrl+\)">&#x229E;</button>
          <button id="btn-add-session" class="icon-btn" title="New Session (Ctrl+Shift+N)">+</button>
        </div>
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat: update CSP for media streams and add music button to tab bar"
```

---

### Task 3: Create music-player module (TDD)

**Files:**
- Create: `src/renderer/music-player.test.ts`
- Create: `src/renderer/music-player.ts`

The test environment is **node** (not jsdom), so `HTMLAudioElement` is unavailable. Mock the `Audio` constructor via `vi.stubGlobal`.

- [ ] **Step 1: Write failing tests**

Create `src/renderer/music-player.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock appState before importing music-player
const mockListeners = new Map<string, Set<() => void>>();
const mockPreferences = { musicEnabled: false, musicVolume: 60 };

vi.mock('./state.js', () => ({
  appState: {
    preferences: mockPreferences,
    setPreference: vi.fn((key: string, value: unknown) => {
      (mockPreferences as Record<string, unknown>)[key] = value;
      mockListeners.get('preferences-changed')?.forEach(cb => cb());
    }),
    on: vi.fn((event: string, cb: () => void) => {
      if (!mockListeners.has(event)) mockListeners.set(event, new Set());
      mockListeners.get(event)!.add(cb);
      return () => mockListeners.get(event)?.delete(cb);
    }),
  },
}));

// Mock Audio constructor
const mockAudioInstance = {
  src: '',
  volume: 1,
  loop: false,
  paused: true,
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  addEventListener: vi.fn(),
};

vi.stubGlobal('Audio', vi.fn(() => mockAudioInstance));

import { initMusicPlayer } from './music-player.js';
import { appState } from './state.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockPreferences.musicEnabled = false;
  mockPreferences.musicVolume = 60;
  mockAudioInstance.paused = true;
  mockAudioInstance.src = '';
  mockAudioInstance.volume = 1;
  mockListeners.clear();
});

describe('initMusicPlayer', () => {
  it('registers listeners on appState for preferences-changed and state-loaded', () => {
    initMusicPlayer();
    expect(appState.on).toHaveBeenCalledWith('preferences-changed', expect.any(Function));
    expect(appState.on).toHaveBeenCalledWith('state-loaded', expect.any(Function));
  });
});

describe('when musicEnabled becomes true', () => {
  it('calls play() on the audio element', () => {
    initMusicPlayer();
    mockPreferences.musicEnabled = true;
    mockAudioInstance.paused = true;
    mockListeners.get('preferences-changed')?.forEach(cb => cb());
    expect(mockAudioInstance.play).toHaveBeenCalled();
  });

  it('sets volume from preferences', () => {
    initMusicPlayer();
    mockPreferences.musicEnabled = true;
    mockPreferences.musicVolume = 80;
    mockAudioInstance.paused = true;
    mockListeners.get('preferences-changed')?.forEach(cb => cb());
    expect(mockAudioInstance.volume).toBe(0.8);
  });
});

describe('when musicEnabled becomes false', () => {
  it('calls pause() and clears src', () => {
    initMusicPlayer();
    mockPreferences.musicEnabled = false;
    mockAudioInstance.paused = false;
    mockListeners.get('preferences-changed')?.forEach(cb => cb());
    expect(mockAudioInstance.pause).toHaveBeenCalled();
    expect(mockAudioInstance.src).toBe('');
  });
});

describe('volume change while playing', () => {
  it('updates audio volume without restarting', () => {
    initMusicPlayer();
    mockPreferences.musicEnabled = true;
    mockAudioInstance.paused = false; // already playing
    mockPreferences.musicVolume = 40;
    mockListeners.get('preferences-changed')?.forEach(cb => cb());
    expect(mockAudioInstance.volume).toBe(0.4);
    expect(mockAudioInstance.play).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --reporter=verbose src/renderer/music-player.test.ts
```

Expected: FAIL with "Cannot find module './music-player.js'"

- [ ] **Step 3: Implement music-player.ts**

Create `src/renderer/music-player.ts`:

```typescript
import { appState } from './state.js';

const STREAM_URL = 'https://ice2.somafm.com/groovesalad-256-mp3';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

let audio: HTMLAudioElement | null = null;
let retryCount = 0;
let retryTimeout: ReturnType<typeof setTimeout> | null = null;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener('error', handleStreamError);
    audio.addEventListener('stalled', handleStreamError);
  }
  return audio;
}

function handleStreamError(): void {
  if (retryCount < MAX_RETRIES) {
    retryCount++;
    retryTimeout = setTimeout(attemptPlay, RETRY_DELAY_MS);
  } else {
    retryCount = 0;
    appState.setPreference('musicEnabled', false);
  }
}

function attemptPlay(): void {
  const el = getAudio();
  el.src = STREAM_URL;
  el.volume = (appState.preferences.musicVolume ?? 60) / 100;
  el.play().catch(() => handleStreamError());
}

function syncToPreferences(): void {
  const el = getAudio();
  const { musicEnabled, musicVolume } = appState.preferences;

  if (musicEnabled) {
    el.volume = (musicVolume ?? 60) / 100;
    if (el.paused) {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      retryCount = 0;
      attemptPlay();
    }
  } else {
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
    retryCount = 0;
    el.pause();
    el.src = '';
  }
}

export function initMusicPlayer(): void {
  appState.on('preferences-changed', syncToPreferences);
  appState.on('state-loaded', syncToPreferences);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --reporter=verbose src/renderer/music-player.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/music-player.ts src/renderer/music-player.test.ts
git commit -m "feat: add music-player module with stream playback and retry logic"
```

---

### Task 4: Add styles for active button and volume popover

**Files:**
- Modify: `src/renderer/styles/tabs.css`

- [ ] **Step 1: Add CSS**

Append to `src/renderer/styles/tabs.css`:

```css
/* Music button active state */
#btn-music.active {
  color: var(--accent);
  border-color: var(--accent);
}

/* Volume popover */
.music-volume-popover {
  position: fixed;
  z-index: 200;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 140px;
}

.music-volume-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-align: center;
}

.music-volume-popover input[type="range"] {
  -webkit-appearance: none;
  width: 100%;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.music-volume-popover input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/styles/tabs.css
git commit -m "feat: add styles for music button active state and volume popover"
```

---

### Task 5: Wire music button in tab-bar

**Files:**
- Modify: `src/renderer/components/tab-bar.ts`

- [ ] **Step 1: Add music button wiring to initTabBar()**

In `src/renderer/components/tab-bar.ts`, add at the top of the file (after existing imports and element queries):

```typescript
const btnMusic = document.getElementById('btn-music')!;
let volumePopover: HTMLElement | null = null;
```

Add these helper functions (add them before or after `hideTabContextMenu`):

```typescript
function hideVolumePopover(): void {
  if (volumePopover) {
    volumePopover.remove();
    volumePopover = null;
  }
}

function showVolumePopover(): void {
  if (volumePopover) {
    hideVolumePopover();
    return;
  }

  const popover = document.createElement('div');
  popover.className = 'music-volume-popover';

  const label = document.createElement('div');
  label.className = 'music-volume-label';
  label.textContent = `Volume: ${appState.preferences.musicVolume ?? 60}%`;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(appState.preferences.musicVolume ?? 60);
  slider.addEventListener('input', () => {
    const vol = Number(slider.value);
    label.textContent = `Volume: ${vol}%`;
    appState.setPreference('musicVolume', vol);
  });

  popover.appendChild(label);
  popover.appendChild(slider);

  const rect = btnMusic.getBoundingClientRect();
  popover.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  popover.style.right = `${window.innerWidth - rect.right}px`;

  document.body.appendChild(popover);
  volumePopover = popover;
}

function updateMusicButton(): void {
  btnMusic.classList.toggle('active', appState.preferences.musicEnabled ?? false);
}
```

Inside `initTabBar()`, after the existing button event wiring (after `btnHelp.addEventListener`), add:

```typescript
  btnMusic.addEventListener('click', () => {
    hideVolumePopover();
    appState.setPreference('musicEnabled', !appState.preferences.musicEnabled);
  });

  btnMusic.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showVolumePopover();
  });

  appState.on('preferences-changed', updateMusicButton);
  appState.on('state-loaded', updateMusicButton);
```

In the existing `document.addEventListener('click', hideTabContextMenu)` handler (line ~77), also call `hideVolumePopover()` — update that line to:

```typescript
  document.addEventListener('click', (e) => {
    hideTabContextMenu();
    if (volumePopover && !volumePopover.contains(e.target as Node) && e.target !== btnMusic) {
      hideVolumePopover();
    }
  });
```

Also update the existing `document.addEventListener('keydown', ...)` handler to also hide the popover:

```typescript
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideTabContextMenu();
      hideVolumePopover();
    }
  });
```

- [ ] **Step 2: Build and manually verify**

```bash
npm run build
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/tab-bar.ts
git commit -m "feat: add music toggle button and volume popover to tab bar"
```

---

### Task 6: Initialize music player in renderer

**Files:**
- Modify: `src/renderer/index.ts`

- [ ] **Step 1: Import and call initMusicPlayer**

In `src/renderer/index.ts`, add import at the top with the other init imports:

```typescript
import { initMusicPlayer } from './music-player.js';
```

Inside `main()`, after `initNotificationSound()` / `initNotificationDesktop()` (around line 153), add:

```typescript
  initMusicPlayer();
```

- [ ] **Step 2: Full build and smoke test**

```bash
npm run build && npm start
```

Verify:
1. Music note button (♪) appears in tab bar between MCP and swarm toggle
2. Left-click toggles button accent color (active state) and starts/stops audio
3. Right-click shows volume popover above the button; dragging slider updates label
4. Click outside closes the popover
5. Escape closes the popover
6. Quit and relaunch — `musicEnabled` and `musicVolume` persist

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.ts
git commit -m "feat: initialize music player in renderer startup"
```

---

## Verification Checklist

- [ ] `npm run build` completes without TypeScript errors
- [ ] `npm test` passes all tests including `music-player.test.ts`
- [ ] Music button appears in tab bar (♪ icon, between MCP and swarm buttons)
- [ ] Left-click toggles music on/off; button highlights in accent color when active
- [ ] Right-click opens volume popover; slider updates volume in real-time
- [ ] Clicking outside or pressing Escape closes the popover
- [ ] Stream actually plays (requires network; SomaFM Groove Salad)
- [ ] State persists across app restarts (`~/.vibeyard/state.json` contains `musicEnabled`/`musicVolume`)
- [ ] Stream error/disconnect: button auto-disables after 3 retries

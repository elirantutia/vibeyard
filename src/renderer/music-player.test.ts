import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so these variables are available when vi.mock factory is hoisted
const { mockListeners, mockPreferences, mockAudioInstance, audioListeners } = vi.hoisted(() => {
  const mockListeners = new Map<string, Set<() => void>>();
  const mockPreferences = { musicEnabled: false, musicVolume: 60 };

  // Persistent audio listener map — survives vi.clearAllMocks() because it is
  // updated from the addEventListener implementation closure, not from mock call records.
  const audioListeners = new Map<string, () => void>();

  const mockAudioInstance = {
    src: '',
    volume: 1,
    loop: false,
    paused: true,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      audioListeners.set(event, handler);
    }),
  };
  return { mockListeners, mockPreferences, mockAudioInstance, audioListeners };
});

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

vi.stubGlobal('Audio', vi.fn().mockImplementation(function () { return mockAudioInstance; }));

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

  // Restore the addEventListener implementation after vi.clearAllMocks() resets it,
  // so audioListeners continues to be populated for any new Audio() calls.
  mockAudioInstance.addEventListener.mockImplementation(
    (event: string, handler: () => void) => {
      audioListeners.set(event, handler);
    }
  );
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

describe('retry logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    // Warm up the module's lazy audio instance so audioListeners is populated,
    // then clear play/setPreference call history so counts start clean.
    initMusicPlayer();
    mockPreferences.musicEnabled = true;
    mockAudioInstance.paused = true;
    mockListeners.get('preferences-changed')?.forEach(cb => cb());
    mockAudioInstance.play.mockClear();
    vi.mocked(appState.setPreference).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function triggerAudioError(): void {
    const handler = audioListeners.get('error');
    if (!handler) throw new Error('error listener not registered on audio element');
    handler();
  }

  it('schedules a retry after a single stream error', () => {
    triggerAudioError();

    // play should NOT be called synchronously
    expect(mockAudioInstance.play).not.toHaveBeenCalled();

    // advance past the 2000ms RETRY_DELAY_MS — retry fires
    vi.runAllTimers();
    expect(mockAudioInstance.play).toHaveBeenCalledTimes(1);
  });

  it('disables music after MAX_RETRIES (3) exhausted errors', () => {
    // Fire 3 errors — each one retries (retryCount goes 1, 2, 3)
    for (let i = 0; i < 3; i++) {
      triggerAudioError();
      vi.runAllTimers();
      mockAudioInstance.play.mockClear();
    }

    // 4th error exhausts retries: retryCount === MAX_RETRIES, so disable music
    triggerAudioError();

    expect(appState.setPreference).toHaveBeenCalledWith('musicEnabled', false);
  });
});

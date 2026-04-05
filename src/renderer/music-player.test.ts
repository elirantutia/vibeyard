import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so these variables are available when vi.mock factory is hoisted
const { mockListeners, mockPreferences, mockAudioInstance } = vi.hoisted(() => {
  const mockListeners = new Map<string, Set<() => void>>();
  const mockPreferences = { musicEnabled: false, musicVolume: 60 };
  const mockAudioInstance = {
    src: '',
    volume: 1,
    loop: false,
    paused: true,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn(),
  };
  return { mockListeners, mockPreferences, mockAudioInstance };
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

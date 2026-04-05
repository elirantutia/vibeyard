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
  el.volume = appState.preferences.musicVolume / 100;
  el.play().catch(() => handleStreamError());
}

function syncToPreferences(): void {
  const el = getAudio();
  const { musicEnabled, musicVolume } = appState.preferences;

  if (musicEnabled) {
    el.volume = musicVolume / 100;
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

export function _resetForTesting(): void {
  audio = null;
  retryCount = 0;
  if (retryTimeout) {
    clearTimeout(retryTimeout);
    retryTimeout = null;
  }
}

import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STARTUP_DELAY_MS = 10_000; // 10 seconds

function sendToRenderer(channel: string, payload: Record<string, unknown>): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {});
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    sendToRenderer('update:available', { version: info.version });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update:download-progress', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer('update:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    sendToRenderer('update:error', { message: err?.message ?? 'Unknown error' });
  });

  // Check after startup delay, then periodically
  setTimeout(checkForUpdates, STARTUP_DELAY_MS);
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}

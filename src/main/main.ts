import { app, BrowserWindow, dialog, powerMonitor, shell } from 'electron';
import * as path from 'path';
import { registerIpcHandlers, resetHookWatcher } from './ipc-handlers';
import { killAllPtys } from './pty-manager';
import { flushState, loadState } from './store';
import { createAppMenu } from './menu';
import { restartAndResync } from './hook-status';
import { initProviders, getAllProviders } from './providers/registry';
import { initAutoUpdater } from './auto-updater';
import { stopGitWatcher } from './git-watcher';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Vibeyard',
    icon: path.join(__dirname, '..', '..', '..', 'build', 'icon.png'),
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for node-pty IPC
      webviewTag: true, // needed for browser-tab sessions
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

  // Open external links in default browser instead of inside the app
  const isHttpUrl = (url: string) => url.startsWith('http://') || url.startsWith('https://');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (isHttpUrl(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', () => {
    flushState();
  });

  mainWindow.on('closed', () => {
    killAllPtys();
    resetHookWatcher();
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  initProviders();

  // Validate all registered providers; block on Claude (default), warn on others
  for (const provider of getAllProviders()) {
    const prereq = provider.validatePrerequisites();
    if (!prereq.ok) {
      if (provider.meta.id === 'claude') {
        dialog.showErrorBox('Vibeyard — Missing Prerequisite', prereq.message);
        app.quit();
        return;
      } else {
        console.warn(`Provider "${provider.meta.displayName}" not available: ${prereq.message}`);
      }
    }
  }

  registerIpcHandlers();
  const state = loadState();
  createAppMenu(state.preferences?.debugMode ?? false);
  createWindow();

  // Install hooks and status scripts for available providers (after window creation so dialogs can attach)
  for (const provider of getAllProviders()) {
    if (provider.validatePrerequisites().ok) {
      await provider.installHooks(mainWindow);
      provider.installStatusScripts();
    }
  }

  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        restartAndResync(win);
      }
    }
  });

  powerMonitor.on('resume', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      restartAndResync(win);
    }
  });
});

app.on('before-quit', () => {
  flushState();
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send('app:quitting');
  }
  killAllPtys();
  stopGitWatcher();
  // Cleanup all providers
  for (const provider of getAllProviders()) {
    provider.cleanup();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

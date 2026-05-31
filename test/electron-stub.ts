// Test-only stub for the `electron` module.
//
// CI installs dependencies with ELECTRON_SKIP_BINARY_DOWNLOAD=1, so the real
// `node_modules/electron/index.js` throws ("Electron failed to install
// correctly") the moment it is imported. Several main-process modules
// value-import from 'electron' (e.g. `import { BrowserWindow } from 'electron'`
// in hook-status.ts), and those modules are pulled in transitively by provider
// and pty-manager tests. Aliasing 'electron' to this stub in vitest.config.ts
// keeps those suites from loading the real binary-backed module.
//
// Only the surface that test-reachable code touches needs to exist. Members are
// no-op fakes; tests that exercise electron behaviour should mock it explicitly.

const noop = () => {};

class BrowserWindow {
  static getAllWindows() {
    return [] as BrowserWindow[];
  }
  static fromWebContents() {
    return null;
  }
  webContents = { send: noop };
}

export { BrowserWindow };

export const app = {
  getPath: () => '/mock/app-path',
  getName: () => 'vibeyard',
  getVersion: () => '0.0.0-test',
  on: noop,
  whenReady: () => Promise.resolve(),
  quit: noop,
};

export const ipcMain = {
  on: noop,
  handle: noop,
  removeHandler: noop,
  removeAllListeners: noop,
};

export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
  showMessageBox: () => Promise.resolve({ response: 0 }),
};

export const shell = {
  openExternal: () => Promise.resolve(),
  openPath: () => Promise.resolve(''),
};

export const clipboard = {
  writeText: noop,
  readText: () => '',
};

export const Menu = Object.assign(class Menu {}, {
  buildFromTemplate: () => ({ popup: noop }),
  setApplicationMenu: noop,
});

export const powerMonitor = {
  on: noop,
};

export const session = {
  defaultSession: { cookies: { set: () => Promise.resolve() } },
};

export default {
  BrowserWindow,
  app,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Menu,
  powerMonitor,
  session,
};

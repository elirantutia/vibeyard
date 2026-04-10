import { app, Menu, BrowserWindow } from 'electron';
import { isMac, isWin } from './platform';

export function createAppMenu(debugMode = false): void {

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+Shift+P',
          registerAccelerator: false,
          click: () => sendToRenderer('menu:new-project'),
        },
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+Shift+N',
          registerAccelerator: false,
          click: () => sendToRenderer('menu:new-session'),
        },
        { type: 'separator' },
        isMac ? {
          label: 'Close Session',
          accelerator: 'CmdOrCtrl+W',
          registerAccelerator: false,
          click: () => sendToRenderer('menu:close-session'),
        } : { role: 'quit' as const },
        ...(isMac ? [{
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => { BrowserWindow.getFocusedWindow()?.close(); },
        }] : []),
      ],
    },
    {
      label: 'Edit',
      // On Windows, role-based items register Ctrl+C/V/X/Z/A as global
      // accelerators which steal keystrokes from xterm.js terminals.
      // Use custom items without accelerators — Chromium still handles
      // these shortcuts natively in regular DOM inputs/textareas.
      submenu: isWin ? [
        { label: 'Undo', click: () => focusedContents()?.undo() },
        { label: 'Redo', click: () => focusedContents()?.redo() },
        { type: 'separator' as const },
        { label: 'Cut', click: () => focusedContents()?.cut() },
        { label: 'Copy', click: () => focusedContents()?.copy() },
        { label: 'Paste', click: () => focusedContents()?.paste() },
        { label: 'Delete', click: () => focusedContents()?.delete() },
        { label: 'Select All', click: () => focusedContents()?.selectAll() },
      ] : [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'pasteAndMatchStyle' as const },
        { role: 'delete' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Split Mode',
          accelerator: 'CmdOrCtrl+\\',
          registerAccelerator: false,
          click: () => sendToRenderer('menu:toggle-split'),
        },
        { type: 'separator' },
        {
          label: 'Usage Stats',
          accelerator: 'CmdOrCtrl+Shift+U',
          registerAccelerator: false,
          click: () => sendToRenderer('menu:usage-stats'),
        },
        {
          label: 'Toggle Session Inspector',
          accelerator: 'CmdOrCtrl+Shift+I',
          registerAccelerator: false,
          click: () => sendToRenderer('menu:toggle-inspector'),
        },
        ...(debugMode ? [
          {
            label: 'Toggle Debug Panel',
            accelerator: 'CmdOrCtrl+Shift+D',
            registerAccelerator: false,
            click: () => sendToRenderer('menu:toggle-debug'),
          },
          { type: 'separator' as const },
          { role: 'toggleDevTools' as const },
          { role: 'reload' as const },
        ] : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function focusedContents(): Electron.WebContents | undefined {
  return BrowserWindow.getFocusedWindow()?.webContents;
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.send(channel, ...args);
  }
}

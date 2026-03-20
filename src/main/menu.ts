import { app, Menu, BrowserWindow } from 'electron';

export function createAppMenu(): void {
  const isMac = process.platform === 'darwin';

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
          click: () => sendToRenderer('menu:new-project'),
        },
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => sendToRenderer('menu:new-session'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
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
          click: () => sendToRenderer('menu:toggle-split'),
        },
        { type: 'separator' },
        {
          label: 'Usage Stats',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => sendToRenderer('menu:usage-stats'),
        },
        {
          label: 'Toggle Debug Panel',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => sendToRenderer('menu:toggle-debug'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' as const },
        { role: 'reload' as const },
      ],
    },
    {
      label: 'Sessions',
      submenu: [
        {
          label: 'Next Session',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: () => sendToRenderer('menu:next-session'),
        },
        {
          label: 'Previous Session',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: () => sendToRenderer('menu:prev-session'),
        },
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Session ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => sendToRenderer('menu:goto-session', i),
        })),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    win.webContents.send(channel, ...args);
  }
}

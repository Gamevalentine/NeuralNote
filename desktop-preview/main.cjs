'use strict';

// Preview shell for the already-working NOTIQ Web interface. Electron bundles
// the React/Basic Pitch build; it does NOT embed native NeuralNote/MuScriptor.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

app.setName('NOTIQ Web Preview');

function createWindow() {
  const win = new BrowserWindow({
    title: 'NOTIQ — Giao diện bản thử Windows',
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111318',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(github\.com|www\.github\.com)\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Only load the bundled NOTIQ Web application; never navigate this privileged window.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  // The review switch is only a visual QA tool. It doesn't enable MuScriptor.
  win.loadFile(path.join(__dirname, 'www', 'index.html'), {
    query: { review: 'desktop' },
  }).catch((error) => {
    console.error('Cannot load bundled NOTIQ UI:', error);
    win.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());

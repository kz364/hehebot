'use strict';

const { app, BrowserWindow, clipboard, dialog, Menu, shell } = require('electron');
const { loadConfig, saveConfig } = require('./config.cjs');
const { installNavigationHandlers } = require('./navigation.cjs');
const { parseAuthOrigins, parsePortalOrigin, partitionForOrigin } = require('./policy.cjs');

let mainWindow;
let portalOrigin;
let authOrigins = [];

function argumentOrigin(argv) {
  const prefix = '--portal-origin=';
  const argument = argv.find((item) => item.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

function secureWindow(origin, loginOrigins) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    title: 'Hehebot Portal',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      partition: partitionForOrigin(origin)
    }
  });

  const ses = win.webContents.session;
  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  installNavigationHandlers(win.webContents, origin, loginOrigins, (url) => {
    Menu.buildFromTemplate([{ label: 'Open Link in Default Browser', click: () => void shell.openExternal(url) }]).popup({ window: win });
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('select-file', (event) => event.preventDefault());
  ses.on('will-download', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  void win.loadURL(origin);
  return win;
}

async function changeOriginFromClipboard() {
  try {
    const proposed = parsePortalOrigin(clipboard.readText().trim());
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Switch Origin'],
      defaultId: 0,
      cancelId: 0,
      title: 'Switch portal origin?',
      message: proposed,
      detail: 'This origin receives an isolated browser session. The application will relaunch.'
    });
    if (result.response !== 1) return;
    saveConfig(app.getPath('userData'), proposed, authOrigins);
    app.relaunch();
    app.exit(0);
  } catch (error) {
    await dialog.showMessageBox(mainWindow, { type: 'error', title: 'Invalid portal origin', message: error.message });
  }
}

async function configureAuthOriginsFromClipboard() {
  try {
    const proposed = parseAuthOrigins(clipboard.readText().split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning', buttons: ['Cancel', 'Save Login Origins'], defaultId: 0, cancelId: 0,
      title: 'Configure trusted login origins?',
      message: proposed.length ? proposed.join('\n') : 'Remove all trusted login origins',
      detail: 'Only configure HTTPS origins required by your portal login. Redirects stay in this portal session; these pages receive no native capabilities. The application will relaunch.'
    });
    if (result.response !== 1) return;
    saveConfig(app.getPath('userData'), portalOrigin, proposed);
    app.relaunch();
    app.exit(0);
  } catch (error) {
    await dialog.showMessageBox(mainWindow, { type: 'error', title: 'Invalid login origins', message: error.message });
  }
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Hehebot Portal',
    submenu: [
      { label: 'About Hehebot Portal', role: 'about' },
      { type: 'separator' },
      { label: 'Open Portal in Default Browser', click: () => void shell.openExternal(portalOrigin) },
      { label: 'Switch Portal to Origin on Clipboard…', click: () => void changeOriginFromClipboard() },
      { label: 'Configure Login Origins from Clipboard…', click: () => void configureAuthOriginsFromClipboard() },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' }
    ]
  }, {
    label: 'Edit',
    submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
  }, {
    label: 'View',
    submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }]
  }, {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }]
  }]));
}

app.on('login', (event, _webContents, _details, _authInfo, callback) => {
  event.preventDefault();
  callback('', '');
});

app.whenReady().then(async () => {
  try {
    const fromArgument = argumentOrigin(process.argv);
    let config = loadConfig(app.getPath('userData'));
    if (fromArgument) {
      saveConfig(app.getPath('userData'), fromArgument, config?.authOrigins || []);
      config = loadConfig(app.getPath('userData'));
    }
    if (!config) {
      const proposed = parsePortalOrigin(clipboard.readText().trim());
      const result = await dialog.showMessageBox({
        type: 'question', buttons: ['Quit', 'Use Clipboard Origin'], defaultId: 0, cancelId: 0,
        title: 'Set up Hehebot Portal', message: proposed,
        detail: 'Use this HTTPS portal origin from the clipboard? It will be stored in a private local configuration.'
      });
      if (result.response !== 1) { app.quit(); return; }
      saveConfig(app.getPath('userData'), proposed, []);
      config = loadConfig(app.getPath('userData'));
    }
    portalOrigin = config.portalOrigin;
    authOrigins = config.authOrigins;
    installMenu();
    mainWindow = secureWindow(portalOrigin, authOrigins);
  } catch (error) {
    await dialog.showMessageBox({ type: 'error', title: 'Hehebot Portal could not start', message: error.message });
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());

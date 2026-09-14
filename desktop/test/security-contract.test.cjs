'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

test('renderer is sandboxed, context isolated, and has no Node or preload bridge', () => {
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /nodeIntegrationInWorker:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /webviewTag:\s*false/);
  assert.doesNotMatch(source, /preload\s*:/);
  assert.doesNotMatch(source, /ipcMain|contextBridge/);
});

test('remote permission, file selection, download and webview boundaries fail closed', () => {
  for (const boundary of ['setPermissionCheckHandler', 'setPermissionRequestHandler', "on('will-attach-webview'", "on('select-file'", "on('will-download'"]) {
    assert.ok(source.includes(boundary), `missing ${boundary}`);
  }
});

test('shell does not boot an agent/server or implement polling', () => {
  assert.doesNotMatch(source, /child_process|exec\(|spawn\(|setInterval|setTimeout|fetch\(/);
});

test('only an explicit native menu click opens the configured origin, never renderer URLs or cookies', async () => {
  let startup, menu;
  const opened = [], downloaded = {}, loaded = [];
  const origin = 'https://portal.example';
  const electron = {
    app: { on() {}, whenReady: () => ({ then: fn => { startup = fn; } }), getPath: () => '/synthetic/user-data' },
    BrowserWindow: class {
      webContents = {
        getURL: () => 'https://login.example/callback?code=PRIVATE_CALLBACK_CANARY',
        on() {},
        session: { setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, on: (name, callback) => { downloaded[name] = callback; } },
      };
      once() {}
      loadURL(url) { loaded.push(url); return Promise.resolve(); }
    },
    Menu: { buildFromTemplate: value => value, setApplicationMenu: value => { menu = value; } },
    shell: { openExternal: url => { opened.push(url); return Promise.resolve(); } },
  };
  vm.runInNewContext(source, {
    require: name => {
      if (name === 'electron') return electron;
      if (name === './config.cjs') return { loadConfig: () => ({ portalOrigin: origin, authOrigins: ['https://login.example'] }) };
      if (name === './navigation.cjs') return { installNavigationHandlers() {} };
      if (name === './policy.cjs') return require('../src/policy.cjs');
      throw Error('Unexpected dependency');
    },
    process: { argv: ['electron', 'main.cjs'] },
  });
  await startup();
  assert.deepEqual(loaded, [origin]); assert.deepEqual(opened, []);
  const action = menu[0].submenu.find(item => item.label === 'Open Portal in Default Browser');
  assert.equal(typeof action.click, 'function'); action.click();
  assert.deepEqual(opened, [origin]);
  let prevented = false;
  downloaded['will-download']({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
});

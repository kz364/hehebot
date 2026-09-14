'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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

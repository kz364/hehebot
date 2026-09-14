'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { configPath, loadConfig, saveConfig } = require('../src/config.cjs');

test('private config round-trips and is owner-only on POSIX', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clawbot-desktop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  saveConfig(directory, 'https://portal.example', ['https://login.example']);
  assert.deepEqual(loadConfig(directory), { version: 2, portalOrigin: 'https://portal.example', authOrigins: ['https://login.example'] });
  if (process.platform !== 'win32') assert.equal(fs.statSync(configPath(directory)).mode & 0o777, 0o600);
});

test('legacy config loads without trusted login origins', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clawbot-desktop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(configPath(directory), JSON.stringify({ version: 1, portalOrigin: 'https://portal.example' }), { mode: 0o600 });
  assert.deepEqual(loadConfig(directory), { version: 2, portalOrigin: 'https://portal.example', authOrigins: [] });
});

test('missing config is explicit and malformed or expanded config fails closed', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clawbot-desktop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(loadConfig(directory), null);
  fs.writeFileSync(configPath(directory), JSON.stringify({ version: 1, portalOrigin: 'https://portal.example', token: 'nope' }), { mode: 0o600 });
  assert.throws(() => loadConfig(directory), /unsupported format/);
  fs.writeFileSync(configPath(directory), '{broken');
  assert.throws(() => loadConfig(directory), /Cannot read private portal config/);
});

test('config rejects symlinks and non-private POSIX modes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clawbot-desktop-'));
  const source = path.join(directory, 'source.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(source, JSON.stringify({ version: 1, portalOrigin: 'https://portal.example' }), { mode: 0o600 });
  fs.symlinkSync(source, configPath(directory));
  assert.throws(() => loadConfig(directory), /small regular file/);
  if (process.platform !== 'win32') {
    fs.unlinkSync(configPath(directory));
    fs.copyFileSync(source, configPath(directory));
    fs.chmodSync(configPath(directory), 0o644);
    assert.throws(() => loadConfig(directory), /accessible by other users/);
  }
});

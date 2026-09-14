'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { installNavigationHandlers } = require('../src/navigation.cjs');

function harness(initial = 'https://portal.example/') {
  const handlers = {};
  const opened = [];
  let current = initial;
  const contents = {
    getURL: () => current,
    on: (name, handler) => { handlers[name] = handler; },
    setWindowOpenHandler: (handler) => { handlers.popup = handler; }
  };
  installNavigationHandlers(contents, 'https://portal.example', ['https://access.example', 'https://idp.example'], (url) => opened.push(url));
  function emit(name, url) {
    let prevented = false;
    handlers[name]({ preventDefault: () => { prevented = true; } }, url);
    return prevented;
  }
  return { handlers, opened, emit, setCurrent: (url) => { current = url; } };
}

test('keeps configured redirect login chain in the isolated session', () => {
  const h = harness(''); // Initial redirect may precede the first committed URL.
  assert.equal(h.emit('will-redirect', 'https://access.example/login?state=x'), false);
  h.setCurrent('https://access.example/login');
  assert.equal(h.emit('will-navigate', 'https://idp.example/authorize'), false);
  h.setCurrent('https://idp.example/authorize');
  assert.equal(h.emit('will-redirect', 'https://portal.example/callback?code=x'), false);
  assert.deepEqual(h.opened, []);
});

test('blocks arbitrary and credential-bearing redirects without opening the OS', () => {
  const h = harness();
  assert.equal(h.emit('will-redirect', 'https://evil.example/steal'), true);
  assert.equal(h.emit('will-redirect', 'https://user:secret@portal.example/'), true);
  assert.deepEqual(h.opened, []);
});

test('blocks automatic external navigation and offers only explicit context-menu opening', () => {
  const h = harness();
  assert.equal(h.emit('will-navigate', 'https://docs.example/help'), true);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.handlers.popup({ url: 'https://docs.example/popup' }), { action: 'deny' });
  assert.deepEqual(h.handlers.popup({ url: 'https://access.example/login' }), { action: 'deny' });
  assert.deepEqual(h.opened, []);
  h.handlers['context-menu']({}, { linkURL: 'https://docs.example/help' });
  h.handlers['context-menu']({}, { linkURL: 'https://access.example/login' });
  assert.deepEqual(h.opened, ['https://docs.example/help']);
});

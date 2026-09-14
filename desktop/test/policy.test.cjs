'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyNavigation, classifyShellNavigation, parseAuthOrigins, parsePortalOrigin, partitionForOrigin } = require('../src/policy.cjs');

test('accepts HTTPS and test-only loopback HTTP origins', () => {
  assert.equal(parsePortalOrigin('https://portal.example'), 'https://portal.example');
  assert.equal(parsePortalOrigin('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(parsePortalOrigin('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  assert.equal(parsePortalOrigin('http://[::1]:8787'), 'http://[::1]:8787');
});

test('rejects hostile or ambiguous portal configuration', () => {
  for (const value of ['http://example.com', 'file:///tmp/x', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?next=evil']) {
    assert.throws(() => parsePortalOrigin(value));
  }
});

test('keeps only exact-origin navigation in the renderer', () => {
  const origin = 'https://portal.example';
  assert.equal(classifyNavigation('https://portal.example/chat?id=1', origin), 'portal');
  assert.equal(classifyNavigation('https://user:pass@portal.example/chat', origin), 'deny');
  assert.equal(classifyNavigation('https://portal.example.evil.test/', origin), 'external');
  assert.equal(classifyNavigation('https://evil.test/', origin), 'external');
  assert.equal(classifyNavigation('javascript:alert(1)', origin), 'deny');
  assert.equal(classifyNavigation('file:///etc/passwd', origin), 'deny');
  assert.equal(classifyNavigation('http://evil.test/', origin), 'deny');
  assert.equal(classifyNavigation('mailto:owner@example.com', origin), 'external');
});

test('accepts only explicit credential-free HTTPS login origins', () => {
  assert.deepEqual(parseAuthOrigins(['https://access.example/', 'https://access.example']), ['https://access.example']);
  assert.equal(classifyShellNavigation('https://access.example/cdn-cgi/access/login', 'https://portal.example', ['https://access.example']), 'auth');
  for (const value of ['http://access.example', 'https://user@access.example', 'https://access.example/path']) {
    assert.throws(() => parseAuthOrigins([value]));
  }
});

test('isolates persistent sessions by canonical origin without exposing it', () => {
  assert.equal(partitionForOrigin('https://one.example'), partitionForOrigin('https://one.example/'));
  assert.notEqual(partitionForOrigin('https://one.example'), partitionForOrigin('https://two.example'));
  assert.doesNotMatch(partitionForOrigin('https://one.example'), /one\.example/);
});

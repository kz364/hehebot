'use strict';

const crypto = require('node:crypto');

function parsePortalOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new Error('Portal origin must be a non-empty URL');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Portal origin must be a valid URL');
  }

  if (url.username || url.password) throw new Error('Portal origin cannot contain credentials');
  if (url.search || url.hash) throw new Error('Portal origin cannot contain a query or fragment');
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Portal origin cannot contain a path');

  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Portal origin must use HTTPS (HTTP is allowed only on loopback)');
  }
  return url.origin;
}

function classifyNavigation(target, portalOrigin) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return 'deny';
  }
  if (url.username || url.password) return 'deny';
  if (url.origin === portalOrigin && (url.protocol === 'https:' || url.protocol === 'http:')) return 'portal';
  if (url.protocol === 'https:') return 'external';
  if (url.protocol === 'mailto:') return 'external';
  return 'deny';
}

function parseAuthOrigins(values) {
  if (!Array.isArray(values) || values.length > 16) throw new Error('Login origins must be an array of at most 16 origins');
  const origins = values.map((value) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) throw new Error('Login origin must be a non-empty URL');
    let url;
    try { url = new URL(value); } catch { throw new Error('Login origin must be a valid URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      throw new Error('Login origins must be credential-free HTTPS origins without paths, queries, or fragments');
    }
    return url.origin;
  });
  return [...new Set(origins)];
}

function classifyShellNavigation(target, portalOrigin, authOrigins) {
  const disposition = classifyNavigation(target, portalOrigin);
  if (disposition !== 'external') return disposition;
  const origin = new URL(target).origin;
  return parseAuthOrigins(authOrigins).includes(origin) ? 'auth' : 'external';
}

function partitionForOrigin(origin) {
  const digest = crypto.createHash('sha256').update(parsePortalOrigin(origin)).digest('hex');
  return `persist:hehebot-${digest.slice(0, 24)}`;
}

module.exports = { classifyNavigation, classifyShellNavigation, parseAuthOrigins, parsePortalOrigin, partitionForOrigin };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseAuthOrigins, parsePortalOrigin } = require('./policy.cjs');

const CONFIG_NAME = 'portal-config.json';

function configPath(userData) {
  return path.join(userData, CONFIG_NAME);
}

function loadConfig(userData) {
  const file = configPath(userData);
  let parsed;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 8192) throw new Error('Config is not a small regular file');
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('Config must not be accessible by other users');
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw new Error(`Cannot read private portal config: ${error.message}`);
  }
  if (!parsed || ![1, 2].includes(parsed.version) || Object.keys(parsed).some((key) => !['version', 'portalOrigin', 'authOrigins'].includes(key))) {
    throw new Error('Portal config has an unsupported format');
  }
  return { version: 2, portalOrigin: parsePortalOrigin(parsed.portalOrigin), authOrigins: parseAuthOrigins(parsed.authOrigins || []) };
}

function saveConfig(userData, portalOrigin, authOrigins = []) {
  const normalized = parsePortalOrigin(portalOrigin);
  const normalizedAuth = parseAuthOrigins(authOrigins);
  fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(userData, 0o700); } catch { /* best effort on non-POSIX filesystems */ }
  const destination = configPath(userData);
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 2, portalOrigin: normalized, authOrigins: normalizedAuth }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, destination);
  try { fs.chmodSync(destination, 0o600); } catch { /* best effort on non-POSIX filesystems */ }
  return { portalOrigin: normalized, authOrigins: normalizedAuth };
}

module.exports = { CONFIG_NAME, configPath, loadConfig, saveConfig };

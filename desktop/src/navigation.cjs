'use strict';

const { classifyShellNavigation } = require('./policy.cjs');

function installNavigationHandlers(contents, portalOrigin, authOrigins, openExternal) {
  contents.setWindowOpenHandler(({ url }) => {
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    const disposition = classifyShellNavigation(url, portalOrigin, authOrigins);
    if (disposition === 'portal' || disposition === 'auth') return;
    event.preventDefault();
  });

  contents.on('will-redirect', (event, url) => {
    const disposition = classifyShellNavigation(url, portalOrigin, authOrigins);
    // getURL() can still be empty during the initial portal -> Access redirect.
    // The locally configured destination allowlist is the trust boundary.
    if (disposition === 'portal' || disposition === 'auth') return;
    event.preventDefault();
  });

  contents.on('context-menu', (_event, params) => {
    if (params.linkURL && classifyShellNavigation(params.linkURL, portalOrigin, authOrigins) === 'external') {
      openExternal(params.linkURL);
    }
  });
}

module.exports = { installNavigationHandlers };

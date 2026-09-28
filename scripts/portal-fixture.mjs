// Shared by the scripts/test-portal-*.mjs fixture servers.
import {readFile} from 'node:fs/promises';

// Every static file public/index.html loads, including app.js's module imports.
// A missing entry 404s the module graph and the page never leaves "Loading your workspace…".
export const portalFiles={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/import-setup.js':'import-setup.js','/takeover.js':'takeover.js'};

export const portalFile=(file,encoding)=>readFile(new URL(`../public/${file}`,import.meta.url),encoding);

// Reads every portal page makes on its own since ARCHITECTURE_V2: the live-push WebSocket
// probe and the paired-Mac card. Strict fixtures answer them 404 instead of failing.
export const ambientPaths=new Set(['/v1/stream','/v1/nodes']);

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PINNED_OPENCLAW, NATIVE_CAPABILITIES } from './openclaw-adapter.mjs';

/** Read-only package inspection. Never starts Gateway, imports runtime code or reads auth state. */
export async function inspectPackage(packageRoot) {
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const targets = ['AgentParamsSchema', 'AgentWaitParamsSchema', 'ChatAbortParamsSchema', 'TasksCancelParamsSchema'];
  const evidence = {};
  for (const file of (await readdir(join(packageRoot, 'dist'))).filter((name) => name.endsWith('.mjs'))) {
    // Installed hashed files are evidence only; runtime adapter calls named RPC methods.
    if (!/^(src-|sessions-)/.test(file)) continue;
    const body = await readFile(join(packageRoot, 'dist', file), 'utf8');
    for (const target of targets) {
      const start = body.indexOf(`const ${target} = closedObject({`);
      if (start < 0) continue;
      const end = body.indexOf('\n});', start);
      if (end < 0) continue;
      const schema = body.slice(start, end + 4);
      evidence[target] = { file: `dist/${file}`, sha256: createHash('sha256').update(schema).digest('hex'),
        fields: [...schema.matchAll(/^\t([a-zA-Z]+):/gm)].map((match) => match[1]) };
    }
  }
  const matches = pkg.name === 'openclaw' && pkg.version === PINNED_OPENCLAW;
  const required = {
    AgentParamsSchema: ['message', 'agentId', 'model', 'sessionKey', 'deliver', 'disableMessageTool', 'idempotencyKey'],
    AgentWaitParamsSchema: ['runId', 'timeoutMs'],
    ChatAbortParamsSchema: ['sessionKey', 'agentId', 'runId'],
    TasksCancelParamsSchema: ['taskId', 'reason'],
  };
  const schemaMatch = Object.entries(required).every(([name, fields]) => fields.every((field) => evidence[name]?.fields.includes(field)));
  return { inspectedAt: new Date().toISOString(), package: { name: pkg.name, version: pkg.version, schemas: pkg.openclaw?.schemaVersions },
    node: process.version, versionMatches: matches, schemaFieldsMatch: schemaMatch, evidence,
    capabilities: NATIVE_CAPABILITIES, conclusion: matches && schemaMatch ? 'STATIC_SCHEMA_CHECK_PASSED_LIVE_GATES_BLOCKED' : 'VERSION_OR_SCHEMA_MISMATCH' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node runtime/probe.mjs /path/to/installed/openclaw');
  const report = await inspectPackage(process.argv[2]);
  console.log(JSON.stringify(report, null, 2));
  if (!report.versionMatches || !report.schemaFieldsMatch) process.exitCode = 1;
}

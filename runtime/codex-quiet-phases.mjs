const fail = () => { throw Object.assign(new Error('INVALID_QUIET_PHASE'), { code: 'INVALID_QUIET_PHASE' }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const QUIET_PHASE_FIELDS = Object.freeze(['commands', 'mcpCalls', 'fileChanges', 'dynamicCalls', 'webSearches', 'sleeps', 'compactions', 'collabCalls', 'imageGenerations', 'reasoningItems', 'spawns', 'outputItems']);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Content-free host observations. Missing legacy phases are never reconstructed. */
export function readQuietPhases(value) {
  if (value === undefined) return {};
  if (!object(value) || Object.keys(value).length > 4096) fail();
  let active = 0;
  const phases = {};
  for (const [key, phase] of Object.entries(value)) {
    let pair;
    try { pair = JSON.parse(key); } catch { fail(); }
    if (!Array.isArray(pair) || pair.length !== 2 || !QUIET_PHASE_FIELDS.includes(pair[0]) || !pair.every(id => typeof id === 'string' && id.length > 0 && id.length <= 1024) ||
        JSON.stringify(pair) !== key || !object(phase) || !Object.keys(phase).every(key => ['status', 'startedAt', 'endedAt'].includes(key)) ||
        !['inProgress', 'completed'].includes(phase.status) || !timestamp(phase.startedAt)) fail();
    if (phase.endedAt !== undefined && (phase.status !== 'completed' || !timestamp(phase.endedAt) || phase.endedAt < phase.startedAt)) fail();
    if (phase.status === 'inProgress' && ++active > 1) fail();
    phases[key] = { status: phase.status, startedAt: phase.startedAt,
      ...(phase.endedAt === undefined ? {} : { endedAt: phase.endedAt }) };
  }
  return phases;
}

/** Called only for a new live item boundary or an exact terminal turn.
 * Journal observation order, not timestamp sorting, determines the active phase.
 */
export function advanceQuietPhases(value, at, after = undefined) {
  const phases = readQuietPhases(value);
  if (at !== undefined && (!timestamp(at) || Object.values(phases).some(phase => phase.startedAt > at))) fail();
  for (const phase of Object.values(phases)) {
    if (phase.status === 'inProgress' && at !== undefined) phase.endedAt = at;
    phase.status = 'completed';
  }
  if (after !== undefined && at !== undefined && !Object.hasOwn(phases, after)) {
    phases[after] = { status: 'inProgress', startedAt: at };
  }
  return readQuietPhases(phases);
}

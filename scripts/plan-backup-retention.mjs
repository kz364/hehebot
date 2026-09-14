#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

export const MAX_SNAPSHOTS = 4096;
export const MAX_INPUT_BYTES = 1024 * 1024;
const DAY = 86400000;
const JAKARTA_OFFSET = 7 * 3600000;
const invalid = () => { throw new Error('INVALID_RETENTION_INPUT'); };
function fields(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) invalid();
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^[2-9][0-9]{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid();
  return time;
}
const dayOf = time => Math.floor((time + JAKARTA_OFFSET) / DAY);
// Unix day zero was Thursday; Monday is day -3.
const weekOf = day => Math.floor((day + 3) / 7);
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Pure metadata calculation. Neither reads backup files nor authorizes deletion.
 * @returns {{version: number, as_of: string, timezone: string,
 * policy: {daily_calendar_buckets: number, weekly_calendar_buckets: number, week_starts: string, max_age_hours: number},
 * decisions: Array<{id: string, snapshot_at: string, action: 'keep'|'expire',
 * reason: 'maximum_age'|'bucket_selected'|'not_selected', buckets: Array<'daily'|'weekly'>}>}}
 */
export function planBackupRetention(input) {
  fields(input, ['now', 'snapshots']);
  const now = timestamp(input.now);
  if (!Array.isArray(input.snapshots) || input.snapshots.length > MAX_SNAPSHOTS) invalid();
  const ids = new Set();
  const rows = input.snapshots.map(snapshot => {
    fields(snapshot, ['id', 'snapshot_at']);
    if (typeof snapshot.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(snapshot.id) || ids.has(snapshot.id)) invalid();
    ids.add(snapshot.id);
    const time = timestamp(snapshot.snapshot_at);
    if (time > now) invalid();
    return { id: snapshot.id, snapshot_at: snapshot.snapshot_at, time, buckets: [] };
  }).sort((a, b) => b.time - a.time || lexical(a.id, b.id));
  const day = dayOf(now), week = weekOf(day), daily = new Set(), weekly = new Set();
  for (const row of rows) {
    if (now - row.time >= 28 * DAY) continue;
    const rowDay = dayOf(row.time), rowWeek = weekOf(rowDay);
    if (day - rowDay < 7 && !daily.has(rowDay)) { daily.add(rowDay); row.buckets.push('daily'); }
    if (week - rowWeek < 4 && !weekly.has(rowWeek)) { weekly.add(rowWeek); row.buckets.push('weekly'); }
  }
  return {
    version: 1, as_of: input.now, timezone: 'Asia/Jakarta',
    policy: { daily_calendar_buckets: 7, weekly_calendar_buckets: 4, week_starts: 'Monday', max_age_hours: 672 },
    decisions: rows.sort((a, b) => lexical(a.id, b.id)).map(row => ({
      id: row.id, snapshot_at: row.snapshot_at,
      action: row.buckets.length ? 'keep' : 'expire',
      reason: now - row.time >= 28 * DAY ? 'maximum_age' : row.buckets.length ? 'bucket_selected' : 'not_selected',
      buckets: row.buckets,
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) invalid();
    const chunks = []; let bytes = 0;
    // Bound both input volume and waiting for the complete catalog on stdin.
    const timer = setTimeout(() => process.stdin.destroy(new Error('INVALID_RETENTION_INPUT')), 5000);
    try {
      for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > MAX_INPUT_BYTES) invalid();
        chunks.push(chunk);
      }
    } finally { clearTimeout(timer); }
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    process.stdout.write(JSON.stringify(planBackupRetention(input)) + '\n');
  } catch {
    process.stderr.write('INVALID_RETENTION_INPUT\n'); process.exitCode = 1;
  }
}

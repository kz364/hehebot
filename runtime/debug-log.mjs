import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const RETAIN_DAYS = 7;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FORBIDDEN_KEYS = /token|secret|password|credential|authorization|text|body|payload|content|message$/i;

function today(now) { return new Date(now()).toISOString().slice(0, 10); }

/** Strips anything that looks like it could carry secrets, tokens or message
 * text/content, one level deep. Callers should still only pass ids, types,
 * sizes, durations and error codes -- this is a backstop, not the contract. */
function scrub(details) {
  if (!details || typeof details !== 'object') return details;
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    out[key] = typeof value === 'object' && value !== null ? '[object]' : value;
  }
  return out;
}

/**
 * Structured JSONL debug logging, no-op unless enabled. Never throws and
 * never blocks the caller: writes are fire-and-forget and failures are
 * swallowed. Logs component/event/details only -- never message text,
 * tokens, Access credentials or file contents (see scrub() above).
 */
export function createDebugLog({ enabled, stateDirectory, now = Date.now, retainDays = RETAIN_DAYS, maxFileBytes = MAX_FILE_BYTES } = {}) {
  if (!enabled) return { enabled: false, log() {}, async rotate() {} };
  const dir = join(stateDirectory, 'logs');
  let ready = null;
  const ensureDir = () => ready ??= mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
  // Writes are serialized through this chain (not just fire-and-forget) so the
  // per-day size cap below is exact even under a burst of concurrent log()
  // calls, and one day's file is opened for append at a time.
  let chain = Promise.resolve();
  let sizedDay = null, sizedBytes = 0;

  const log = (component, event, details) => {
    const line = JSON.stringify({ ts: new Date(now()).toISOString(), component, event, details: scrub(details) }) + '\n';
    const day = today(now);
    chain = chain.then(async () => {
      try {
        await ensureDir();
        const path = join(dir, `debug-${day}.jsonl`);
        if (sizedDay !== day) {
          sizedDay = day;
          sizedBytes = await stat(path).then(info => info.size, () => 0);
        }
        if (sizedBytes > maxFileBytes) return; // cap reached for today; drop rather than grow unbounded
        await appendFile(path, line, { mode: 0o600 });
        sizedBytes += Buffer.byteLength(line);
      } catch { /* logging must never fail the caller's work */ }
    });
  };

  const rotate = async () => {
    try {
      await ensureDir();
      const cutoff = new Date(now() - retainDays * 86_400_000).toISOString().slice(0, 10);
      for (const name of await readdir(dir)) {
        const match = /^debug-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
        if (match && match[1] < cutoff) await unlink(join(dir, name)).catch(() => {});
      }
    } catch { /* best-effort */ }
  };

  return { enabled: true, log, rotate };
}

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyControl } from './backup-control.mjs';
import { encryptControlBackup } from './encrypt-control-backup.mjs';
import { publishInventoriedBackup } from './prune-control-backups.mjs';

/** Encrypt an existing verified application snapshot into an explicitly inventoried directory.
 * No identity/private key, live extraction, pruning, inventory initialization or activation.
 */
export async function createControlBackup(snapshotDirectory, backupDirectory, { id, recipient, ageBinary, now }) {
  await verifyControl(snapshotDirectory);
  const frozen = await mkdtemp(join(tmpdir(), 'hehebot-create-'));
  try {
    for (const name of ['control.sqlite', 'manifest.json']) {
      await copyFile(join(snapshotDirectory, name), join(frozen, name), constants.COPYFILE_EXCL);
    }
    // Bind timestamp and encryption to this exact verified copy, not two reads of a mutable source.
    const manifest = await verifyControl(frozen);
    return await publishInventoriedBackup(backupDirectory, now, { id, snapshot_at: manifest.createdAt }, async staged => {
      await encryptControlBackup(frozen, staged, recipient, ageBinary);
      const digest = createHash('sha256'); let bytes = 0;
      for await (const chunk of createReadStream(staged)) { bytes += chunk.length; digest.update(chunk); }
      return { bytes, sha256: digest.digest('hex') };
    });
  } finally { await rm(frozen, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 6) throw new Error('USAGE');
    const [snapshot, directory, id, recipient, ageBinary, now] = args;
    console.log(JSON.stringify(await createControlBackup(snapshot, directory, { id, recipient, ageBinary, now })));
  } catch { console.error('CONTROL_BACKUP_CREATE_FAILED'); process.exitCode = 1; }
}

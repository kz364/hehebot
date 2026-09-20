import { lstatSync as realLstatSync, readFileSync as realReadFileSync, realpathSync as realRealpathSync } from 'node:fs';
import { inspectOwnerAlphaLaunchFloor } from '../../runtime/owner-alpha-launch-floor.mjs';

// F3 warm auto-stop fixture: the launch floor's root-owned surfaces staged as
// trusted test I/O. This sandbox runs as uid 1000 without root, so it cannot
// create the root-owned /etc/codex/requirements.toml and /etc/codex/config.toml
// that production's launch floor reads; the pristine Codex 0.154.0 process
// therefore reports configRequirements/read as {requirements:null}. The floor
// inspection seam (its second argument is documented trusted test I/O, never
// runtime input) presents exactly those two production paths with staged
// root-owned bytes, and STAGED_REQUIREMENTS_READBACK is the matching reply for
// the single 'configRequirements/read' interception on the launch seam. Every
// other byte the entrypoint verifies — config/read with layers, account/read,
// model/list and the native turn itself — comes from the real pinned process.
const REQUIREMENTS_PATH = '/etc/codex/requirements.toml';
const SYSTEM_CONFIG_PATH = '/etc/codex/config.toml';
const SYSTEM_DIRECTORY_PATH = '/etc/codex';

export const STAGED_REQUIREMENTS_READBACK = Object.freeze({
  requirements: Object.freeze({ allowRemoteControl: false, featureRequirements: Object.freeze({ memories: false }) }),
});

const stagedRootFiles = new Map([
  [REQUIREMENTS_PATH, Buffer.from('allow_remote_control = false\n\n[features]\nmemories = false\n', 'utf8')],
  // Empty staged system config: the pristine process reports the system layer
  // for this exact production path with an empty merged config while the file
  // is absent, so an empty present file keeps floor and native readback identical.
  [SYSTEM_CONFIG_PATH, Buffer.from('', 'utf8')],
]);

const rootStat = (bytes) => ({
  uid: 0,
  gid: 0,
  mode: bytes === null ? 0o040755 : 0o100644,
  size: bytes === null ? 4096 : bytes.length,
  isSymbolicLink: () => false,
  isDirectory: () => bytes === null,
  isFile: () => bytes !== null,
});

const stagedFloorFs = {
  lstatSync: (path) => {
    if (path === SYSTEM_DIRECTORY_PATH) return rootStat(null);
    const staged = stagedRootFiles.get(path);
    if (staged !== undefined) return rootStat(staged);
    return realLstatSync(path);
  },
  readFileSync: (path) => {
    const staged = stagedRootFiles.get(path);
    return staged !== undefined ? staged : realReadFileSync(path);
  },
  realpathSync: (path) => (path === SYSTEM_DIRECTORY_PATH || stagedRootFiles.has(path))
    ? path : realRealpathSync(path),
};

/** The real floor inspection over the real home/cwd, with only the two
 * root-owned production floor paths staged; deterministic in its inputs. */
export function stagedLaunchFloor({ home, cwd }) {
  return inspectOwnerAlphaLaunchFloor({ home, cwd }, { fs: stagedFloorFs,
    requirementsPath: REQUIREMENTS_PATH, systemConfigPath: SYSTEM_CONFIG_PATH });
}

import { createCodexService } from '../codex-service.mjs';

/** An always-on machine (VPS, laptop, container): nothing pauses, so no wake hold. */
export function createHost() {
  return { createService: createCodexService };
}

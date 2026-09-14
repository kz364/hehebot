import { SpritesTasksClient } from '../.local/codex-service/sprites.mjs';
import { createSpritesTaskTransport } from './sprites-task-transport.mjs';
import { createCodexService } from './codex-service.mjs';

/** Run scripts/build-codex-service.sh first. The emitted provider module is built
 * from src/providers/sprites.ts; this adapter never copies its hold semantics.
 * Production starts still reject. spriteRequest is only a disposable test seam.
 */
export function createSpriteCodexService(config, { spriteRequest, ...dependencies } = {}) {
  const tasks = new SpritesTasksClient(createSpritesTaskTransport({ request: spriteRequest }), dependencies.now);
  return createCodexService(config, { ...dependencies, tasks });
}

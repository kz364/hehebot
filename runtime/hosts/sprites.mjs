import { SpritesTasksClient } from '../../.local/codex-service/sprites.mjs';
import { createSpritesTaskTransport } from '../sprites-task-transport.mjs';
import { createSpriteCodexService } from '../sprites-codex-service.mjs';

/** Fly Sprites: the VM pauses once a request is answered and no activity is
 * held, so a wake holds a native Task until the service's own hold takes over. */
export function createHost() {
  const tasks = new SpritesTasksClient(createSpritesTaskTransport({ timeoutMs: 3000 }), Date.now);
  return {
    createService: createSpriteCodexService,
    holdWake: (epoch, { holdMs }) => tasks.hold({ id: `hehebot-v2-wake-${epoch}`, expiresAt: Date.now() + holdMs }),
  };
}

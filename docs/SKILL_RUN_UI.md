# Portal Run once

Approved skill cards expose **Run once** outside owner-alpha mode. The dialog binds the currently displayed approved skill revision and one active persona revision, accepts nonblank input up to 32,768 UTF-8 bytes/codepoints, and requires explicit confirmation.

This is ordinary gated execution under the selected bot/runtime permissions. It is not a dry run, isolated test, no-effects mode, or safety guarantee; existing effect approvals still apply. It does not alter per-bot skill enablement. When execution is disabled, the portal says the accepted request waits durably. Unstarted captured input expires after 30 days regardless of the execution flag. The selected skill stays pinned, but ordinary persona/context/permission checks run again at claim.

Before dispatch the portal rejects changed/deleted skills, changed/deleted/archived bots, navigation, offline state, and owner-alpha activation. Alpha activation remains latched for the page lifetime, including when first observed on the Skills page. An uncertain response can only be explicitly retried in the same editor with the identical idempotency key and body; editing bot/input blocks that retry. The server assigns the command ID. On success the portal selects the target conversation only if the user has not navigated away. Retained `message.user.skill_invocation` metadata labels the original skill name and revision, not a later catalog rename. The narrow editor scrolls internally with a separate confirmation footer.

## Evidence boundary

`scripts/test-portal-skill-run.mjs` is a synthetic Chromium/HTTP contract fixture. It does not prove the backend claim/retention implementation, live model behavior, permissions, effects, providers, push, deployment, or native Mac rendering.

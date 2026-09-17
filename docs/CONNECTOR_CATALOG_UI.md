# Owner connector diagnostic baseline

Connectors is an on-demand managed page beside Skills. It reads only `GET /v1/connectors/catalog` when opened (including a restored browser selection), and on explicit **Refresh catalog**. Ordinary state refresh never polls the catalog or treats either managed page as a conversation. Opening the page performs no command, probe, wake, installation, pairing, enablement or grant.

The page labels the response as a bundled baseline with unobserved runtime inventory and no granted authority. WhatsApp's pinned package/version/revision, source as inert text, evidence scope, prerequisites and separate recent-message/scoped-search protocol statuses are displayed. The recent-read blocker stays alongside search evidence. Disposable artifact verification is not an installed, paired or callable runtime, a freshness observation or overall readiness. No other provider status is inferred.

All catalog text uses `textContent`. The rendered contract is validated before display; malformed and failed responses replace old content with a read error. Selection identity fences late replies. Offline state clears the baseline and outstanding request identity; reconnect requires manual refresh. Owner-alpha hides the entry, clears the page, and denies new reads, including a restored selection and the existing latched-alpha state. No catalog cache survives reload.

## Local verification

Run `node scripts/test-portal-connector-catalog.mjs`. This serves the real portal to Chromium against synthetic HTTP and checks exact GET paths, no commands, no catalog reads from global refresh, reload selection, asymmetric protocol statuses, literal hostile markup/source, malformed and HTTP failures, loading, offline/reconnect/manual refresh, navigation/late replies and alpha activation/latch. It checks hidden conversation controls, top-of-page entry and no horizontal document overflow at 1280px and 390px; captures use devicePixelRatio 2.

Neighboring checks: `node scripts/test-portal-skill-draft.mjs`, `node scripts/test-portal-tasks.mjs`, `node scripts/test-portal-alpha-session.mjs`; JavaScript syntax: `node --check public/app.js`.

Representative inspected captures are generated under `.amp/in/artifacts/connector-catalog-{desktop,narrow,loading,error,malformed}.png`. Long content scrolls inside the existing timeline. The narrow capture is Chromium viewport emulation, not touch-device or Safari verification. These synthetic checks do not prove deployed authorization, live connector compatibility, installation, pairing, tool availability or account access. Host owns combined verification and integration; no live calls or publication are part of this UI work.

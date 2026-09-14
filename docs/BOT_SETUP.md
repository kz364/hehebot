# Bot setup migration — shared Sprite + paired Mac

Prepared 2026-09-10 from the owner's Grok export. This is the shareable setup summary; the complete adapted instructions and private migration context are in ignored `.local/imports/bot-routines-setup.md`. Original Downloads backup remains unchanged. Do not commit the source or private copy: they contain personal identity and contact information.

## Native-first setup

Use supported Codex app-server 0.154.0 thread, turn, event, steering and cancellation interfaces. Do not modify runtime internals or build a second model/tool loop. Prove remaining gaps before implementing a thin adapter.

## Architecture

Use one Sprite and one authoritative runtime, Cloudflare portal/API/scheduler, and one optional paired Mac. Create Chief of Staff, Inbox Triage, Whatsapp, Messages and Travel as native personas. Omit the empty New Bot stub. Each persona has a responsive coordinator plus isolated background task sessions, as required by [BOT_ORCHESTRATION_ADDENDUM.md](BOT_ORCHESTRATION_ADDENDUM.md).

Connector accounts are installation-owned and shared through scoped tools. One WhatsApp account/session, one Google account connection with the necessary Gmail/Calendar scopes, and one paired Mac Messages capability; no per-bot VMs, duplicate WhatsApp pairing or copied OAuth caches. Shared login does not broaden the WhatsApp routine beyond the approved family chat. Chief of Staff reads task/event status and delegates; it need not scan raw private connector content for a digest.

## Routine migration

All imported routines initially disabled pending setup validation/adoption. Source Enabled=True is historical state, not a new scheduler command. Adopt once, preview next three executions, then enable chosen routines only when auth and scope prerequisites pass. A preview should allow adopting all listed bounded workflows together; avoid repetitive confirmation per routine when the owner authorizes the reviewed batch.

Proposed monitoring timezone is `Asia/Singapore`, based on the later per-bot cadence instructions. The export header instead says `Asia/Jakarta`; show this conflict prominently at adoption. Preserve cron hours `1,7,9,11,13,15,17,19,21,23` (10 runs/day). This is 07:00,09:00,…,23:00,01:00 SGT, with no 03:00/05:00 run. School event times remain Asia/Jakarta regardless of monitoring timezone.

| Canonical owner | Routine | Cron | Zone |
|---|---|---|---|
| Inbox Triage | Francesca email → calendar | `2 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore, proposed |
| Inbox Triage | JIS school email → calendar | `4 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore, proposed |
| Whatsapp | Francesca WhatsApp → calendar | `5 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore |
| Messages | SMS/iMessage appointments → calendar | `6 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore |
| Inbox Triage | Flight email hold triage | `8 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore, proposed |
| Inbox Triage | Flight email restore reconciliation | `0 4 * * *` | Asia/Singapore |
| Chief of Staff | End-of-day digest | `0 21 * * *` | Asia/Singapore, proposed |

Delete imported CoS WhatsApp/email backup kick duplicates; scheduler watchdog/retries own recovery. Move Messages' CoS kick to a direct Messages-owned occurrence. CoS EOD uses durable results/material events first and asks another bot only if essential status is missing; no “nothing” inference fan-out. Different routine slots may share one awake period, but are not silently rescheduled. At this cadence there are 50 monitoring runs/day plus digest and restore, not the earlier illustrative 10 tasks/day: recalculate cost and inspect monthly wake/active-time projections before enabling.

Flight restore deadlines must also be durable one-shot Cloudflare alarms, keyed by itinerary leg, rather than relying on the 04:00/2-hour reconciliation to hit departure-minus-8-hours deadlines. Scheduler owns occurrence dedupe; connector sync watermarks own coverage. Both must survive sleep.

## Setup guide refresh required after implementation

Keep AUTH_SETUP.md, SETUP.md and README aligned with implemented commands and verification. Include Gmail read/label behavior with no-send enforcement, Calendar writes and exact account/calendar selection, one WhatsApp binding and exact chat, Mac reader permissions/offline catch-up, private Travel profile review, Codex concurrency, locks, timezone preview, and connector-specific effect policies. Use no-secret smoke tests and distinguish mocks from live checks.

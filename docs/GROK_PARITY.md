# Grok Bot behavior audit — 2026-09-13

**Verdict: the product direction matches, but this repo is not yet a working Grok Bot replacement.** The control plane is substantially implemented; the native executor and model-driven tools remain blocked. This audit compares public documented behavior, not Grok internals or a live authenticated Grok session. Existing owner-specific requirements remain authoritative; research does not activate routines or grant permissions.

## Corrected premise: Grok already shares one computer

The official [computer guide][computer] says: “The computer is assigned to your user account, not an individual Bot.” Files, browser cookies, sessions and command-line credentials are shared. Each Bot has its own screen; one computer-use task occupies that screen at a time. Separate screens permit parallel work, not credential isolation.

One shared runtime therefore matches Grok's published topology. Clawbot's material infrastructure difference is **externally scheduled, sleeping self-hosted compute** rather than a managed Grok computer. Application memory ACLs and constrained tools are additional Clawbot requirements; private directories alone do not enforce them.

## Evidence-to-implementation matrix

“Partial” means actual application code exists but the native/model path or user-facing surface is incomplete. Scenario IDs refer to SPEC S01–S32 and native O01–O09; they are acceptance targets, not pass claims.

| Behavior documented by Grok | Clawbot evidence / gap | Acceptance or decision |
| --- | --- | --- |
| Named Bots with stable jobs, descriptions, conversations and learned memory [B,D] | Persona revisions and timelines exist in `src/core/control.ts`; coordinator continuity/learned memory ingestion do not. Three sample bots seed locally; five intended bots require reviewed import. | Partial; S09, O01–O03. |
| Skills/tools account-wide; memory/routines belong to the Bot [D,S] | Scoped memory projection exists; native retrieval ACLs remain unproved. No portal skill creation/catalog/invocation path. A skill memory scope is not a working skill system. | Partial; S10–S11, S30; add native skill mapping before claiming parity. |
| Natural-language routine creation shows next run/timezone; schedule or supported external event starts work [S] | Structured routine CRUD, cron preview and signed generic triggers exist. No model-facing routine authoring tool. | Partial; S14–S18, S23–S24. |
| Routine Test run executes real work; edit/pause/delete and recent success/failure history [S] | Schedule editing exists; full native run-now/result path and deletion parity remain absent. Never label a mocked run a real test run. | Partial; test success, missing input, ambiguity, permission stop and a real attributed result. |
| Bots asynchronously message/wake other Bots and later reply [C] | Room action queues and native child receipt ledger exist; the ledger does not spawn children. Full native dispatch/result ingestion is missing. | Partial; S12–S13, O06–O08. |
| Unaddressed group messages let Bots decide who responds; mentions target one/multiple Bots; groups have 2–6 Bots [C] | Fixed default responder, room membership up to eight, fan-out/hop/contribution budgets. No composer mention resolver established. | Deliberate cost-bounded routing difference; membership/composer parity gap. |
| New direct messages take priority and can redirect the current turn; “Stop now” does not undo prior actions [C] | Owner wants a Puck/Codex-voice-style coordinator: intentionally steer an identified task or queue separate work according to intent. Current exact follow-ups wait for settlement; natural-language steering/cancellation is not wired. | Preserve intentional interruption AND non-interruption for unrelated messages. O01–O04; after-settlement-only behavior is a gap, not the desired difference. |
| Transcript includes tool/computer activity, files, approvals, threaded replies and reactions; composer accepts attachments, `/skills`, `@` references [C] | Text timelines/task cards are partial. Native activity ingestion, attachments/artifact UX, reactions, thread/search and reference menus are not equivalent. | UI/product backlog, not satisfied by HTTP asset checks. |
| Persistent shared browser/files/logins; watch computer and take over sensitive steps; work survives laptop closure [V] | Transport and provider abstractions exist; Sprite service is preflight-only. No working portal desktop takeover, connector persistence or full checkpoint/recovery proof. | S04–S08, S21, S26–S27, S29, O08 remain native/live gates. |
| Allow once / Deny / Always allow; matching Require Approval wins over Always Allow; secure secret inputs bypass transcript [A] | Application policy allowlists and effect/approval records exist; native tool enforcement and secure handoff UI are incomplete. Do not equate model-based Grok Auto Review with deterministic Clawbot policy. | Partial; S20–S23; test at the actual effect boundary. |
| Duplicate copies settings/skills/routines but not learned memory/history/attachments; public sharing copies configuration, not credentials [B] | Reviewed hash/revision-bound disabled batch import exists; not Grok duplication/public template sharing. | Optional import scope; S28. No need to build sharing to adopt the owner's supplied export. |
| Teach a task records up to ten minutes of visible interaction, no microphone audio, producing a draft skill [S] | Not implemented. | Additional product capability, outside current core rollout. |
| Up to 50 routines per Bot, last 20 run records; unattended inactivity can pause routines [S] | Max 20 enabled routines per installation; explicit retention/expiry requirements differ and sweeps are pending. | Deliberate usage cap; history and inactivity-pause parity are not established. |

## Important distinctions from teardowns

- [Flavio Copes's detailed walkthrough][guide] (updated August 30) corroborates shared-computer state, narrow roles, one-time task → skill → routine, and noisy multi-Bot loops. Its report that the group host wakes every member is a secondary observation, **not an official exact dispatch algorithm**. Clawbot's zero-inference context-update invariant is an intentional optimization, not a verified Grok feature.
- That walkthrough's older mobile availability differs from the September 2 official collaboration page mentioning Android. Prefer the dated official feature docs; do not transplant an old platform matrix.
- [Vellum's breakdown][teardown] is competitor marketing despite “Official” in its title. Its memory/UI absence and pricing claims are not authoritative. The design article establishes role-scoped memory, but does not specify the storage/retrieval algorithm or a memory API. We do not claim to replicate either.
- The [official design article][design] explains the roster-first experience and shared capabilities versus role-specific context. Its broad “runtime” wording must not override the explicit account-level computer documentation.
- Notification silence and absence of work are different. A successful empty scheduled scan can still consume inference; a data-only publication in Clawbot must consume none. Missing connector coverage must never become “all quiet.”

## Implementation priorities exposed by this audit

1. Finish one thin native executor path: durable claim → stable native submission → task/event correlation → complete activity/effect settlement → durable attributed result. Preserve unknown-outcome and sleep gates.
2. Wire typed routine and scoped-memory tools into that path; prove model-produced proposals against command schemas and authorization, not just model text. Use synthetic accounts/effects first.
3. Prove coordinator responsiveness and exact-task follow-up/cancel under live overlapping native work (O01–O09). Then prove bounded cross-bot dispatch. Do not synthesize a second orchestration framework around Amp threads.
4. Finish real artifact/approval/handoff and browser acceptance paths; separately test native transcript/search isolation and shared-browser conflict handling.
5. Only then validate selected-provider restart, model auth refresh, connector catch-up, restore and measured cost. Multi-orb unit runs cannot substitute for these gates.

The missed-alarm ingress gap found in this audit is fixed: command, receipt, timeline, state and trigger entry points now share local overdue reconciliation and alarm rearming, without provider calls on ingress. Eight SQLite-backed RPC regressions cover missed/coalesced occurrences, concurrent chat/read dedupe, duplicate trigger receipts, failed reads and idle no-poll behavior; all pass in two orbs. They mock Cloudflare host/alarm functions and do not prove live provider single-boot behavior. Other unpassed coverage includes simultaneous message + due occurrence/single boot, restart HTTP dedupe, misfire skip/lateness boundaries and randomized drain interleavings.

## Sources and confidence

Read 2026-09-13. Official documentation defines advertised behavior, not measured reliability. No private Grok conversations, credentials, hidden endpoints or proprietary code were accessed.

- **B:** [Create and manage Bots][bots] (September 7).
- **C:** [Message and collaborate][chat] (September 2).
- **S:** [Skills and routines][skills] (August 11).
- **V:** [Computer and apps][computer] (August 11).
- **A:** [Approvals, security and privacy][approvals] (September 2).
- **D:** [Designing Grok Bot][design] (September 3).
- Secondary: [Flavio Copes walkthrough][guide]; [Vellum competitor breakdown][teardown].

[bots]: https://docs.x.ai/grok-bot/bots
[chat]: https://docs.x.ai/grok-bot/chat-and-collaboration
[skills]: https://docs.x.ai/grok-bot/skills-routines-and-automations
[computer]: https://docs.x.ai/grok-bot/computer-and-apps
[approvals]: https://docs.x.ai/grok-bot/approvals-security-and-privacy
[design]: https://x.ai/news/designing-grok-bot
[guide]: https://flaviocopes.com/grok-bot/
[teardown]: https://www.vellum.ai/blog/official-grok-bot-breakdown

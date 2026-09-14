# Bot experience additions and runtime decision gate

Status: normative UX detail incorporated into SPEC v0.5, not implemented functionality.
[SPEC section 21](SPEC.md#21-consolidated-product-and-apache-reuse-contract) is the consolidated entry point for S/O, UX01–UX15, Apache reuse, and sleeping-container acceptance R01–R08. Codex app-server 0.154.0 is selected; this document does not authorize deployment, account connections, copying credentials, or activating routines.

## 1. Scope and precedence

Extend the Hehebot portal and control plane with a small, coherent bot experience. Preserve the safety, authorization, scoped-memory, resource-lock, receipt, and cold-start requirements in [SPEC.md](SPEC.md) and [project intent](docs/PROJECT_INTENT.md). Codex app-server 0.154.0 is the sole harness.

The default product consists of conversations, tasks, routines, and an optional computer view. It must not require understanding native sessions, backend processes, peer gateways, or model-harness internals. One installation has one authoritative execution host; bots do not require individual VMs. A local device is an optional peripheral, not an additional authority.

The target is the complete publicly documented Grok Bot capability and UX surface, not a preset family-office or coding assistant. The five-persona migration is one installation's configuration, not the product ontology. Optional UI means opt-in use, not permission to omit that capability from the parity backlog. Provider freedom and intent-aware interruption are deliberate differences. Public documentation cannot establish undocumented behavior or guarantee identical reliability; unknowns remain explicit acceptance gaps.

Sources of inspiration, not dependency or compatibility promises:

- [Hermes Bot Mode](https://hermes-agent.nousresearch.com/docs/user-guide/bot-mode): canonical chats, progressive disclosure, routine ownership, attributed messaging, bounded groups, and shared auth.
- [Hermes Bot Kit](https://github.com/thomasbek3/hermes-bot-kit): quiet chat, grouped roster, compact task presentation, computer viewer, and staged installers.
- [Hermes Codex runtime](https://hermes-agent.nousresearch.com/docs/user-guide/features/codex-app-server-runtime): alternative-runtime tradeoffs, auxiliary inference, and capability gaps.

These sources were inspected, not benchmarked as a deployed alternative. Source on a moving main branch is not a tested release contract.

## 2. Incremental requirements

### UX01 — One persistent visible conversation per bot

- Clicking a bot always opens its canonical application conversation. Renaming, refresh, device changes, runtime restarts, and native context compaction must preserve that identity.
- Native executor sessions remain hidden. Multiple independent tasks may belong to the same visible conversation without sharing active execution context.
- Context compaction must not delete the visible timeline or silently create a new relationship. Persistent conversation identity does not mean infinite transcript retention: existing retention and deletion rules still apply.
- If slash-command interception is offered, explain compaction rather than silently forwarding a session-reset command. Do not promise unsupported native commands.
- Acceptance: rename and reload during an active task; compact/restart the native context; verify the same application conversation, attributed outcomes, and no duplicate task submission.

### UX02 — Minimal creation and capability setup

- Default creation fields: name, role, and instructions. Put model selection, tools, skills, connector references, and device permissions behind Advanced.
- Offer a minimal profile without bundled optional skills. Do not clone credentials, private memories, active tasks, or connector authority when duplicating a bot. Any instruction/capability copying must be explicit and reviewable.
- Default to one installation-owned model auth arrangement supported by the selected runtime; no per-bot OAuth refresh races or per-bot VMs.
- Save a bot without inference. An optional generated introduction must be explicit and counted as a model call.
- Acceptance: minimal creation makes no model call or wake request; unauthorized capability IDs are rejected server-side; duplicate is a new identity without copied account state.

### UX03 — Find and organize bots

- Add search, activity previews, and optional collapsible named sections. Keep a plain roster usable without creating sections.
- Section creation, rename, ordering, membership, and collapse state are application metadata. Manual organization must not be overwritten by model output.
- Hide is display-only, distinct from archive, delete, or disabling routines. Explain this distinction and expose attention counts for hidden bots without silently losing approvals or recovery notices.
- If active-state indicators are shown, derive them from attributed task activity, not a connected socket or animation timer. Stale observations must be marked stale.
- Acceptance: deleting a section returns its bots to the unassigned roster; no bot or routine is deleted. Metadata survives reload and does not enqueue inference.

### UX04 — Quiet chat with truthful live status

- Use readable chat bubbles and a compact working indicator. Collapse routine tool/reasoning detail by default, with an Activity disclosure for available execution events; do not require exposing private model reasoning.
- Never hide approvals, failures, waiting reasons, uncertain outcomes, or bot-to-bot attribution behind the quiet mode.
- Stream available assistant text and typed activity through authenticated application interfaces. A partial stream is not a committed final reply; reconnect must recover committed events without duplicates or crossing conversation boundaries.
- Acceptance: disconnect midway through a turn, switch bots, and reload. Preserve partial/final distinction and exactly one final result; approvals remain reachable in quiet mode.

### UX05 — Persistent task strip and intent-aware control

- Place a compact task strip near the composer, with title, owner, status, and an expandable detail view. Read authoritative application task records, not DOM snapshots or CSS-derived status.
- Offer exact task follow-up, steer/interrupt when supported, and cancellation. Distinguish request accepted, queued, applied, cancellation requested, and definitively settled.
- Ordinary owner messages must not automatically interrupt work. The coordinator resolves status questions, new independent work, intentional steering, and deferred follow-up; ambiguous targets require clarification rather than guessing.
- A needs-you indicator aggregates unresolved approvals, questions, and recovery items. Clearing one reason must not clear unrelated attention.
- Acceptance: with tasks A and B present, steering/cancelling A never changes B; a status request changes neither. Lost acknowledgments retain uncertainty and never cause blind resubmission. Task-strip state survives reload.

### UX06 — Routines beside the owning bot

- Replace raw-cron-first editing with a frequency/time/day picker, explicit timezone, next-three-run preview, and pause/resume controls. Keep raw cron in Advanced.
- Natural-language creation prepares a validated proposal through the same routine command contract. Source text cannot authorize capabilities or activate imported routines.
- Routine results appear in the owning bot's conversation with routine/task attribution. Successful empty monitoring runs stay quiet when their adopted policy requires it.
- Timezone defaults come from installation settings; display the actual schedule zone and surface imported conflicts. Do not infer routine changes from the browser timezone.
- Acceptance: test DST boundaries, timezone changes, invalid cadence, missed ticks, duplicate alarms, and preview/save equivalence. Native cron must not also execute an application-owned occurrence.

### UX07 — Attributed delegation and optional bounded groups

- Resolve mentions to stable bot identities and allowed targets. Unknown mentions and email addresses are not routing instructions.
- Coordinator delegation carries scoped task context and attribution; do not forward entire private transcripts or grant permissions through message text.
- Distinguish durable delivery acknowledgment from completed work. Preserve delivery identity through retries and inspect unknown outcomes instead of replaying them.
- Groups are optional. Default to explicitly addressed participants; do not make every bot answer every ordinary message. Use existing room policy limits, with a bounded proposal of at most three serial rounds and ten messages per initiating send, stopping earlier when no useful work remains.
- Room execution belongs to the authoritative backend and must not depend on an open browser/Desktop courier. A passive context update invokes no inference and requests no wake.
- Acceptance: close the portal during a discussion, reopen and recover ordered attributed events; enforce round/message budgets and exact delivery dedupe. Unrelated bots remain silent.

### UX08 — Optional computer pane and safe handoff

- Provide a contextual computer panel with explicit device selection, connection state, thumbnail/view/fullscreen, and a clear distinction between viewing and controlling.
- Keep one viewer connection when toggling fullscreen where supported. Viewing old history must not wake compute. Live-task auto-connect may follow authoritative activity only under an explicit viewing preference.
- Showing a screen must not grant control or bypass task/device resource locks. Manual control requires exclusive ownership and confirmed agent pause/settlement; otherwise show view-only or block handoff.
- Use authenticated, origin-restricted transport. Never expose raw runtime/CDP/VNC endpoints, place secrets in browser storage/URLs, or copy personal browser profiles.
- Prefer the selected runtime's supported browser/computer boundary. VNC/H.264 is optional viewing infrastructure, not a replacement agent harness or proof of tool settlement.
- Warm resume requires reconnect and ownership checks. Cold wake invalidates live tab/frame references; restore from durable task state and re-observe the page. Do not claim arbitrary unsaved forms survive.
- A computer timeout is an unknown outcome until reconciled. Never blindly repeat submission, typing, payment, or another mutation.
- Acceptance: wrong-device rejection, stale-frame rejection, reconnect without duplicate input, safe fullscreen transition, offline device waiting, and uncertain handoff. Real Mac permission checks remain hardware acceptance.

### UX09 — Cloneable setup and maintained releases

- Provide a short setup path with version-pinned runtime/plugins, validated configuration templates, explicit minimal capabilities, and idempotent verification commands.
- Stage upgrades, verify integrity, preserve existing configuration, and support rollback with documented native-data migration limits. Never overwrite unknown installations or patch installed dependencies.
- Keep credentials, OAuth caches, connector data, and personal imports out of distributable artifacts. Each installation authorizes its own accounts; shared auth within an installation does not mean sharing tokens across installations.
- Keep provider lifecycle behavior behind existing provider ownership. Sprites uses renewable activity holds; an always-on host need not pretend to support suspension. Do not require all providers to pass before releasing the selected provider.
- Show setup states: ready, user authorization required, unsupported, or implementation incomplete. Successful environment checks must not label the assistant operational.
- Acceptance: repeat setup in a second independent orb without code fixes or copied credentials; test interrupted installation, integrity failure, configuration preservation, and rollback boundaries. Other-VM debugging is not the default workflow.

### UX10 — Observable model overhead

- Record available model request/token usage per task and distinguish useful execution from coordinator, title, summary, memory-review, retry, and group-turn overhead. Unknown usage is unknown, not zero; estimates are not billing receipts.
- Deterministic UI actions, status reads, roster changes, and passive context updates must not invoke a model.
- Optional introductions, automatic review loops, broad teammate prompting, and extra model services are off unless required by an adopted feature. Do not silently add paid fallbacks.
- Acceptance: compare identical workloads with the same model, tool access, output requirements, and cold/warm context conditions. Report correctness, calls, token breakdown, latency, and retries; do not select a runtime from token count alone.

### UX11 — Agent-authored skills and controlled learning

- Support “save the process we just used as a skill,” explicit learning from supplied notes/files/URLs, and conversational create, inspect, edit, enable/disable, and delete. Search existing relevant skills before creating duplicates; propose an update when the procedure already exists.
- A skill records when to use it, inputs/access, steps and decision rules, validation, output, failure handling, and approval boundaries. Use portable instruction files with supporting references/scripts; load catalog metadata first and full content only when needed. Keep mutable task/routine state and private facts outside shared procedures.
- Maintain an installation catalog with per-bot enablement, stable IDs, revisions, provenance, and reviewable diffs. Bind accepted work to its admitted skill revision; edits cannot silently rewrite running tasks. Changes to supporting executable files are capability changes, not harmless prose.
- Explicit owner requests may authorize bounded skill writes under installed policy. Imported content and self-generated lessons never grant authority. Optional automatic post-task review must have an adopted cadence, bounded inference budget, restricted tools, and reviewable proposals; it is off by default. Do not infer that every successful task should trigger another model loop.
- Provide approve/reject for staged changes and restoration of earlier revisions. Skill revision rollback cannot undo external effects. Creating a skill does not activate a routine or grant connector access.
- Acceptance: teach from a corrected task, update rather than duplicate an existing skill, inspect its diff, test on different safe inputs, and invoke it from another enabled bot. Reject imported approval-bypass text; verify scope isolation, pending proposals across restart, and unchanged revisions for already-admitted work.

### UX12 — Complete conversational routine lifecycle

- Support create/list/inspect/edit/pause/resume/delete/run-now and one-shot, recurring, and supported event-triggered work through the same typed commands used by the portal. An unambiguous authorized creation can commit once without redundant confirmation; ambiguity yields a proposal/question, never a guessed timezone or authority expansion.
- Show owner, inputs, skill references, schedule and timezone, next runs, output destination, missing/stale-input behavior, and approval policy. Changing instructions or skills creates a revision; history identifies the revision that actually executed.
- A Test run performs real work under ordinary effect approvals, not a dry run. Give manual runs their own occurrence identity; define whether a paused routine may run once without resuming it. Pause/delete prevents future admission, not implicit cancellation or reversal of an existing occurrence; expose exact-task cancellation separately.
- Start each occurrence with scoped durable memory and its own task context, not the author's entire chat. Preflight missing configuration before inference where possible. Separate execution success, delivery failure, blocked configuration, and uncertain effect outcomes. Completed work with failed delivery must not rerun its effects merely to resend the result.
- Provide recent run history, explicit missed-run policy, and optional inactivity/budget suspension with notice and deliberate resumption. Routine-authored changes remain inside adopted policy; unattended recursion must not create unbounded schedules.
- Acceptance: natural-language create → safe real test → edit → pause → run once → resume → delete, including duplicated commands, crash after effect but before delivery, missing credentials, and schedule/skill revision races. UX06 timezone and native-cron dedupe tests also apply.

### UX13 — Remaining interaction and knowledge parity

- Add attachments, downloadable artifacts and previews, source links, searchable conversation history, threaded replies/reactions, `/skill` and `@` bot/group/routine/connector references. Resolve references to authorized stable IDs rather than trusting textual names.
- Expose scoped learned memory for inspection, correction, deletion and provenance; separate remembered facts from reusable procedure and searchable history. Corrections invalidate affected projections without claiming erasure from unrelated backups or external systems.
- Distinguish unread activity, active work and needs-attention. Support per-bot notifications, manual read/unread, focus suppression and light/dark/system appearance. Permission denial or absent mobile push support must be visible, not silently treated as delivery.
- Acceptance: reconnect, switch bots and use mobile/keyboard navigation with attachments, references and pending approvals. Search cannot cross unauthorized scopes; correcting a private fact must not leak it into a shared skill. Dismissing a notice never erases an unresolved action.

### UX14 — Demonstrations, integrations and portable templates

- Include opt-in teach-by-demonstration: explicitly start/stop visible interaction capture, show recording state, exclude microphone audio, generate a reviewable draft skill and test it safely before automation. Grok documents a ten-minute capture limit and gradual rollout; match the workflow without treating observation as permission to replay secrets or writes.
- Provide connector/packaged-skill discovery, install/enable/disable, per-tool restrictions and secure credential handoff. A full marketplace service is not a prerequisite for a curated install catalog, but discovery/install behavior remains in scope. Connector coverage must be named individually; a generic MCP client is not proof every Grok integration works.
- Duplicate and export/import bots, skills and routines with a diff/omission preview. Duplication excludes history, attachments, memory and credentials by default. Templates can explicitly include selected reviewed memories; require audience review before sharing and never publish implicitly. Imports start with disabled routines and unresolved auth references.
- Export application-owned state in a documented versioned format so leaving a model, harness or VM provider does not lose bot identity, conversations, skill revisions, routine definitions or effect receipts. Secret/account reauthorization and nonportable native session state must be disclosed separately.
- Acceptance: export into a second clean orb with no credential transfer, inspect omissions, rebind capabilities and verify stable application meaning without activating schedules. Reject unknown bundle semantics and traversal/executable content outside adopted install policy. Record hardware and external-account tests separately from orb proof.

### UX15 — Harness-neutral orchestration, explicit capability gaps

- The product owns bot/conversation/task identities, durable accepted work, memory authority, skill/routine definitions, policies, approvals, receipts and user-visible outcomes. An executor owns its model/tool loop and private native session state. Use verified native primitives rather than duplicating their internals; one component owns each scheduled occurrence and dispatch.
- The coordinator remains available during long work and chooses answer/status, new task, exact-task steer, deferred follow-up, or cancellation according to intent. Deterministic UI/status operations bypass inference. A coordinator may use a different supported model/harness from an executor; model choice is distinct from tool-loop/harness choice.
- Adapters declare and behaviorally test submission, observation/reconnect, tool/child activity, steering, cancellation settlement, auth, scoped context, skills and browser/computer tools. Unsupported capabilities are explicit: do not emulate steering as cancellation/restart without disclosure, or turn an unsupported task into silent fallback to another provider.
- Swapping an idle executor preserves application state. Active tasks stay pinned to their originating adapter/version until settled or explicitly recovered; native sessions need not be transferable. Retain unknown effect receipts and resource locks across changes. Capability loss blocks affected tasks/routines and explains the remedy.
- Browser and computer tooling is separable from the harness. Headless browser automation requires no desktop app; pixel-based GUI work requires a display session plus capture/input driver and optional viewer. The Codex desktop application is not mandatory. Prove supported tool integration, approval enforcement and settlement.
- Provider independence means supported choices, not that every model works in every harness. Auth eligibility, quotas and refresh remain provider-specific. Amp's bounded synthetic smoke tool is not a reusable executor proxy or proof of subscription-only billing; never copy Amp OAuth caches to make another VM work.
- Acceptance: run the same admitted task/skill/routine fixtures through candidate adapters with equal policy and tools, preserve application IDs after an idle switch, reject missing capabilities before execution, and retain uncertainty across restart. Compare coordinator responsiveness and measured total inference, not only executor token counts.

## 3. Current implementation boundaries and delivery order

| Existing owner | Incremental work |
| --- | --- |
| `public/` | Minimal creation, schedule picker, task strip, roster organization, quiet/live chat, optional computer pane |
| `src/core/` and `SCHEMAS/` | Add only missing metadata/contracts; preserve existing conversation, routine, receipt, policy, resource and effect ownership |
| `src/worker/` | Authenticated event delivery/reconnect and existing durable command ingress; no browser access to runtime secrets |
| `runtime/` | Resolve runtime decision, then connect native activity/results/control to application state and provider holds |
| `src/providers/` | Provider-specific wake/observation; no native tool-loop duplication |
| `scripts/` and tests | Reproducible install, migration boundaries, integration acceptance, measured model overhead |

Delivery order after runtime decision: (1) complete one real chat/task/result/restart path; (2) task controls, skill authoring and full routine lifecycle; (3) quiet streaming, memory/artifacts and setup; (4) groups, roster/notification polish, computer handoff, demonstrations and portable templates. Later delivery is not exclusion from parity. Do not mistake a polished portal for completed execution integration. Reuse existing tests; add asymmetric boundary cases for changed behavior rather than duplicating happy paths.

UI acceptance requires rendered desktop/mobile states and keyboard/accessible controls, including loading, offline, stale, needs-you, and recovery states. Native acceptance must distinguish scripted-provider proof, real-model proof, provider-specific sleep semantics, and actual device hardware. Production gates remain false until the relevant native and deployment contracts pass.

## 4. Runtime foundation

Codex app-server 0.154.0 is the sole harness. Do not write a new model/tool loop. The application owns durable accepted work and external-effect policy; Codex owns execution internals. Specify dispatch and cancellation ownership, use supported APIs, and never edit runtime databases or import hashed internals. Prove an available coordinator during long work, exact steer/cancel, durable reply, crash uncertainty, browser/device recovery, auth continuity, and reproducible setup.

Non-goals: cloning proprietary internals or commercial usage restrictions, compulsory Desktop clients, a new model/tool loop, unrelated pet/kanban products, and unrestricted self-modification. Team administration, mobile/native distribution, specialized integrations and managed payments need explicit parity rows and feasibility evidence before claiming the entire advertised product replaced; they are not established by a personal portal or generic tool adapter.

## 5. Research traceability and parity accounting

These are advertised behaviors and source observations, not live acceptance of Grok or Hermes. Track implementation gaps directly against UX01–UX15; the 20-enabled-routine cap remains a capacity gap, not settled parity policy.

| Evidence | Requirements / outstanding decision |
| --- | --- |
| [Grok skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) | UX06/11/12/14; one-time task → correction → saved skill → tested routine; teaching draft, lifecycle, event triggers |
| [Grok chat/collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration), [bots](https://docs.x.ai/grok-bot/bots) | UX01–05/07/13/14; exact parity of group routing remains unmeasured; cost-bounded routing is an explicit difference |
| [Grok settings](https://docs.x.ai/grok-bot/settings-and-notifications), [computer](https://docs.x.ai/grok-bot/computer-and-apps), [approvals](https://docs.x.ai/grok-bot/approvals-security-and-privacy) | UX08–10/13/14; shared computer, per-device access, notification states, secure handoff; require-approval rules take precedence over allow rules |
| [Hermes skills](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/skills.md), [memory](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) | UX11/13; explicit learning, progressive disclosure, update-before-duplicate and staged review are useful adaptations; automatic review is configurable, not a Grok parity fact |
| [Hermes cron](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/cron.md), [cron lifecycle](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/cron-internals.md) | UX12; fresh occurrence context, configuration preflight, distinct execution/delivery outcomes |
| [Hermes Codex runtime](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/codex-app-server-runtime.md) | UX15; main documents missing in-turn memory/session-search/delegation tools, auxiliary Hermes review and cron not specifically tested. Selecting Codex is not transparent harness equivalence. |
| [Flavio Copes walkthrough](https://flaviocopes.com/grok-bot/) | Secondary corroboration of task → skill → routine and shared-computer workflow; not authority for exact internal dispatch or current rollout coverage |

Track each acceptance item as documented target, implemented, synthetic-tested, live-tested, blocked, or deliberate difference, with pinned versions and evidence. No aggregate “100% parity” claim while any required row is unverified. Grok advertises 50 routines per bot and 20 recent run records; our 20-enabled-per-installation limit remains current behavior pending a cost-aware capacity change, not permission to drop that gap. Better retention is allowed; commercial quota imitation is not required. Approval, secret handling and uncertainty invariants are not relaxed for parity.

## 6. Desktop reuse and optional managed offering

Owner direction: preserve commercial distribution and consider a paid managed-VM/setup option so users do not need separate infrastructure accounts. Keep the cloneable self-hosted path. Customers bring their own supported model subscription (ChatGPT Plus is the expected starting point) and authorize connectors themselves; this is not resale or pooling of model access. Account eligibility, provider terms for hosted execution, quotas and auth refresh require verification before launch. Managed hosting is a future option, not authorized provisioning or a claim of readiness.

Evaluate [OpenMausBot](https://github.com/milind-soni/OpenMausBot/tree/b2f6e9d04ee0c66ff2e389de47117ce6e0dd833b) first for chat/task/computer UI, remote-instance shell, reconnect handling and a separate Codex adapter comparison. Evaluate [Rakazo](https://github.com/elie222/rakazo/tree/b286fc4a5d0f608005000ef35bee4c473c31a165) for a smaller remote-portal shell and selected presentation components. Both desktop clients use Electron, not SwiftUI/AppKit; adopting either UI does not require its desktop application on the execution VM or adoption of its backend. These are source-inspected candidates, not executed compatibility tests.

Follow the commercial-reuse rules in [AGENTS.md](AGENTS.md): Apache-covered code only after file/dependency/asset provenance review, required notices and modification attribution, our own branding, and **no OpenMausBot `enterprise/` dependency or copied code** absent separately approved licensing. Use [Gawk](https://github.com/najmuzzaman-mohammad/gawkbot/tree/2000e28115491e33a3157e08b0823a3bd8c09cb2) only as a general design reference under the current direction; its Sustainable Use License is not the permissive commercial foundation we want.

Acceptance before choosing a client: connect a bounded conversation/task view to our authenticated commands/receipts, verify reconnect and exact task identity, and prove closing the client does not interrupt remote work. Before distributing a derived build, verify enterprise code is absent from source imports, bundled artifacts and transitive dependencies; retain upstream licensing records. Managed customers must have isolated authorization and state; sharing a host among one customer's bots is not permission to share credentials between customers. No billing or multi-customer hosting implementation is implied by this spec update.

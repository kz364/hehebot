# Personas, task executors, and shared accounts

The intended model has two agent roles: **persona coordinator → task executor**. Each persona is a dedicated conversational identity that delegates long work while remaining available for chat. There is no required extra layer of persistent agents beneath it.

This is an explanation of the [specification](../SPEC.md) and normative [orchestration contract](BOT_ORCHESTRATION_ADDENDUM.md), not evidence of live implementation. Codex app-server **0.154.0** is the sole supported harness; authenticated concurrency, intent-aware routing, connector enforcement, and production settlement still require verification. See [implementation status](IMPLEMENTATION.md).

## Who controls what

```diagram
Owner
  │
  ▼
┌──────────────────────────────────────────────────────────────┐
│ Portal: one visible conversation per persona                  │
└──────────────────────────────┬───────────────────────────────┘
                               │ messages
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Persona coordinators — separate chat contexts                 │
│                                                              │
│ Chief of Staff   Inbox Triage   Whatsapp   Messages   Travel   │
│ Cross-persona    Mail/calendar Family     Mac-based  Trips /  │
│ coordination    workflows     chat       messages   forms    │
│                                                              │
│ Each: answers, reads status, delegates, steers/cancels tasks   │
└──────────────────────────────┬───────────────────────────────┘
                               │ scoped task assignments
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Task executors — isolated context per task                    │
│                                                              │
│ Inbox: process flight mail    Travel: form A                   │
│ Whatsapp: scan family plans   Travel: research hotels B        │
│                                                              │
│ Execute steps, use permitted tools, report attributed results │
│ May have native child tasks when needed; no mandatory layer   │
└──────────────────────────────┬───────────────────────────────┘
                               │ authorized operations
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Shared capabilities                                          │
│ Gmail / Calendar │ WhatsApp │ Remote browser │ Paired Mac     │
│ Access is scoped; conflicting mutations require resource locks│
└──────────────────────────────────────────────────────────────┘

Supporting all layers — application services, not model agents:
┌──────────────────────────────────────────────────────────────┐
│ Durable control plane                                        │
│ Messages, schedules, task records, memory, approvals, receipts│
│                                                              │
│ Runtime supervisor                                           │
│ Wake/sleep, ownership, recovery, and live-work accounting      │
└──────────────────────────────────────────────────────────────┘
```

All persona and task execution shares one customer-owned runtime on one Sprite. The paired Mac is an optional tool peripheral, not another agent brain. Chief of Staff is a peer with cross-persona responsibilities, not a compulsory gateway: the owner can ask Travel directly, and Travel coordinates its own work. These five personas are the initial configuration; the owner can create or change dedicated roles.

## Persistent identity does not mean an always-running agent

- **Persona coordinator:** has its own instructions, scoped memory, and chat context. The visible conversation survives restarts and native context compaction. Do not implement personas by swapping prompts into one shared transcript.
- **Task executor:** runs one logical task in isolated Codex thread/turn context and returns attributed results to the owning persona's timeline. “Subagent” describes its delegated role; every task need not be a native spawned child. Native children may exist when useful, with explicit identity and authority accounting.
- **Routine:** is versioned instructions plus a schedule/trigger and policy, not a resident agent. Each occurrence receives its own task context and scoped durable memory.
- **Parked task:** retains durable status and restartable continuation without requiring an active model turn. This does not promise that arbitrary process memory or an unsaved browser form survives a cold wake.

The initial concurrency target is one reserved interactive model turn plus at most one background model turn **installation-wide**, not per persona. Multiple workflows and tool waits may coexist; additional model work queues fairly. The runtime may sleep only when all live work and persistence have settled or been durably parked. An idle coordinator is not an idle runtime.

## Messages go to the coordinator, not automatically into active work

While Travel is filling form A:

| Owner message | Intended behavior |
| --- | --- |
| “How's it going?” | Read durable status and answer without altering A's input or cancelling it. |
| “Also research hotels.” | Create independent task B; dispatch when capacity and resources permit. |
| “Use tomorrow instead for form A.” | Steer A through a supported safe boundary, preserving task identity and leaving B unchanged. |
| “After A finishes, check its receipt.” | Record a deferred follow-up rather than steering A now. |
| “Cancel B.” | Cancel only B; distinguish requested cancellation from confirmed settlement. |
| “Change the time,” when several tasks fit | Clarify without changing either task. |

The owner does not need to choose native threads or know run IDs. Task cards provide optional exact controls. Closing a card, switching personas, or sending another message cancels nothing. Steering cannot undo completed effects or blindly replay uncertain ones. Unsupported active steering must be shown as unavailable, not silently implemented as cancellation/restart or an after-completion follow-up.

## One installation's accounts, selectively granted capabilities

The intended model uses **one supported Codex login per installation**, shared by its persona and task contexts through Codex-owned authentication and refresh. Separate personas do not need separate model logins or copied credential caches. Subscription eligibility, overlapping turns, quotas, restart continuity, and managed refresh still need live verification; there is no automatic paid API fallback.

Tool authentication is separate from model authentication. Connect each required tool account once per installation: for example, one configured Google connection, one shared WhatsApp linked session, and one paired Mac. This does not imply that signing into Codex signs into Google or WhatsApp, or that unrelated customers share accounts.

**Shared authentication is not shared authority.** Intended scopes include:

| Persona | Example permitted scope, once configured and authorized |
| --- | --- |
| Inbox Triage | Authorized mail reads/labels and approved calendar operations; no email sending. |
| Whatsapp | Read the explicitly selected family chat, not every chat on the account. |
| Messages | Restricted read access through the paired Mac. |
| Travel | Browser/form work and required private traveler fields; delegate canonical mail/calendar work to Inbox Triage. |
| Chief of Staff | Authorized summaries, durable task status, and delegation; no automatic access to private task transcripts. |

Enforce these boundaries in host tools and application policy, not only in persona instructions. Each task receives pinned context/policy revisions and its admitted permissions; child creation or inter-bot text cannot grant broader authority. Shared browser tabs and account/entity mutations require locks and effect deduplication. A connection being installed or enabled does not prove a particular operation is callable or authorized, especially Calendar writes. Data-only inter-bot updates persist without inference or a wake request.

The behavioral proof belongs to [O01–O09](BOT_ORCHESTRATION_ADDENDUM.md#acceptance-additions): non-interrupting conversations, exact steering/cancellation, isolation, recovery, activity accounting, and shared managed authentication. Production gates remain false until the relevant acceptance passes.

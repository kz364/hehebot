# Reference patterns

Source: owner-directed inspection (2026-09-26) of a locally installed, hosted-assistant
desktop client, plus public coverage. It covers patterns observed in that client's
code, its RPC method names and message/enum shapes, and public docs. **The server and
in-VM harness are not shipped with the client, so the server behavior below is
inferred.** This is an architecture reference for
[ARCHITECTURE_V2.md](ARCHITECTURE_V2.md), not a compatibility target, and no code or
assets from that product are copied. Before looking for a new mechanism, check here how
that prior art solves the same problem.

## Topology

| Concern | That prior art | Hehebot choice |
| --- | --- | --- |
| Control plane | A remote RPC control service (~230 methods) on the vendor's own infrastructure | Worker + SQLite DO |
| Compute | Pods in a container orchestrator: one long-lived per-user computer that hibernates, plus ephemeral per-session boxes that are reaped when idle | One sleeping Sprite |
| Agent loop | Two harnesses: one loop running in the pod, one loop running as a durable workflow (box = tool target). Rollout modes gate which one is active | Codex app-server in the Sprite; A3 makes turns atomic |
| Disk | Object store with presigned multipart writes and a manifest commit carrying an etag precondition; result committed/retry/fenced | Sprite persistent disk |
| Per-bot screens | One display per bot on the shared computer | Browser tabs plus locks |

## Patterns adopted

1. **Generation fencing, not death proof.** Session boxes carry a credential state of
   absent/present/revoked. Reaping a box reports deleted pods, **revoked
   credentials** and deleted objects. Box access uses per-box network and gateway
   tokens. A stale pod may keep running but cannot act. Store commits return a
   fenced result to a stale writer. → A2.
2. **Messages are committed, not inferred from turn completion.** Transcript rows
   have kinds such as message, tool-call, send-message, user-attachment, notice and
   event. Chat bubbles are send-message rows, which the agent emits deliberately
   and which can be typed cards (text, attachment, drafts, permission asks, forms).
   Raw assistant text and tool calls render as collapsed activity. → A1, A7.
3. **Interruption is a visible state.** Enums include turn-failure codes (internal,
   timeout, usage limit, rate limit), turn-end states (finished, stopped,
   superseded), an "unknown durability" send status and a "parked" client
   resolution. Uncertainty is shown to the user, not proven away. → A3.
4. **Follow-ups while busy.** Background reasons distinguish agent-requested,
   user-requested and queued-follow-up work. Subagent arguments include
   run-in-background, resume, fork and interrupt options, plus a way for the user to
   push foreground work into the background. A message sent while the agent is busy
   is steered into the live turn, forked into a background child, or used to
   interrupt. → A4.
5. **Wake on child completion.** A continuation config carries idle threshold, max
   loops, a nudge message, background-child collection and a round delay. The UI
   labels a durable pending-wake ledger that survives host restarts. Watchers are
   typed launch/reply/watch with a durable flag. → A4 task → coordinator wake.
6. **Client send journal (outbox).** Each send has a client nonce persisted before
   dispatch. Phases are queued → prepared → dispatching → accepted-awaiting-echo, and
   resolutions are dispatched/retired/parked/failed. An optimistic row is inserted
   immediately. Sends are FIFO per agent, and a record is persisted before each
   phase change. A crash is reconciled with a status-by-nonce lookup (accepted,
   pending, rejected, not-found, unknown-durability) that also checks prior nonces.
   The echo returns an entry id. A rejected send restores the draft. → A5.
7. **Append-only transcript with cursors.** Entries have a sequence and an updated
   sequence. Writers commit with a generation and get optimistic-concurrency
   rejections. The watch stream has frames for connected, rows, cleared,
   cursor-too-old, heartbeat, agent-state, turn-failed, roster-changed and
   box-state. → A6.
8. **Rooms as bounded turns.** A room member's turn request carries a nonce, room,
   peers, new messages, a winding-down flag, a deadline and a parent/root request
   id. Outcomes are sent/pass/skipped/timeout/cancelled/error. → A8.
9. **User computer pulls requests.** A server stream of queued requests has a
   polling fallback and client responses. → A9.
10. **Task list from turn ends.** The harness reports messages, an
    awaiting-user flag, a has-background-work flag, a turn-end reason and finished
    work. Task state is working/needs-input/done. → task cards in A7.

## Patterns observed but not adopted

- A durable-workflow-hosted agent loop, per-session pods and the object-store disk
  (see ARCHITECTURE_V2 §2).
- Scheduled image upgrades in the user's timezone, cluster migration phases and team
  admin surfaces. These may become relevant for a managed offering later.

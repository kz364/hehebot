# Grok Bot reference patterns

Source: owner-directed inspection (2026-09-26) of the locally installed Grok Bot desktop
client 0.59.1 (bundle `com.anysphere.sand`, built by Anysphere/Cursor), plus public
coverage. It covers the client code, its RPC method names and message/enum shapes,
and public docs. **The server and in-VM harness are not shipped with the client, so
the server behavior below is inferred.** This is an architecture reference for
[GROK_ALIGNMENT.md](GROK_ALIGNMENT.md), not a compatibility target, and no Grok code
or assets are copied. Before looking for a new mechanism, check here how Grok solves
the same problem.

## Topology

| Concern | Grok Bot | Hehebot choice |
| --- | --- | --- |
| Control plane | ConnectRPC service (`GrokBotService`, ~230 methods) on Cursor infrastructure | Worker + SQLite DO |
| Compute | Kubernetes pods ("SandBox"): one long-lived per-user computer that hibernates, plus ephemeral per-session boxes that are reaped when idle | One sleeping Sprite |
| Agent loop | Two harnesses: `BOX` (loop in the pod) and `TEMPORAL` (loop as a Temporal workflow, box = tool target). Rollout mode `OFF/SHADOW/LIVE/BOX` | Codex app-server in the Sprite; A3 makes turns atomic |
| Disk | Object store with presigned multipart writes and a manifest commit carrying an etag precondition; result `COMMITTED/RETRY/FENCED` | Sprite persistent disk |
| Per-bot screens | `EnsureSandBoxWindow(window_index)`: one display per bot on the shared computer | Browser tabs plus locks |

## Patterns adopted

1. **Generation fencing, not death proof.** Session boxes carry `credential_state
   ABSENT/PRESENT/REVOKED`. Reaping a box reports deleted pods, **revoked
   credentials** and deleted objects. Box access uses per-box network and gateway
   tokens. A stale pod may keep running but cannot act. Store commits return
   `FENCED` to a stale writer. → A2.
2. **Messages are committed, not inferred from turn completion.** Transcript rows
   have the kinds `message | tool-call | send-message | user-attachment | notice |
   event`. Chat bubbles are `send-message` rows, which the agent emits deliberately
   and which can be typed cards (text, attachment, email/Slack drafts, permission
   asks, forms). Raw assistant text and tool calls render as collapsed activity.
   → A1, A7.
3. **Interruption is a visible state.** Enums include `TurnFailureCode INTERNAL |
   TIMEOUT | USAGE_LIMIT | RATE_LIMIT`, `TaskListTurnEnd FINISHED | STOPPED |
   SUPERSEDED`, send status `UNKNOWN_DURABILITY` and client resolution `parked`.
   Uncertainty is shown to the user, not proven away. → A3.
4. **Follow-ups while busy.** `SubagentBackgroundReason AGENT_REQUEST |
   USER_REQUEST | QUEUED_FOLLOW_UP`. Subagent args include `run_in_background`,
   `resume_agent_id`, `fork_agent_id` and `interrupt`. `ForceBackgroundSubagent`
   lets the user push foreground work into the background. A message sent while the
   agent is busy is steered into the live turn, forked into a background child, or
   used to interrupt. → A4.
5. **Wake on child completion.** `ClientContinuationConfig { idle_threshold,
   max_loops, nudge_message, collect_background_children,
   children_completed_message_template, continuation_round_delay_ms }`. The UI
   labels rows `durable_pending_wake_ledger` and `reattached_after_host_restart`, so
   the list of pending wake-ups survives restarts. Cloud-agent watchers are `LAUNCH
   | REPLY | WATCH` with a `durable` flag. → A4 task → coordinator wake.
6. **Client send journal (outbox).** Each send has a client nonce
   (`crypto.randomUUID`) persisted before dispatch. Phases are `queued → prepared →
   dispatching → accepted-awaiting-echo`, and resolutions are `dispatched | retired
   | parked | failed`. An optimistic row is inserted immediately. Sends are FIFO per
   agent, and a record is persisted before each phase change. A crash is
   reconciled with a status-by-nonce lookup (`ACCEPTED | PENDING | REJECTED |
   NOT_FOUND | UNKNOWN_DURABILITY`) that also checks prior nonces. The echo returns
   an `echo_entry_id`. A rejected send restores the draft. → A5.
7. **Append-only transcript with cursors.** Entries have `seq` and `updated_seq`.
   Writers commit with a `generation` and get optimistic-concurrency rejections.
   The watch stream has frames `connected | rows | cleared | cursor_too_old |
   heartbeat | agent_state | turn_failed | roster_changed | box_state`. → A6.
8. **Rooms as bounded turns.** A room member's turn request carries `nonce, room,
   peers, new_messages, is_winding_down, deadline_ms, parent/root request id`.
   Outcomes are `SENT | PASS | SKIPPED | TIMEOUT | CANCELLED | ERROR`. → A8.
9. **User computer pulls requests.** A server stream of queued requests
   (`enqueued_at_ms`) has a polling fallback and client responses. → A9.
10. **Task list from turn ends.** The harness reports `{ messages, is_awaiting_user,
    has_background_work, turn_end, finished_work }`. Task state is `WORKING |
    NEEDS_INPUT | DONE`. → task cards in A7.

## Patterns observed but not adopted

- Temporal-hosted agent loop, per-session pods and the object-store disk (see
  GROK_ALIGNMENT §2).
- Scheduled image upgrades in the user's timezone, cluster migration phases and team
  admin surfaces. These may become relevant for a managed offering later.

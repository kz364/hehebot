# Gmail + Google Calendar (hosted apps, fenced writes)

Status (2026-09-28): implemented and unit-tested locally. **Live verification is pending**; nothing here
has run against the real `codex_apps` server yet.

## Design

Codex 0.154.0 exposes ChatGPT-connected apps through its hosted apps MCP server `codex_apps` when
`features.apps` is on. Hehebot keeps `features.apps=false` at startup (see
[ALPHA_NATIVE_CAPABILITY_BOUNDARY.md](ALPHA_NATIVE_CAPABILITY_BOUNDARY.md), "Hosted apps"). It turns it on
**per thread**, only for a run whose persona snapshot grants `GOOGLE_POLICY`
(`9b80fd86-4797-4de8-ae41-1e2bbff7ba5a`, `src/core/agent-commands.ts`, mirrored in `runtime/google-apps.mjs`).
A background task gets it only when the coordinator passes it in `hehebot_start_task` capabilities.

Per-thread `thread/start.config` for a granted run (`googleThreadConfig`):

- `features`: the full `RESTRICTED_CODEX_FEATURES` table with `apps: true`, plus `multi_agent: false`,
  `multi_agent_v2: false`, `tool_call_mcp_elicitation: false`. A per-thread features table replaces the startup
  override table, so every gate is carried forward. `tool_call_mcp_elicitation` is **on by default in 0.154**
  (`codex-rs/features/src/lib.rs`); it is pinned off so approvals arrive as `item/tool/requestUserInput`.
- `apps._default.enabled = false`, so no other connector is visible.
- Gmail and Calendar connectors: `enabled: true`, `default_tools_approval_mode: "writes"`, and `tools.<name>.enabled = false`
  for the disabled tools below.

Ungranted threads carry no `features`/`apps` table and stay exactly as before. The table is part of the
attempt fingerprint (`CodexAdapter` `threadConfig`), so a changed grant is a different attempt.

### The fence (A2: mutating tools pass through a Hehebot-fenced boundary)

Under `approvalPolicy: "untrusted"` and mode `writes`, Codex asks the app-server client to approve every
`codex_apps` call whose annotations are not `readOnlyHint: true`
(`requires_mcp_tool_approval_for_mode`, `codex-rs/core/src/mcp_tool_call.rs`). `runtime/google-apps.mjs`
(`createGoogleAppsFence`, wired in `runtime/codex-service.mjs`) owns that request:

1. `item/started` for the `mcpToolCall` arrives first (`notify_mcp_tool_call_started` precedes
   `maybe_request_mcp_tool_approval`) and carries `server`, `tool`, `arguments`, `appContext.connectorId`. The fence keeps it by `(threadId, item.id)`.
2. The approval request is matched by `itemId` (= the call id) and question id `mcp_tool_call_approval_<call id>`.
3. It is declined (answer `Cancel`) when: the connector is not one of the two configured ids, the tool is disabled,
   a Calendar call names any attendee/guest other than `googleApps.ownerEmails`, the run does not hold `GOOGLE_POLICY`,
   or anything in the permit fails.
4. Otherwise: `effect-intent` (`classification: "mutation"`, `authorization_ref: GOOGLE_POLICY`,
   `action_key: google:<runId>:<attempt>:<callId>`, `request_digest` = sha256 of `[connectorId, tool, canonical args]`),
   then `effect-result` `dispatched`, then answer `Allow`. Never "Allow for this session" or "Allow and don't ask me again";
   mode `writes` also normalizes those to a one-shot approval (`normalize_approval_decision_for_mode`).
5. `item/completed`: `completed` without error → `confirmed`; otherwise `failed`. If the turn completes first, the effect
   becomes `outcome_unknown`. If the process dies, the Worker's epoch fence (`interruptRuns`, `src/core/lifecycle.ts`)
   turns `dispatched` into `outcome_unknown`; the runtime does not duplicate it.

Anything that is not a hosted-app approval gets the same `-32601` refusal as before (`USER_INPUT_NOT_HANDLED`).
Codex turns a refused or unanswered request into "user cancelled MCP tool call" for the model; the decline
reason cannot reach the model through this protocol, so the guidance tells it not to retry and to tell the owner.

### Pinned shapes (rust-v0.154.0)

Server → client (`item/tool/requestUserInput`, `ToolRequestUserInputParams`, app-server-protocol `v2/item.rs`;
built in `app-server/src/bespoke_event_handling.rs` `EventMsg::RequestUserInput`, `item_id = call_id`):

```json
{"id": 7, "method": "item/tool/requestUserInput", "params": {"threadId": "…", "turnId": "…", "itemId": "<call id>",
 "isBlocking": true, "questions": [{"id": "mcp_tool_call_approval_<call id>", "header": "Approve app tool call?",
 "question": "Allow Gmail to run tool \"create_draft\"?", "isOther": false, "isSecret": false,
 "options": [{"label": "Allow", "description": "Run the tool and continue."}, {"label": "Cancel", "description": "Cancel this tool call."}]}]}}
```

Client → server: `{"id": 7, "result": {"answers": {"mcp_tool_call_approval_<call id>": {"answers": ["Allow"]}}}}`
(decline: `["Cancel"]`). `parse_mcp_tool_approval_response` maps only `Allow` to `Approved`; anything else, an empty map
or a JSON-RPC error is `Abort`.

## Tools

| Connector | Runs freely (readOnly) | Asks → fenced effect | Disabled (never) |
| --- | --- | --- | --- |
| Gmail | batch_read_email, batch_read_email_threads, get_profile, list_drafts, list_labels, read_attachment, read_email, read_email_thread, search_email_ids, search_emails | apply_labels_to_emails, archive_emails, batch_modify_email, bulk_label_matching_emails, create_draft, create_label, update_draft | send_email, send_draft, forward_emails, delete_emails |
| Calendar | batch_read_event, fetch, get_availability, get_colors, get_profile, list_calendars, list_event_labels, read_event, search, search_events | create_event, update_event, delete_event, set_event_label_silently (no non-owner attendees) | respond_event |

Why off: the owner rule is that bots never send mail or RSVP, and deletion is not reversible. Invites are out of
scope, so attendees other than the owner are refused at the fence. Disabled tools are both disabled in config and
declined by the fence, in case the hosted tool name does not match the config key.

## Configuration

- Worker: `TOOL_POLICY_IDS` includes `GOOGLE_POLICY` (env `hehebot`); the portal Capabilities switch
  "Gmail & Calendar" then grants it per persona.
- Runtime (`HEHEBOT_V2_CONFIG`): `"googleApps": {"gmail": "connector_2128aebfecb84f64a069897515042a44",
  "calendar": "connector_947e0d954944416db111db556030eea6", "ownerEmails": ["<owner address>"]}`.
  Absent = feature off (no apps table, no fence). `ownerEmails` is optional; without it, any attendee is refused.

## Live verification (integrator, needs owner OK: reads real mail/calendar)

1. Add `googleApps` to the Sprite config and restart the runtime; grant "Gmail & Calendar" to one persona.
2. Ask that bot to list today's events and the last three email subjects. Expect answers with **no** approval
   request and no effect rows. If a read asks for approval, its annotation is not readOnly: record it.
3. Check the observed `item.tool` spelling in the runtime log/thread history against the table. If it is prefixed
   (e.g. `gmail_send_email`), change the `tools` keys in `googleThreadConfig` to match (the fence already matches both).
4. Ask it to draft (not send) a reply. Expect effect `intent → dispatched → confirmed` for `create_draft` and the draft in Gmail.
5. Ask it to send an email and to create an event inviting someone else. Expect both refused, no mail sent,
   no event created, the bot telling the owner.
6. Ask for a private calendar block; expect a confirmed `create_event` effect with no attendees.
7. Confirm no other connector's tools are visible (`_default.enabled=false`) and that an ungranted persona has none.

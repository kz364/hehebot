import type { BudgetPolicy } from './budget';
import type { RosterLayout } from './roster';
import type { NativeQuestionAnswerCommand, NativeQuestionCloseCommand } from './native-questions';
import type { OwnerAlphaPolicy, OwnerAlphaSuccessor } from './owner-alpha';
import type { WhatsAppReadPolicies } from './whatsapp-access';
import type { OwnerAlphaBootstrapConfig } from './owner-alpha-bootstrap';
import type { TestCampaignGrant } from './test-campaign';
import type { MemoryContextEntry } from './memory-context';
export type Scope = { kind: 'global' | 'persona' | 'routine' | 'skill'; id: string | null };
export type BasePut = { id: string; expected_revision: number };
export type PersonaPut = BasePut & { name: string; role?: string; instructions: string; tool_policy_ids: string[]; archived: boolean };
export type RoomPut = BasePut & { name: string; member_ids: string[]; default_responder_id: string };
export type RoutinePut = BasePut & {
  persona_id: string; name: string; instructions: string; schedule: { cron: string; timezone: string } | null;
  trigger_source_id: string | null; enabled: boolean;
  policy: { misfire: 'coalesce' | 'skip' | 'replay'; overlap: 'queue_one' | 'skip'; max_replay: number; max_lateness_seconds: number };
  action_policy_ids: string[];
};
export type MemoryPut = BasePut & { scope: Scope; text: string; source_event_id: string; expires_at: string | null; sensitivity: 'ordinary' | 'sensitive'; explicit_constraint?: boolean; summary?:{schema_version:1;source_sha256:string;text:string} };
export type SkillBody = { name:string; description:string; when_to_use:string; inputs_access:string[]; steps:string[]; decision_rules:string[]; validation:string[]; output:string; failure_handling:string[]; approval_boundaries:string[]; references?:{name:string;text:string}[]; contains_private_facts:false };
export type SkillProvenance = { kind:'owner'|'task'|'notes'|'file'|'url'|'import'|'model'; source_ref:string };
export type SkillProposal = { proposal_id:string; skill_id:string; expected_skill_revision:number; body:SkillBody; provenance:SkillProvenance; executable_files_changed:boolean };
export type RoomPublish = { room_id: string; kind: 'context_update' | 'action_request' | 'message'; recipient_ids: string[]; text: string; references: { kind: string; id: string; revision: number }[]; cause_id: string };
export type PayloadMap = {
 'owner-alpha.activate':{transition_id:string;envelope_sha256:string};
 'run.recover':{run_id:string;expected_attempt:number;release_resources:true};
 'effect.reconcile':{run_id:string;expected_attempt:number;effect_id:string;expected_request_digest:string;outcome:'confirmed'|'failed';evidence_ref:string};
 'question.answer':NativeQuestionAnswerCommand;
 'question.close':NativeQuestionCloseCommand;
 'roster.set':RosterLayout;
 'budget.set':BudgetPolicy;
 'budget.override':{run_id:string;expected_revision:number};
 'run.steer':{run_id:string;expected_attempt:number;text:string};
 'run.followup':{run_id:string;text:string};
 'task.start':{title:string;brief:string;capabilities?:string[]};
 'setup.adopt':{commands:Array<{schema_version:1;type:'persona.put';payload:PersonaPut}|{schema_version:1;type:'routine.put';payload:RoutinePut}>;monitoring_timezone:'Asia/Singapore'|'Asia/Jakarta';reviewed_hash:string};
 'message.send': { conversation_id: string; text: string };
 'persona.put': PersonaPut; 'room.put': RoomPut; 'routine.put': RoutinePut; 'memory.put': MemoryPut;
 'routine.run': BasePut; 'routine.delete': BasePut;
 'memory.delete': BasePut & { purge_transcripts: boolean };
 'room.publish': RoomPublish; 'run.cancel': { run_id: string; reason: string };
 'run.retry': { run_id: string; expected_attempt: number };
 'approval.resolve': { approval_id: string; decision: 'approve' | 'deny'; expected_revision: number };
 'skill.propose':SkillProposal;
 'skill.propose_from_task':{proposal_id:string;skill_id:string;expected_skill_revision:number;source_run_id:string;expected_attempt:number;body:SkillBody};
 'skill.review':{proposal_id:string;expected_proposal_revision:number;decision:'approve'|'reject'};
 'skill.enable':{skill_id:string;expected_skill_revision:number;persona_id:string;enabled:boolean};
 'skill.run':{skill_id:string;expected_skill_revision:number;persona_id:string;expected_persona_revision:number;text:string};
 'skill.delete':BasePut;
 'skill.restore':{proposal_id:string;skill_id:string;expected_skill_revision:number;source_revision:number};
 // Web Push (TODO.md "Push notifications"). The endpoint/keys shape is exactly
 // the browser PushSubscription.toJSON() output (RFC 8030/8291 subscription).
 'push.subscribe':{endpoint:string;keys:{p256dh:string;auth:string}};
 'push.unsubscribe':{endpoint:string};
};
export type Command = { [K in keyof PayloadMap]: { schema_version: 1; type: K; payload: PayloadMap[K] } }[keyof PayloadMap];
export type ObjectKind = 'persona' | 'room' | 'routine' | 'memory' | 'skill' | 'trigger' | 'approval' | 'policy';
export type StoredObject<T = Record<string, unknown>> = { id: string; kind: ObjectKind; revision: number; body: T; deleted_at: string | null; created_at: string; updated_at: string };
export type Receipt = { id: string; status: 'accepted' | 'applied' | 'rejected'; accepted_at: string; resource_id: string | null; error: { code: string; message: string; retryable: boolean } | null };
export type RunStatus = 'queued' | 'claimed' | 'running' | 'finishing' | 'completed' | 'waiting' | 'failed' | 'cancelling' | 'cancelled' | 'recovery_required' | 'interrupted';
export type Run = { role:'coordinator'|'background';parent_run_id:string|null;title:string|null;id: string; command_id: string | null; occurrence_id: string | null; persona_id: string; routine_id: string | null; context_json: string; status: RunStatus; current_attempt: number; error_code: string | null; checkpoint_json: string | null; created_at: string; updated_at: string };
export type Operation = { id: string; kind: 'inference' | 'tool' | 'child' | 'transfer' | 'node' | 'flush' | 'delivery'; status: 'active' | 'cancelling' | 'settled' | 'unknown'; started_at: string; deadline_at: string; last_progress_at: string };
export type ContextSnapshot = {memory_budget?:import('./memory-context').MemoryBudgetReceipt;selected_model?:string;conversation_history?:{purpose:string;truncated:boolean;messages:Array<{command_id:string;text:string;truncated:boolean;completed_reply?:{run_id:string;attempt:number;text:string;truncated:boolean};provisional_reply?:{run_id:string;attempt:number;version:number;text:string;truncated:boolean}}>};whatsapp_read_policies?:WhatsAppReadPolicies;context_history_gap?:{requested_after:number;expired_through:number};continuation?:{previous_attempt:number;reason:string;delivered_messages:string[];unknown_effects?:Array<{effect_id:string;kind:string}>};task_summaries?:Array<{id:string;title:string|null;status:string;updated_at:string}>;skill_invocation?:{skill_id:string;skill_revision:number};
 // V4: causal depth of automatic coordinator wakes (task.event chains). Absent
 // or 0 on an ordinary owner/routine-initiated coordinator run.
 causal_depth?:number;
 // V4: marks a role='background' run created by hehebot_start_task, distinct
 // from the pre-existing native-child parent/child task hierarchy which also
 // uses role='background'+parent_run_id but must never wake a coordinator.
 coordinator_task?:true;
 schema_version: 1; persona: StoredObject<PersonaPut>; routine: StoredObject<RoutinePut> | null; memories: MemoryContextEntry[]; skills:StoredObject<SkillBody>[]; scope_key: string; instruction: string; room_id: string | null; context_events: TimelineEvent[]; authorization_policy_ids: string[] };
export type TimelineEvent = { sequence: number; id: string; conversation_id: string | null; type: string; actor_id: string; cause_id: string | null; payload: Record<string, unknown>; created_at: string };
export type Options = { testCampaignGrant?:TestCampaignGrant;ownerAlphaBootstrap?:OwnerAlphaBootstrapConfig;ownerAlphaWarm?:import('./owner-alpha-warm').WarmGenerationConfig;ownerAlphaBackground?:import('./owner-alpha-background').BackgroundGenerationConfig;ownerAlpha?:OwnerAlphaPolicy;ownerAlphaSuccessor?:OwnerAlphaSuccessor;ownerBindingSha256?:string;whatsappReadPolicies?:WhatsAppReadPolicies;delegations?:Record<string,string[]>;executionEnabled: boolean; actionPolicyIds: string[]; toolPolicyIds: string[]; now: () => Date; uuid: () => string;
 // V4 (ARCHITECTURE_V2 A4): gates the per-persona coordinator inbox (steer-or-batch
 // routing of message.send) and the task.event coordinator wake. Off by default so
 // every pre-existing message.send/completion test keeps its prior behavior.
 coordinatorInbox?: boolean;
 // Push notifications (TODO.md "Push notifications"): the VAPID public key,
 // present only when HEHEBOT_VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT are all
 // configured. Its presence (not the key's content) gates push.subscribe and
 // is echoed in state().settings.push so the portal can hide the toggle.
 vapidPublicKey?: string };

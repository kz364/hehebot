import { ControlError } from './errors';
import { timelineExpirySql } from './timeline-retention';
import type { ObjectKind, StoredObject, TimelineEvent, Run, MemoryPut } from './types';
export type SqlValue = string | number | null;
export interface Database {
 all<T>(sql: string, ...values: SqlValue[]): T[];
 exec(sql: string, ...values: SqlValue[]): void;
 transaction<T>(fn: () => T): T;
}
type ObjectRow = { id: string; kind: ObjectKind; revision: number; body_json: string; deleted_at: string | null; created_at: string; updated_at: string };
export class Store {
 constructor(public db: Database) {}
 get<T = Record<string, unknown>>(id: string, kind?: ObjectKind): StoredObject<T> {
  const row = this.db.all<ObjectRow>('SELECT * FROM objects WHERE id=? AND deleted_at IS NULL', id)[0];
  if (!row || (kind && row.kind !== kind)) throw new ControlError('NOT_FOUND', 'That item is unavailable.', 404);
  const {body_json, ...rest} = row;
  return {...rest, body: JSON.parse(body_json) as T};
 }
 list<T = Record<string, unknown>>(kind: ObjectKind): StoredObject<T>[] {
  return this.db.all<ObjectRow>('SELECT * FROM objects WHERE kind=? AND deleted_at IS NULL ORDER BY created_at,id',kind).map(({body_json,...rest})=>({...rest,body:JSON.parse(body_json) as T}));
 }
 scopedMemories(personaId:string,routineId:string|null,limit?:number):StoredObject<MemoryPut>[] {
  // Each exact scope uses the partial index's ordering before LIMIT. An OR
  // query can sort every eligible row before limiting, even with this index.
  // The first N merged rows must occur within the first N of each partition.
  // Preflight legacy/imported raw body sizes before loading any selected body.
  // Only the merged selection consumes this aggregate budget; unrelated or
  // later rows cannot force refusal. Unlimited reads retain existing behavior.
  const body=limit===undefined?'body_json':'length(CAST(body_json AS BLOB)) AS body_bytes';
  const scopes:Array<[string,string|null]>=[['global',null],['persona',personaId]];
  if(routineId)scopes.push(['routine',routineId]);
  if(limit!==undefined){
   // Candidate keys are needed for the existing JS merge, even if not selected.
   // Inspect byte counts only before hydrating legacy IDs and timestamps.
   const metadataBytes=scopes.reduce((total,[kind,id])=>total+this.db.all<{bytes:number}>(`SELECT COALESCE(SUM(bytes),0) AS bytes FROM (
    SELECT length(CAST(id AS BLOB))+length(CAST(kind AS BLOB))+length(CAST(created_at AS BLOB))+length(CAST(updated_at AS BLOB)) AS bytes
    FROM objects WHERE kind='memory' AND deleted_at IS NULL
    AND json_extract(body_json,'$.scope.kind')=? AND json_extract(body_json,'$.scope.id') IS ?
    ORDER BY created_at,id LIMIT ?
   )`,kind,id,limit)[0].bytes,0);
   if(metadataBytes>131072)throw new ControlError('MEMORY_PREPARATION_LIMIT','Memory candidate metadata exceeds the read-work limit. No memory was truncated.');
  }
  const rows=scopes.flatMap(([kind,id])=>this.db.all<Omit<ObjectRow,'body_json'>&{body_json?:string;body_bytes?:number}>(`SELECT id,kind,revision,${body},deleted_at,created_at,updated_at FROM objects WHERE kind='memory' AND deleted_at IS NULL
   AND json_extract(body_json,'$.scope.kind')=? AND json_extract(body_json,'$.scope.id') IS ?
   ORDER BY created_at,id LIMIT ?`,kind,id,limit??-1));
  rows.sort((a,b)=>a.created_at<b.created_at?-1:a.created_at>b.created_at?1:a.id<b.id?-1:a.id>b.id?1:0);
  const selected=limit===undefined?rows:rows.slice(0,limit);
  if(limit!==undefined&&selected.reduce((bytes,row)=>bytes+row.body_bytes!,0)>131072)
   throw new ControlError('MEMORY_PREPARATION_LIMIT','Memory preparation exceeds the aggregate raw-body read-work limit. No memory was truncated.');
  return selected.map(({body_json,body_bytes,...rest})=>{
   const text=limit===undefined?body_json!:this.db.all<{body_json:string}>('SELECT body_json FROM objects WHERE id=?',rest.id)[0].body_json;
   return {...rest,body:JSON.parse(text) as MemoryPut};
  });
 }
 put(id: string, kind: ObjectKind, body: unknown, expected: number, actor: string, now: string, source: string | null = null): number {
  const existing=this.db.all<{revision:number;kind:string}>('SELECT revision,kind FROM objects WHERE id=?',id)[0];
  if ((existing?.revision ?? 0)!==expected || (existing && existing.kind!==kind)) throw new ControlError('REVISION_CONFLICT','Reload the item before saving this edit.');
  const revision=expected+1;
  this.db.exec('INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body_json=excluded.body_json,updated_at=excluded.updated_at',id,kind,revision,JSON.stringify(body),now,now);
  this.db.exec('INSERT INTO object_revisions(object_id,revision,body_json,actor_id,source_event_id,created_at) VALUES(?,?,?,?,?,?)',id,revision,JSON.stringify(body),actor,source,now);
  return revision;
 }
 event(id:string,conversation:string|null,type:string,actor:string,cause:string|null,payload:Record<string,unknown>,now:string):number {
  this.db.exec('INSERT INTO events(id,conversation_id,type,actor_id,cause_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)',id,conversation,type,actor,cause,JSON.stringify(payload),now);
  return this.db.all<{sequence:number}>('SELECT sequence FROM events WHERE id=?',id)[0].sequence;
 }
 events(after:number,limit:number,now:string):TimelineEvent[] {
  type Row={sequence:number;id:string;conversation_id:string|null;type:string;actor_id:string;cause_id:string|null;payload_json:string;created_at:string};
  const rows=this.db.all<Row>(`SELECT * FROM events WHERE sequence>? AND ${timelineExpirySql}>? ORDER BY sequence LIMIT ?`,after,now,limit);
  return rows.map(({payload_json,...rest})=>({...rest,payload:JSON.parse(payload_json) as Record<string,unknown>}));
 }
 contextPage(conversation:string,recipient:string,after:number,now:string,limit=100):{events:TimelineEvent[];expiredThrough:number} {
  type Row=Omit<TimelineEvent,'payload'>&{payload_json:string};
  const retired=this.db.all<{seq:number}>('SELECT pruned_through AS seq FROM context_retention WHERE conversation_id=? AND consumer_id=?',conversation,recipient)[0]?.seq??0;
  const pending=this.db.all<{seq:number}>(`SELECT COALESCE(MAX(sequence),0) AS seq FROM events WHERE conversation_id=? AND type='room.context_update' AND ${timelineExpirySql}<=? AND EXISTS (SELECT 1 FROM json_each(events.payload_json,'$.recipient_ids') WHERE value=?)`,conversation,now,recipient)[0].seq;
  const events=this.db.all<Row>(`SELECT * FROM events WHERE conversation_id=? AND sequence>? AND type='room.context_update' AND ${timelineExpirySql}>? AND EXISTS (SELECT 1 FROM json_each(events.payload_json,'$.recipient_ids') WHERE value=?) ORDER BY sequence LIMIT ?`,conversation,after,now,recipient,limit).map(({payload_json,...rest})=>({...rest,payload:JSON.parse(payload_json) as Record<string,unknown>}));
  return {events,expiredThrough:Math.max(retired,pending)};
 }
 conversationEvents(conversation:string,now:string,before=Number.MAX_SAFE_INTEGER,limit=100):TimelineEvent[] {
  type Row={sequence:number;id:string;conversation_id:string|null;type:string;actor_id:string;cause_id:string|null;payload_json:string;created_at:string};
  return this.db.all<Row>(`SELECT * FROM events WHERE conversation_id=? AND sequence<? AND ${timelineExpirySql}>? ORDER BY sequence DESC LIMIT ?`,conversation,before,now,limit).reverse().map(({payload_json,...rest})=>({...rest,payload:JSON.parse(payload_json) as Record<string,unknown>}));
 }
 /** Forward pagination for the long-poll/fallback cursor (GROK_ALIGNMENT A6):
  * the same row shape and expiry filter as conversationEvents, ordered
  * ascending from (not including) `after`. */
 conversationEventsAfter(conversation:string,after:number,now:string,limit=100):TimelineEvent[] {
  type Row={sequence:number;id:string;conversation_id:string|null;type:string;actor_id:string;cause_id:string|null;payload_json:string;created_at:string};
  return this.db.all<Row>(`SELECT * FROM events WHERE conversation_id=? AND sequence>? AND ${timelineExpirySql}>? ORDER BY sequence LIMIT ?`,conversation,after,now,limit).map(({payload_json,...rest})=>({...rest,payload:JSON.parse(payload_json) as Record<string,unknown>}));
 }
 latestEvents(now:string,limit=100):TimelineEvent[] {
  type Row=Omit<TimelineEvent,'payload'>&{payload_json:string};
  return this.db.all<Row>(`SELECT * FROM events WHERE ${timelineExpirySql}>? ORDER BY sequence DESC LIMIT ?`,now,limit).reverse().map(({payload_json,...rest})=>({...rest,payload:JSON.parse(payload_json) as Record<string,unknown>}));
 }
 retentionFloor(now:string,conversation?:string):number {
  const retired=this.db.all<{seq:number}>('SELECT COALESCE(MAX(sequence),0) AS seq FROM event_tombstones WHERE (? IS NULL OR conversation_id=?)',conversation??null,conversation??null)[0].seq;
  const pending=this.db.all<{seq:number}>(`SELECT COALESCE(MAX(sequence),0) AS seq FROM events WHERE ${timelineExpirySql}<=? AND (? IS NULL OR conversation_id=?)`,now,conversation??null,conversation??null)[0].seq;
  return Math.max(retired,pending);
 }
 sequence():number { return this.db.all<{seq:number}>("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='events'),0) AS seq")[0].seq; }
 runHasNullRoom(id:string):boolean {
  // Only project unambiguous strict-null authority. JS takes the last duplicate
  // key; SQLite extraction takes the first. The schema enforces json_valid,
  // but admits trailing raw NULs that JS rejects. These and non-objects retain
  // JS behavior (including its exceptions); snapshots are never rewritten.
  // This bounds returned data on the fast path, not SQLite's JSON scan work.
  const row=this.db.all<{room_is_null:number|null}>(`SELECT CASE
   WHEN instr(context_json,char(0))=0 AND json_type(context_json)='object' THEN
    (SELECT CASE WHEN count(*)>1 THEN NULL ELSE coalesce(max(type='null'),0) END
     FROM json_each(context_json) WHERE key='room_id')
   END AS room_is_null FROM runs WHERE id=?`,id)[0];
  if(!row)throw new ControlError('NOT_FOUND','Run unavailable.',404);
  if(row.room_is_null!==null)return row.room_is_null===1;
  const context=this.db.all<{context_json:string}>('SELECT context_json FROM runs WHERE id=?',id)[0].context_json;
  return JSON.parse(context).room_id===null;
 }
 runHasFalsyRoom(id:string):boolean {
  // Attempt authority uses truthiness, unlike generation strict-null authority.
  // Keep numeric conversion in JS (including underflow/negative zero), as well
  // as duplicate-key, non-object and raw-NUL behavior. No SQL scan bound claimed.
  const row=this.db.all<{room_is_falsy:number|null}>(`SELECT CASE
   WHEN instr(context_json,char(0))=0 AND json_type(context_json)='object' THEN
    (SELECT CASE WHEN count(*)>1 THEN NULL WHEN count(*)=0 THEN 1 ELSE max(CASE type
      WHEN 'null' THEN 1 WHEN 'false' THEN 1 WHEN 'text' THEN length(CAST(value AS BLOB))=0
      WHEN 'true' THEN 0 WHEN 'array' THEN 0 WHEN 'object' THEN 0 END) END
     FROM json_each(context_json) WHERE key='room_id')
   END AS room_is_falsy FROM runs WHERE id=?`,id)[0];
  if(!row)throw new ControlError('NOT_FOUND','Run unavailable.',404);
  if(row.room_is_falsy!==null)return row.room_is_falsy===1;
  const context=this.db.all<{context_json:string}>('SELECT context_json FROM runs WHERE id=?',id)[0].context_json;
  return !JSON.parse(context).room_id;
 }
 run(id:string):Run { const run=this.db.all<Run>('SELECT * FROM runs WHERE id=?',id)[0]; if(!run) throw new ControlError('NOT_FOUND','Run unavailable.',404);return run; }
}

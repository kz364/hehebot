import { ControlError } from './errors';
import type { ObjectKind, StoredObject, TimelineEvent, Run } from './types';
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
 events(after=0,limit=100,conversation?:string):TimelineEvent[] {
  type Row={sequence:number;id:string;conversation_id:string|null;type:string;actor_id:string;cause_id:string|null;payload_json:string;created_at:string};
  const rows=conversation ? this.db.all<Row>('SELECT * FROM events WHERE sequence>? AND conversation_id=? ORDER BY sequence LIMIT ?',after,conversation,limit):this.db.all<Row>('SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT ?',after,limit);
  return rows.map(({payload_json,...rest})=>({...rest,payload:JSON.parse(payload_json) as Record<string,unknown>}));
 }
 contextEvents(conversation:string,recipient:string,after:number,limit=100):TimelineEvent[] {
  type Row=Omit<TimelineEvent,'payload'>&{payload_json:string};
  return this.db.all<Row>("SELECT * FROM events WHERE conversation_id=? AND sequence>? AND type='room.context_update' AND EXISTS (SELECT 1 FROM json_each(events.payload_json,'$.recipient_ids') WHERE value=?) ORDER BY sequence LIMIT ?",conversation,after,recipient,limit).map(({payload_json,...rest})=>({...rest,payload:JSON.parse(payload_json) as Record<string,unknown>}));
 }
 conversationEvents(conversation:string,before=Number.MAX_SAFE_INTEGER,limit=100):TimelineEvent[] {
  type Row={sequence:number;id:string;conversation_id:string|null;type:string;actor_id:string;cause_id:string|null;payload_json:string;created_at:string};
  return this.db.all<Row>('SELECT * FROM events WHERE conversation_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?',conversation,before,limit).reverse().map(({payload_json,...rest})=>({...rest,payload:JSON.parse(payload_json) as Record<string,unknown>}));
 }
 sequence():number { return this.db.all<{seq:number}>('SELECT COALESCE(MAX(sequence),0) AS seq FROM events')[0].seq; }
 run(id:string):Run { const run=this.db.all<Run>('SELECT * FROM runs WHERE id=?',id)[0]; if(!run) throw new ControlError('NOT_FOUND','Run unavailable.',404);return run; }
}

import { createHash } from 'node:crypto';
import { requireThat } from './errors';
import type { Store } from './store';
import type { ContextSnapshot, Run } from './types';

export const MEMORY_TOKENIZER = 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1';
export type MemoryPreparation = {
 schema_version:1;run_id:string;attempt:number;selected_model:string;
 sha256:string;global:string;scoped:string;
};
export type MemoryBudgetReceipt = Omit<MemoryPreparation,'global'|'scoped'> & {
 tokenizer:typeof MEMORY_TOKENIZER;global_tokens:number;scoped_tokens:number;
};

const lexicalTerms=(text:string)=>new Set(text.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)??[]);

/** Complete-or-refuse first stage: never return a partial set as a complete one.
 * These limits bound returned records and counting input, not SQLite scan cost.
 * Expired records count against the read-work cap until retention removes them.
 */
export function prepareMemory(store:Store,run:Run,model:string,now:string) {
 requireThat(typeof model==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(model),'NATIVE_PERSONA_UNMAPPED','The runtime must declare the selected persona model.');
 const records=store.scopedMemories(run.persona_id,run.routine_id,65);
 requireThat(records.length<=64,'MEMORY_PREPARATION_LIMIT','Memory preparation exceeds the record work limit. No memory was truncated.');
 let memories=records.filter(record=>!record.body.expires_at||Date.parse(record.body.expires_at)>Date.parse(now));
 // These exact JSON array values are the versioned budget domains. Count
 // framing/metadata too, not just text or a sum of separately encoded records.
 let global=JSON.stringify(memories.filter(record=>record.body.scope.kind==='global'));
 let scoped=JSON.stringify(memories.filter(record=>record.body.scope.kind!=='global'));
 requireThat(new TextEncoder().encode(global).byteLength+new TextEncoder().encode(scoped).byteLength<=131072,
  'MEMORY_PREPARATION_LIMIT','Memory preparation exceeds the byte work limit. No memory was truncated.');
 // Rank only after work bounds and scope/expiry filtering. Distinct literal
 // term overlap is deterministic, not semantic retrieval or authorization.
 // Reordering retains every record, including zero-score explicit constraints.
 const query=lexicalTerms((JSON.parse(run.context_json) as ContextSnapshot).instruction);
 memories=memories.map(memory=>({memory,score:[...lexicalTerms(memory.body.text)].filter(term=>query.has(term)).length}))
  .sort((a,b)=>b.score-a.score||(a.memory.id<b.memory.id?-1:a.memory.id>b.memory.id?1:0)).map(item=>item.memory);
 global=JSON.stringify(memories.filter(record=>record.body.scope.kind==='global'));
 scoped=JSON.stringify(memories.filter(record=>record.body.scope.kind!=='global'));
 const identity={schema_version:1 as const,run_id:run.id,attempt:run.current_attempt+1,selected_model:model};
 const sha256=createHash('sha256').update(JSON.stringify({...identity,global,scoped})).digest('hex');
 return {memories,preparation:{...identity,sha256,global,scoped}};
}

export function validateMemoryBudget(preparation:MemoryPreparation,receipt:MemoryBudgetReceipt):boolean {
 requireThat(receipt.schema_version===1&&receipt.run_id===preparation.run_id&&receipt.attempt===preparation.attempt&&
  receipt.selected_model===preparation.selected_model&&receipt.sha256===preparation.sha256&&receipt.tokenizer===MEMORY_TOKENIZER,
  'MEMORY_PREPARATION_STALE','Memory, model or task changed after preparation. Prepare again before claiming.');
 requireThat([receipt.global_tokens,receipt.scoped_tokens].every(count=>Number.isSafeInteger(count)&&count>=0),
  'INVALID_INPUT','Memory token counts must be nonnegative safe integers.',422);
 return receipt.global_tokens<=4000&&receipt.scoped_tokens<=8000;
}

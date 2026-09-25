import {expect,it,vi} from 'vitest';
import {fixture,bot} from './helpers';
import {runRoomCases,runFalsyRoomCases} from './run-room-cases';

it.each([
 ...runRoomCases.map((value,i)=>({...value,label:`strict case ${i}`,falsy:false})),
 ...runFalsyRoomCases.map((value,i)=>({...value,label:`falsy case ${i}`,falsy:true})),
])('preserves JS room semantics without hydrating eligible contexts: $label',({context,allowed,error,fallback,falsy})=>{
 const f=fixture();try{
  const id='room-read-fixture';
  f.db.exec("INSERT INTO runs(id,persona_id,context_json,status,created_at,updated_at) VALUES(?,?,?,'queued','t1','t1')",id,bot,context);
  const read=vi.spyOn(f.db,'all');
  try{
   const check=()=>falsy?f.store.runHasFalsyRoom(id):f.store.runHasNullRoom(id);
   if(error)expect(check).toThrowError(expect.objectContaining({name:error}));
   else expect(check()).toBe(allowed);
   const bodies=read.mock.results.flatMap(result=>result.type==='return'?result.value:[]).filter(row=>row&&typeof row==='object'&&'context_json' in row);
   expect(bodies).toEqual(fallback?[{context_json:context}]:[]);
   const rows=read.mock.results[0].value;
   expect(rows).toEqual([{[falsy?'room_is_falsy':'room_is_null']:fallback?null:allowed?1:0}]);
  }finally{read.mockRestore();}
  expect(f.db.all('SELECT context_json FROM runs WHERE id=?',id)).toEqual([{context_json:context}]);
 }finally{f.close();}
});

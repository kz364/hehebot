import {expect,it,vi} from 'vitest';
import {fixture,bot} from './helpers';
import {runRoomCases,runFalsyRoomCases} from './run-room-cases';

for(const mode of ['bootstrap','warm','background'] as const){
 it.each(runFalsyRoomCases.map((value,index)=>({...value,index})))(`${mode} assignment preserves JS room precheck and avoids eligible snapshot hydration: $index`,({context,allowed,error,fallback})=>{
  const f=fixture();try{
   const receipt=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Assignment precheck'}}),id=receipt.resource_id!;
   const checkpoint=JSON.stringify({padding:'界'.repeat(400000)});
   f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,id);
   const run=f.store.run(id),state=f.db.all('SELECT * FROM lifecycle'),admission=f.core[mode];
   // Isolate assignment's metadata/room gate. The already-applied command stops
   // further admission, so generation configuration is deliberately not involved.
   Object.defineProperty(admission,'config',{value:{owner_id:'owner',persona_id:bot,expires_at:'2026-09-11T00:00:00.000Z'}});
   const read=vi.spyOn(f.db,'all');
   try{
    const check=()=>admission.assignNewMessage('owner',run.command_id!,id);
    if(error)expect(check).toThrowError(expect.objectContaining({name:error}));
    else if(allowed&&mode!=='bootstrap')expect(check).toThrowError(expect.objectContaining({code:'CAPABILITY_UNAVAILABLE'}));
    else expect(check).not.toThrow();
    expect(read.mock.calls.some(([sql])=>sql==='SELECT * FROM commands WHERE id=?')).toBe(Boolean(allowed));
    const rows=read.mock.results.flatMap(result=>result.type==='return'?result.value:[]);
    expect(rows.filter(row=>row&&typeof row==='object'&&'context_json' in row)).toEqual(fallback?[{context_json:context}]:[]);
    for(const row of rows)expect(row).not.toHaveProperty('checkpoint_json');
   }finally{read.mockRestore();}
   expect(f.store.run(id)).toEqual(run);expect(f.db.all('SELECT * FROM lifecycle')).toEqual(state);
  }finally{f.close();}
 });
 it(`${mode} assignment rejects metadata before parsing an invalid JS context`,()=>{
  const f=fixture();try{
   const id=f.core.enqueue(bot,'Wrong command',null,null,null);
   f.db.exec("UPDATE runs SET context_json='null' WHERE id=?",id);
   const admission=f.core[mode];
   Object.defineProperty(admission,'config',{value:{owner_id:'owner',persona_id:bot,expires_at:'2026-09-11T00:00:00.000Z'}});
   const room=vi.spyOn(f.store,'runHasFalsyRoom');
   expect(()=>admission.assignNewMessage('owner','not-the-command',id)).not.toThrow();
   expect(room).not.toHaveBeenCalled();room.mockRestore();
  }finally{f.close();}
 });
}

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

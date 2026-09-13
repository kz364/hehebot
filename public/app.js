import { installImportSetup } from './import-setup.js';
const $=id=>document.getElementById(id);
const olderEvents=new Map();
let snapshot=null,selected=localStorage.getItem('personal.selected'),events=[],loading=false,lastSignature='',editing=null;
const names={IDLE_PERMITTED:'Idle — hibernation permitted',STOPPED:'Sleeping',START_REQUESTED:'Waking',BOOTING:'Starting',READY:'Awake',DRAINING:'Finishing up',STOP_COMMITTED:'Stopping',STOPPING:'Stopping',RECOVERY_REQUIRED:'Recovery needed'};
const statuses={queued:'Queued',claimed:'Starting',running:'Working',finishing:'Saving result',completed:'Completed',waiting:'Waiting',failed:'Failed',cancelling:'Cancelling',cancelled:'Cancelled',recovery_required:'Needs recovery'};
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function report(message){$('error').textContent=message;$('error').hidden=!message;}
function time(iso){return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
async function api(path,options={}){const response=await fetch(path,options);let value;try{value=await response.json();}catch{throw new Error('The portal returned an unexpected response.');}if(!response.ok)throw new Error(value.error?.message??'The request failed.');return value;}
async function command(type,payload,key=crypto.randomUUID()){
 const result=await api('/v1/commands',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({schema_version:1,type,payload})});
 if(result.status==='rejected')throw new Error(result.error?.message??'This change could not be saved.');return result;
}
function items(kind){return snapshot?.objects?.filter(x=>x.kind===kind)??[];}
function current(){return snapshot?.objects?.find(x=>x.id===selected);}
function button(text,fn,cls=''){const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;}
async function refresh(force=false){
 if(loading||document.hidden&&!force)return;loading=true;
 try{const value=await api('/v1/state');snapshot=value;events=value.timeline??[];
  if(!selected||!value.objects.some(x=>x.id===selected))selected=items('persona').find(x=>!x.body.archived)?.id;
  const conversationId=selected;const history=await api('/v1/conversations/'+conversationId+'/events');if(selected===conversationId){const combined=[...(olderEvents.get(conversationId)??[]),...history.events];events=[...new Map(combined.map(x=>[x.sequence,x])).values()].sort((a,b)=>a.sequence-b.sequence);}
  $('connection').textContent='Connected';$('connection-dot').classList.add('online');render();
 }catch(e){$('connection').textContent='Offline';$('connection-dot').classList.remove('online');report(e.message);}
 finally{loading=false;}
}
function choose(id){selected=id;localStorage.setItem('personal.selected',id);$('message').value=localStorage.getItem('personal.draft.'+id)??'';lastSignature='';render();refresh(true);$('message').focus();}
function render(){
 if(!snapshot)return;
 for(const [kind,target] of [['persona','bots'],['room','rooms']]){
  $(target).replaceChildren();
  for(const object of items(kind).filter(x=>!x.body.archived)){
   const b=button('',()=>choose(object.id),'nav-item');b.setAttribute('aria-current',String(object.id===selected));b.append(node('span',object.body.name.slice(0,1),'avatar'),node('span',object.body.name));$(target).append(b);
  }
 }
 const object=current();$('conversation-name').textContent=object?.body.name??'Choose a bot';$('conversation-type').textContent=object?.kind==='room'?'SHARED ROOM':'ASSISTANT';$('edit-bot').hidden=object?.kind!=='persona';
 $('runtime-state').textContent=names[snapshot.summary.phase]??snapshot.summary.phase;$('runtime-provider').textContent=snapshot.provider?.id??'Unconfigured';$('runtime-queued').textContent=snapshot.summary.queued_runs;$('runtime-waiting').textContent=snapshot.summary.blocked_runs;
 $('runtime-banner').hidden=snapshot.summary.execution_enabled;
 $('runtime-banner').textContent='Your messages and routines are saved. The assistant is waiting for its runtime connection and sign-in before it can work.';
 const conversation=events.filter(x=>x.conversation_id===selected);const runs=snapshot.runs.filter(x=>x.persona_id===selected||conversation.some(e=>e.payload?.run_id===x.id));
 const signature=JSON.stringify([selected,conversation,runs]);
 if(signature!==lastSignature){lastSignature=signature;const timeline=$('timeline');const nearBottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<100;timeline.replaceChildren();
  if(conversation.length>=100){timeline.append(button('Load earlier messages',async()=>{try{const history=await api('/v1/conversations/'+selected+'/events?before='+conversation[0].sequence);olderEvents.set(selected,[...history.events,...conversation].slice(-1000));events=olderEvents.get(selected);lastSignature='';render();}catch(e){report(e.message);}},'quiet'));}
  if(!conversation.length){const empty=node('div',undefined,'empty');empty.append(node('h2',`A place to work with ${object?.body.name??'your assistant'}`),node('p','Ask for help, share an update, or describe something you’d like done on a schedule.'));timeline.append(empty);}
  for(const event of conversation){
   if(event.type==='message.user'||event.type==='run.result'){
    const m=node('article',undefined,'message '+(event.type==='message.user'?'user':'bot'));const h=node('div',undefined,'message-head');h.append(node('strong',event.type==='message.user'?'You':event.payload.role==='background'?`${object?.body.name??'Assistant'} · ${event.payload.title??'Task result'}`:object?.body.name??'Assistant'),node('time',time(event.created_at)));m.append(h,node('div',event.payload.text??'','message-body'));timeline.append(m);
   }else if(['run.accepted','run.cancellation_requested'].includes(event.type)){
    const run=runs.find(x=>x.id===event.payload.run_id);if(!run)continue;const e=node('div',undefined,'event');e.append(node('span',statuses[run.status]??run.status,'status'));
    if(run.status==='waiting')e.append(node('span',run.error_code==='CAPABILITY_UNAVAILABLE'?'Runtime connection required':run.error_code??'Input required'));
    if(['queued','claimed','running','waiting'].includes(run.status))e.append(button('Cancel',()=>act(()=>command('run.cancel',{run_id:run.id,reason:'Owner requested cancellation.'}))));
    if(['failed','cancelled','recovery_required','waiting'].includes(run.status)&&snapshot.summary.execution_enabled)e.append(button('Retry',()=>act(()=>command('run.retry',{run_id:run.id,expected_attempt:run.current_attempt}))));timeline.append(e);
   }else if(event.type.startsWith('room.')){const e=node('div',undefined,'event');e.append(node('span',event.type==='room.context_update'?'Context update':'Room update'),node('span',event.payload.text??''));timeline.append(e);}
  }
  for(const run of runs.filter(x=>x.role==='background')){
   const card=node('details',undefined,'task-card');card.append(node('summary',`${run.title??'Background task'} · ${statuses[run.status]??run.status}`));
   card.append(node('p',`Task ${run.id}`,'hint'));
   const actions=node('div',undefined,'actions');
   actions.append(button('Follow up on this task',()=>{const key=crypto.randomUUID();openEditor(`Follow up: ${run.title??'Task'}`,[node('p','This message targets only the selected task. While it is active, the follow-up waits for native settlement.','hint'),field('Follow-up','text','','textarea')],form=>command('run.followup',{run_id:run.id,text:form.get('text')},key));},'quiet'));
   if(['queued','claimed','running','finishing','waiting'].includes(run.status))actions.append(button('Cancel this task',()=>act(()=>command('run.cancel',{run_id:run.id,reason:'Owner selected this task for cancellation.'})),'quiet danger'));
   card.append(actions);timeline.append(card);
  }
  if(nearBottom||!timeline.scrollTop)timeline.scrollTop=timeline.scrollHeight;
 }
 $('routines').replaceChildren();for(const r of items('routine').filter(x=>x.body.persona_id===selected)){
  const card=node('div',undefined,'card');card.append(node('h4',r.body.name),node('span',r.body.enabled?'Scheduled':'Paused','status'),node('p',r.body.schedule?`${r.body.schedule.cron} · ${r.body.schedule.timezone}`:'Event-triggered'),node('p',r.body.instructions));const actions=node('div',undefined,'actions');actions.append(button('Edit',()=>editRoutine(r)),button(r.body.enabled?'Pause':'Enable',()=>act(()=>command('routine.put',{...r.body,expected_revision:r.revision,enabled:!r.body.enabled}))));card.append(actions);$('routines').append(card);
 }if(!$('routines').children.length)$('routines').append(node('p','No routines for this bot yet.','muted'));
 $('add-routine').disabled=object?.kind!=='persona';
 $('memories').replaceChildren();for(const m of items('memory').filter(x=>x.body.scope.kind==='global'||x.body.scope.kind==='persona'&&x.body.scope.id===selected)){
  const card=node('div',undefined,'card');card.append(node('span',m.body.scope.kind==='global'?'Shared preference':'Bot memory','status'),node('p',m.body.text));const actions=node('div',undefined,'actions');actions.append(button('Edit',()=>editMemory(m)),button('Forget',()=>act(()=>command('memory.delete',{id:m.id,expected_revision:m.revision,purge_transcripts:false})),'danger'));card.append(actions);$('memories').append(card);
 }if(!$('memories').children.length)$('memories').append(node('p','Save preferences you want your bots to remember.','muted'));
}
async function act(fn){try{report('');await fn();await refresh(true);}catch(e){report(e.message);}}
$('message').oninput=()=>{if(selected)localStorage.setItem('personal.draft.'+selected,$('message').value);$('draft-status').textContent='Unsent draft saved on this device';};
$('composer').onsubmit=async event=>{
 event.preventDefault();if(!selected||!$('message').value.trim())return;const text=$('message').value,conversation=selected;
 const pendingKey='personal.pending.'+conversation;let pending;try{pending=JSON.parse(localStorage.getItem(pendingKey));}catch{}
 if(!pending||pending.text!==text)pending={text,key:crypto.randomUUID()};localStorage.setItem(pendingKey,JSON.stringify(pending));$('send').disabled=true;
 try{report('');await command('message.send',{conversation_id:conversation,text},pending.key);localStorage.removeItem(pendingKey);localStorage.removeItem('personal.draft.'+conversation);if(selected===conversation)$('message').value='';$('draft-status').textContent='Saved to your conversation';await refresh(true);}
 catch(e){report(e.message);$('draft-status').textContent='Not confirmed — Send retries the same message';}finally{$('send').disabled=false;}
};
function field(label,name,value='',type='text'){const l=node('label',label,'field');let input;if(type==='textarea')input=node('textarea');else{input=node('input');input.type=type;}input.name=name;input.value=value;input.required=true;l.append(input);return l;}
function selectField(label,name,options,value){const l=node('label',label,'field');const select=node('select');select.name=name;for(const [v,text]of options){const o=node('option',text);o.value=v;select.append(o);}select.value=value;l.append(select);return l;}
function openEditor(title,fields,save){editing=save;$('editor-title').textContent=title;$('editor-fields').replaceChildren(...fields);$('editor-error').hidden=true;$('editor').showModal();}
function closeEditor(){$('editor').close();editing=null;}
$('close-editor').onclick=closeEditor;$('cancel-editor').onclick=closeEditor;
$('editor-form').onsubmit=async e=>{e.preventDefault();if(!editing)return;const b=e.submitter;b.disabled=true;try{await editing(new FormData(e.target));closeEditor();await refresh(true);}catch(error){$('editor-error').textContent=error.message;$('editor-error').hidden=false;}finally{b.disabled=false;}};
function editBot(object){openEditor(object?'Bot instructions':'New bot',[field('Name','name',object?.body.name??''),field('Instructions','instructions',object?.body.instructions??'','textarea')],form=>command('persona.put',{id:object?.id??crypto.randomUUID(),expected_revision:object?.revision??0,name:form.get('name'),instructions:form.get('instructions'),tool_policy_ids:object?.body.tool_policy_ids??[],archived:false}));}
function editRoutine(object){
 const routine=object?.body;openEditor(object?'Edit routine':'New routine',[
  field('Name','name',routine?.name??''),field('What should this bot do?','instructions',routine?.instructions??'','textarea'),
  field('Schedule (five-field cron)','cron',routine?.schedule?.cron??'0 8 * * 1-5'),node('p','For example, 0 8 * * 1-5 means weekdays at 8am. Or describe your schedule in chat once your bot is connected.','hint'),
  field('Timezone','timezone',routine?.schedule?.timezone??'Asia/Jakarta'),selectField('State','enabled',[['true','Enabled'],['false','Paused']],String(routine?.enabled??true))
 ],form=>command('routine.put',{id:object?.id??crypto.randomUUID(),expected_revision:object?.revision??0,persona_id:routine?.persona_id??selected,name:form.get('name'),instructions:form.get('instructions'),schedule:{cron:form.get('cron'),timezone:form.get('timezone')},trigger_source_id:null,enabled:form.get('enabled')==='true',policy:routine?.policy??{misfire:'coalesce',overlap:'queue_one',max_replay:1,max_lateness_seconds:86400},action_policy_ids:routine?.action_policy_ids??[]}));
}
function editMemory(object){
 const source=object?.body.source_event_id??events.findLast(x=>x.type==='message.user')?.id;
 if(!source){report('Send a message with the preference first, then save it as memory.');return;}
 openEditor(object?'Edit memory':'Remember a preference',[field('Preference or fact','text',object?.body.text??'','textarea'),selectField('Share with','scope',[['global','All bots'],['persona','This bot']],object?.body.scope.kind??'global')],form=>command('memory.put',{id:object?.id??crypto.randomUUID(),expected_revision:object?.revision??0,scope:{kind:form.get('scope'),id:form.get('scope')==='global'?null:selected},text:form.get('text'),source_event_id:source,expires_at:null,sensitivity:'ordinary'}));
}
$('add-bot').onclick=()=>editBot();$('edit-bot').onclick=()=>editBot(current());$('add-routine').onclick=()=>editRoutine();$('add-memory').onclick=()=>editMemory();
$('add-room').onclick=()=>{const bots=items('persona').filter(x=>!x.body.archived);const fields=[field('Room name','name'),selectField('Default responder','responder',bots.map(x=>[x.id,x.body.name]),bots[0]?.id)];for(const bot of bots){const l=node('label',undefined,'check');const c=node('input');c.type='checkbox';c.name='members';c.value=bot.id;c.checked=true;l.append(c,document.createTextNode(bot.body.name));fields.push(l);}openEditor('New room',fields,form=>command('room.put',{id:crypto.randomUUID(),expected_revision:0,name:form.get('name'),member_ids:form.getAll('members'),default_responder_id:form.get('responder')}));};
$('show-details').onclick=()=>$('details').classList.add('open');$('close-details').onclick=()=>$('details').classList.remove('open');$('refresh').onclick=()=>refresh(true);
installImportSetup({trigger:$('import-setup'),api,command,onAdopted:()=>refresh(true)});
await refresh(true);if(selected)$('message').value=localStorage.getItem('personal.draft.'+selected)??'';setInterval(()=>refresh(),5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});

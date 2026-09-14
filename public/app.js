import { installImportSetup } from './import-setup.js';
const $=id=>document.getElementById(id);
const olderEvents=new Map();
const historyFloors=new Map();
let recoveryView=null;
let taskFeed=null;
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
function skillsSelected(){return selected==='skills';}
function button(text,fn,cls=''){const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;}
function acceptHistory(conversationId,history){
 const floor=history.pruned_through??0,previous=historyFloors.get(conversationId)??0;
 if(floor<previous)return false; // A delayed response predates known retention; never restore its text.
 if(floor>previous){
  olderEvents.set(conversationId,(olderEvents.get(conversationId)??events.filter(e=>e.conversation_id===conversationId)).filter(e=>e.sequence>floor));
  historyFloors.set(conversationId,floor);
 }
 return true;
}
async function refresh(force=false){
 if(loading||document.hidden&&!force)return;loading=true;
 try{const value=await api('/v1/state');snapshot=value;
  if(!selected||selected!=='skills'&&!value.objects.some(x=>x.id===selected))selected=items('persona').find(x=>!x.body.archived)?.id;
  const conversationId=selected;if(conversationId!=='skills'){const history=await api('/v1/conversations/'+conversationId+'/events');if(selected===conversationId&&acceptHistory(conversationId,history)){const combined=[...(olderEvents.get(conversationId)??[]),...history.events];events=[...new Map(combined.map(x=>[x.sequence,x])).values()].sort((a,b)=>a.sequence-b.sequence);}}
  if(conversationId!=='skills'){
   try{const page=await api('/v1/conversations/'+conversationId+'/tasks');if(!page.counts||!Array.isArray(page.runs))throw new Error('Invalid task page');if(selected===conversationId)taskFeed={conversationId,page,error:false};}
   catch{if(selected===conversationId)taskFeed={conversationId,page:taskFeed?.conversationId===conversationId?taskFeed.page:null,error:true};}
  }
  const view=recoveryView;if(view){const request=++view.request,page=await api(recoveryUrl(view));if(recoveryView===view&&selected===view.conversationId&&view.request===request)view.page=page;}
  $('connection').textContent='Connected';$('connection-dot').classList.add('online');render();
 }catch(e){$('connection').textContent='Offline';$('connection-dot').classList.remove('online');report(e.message);if(taskFeed)taskFeed.error=true;if(recoveryView?.kind==='tasks')recoveryView.page=null;render();}
 finally{loading=false;}
}
function choose(id){recoveryView=null;taskFeed=null;selected=id;localStorage.setItem('personal.selected',id);$('message').value=localStorage.getItem('personal.draft.'+id)??'';lastSignature='';render();refresh(true);if(id!=='skills')$('message').focus();}
function recoveryUrl(view){return '/v1/conversations/'+view.conversationId+'/'+(view.kind==='tasks'?'tasks':'recovery')+(view.cursor?'?after='+encodeURIComponent(view.cursor):'');}
async function loadRecovery(cursor=null,previous=[],kind='recovery',focusRun=null){
 const view={conversationId:selected,cursor,previous,kind,focusRun,page:null,request:1};recoveryView=view;report('');render();
 try{const page=await api(recoveryUrl(view));if(recoveryView===view&&selected===view.conversationId&&view.request===1){view.page=page;render();}}
 catch(e){if(recoveryView===view&&view.request===1){recoveryView=null;report(e.message);render();}}
}
function render(){
 if(!snapshot)return;
 renderBudget();renderMonitoring();renderTaskStrip();renderRoster();
 for(const [kind,target] of [['room','rooms']]){
  $(target).replaceChildren();
  for(const object of items(kind).filter(x=>!x.body.archived)){
   const b=button('',()=>choose(object.id),'nav-item');b.setAttribute('aria-current',String(object.id===selected));b.append(node('span',object.body.name.slice(0,1),'avatar'),node('span',object.body.name));$(target).append(b);
  }
 }
 $('show-skills').setAttribute('aria-current',String(skillsSelected()));
 if(skillsSelected()){renderSkills();return;}
 document.querySelector('.app').classList.remove('skills-mode');$('details').hidden=false;$('composer').hidden=false;$('show-details').hidden=false;$('edit-bot').hidden=false;
 const object=current();$('conversation-name').textContent=object?.body.name??'Choose a bot';$('conversation-type').textContent=object?.kind==='room'?'SHARED ROOM':'ASSISTANT';$('edit-bot').hidden=object?.kind!=='persona';
 $('runtime-state').textContent=names[snapshot.summary.phase]??snapshot.summary.phase;$('runtime-provider').textContent=snapshot.provider?.id??'Unconfigured';$('runtime-queued').textContent=snapshot.summary.queued_runs;$('runtime-waiting').textContent=snapshot.summary.blocked_runs;
 $('runtime-banner').hidden=snapshot.summary.execution_enabled;
 $('runtime-banner').textContent='Your messages and routines are saved. The assistant is waiting for its runtime connection and sign-in before it can work.';
 const view=recoveryView?.conversationId===selected?recoveryView:null;
 const conversation=view?[]:events.filter(x=>x.conversation_id===selected);const runs=view?(view.page?.runs??[]):snapshot.runs.filter(x=>x.persona_id===selected||conversation.some(e=>e.payload?.run_id===x.id));
 const steering=(view?.kind==='tasks'?view.page?.steering??[]:snapshot.steering??[]).filter(x=>runs.some(run=>run.id===x.run_id));
 const recovery=(view?(view.page?.recovery??[]):snapshot.recovery??[]).filter(x=>runs.some(run=>run.id===x.run_id));
 const previews=(view?.kind==='tasks'?view.page?.output_previews??[]:snapshot.output_previews??[]).filter(x=>runs.some(run=>run.id===x.run_id&&run.current_attempt===x.attempt&&['running','finishing','recovery_required'].includes(run.status)&&!['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code)));
 const signature=JSON.stringify([selected,conversation,runs,steering,recovery,previews,Boolean(view),view?.kind,view?.focusRun,view?.cursor,view?.previous,view?.page,snapshot.summary.execution_enabled,historyFloors.get(selected)]);
 if(signature!==lastSignature){lastSignature=signature;const timeline=$('timeline');const nearBottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<100;const expanded=new Set([...timeline.querySelectorAll('.task-card[open]')].map(card=>card.dataset.runId));timeline.replaceChildren();
  if(view){
   const taskMode=view.kind==='tasks',label=taskMode?'task':'recovery';
   timeline.append(node('h2',taskMode?'Current tasks':'Recovery tasks'),node('p',`All retained ${taskMode?'unfinished':'recovery'} tasks in this conversation, paged by stable task ID. Restart from the first page to include newly arrived tasks. Reviewing does not retry or release anything.`,'hint'));
   const controls=node('div',undefined,'actions');controls.append(button('Back to messages',()=>{recoveryView=null;render();},'quiet'),button(`First ${label} page`,()=>loadRecovery(null,[],view.kind),'quiet'));
   if(view.previous.length)controls.append(button(`Previous ${label} page`,()=>loadRecovery(view.previous.at(-1),view.previous.slice(0,-1),view.kind),'quiet'));
   if(view.page?.next_cursor)controls.append(button(`Next ${label} page`,()=>loadRecovery(view.page.next_cursor,[...view.previous,view.cursor],view.kind),'quiet'));
   timeline.append(controls);if(!runs.length){const notice=node('p',view.page?`No ${taskMode?'unfinished':'recovery'} tasks on this page.`:`Loading ${taskMode?'current':'recovery'} tasks…`,'hint');notice.setAttribute('role','status');timeline.append(notice);}
  }else timeline.append(button('Review recovery tasks',()=>loadRecovery(),'quiet'));
  if(!view&&historyFloors.get(selected)){const notice=node('p','Earlier history has expired under the retention policy. Only retained messages and updates are shown.','hint');notice.setAttribute('role','status');timeline.append(notice);}
  if(conversation.length>=100){const conversationId=selected;timeline.append(button('Load earlier messages',async()=>{try{
   const history=await api('/v1/conversations/'+conversationId+'/events?before='+conversation[0].sequence);
   if(!acceptHistory(conversationId,history))return;
   const combined=[...history.events,...(olderEvents.get(conversationId)??conversation)];
   olderEvents.set(conversationId,[...new Map(combined.map(event=>[event.sequence,event])).values()].sort((a,b)=>a.sequence-b.sequence).slice(-1000));
   if(selected!==conversationId)return;
   events=olderEvents.get(conversationId);lastSignature='';render();
  }catch(e){if(selected===conversationId)report(e.message);}},'quiet'));}
  if(!view&&!conversation.length){const empty=node('div',undefined,'empty');empty.append(node('h2',`A place to work with ${object?.body.name??'your assistant'}`),node('p','Ask for help, share an update, or describe something you’d like done on a schedule.'));timeline.append(empty);}
  for(const event of conversation){
   if(event.type==='message.user'||event.type==='run.result'){
    const m=node('article',undefined,'message '+(event.type==='message.user'?'user':'bot'));const h=node('div',undefined,'message-head');h.append(node('strong',event.type==='message.user'?'You':event.payload.role==='background'?`${object?.body.name??'Assistant'} · ${event.payload.title??'Task result'}`:object?.body.name??'Assistant'),node('time',time(event.created_at)));m.append(h,node('div',event.payload.text??'','message-body'));timeline.append(m);
   }else if(['run.accepted','run.cancellation_requested'].includes(event.type)){
    const run=runs.find(x=>x.id===event.payload.run_id);if(!run)continue;const e=node('div',undefined,'event');e.append(node('span',statuses[run.status]??run.status,'status'));
    if(run.status==='waiting')e.append(node('span',run.error_code==='CAPABILITY_UNAVAILABLE'?'Runtime connection required':run.error_code??'Input required'));
    if(['queued','claimed','running','waiting'].includes(run.status))e.append(button('Cancel',()=>act(()=>command('run.cancel',{run_id:run.id,reason:'Owner requested cancellation.'}))));
    if(['failed','cancelled','recovery_required','waiting'].includes(run.status)&&snapshot.summary.execution_enabled)e.append(button('Retry',()=>act(()=>command('run.retry',{run_id:run.id,expected_attempt:run.current_attempt}))));timeline.append(e);
   }else if(event.type==='effect.owner_reconciled'||event.type==='run.owner_recovered'){
    const e=node('div',undefined,'event');e.setAttribute('role','status');
    e.append(node('span',event.type==='effect.owner_reconciled'?`Owner recorded effect outcome: ${event.payload.outcome}. This is not provider-verified evidence.`:`Recovery closed as ${event.payload.status}. This did not retry the native task.`));timeline.append(e);
   }else if(event.type==='task.followup_expired'){
    const e=node('div',undefined,'event');e.setAttribute('role','status');e.append(node('span','Follow-up expired','status'),node('span','A deferred follow-up expired after 90 days without delivery. Send a fresh follow-up on the task if it is still needed.'));timeline.append(e);
   }else if(event.type==='run.input_expired'){
    const e=node('div',undefined,'event');e.setAttribute('role','status');e.append(node('span','Request expired','status'),node('span','A queued request expired after 90 days without starting. Send a fresh request if it is still needed.'));timeline.append(e);
   }else if(event.type.startsWith('room.')){const e=node('div',undefined,'event');e.append(node('span',event.type==='room.context_update'?'Context update':'Room update'),node('span',event.payload.text??''));timeline.append(e);}
  }
  for(const run of runs.filter(x=>view?.kind==='tasks'||x.role==='background'||['running','finishing','recovery_required'].includes(x.status)||steering.some(receipt=>receipt.run_id===x.id))){
   const title=run.title??(run.role==='background'?'Background task':'Conversation task');
   const card=node('details',undefined,'task-card');card.dataset.runId=run.id;card.open=expanded.has(run.id)||view?.focusRun===run.id;card.append(node('summary',`${title} · ${statuses[run.status]??run.status}`));
   card.append(node('p',`Task ${run.id}`,'hint'));
   if(view?.kind==='tasks'){
    card.append(node('p',`Owner: ${items('persona').find(bot=>bot.id===run.persona_id)?.body.name??'Unavailable bot'} · Original request: ${run.request_status??'receipt unavailable'}. Request application is not task completion.`,'hint'));
    if(run.error_code)card.append(node('p',`Waiting or recovery reason: ${run.error_code}`,'hint'));
    if(run.status==='cancelling')card.append(node('p','Cancellation requested, not confirmed. Children, tools and effects may remain unresolved.','review-notice'));
   }
   const preview=previews.find(item=>item.run_id===run.id);
   if(preview){
    card.querySelector('summary').append(node('span',' · Provisional output','status'));
    const section=node('section',undefined,'output-preview');section.setAttribute('aria-label','Provisional task output');
    section.append(node('p','Latest native message — provisional. This is not a completed result; children, tools or effects may still be unresolved.','hint'),node('div',preview.text,'message-body'));
    if(preview.truncated)section.append(node('p','Preview shortened. This is not the complete native message.','hint'));
    card.append(section);
   }
   const recovering=recovery.find(item=>item.run_id===run.id&&item.attempt===run.current_attempt);
   if(recovering)renderRecovery(card,run,recovering,title);
   const receipts=steering.filter(x=>x.run_id===run.id&&x.attempt===run.current_attempt);
   for(const receipt of receipts){
    const labels={pending:'Steering awaits native acknowledgement. Do not resend while delivery is unresolved.',accepted:'Steering accepted by the native task. Understanding and completion are not yet verified.',outcome_unknown:'Steering delivery is uncertain. Do not resend; reconciliation is required.',not_delivered:'Steering was not delivered because the native task was no longer accepting it.'};
    card.append(node('p',labels[receipt.status]??'Steering receipt unavailable.','hint'));
   }
   const actions=node('div',undefined,'actions');
   if(run.status==='running'&&snapshot.summary.execution_enabled){
    const steer=button('Steer this task now',()=>{const key=crypto.randomUUID(),instruction=field('Instruction','text','','textarea');instruction.querySelector('textarea').maxLength=32768;openEditor(`Steer: ${title}`,[node('p','This changes only the selected task’s remaining work at its next native message boundary. It does not undo effects, cancel tools, grant new permissions, or prove the instruction was obeyed.','hint'),instruction],form=>command('run.steer',{run_id:run.id,expected_attempt:run.current_attempt,text:form.get('text')},key));},'quiet');
    steer.dataset.action='steer';steer.disabled=receipts.some(receipt=>['pending','outcome_unknown'].includes(receipt.status));actions.append(steer);
   }
   if(run.role==='background')actions.append(button('Follow up after settlement',()=>{const key=crypto.randomUUID();openEditor(`Follow up: ${title}`,[node('p','This message targets only the selected task. While it is active, the follow-up waits for native settlement.','hint'),field('Follow-up','text','','textarea')],form=>command('run.followup',{run_id:run.id,text:form.get('text')},key));},'quiet'));
   if(['queued','claimed','running','finishing','waiting'].includes(run.status))actions.append(button('Cancel this task',()=>act(()=>command('run.cancel',{run_id:run.id,reason:'Owner selected this task for cancellation.'})),'quiet danger'));
   card.append(actions);timeline.append(card);
  }
  if(view?.focusRun&&view.page){const card=[...timeline.querySelectorAll('.task-card')].find(card=>card.dataset.runId===view.focusRun);card?.scrollIntoView({block:'nearest'});view.focusRun=null;}
  if(!view&&(nearBottom||!timeline.scrollTop))timeline.scrollTop=timeline.scrollHeight;
 }
 $('routines').replaceChildren();for(const r of items('routine').filter(x=>x.body.persona_id===selected)){
  const card=node('div',undefined,'card');card.append(node('h4',r.body.name),node('span',r.body.enabled?'Scheduled':'Paused','status'),node('p',r.body.schedule?`${r.body.schedule.cron} · ${r.body.schedule.timezone}`:'Event-triggered'),node('p',r.body.instructions));const actions=node('div',undefined,'actions');actions.append(button('Edit',()=>editRoutine(r)),button(r.body.enabled?'Pause':'Enable',()=>act(()=>command('routine.put',{...r.body,expected_revision:r.revision,enabled:!r.body.enabled}))));
  actions.append(button('Run now',()=>act(()=>command('routine.run',{id:r.id,expected_revision:r.revision}))),button('Delete',()=>{if(confirm(`Delete “${r.body.name}”? Future and queued work will stop. Already active tasks will continue.`))act(()=>command('routine.delete',{id:r.id,expected_revision:r.revision}));},'danger'));
  card.append(actions);$('routines').append(card);
 }if(!$('routines').children.length)$('routines').append(node('p','No routines for this bot yet.','muted'));
 $('add-routine').disabled=object?.kind!=='persona';
 $('memories').replaceChildren();for(const m of items('memory').filter(x=>x.body.scope.kind==='global'||x.body.scope.kind==='persona'&&x.body.scope.id===selected)){
  const card=node('div',undefined,'card');card.append(node('span',m.body.scope.kind==='global'?'Shared preference':'Bot memory','status'),node('p',m.body.text));const actions=node('div',undefined,'actions');actions.append(button('Edit',()=>editMemory(m)),button('Forget',()=>act(()=>command('memory.delete',{id:m.id,expected_revision:m.revision,purge_transcripts:false})),'danger'));card.append(actions);$('memories').append(card);
 }if(!$('memories').children.length)$('memories').append(node('p','Save preferences you want your bots to remember.','muted'));
}
function renderTaskStrip(){
 const strip=$('task-strip'),target=$('task-strip-content');strip.hidden=skillsSelected();if(strip.hidden)return;
 const feed=taskFeed?.conversationId===selected?taskFeed:null,page=feed?.page;
 const signature=JSON.stringify([selected,feed?.error,page?.counts,page?.runs,items('persona').map(bot=>[bot.id,bot.body.name])]);
 if(strip.dataset.signature===signature)return;strip.dataset.signature=signature;target.replaceChildren();
 $('task-strip-summary').textContent=feed?.error?'Tasks — unavailable or stale':page?`Tasks ${page.counts.total} · Waiting ${page.counts.waiting} · Recovery ${page.counts.recovery}`:'Tasks — loading';
 if(feed?.error){target.append(node('p','Task status could not be refreshed. Do not infer completion from missing or stale observations.','hint'),button('Refresh tasks',()=>refresh(true),'quiet'));return;}
 if(!page){target.append(node('p','Loading authoritative task records…','hint'));return;}
 target.append(node('p',`${page.runs.length} loaded; scroll to review this page. Counts include all pages. Native approval and question coverage is not yet verified.`,'hint'));
 for(const run of page.runs){
  const owner=items('persona').find(bot=>bot.id===run.persona_id)?.body.name??'Unavailable bot';
  const row=button(`${run.title??(run.role==='background'?'Background task':'Conversation task')} · ${owner} · ${statuses[run.status]??run.status}`,()=>{strip.open=false;loadRecovery(null,[],'tasks',run.id);},'task-strip-row');row.dataset.taskId=run.id;target.append(row);
 }
 if(!page.runs.length)target.append(node('p','No unfinished tasks are recorded here. This is not native settlement or safe-sleep evidence.','hint'));
 target.append(button(page.next_cursor?'Browse all task pages':'Review task details',()=>{strip.open=false;loadRecovery(null,[],'tasks');},'quiet'));
}
function renderRoster(){
 const layout=snapshot.roster??{revision:0,sections:[],hidden_persona_ids:[]},hidden=new Set(layout.hidden_persona_ids),bots=items('persona').filter(bot=>!bot.body.archived),query=$('roster-search').value.toLocaleLowerCase();
 const observation=snapshot.roster_activity,stale=$('connection').textContent!=='Connected'||!observation||Date.now()-Date.parse(observation.observed_at)>=30000;
 const activity=id=>observation?.personas.find(row=>row.persona_id===id);
 const attention=ids=>ids.reduce((sum,id)=>{const row=activity(id);return sum+(row?.waiting??0)+(row?.recovery??0);},0);
 const row=bot=>{const b=button('',()=>choose(bot.id),'nav-item');b.dataset.personaId=bot.id;b.setAttribute('aria-current',String(bot.id===selected));const text=node('span',bot.body.name),a=activity(bot.id);if(a)text.append(node('small',stale?'Activity stale':`${a.unfinished} unfinished · ${a.waiting} waiting · ${a.recovery} recovery`));b.append(node('span',bot.body.name.slice(0,1),'avatar'),text);return b;};
 const visible=bots.filter(bot=>!hidden.has(bot.id)&&bot.body.name.toLocaleLowerCase().includes(query)),assigned=new Set(layout.sections.flatMap(section=>section.persona_ids));
 $('bots').replaceChildren();
 for(const section of layout.sections){
  const members=section.persona_ids.flatMap(id=>visible.filter(bot=>bot.id===id));if(query&&!members.length)continue;
  const group=node('div',undefined,'roster-section'),toggle=button(`${section.collapsed&&!query?'▸':'▾'} ${section.name} · ${stale?'attention stale':attention(section.persona_ids)+' waiting/recovery'}`,()=>act(()=>command('roster.set',{expected_revision:layout.revision,sections:layout.sections.map(s=>s.id===section.id?{...s,collapsed:!s.collapsed}:s),hidden_persona_ids:layout.hidden_persona_ids})),'roster-section-toggle');
  toggle.setAttribute('aria-expanded',String(!section.collapsed||Boolean(query)));group.append(toggle);if(!section.collapsed||query)group.append(...members.map(row));$('bots').append(group);
 }
 const unassigned=visible.filter(bot=>!assigned.has(bot.id));if(layout.sections.length&&unassigned.length)$('bots').append(node('p','Unassigned','roster-observation'));$('bots').append(...unassigned.map(row));
 if(!visible.length)$('bots').append(node('p',query?'No visible bots match. Hidden bots remain below.':'No visible bots. Review hidden bots or add one.','roster-observation'));
 const hiddenBots=items('persona').filter(bot=>hidden.has(bot.id));$('hidden-bots').hidden=!hiddenBots.length;
 $('hidden-bots-summary').textContent=`Hidden ${hiddenBots.length} · ${stale?'attention stale':attention(hiddenBots.map(bot=>bot.id))+' waiting/recovery'}`;
 $('hidden-bots-list').replaceChildren(...hiddenBots.map(row));
 $('roster-observation').textContent=stale?'Task observations unavailable or stale.':'Recorded tasks only; native approval/question coverage is unverified.';
}
function editRoster(){
 const layout=snapshot.roster??{revision:0,sections:[],hidden_persona_ids:[]},draft=structuredClone(layout),bots=items('persona'),container=node('div'),available=new Set(bots.map(bot=>bot.id));
 const move=(array,index,delta)=>{const next=index+delta;if(next>=0&&next<array.length)[array[index],array[next]]=[array[next],array[index]];};
 const draw=()=>{
  container.replaceChildren(node('p','Display only: hiding, grouping and collapsing never archive a bot, pause routines or cancel work. Delete a section to return its bots to Unassigned.','review-notice'));
  const unavailable=[...new Set([...draft.hidden_persona_ids,...draft.sections.flatMap(s=>s.persona_ids)])].filter(id=>!available.has(id));
  if(unavailable.length)container.append(button(`Remove ${unavailable.length} unavailable references before saving`,()=>{draft.hidden_persona_ids=draft.hidden_persona_ids.filter(id=>available.has(id));for(const s of draft.sections)s.persona_ids=s.persona_ids.filter(id=>available.has(id));draw();},'quiet'));
  draft.sections.forEach((section,index)=>{
   const card=node('div',undefined,'card'),name=field(`Section ${index+1} name`,`section-${section.id}`,section.name);name.querySelector('input').maxLength=160;name.querySelector('input').oninput=e=>section.name=e.target.value;
   card.append(name,button('Move section up',()=>{move(draft.sections,index,-1);draw();},'quiet'),button('Move section down',()=>{move(draft.sections,index,1);draw();},'quiet'),button('Delete section',()=>{draft.sections.splice(index,1);draw();},'quiet danger'));container.append(card);
  });
  const add=button('Add section',()=>{draft.sections.push({id:crypto.randomUUID(),name:'New section',persona_ids:[],collapsed:false});draw();},'quiet');add.disabled=draft.sections.length>=20;container.append(add);
  for(const bot of bots){
   const card=node('div',undefined,'card'),section=draft.sections.find(s=>s.persona_ids.includes(bot.id)),label=node('label',`${bot.body.name}${bot.body.archived?' (archived)':''}`,'field'),select=node('select');select.setAttribute('aria-label',`Section for ${bot.body.name}`);
   const none=node('option','Unassigned');none.value='';select.append(none);for(const s of draft.sections){const option=node('option',s.name);option.value=s.id;select.append(option);}select.value=section?.id??'';
   select.onchange=()=>{for(const s of draft.sections)s.persona_ids=s.persona_ids.filter(id=>id!==bot.id);draft.sections.find(s=>s.id===select.value)?.persona_ids.push(bot.id);draw();};label.append(select);card.append(label);
   const hide=node('label',undefined,'check'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=draft.hidden_persona_ids.includes(bot.id);checkbox.onchange=()=>{draft.hidden_persona_ids=draft.hidden_persona_ids.filter(id=>id!==bot.id);if(checkbox.checked)draft.hidden_persona_ids.push(bot.id);};hide.append(checkbox,document.createTextNode(`Hide ${bot.body.name}`));card.append(hide);
   if(section){card.append(node('p',`Position ${section.persona_ids.indexOf(bot.id)+1} in ${section.name}`,'hint'),button(`Move ${bot.body.name} up`,()=>{move(section.persona_ids,section.persona_ids.indexOf(bot.id),-1);draw();},'quiet'),button(`Move ${bot.body.name} down`,()=>{move(section.persona_ids,section.persona_ids.indexOf(bot.id),1);draw();},'quiet'));}container.append(card);
  }
 };
 draw();$('editor').classList.add('roster-editor');openEditor('Organize bots',[container,node('p','Concurrent edits are rejected. If the revision changed, close and reopen this editor to review the latest layout.','hint')],()=>command('roster.set',{expected_revision:draft.revision,sections:draft.sections,hidden_persona_ids:draft.hidden_persona_ids}));
}
$('roster-search').oninput=()=>renderRoster();$('organize-roster').onclick=()=>editRoster();
function renderRecovery(card,run,recovery,title){
 card.append(node('p',recovery.executor_terminated?(recovery.effects.length?'Executor termination confirmed. External effects still need separate review.':'Executor termination confirmed. No unresolved effects are recorded for this task.'):'Executor termination is not confirmed. Recovery actions are unavailable.','review-notice'));
 for(const [blocked,message] of [[recovery.unresolved_operations,'Operation records are unresolved.'],[recovery.descendants_unsettled,'Recover unfinished descendants before this task.'],[recovery.stale_locks,'A retained lock belongs to a different attempt. Administrative reconciliation is required.']])if(blocked)card.append(node('p',message,'hint'));
 card.append(node('p',`${recovery.retained_locks} resource lock(s) retained. Nothing is released by recording an effect outcome.`,'hint'));
 for(const effect of recovery.effects){
  const row=node('section',undefined,'card');row.append(node('h4',`Unresolved external effect · ${effect.classification}`),node('p',`Effect ${effect.id}`),node('p',`Action ${effect.action_key}`),node('p',`Request ${effect.request_digest}`));
  const decide=button('Record external outcome',()=>{
   const key=crypto.randomUUID(),evidence=field('Evidence reference (no URL or private text)','evidence_ref');evidence.querySelector('input').pattern='[A-Za-z0-9:._-]{1,128}';evidence.querySelector('input').maxLength=128;
   const outcome=selectField('Observed outcome','outcome',[['','Choose an outcome'],['confirmed','The effect occurred'],['failed','The effect did not occur']],'');outcome.querySelector('select').required=true;
   const affirmation=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.required=true;affirmation.append(check,document.createTextNode('I checked the external destination and can account for this exact effect.'));
   openEditor('Record an owner effect decision',[node('p',`Selected effect: ${effect.id}`,'message-body'),node('p','This records your decision, not provider-verified evidence. If the outcome is still unknown, cancel and keep it unresolved. This does not resend the action or release its locks.','review-notice'),outcome,evidence,affirmation],form=>command('effect.reconcile',{run_id:run.id,expected_attempt:recovery.attempt,effect_id:effect.id,expected_request_digest:effect.request_digest,outcome:form.get('outcome'),evidence_ref:form.get('evidence_ref')},key));
  },'quiet');decide.dataset.action='effect-reconcile';decide.disabled=!recovery.can_decide_effects||effect.status!=='outcome_unknown';row.append(decide);card.append(row);
 }
 if(recovery.effects_truncated)card.append(node('p','Showing the first 20 unresolved effects. Additional effects remain blocked; refresh after reviewing this page.','hint'));
 const close=button('Close recovery and release locks',()=>{
  const key=crypto.randomUUID(),affirmation=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.required=true;affirmation.append(check,document.createTextNode('Release this stopped attempt’s resource locks and close its recovery state.'));
  openEditor(`Close recovery: ${title}`,[node('p','This records the task as failed or cancelled, never successful. It does not retry the native task. Any previously requested deferred follow-ups may become eligible. The server rechecks effects, descendants and termination.','review-notice'),affirmation],()=>command('run.recover',{run_id:run.id,expected_attempt:recovery.attempt,release_resources:true},key));
 },'quiet danger');close.dataset.action='run-recover';close.disabled=!recovery.can_recover;card.append(close);
}
function lines(value){return String(value??'').split('\n').map(x=>x.trim()).filter(Boolean);}
function detail(label,value){const wrap=node('section',undefined,'skill-detail');wrap.append(node('h4',label));if(Array.isArray(value)){const list=node('ul');for(const item of value)list.append(node('li',item));wrap.append(list);}else wrap.append(node('p',value||'Not specified'));return wrap;}
function enablement(skillId,personaId){return (snapshot.skill_enablements??[]).find(x=>x.skill_id===skillId&&x.persona_id===personaId);}
function renderSkillBody(target,body){
 target.append(detail('Purpose',body.description),detail('When to use',body.when_to_use),detail('Inputs and access',body.inputs_access),detail('Procedure',body.steps),detail('Decision rules',body.decision_rules),detail('Validation',body.validation),detail('Output',body.output),detail('Failure handling',body.failure_handling),detail('Approval boundaries',body.approval_boundaries));
}
function renderSkills(){
 const signature=JSON.stringify(['skills',items('skill'),items('persona'),snapshot.skill_proposals,snapshot.skill_enablements]);
 if(lastSignature===signature)return;
 lastSignature=signature;
 const openSummaries=new Set([...$('timeline').querySelectorAll('details[open] > summary')].map(x=>x.textContent));
 const scrollTop=$('timeline').scrollTop;
 const timeline=$('timeline');document.querySelector('.app').classList.add('skills-mode');$('conversation-type').textContent='MANAGED CATALOG';$('conversation-name').textContent='Skills';$('edit-bot').hidden=true;$('show-details').hidden=true;$('composer').hidden=true;$('details').hidden=true;$('details').classList.remove('open');
 timeline.replaceChildren();const intro=node('div',undefined,'skills-intro');const heading=node('div',undefined,'skills-heading');const copy=node('div');copy.append(node('h2','Reviewed procedures'),node('p','Drafts stay proposals until you explicitly approve them. Enabling a skill is a separate per-bot choice.','muted'));heading.append(copy,button('+ Draft skill',()=>editSkillProposal(),'primary'));intro.append(heading);timeline.append(intro);
 const pending=(snapshot.skill_proposals??[]).filter(x=>x.status==='pending');timeline.append(node('h2',`Pending proposals (${pending.length})`,'subheading'));
 if(!pending.length)timeline.append(node('p','No proposals are waiting for review.','muted'));
 for(const proposal of pending){const card=node('details',undefined,'skill-card proposal');const summary=node('summary');summary.append(node('span',proposal.body.name),node('span',proposal.provenance?.kind==='owner'?'Owner draft':`${proposal.provenance?.kind??'Unknown'} content`,'status'));card.append(summary,node('p',`Source: ${proposal.provenance?.source_ref??'Not recorded'} · Proposal revision ${proposal.proposal_revision}`,'hint'));renderSkillBody(card,proposal.body);const notice=node('p','Approval confirms this procedure contains no private facts. Imported or model-written content is never approved automatically.','review-notice');const actions=node('div',undefined,'actions');actions.append(button('Approve',()=>reviewProposal(proposal,'approve'),'primary'),button('Reject',()=>reviewProposal(proposal,'reject'),'quiet danger'));card.append(notice,actions);timeline.append(card);}
 const catalog=items('skill').filter(x=>!x.deleted_at);timeline.append(node('h2',`Approved catalog (${catalog.length})`,'subheading'));
 if(!catalog.length)timeline.append(node('p','No skills have been approved yet.','muted'));
 for(const skill of catalog){const card=node('details',undefined,'skill-card');const summary=node('summary');summary.append(node('span',skill.body.name),node('span',`Revision ${skill.revision}`,'status'));card.append(summary,node('p',skill.body.description,'skill-description'));renderSkillBody(card,skill.body);const bots=node('div',undefined,'skill-bots');bots.append(node('h4','Bot access'));for(const persona of items('persona').filter(x=>!x.body.archived)){const record=enablement(skill.id,persona.id),enabled=record?.enabled===true;const row=node('div',undefined,'skill-bot-row');row.append(node('span',persona.body.name),button(enabled?'Disable':'Enable',()=>act(()=>command('skill.enable',{skill_id:skill.id,expected_skill_revision:skill.revision,persona_id:persona.id,enabled:!enabled})),enabled?'quiet danger':'quiet'));bots.append(row);}const actions=node('div',undefined,'actions');actions.append(button('Propose an update',()=>editSkillProposal(skill),'quiet'));card.append(bots,actions);timeline.append(card);}
 for(const details of timeline.querySelectorAll('details'))details.open=openSummaries.has(details.querySelector('summary')?.textContent);
 timeline.scrollTop=scrollTop;
}
function reviewProposal(proposal,decision){
 const fields=[node('p',decision==='approve'?'Review the complete procedure above before approving. Approval does not enable it for any bot.':'Reject this proposal without changing the approved catalog.','hint')];
 if(decision==='approve'){const label=node('label',undefined,'check affirmation');const check=node('input');check.type='checkbox';check.name='affirm';check.required=true;label.append(check,document.createTextNode('I affirm this draft contains no private facts.'));fields.push(label);}
 openEditor(`${decision==='approve'?'Approve':'Reject'} ${proposal.body.name}`,fields,()=>command('skill.review',{proposal_id:proposal.id,expected_proposal_revision:proposal.proposal_revision,decision}));
}
function editSkillProposal(skill){
 const draftId=skill?.id??crypto.randomUUID(),body=skill?.body??{};const existing=items('skill');const options=[['new','Create a new stable skill'],...existing.map(x=>[x.id,`Update ${x.body.name} (revision ${x.revision})`])];
 const fields=[selectField('Draft target','target',options,skill?.id??'new'),field('Name','name',body.name??''),field('Purpose','description',body.description??'','textarea'),field('When should a bot use it?','when_to_use',body.when_to_use??'','textarea'),field('Inputs and access (one per line)','inputs_access',(body.inputs_access??[]).join('\n'),'textarea'),field('Steps (one per line)','steps',(body.steps??[]).join('\n'),'textarea'),field('Decision rules (one per line)','decision_rules',(body.decision_rules??[]).join('\n'),'textarea'),field('Validation checks (one per line)','validation',(body.validation??[]).join('\n'),'textarea'),field('Expected output','output',body.output??'','textarea'),field('Failure handling (one per line)','failure_handling',(body.failure_handling??[]).join('\n'),'textarea'),field('Approval boundaries (one per line)','approval_boundaries',(body.approval_boundaries??[]).join('\n'),'textarea')];
 const affirmation=node('label',undefined,'check affirmation');const check=node('input');check.type='checkbox';check.name='affirm';check.required=true;affirmation.append(check,document.createTextNode('I affirm this procedural draft contains no private facts.'));fields.push(node('p','The portal does not scan for private facts. Your affirmation is required, and submission creates a pending proposal—not an approved skill.','review-notice'),affirmation);
 openEditor(skill?'Propose a skill update':'Draft a skill',fields,form=>{const target=form.get('target'),existingSkill=existing.find(x=>x.id===target);return command('skill.propose',{proposal_id:crypto.randomUUID(),skill_id:existingSkill?.id??draftId,expected_skill_revision:existingSkill?.revision??0,body:{name:form.get('name'),description:form.get('description'),when_to_use:form.get('when_to_use'),inputs_access:lines(form.get('inputs_access')),steps:lines(form.get('steps')),decision_rules:lines(form.get('decision_rules')),validation:lines(form.get('validation')),output:form.get('output'),failure_handling:lines(form.get('failure_handling')),approval_boundaries:lines(form.get('approval_boundaries')),contains_private_facts:false},provenance:{kind:'owner',source_ref:'portal:owner-draft'},executable_files_changed:false});});
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
const dollars=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
function renderMonitoring(){
 const m=snapshot.monitoring;$('monitoring-panel').hidden=!m;if(!m)return;
 const age=seconds=>seconds===null?'Unknown':`${Math.ceil(seconds)}s`;
 const rows=[['Ready requests',m.queue.count],['Oldest request',m.queue.count?age(m.queue.oldest_request_age_seconds):'None'],['Heartbeat age',m.lease.expected_running?age(m.lease.heartbeat_age_seconds):'Not expected'],['Recorded operations',m.operations.reduce((sum,row)=>sum+row.count,0)],['Resource locks',m.locks],['Uncertain effects',m.effects.find(row=>row.status==='outcome_unknown')?.count??0],['Schedule lag',age(m.schedules.lag_seconds)],['Backup verification','Not verified']];
 $('monitoring-stats').replaceChildren(...rows.map(([label,value])=>{const row=node('div');row.append(node('dt',label),node('dd',String(value)));return row;}));
 $('monitoring-operations').replaceChildren(...m.operations.map(row=>node('p',`${row.count} ${row.kind} · ${row.status}`,'hint')));
 const messages={HEARTBEAT_UNKNOWN:'Runtime heartbeat has not been verified.',HEARTBEAT_STALE:'Runtime heartbeat is overdue.',QUEUE_DELAYED:'Ready requests have waited over two minutes.',CANCEL_UNCONFIRMED:'Cancellation is not confirmed. Do not replay the action.',RECOVERY_REQUIRED:'Tasks need recovery review before resuming.',OUTCOME_UNKNOWN:'External outcomes are unknown. Reconcile before retrying.',OPERATION_OVERDUE:'Recorded operations exceeded their deadline.',SCHEDULE_DELAYED:'Scheduling is more than five minutes behind.',BACKUP_UNVERIFIED:'No coordinated backup has been verified.'};
 const signature=JSON.stringify(m.alerts),target=$('monitoring-alerts');
 if(target.dataset.signature!==signature){target.dataset.signature=signature;target.replaceChildren(...m.alerts.map(alert=>node('p',`${messages[alert.code]??alert.code}${alert.count===undefined?'':` (${alert.count})`}`,alert.severity==='error'?'hint danger':'hint')));}
}
function renderBudget(){
 const budget=snapshot.budget;$('budget-panel').hidden=!budget;if(!budget)return;
 const status={disabled:'Budget suspension is off',ok:'Within projected cap',BUDGET_UNKNOWN:'Optional work paused: estimate unavailable or expired',BUDGET_BLOCKED:'Optional work paused: projected cap reached'};
 $('budget-summary').replaceChildren(node('p',status[budget.status]),node('p',`${dollars(budget.policy.monthly_cap_cents)} monthly cap · ${budget.period} (Asia/Jakarta)`,'hint'),node('p',budget.report?`${dollars(budget.report.projected_cents)} projected · ${budget.freshness} · observed ${time(budget.report.observed_at)}`:'No infrastructure projection available.','hint'));
 if(budget.policy.enabled&&budget.freshness==='fresh'&&budget.threshold>=70){const alert=node('p',`Projection has reached ${budget.threshold}% of the cap.`,'hint');alert.setAttribute('role','status');$('budget-summary').append(alert);}
 $('budget-waits').replaceChildren();
 for(const run of snapshot.runs.filter(run=>run.status==='waiting'&&run.current_attempt===0&&['BUDGET_UNKNOWN','BUDGET_BLOCKED'].includes(run.error_code))){
  const name=items('routine').find(item=>item.id===run.routine_id)?.body.name??'Optional routine';
  const row=node('div',undefined,'routine-card');row.append(node('p',name),button('Allow this run once',()=>{
   const key=crypto.randomUUID();openEditor(`Allow once: ${name}`,[node('p','Allow only this scheduled run despite the budget wait. This does not enable runtime execution, grant connector permissions, or change the monthly cap.','hint')],()=>command('budget.override',{run_id:run.id,expected_revision:budget.revision},key));
  },'quiet'));$('budget-waits').append(row);
 }
}
$('edit-budget').onclick=()=>{
 const budget=snapshot.budget;if(!budget)return;const key=crypto.randomUUID();
 const fields=[selectField('Budget suspension','enabled',[['false','Off'],['true','On for selected optional routines']],String(budget.policy.enabled)),field('Monthly infrastructure cap (USD)','cap',(budget.policy.monthly_cap_cents/100).toFixed(2)),node('p','Select up to 20 optional routines. Missing or 24-hour-old projections pause their new scheduled runs; active work and owner messages are unaffected.','hint')];
 for(const routine of items('routine')){const label=node('label',undefined,'check'),input=node('input');input.type='checkbox';input.name='optional';input.value=routine.id;input.checked=budget.policy.optional_routine_ids.includes(routine.id);label.append(input,document.createTextNode(routine.body.name));fields.push(label);}
 openEditor('Infrastructure budget',fields,form=>{
  const value=String(form.get('cap'));if(!/^\d+(\.\d{1,2})?$/.test(value))throw new Error('Enter a USD amount with at most two decimal places.');
  const [whole,fraction='']=value.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents<1||cents>1000000000)throw new Error('The cap must be between $0.01 and $10,000,000.00.');
  const optional=form.getAll('optional');if(optional.length>20)throw new Error('Select at most 20 optional routines.');
  return command('budget.set',{expected_revision:budget.revision,enabled:form.get('enabled')==='true',monthly_cap_cents:cents,optional_routine_ids:optional},key);
 });
};
function closeEditor(){$('editor').close();$('editor').classList.remove('roster-editor');editing=null;}
$('close-editor').onclick=closeEditor;$('cancel-editor').onclick=closeEditor;
$('editor').addEventListener('close',()=>$('editor').classList.remove('roster-editor'));
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
$('show-skills').onclick=()=>choose('skills');
$('export-control').onclick=async()=>{
 const trigger=$('export-control'),status=$('export-status');
 if(trigger.disabled)return;
 trigger.disabled=true;status.textContent='Preparing private application data…';
 try{
  const response=await fetch('/v1/export/control',{cache:'no-store'});
  if(!response.ok){
   const message={401:'Sign in again before exporting private data.',429:'Export limit reached. Wait one minute before trying again.',413:'This application export exceeds the supported size limit.'};
   throw new Error(message[response.status]??'Export unavailable. No download was requested.');
  }
  if(response.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw new Error('Unexpected export response. No download was requested.');
  const blob=await response.blob();
  if(blob.size>4*1024*1024)throw new Error('This application export exceeds the supported size limit.');
  const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='hehebot-control-export.json';
  try{document.body.append(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  status.textContent='Download requested. Check your browser downloads and protect the unencrypted file. No coordinated backup or restore has been verified.';
 }catch(error){status.textContent=error instanceof TypeError?'Connection failed. No download was requested.':error.message;}
 finally{trigger.disabled=false;}
};
installImportSetup({trigger:$('import-setup'),api,command,onAdopted:()=>refresh(true)});
await refresh(true);if(selected)$('message').value=localStorage.getItem('personal.draft.'+selected)??'';setInterval(()=>refresh(),5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});

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
function skillsSelected(){return selected==='skills';}
function button(text,fn,cls=''){const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;}
async function refresh(force=false){
 if(loading||document.hidden&&!force)return;loading=true;
 try{const value=await api('/v1/state');snapshot=value;events=value.timeline??[];
  if(!selected||selected!=='skills'&&!value.objects.some(x=>x.id===selected))selected=items('persona').find(x=>!x.body.archived)?.id;
  const conversationId=selected;if(conversationId!=='skills'){const history=await api('/v1/conversations/'+conversationId+'/events');if(selected===conversationId){const combined=[...(olderEvents.get(conversationId)??[]),...history.events];events=[...new Map(combined.map(x=>[x.sequence,x])).values()].sort((a,b)=>a.sequence-b.sequence);}}
  $('connection').textContent='Connected';$('connection-dot').classList.add('online');render();
 }catch(e){$('connection').textContent='Offline';$('connection-dot').classList.remove('online');report(e.message);}
 finally{loading=false;}
}
function choose(id){selected=id;localStorage.setItem('personal.selected',id);$('message').value=localStorage.getItem('personal.draft.'+id)??'';lastSignature='';render();refresh(true);if(id!=='skills')$('message').focus();}
function render(){
 if(!snapshot)return;
 for(const [kind,target] of [['persona','bots'],['room','rooms']]){
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
$('show-skills').onclick=()=>choose('skills');
installImportSetup({trigger:$('import-setup'),api,command,onAdopted:()=>refresh(true)});
await refresh(true);if(selected)$('message').value=localStorage.getItem('personal.draft.'+selected)??'';setInterval(()=>refresh(),5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});

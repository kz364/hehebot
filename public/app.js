import { installImportSetup } from './import-setup.js';
const $=id=>document.getElementById(id);
const olderEvents=new Map();
const historyFloors=new Map();
const skillHistories=new Map();
let recoveryView=null;
let taskFeed=null;
let routineHistory=null;
let routinePreflight=null;
let connectorView=null;
let snapshot=null,selected=localStorage.getItem('personal.selected'),events=[],loading=false,lastSignature='',editing=null;
let selectionVersion=0;
let memorySearchSelection='';
let conversationSearchSelection='';
let alphaSession=null,alphaSeen=false,alphaInvalid=false,alphaExpired=false,alphaDeadline=0,sending=false;
let bootstrapSession=null;
// Warm owner-alpha generation state: a separate strict path that never reuses
// legacy alpha-session/bootstrap fences. warmSession binds the first observed
// summary; identity, policy deadline, count, and generation identity are then
// immutable for this page. Terminal states are sticky in sessionStorage so a
// reload with a rolled-back clock cannot reopen a closed generation.
let warmSession=null,warmSeen=false,warmInvalid=false,warmPolicyExpired=false,warmGenerationExpired=false;
// Stage B background owner-alpha generation state: a separate strict path that
// never reuses warm/bootstrap/legacy alpha fences. The first observed summary
// binds policy identity and deadline; admissions_used can only grow; the
// generation identity transitions null -> first identity once and is then
// immutable. Terminal states are sticky in sessionStorage so a reload with a
// rolled-back clock cannot reopen a closed generation.
let backgroundSession=null,backgroundSeen=false,backgroundInvalid=false,backgroundPolicyExpired=false,backgroundGenerationExpired=false;
let backgroundRenderedReason=null;
const backgroundRoles=['background','status','independent'];
const reviewedBootstrapRevisions=new Set();
const bootstrapFields=['policy_revision','persona_id','expires_at','max_task_seconds'];
const validBootstrap=value=>value&&typeof value.policy_revision==='string'&&value.policy_revision&&typeof value.persona_id==='string'&&Number.isFinite(Date.parse(value.expires_at))&&Number.isInteger(value.max_task_seconds)&&value.max_task_seconds>=1&&value.max_task_seconds<=300&&typeof value.message_admission_available==='boolean';
const validWarmTimestamp=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ$/.test(value)&&Number.isFinite(Date.parse(value));
const validWarmGeneration=(value,policyExpiresAt)=>value===null||!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.session_id==='string'&&value.session_id&&validWarmTimestamp(value.expires_at)&&Date.parse(value.expires_at)<=Date.parse(policyExpiresAt)&&Number.isSafeInteger(value.epoch)&&value.epoch>=2;
const validWarmSummary=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&value.schema_version===1&&value.kind==='owner-alpha-warm-summary-v1'&&typeof value.policy_revision==='string'&&value.policy_revision&&typeof value.persona_id==='string'&&value.persona_id&&validWarmTimestamp(value.policy_expires_at)&&value.max_admissions===2&&Number.isSafeInteger(value.admissions_used)&&value.admissions_used>=0&&value.admissions_used<=2&&typeof value.message_admission_available==='boolean'&&validWarmGeneration(value.generation,value.policy_expires_at);
/** Strict Stage B background-generation gate shape. The ordinal role schedule
 * is fixed: next_role is 'background' before the first admission, then
 * 'status'/'independent' only while that admission is actually available, and
 * null while blocked, exhausted or expired. Impossible count/generation/role
 * combinations are malformed and fail closed. */
const validBackgroundSummary=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||value.schema_version!==1||value.kind!=='owner-alpha-background-summary-v1'||typeof value.policy_revision!=='string'||!value.policy_revision||typeof value.persona_id!=='string'||!value.persona_id||!validWarmTimestamp(value.policy_expires_at)||value.max_admissions!==3||!Number.isSafeInteger(value.admissions_used)||value.admissions_used<0||value.admissions_used>3||typeof value.message_admission_available!=='boolean'||!validWarmGeneration(value.generation,value.policy_expires_at))return false;
 return value.next_role===(value.message_admission_available?backgroundRoles[value.admissions_used]??null:null);
};
/** Strict warm-generation gate. Returns null only when warm mode is truly
 * absent (no summary.owner_alpha_warm property and never seen); a present
 * property with any value — including null, false, 0, '' or malformed — latches
 * warm mode and fails closed. Otherwise returns a blocking reason or '' when
 * an explicit Send is admissible. Passive calls only read and bind local
 * state; they never send or assign. First-observed generation and count
 * consistency are checked within this same invocation, never deferred to a
 * later render. */
function warmBlock(){
 const w=snapshot?.summary?.owner_alpha_warm;
 if(w===undefined&&!warmSeen)return null;
 warmSeen=true;alphaSeen=true;
 if(!validWarmSummary(w))warmInvalid=true;
 if(!warmInvalid){
  if(!warmSession){
   warmSession={policy_revision:w.policy_revision,persona_id:w.persona_id,policy_expires_at:w.policy_expires_at,
    policy_deadline:performance.now()+Math.max(0,Date.parse(w.policy_expires_at)-Date.now()),
    admissions_used:w.admissions_used,generation:null,generation_deadline:0};
   // A previously observed terminal state for this exact revision stays closed.
   if(sessionStorage.getItem('personal.warm-policy-expired.'+w.policy_revision))warmPolicyExpired=true;
   if(w.generation){
    warmSession.generation={session_id:w.generation.session_id,expires_at:w.generation.expires_at,epoch:w.generation.epoch};
    warmSession.generation_deadline=performance.now()+Math.max(0,Date.parse(w.generation.expires_at)-Date.now());
    if(sessionStorage.getItem('personal.warm-generation-expired.'+w.generation.session_id))warmGenerationExpired=true;
   }
  }else{
   if(['policy_revision','persona_id','policy_expires_at'].some(key=>w[key]!==warmSession[key]))warmInvalid=true;
   if(w.admissions_used<warmSession.admissions_used)warmInvalid=true;else warmSession.admissions_used=w.admissions_used;
   if(!warmSession.generation&&w.generation){
    // generation:null -> the first bound identity is the expected transition
    // when the first message starts the generation; it is not a new policy.
    warmSession.generation={session_id:w.generation.session_id,expires_at:w.generation.expires_at,epoch:w.generation.epoch};
    warmSession.generation_deadline=performance.now()+Math.max(0,Date.parse(w.generation.expires_at)-Date.now());
    if(sessionStorage.getItem('personal.warm-generation-expired.'+w.generation.session_id))warmGenerationExpired=true;
   }else if(warmSession.generation&&(!w.generation||w.generation.session_id!==warmSession.generation.session_id||w.generation.expires_at!==warmSession.generation.expires_at||w.generation.epoch!==warmSession.generation.epoch))warmInvalid=true;
  }
  if(w.admissions_used>=1&&!w.generation)warmInvalid=true;
  if(w.generation&&w.admissions_used<1)warmInvalid=true;
 }
 if(warmInvalid)return 'Warm generation details changed or are unavailable. Reload to review the current generation; sending is closed.';
 if(warmSession){
  // Both deadlines are immutable and monotonic locally: a wall-clock rollback
  // never reopens a deadline the local timer has already passed.
  if(Date.now()>=Date.parse(warmSession.policy_expires_at)||performance.now()>=warmSession.policy_deadline)warmPolicyExpired=true;
  if(warmSession.generation&&(Date.now()>=Date.parse(warmSession.generation.expires_at)||performance.now()>=warmSession.generation_deadline))warmGenerationExpired=true;
  if(warmPolicyExpired)sessionStorage.setItem('personal.warm-policy-expired.'+warmSession.policy_revision,'1');
  if(warmGenerationExpired&&warmSession.generation)sessionStorage.setItem('personal.warm-generation-expired.'+warmSession.generation.session_id,'1');
 }
 if(warmPolicyExpired)return 'Warm policy expired. New messages are closed.';
 if(warmGenerationExpired)return 'Warm generation expired. New messages are closed.';
 if(warmSession&&warmSession.admissions_used>=2)return 'Both warm messages have been used. This warm generation is closed.';
 if(warmSession&&(current()?.kind!=='persona'||selected!==warmSession.persona_id))return 'This warm generation accepts private messages only for its selected persona. Other bots and rooms are read-only.';
 if($('connection').textContent!=='Connected'||!navigator.onLine)return 'Warm generation status is offline. Reconnect before sending.';
 if(warmSession&&!snapshot.summary.owner_alpha_warm.message_admission_available)return 'No message admission is available in this warm revision. New messages are closed.';
 return '';
}
function warmBannerText(reason){
 if(!warmSession)return `Warm owner generation · Session details changed or are unavailable. Reload to review the current generation; sending is closed.`;
 const name=snapshot?.objects?.find(x=>x.id===warmSession.persona_id)?.body.name??warmSession.persona_id;
 const generation=warmSession.generation?` · Generation ${warmSession.generation.epoch} deadline ${new Date(warmSession.generation.expires_at).toLocaleString(undefined,{timeZoneName:'short'})}`:' · One fixed generation starts with your first Send';
 return `Warm owner generation · ${name} only · ${Math.max(0,2-warmSession.admissions_used)} of 2 messages remaining${generation} · Policy deadline ${new Date(warmSession.policy_expires_at).toLocaleString(undefined,{timeZoneName:'short'})}. ${reason||'Message admission available. The second message reuses this generation only after the first task completes canonically.'} This is not always-on chat or safe recovery. Portal visits, refreshes and history do not start the runtime. No renewal, rollover, successor generation or background work in this revision.`;
}
/** Strict Stage B background-generation gate. Returns null only when
 * background mode is truly absent (no summary.owner_alpha_background property
 * and never seen); a present property with any value — including null, false,
 * 0, '' or malformed — latches background mode and fails closed. Otherwise
 * returns a blocking reason or '' when an explicit Send is admissible. The
 * portal never classifies message text or picks a role itself: it discloses
 * the summary's next_role and message_admission_available exactly. Conflicting
 * generation summaries (background together with legacy, bootstrap or warm
 * custody) fail closed rather than selecting a permissive path. */
function backgroundBlock(){
 const b=snapshot?.summary?.owner_alpha_background;
 if(b===undefined&&!backgroundSeen)return null;
 backgroundSeen=true;alphaSeen=true;
 if(warmSeen||snapshot?.summary&&(snapshot.summary.owner_alpha||snapshot.summary.owner_alpha_session!==undefined||snapshot.summary.owner_alpha_warm!==undefined||snapshot.summary.owner_alpha_bootstrap!==undefined))backgroundInvalid=true;
 if(!validBackgroundSummary(b))backgroundInvalid=true;
 if(!backgroundInvalid){
  if(!backgroundSession){
   backgroundSession={policy_revision:b.policy_revision,persona_id:b.persona_id,policy_expires_at:b.policy_expires_at,
    policy_deadline:performance.now()+Math.max(0,Date.parse(b.policy_expires_at)-Date.now()),
    admissions_used:b.admissions_used,generation:null,generation_deadline:0};
   // A previously observed terminal state for this exact revision stays closed.
   if(sessionStorage.getItem('personal.background-policy-expired.'+b.policy_revision))backgroundPolicyExpired=true;
   if(b.generation){
    backgroundSession.generation={session_id:b.generation.session_id,expires_at:b.generation.expires_at,epoch:b.generation.epoch};
    backgroundSession.generation_deadline=performance.now()+Math.max(0,Date.parse(b.generation.expires_at)-Date.now());
    if(sessionStorage.getItem('personal.background-generation-expired.'+b.generation.session_id))backgroundGenerationExpired=true;
   }
  }else{
   if(['policy_revision','persona_id','policy_expires_at'].some(key=>b[key]!==backgroundSession[key]))backgroundInvalid=true;
   if(b.admissions_used<backgroundSession.admissions_used)backgroundInvalid=true;else backgroundSession.admissions_used=b.admissions_used;
   if(!backgroundSession.generation&&b.generation){
    // generation:null -> the first bound identity is the expected transition
    // when the first message creates the generation; it is not a new policy.
    backgroundSession.generation={session_id:b.generation.session_id,expires_at:b.generation.expires_at,epoch:b.generation.epoch};
    backgroundSession.generation_deadline=performance.now()+Math.max(0,Date.parse(b.generation.expires_at)-Date.now());
    if(sessionStorage.getItem('personal.background-generation-expired.'+b.generation.session_id))backgroundGenerationExpired=true;
   }else if(backgroundSession.generation&&(!b.generation||b.generation.session_id!==backgroundSession.generation.session_id||b.generation.expires_at!==backgroundSession.generation.expires_at||b.generation.epoch!==backgroundSession.generation.epoch))backgroundInvalid=true;
  }
  if(b.admissions_used>=1&&!b.generation)backgroundInvalid=true;
  if(b.generation&&b.admissions_used<1)backgroundInvalid=true;
 }
 if(backgroundInvalid)return 'Background generation details changed or are unavailable. Reload to review the current generation; sending is closed.';
 if(backgroundSession){
  // Both deadlines are immutable and monotonic locally: a wall-clock rollback
  // never reopens a deadline the local timer has already passed.
  if(Date.now()>=Date.parse(backgroundSession.policy_expires_at)||performance.now()>=backgroundSession.policy_deadline)backgroundPolicyExpired=true;
  if(backgroundSession.generation&&(Date.now()>=Date.parse(backgroundSession.generation.expires_at)||performance.now()>=backgroundSession.generation_deadline))backgroundGenerationExpired=true;
  if(backgroundPolicyExpired)sessionStorage.setItem('personal.background-policy-expired.'+backgroundSession.policy_revision,'1');
  if(backgroundGenerationExpired&&backgroundSession.generation)sessionStorage.setItem('personal.background-generation-expired.'+backgroundSession.generation.session_id,'1');
 }
 if(backgroundPolicyExpired)return 'Background policy expired. New messages are closed.';
 if(backgroundGenerationExpired)return 'Background generation expired. New messages are closed.';
 if(backgroundSession&&backgroundSession.admissions_used>=3)return 'All three background messages have been used. This background generation is closed.';
 if(backgroundSession&&(current()?.kind!=='persona'||selected!==backgroundSession.persona_id))return 'This background generation accepts private messages only for its selected persona. Other bots and rooms are read-only.';
 if($('connection').textContent!=='Connected'||!navigator.onLine)return 'Background generation status is offline. Reconnect before sending.';
 if(backgroundSession&&!snapshot.summary.owner_alpha_background.message_admission_available)return 'No message admission is available in this background revision. New messages are closed.';
 return '';
}
function backgroundBannerText(reason){
 if(!backgroundSession)return `Background owner generation · Session details changed or are unavailable. Reload to review the current generation; sending is closed.`;
 const name=snapshot?.objects?.find(x=>x.id===backgroundSession.persona_id)?.body.name??backgroundSession.persona_id;
 const generation=backgroundSession.generation?` · Generation ${backgroundSession.generation.epoch} deadline ${new Date(backgroundSession.generation.expires_at).toLocaleString(undefined,{timeZoneName:'short'})}`:' · One fixed generation starts with your first Send';
 const role=snapshot?.summary?.owner_alpha_background?.next_role;
 const nextRole=role==='background'?'background (starts the bounded background root)':role==='status'?'status (admitted only after the background root releases its coordinator lane)':role==='independent'?'independent (admitted only after the status answer settles)':'none (no message admission is currently available)';
 return `Background owner generation · ${name} only · ${Math.max(0,3-backgroundSession.admissions_used)} of 3 messages remaining · Next message role: ${nextRole}${generation} · Policy deadline ${new Date(backgroundSession.policy_expires_at).toLocaleString(undefined,{timeZoneName:'short'})}. ${reason||'Message admission available.'} The roles are fixed in order: background root first, status second, independent third. Status and independent replies do not prove the background root or its children completed or settled. This is not always-on chat or safe recovery. Portal visits, refreshes and history do not start the runtime. All three admissions are finite; no renewal, rollover, successor generation or always-on background work.`;
}
function alphaBlock(){
 const background=backgroundBlock();
 if(background!==null)return background;
 const warm=warmBlock();
 if(warm!==null)return warm;
 const bootstrap=snapshot?.summary.owner_alpha_bootstrap;
 if(bootstrap||bootstrapSession){
  alphaSeen=true;
  if(!snapshot?.summary.owner_alpha||!validBootstrap(bootstrap))alphaInvalid=true;
  if(!alphaInvalid){
   if(!bootstrapSession){bootstrapSession={...bootstrap,deadline:performance.now()+Math.max(0,Date.parse(bootstrap.expires_at)-Date.now()),expired:false};reviewedBootstrapRevisions.add(bootstrap.policy_revision);}
   if(bootstrapFields.some(key=>bootstrap[key]!==bootstrapSession[key]))alphaInvalid=true;
   if(Date.now()>=Date.parse(bootstrapSession.expires_at)||performance.now()>=bootstrapSession.deadline)bootstrapSession.expired=true;
  }
  if(alphaInvalid)return 'Session details changed or are unavailable. Review the current session before sending.';
  if(bootstrapSession.expired)return 'Trial expired. New messages are closed.';
  if(current()?.kind!=='persona'||selected!==bootstrapSession.persona_id)return 'This trial accepts private messages only for its selected persona. Other bots and rooms are read-only.';
  if($('connection').textContent!=='Connected'||!navigator.onLine)return 'Session status is offline. Reconnect before sending.';
  if(!bootstrap.message_admission_available)return 'A new bounded session is not available. No new runtime is started.';
  return '';
 }
 if(!alphaSeen&&!snapshot?.summary.owner_alpha)return '';
 const s=snapshot?.summary.owner_alpha_session;
 alphaSeen=true;
 if(!snapshot?.summary.owner_alpha||!s||typeof s.persona_id!=='string'||!Number.isFinite(Date.parse(s.expires_at))||!Number.isInteger(s.max_runs)||s.max_runs<1||!Number.isInteger(s.admitted_runs)||s.admitted_runs<0||s.admitted_runs>s.max_runs||!Number.isInteger(s.max_task_seconds)||s.max_task_seconds<1)alphaInvalid=true;
 if(!alphaInvalid){
  if(!alphaSession){alphaSession={...s};alphaDeadline=performance.now()+Math.max(0,Date.parse(s.expires_at)-Date.now());}
  if(['persona_id','expires_at','max_runs','max_task_seconds'].some(key=>s[key]!==alphaSession[key]))alphaInvalid=true;
  alphaSession.admitted_runs=Math.max(alphaSession.admitted_runs,s.admitted_runs);
  if(Date.now()>=Date.parse(alphaSession.expires_at)||performance.now()>=alphaDeadline)alphaExpired=true;
 }
 if(alphaInvalid)return 'Session details changed or are unavailable. Reload to review the session; sending is closed.';
 if(alphaExpired)return 'Session expired. New messages are closed.';
 if(alphaSession.admitted_runs>=alphaSession.max_runs)return 'All admissions used. New messages are closed.';
 if(current()?.kind!=='persona'||selected!==alphaSession.persona_id)return 'This session accepts private messages only for its selected persona. Other bots and rooms are read-only.';
 if($('connection').textContent!=='Connected'||!navigator.onLine)return 'Session status is offline. Reconnect before sending.';
 return '';
}
function renderAlphaSession(){
 // Busy while the current conversation has any unresolved outbox record
 // (queued/sending/unknown/accepted-not-yet-echoed); a rejected one is
 // removed immediately by outboxRestoreDraft, so its mere presence never
 // holds the composer.
 sending=Boolean(selected)&&outboxForConversation(selected).length>0;
 const reason=alphaBlock();
 if(backgroundSeen){
  if(backgroundRenderedReason&&$('error').textContent===backgroundRenderedReason&&reason!==backgroundRenderedReason)report(reason||'');
  backgroundRenderedReason=reason;
 }
 $('send').disabled=sending||Boolean(reason);
 $('message').readOnly=Boolean(reason);
 const review=$('review-alpha-session');
 // A latched warm or background generation never offers the legacy bootstrap
 // review/renewal flow, including a page previously bound to a bootstrap session.
 review.hidden=backgroundSeen||warmSeen||!(bootstrapSession||snapshot?.summary.owner_alpha_bootstrap);
 review.disabled=sending||loading||!navigator.onLine||$('connection').textContent!=='Connected';
 if(!alphaSeen)return;
 $('message').setAttribute('aria-describedby','runtime-banner');
 $('send').setAttribute('aria-describedby','runtime-banner');
 $('runtime-banner').hidden=false;
 if(backgroundSeen){
  const text=backgroundBannerText(reason);
  if($('runtime-banner-text').textContent!==text)$('runtime-banner-text').textContent=text;
  return;
 }
 if(warmSeen){
  const text=warmBannerText(reason);
  if($('runtime-banner-text').textContent!==text)$('runtime-banner-text').textContent=text;
  return;
 }
 const s=bootstrapSession??alphaSession,name=snapshot?.objects?.find(x=>x.id===s?.persona_id)?.body.name??s?.persona_id;
 const text=bootstrapSession?`Message-triggered owner alpha · ${name} only · Trial deadline ${new Date(s.expires_at).toLocaleString(undefined,{timeZoneName:'short'})} · Up to ${s.max_task_seconds}s per task. ${reason||'Send saves your message before requesting a bounded session on the existing Sprite.'} Portal visits and history do not start the runtime. Previous recovery tasks are not retried. External actions remain unavailable.`:`Supervised owner alpha${s?` · ${name} only · ${Math.max(0,s.max_runs-s.admitted_runs)} of ${s.max_runs} admissions remaining · Deadline ${new Date(s.expires_at).toLocaleString(undefined,{timeZoneName:'short'})} · Up to ${s.max_task_seconds}s per task`:''}. ${reason||'Private message admission available; queued messages have not yet consumed admissions.'} History, previews and cancellation remain available. Provisional output or a successful root turn is not a completed result or proof of safe recovery. Background delegation requires an explicitly opted-in session. External actions and automatic recovery are unavailable.`;
 if($('runtime-banner-text').textContent!==text)$('runtime-banner-text').textContent=text;
}
async function reviewAlphaSession(){
 const conversation=selected,version=selectionVersion;
 const assertReady=()=>{
  if(sending||loading||!navigator.onLine||$('connection').textContent!=='Connected'||selected!==conversation||selectionVersion!==version)throw new Error('Conversation or connection changed. Close and review the session again.');
  if(outboxForConversation(conversation).length)throw new Error('A message has an unconfirmed outcome. Session adoption is blocked; its saved text and retry key are unchanged.');
 };
 const check=value=>{
  const policy=value?.summary?.owner_alpha_bootstrap,persona=value?.objects?.find(x=>x.id===conversation);
  if(!value?.summary?.owner_alpha||!validBootstrap(policy)||policy.persona_id!==conversation||persona?.kind!=='persona'||persona.body.archived||!policy.message_admission_available||Date.parse(policy.expires_at)<=Date.now())throw new Error('No available, unexpired session for this selected persona. Nothing was adopted.');
  if(reviewedBootstrapRevisions.has(policy.policy_revision))throw new Error('This policy was already reviewed. Its deadline cannot be renewed; a new policy revision is required.');
  return {...policy};
 };
 assertReady();
 const proposed=check(await api('/v1/state'));assertReady();
 const deadline=performance.now()+Math.max(0,Date.parse(proposed.expires_at)-Date.now());
 const affirmation=node('label',undefined,'check'),checkBox=node('input');checkBox.type='checkbox';checkBox.name='confirm';checkBox.required=true;
 affirmation.append(checkBox,document.createTextNode('Use this exact session for my next explicit Send.'));
 openEditor('Review current session',[
  node('p',`Persona: ${current().body.name} · ${conversation}`,'hint'),
  node('p',`Policy: ${proposed.policy_revision}`,'review-notice'),
  node('p',`Fixed deadline: ${new Date(proposed.expires_at).toLocaleString(undefined,{timeZoneName:'short'})}. Up to ${proposed.max_task_seconds}s per task.`),
  node('p','This only updates this page. It sends no message, starts no runtime and does not extend the deadline. Drafts and earlier task outcomes stay unchanged.','hint'),affirmation
 ],async form=>{
  assertReady();if(form.get('confirm')!=='on')throw new Error('Confirm the exact session before adopting it.');
  const value=await api('/v1/state'),latest=check(value);assertReady();
  if(bootstrapFields.some(key=>latest[key]!==proposed[key])||performance.now()>=deadline)throw new Error('The reviewed session changed or expired. Close and review it again.');
  bootstrapSession={...latest,deadline:Math.min(deadline,performance.now()+Math.max(0,Date.parse(latest.expires_at)-Date.now())),expired:false};
  reviewedBootstrapRevisions.add(latest.policy_revision);snapshot=value;alphaInvalid=false;alphaSeen=true;render();
 },'Adopt session');
}
const names={IDLE_PERMITTED:'Idle — hibernation permitted',STOPPED:'Sleeping',START_REQUESTED:'Waking',BOOTING:'Starting',READY:'Awake',DRAINING:'Finishing up',STOP_COMMITTED:'Stopping',STOPPING:'Stopping',RECOVERY_REQUIRED:'Recovery needed'};
const statuses={queued:'Queued',claimed:'Starting',running:'Working',finishing:'Saving result',completed:'Completed',waiting:'Waiting',failed:'Failed',cancelling:'Cancelling',cancelled:'Cancelled',recovery_required:'Needs recovery',interrupted:'Interrupted'};
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const tokenCounters=[['inputTokens','Input tokens'],['cachedInputTokens','Cached input tokens'],['cacheWriteInputTokens','Cache-write input tokens'],['outputTokens','Output tokens'],['reasoningOutputTokens','Reasoning output tokens'],['totalTokens','Total tokens']];
function renderTokenUsage(container,run,source){
 const section=node('section',undefined,'skill-detail token-usage');section.setAttribute('aria-label','Token usage for current attempt');section.append(node('h4','Token usage'));
 const rows=Array.isArray(source?.token_usage_snapshots)?source.token_usage_snapshots.filter(row=>row?.run_id===run.id&&row?.attempt===run.current_attempt):[];
 const validCounters=value=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===tokenCounters.length&&tokenCounters.every(([key])=>Object.hasOwn(value,key)&&Number.isSafeInteger(value[key])&&value[key]>=0);
 const usage=rows.length===1?rows[0]:null;
 const valid=usage&&Number.isSafeInteger(usage.attempt)&&usage.attempt>0&&Number.isSafeInteger(usage.version)&&usage.version>0&&usage.usage&&typeof usage.usage==='object'&&!Array.isArray(usage.usage)&&Object.keys(usage.usage).length===3&&validCounters(usage.usage.total)&&validCounters(usage.usage.last)&&(usage.usage.modelContextWindow===null||Number.isSafeInteger(usage.usage.modelContextWindow)&&usage.usage.modelContextWindow>=0);
 if(!valid)section.append(node('p','Token usage unavailable for this attempt.','hint'));
 else{
  section.append(node('p',`Native context/session snapshot · attempt ${usage.attempt} · observation version ${usage.version}`,'hint'));
  for(const [heading,value] of [['Native cumulative snapshot',usage.usage.total],['Native last snapshot',usage.usage.last]]){section.append(node('p',heading,'status'));for(const [key,label] of tokenCounters)section.append(node('p',`${label}: ${value[key].toLocaleString()}`));}
  section.append(node('p',`Model context window: ${usage.usage.modelContextWindow===null?'unavailable':usage.usage.modelContextWindow.toLocaleString()}`));
 }
 section.append(node('p','Persisted observation. Counts may be partial or stale; they are not live and are not additive across tasks or children, or proof of billing or settlement.','hint'));container.append(section);
}
function report(message){$('error').textContent=message;$('error').hidden=!message;}
function time(iso){return new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
async function api(path,options={}){const response=await fetch(path,options);let value;try{value=await response.json();}catch{throw new Error('The portal returned an unexpected response.');}if(!response.ok)throw new Error(value.error?.message??'The request failed.');return value;}
async function command(type,payload,key=crypto.randomUUID()){
 const result=await api('/v1/commands',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({schema_version:1,type,payload})});
 if(result.status==='rejected')throw new Error(result.error?.message??'This change could not be saved.');return result;
}
// --- V5 durable client outbox (ARCHITECTURE_V2 A5) --------------------------
// A send is persisted to storage BEFORE its POST, so a reload or a lost
// response reconciles through GET /v1/receipts?idempotency_key= instead of
// silently duplicating or losing an owner message. nonce === Idempotency-Key.
// Phases: queued -> sending -> accepted -> (deleted once echoed). Failure
// states: rejected (bubble removed, text restored to that conversation's
// draft) and unknown (kept, retried under the same key with backoff).
const outboxRecords=new Map(); // nonce -> record; mirrors durable storage
// Read-only test hook: exposes only the fields fixtures need to assert on
// (never the full record, and never a mutator), so browser fixtures can wait
// on and inspect outbox state instead of the old single localStorage key.
window.__hehebotOutbox=()=>[...outboxRecords.values()].map(r=>({nonce:r.nonce,conversation_id:r.conversation_id,text:r.text,phase:r.phase}));
const outboxSending=new Set(); // conversation_id currently draining
let outboxDb=null,outboxDbAttempted=false;
function outboxOpenDb(){
 if(outboxDbAttempted)return Promise.resolve(outboxDb);
 outboxDbAttempted=true;
 return new Promise(resolve=>{
  try{
   if(!('indexedDB' in window)){resolve(null);return;}
   const request=indexedDB.open('hehebot-outbox',1);
   request.onupgradeneeded=()=>{try{request.result.createObjectStore('records',{keyPath:'nonce'});}catch{}};
   request.onsuccess=()=>{outboxDb=request.result;resolve(outboxDb);};
   request.onerror=()=>resolve(null);
  }catch{resolve(null);}
 });
}
async function outboxLoadAll(){
 try{
  const db=await outboxOpenDb();
  if(db)return await new Promise((resolve,reject)=>{
   try{const request=db.transaction('records','readonly').objectStore('records').getAll();request.onsuccess=()=>resolve(request.result??[]);request.onerror=()=>reject(request.error);}
   catch(e){reject(e);}
  });
 }catch{}
 try{const raw=localStorage.getItem('personal.outbox');return raw?JSON.parse(raw):[];}catch{return [];}
}
function outboxSaveLocalStorageMirror(){
 try{localStorage.setItem('personal.outbox',JSON.stringify([...outboxRecords.values()]));}catch{}
}
async function outboxPersist(record){
 try{
  const db=await outboxOpenDb();
  if(db){await new Promise((resolve,reject)=>{try{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}catch(e){reject(e);}});return;}
 }catch{}
 outboxSaveLocalStorageMirror();
}
async function outboxForget(nonce){
 try{
  const db=await outboxOpenDb();
  if(db){await new Promise((resolve,reject)=>{try{const tx=db.transaction('records','readwrite');tx.objectStore('records').delete(nonce);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);}catch(e){reject(e);}});return;}
 }catch{}
 outboxSaveLocalStorageMirror();
}
function outboxForConversation(id){return [...outboxRecords.values()].filter(r=>r.conversation_id===id).sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.nonce.localeCompare(b.nonce));}
// The stream can deliver the committed echo before the send's POST resolves;
// a later 'accepted' must not resurrect a record already echoed.
const outboxEchoed=new Set();
async function outboxSetPhase(record,phase,extra={}){
 if(outboxEchoed.has(record.nonce))return;
 Object.assign(record,extra,{phase});
 if(phase==='echoed'){outboxEchoed.add(record.nonce);outboxRecords.delete(record.nonce);await outboxForget(record.nonce);return;}
 outboxRecords.set(record.nonce,record);await outboxPersist(record);
}
async function outboxEnqueue(conversationId,text){
 const record={nonce:crypto.randomUUID(),conversation_id:conversationId,text,phase:'queued',created_at:new Date().toISOString(),tries:0};
 outboxRecords.set(record.nonce,record);await outboxPersist(record);render();outboxDrain(conversationId);return record;
}
function outboxBackoffMs(tries){return Math.min(30000,1000*2**Math.max(0,tries-1));}
function outboxRestoreDraft(record,message){
 outboxRecords.delete(record.nonce);outboxForget(record.nonce);
 try{if(!localStorage.getItem('personal.draft.'+record.conversation_id))localStorage.setItem('personal.draft.'+record.conversation_id,record.text);}catch{}
 if(selected===record.conversation_id&&!$('message').value.trim()){$('message').value=record.text;$('draft-status').textContent='Not sent — restored to your draft';}
 report(message);
}
// Per-conversation FIFO: record N+1 never sends before N reaches 'accepted'
// (the server has durably committed it) or is removed (rejected/echoed).
async function outboxDrain(conversationId){
 if(outboxSending.has(conversationId))return;outboxSending.add(conversationId);
 try{
  for(;;){
   const queue=outboxForConversation(conversationId);
   const head=queue.find(r=>r.phase!=='accepted');
   if(!head)break;
   if(queue.some(r=>r!==head&&r.phase!=='accepted'&&(r.created_at<head.created_at||(r.created_at===head.created_at&&r.nonce<head.nonce))))break;
   await outboxSetPhase(head,'sending');render();
   try{
    const response=await fetch('/v1/commands',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':head.nonce},body:JSON.stringify({schema_version:1,type:'message.send',payload:{conversation_id:head.conversation_id,text:head.text}})});
    let body=null;try{body=await response.json();}catch{}
    // Fetch the committed echo promptly instead of waiting on the 15s
    // fallback poll or a live /v1/stream push that may not exist yet.
    if(response.ok&&body?.status!=='rejected'){await outboxSetPhase(head,'accepted');render();refresh();continue;}
    if(response.status>=400&&response.status<500){outboxRestoreDraft(head,body?.error?.message??'This message could not be saved.');render();continue;}
    head.tries++;await outboxSetPhase(head,'unknown');render();
    await new Promise(resolve=>setTimeout(resolve,outboxBackoffMs(head.tries)));
   }catch{
    head.tries++;await outboxSetPhase(head,'unknown');render();
    await new Promise(resolve=>setTimeout(resolve,outboxBackoffMs(head.tries)));
   }
  }
 }finally{outboxSending.delete(conversationId);}
}
// Recognize this page's own committed sends as they arrive back on the
// timeline (the message.user echo carries the same Idempotency-Key), and
// retire the optimistic bubble in favor of the committed event.
function reconcileOutboxEchoes(conversationId,list){
 for(const event of list){
  if(event.type!=='message.user')continue;
  const key=event.payload?.idempotency_key;if(typeof key!=='string')continue;
  const record=outboxRecords.get(key);
  if(record&&record.conversation_id===conversationId)outboxSetPhase(record,'echoed').then(render);
 }
}
// On load, storage may hold records from a session that never learned its
// outcome (network killed mid-send, tab closed). Ask the server directly:
// found -> accepted (wait for the echo, never resend); not_found -> resend
// under the same key. Any other failure (offline) leaves it to outboxDrain.
async function outboxReconcileOnLoad(){
 let records=[];try{records=await outboxLoadAll();}catch{}
 for(const record of records)if(record&&typeof record.nonce==='string'&&typeof record.conversation_id==='string')outboxRecords.set(record.nonce,record);
 let foundAccepted=false;
 for(const record of outboxRecords.values()){
  try{
   const response=await fetch('/v1/receipts?idempotency_key='+encodeURIComponent(record.nonce));
   if(response.status===200){await outboxSetPhase(record,'accepted');foundAccepted=true;}
   else if(response.status===404){record.tries=0;await outboxSetPhase(record,'queued');}
  }catch{/* offline: leave the persisted phase; outboxDrain retries once a drain runs. */}
 }
 render();
 // A record found already-accepted here needs its committed event fetched
 // promptly: without a live /v1/stream push, the only other trigger is the
 // 15s fallback poll, which would leave an accepted-but-unechoed bubble on
 // screen far longer than a reload should. Only fires when reconciliation
 // actually found something, so a page with no outbox history never issues
 // an extra read. Bug found while making V-A5 pass (ARCHITECTURE_V2 A5).
 if(foundAccepted)refresh(true);
 for(const conversationId of new Set([...outboxRecords.values()].map(r=>r.conversation_id)))outboxDrain(conversationId);
}
function items(kind){return snapshot?.objects?.filter(x=>x.kind===kind)??[];}
function current(){return snapshot?.objects?.find(x=>x.id===selected);}
function skillsSelected(){return selected==='skills';}
function managedSelected(){return skillsSelected()||selected==='connectors';}
function connectorsAllowed(){return !alphaSeen&&!snapshot?.summary.owner_alpha;}
function connectorOnline(){return navigator.onLine&&$('connection').textContent==='Connected';}
function validateConnectorCatalog(value){
 const w=value?.catalog?.whatsapp;
 if(value?.scope!=='bundled-diagnostic-baseline'||value.runtime_inventory!=='unobserved'||value.authority!=='not-granted'||value.catalog.schemaVersion!==1||!w||!['package','version','revision','source','evidenceScope'].every(k=>typeof w[k]==='string')||!Array.isArray(w.prerequisites)||!w.prerequisites.every(x=>typeof x==='string')||w.protocol?.whatsapp_get_chat_messages!=='incompatible'||w.protocol?.whatsapp_search_messages!=='synthetic-verified'||typeof w.protocol?.recentReadBlocker!=='string')throw Error('Unexpected connector catalog response. No baseline is shown.');
 return w;
}
async function loadConnectorCatalog(){
 if(selected!=='connectors'||!connectorsAllowed()||!connectorOnline()||connectorView?.loading)return;
 const view={loading:true,page:null,error:''};connectorView=view;render();
 try{const page=validateConnectorCatalog(await api('/v1/connectors/catalog'));if(connectorView===view&&selected==='connectors'&&connectorsAllowed()&&connectorOnline()){view.page=page;view.loading=false;render();}}
 catch(e){if(connectorView===view&&selected==='connectors'&&connectorsAllowed()){view.loading=false;view.error=e.message;render();}}
}
function renderConnectors(){
 document.querySelector('.app').classList.add('skills-mode');$('conversation-type').textContent='OWNER DIAGNOSTICS';$('conversation-name').textContent='Connectors';
 for(const id of ['edit-bot','show-details','composer','details','runtime-banner'])$(id).hidden=true;
 $('details').classList.remove('open');
 const signature=JSON.stringify(['connectors',connectorView,connectorOnline(),connectorsAllowed()]);if(lastSignature===signature)return;lastSignature=signature;
 const timeline=$('timeline');timeline.replaceChildren();timeline.scrollTo({top:0,behavior:'instant'});
 const intro=node('div',undefined,'skills-intro');intro.append(node('h2','Bundled connector baseline'),node('p','Runtime inventory is unobserved. Authority is not granted. This diagnostic does not probe, wake, install, pair or enable anything.','muted'));
 const refresh=button('Refresh catalog',loadConnectorCatalog,'quiet');refresh.disabled=!connectorOnline()||!connectorsAllowed()||Boolean(connectorView?.loading);intro.append(refresh);timeline.append(intro);
 const notice=node('p',!connectorsAllowed()?'Connector diagnostics are unavailable in owner-alpha.':!connectorOnline()?'Catalog unavailable offline. Reconnect, then Refresh catalog.':connectorView?.loading?'Loading bundled baseline…':connectorView?.error||(!connectorView?.page?'Select Refresh catalog to read the bundled baseline.':''),'skill-card');notice.setAttribute('role',connectorView?.error?'alert':'status');if(notice.textContent)timeline.append(notice);
 const w=connectorView?.page;if(!w||!connectorOnline()||!connectorsAllowed())return;
 const card=node('section',undefined,'skill-card');card.append(node('h3','WhatsApp'),node('p',`Pinned package: ${w.package} · Version: ${w.version}`),node('p',`Revision: ${w.revision}`),node('p',`Source: ${w.source}`),node('p',w.evidenceScope,'review-notice'),node('p','Verified artifacts in disposable tests do not establish an installed, paired or callable runtime. No current runtime freshness is established.'));
 for(const [name,tool] of [['Recent messages','whatsapp_get_chat_messages'],['Scoped search','whatsapp_search_messages']]){const row=node('div',undefined,'skill-detail');row.append(node('h4',`${name} — ${w.protocol[tool]}`),node('p',tool));card.append(row);}
 card.append(node('p',w.protocol.recentReadBlocker,'review-notice'),node('h4','Prerequisites'));const list=node('ul');for(const text of w.prerequisites)list.append(node('li',text));card.append(list);timeline.append(card);
 timeline.scrollTo({top:0,behavior:'instant'});
}
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
// Warm and background modes scope reads to the validated bound identity only;
// pre-binding invalid state closes all conversation reads. Legacy fallback
// personas are never authorized while a warm or background summary has been
// observed on this page.
function alphaConversationAvailable(id){
 if(backgroundSeen)return Boolean(backgroundSession)&&id===backgroundSession.persona_id;
 if(warmSeen)return Boolean(warmSession)&&id===warmSession.persona_id;
 return !(alphaSeen||snapshot?.summary.owner_alpha)||id===(snapshot?.summary.owner_alpha_bootstrap?.persona_id??snapshot?.summary.owner_alpha_session?.persona_id);
}
async function refresh(force=false){
 if(loading||document.hidden&&!force)return;loading=true;
 try{const value=await api('/v1/state');snapshot=value;
  // Seed the stream cursor from the snapshot so events committed between this
  // read and the next subscribe are replayed, not skipped (ARCHITECTURE_V2 A6).
  if(wsCursor===null&&/^\d+$/.test(String(value.next_cursor)))wsCursor=Number(value.next_cursor);
  // Bind background/warm/alpha fences before any conversation reads so
  // unrelated personas and rooms stay read-only without issuing denied
  // requests. Presence of the owner_alpha_background or owner_alpha_warm
  // property (even null/false/0/'') latches that mode; only a truly absent
  // property leaves legacy/default behavior.
  if(value.summary.owner_alpha||'owner_alpha_warm' in value.summary||'owner_alpha_background' in value.summary)alphaBlock();
  if(!selected||!managedSelected()&&!value.objects.some(x=>x.id===selected))selected=items('persona').find(x=>!x.body.archived)?.id;
  const conversationId=selected,readable=!managedSelected()&&alphaConversationAvailable(conversationId);if(readable){const history=await api('/v1/conversations/'+conversationId+'/events');if(selected===conversationId&&acceptHistory(conversationId,history)){const combined=[...(olderEvents.get(conversationId)??[]),...history.events];events=[...new Map(combined.map(x=>[x.sequence,x])).values()].sort((a,b)=>a.sequence-b.sequence);reconcileOutboxEchoes(conversationId,history.events);}}
  if(readable){
   try{const page=await api('/v1/conversations/'+conversationId+'/tasks');if(!page.counts||!Array.isArray(page.runs))throw new Error('Invalid task page');if(selected===conversationId)taskFeed={conversationId,page,error:false};}
   catch{if(selected===conversationId)taskFeed={conversationId,page:taskFeed?.conversationId===conversationId?taskFeed.page:null,error:true};}
  }
  const view=recoveryView;if(view&&alphaConversationAvailable(view.conversationId)){const request=++view.request,page=await api(recoveryUrl(view));if(recoveryView===view&&selected===view.conversationId&&view.request===request)view.page=page;}
  $('connection').textContent='Connected';$('connection-dot').classList.add('online');render();
 }catch(e){$('connection').textContent='Offline';$('connection-dot').classList.remove('online');report(e.message);if(taskFeed)taskFeed.error=true;if(recoveryView?.kind==='tasks')recoveryView.page=null;render();}
 finally{loading=false;}
}
function choose(id){if(id==='connectors'&&!connectorsAllowed())return;selectionVersion++;connectorView=null;skillHistories.clear();routineHistory=null;routinePreflight=null;recoveryView=null;taskFeed=null;selected=id;localStorage.setItem('personal.selected',id);$('message').value=localStorage.getItem('personal.draft.'+id)??'';lastSignature='';render();refresh(true);if(id==='connectors')loadConnectorCatalog();if(!managedSelected())$('message').focus();}
function recoveryUrl(view){return '/v1/conversations/'+view.conversationId+'/'+(view.kind==='tasks'?'tasks':'recovery')+(view.cursor?'?after='+encodeURIComponent(view.cursor):'');}
async function loadRecovery(cursor=null,previous=[],kind='recovery',focusRun=null){
 if(!alphaConversationAvailable(selected)){report('History and task pages are unavailable for this conversation in the owner-alpha session.');return;}
 selectionVersion++;
 const view={conversationId:selected,cursor,previous,kind,focusRun,page:null,request:1};recoveryView=view;report('');render();
 try{const page=await api(recoveryUrl(view));if(recoveryView===view&&selected===view.conversationId&&view.request===1){view.page=page;render();}}
 catch(e){if(recoveryView===view&&view.request===1){recoveryView=null;report(e.message);render();}}
}
function render(){
 if(!snapshot)return;
 if(snapshot.summary.owner_alpha||'owner_alpha_warm' in snapshot.summary||'owner_alpha_background' in snapshot.summary)alphaBlock();
 $('show-connectors').hidden=!connectorsAllowed();$('show-connectors').setAttribute('aria-current',String(selected==='connectors'));
 if(!connectorsAllowed()||!connectorOnline())connectorView=null;
 if(routinePreflight&&!routinePreflightCurrent(routinePreflight))routinePreflight=null;
 if(routinePreflight&&($('connection').textContent!=='Connected'||!navigator.onLine))invalidateRoutinePreflight();
 if(routineHistory&&!routineHistoryCurrent(routineHistory))routineHistory=null;
 if(routineHistory&&($('connection').textContent!=='Connected'||!navigator.onLine)){routineHistory.page=null;routineHistory.loading=false;routineHistory.error='History unavailable offline. Reopen history after reconnecting.';routineHistory.invalid=true;}
 const searchSelection=JSON.stringify([selected,selectionVersion,recoveryView?.kind]);
 if(conversationSearchSelection!==searchSelection){$('conversation-search').value='';conversationSearchSelection=searchSelection;}
 $('conversation-search-panel').hidden=managedSelected()||Boolean(recoveryView);
 renderBudget();renderMetering();renderMonitoring();renderBackupStatus();renderTaskStrip();renderRoster();
 for(const [kind,target] of [['room','rooms']]){
  $(target).replaceChildren();
  for(const object of items(kind).filter(x=>!x.body.archived)){
   const b=button('',()=>choose(object.id),'nav-item');b.setAttribute('aria-current',String(object.id===selected));b.append(node('span',object.body.name.slice(0,1),'avatar'),node('span',object.body.name));$(target).append(b);
  }
 }
 $('show-skills').setAttribute('aria-current',String(skillsSelected()));
 if(selected==='connectors'){renderConnectors();return;}
 if(skillsSelected()){renderSkills();return;}
 document.querySelector('.app').classList.remove('skills-mode');$('details').hidden=false;$('composer').hidden=false;$('show-details').hidden=false;$('edit-bot').hidden=false;
 const object=current();$('conversation-name').textContent=object?.body.name??'Choose a bot';$('conversation-type').textContent=object?.kind==='room'?'SHARED ROOM':'ASSISTANT';$('edit-bot').hidden=object?.kind!=='persona';
 $('runtime-state').textContent=names[snapshot.summary.phase]??snapshot.summary.phase;$('runtime-provider').textContent=snapshot.provider?.id??'Unconfigured';$('runtime-queued').textContent=snapshot.summary.queued_runs;$('runtime-waiting').textContent=snapshot.summary.blocked_runs;
 $('runtime-banner').hidden=snapshot.summary.execution_enabled;
 if(!alphaSeen&&!snapshot.summary.owner_alpha)$('runtime-banner-text').textContent='Your messages and routines are saved. The assistant is waiting for its runtime connection and sign-in before it can work.';
 renderAlphaSession();
 const view=recoveryView?.conversationId===selected?recoveryView:null;
 const conversation=view?[]:events.filter(x=>x.conversation_id===selected);const runs=view?(view.page?.runs??[]):snapshot.runs.filter(x=>x.persona_id===selected||conversation.some(e=>e.payload?.run_id===x.id));
 const query=$('conversation-search').value.slice(0,200).trim().toLowerCase();
 const pendingOutbox=managedSelected()||view?[]:outboxForConversation(selected);
 const messages=conversation.filter(event=>event.type==='message.user'||event.type==='bot.message');
 const matches=new Set(messages.filter(event=>!query||(event.payload.text??'').toLowerCase().includes(query)));
 $('conversation-search-status').textContent=`${matches.size} of ${messages.length} loaded messages shown.${query&&!matches.size?' No loaded messages match.':''}`;
 $('conversation-search-panel').querySelector('summary').textContent=`Search loaded messages${query?` · Filter active (${matches.size}/${messages.length})`:''}`;
 $('clear-conversation-search').disabled=!$('conversation-search').value;
 const steering=(view?.kind==='tasks'?view.page?.steering??[]:snapshot.steering??[]).filter(x=>runs.some(run=>run.id===x.run_id));
 const recovery=(view?(view.page?.recovery??[]):snapshot.recovery??[]).filter(x=>runs.some(run=>run.id===x.run_id));
 const previews=(view?.kind==='tasks'?view.page?.output_previews??[]:snapshot.output_previews??[]).filter(x=>runs.some(run=>run.id===x.run_id&&run.current_attempt===x.attempt&&(snapshot.summary.owner_alpha?['running','finishing','cancelling','recovery_required']:['running','finishing','recovery_required']).includes(run.status)&&!['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code)));
 const questions=(snapshot.questions??[]).filter(q=>q.conversation_id===selected||q.persona_id===selected);
 const signature=JSON.stringify([selected,query,conversation,runs,steering,recovery,previews,questions,pendingOutbox,$('connection').textContent,navigator.onLine,alphaSeen,snapshot.summary.owner_alpha,Boolean(view),view?.kind,view?.focusRun,view?.cursor,view?.previous,view?.page,snapshot.token_usage_snapshots,snapshot.summary.execution_enabled,historyFloors.get(selected)]);
 if(signature!==lastSignature){lastSignature=signature;const timeline=$('timeline');const nearBottom=timeline.scrollHeight-timeline.scrollTop-timeline.clientHeight<100;const expanded=new Set([...timeline.querySelectorAll('.task-card[open]')].map(card=>card.dataset.runId));timeline.replaceChildren();
  if(view){
   const taskMode=view.kind==='tasks',label=taskMode?'task':'recovery';
   timeline.append(node('h2',taskMode?'Current tasks':'Recovery tasks'),node('p',`All retained ${taskMode?'unfinished':'recovery'} tasks in this conversation, paged by stable task ID. Restart from the first page to include newly arrived tasks. Reviewing does not retry or release anything.`,'hint'));
   const controls=node('div',undefined,'actions');controls.append(button('Back to messages',()=>{recoveryView=null;render();},'quiet'),button(`First ${label} page`,()=>loadRecovery(null,[],view.kind),'quiet'));
   if(view.previous.length)controls.append(button(`Previous ${label} page`,()=>loadRecovery(view.previous.at(-1),view.previous.slice(0,-1),view.kind),'quiet'));
   if(view.page?.next_cursor)controls.append(button(`Next ${label} page`,()=>loadRecovery(view.page.next_cursor,[...view.previous,view.cursor],view.kind),'quiet'));
   timeline.append(controls);if(!runs.length){const notice=node('p',view.page?`No ${taskMode?'unfinished':'recovery'} tasks on this page.`:`Loading ${taskMode?'current':'recovery'} tasks…`,'hint');notice.setAttribute('role','status');timeline.append(notice);}
  }else if(alphaConversationAvailable(selected))timeline.append(button('Review recovery tasks',()=>loadRecovery(),'quiet'));
  else timeline.append(node('p','History and task pages are unavailable for this conversation in the owner-alpha session. Select the authorized persona to review its history and tasks.','hint'));
  if(!view&&historyFloors.get(selected)){const notice=node('p','Earlier history has expired under the retention policy. Only retained messages and updates are shown.','hint');notice.setAttribute('role','status');timeline.append(notice);}
  if(conversation.length>=100&&alphaConversationAvailable(selected)){const conversationId=selected;timeline.append(button('Load earlier messages',async()=>{try{
   const history=await api('/v1/conversations/'+conversationId+'/events?before='+conversation[0].sequence);
   if(!acceptHistory(conversationId,history))return;
   const combined=[...history.events,...(olderEvents.get(conversationId)??conversation)];
   olderEvents.set(conversationId,[...new Map(combined.map(event=>[event.sequence,event])).values()].sort((a,b)=>a.sequence-b.sequence).slice(-1000));
   if(selected!==conversationId)return;
   events=olderEvents.get(conversationId);lastSignature='';render();
  }catch(e){if(selected===conversationId)report(e.message);}},'quiet'));}
  if(!view&&!conversation.length&&!questions.length&&!pendingOutbox.length&&alphaConversationAvailable(selected)){const empty=node('div',undefined,'empty');empty.append(node('h2',`A place to work with ${object?.body.name??'your assistant'}`),node('p','Ask for help, share an update, or describe something you’d like done on a schedule.'));timeline.append(empty);}
  for(const question of questions)renderQuestion(timeline,question);
  // V7 clean thread (ARCHITECTURE_V2 A7): only owner.message (message.user) and
  // bot.message are chat bubbles. A run.result stays a non-bubble recorded
  // outcome once a bot.message exists for its run (V1 emits one final_text
  // bot.message per completed attempt); a completed run with retained text
  // and no such event is legacy data, shown once as a bubble marked (legacy).
  const botMessageRunIds=new Set(conversation.filter(e=>e.type==='bot.message').map(e=>e.payload?.run_id));
  for(const event of conversation){
   if(event.type==='message.user'||event.type==='bot.message'){
    if(!matches.has(event))continue;
    const m=node('article',undefined,'message '+(event.type==='message.user'?'user':'bot'));const h=node('div',undefined,'message-head');h.append(node('strong',event.type==='message.user'?'You':object?.body.name??'Assistant'),node('time',time(event.created_at)));m.append(h);
    if(event.type==='bot.message'&&event.payload.task_run_id){
     const task=runs.find(x=>x.id===event.payload.task_run_id);
     h.append(node('span',`task: ${task?.title??String(event.payload.task_run_id).slice(0,8)}`,'status'));
    }
    if(event.type==='message.user'&&event.payload.skill_invocation){
     const invocation=event.payload.skill_invocation;
     m.append(node('p',`Run once · ${invocation.skill_name??invocation.skill_id} · captured revision ${invocation.skill_revision}`,'hint result-outcome'));
    }
    m.append(node('div',event.payload.text??'','message-body'));timeline.append(m);
   }else if(event.type==='run.result'){
    // Recorded outcomes are notices, not search-filtered bubbles: always shown.
    const outcome=['completed','failed','cancelled','waiting'].includes(event.payload.status)?statuses[event.payload.status]:'Unavailable';
    const e=node('div',undefined,'event');
    const label=node('span',`Recorded outcome: ${outcome}${event.payload.error_code?` · ${event.payload.error_code}`:''}`,'result-outcome');
    label.style.overflowWrap='anywhere';
    if(event.payload.title)label.append(node('span',` · ${event.payload.title}`));
    else if(event.payload.role==='background')label.append(node('span',' · Background task'));
    e.append(label);
    timeline.append(e);
    // Legacy fallback only: a completed result with retained text but no
    // bot.message for this run predates V1 and would otherwise be silent.
    const legacyText=event.payload.status==='completed'&&event.payload.text&&!botMessageRunIds.has(event.payload.run_id)?event.payload.text:null;
    if(legacyText&&(!query||legacyText.toLowerCase().includes(query))){
     const m=node('article',undefined,'message bot');const h=node('div',undefined,'message-head');h.append(node('strong',object?.body.name??'Assistant'),node('time',time(event.created_at)),node('span','(legacy)','status'));
     m.append(h,node('div',legacyText,'message-body'));timeline.append(m);
    }
   }else if(event.type==='notice'&&['degraded','runtime'].includes(event.payload.kind)&&typeof event.payload.message==='string'){
    // Owner-visible degraded operation (e.g. memory without a token budget,
    // runtime failing to start): always shown, never search-filtered.
    const e=node('div',undefined,'event');e.setAttribute('role','status');
    e.append(node('span',event.payload.kind==='runtime'?'Runtime':'Degraded','status'),node('span',event.payload.message));
    timeline.append(e);
   }else if(event.type==='notice'&&event.payload.kind==='needs_you'){
    // V2: a needs_you notice is owner-visible uncertainty, not a search-filtered
    // bubble -- it must always render, even when a text query is active.
    const run=runs.find(x=>x.id===event.payload.run_id);
    const e=node('div',undefined,'event');e.setAttribute('role','status');
    e.append(node('span','Needs you','status'),node('span',`Interrupted (${event.payload.reason}). Reconcile, retry or abandon this attempt.`));
    for(const effectId of event.payload.effect_ids??[])e.append(button('Reconcile',()=>act(()=>command('effect.reconcile',{run_id:event.payload.run_id,effect_id:effectId,expected_attempt:run?.current_attempt,outcome:'confirmed'}))));
    if(run&&snapshot.summary.execution_enabled)e.append(button('Retry',()=>act(()=>command('run.retry',{run_id:run.id,expected_attempt:run.current_attempt}))));
    if(run)e.append(button('Abandon',()=>cancelTask(run,'Owner abandoned the interrupted attempt.')));
    timeline.append(e);
   }else if(['run.accepted','run.cancellation_requested'].includes(event.type)){
    const run=runs.find(x=>x.id===event.payload.run_id);if(!run)continue;const e=node('div',undefined,'event');e.append(node('span',statuses[run.status]??run.status,'status'));
    if(run.status==='waiting')e.append(node('span',run.error_code==='CAPABILITY_UNAVAILABLE'?'Runtime connection required':run.error_code??'Input required'));
    if(['queued','claimed','running','waiting'].includes(run.status))e.append(button('Cancel',()=>cancelTask(run,'Owner requested cancellation.')));
    if(['failed','cancelled','recovery_required','interrupted','waiting'].includes(run.status)&&snapshot.summary.execution_enabled)e.append(button('Retry',()=>act(()=>command('run.retry',{run_id:run.id,expected_attempt:run.current_attempt}))));timeline.append(e);
   }else if(event.type==='effect.owner_reconciled'||event.type==='run.owner_recovered'){
    const e=node('div',undefined,'event');e.setAttribute('role','status');
    e.append(node('span',event.type==='effect.owner_reconciled'?`Owner recorded effect outcome: ${event.payload.outcome}. This is not provider-verified evidence.`:`Recovery closed as ${event.payload.status}. This did not retry the native task.`));timeline.append(e);
   }else if(event.type==='task.followup_expired'){
    const e=node('div',undefined,'event');e.setAttribute('role','status');e.append(node('span','Follow-up expired','status'),node('span','A deferred follow-up expired after 90 days without delivery. Send a fresh follow-up on the task if it is still needed.'));timeline.append(e);
   }else if(event.type==='run.input_expired'){
    const e=node('div',undefined,'event');e.setAttribute('role','status');const skillRun=Boolean(event.payload?.skill_id||event.payload?.skill_invocation);e.append(node('span','Request expired','status'),node('span',skillRun?'An unstarted Run once request expired after 30 days. Open the current approved skill and supply fresh input.':'A queued request expired after 90 days without starting. Send a fresh request if it is still needed.'));timeline.append(e);
   }else if(event.type.startsWith('room.')){const e=node('div',undefined,'event');e.append(node('span',event.type==='room.context_update'?'Context update':'Room update'),node('span',event.payload.text??''));timeline.append(e);}
  }
  // V5 outbox (ARCHITECTURE_V2 A5): unresolved sends render as owner bubbles,
  // optimistic until echoed, never search-filtered since they aren't committed.
  const outboxLabels={queued:'Queued to send…',sending:'Sending…',accepted:'Sent — waiting for confirmation…',unknown:'Not delivered yet — retrying…'};
  for(const record of pendingOutbox){
   const m=node('article',undefined,'message user outbox-pending outbox-'+record.phase);
   const h=node('div',undefined,'message-head');h.append(node('strong','You'),node('time',time(record.created_at)));m.append(h);
   m.append(node('div',record.text,'message-body'));
   const status=node('p',outboxLabels[record.phase]??'','hint outbox-status');status.setAttribute('role','status');m.append(status);
   timeline.append(m);
  }
  for(const run of runs.filter(x=>view?.kind==='tasks'||x.role==='background'||['running','finishing','recovery_required'].includes(x.status)||previews.some(preview=>preview.run_id===x.id)||steering.some(receipt=>receipt.run_id===x.id))){
   const title=run.title??(run.role==='background'?'Background task':'Conversation task');
   const card=node('details',undefined,'task-card');card.dataset.runId=run.id;card.open=expanded.has(run.id)||view?.focusRun===run.id;card.append(node('summary',`${title} · ${statuses[run.status]??run.status}`));
   card.append(node('p',`Task ${run.id}`,'hint'));
   if(view?.kind==='tasks'){
    card.append(node('p',`Owner: ${items('persona').find(bot=>bot.id===run.persona_id)?.body.name??'Unavailable bot'} · Original request: ${run.request_status??'receipt unavailable'}. Request application is not task completion.`,'hint'));
    if(run.error_code)card.append(node('p',`Waiting or recovery reason: ${run.error_code}`,'hint'));
    if(run.status==='cancelling')card.append(node('p','Cancellation requested, not confirmed. Children, tools and effects may remain unresolved.','review-notice'));
   }
   renderTokenUsage(card,run,view?.kind==='tasks'?view.page:view?null:snapshot);
   const preview=previews.find(item=>item.run_id===run.id);
   if(preview){
    // V7 clean thread (A7): provisional text is an ephemeral, visually
    // distinct "working" line, never a chat bubble and never given the
    // persisted look of a committed message.
    card.querySelector('summary').append(node('span',' · Working…','status'));
    const section=node('section',undefined,'output-preview provisional-typing');section.setAttribute('aria-label','Provisional task output');section.setAttribute('role','status');section.setAttribute('aria-live','polite');
    section.append(node('p','Working — provisional, not a completed result; children, tools or effects may still be unresolved.','hint'),node('div',preview.text,'provisional-text'));
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
   if(['queued','claimed','running','finishing','waiting'].includes(run.status))actions.append(button('Cancel this task',()=>cancelTask(run,'Owner selected this task for cancellation.'),'quiet danger'));
   if(!(alphaSeen||snapshot.summary.owner_alpha)&&(!view||view.kind==='tasks')&&current()?.kind==='persona'&&run.persona_id===selected&&Number.isSafeInteger(run.current_attempt)&&run.current_attempt>0){
    const draft=button('Draft skill from this task',()=>draftSkillFromTask(run),'quiet');draft.dataset.action='skill-from-task';draft.disabled=$('connection').textContent!=='Connected'||!navigator.onLine;actions.append(draft);
   }
   card.append(actions);timeline.append(card);
  }
  if(view?.focusRun&&view.page){const card=[...timeline.querySelectorAll('.task-card')].find(card=>card.dataset.runId===view.focusRun);card?.scrollIntoView({block:'nearest'});view.focusRun=null;}
  if(!view&&(nearBottom||!timeline.scrollTop))timeline.scrollTop=timeline.scrollHeight;
 }
 $('routines').replaceChildren();for(const r of items('routine').filter(x=>x.body.persona_id===selected)){
  const card=node('div',undefined,'card');card.append(node('h4',r.body.name),node('span',r.body.enabled?'Scheduled':'Paused','status'),node('p',r.body.schedule?`${r.body.schedule.cron} · ${r.body.schedule.timezone}`:'Event-triggered'),node('p',r.body.instructions));const actions=node('div',undefined,'actions');actions.append(button('Edit',()=>editRoutine(r)),button(r.body.enabled?'Pause':'Enable',()=>act(()=>command('routine.put',{...r.body,expected_revision:r.revision,enabled:!r.body.enabled}))));
  const remove=button('Delete',()=>deleteRoutine(r),'danger');remove.disabled=$('connection').textContent!=='Connected';remove.dataset.action='delete-routine';
  actions.append(button('Run now',()=>act(()=>command('routine.run',{id:r.id,expected_revision:r.revision}))),remove);
  card.append(actions);renderRoutinePreflight(card,r);renderRoutineHistory(card,r);$('routines').append(card);
 }if(!$('routines').children.length)$('routines').append(node('p','No routines for this bot yet.','muted'));
 $('add-routine').disabled=object?.kind!=='persona';
 renderMemories();
}
function renderMemories(){
 const selection=JSON.stringify([selected,selectionVersion]);
 if(memorySearchSelection!==selection){$('memory-search').value='';memorySearchSelection=selection;}
 const query=$('memory-search').value.slice(0,200).trim().toLowerCase();
 const eligible=items('memory').filter(x=>x.body.scope.kind==='global'||x.body.scope.kind==='persona'&&x.body.scope.id===selected);
 const matches=eligible.filter(x=>!query||x.body.text.toLowerCase().includes(query));
 $('memory-search-status').textContent=`${matches.length} of ${eligible.length} loaded memories shown.`;
 $('clear-memory-search').disabled=!$('memory-search').value;
 const inspected=new Set([...$('memories').querySelectorAll('details[open]')].map(details=>details.dataset.inspection));
 $('memories').replaceChildren();for(const m of matches){
  const card=node('div',undefined,'card');card.append(node('span',m.body.scope.kind==='global'?'Shared preference':'Bot memory','status'),node('p',m.body.text));const actions=node('div',undefined,'actions');const forget=button('Forget',()=>deleteMemory(m),'danger');forget.dataset.action='delete-memory';forget.disabled=$('connection').textContent!=='Connected'||!navigator.onLine;actions.append(button('Edit',()=>editMemory(m)),forget);card.append(actions);$('memories').append(card);
  const metadata=node('details',undefined,'hint');metadata.append(node('summary','Memory metadata'));
  for(const [label,value] of [['ID',m.id],['Revision',m.revision],['Scope kind',m.body.scope.kind],['Scope ID',m.body.scope.id===null?'None (null)':m.body.scope.id],['Sensitivity',m.body.sensitivity],['Expiry',m.body.expires_at===null?'None':m.body.expires_at],['Source event ID',m.body.source_event_id]])metadata.append(node('p',`${label}: ${value??'Unknown (not provided)'}`,'message-body'));
  metadata.append(node('p','Source identity only; source text is not retrieved.','hint'));card.append(metadata);
  metadata.dataset.inspection=JSON.stringify([selected,selectionVersion,m.body.text,metadata.textContent]);metadata.open=inspected.has(metadata.dataset.inspection);
 }if(!matches.length)$('memories').append(node('p',eligible.length?'No loaded memories match this search. Clear search to see this scope.':'No loaded memories in this scope. Save preferences you want your bots to remember.','muted'));
}
 $('conversation-search').oninput=()=>render();
$('clear-conversation-search').onclick=()=>{$('conversation-search').value='';render();$('conversation-search').focus();};
 $('memory-search').oninput=()=>renderMemories();
 $('clear-memory-search').onclick=()=>{$('memory-search').value='';renderMemories();$('memory-search').focus();};
function renderTaskStrip(){
 const strip=$('task-strip'),target=$('task-strip-content');strip.hidden=managedSelected()||!alphaConversationAvailable(selected);if(strip.hidden)return;
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
function renderQuestion(target,question){
 const owner=items('persona').find(bot=>bot.id===question.persona_id)?.body.name??'Unavailable bot';
 const card=node('section',undefined,'task-card question-card');card.dataset.questionId=question.id;card.setAttribute('aria-label',`Questions from ${owner}`);
 card.dataset.questionRevision=String(question.revision);
 card.append(node('h3',`Questions from ${owner}`));
 const labels={pending:question.answerable?'Waiting for your answer.':'Answer unavailable: this question expired or its task authority changed.',answered:question.restart_required_at?'Answer saved. Its delivery window ended before handoff.':'Answer saved. Native delivery is still pending.',response_unknown:'Answer handed off; delivery and consumption are unverified. Do not resend.',resolved:'Native request resolved. This does not prove answer consumption or task completion.'};
 card.append(node('p',$('connection').textContent==='Connected'?labels[question.state]??'Question state unavailable.':'Question status is stale. Refresh before answering.','review-notice'));
 if(question.restart_required_at)card.append(node('p','Restart required after recovery: the declared answer window elapsed before a recorded handoff or native resolution. This is a Worker deadline decision, not confirmed callback or executor termination. No answer is resent and no restart is authorized.','review-notice'));
 const scope=snapshot.objects.find(object=>object.id===question.conversation_id)?.body.name??'Unavailable conversation';
 card.append(node('p',`${scope} · Requested ${time(question.created_at)} · Answer window ends ${time(question.expires_at)}`,'hint'));
 const task=node('details');task.append(node('summary','Question task'),node('p',`${snapshot.runs.find(run=>run.id===question.run_id)?.title??'Conversation task'} · ${question.run_id} · attempt ${question.attempt}`,'hint message-body'));card.append(task);
 for(const q of question.params.questions){card.append(node('h4',q.header),node('p',q.question,'message-body'));}
 if(question.state==='pending'){
  const answer=button('Review and answer',()=>editQuestion(question),'quiet');answer.disabled=!question.answerable||$('connection').textContent!=='Connected';card.append(answer);
 }
 if(question.closeable){
  card.append(node('p','Original executor termination is confirmed. You may close this request without sending or replaying an answer. Task recovery and external effects remain separate.','hint'));
  const close=button('Close stopped question',()=>{
   const key=crypto.randomUUID(),affirmation=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.required=true;
   affirmation.append(check,document.createTextNode('Close this stopped request; any answer delivery remains unverified.'));
   openEditor('Close stopped question',[node('p',`Task ${question.run_id} · attempt ${question.attempt}`,'hint message-body'),
    node('p','This closes only the recorded question custody after confirmed executor termination. It does not record native resolution, send an answer, retry the task, reconcile effects or release locks.','review-notice'),affirmation],()=>{
     const current=(snapshot.questions??[]).find(q=>q.id===question.id);
     if($('connection').textContent!=='Connected'||!current?.closeable||current.revision!==question.revision)throw new Error('This question changed or termination is no longer confirmed. Close this editor and refresh.');
     return command('question.close',{question_id:question.id,expected_revision:question.revision,confirm_stopped_closure:true},key);
    });
  },'quiet danger');close.dataset.action='question-close';close.disabled=$('connection').textContent!=='Connected';card.append(close);
 }
 target.append(card);
}
function editQuestion(question){
 const key=crypto.randomUUID(),fields=[node('p','Reply only to these questions. This is not tool approval or permission to change another task. Do not enter passwords, authentication codes or other secrets. Nothing is sent until Save.','review-notice')];
 fields.push(node('p',`Task ${question.run_id} · attempt ${question.attempt}`,'hint message-body'));
 const responses=question.params.questions.map((q,index)=>{
  const choices=[['','Choose a response'],...(q.options??[]).map((o,i)=>[String(i),o.label])];
  if(!q.options?.length||q.isOther)choices.push(['text','Write another answer']);choices.push(['skip','Skip this question']);
  const response=selectField(`Response for ${q.header}`,`question-${index}`,choices,''),select=response.querySelector('select');select.required=true;
  const free=field(`Written answer for ${q.header}`,`written-${index}`,'','textarea'),textarea=free.querySelector('textarea');textarea.maxLength=4000;
  const update=()=>{free.hidden=select.value!=='text';free.style.display=free.hidden?'none':'';textarea.disabled=free.hidden;textarea.required=!free.hidden;};select.onchange=update;update();
  fields.push(node('h3',q.header),node('p',q.question,'message-body'));
  for(const option of q.options??[])fields.push(node('p',`${option.label} — ${option.description}`,'hint'));
  fields.push(response,free);return {q,select,textarea};
 });
 $('editor').classList.add('roster-editor');openEditor('Answer native questions',fields,()=>{
  const current=(snapshot.questions??[]).find(q=>q.id===question.id);
  if($('connection').textContent!=='Connected'||!current?.answerable||current.revision!==question.revision)throw new Error('This question is stale or no longer answerable. Close this editor and refresh.');
  const answers=Object.fromEntries(responses.map(({q,select,textarea})=>{
   const choice=select.value;if(!choice)throw new Error('Choose an answer or explicitly skip each question.');
   const value=choice==='text'?textarea.value:choice==='skip'?null:q.options[Number(choice)].label;
   if(value!==null&&[...value].length>2000)throw new Error('Each answer must be at most 2000 characters.');
   return [q.id,{answers:value===null?[]:[value]}];
  }));
  return command('question.answer',{question_id:question.id,expected_revision:question.revision,answers},key);
 });
}
function renderRoster(){
 const layout=snapshot.roster??{revision:0,sections:[],hidden_persona_ids:[]},hidden=new Set(layout.hidden_persona_ids),bots=items('persona').filter(bot=>!bot.body.archived),query=$('roster-search').value.toLocaleLowerCase();
 const observation=snapshot.roster_activity,stale=$('connection').textContent!=='Connected'||!observation||Date.now()-Date.parse(observation.observed_at)>=30000;
 const activity=id=>observation?.personas.find(row=>row.persona_id===id);
 const attention=ids=>ids.reduce((sum,id)=>{const row=activity(id);return sum+(row?.waiting??0)+(row?.recovery??0);},0);
 const questionCount=ids=>(snapshot.questions??[]).filter(q=>ids.includes(q.persona_id)).length;
 const row=bot=>{const b=button('',()=>choose(bot.id),'nav-item');b.dataset.personaId=bot.id;b.setAttribute('aria-current',String(bot.id===selected));const text=node('span',bot.body.name),a=activity(bot.id);if(a)text.append(node('small',stale?'Activity stale':`${a.unfinished} unfinished · ${a.waiting} waiting · ${a.recovery} recovery`));if(questionCount([bot.id]))text.append(node('small',`${questionCount([bot.id])} unresolved question request(s)${stale?' · stale':''}`));b.append(node('span',bot.body.name.slice(0,1),'avatar'),text);return b;};
 const visible=bots.filter(bot=>!hidden.has(bot.id)&&bot.body.name.toLocaleLowerCase().includes(query)),assigned=new Set(layout.sections.flatMap(section=>section.persona_ids));
 $('bots').replaceChildren();
 for(const section of layout.sections){
  const members=section.persona_ids.flatMap(id=>visible.filter(bot=>bot.id===id));if(query&&!members.length)continue;
  const group=node('div',undefined,'roster-section'),toggle=button(`${section.collapsed&&!query?'▸':'▾'} ${section.name} · ${stale?'attention stale':attention(section.persona_ids)+' waiting/recovery'}${questionCount(section.persona_ids)?` · ${questionCount(section.persona_ids)} question request(s)`:''}`,()=>act(()=>command('roster.set',{expected_revision:layout.revision,sections:layout.sections.map(s=>s.id===section.id?{...s,collapsed:!s.collapsed}:s),hidden_persona_ids:layout.hidden_persona_ids})),'roster-section-toggle');
  toggle.setAttribute('aria-expanded',String(!section.collapsed||Boolean(query)));group.append(toggle);if(!section.collapsed||query)group.append(...members.map(row));$('bots').append(group);
 }
 const unassigned=visible.filter(bot=>!assigned.has(bot.id));if(layout.sections.length&&unassigned.length)$('bots').append(node('p','Unassigned','roster-observation'));$('bots').append(...unassigned.map(row));
 if(!visible.length)$('bots').append(node('p',query?'No visible bots match. Hidden bots remain below.':'No visible bots. Review hidden bots or add one.','roster-observation'));
 const hiddenBots=items('persona').filter(bot=>hidden.has(bot.id));$('hidden-bots').hidden=!hiddenBots.length;
 $('hidden-bots-summary').textContent=`Hidden ${hiddenBots.length} · ${stale?'attention stale':attention(hiddenBots.map(bot=>bot.id))+' waiting/recovery'}${questionCount(hiddenBots.map(bot=>bot.id))?` · ${questionCount(hiddenBots.map(bot=>bot.id))} question request(s)`:''}`;
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
function currentRecovery(runId,attempt){
 const source=recoveryView?.conversationId===selected?recoveryView.page:snapshot;
 const run=source?.runs?.find(row=>row.id===runId);
 if($('connection').textContent!=='Connected'||run?.current_attempt!==attempt)throw new Error('Recovery status is stale or the task attempt changed. Close this editor and refresh before reviewing again.');
 const recovery=source?.recovery?.find(row=>row.run_id===runId&&row.attempt===attempt);
 if(!recovery)throw new Error('This recovery task is no longer available. Close this editor and refresh.');
 return recovery;
}
function renderRecovery(card,run,recovery,title){
 const connected=$('connection').textContent==='Connected';
 if(!connected)card.append(node('p','Recovery status is stale. Refresh before recording an outcome or releasing locks.','review-notice'));
 card.append(node('p',recovery.executor_terminated?(recovery.effects.length?'Executor termination confirmed. External effects still need separate review.':'Executor termination confirmed. No unresolved effects are recorded for this task.'):'Executor termination is not confirmed. Recovery actions are unavailable.','review-notice'));
 if(recovery.unresolved_questions)card.append(node('p',`${recovery.unresolved_questions} question request(s) remain unresolved. Review their question cards before closing recovery.`,'hint'));
 for(const [blocked,message] of [[recovery.unresolved_operations,'Operation records are unresolved.'],[recovery.descendants_unsettled,'Recover unfinished descendants before this task.'],[recovery.stale_locks,'A retained lock belongs to a different attempt. Administrative reconciliation is required.']])if(blocked)card.append(node('p',message,'hint'));
 card.append(node('p',`${recovery.retained_locks} resource lock(s) retained. Nothing is released by recording an effect outcome.`,'hint'));
 for(const effect of recovery.effects){
  const row=node('section',undefined,'card');row.append(node('h4',`Unresolved external effect · ${effect.classification}`),node('p',`Effect ${effect.id}`),node('p',`Action ${effect.action_key}`),node('p',`Request ${effect.request_digest}`));
  const decide=button('Record external outcome',()=>{
   const key=crypto.randomUUID(),evidence=field('Evidence reference (no URL or private text)','evidence_ref');evidence.querySelector('input').pattern='[A-Za-z0-9:._-]{1,128}';evidence.querySelector('input').maxLength=128;
   const outcome=selectField('Observed outcome','outcome',[['','Choose an outcome'],['confirmed','The effect occurred'],['failed','The effect did not occur']],'');outcome.querySelector('select').required=true;
   const affirmation=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.required=true;affirmation.append(check,document.createTextNode('I checked the external destination and can account for this exact effect.'));
   openEditor('Record an owner effect decision',[node('p',`Task ${run.id} · attempt ${recovery.attempt} · Selected effect: ${effect.id}`,'message-body'),node('p','This records your decision, not provider-verified evidence. If the outcome is still unknown, cancel and keep it unresolved. This does not resend the action or release its locks.','review-notice'),outcome,evidence,affirmation],form=>{
    const current=currentRecovery(run.id,recovery.attempt),latest=current.effects.find(row=>row.id===effect.id);
    if(!current.can_decide_effects||latest?.status!=='outcome_unknown'||latest.request_digest!==effect.request_digest)throw new Error('This effect or its recovery authority changed. Close this editor and review the current effect.');
    return command('effect.reconcile',{run_id:run.id,expected_attempt:recovery.attempt,effect_id:effect.id,expected_request_digest:effect.request_digest,outcome:form.get('outcome'),evidence_ref:form.get('evidence_ref')},key);
   });
  },'quiet');decide.dataset.action='effect-reconcile';decide.disabled=!connected||!recovery.can_decide_effects||effect.status!=='outcome_unknown';row.append(decide);card.append(row);
 }
 if(recovery.effects_truncated)card.append(node('p','Showing the first 20 unresolved effects. Additional effects remain blocked; refresh after reviewing this page.','hint'));
 const close=button('Close recovery and release locks',()=>{
  const key=crypto.randomUUID(),affirmation=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.required=true;affirmation.append(check,document.createTextNode('Release this stopped attempt’s resource locks and close its recovery state.'));
  openEditor(`Close recovery: ${title}`,[node('p',`Task ${run.id} · attempt ${recovery.attempt}`,'message-body'),node('p','This records the task as failed or cancelled, never successful. It does not retry the native task. Any previously requested deferred follow-ups may become eligible. The server rechecks effects, descendants and termination.','review-notice'),affirmation],()=>{
   if(!currentRecovery(run.id,recovery.attempt).can_recover)throw new Error('This task is no longer eligible for recovery closure. Close this editor and review its remaining blockers.');
   return command('run.recover',{run_id:run.id,expected_attempt:recovery.attempt,release_resources:true},key);
  });
 },'quiet danger');close.dataset.action='run-recover';close.disabled=!connected||!recovery.can_recover;card.append(close);
}
function lines(value){return String(value??'').split('\n').map(x=>x.trim()).filter(Boolean);}
function detail(label,value){const wrap=node('section',undefined,'skill-detail');wrap.append(node('h4',label));if(Array.isArray(value)){const list=node('ul');for(const item of value)list.append(node('li',item));wrap.append(list);}else wrap.append(node('p',value||'Not specified'));return wrap;}
function enablement(skillId,personaId){return (snapshot.skill_enablements??[]).find(x=>x.skill_id===skillId&&x.persona_id===personaId);}
const skillFields=[['name','Name'],['description','Purpose'],['when_to_use','When to use'],['inputs_access','Inputs and access'],['steps','Procedure'],['decision_rules','Decision rules'],['validation','Validation'],['output','Output'],['failure_handling','Failure handling'],['approval_boundaries','Approval boundaries'],['references','Supporting references']];
const referenceShapeValid=value=>value===undefined||Array.isArray(value)&&value.every(r=>r&&typeof r.name==='string'&&typeof r.text==='string'&&Object.keys(r).length===2);
function skillFieldDetail(key,label,value){
 if(key!=='references')return detail(label,Array.isArray(value)&&!value.length?'None':value);
 const section=node('section',undefined,'skill-detail skill-references');section.append(node('h4',label));
 if(!referenceShapeValid(value)){section.append(node('p','Invalid stored reference data. Approval is blocked; reject this proposal or use a valid retained revision.','review-notice'));return section;}
 if(value?.length)section.append(node('p','The application stores this text; it does not install, fetch or execute it. Names are storage policy, not content scanning or a safety guarantee. References grant no authority; separately granted model tools remain separate.','hint'));
 if(!value?.length)section.append(node('p',value===undefined?'Not specified (legacy field omitted).':'None (explicit empty list).'));
 for(const reference of value??[]){const document=node('section',undefined,'card');document.append(node('h4',reference.name),node('div',reference.text,'message-body'));section.append(document);}
 return section;
}
function proposalSkill(proposal){return items('skill').find(x=>x.id===proposal.skill_id&&!x.deleted_at);}
function renderSkillComparison(target,proposal,skill){
 target.append(node('p',`Skill ${proposal.skill_id} · Proposal revision ${proposal.proposal_revision} · Base revision ${proposal.expected_skill_revision}`,'message-body'));
 target.append(node('p',skill?`Current approved revision ${skill.revision}`:proposal.expected_skill_revision===0?'New skill — no prior approved version.':'Prior approved version is unavailable. Approval is blocked.','review-notice'));
 if(skill&&skill.revision!==proposal.expected_skill_revision)target.append(node('p','The approved skill changed after this proposal was staged. Approval is blocked; reject this proposal and draft an update from the current revision.','review-notice'));
 for(const [key,label] of skillFields){
  const section=node('section',undefined,'card message-body');section.dataset.skillField=key;
  section.append(node('h4',`${label} · ${skill?(JSON.stringify(skill.body[key])===JSON.stringify(proposal.body[key])?'Unchanged':'Changed'):'Proposed'}`));
  if(skill)section.append(skillFieldDetail(key,'Current approved',skill.body[key]));
  section.append(skillFieldDetail(key,'Proposed',proposal.body[key]));target.append(section);
 }
}
function renderSkillBody(target,body){
 target.append(detail('Purpose',body.description),detail('When to use',body.when_to_use),detail('Inputs and access',body.inputs_access),detail('Procedure',body.steps),detail('Decision rules',body.decision_rules),detail('Validation',body.validation),detail('Output',body.output),detail('Failure handling',body.failure_handling),detail('Approval boundaries',body.approval_boundaries));
 target.append(skillFieldDetail('references','Supporting references',body.references));
}
function routinePreflightCurrent(view){
 return !(alphaSeen||snapshot?.summary.owner_alpha)&&selected===view.owner&&selectionVersion===view.version&&items('persona').some(p=>p.id===view.owner&&!p.deleted_at&&p.revision===view.personaRevision)&&items('routine').some(r=>r.id===view.id&&!r.deleted_at&&r.revision===view.revision&&r.body.persona_id===view.owner);
}
function invalidateRoutinePreflight(){
 routinePreflight.invalid=true;routinePreflight.page=null;routinePreflight.loading=false;routinePreflight.error='Preflight unavailable offline. Reopen preflight after reconnecting.';
}
async function loadRoutinePreflight(routine){
 const view={id:routine.id,revision:routine.revision,owner:selected,personaRevision:current()?.revision,version:selectionVersion,page:null,loading:true,error:''};
 if(!routinePreflightCurrent(view))return;
 routinePreflight=view;render();
 try{
  if($('connection').textContent!=='Connected'||!navigator.onLine)throw Error('Preflight unavailable offline. Reopen preflight after reconnecting.');
  const page=await api(`/v1/routines/${encodeURIComponent(view.id)}/preflight`);
  if(routinePreflight!==view||!routinePreflightCurrent(view)||view.invalid)return;
  if($('connection').textContent!=='Connected'||!navigator.onLine)throw Error('Preflight unavailable offline. Reopen preflight after reconnecting.');
  if(page.routine_id!==view.id||page.routine_revision!==view.revision||page.persona_id!==view.owner||!Number.isFinite(Date.parse(page.observed_at))||typeof page.enabled!=='boolean'||typeof page.manual_run?.command_allowed!=='boolean'||typeof page.manual_run?.execution_enabled!=='boolean'||!Array.isArray(page.manual_run.blockers)||!page.manual_run.blockers.every(b=>typeof b.code==='string'&&typeof b.message==='string')||page.manual_run.command_allowed!==(page.manual_run.blockers.length===0)||!Array.isArray(page.next_times)||!page.next_times.every(at=>typeof at==='string'&&Number.isFinite(Date.parse(at)))||!Array.isArray(page.limitations)||!page.limitations.every(s=>typeof s==='string')||!page.policy||typeof page.policy.misfire!=='string'||typeof page.policy.overlap!=='string'||!Number.isSafeInteger(page.policy.max_replay)||!Number.isSafeInteger(page.policy.max_lateness_seconds)||(page.schedule!==null&&(typeof page.schedule?.cron!=='string'||typeof page.schedule?.timezone!=='string')))throw Error('Invalid or mismatched routine preflight. Reopen preflight to read again.');
  // Validate the explicit display zone before retaining the observation.
  if(page.schedule)new Intl.DateTimeFormat('en-GB',{timeZone:page.schedule.timezone}).format();
  view.page=page;
 }catch(error){if(routinePreflight===view&&routinePreflightCurrent(view))view.error=error.message;}
 finally{if(routinePreflight===view){view.loading=false;render();}}
}
function renderRoutinePreflight(card,routine){
 if(alphaSeen||snapshot?.summary.owner_alpha||routine.deleted_at)return;
 const view=routinePreflight?.id===routine.id?routinePreflight:null;
 const toggle=button(view?'Hide preflight':'Preflight',()=>{if(view){routinePreflight=null;render();}else loadRoutinePreflight(routine);},'quiet');toggle.dataset.action='routine-preflight';toggle.setAttribute('aria-expanded',String(Boolean(view)));card.querySelector('.actions').append(toggle);
 if(!view)return;
 const panel=node('section',undefined,'skill-bots routine-preflight');panel.setAttribute('aria-label',`${routine.body.name} preflight`);
 panel.append(node('h4','Routine preflight'),node('p','Read-only observation, not a test run. No automatic refresh. Run now remains a separate command and rechecks current revision and grants.','hint'));
 if(view.loading){const notice=node('p','Loading preflight…','hint');notice.setAttribute('role','status');panel.append(notice);}
 if(view.error){const notice=node('p',view.error,'review-notice');notice.setAttribute('role','alert');panel.append(notice);}
 const page=view.page;
 if(page){
  panel.append(node('p',`Revision ${page.routine_revision} · Observed ${page.observed_at} (UTC)`,'hint'),node('p',page.manual_run.command_allowed?'Command checks passed at observation: known grant, busy and persona checks only.':'Command blocked at observation:','review-notice'));
  for(const blocker of page.manual_run.blockers)panel.append(node('p',`${blocker.code}: ${blocker.message}`));
  panel.append(node('p',`Execution ${page.manual_run.execution_enabled?'enabled':'disabled'} — independent of command checks.`),node('p','Neither status proves connector credentials, model access, input readiness, effect approvals, execution success or delivery.','hint'),node('p',page.enabled?'Routine enabled. Scheduled admission is separate from this observation.':'Routine paused. Run now may run once without resuming the schedule.'));
  if(page.schedule){
   panel.append(node('p',`Schedule: ${page.schedule.cron} · Timezone: ${page.schedule.timezone}`),node('p','Hypothetical next schedule times, even while paused — not admission or delivery promises:','hint'));
   for(const at of page.next_times)panel.append(node('p',`${new Date(at).toLocaleString('en-GB',{timeZone:page.schedule.timezone})} ${page.schedule.timezone} · ${at} (UTC)`));
  }else panel.append(node('p','Event-triggered: no calendar schedule, schedule timezone or next schedule times.'));
  panel.append(node('p',`Policy: misfire ${page.policy.misfire} · overlap ${page.policy.overlap} · max replay ${page.policy.max_replay} · max lateness ${page.policy.max_lateness_seconds}s`));
  for(const limitation of page.limitations)panel.append(node('p',limitation,'hint'));
 }
 card.append(panel);
}
window.addEventListener('offline',()=>{if(routinePreflight){invalidateRoutinePreflight();render();}});
function routineHistoryCurrent(view){
 return !(alphaSeen||snapshot?.summary.owner_alpha)&&selected===view.owner&&selectionVersion===view.version&&items('routine').some(r=>r.id===view.id&&!r.deleted_at&&r.revision===view.revision&&r.body.persona_id===view.owner);
}
async function loadRoutineHistory(routine,cursor=null){
 if(alphaSeen||snapshot?.summary.owner_alpha)return;
 const view={id:routine.id,revision:routine.revision,owner:selected,version:selectionVersion,cursor,page:null,loading:true,error:'',expanded:new Set()};
 if(!routineHistoryCurrent(view))return;
 routineHistory=view;render();
 try{
  if($('connection').textContent!=='Connected'||!navigator.onLine)throw Error('History unavailable offline. Reopen history after reconnecting.');
  const page=await api(`/v1/routines/${encodeURIComponent(view.id)}/runs?${cursor?`after=${encodeURIComponent(cursor)}&`:''}limit=10`);
  if(routineHistory!==view||!routineHistoryCurrent(view)||view.invalid)return;
  if($('connection').textContent!=='Connected'||!navigator.onLine)throw Error('History unavailable offline. Reopen history after reconnecting.');
  if(!page.counts||!Array.isArray(page.runs)||page.runs.length>10||!page.runs.every((run,i)=>run.routine_id===view.id&&run.persona_id===view.owner&&typeof run.id==='string'&&(!cursor||run.id>cursor)&&(!i||run.id>page.runs[i-1].id))||(page.next_cursor!==null&&page.next_cursor!==page.runs.at(-1)?.id))throw Error('Invalid routine history response. Reopen history to read again.');
  view.page=page;
 }catch(error){if(routineHistory===view&&routineHistoryCurrent(view))view.error=error.message;}
 finally{if(routineHistory===view){view.loading=false;render();}}
}
function renderRoutineHistory(card,routine){
 if(alphaSeen||snapshot?.summary.owner_alpha||routine.deleted_at)return;
 const view=routineHistory?.id===routine.id?routineHistory:null;
 const toggle=button(view?'Hide run history':'Run history',()=>{if(view){routineHistory=null;render();}else loadRoutineHistory(routine);},'quiet');toggle.dataset.action='routine-history';toggle.setAttribute('aria-expanded',String(Boolean(view)));card.querySelector('.actions').append(toggle);
 if(!view)return;
 const panel=node('section',undefined,'routine-history');panel.dataset.routineHistory=routine.id;panel.setAttribute('aria-label',`${routine.body.name} run history`);
 panel.append(node('h4','Run history'),node('p','All retained statuses for this routine, in stable task-ID order—not newest first. Pages are observations, not a live feed. Start at the first page to include new runs.','hint'));
 if(view.loading){const notice=node('p','Loading run history…','hint');notice.setAttribute('role','status');panel.append(notice);}
 if(view.error){const notice=node('p',view.error,'review-notice');notice.setAttribute('role','alert');panel.append(notice);}
 const page=view.page;
 if(page){
  panel.append(node('p',`Observed ${time(page.observed_at)} · Total ${page.counts.total} · Waiting ${page.counts.waiting} · Recovery ${page.counts.recovery}`,'hint'),node('p','Recorded run status is separate from output delivery and native, child, tool or effect settlement. This page does not verify delivery or safe sleep.','hint'));
  if(!page.runs.length){const empty=node('p','No retained runs on this page. This does not prove the routine ran successfully.','hint');empty.setAttribute('role','status');panel.append(empty);}
  for(const run of page.runs){
   const item=node('details',undefined,'task-card');item.dataset.runId=run.id;item.append(node('summary',`${run.title??'Routine run'} · ${statuses[run.status]??run.status}`),node('p',`Task ${run.id} · attempt ${run.current_attempt}`,'hint'),node('p',`Original request: ${run.request_status??'receipt unavailable'}. Request application is not task completion.`,'hint'));
   item.append(node('p',Number.isSafeInteger(run.captured_routine_revision)&&run.captured_routine_revision>0?`Captured routine revision: ${run.captured_routine_revision} for current attempt. Capture is not proof of execution or delivery.`:'Captured routine revision unavailable; no claimed snapshot or retained attribution. The current routine revision is not substituted.','hint'));
   if(run.attempt_revisions?.length){
    item.append(node('p','Latest 3 retained attempt captures (not execution proof):','hint'));
    for(const entry of run.attempt_revisions.slice(0,3))item.append(node('p',`Attempt ${entry.attempt}: ${Number.isSafeInteger(entry.captured_routine_revision)&&entry.captured_routine_revision>0?`routine revision ${entry.captured_routine_revision}`:'routine revision unavailable'}`,'hint'));
   }
   const execution=node('section',undefined,'skill-detail execution-record');execution.setAttribute('aria-label','Current attempt record');execution.append(node('h4','Current attempt record'));
   if(run.execution?.attempt===run.current_attempt){
    execution.append(node('p',`Attempt ${run.execution.attempt} · Recorded status: ${run.execution.status}`),node('p',`Recorded start/claim time: ${run.execution.started_at??'not recorded'}`),node('p',`Application settlement time: ${run.execution.settled_at??'not recorded'}`),node('p',run.execution.result_body_retained?'Result body retained. Retention alone does not verify execution or delivery.':'Result body not retained. Payloads may be pruned after 90 days; absence does not mean execution is incomplete.','hint'));
   }else execution.append(node('p',run.execution===null?'No record for the current attempt. A missing record is not evidence of failure.':'Current attempt record unavailable.','hint'));
   execution.append(node('p','Application records only. Claim time does not prove native acknowledgement or inference. Application settlement does not verify live native-family settlement or safe sleep.','hint'));item.append(execution);
   renderTokenUsage(item,run,page);
   const delivery=node('section',undefined,'skill-detail run-delivery');delivery.setAttribute('aria-label','Run-level delivery records');delivery.append(node('h4','Run-level delivery records'));
   if(run.run_delivery){
    const {counts,portal}=run.run_delivery;
    delivery.append(node('p',`Pending ${counts.pending} · Delivered ${counts.delivered} · Failed ${counts.failed} · Outcome unknown ${counts.outcome_unknown}`),node('p','Counts include portal and all other destinations, not an overall success or failure.','hint'),node('p',portal?`Portal recorded status: ${portal.status} · Updated ${portal.updated_at}`:'Portal: no delivery record. No record is not failure.'),node('p','Portal delivered means a persisted portal record, not owner receipt or notification.','hint'));
   }else delivery.append(node('p','Run-level delivery records unavailable.','hint'));
   delivery.append(node('p','Delivery records belong to the run, not an attempt. A delivered record may predate this retry; it does not establish delivery for the current attempt.','hint'));item.append(delivery);
   item.open=view.expanded.has(run.id);item.ontoggle=()=>{if(item.isConnected){if(item.open)view.expanded.add(run.id);else view.expanded.delete(run.id);}};
   if(run.error_code)item.append(node('p',`Recorded reason: ${run.error_code}`,'hint'));
   if(run.status==='cancelling')item.append(node('p','Cancellation requested, not confirmed. Children, tools and effects may remain unresolved.','review-notice'));
   const preview=(page.output_previews??[]).find(p=>p.run_id===run.id&&p.attempt===run.current_attempt&&['running','finishing','recovery_required'].includes(run.status)&&!['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code));
   if(preview){const output=node('section',undefined,'output-preview');output.setAttribute('aria-label','Provisional task output');output.append(node('p','Latest native message — provisional. This is not a completed result; children, tools or effects may still be unresolved.','hint'),node('div',preview.text,'message-body'));if(preview.truncated)output.append(node('p','Preview shortened. This is not the complete native message.','hint'));item.append(output);}
   for(const receipt of (page.steering??[]).filter(r=>r.run_id===run.id&&r.attempt===run.current_attempt))item.append(node('p',`Steering delivery: ${receipt.status}. Native acceptance does not verify understanding or completion.`,'hint'));
   const recovery=(page.recovery??[]).find(r=>r.run_id===run.id&&r.attempt===run.current_attempt);
   if(recovery)item.append(node('p',recovery.executor_terminated?'Executor termination recorded. External effects require separate review.':'Executor termination is not confirmed.','review-notice'));
   panel.append(item);
  }
  const controls=node('div',undefined,'actions');controls.append(button('First history page',()=>loadRoutineHistory(routine),'quiet'));if(page.next_cursor)controls.append(button('Next history page',()=>loadRoutineHistory(routine,page.next_cursor),'quiet'));panel.append(controls);
 }
 card.append(panel);
}
window.addEventListener('offline',()=>{if(routineHistory){routineHistory.invalid=true;routineHistory.page=null;routineHistory.loading=false;routineHistory.error='History unavailable offline. Reopen history after reconnecting.';render();}});
function skillHistoryAllowed(){return !(alphaSeen||snapshot?.summary.owner_alpha);}
function historyUrl(skillId,before){return `/v1/skills/${encodeURIComponent(skillId)}/revisions?${before?`before=${before}&`:''}limit=10`;}
async function loadSkillHistory(skill,before=null){
 if(!skillHistoryAllowed()){report('Skill history is unavailable in the owner-alpha session.');return;}
 const version=selectionVersion,identity={id:skill.id,revision:skill.revision},existing=skillHistories.get(skill.id);
 const view={skillRevision:skill.revision,rows:before?[...(existing?.rows??[])]:[],nextCursor:before,error:'',loading:true};skillHistories.set(skill.id,view);lastSignature='';renderSkills();
 try{
  if($('connection').textContent!=='Connected'||!navigator.onLine)throw new Error('History is unavailable offline. Reconnect and retry.');
  const page=await api(historyUrl(skill.id,before));
  const currentSkill=items('skill').find(x=>x.id===identity.id&&!x.deleted_at);
  if(skillHistories.get(skill.id)!==view||selected!=='skills'||selectionVersion!==version||!skillHistoryAllowed())return;
  if($('connection').textContent!=='Connected'||!navigator.onLine)throw new Error('History is unavailable offline. Reconnect and retry.');
  if(!currentSkill||currentSkill.revision!==identity.revision||page.skill_id!==identity.id||page.current_revision!==identity.revision)throw new Error('The approved skill changed or was deleted. Refresh before reading or restoring history.');
  if(!Array.isArray(page.revisions)||page.revisions.length>10||!page.revisions.every((row,index)=>Number.isSafeInteger(row.revision)&&row.revision>0&&row.revision<=identity.revision&&(!before||row.revision<before)&&(!index||row.revision<page.revisions[index-1].revision)&&row.body&&typeof row.created_at==='string')||(page.next_cursor!==null&&(!page.revisions.length||page.next_cursor!==page.revisions.at(-1).revision)))throw new Error('The portal returned invalid skill history.');
  view.rows=[...new Map([...view.rows,...page.revisions].map(row=>[row.revision,row])).values()].sort((a,b)=>b.revision-a.revision);view.nextCursor=page.next_cursor;view.loading=false;lastSignature='';renderSkills();
 }catch(e){if(skillHistories.get(skill.id)===view&&selected==='skills'&&selectionVersion===version){view.loading=false;view.error=e.message;lastSignature='';renderSkills();}}
}
function stageSkillRestore(skill,row){
 const capturedSkill=structuredClone(skill),source=structuredClone(row),proposalId=crypto.randomUUID(),key=crypto.randomUUID(),version=selectionVersion;
 const affirmation=node('label',undefined,'check affirmation'),check=node('input');check.type='checkbox';check.name='confirm';check.required=true;affirmation.append(check,document.createTextNode(`Stage revision ${source.revision} as a pending proposal for separate review.`));
 $('editor').classList.add('roster-editor');
 openEditor(`Stage restore: ${capturedSkill.body.name}`,[node('p',`Current approved revision ${capturedSkill.revision} · Historical source revision ${source.revision}`,'message-body'),node('p','This stages a pending restore proposal only. It does not approve, enable, or immediately replace the skill. Review and approval remain a separate action.','review-notice'),node('p','Only retained revisions are available; gaps may exist and expired history cannot be restored here. The restore proposal contains the whole source body. Approving it removes current references absent from this source. A lost reply may still mean staging succeeded. Retry unchanged to send the identical proposal and key.','hint'),...skillFields.map(([field,label])=>skillFieldDetail(field,label,source.body[field])),affirmation],()=>{
  const latest=items('skill').find(x=>x.id===capturedSkill.id&&!x.deleted_at),history=skillHistories.get(capturedSkill.id);
  if(!skillHistoryAllowed()||$('connection').textContent!=='Connected'||!navigator.onLine||selected!=='skills'||selectionVersion!==version||!latest||latest.revision!==capturedSkill.revision||history?.loading||history?.error||!history?.rows.some(item=>item.revision===source.revision&&JSON.stringify(item.body)===JSON.stringify(source.body)))throw new Error('The skill, selected history, navigation, or connection changed. Close and refresh before staging a restore.');
  return command('skill.restore',{proposal_id:proposalId,skill_id:capturedSkill.id,expected_skill_revision:capturedSkill.revision,source_revision:source.revision},key);
 },'Stage restore proposal');
}
function renderSkillHistory(card,skill){
 const actions=card.querySelector('.actions'),allowed=skillHistoryAllowed(),view=skillHistories.get(skill.id);
 if(!allowed)return;
 const historyButton=button(view?'Hide history':'History',()=>{if(view){skillHistories.delete(skill.id);lastSignature='';renderSkills();}else loadSkillHistory(skill);},'quiet');historyButton.dataset.action='skill-history';actions.append(historyButton);
 if(!view)return;
 const panel=node('section',undefined,'skill-bots');panel.dataset.skillHistory=skill.id;panel.append(node('h4','Retained revision history'),node('p','Loaded on demand. Revisions descend but retained history may have gaps; unavailable or expired revisions cannot be restored. Staging creates a proposal and never approves or enables it.','hint'));
 if(view.skillRevision!==skill.revision)panel.append(node('p','The approved revision changed. Close history and refresh before continuing.','review-notice'));
 for(const row of view.rows){const item=node('details',undefined,'card');item.dataset.sourceRevision=String(row.revision);item.append(node('summary',`Revision ${row.revision} · ${time(row.created_at)}`),detail('Name',row.body.name));renderSkillBody(item,row.body);const stage=button('Stage restore',()=>stageSkillRestore(skill,row),'quiet');stage.dataset.action='stage-restore';stage.disabled=Boolean(view.loading||view.error)||view.skillRevision!==skill.revision||$('connection').textContent!=='Connected'||!navigator.onLine;item.append(stage);panel.append(item);}
 if(view.loading){const status=node('p','Loading retained history…','hint');status.setAttribute('role','status');panel.append(status);}
 if(view.error){const error=node('p',view.error,'review-notice');error.setAttribute('role','alert');panel.append(error,button('Retry history',()=>loadSkillHistory(skill,view.nextCursor),'quiet'));}
 if(!view.loading&&!view.error&&view.nextCursor)panel.append(button('Load older retained revisions',()=>loadSkillHistory(skill,view.nextCursor),'quiet'));
 if(!view.loading&&!view.error&&!view.rows.length)panel.append(node('p','No retained revision rows were returned.','muted'));
 card.append(panel);
}
function renderSkills(){
 const signature=JSON.stringify(['skills',items('skill'),items('persona'),snapshot.skill_proposals,snapshot.skill_enablements,$('connection').textContent,navigator.onLine,skillHistoryAllowed(),[...skillHistories]]);
 if(lastSignature===signature)return;
 lastSignature=signature;
 const openSummaries=new Set([...$('timeline').querySelectorAll('details[open] > summary')].map(x=>x.textContent));
 const scrollTop=$('timeline').scrollTop;
 const timeline=$('timeline');document.querySelector('.app').classList.add('skills-mode');$('conversation-type').textContent='MANAGED CATALOG';$('conversation-name').textContent='Skills';$('edit-bot').hidden=true;$('show-details').hidden=true;$('composer').hidden=true;$('details').hidden=true;$('details').classList.remove('open');
 timeline.replaceChildren();const intro=node('div',undefined,'skills-intro');const heading=node('div',undefined,'skills-heading');const copy=node('div');copy.append(node('h2','Reviewed procedures'),node('p','Drafts stay proposals until you explicitly approve them. Enabling a skill is a separate per-bot choice.','muted'));heading.append(copy,button('+ Draft skill',()=>editSkillProposal(),'primary'));intro.append(heading);timeline.append(intro);
 const pending=(snapshot.skill_proposals??[]).filter(x=>x.status==='pending');timeline.append(node('h2',`Pending proposals (${pending.length})`,'subheading'));
 if(!pending.length)timeline.append(node('p','No proposals are waiting for review.','muted'));
 for(const proposal of pending){
  const skill=proposalSkill(proposal),connected=$('connection').textContent==='Connected';
  const card=node('details',undefined,'skill-card proposal');card.dataset.proposalId=proposal.id;
  const summary=node('summary');summary.append(node('span',proposal.body.name),node('span',proposal.provenance?.kind==='owner'?'Owner draft':`${proposal.provenance?.kind??'Unknown'} content`,'status'));
  card.append(summary,node('p',`Source: ${proposal.provenance?.source_ref??'Not recorded'}`,'message-body'));renderSkillComparison(card,proposal,skill);
  card.append(node('p','Approval confirms this procedure contains no private facts. Imported or model-written content is never approved automatically.','review-notice'));
  if(!connected)card.append(node('p','Review actions are unavailable offline. Refresh before reviewing.','review-notice'));
  const actions=node('div',undefined,'actions');
  for(const decision of ['approve','reject']){const action=button(decision==='approve'?'Approve':'Reject',()=>reviewProposal(proposal,decision),decision==='approve'?'primary':'quiet danger');action.dataset.action=`skill-${decision}`;action.disabled=!connected||(decision==='approve'&&(skill?.revision??0)!==proposal.expected_skill_revision);actions.append(action);}
  card.append(actions);timeline.append(card);
 }
 const catalog=items('skill').filter(x=>!x.deleted_at);timeline.append(node('h2',`Approved catalog (${catalog.length})`,'subheading'));
 if(!catalog.length)timeline.append(node('p','No skills have been approved yet.','muted'));
 for(const skill of catalog){const card=node('details',undefined,'skill-card');card.dataset.skillId=skill.id;const summary=node('summary');summary.append(node('span',skill.body.name),node('span',`Revision ${skill.revision}`,'status'));card.append(summary,node('p',skill.body.description,'skill-description'));renderSkillBody(card,skill.body);const bots=node('div',undefined,'skill-bots');bots.append(node('h4','Bot access'));for(const persona of items('persona').filter(x=>!x.body.archived)){const record=enablement(skill.id,persona.id),enabled=record?.enabled===true;const row=node('div',undefined,'skill-bot-row');row.append(node('span',persona.body.name),button(enabled?'Disable':'Enable',()=>act(()=>command('skill.enable',{skill_id:skill.id,expected_skill_revision:skill.revision,persona_id:persona.id,enabled:!enabled})),enabled?'quiet danger':'quiet'));bots.append(row);}const actions=node('div',undefined,'actions');actions.append(button('Propose an update',()=>editSkillProposal(skill),'quiet'));if(!alphaSeen&&!snapshot.summary.owner_alpha){const run=button('Run once',()=>runSkillOnce(skill),'primary');run.dataset.action='skill-run';run.disabled=$('connection').textContent!=='Connected'||!navigator.onLine||!items('persona').some(item=>!item.body.archived&&!item.deleted_at);actions.append(run);}card.append(bots,actions);renderSkillHistory(card,skill);timeline.append(card);}
 for(const details of timeline.querySelectorAll('details'))details.open=openSummaries.has(details.querySelector('summary')?.textContent);
 timeline.scrollTop=scrollTop;
}
function runSkillOnce(skill){
 const captured=structuredClone(skill),personas=items('persona').filter(item=>!item.body.archived&&!item.deleted_at),version=selectionVersion,key=crypto.randomUUID();let submittedBody=null;
 const picker=selectField('Active bot','persona_id',personas.map(persona=>[persona.id,`${persona.body.name} (revision ${persona.revision})`]),personas[0]?.id),input=field('Input for this run','text','','textarea');input.querySelector('textarea').maxLength=32768;
 const confirmation=node('label',undefined,'check affirmation'),check=node('input');check.type='checkbox';check.name='confirm';check.required=true;confirmation.append(check,document.createTextNode('Run this as ordinary work with the selected bot’s current permissions.'));
 $('editor').classList.add('roster-editor');
 openEditor(`Run once: ${captured.body.name}`,[node('p',`This request captures approved skill revision ${captured.revision}. The selected bot revision is checked at acceptance; its context and permissions are checked again at execution admission. Later skill edits or deletion do not change an accepted run or its retry. This does not change which bots have the skill enabled.`,'review-notice'),node('p',`${snapshot.summary.execution_enabled?'':'Execution is currently unavailable. The accepted request will wait durably and may run later when execution is enabled. '}This is real ordinary gated work, not a dry run, isolated test, no-effects mode, or safety guarantee. Current bot/runtime permissions apply and existing effect approvals are still required. An unstarted captured input expires after 30 days and then requires fresh input.`,'review-notice'),picker,input,confirmation],async form=>{
  const latest=items('skill').find(item=>item.id===captured.id&&!item.deleted_at),persona=personas.find(item=>item.id===form.get('persona_id')),currentPersona=items('persona').find(item=>item.id===persona?.id&&!item.deleted_at),text=String(form.get('text'));
  if(alphaSeen||snapshot.summary.owner_alpha||$('connection').textContent!=='Connected'||!navigator.onLine||selected!=='skills'||selectionVersion!==version||!latest||latest.revision!==captured.revision||!persona||!currentPersona||currentPersona.body.archived||currentPersona.revision!==persona.revision)throw new Error('The skill, bot, navigation, alpha mode, or connection changed. Close and refresh before running once.');
  if(!text.trim()||new TextEncoder().encode(text).length>32768||[...text].length>32768)throw new Error('Input must be nonblank and at most 32,768 UTF-8 bytes.');
  const payload={skill_id:captured.id,expected_skill_revision:captured.revision,persona_id:persona.id,expected_persona_revision:persona.revision,text},body=JSON.stringify({schema_version:1,type:'skill.run',payload});
  if(submittedBody&&submittedBody!==body)throw new Error('This request has an uncertain prior outcome. Retry only the unchanged bot and input, or close and refresh.');
  submittedBody=body;
  await command('skill.run',payload,key);
  if(selected==='skills'&&selectionVersion===version)choose(persona.id);
 },'Confirm Run once');
}
function reviewProposal(proposal,decision){
 const skill=proposalSkill(proposal),key=crypto.randomUUID(),comparison=node('div',undefined,'message-body');renderSkillComparison(comparison,proposal,skill);
 const fields=[node('p',decision==='approve'?'Approval updates already-enabled bots for future tasks. It does not enable additional bots or rewrite context captured by already-admitted tasks. Review every field before confirming.':'Reject this proposal without changing the approved catalog or bot access.','review-notice'),comparison];
 if(decision==='approve'){const label=node('label',undefined,'check affirmation');const check=node('input');check.type='checkbox';check.name='affirm';check.required=true;label.append(check,document.createTextNode('I affirm this draft contains no private facts.'));fields.push(label);}
 $('editor').classList.add('roster-editor');
 openEditor(`${decision==='approve'?'Approve':'Reject'} ${proposal.body.name}`,fields,()=>{
  const latest=(snapshot.skill_proposals??[]).find(x=>x.id===proposal.id),currentSkill=proposalSkill(proposal);
  if($('connection').textContent!=='Connected'||latest?.status!=='pending'||latest.proposal_revision!==proposal.proposal_revision||latest.skill_id!==proposal.skill_id||latest.expected_skill_revision!==proposal.expected_skill_revision||(currentSkill?.revision??0)!==(skill?.revision??0)||(decision==='approve'&&(currentSkill?.revision??0)!==proposal.expected_skill_revision))throw new Error('This proposal or approved skill is stale, changed, or offline. Close this editor and refresh before reviewing again.');
  return command('skill.review',{proposal_id:proposal.id,expected_proposal_revision:proposal.proposal_revision,decision},key);
 },decision==='approve'?'Approve proposal':'Reject proposal');
}
function skillReferenceEditor(body){
 const element=node('section',undefined,'skill-reference-editor'),rows=node('div'),originals=new WeakMap();
 element.append(node('h3','Supporting references'),node('p','Up to 4 stored text documents. Use unique lower-case basenames ending in .md or .txt (no paths), and 1–16,000 Unicode codepoints per document. The application does not install, fetch or execute this text. Naming rules are not content scanning or a guarantee about separately granted model tools. Changes require proposal review, not activation or new authority. The private-facts affirmation covers references too.','hint'));
 if(!referenceShapeValid(body.references)||(body.references?.length??0)>4){
  const message='Invalid stored reference data. This editor cannot preserve it; use a valid retained revision rather than silently dropping documents.';
  element.append(node('p',message,'review-notice'));return {element,read(){throw new Error(message);}};
 }
 const add=button('Add text reference',()=>append({name:'',text:''}),'quiet');add.dataset.action='add-reference';
 function append(reference){
  if(rows.children.length>=4)return;
  const row=node('section',undefined,'card reference-editor-row'),name=field('Reference name','reference_name',reference.name),text=field('Reference text','reference_text',reference.text,'textarea');
  const input=name.querySelector('input');input.maxLength=80;input.pattern='[a-z0-9][a-z0-9._\\-]{0,63}\\.(md|txt)';
  originals.set(row,{text:reference.text,value:text.querySelector('textarea').value}); // Preserve original newline bytes on unrelated edits.
  const remove=button('Remove reference',()=>{row.remove();add.disabled=false;},'quiet danger');remove.dataset.action='remove-reference';row.append(name,text,remove);rows.append(row);add.disabled=rows.children.length>=4;
 }
 for(const reference of body.references??[])append(reference);
 element.append(rows,add);
 return {element,read(){
  const references=[...rows.children].map(row=>{const text=row.querySelector('textarea').value,original=originals.get(row);return {name:row.querySelector('input').value,text:text===original.value?original.text:text};}),names=new Set();
  for(const reference of references){
   if(!/^[a-z0-9][a-z0-9._-]{0,63}\.(md|txt)$/.test(reference.name)||names.has(reference.name))throw new Error('Reference names must be unique lower-case .md or .txt basenames, with no paths.');
   if(!reference.text.length||[...reference.text].length>16000)throw new Error('Reference text must contain 1–16,000 Unicode codepoints.');
   names.add(reference.name);
  }
  return !Object.hasOwn(body,'references')&&!references.length?undefined:references;
 }};
}
function draftSkillFromTask(run){
 const owner=selected,version=selectionVersion,view=recoveryView,persona=current();
 const identity=Object.fromEntries(['id','persona_id','current_attempt','status','title','role','routine_id','error_code'].map(key=>[key,run[key]]));
 const source={runId:run.id,personaId:run.persona_id,attempt:run.current_attempt,validate(){
  const latest=(view?view.page:snapshot)?.runs?.find(row=>row.id===identity.id),currentPersona=current();
  if(alphaSeen||snapshot?.summary.owner_alpha||$('connection').textContent!=='Connected'||!navigator.onLine||selected!==owner||selectionVersion!==version||recoveryView!==view||view&&view.kind!=='tasks'||persona?.kind!=='persona'||currentPersona?.id!==persona.id||currentPersona.deleted_at||currentPersona.body.archived||currentPersona.revision!==persona.revision||identity.persona_id!==owner||!Number.isSafeInteger(identity.current_attempt)||identity.current_attempt<1||!latest||Object.keys(identity).some(key=>latest[key]!==identity[key]))throw new Error('Source task, attempt, persona or navigation changed, is unavailable, offline or in owner-alpha. Close and reopen the exact task before drafting again.');
 }};
 try{source.validate();editSkillProposal(undefined,source);}catch(error){report(error.message);}
}
window.addEventListener('offline',()=>{lastSignature='';render();});
function editSkillProposal(skill,source){
 const proposalId=crypto.randomUUID(),key=crypto.randomUUID();let submitted;
 const draftId=skill?.id??crypto.randomUUID(),body=skill?.body??{};const existing=items('skill');const options=[['new','Create a new stable skill'],...existing.map(x=>[x.id,`Update ${x.body.name} (revision ${x.revision})`])];
 const fields=[selectField('Draft target','target',options,skill?.id??'new'),field('Name','name',body.name??''),field('Purpose','description',body.description??'','textarea'),field('When should a bot use it?','when_to_use',body.when_to_use??'','textarea'),field('Inputs and access (one per line)','inputs_access',(body.inputs_access??[]).join('\n'),'textarea'),field('Steps (one per line)','steps',(body.steps??[]).join('\n'),'textarea'),field('Decision rules (one per line)','decision_rules',(body.decision_rules??[]).join('\n'),'textarea'),field('Validation checks (one per line)','validation',(body.validation??[]).join('\n'),'textarea'),field('Expected output','output',body.output??'','textarea'),field('Failure handling (one per line)','failure_handling',(body.failure_handling??[]).join('\n'),'textarea'),field('Approval boundaries (one per line)','approval_boundaries',(body.approval_boundaries??[]).join('\n'),'textarea')];
 if(source)fields.unshift(node('p',`Source persona ${source.personaId} · Task ${source.runId} · Attempt ${source.attempt}`,'hint message-body'),node('p','Write a new reusable procedure yourself. No task transcript, input, output, checkpoint or memory is copied; there is no automatic learning or inference. Failed and unfinished tasks may be sources, not evidence of success or settlement. The server rechecks the current retained attempt. This only stages a proposal for separate approval, not activation or tool authority.','review-notice'));
 const references=skillReferenceEditor(body);fields.push(references.element,node('p','To change the draft target, close and reopen Propose an update on that exact skill, or Draft skill for a new skill. This prevents silently dropping its references.','hint'));
 const affirmation=node('label',undefined,'check affirmation');const check=node('input');check.type='checkbox';check.name='affirm';check.required=true;affirmation.append(check,document.createTextNode('I affirm this procedural draft contains no private facts.'));fields.push(node('p','The portal does not scan for private facts. Your affirmation is required, and submission creates a pending proposal—not an approved skill.','review-notice'),affirmation);
 $('editor').classList.add('roster-editor');
 openEditor(source?'Draft skill from this task':skill?'Propose a skill update':'Draft a skill',fields,form=>{
  source?.validate();
  const target=form.get('target'),existingSkill=existing.find(x=>x.id===target),current=items('skill').find(x=>x.id===target&&!x.deleted_at);
  if(target!==(skill?.id??'new'))throw new Error('Draft target changed. Close and reopen the exact target to retain its supporting references.');
  if($('connection').textContent!=='Connected'||target!=='new'&&(!existingSkill||!current||current.revision!==existingSkill.revision))throw new Error('This skill is stale, missing, or offline. Close this editor and refresh before drafting again.');
  const payload={proposal_id:proposalId,skill_id:existingSkill?.id??draftId,expected_skill_revision:existingSkill?.revision??0,body:{name:form.get('name'),description:form.get('description'),when_to_use:form.get('when_to_use'),inputs_access:lines(form.get('inputs_access')),steps:lines(form.get('steps')),decision_rules:lines(form.get('decision_rules')),validation:lines(form.get('validation')),output:form.get('output'),failure_handling:lines(form.get('failure_handling')),approval_boundaries:lines(form.get('approval_boundaries')),contains_private_facts:false},...(source?{source_run_id:source.runId,expected_attempt:source.attempt}:{provenance:{kind:'owner',source_ref:'portal:owner-draft'},executable_files_changed:false})};
  const documents=references.read();if(documents!==undefined)payload.body.references=documents;
  const fingerprint=JSON.stringify(payload);
  if(submitted&&submitted!==fingerprint)throw new Error('This draft was already submitted. Retry its unchanged contents or close and refresh to inspect the proposal before making changes.');
  submitted=fingerprint;
  return command(source?'skill.propose_from_task':'skill.propose',payload,key);
 });
}
async function act(fn){try{report('');await fn();await refresh(true);}catch(e){report(e.message);}}
$('review-alpha-session').onclick=()=>act(reviewAlphaSession);
$('message').oninput=()=>{if(selected)localStorage.setItem('personal.draft.'+selected,$('message').value);$('draft-status').textContent='Unsent draft saved on this device';};
$('composer').onsubmit=async event=>{
 event.preventDefault();if(!selected||!$('message').value.trim())return;const text=$('message').value,conversation=selected;
 const blocked=alphaBlock();if(blocked||sending){renderAlphaSession();if(blocked)report(blocked);return;}
 report('');$('message').value='';try{localStorage.removeItem('personal.draft.'+conversation);}catch{}
 $('draft-status').textContent='Queued to send';
 await outboxEnqueue(conversation,text);
 renderAlphaSession();
};
function field(label,name,value='',type='text'){const l=node('label',label,'field');let input;if(type==='textarea')input=node('textarea');else{input=node('input');input.type=type;}input.name=name;input.value=value;input.required=true;l.append(input);return l;}
function selectField(label,name,options,value){const l=node('label',label,'field');const select=node('select');select.name=name;for(const [v,text]of options){const o=node('option',text);o.value=v;select.append(o);}select.value=value;l.append(select);return l;}
function openEditor(title,fields,save,submitLabel='Save'){editing=save;$('editor-title').textContent=title;$('editor-fields').replaceChildren(...fields);$('editor-error').hidden=true;$('editor-form').querySelector('button[type="submit"]').textContent=submitLabel;$('editor').showModal();}
function cancelTask(run,reason){
 const original=structuredClone(run),owner=selected,version=selectionVersion,view=recoveryView,identity=structuredClone(current()),key=crypto.randomUUID();
 const body=JSON.stringify({schema_version:1,type:'run.cancel',payload:{run_id:original.id,reason}});
 const affirmation=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.name='confirm';check.required=true;
 affirmation.append(check,document.createTextNode('Request cancellation of only this exact task.'));
 let rejected=false;
 $('editor').classList.add('roster-editor');
 openEditor('Cancel this exact task?',[
  node('p',original.title??(original.role==='background'?'Background task':'Conversation task'),'message-body'),
  node('p',`Task ${original.id} · attempt ${original.current_attempt} · ${statuses[original.status]??original.status}`,'hint message-body'),
  node('p','This requests cancellation, not confirmed executor termination. Children, tools and external effects may remain unresolved. It does not undo or roll back effects, release locks, or cancel other tasks.','review-notice'),
  node('p','This review checks the latest task observed by this client. The server has no attempt precondition for cancellation: an attempt can change after this check and before the server receives it.','hint'),
  node('p','A lost reply may still mean the request was accepted. Only an explicit retry sends this exact request with the same key. Reconnecting never retries it. If the task changes or disappears, close and refresh instead.','hint'),affirmation
 ],async form=>{
  const latest=(view?view.page:snapshot)?.runs?.find(row=>row.id===original.id),currentIdentity=current();
  if($('connection').textContent!=='Connected'||!navigator.onLine||selected!==owner||selectionVersion!==version||recoveryView!==view||!identity||!currentIdentity||currentIdentity.deleted_at||currentIdentity.revision!==identity.revision||currentIdentity.body.archived!==identity.body.archived||!latest||latest.current_attempt!==original.current_attempt||latest.status!==original.status||latest.persona_id!==original.persona_id||latest.title!==original.title||latest.role!==original.role||!['queued','claimed','running','finishing','waiting'].includes(latest.status))throw new Error('Task or selection changed, is stale, or is offline. Close and refresh before reviewing again.');
  if(form.get('confirm')!=='on')throw new Error('Confirm cancellation of this exact task.');
  if(rejected)throw new Error('The request was rejected. Close and refresh before reviewing again.');
  // Keep transport classification local: other editors retain their existing retry behavior.
  let response,result;
  try{
   response=await fetch('/v1/commands',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body});
   result=await response.json();
   if(response.ok&&!['accepted','applied','rejected'].includes(result?.status))throw new Error('Unexpected receipt');
   if(response.status>=500)throw new Error('Uncertain server outcome');
  }catch{
   $('editor-form').querySelector('button[type="submit"]').textContent='Retry same cancellation';
   throw new Error('Cancellation outcome unknown. Refresh to review current status; retry only this same request explicitly, or close.');
  }
  if(!response.ok||result.status==='rejected'){
   rejected=true;$('editor-form').querySelector('button[type="submit"]').textContent='Request cancellation';
   throw new Error(`${result?.error?.message??'Cancellation was rejected.'} Close and refresh before reviewing again.`);
  }
 },'Request cancellation');
}
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
function renderBackupStatus(){
 const backup=snapshot.settings?.backup,el=$('backup-status');
 if(!backup?.enabled){el.hidden=true;return;}
 el.hidden=false;
 if(!backup.at){el.textContent='Backups enabled · first nightly run pending';return;}
 el.textContent=`${backup.ok?'Last backup':'Last backup attempt failed'}: ${time(backup.at)} · ${backup.kept} kept${backup.ok?'':` (${backup.error_code})`}`;
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
function renderMetering(){
 const metering=snapshot.metering;$('metering-panel').hidden=!metering;if(!metering)return;
 const line=(label,period)=>node('p',`${label}: ${dollars(period.estimated_usd*100)} est. · ${Math.round(period.awake_minutes)} min awake`,'hint');
 $('metering-summary').replaceChildren(line('Today',metering.today),line('Last 7 days',metering.last_7_days),line('Month to date',metering.month_to_date),
  node('p',`${metering.tokens.total_tokens_in_retained_snapshots.toLocaleString()} tokens in retained run snapshots (not a daily total)`,'hint'));
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
$('editor').addEventListener('close',()=>{if(!$('editor').open)$('editor').classList.remove('roster-editor');});
$('editor-form').onsubmit=async e=>{e.preventDefault();if(!editing)return;const b=e.submitter;b.disabled=true;try{await editing(new FormData(e.target));closeEditor();await refresh(true);}catch(error){$('editor-error').textContent=error.message;$('editor-error').hidden=false;}finally{b.disabled=false;}};
function editBot(object,duplicate=false){
 const source=object?.body,existing=object&&!duplicate,id=existing?object.id:crypto.randomUUID(),key=crypto.randomUUID();
 const name=field('Name','name',duplicate?[...(source.name+' copy')].slice(0,80).join(''):source?.name??''),role=field('Role (optional)','role',existing?source.role??'':''),instructions=field('Instructions','instructions',existing?source.instructions:'','textarea');
 name.querySelector('input').maxLength=80;role.querySelector('input').required=false;role.querySelector('input').maxLength=200;instructions.querySelector('textarea').maxLength=16000;
 const grantable=snapshot.settings?.grantable_tools??[],held=existing?source.tool_policy_ids:[],kept=held.filter(x=>!grantable.some(g=>g.id===x));
 const capabilities=grantable.map(tool=>{const label=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.name='tool_policy';check.value=tool.id;check.checked=held.includes(tool.id);label.append(check,document.createTextNode(tool.label));return [label,node('p',tool.description,'hint')];}).flat();
 const advanced=node('details'),fields=[name,role,instructions];if(capabilities.length){const set=node('fieldset');set.append(node('legend','Capabilities'),...capabilities);fields.push(set);}advanced.append(node('summary','Advanced'),node('p','Model sign-in belongs to the installation runtime. This form does not connect accounts or grant connector/device permissions.','hint'),node('p',existing?`${source.tool_policy_ids.filter(x=>!grantable.some(g=>g.id===x)).length} other tool policy reference(s) retained. Manage skills separately; profile editing does not enable them.`:'Minimal profile: no tool policies or optional skills are bundled. Add capabilities separately through authorized setup.','hint'));
 if(duplicate){
  const review=node('details');review.append(node('summary','Review source role and instructions'),node('p',source.role??'No role','hint'),node('div',source.instructions,'message-body'));
  const consent=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.onchange=()=>{role.querySelector('input').value=check.checked?source.role??'':'';instructions.querySelector('textarea').value=check.checked?source.instructions:'';};consent.append(check,document.createTextNode('Copy reviewed source role and instructions'));
  fields.push(node('p','This is a new bot identity. Memories, conversations, tasks, routines, skills, tool policies, credentials and connector authority are not copied. Review instructions for private facts before copying them.','review-notice'),review,consent);
 }
 fields.push(advanced,node('p','Saving this profile makes no model call or wake request. No introduction is generated.','hint'));
 if(existing)fields.push(button('Duplicate as new bot',()=>{closeEditor();editBot(object,true);},'quiet'));
 $('editor').classList.add('roster-editor');openEditor(duplicate?'Duplicate bot':existing?'Bot instructions':'New bot',fields,form=>command('persona.put',{id,expected_revision:existing?object.revision:0,name:form.get('name'),role:form.get('role'),instructions:form.get('instructions'),tool_policy_ids:[...kept,...form.getAll('tool_policy')],archived:existing?source.archived:false},key));
}
function deleteRoutine(routine){
 const key=crypto.randomUUID(),owner=selected,affirmation=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.name='confirm';check.required=true;
 affirmation.append(check,document.createTextNode('Delete this routine’s future automation and queued work. Already active tasks will continue.'));
 openEditor(`Delete routine: ${routine.body.name}`,[node('p',`Routine ${routine.id} · revision ${routine.revision}`,'message-body'),node('p','This does not cancel active tasks or undo external actions. To stop active work, cancel its exact task separately.','review-notice'),affirmation],form=>{
  const latest=items('routine').find(row=>row.id===routine.id);
  if($('connection').textContent!=='Connected'||selected!==owner||latest?.revision!==routine.revision||latest?.body.persona_id!==owner)throw new Error('Routine status is stale or changed. Close this editor and review the current routine before deleting.');
  if(form.get('confirm')!=='on')throw new Error('Confirm deletion of this exact routine.');
  return command('routine.delete',{id:routine.id,expected_revision:routine.revision},key);
 },'Delete routine');
}
function editRoutine(object){
 const routine=object?.body,persona=routine?.persona_id??selected,id=object?.id??crypto.randomUUID(),key=crypto.randomUUID();
 const picker=routine?.trigger_source_id?null:routineSchedulePicker(routine?.schedule,snapshot.settings?.timezone??'Asia/Jakarta');
 $('editor').classList.add('roster-editor');openEditor(object?'Edit routine':'New routine',[
  field('Name','name',routine?.name??''),field('What should this bot do?','instructions',routine?.instructions??'','textarea'),
  picker?.element??node('p','Event-triggered routine. This edit preserves its existing trigger; it does not convert it to a schedule.','review-notice'),
  selectField('State','enabled',[['true','Enabled'],['false','Paused']],String(routine?.enabled??true))
 ],form=>command('routine.put',{id,expected_revision:object?.revision??0,persona_id:persona,name:form.get('name'),instructions:form.get('instructions'),schedule:picker?picker.reviewed():null,trigger_source_id:routine?.trigger_source_id??null,enabled:form.get('enabled')==='true',policy:routine?.policy??{misfire:'coalesce',overlap:'queue_one',max_replay:1,max_lateness_seconds:86400},action_policy_ids:routine?.action_policy_ids??[]},key));
}
function routineSchedulePicker(schedule,defaultZone){
 const original=schedule?.cron??'0 8 * * 1-5',parts=original.split(' '),daily=/^\d+ \d+ \* \* (\*|1-5|[0-6])$/.test(original),monthly=/^\d+ \d+ (?:[1-9]|[12]\d|3[01]) \* \*$/.test(original);
 const mode=daily?(parts[4]==='*'?'daily':parts[4]==='1-5'?'weekdays':'weekly'):monthly?'monthly':original==='*/15 * * * *'?'15':original==='*/30 * * * *'?'30':original==='0 * * * *'?'hourly':'advanced';
 const element=node('section',undefined,'schedule-picker'),frequency=selectField('Frequency','frequency',[['daily','Every day'],['weekdays','Weekdays'],['weekly','Weekly'],['monthly','Monthly'],['15','Every 15 minutes'],['30','Every 30 minutes'],['hourly','Hourly'],['advanced','Advanced — numeric cron']],mode),clock=field('Local time','local-time',daily||monthly?`${parts[1].padStart(2,'0')}:${parts[0].padStart(2,'0')}`:'08:00','time');
 const weekday=selectField('Day of week','weekday',[['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],['5','Friday'],['6','Saturday'],['0','Sunday']],mode==='weekly'?parts[4]:'1'),monthday=field('Day of month','monthday',monthly?parts[2]:'1','number'),cron=field('Five-field numeric cron','cron',original),zone=field('Timezone','timezone',schedule?.timezone??defaultZone),output=node('div');
 monthday.querySelector('input').min=1;monthday.querySelector('input').max=31;cron.querySelector('input').maxLength=128;zone.querySelector('input').maxLength=80;output.id='schedule-preview';output.setAttribute('role','status');
 const value=label=>label.querySelector('input,select').value;
 let approved=null,request=0;
 const read=()=>{const f=value(frequency),[hour,minute]=value(clock).split(':');return {cron:f==='advanced'?value(cron):f==='15'||f==='30'?`*/${f} * * * *`:f==='hourly'?'0 * * * *':`${Number(minute)} ${Number(hour)} ${f==='monthly'?value(monthday):'*'} * ${f==='weekly'?value(weekday):f==='weekdays'?'1-5':'*'}`,timezone:value(zone)};};
 const invalidate=()=>{
  approved=null;request++;output.replaceChildren(node('p','Preview the current schedule before saving.','hint'));
  const f=value(frequency);for(const [label,show] of [[clock,['daily','weekdays','weekly','monthly'].includes(f)],[weekday,f==='weekly'],[monthday,f==='monthly'],[cron,f==='advanced']]){label.hidden=!show;label.querySelector('input,select').disabled=!show;}
 };
 const previewButton=button('Preview next three runs',async()=>{
  const selectedSchedule=read(),fingerprint=JSON.stringify(selectedSchedule),version=++request;approved=null;output.replaceChildren(node('p','Loading schedule preview…','hint'));
  try{const response=await api('/v1/schedules/preview?'+new URLSearchParams(selectedSchedule));if(version!==request||!element.isConnected)return;
   if(JSON.stringify(response.schedule)!==fingerprint||!Array.isArray(response.next_times)||response.next_times.length!==3)throw new Error('Invalid schedule preview.');
   const list=node('ol');for(const at of response.next_times)list.append(node('li',`${new Date(at).toLocaleString('en-GB',{timeZone:selectedSchedule.timezone})} ${selectedSchedule.timezone} (${at})`));
   output.replaceChildren(node('p',`Calendar due times from ${response.observed_at}. Paused routines do not run; admission and runtime availability remain separate.`,'hint'),list);approved=fingerprint;
   if($('editor-error').textContent==='Preview the current schedule before saving.')$('editor-error').hidden=true;
  }catch(error){if(version===request&&element.isConnected)output.replaceChildren(node('p',error.message,'error'));}
 },'quiet');
 element.append(frequency,clock,weekday,monthday,cron,zone,node('p',`Installation default: ${defaultZone}. Existing zones are preserved. DST gaps are skipped; repeated times run once. Monthly dates absent from a month are skipped.`,'hint'));
 if(schedule&&schedule.timezone!==defaultZone)element.append(node('p',`This routine uses ${schedule.timezone}, not the installation default ${defaultZone}. Saving does not silently change it.`,'review-notice'));
 element.append(previewButton,output);element.addEventListener('input',invalidate);element.addEventListener('change',invalidate);invalidate();
 return {element,reviewed:()=>{const current=read();if(approved!==JSON.stringify(current))throw new Error('Preview the current schedule before saving.');return current;}};
}
function deleteMemory(object){
 const original=structuredClone(object),owner=selected,version=selectionVersion,identity=current(),identityRevision=identity?.revision,key=crypto.randomUUID();
 const payload={id:original.id,expected_revision:original.revision,purge_transcripts:false},affirmation=node('label',undefined,'check'),check=node('input');check.type='checkbox';check.name='confirm';check.required=true;
 affirmation.append(check,document.createTextNode('I confirm forgetting this exact memory.'));
 $('editor').classList.add('roster-editor');
 openEditor('Forget this memory',[
  node('p',original.body.text,'message-body'),
  node('p',`Memory ${original.id} · revision ${original.revision} · ${original.body.scope.kind==='global'?'Shared with all bots':`Bot ${original.body.scope.id}`}`,'hint message-body'),
  node('p','This purges current and prior canonical memory text. Queued contexts containing this memory are invalidated; cancellation is requested for active contexts. Cancellation is not confirmed, and recovery may still be required.','review-notice'),
  node('p','Past conversations and completed task copies may remain. Native transcript cleanup is not requested. Native transcripts, backups and third-party copies are not proven removed. This does not undo external actions or forget this information everywhere.','hint'),
  node('p','A lost reply may still mean deletion succeeded. Only an explicit retry sends the same deletion with the same key. If the memory changed or disappeared, close and refresh; no retry is sent automatically.','hint'),affirmation
 ],form=>{
  const latest=items('memory').find(row=>row.id===original.id),currentIdentity=current();
  if($('connection').textContent!=='Connected'||!navigator.onLine||selected!==owner||selectionVersion!==version||!identity||!currentIdentity||currentIdentity.deleted_at||currentIdentity.body.archived||currentIdentity.revision!==identityRevision||!latest||latest.deleted_at||latest.revision!==original.revision||latest.body.scope?.kind!==original.body.scope.kind||latest.body.scope?.id!==original.body.scope.id)throw new Error('Changed or offline. Close and refresh before forgetting.');
  if(form.get('confirm')!=='on')throw new Error('Confirm deletion of this exact memory.');
  $('editor-form').querySelector('button[type="submit"]').textContent='Retry same deletion';
  return command('memory.delete',payload,key);
 },'Forget memory');
}
function editMemory(object){
 const owner=selected,version=selectionVersion,persona=items('persona').find(row=>row.id===owner),original=object?structuredClone(object):null;
 const source=original?original.body.source_event_id:events.findLast(x=>x.type==='message.user'&&x.conversation_id===owner)?.id;
 if(!source){report('Send a message with the preference first, then save it as memory.');return;}
 const id=original?.id??crypto.randomUUID(),key=crypto.randomUUID(),text=field('Preference or fact','text',original?.body.text??'','textarea'),scope=selectField('Share with','scope',[['global','All bots'],['persona','This bot']],original?.body.scope.kind??'global');
 text.querySelector('textarea').maxLength=16000;
 let submitted=null;
 openEditor(original?'Edit memory':'Remember a preference',[text,scope,node('p',original?`Preserved: ${original.body.sensitivity} sensitivity; expiry ${original.body.expires_at??'none'}; original source. Only text and sharing can change here.`:'New memories use ordinary sensitivity and no expiry. The source is a message in this conversation.','hint'),node('p','A lost reply may still mean the save succeeded. Retry sends the same save; close and refresh before making further changes.','hint')],form=>{
  const latest=items('memory').find(row=>row.id===id),currentPersona=items('persona').find(row=>row.id===owner);
  if($('connection').textContent!=='Connected'||!navigator.onLine||selected!==owner||selectionVersion!==version||!persona||!currentPersona||currentPersona.body.archived||currentPersona.revision!==persona.revision||original&&(latest?.revision!==original.revision||latest?.body.scope.kind!==original.body.scope.kind||latest?.body.scope.id!==original.body.scope.id))throw new Error('Memory or bot status is stale, changed, or offline. Close this editor and review the current memory before saving.');
  if(!submitted){
   const kind=form.get('scope');
   if(!['global','persona'].includes(kind))throw new Error('Choose All bots or This bot.');
   submitted={id,expected_revision:original?.revision??0,scope:{kind,id:kind==='global'?null:owner},text:form.get('text'),source_event_id:source,expires_at:original?.body.expires_at??null,sensitivity:original?.body.sensitivity??'ordinary'};
   text.querySelector('textarea').readOnly=true;scope.querySelector('select').disabled=true;
   $('editor-form').querySelector('button[type="submit"]').textContent='Retry same save';
  }
  return command('memory.put',submitted,key);
 });
}
$('add-bot').onclick=()=>editBot();$('edit-bot').onclick=()=>editBot(current());$('add-routine').onclick=()=>editRoutine();$('add-memory').onclick=()=>editMemory();
$('add-room').onclick=()=>{const bots=items('persona').filter(x=>!x.body.archived);const fields=[field('Room name','name'),selectField('Default responder','responder',bots.map(x=>[x.id,x.body.name]),bots[0]?.id)];for(const bot of bots){const l=node('label',undefined,'check');const c=node('input');c.type='checkbox';c.name='members';c.value=bot.id;c.checked=true;l.append(c,document.createTextNode(bot.body.name));fields.push(l);}openEditor('New room',fields,form=>command('room.put',{id:crypto.randomUUID(),expected_revision:0,name:form.get('name'),member_ids:form.getAll('members'),default_responder_id:form.get('responder')}));};
// ARCHITECTURE_V2 A9: the paired Mac node card (owner routes /v1/nodes*).
let macView=null,macRevokeArmed=false;
function renderMac(){
 const list=$('mac-status');if(!list)return;
 const row=(label,value)=>{const d=node('div');d.append(node('dt',label),node('dd',value));return d;};
 const when=value=>value?new Date(value).toLocaleString():'never';
 const m=macView;
 if(!m)list.replaceChildren(row('Status','Not loaded'));
 else if(m.error)list.replaceChildren(row('Status',m.error));
 else list.replaceChildren(row('Paired',m.paired?`${m.node.name} (since ${when(m.node.paired_at)})`:'No'),row('Online',m.paired?(m.online?'Yes':'No'):'—'),
  row('Last seen',m.paired?when(m.node.last_seen_at):'—'),row('Queued requests',String((m.queued??0)+(m.delivered??0))),
  ...(m.paired&&m.node.capabilities?.length?[row('Capabilities',m.node.capabilities.join(', '))]:[]));
 $('revoke-mac').hidden=!m?.paired;$('revoke-mac').textContent=macRevokeArmed?'Confirm revoke':'Revoke';
}
async function loadMac(){try{macView=await api('/v1/nodes',{cache:'no-store'});}catch(error){macView={error:error.message};}renderMac();}
$('refresh-mac').onclick=()=>loadMac();
$('pair-mac').onclick=async()=>{
 const status=$('mac-pairing');
 try{
  const pairing=await api('/v1/nodes/pair',{method:'POST'});
  status.textContent=`Pairing code ${pairing.code} (one use, expires ${new Date(pairing.expires_at).toLocaleTimeString()}). On the Mac run: node mac-node/mac-node.mjs pair --origin ${location.origin} --code ${pairing.code}`;
 }catch(error){status.textContent=error.message;}
 loadMac();
};
$('revoke-mac').onclick=async()=>{
 if(!macRevokeArmed){macRevokeArmed=true;renderMac();setTimeout(()=>{macRevokeArmed=false;renderMac();},5000);return;}
 macRevokeArmed=false;
 try{await api('/v1/nodes/revoke',{method:'POST'});$('mac-pairing').textContent='Mac revoked. Its token no longer works; waiting requests expire by their deadline.';}catch(error){$('mac-pairing').textContent=error.message;}
 loadMac();
};
/** Native shell notification bridge (macos/ HehebotPortal): only present inside
 * the Mac app's WKWebView, which accepts {title,body} from the portal origin. */
function notifyNative(events){
 const bridge=window.webkit?.messageHandlers?.hehebotNotify;
 if(!bridge||(!document.hidden&&document.hasFocus()))return;
 for(const event of events.filter(e=>e?.type==='bot.message'&&typeof e.payload?.text==='string').slice(-3)){
  const persona=items('persona').find(x=>x.id===event.conversation_id);
  try{bridge.postMessage({title:persona?.body?.name??'Hehebot',body:event.payload.text.slice(0,240)});}catch{}
 }
}
$('show-details').onclick=()=>{$('details').classList.add('open');loadMac();};$('close-details').onclick=()=>$('details').classList.remove('open');$('refresh').onclick=()=>refresh(true);
$('show-skills').onclick=()=>choose('skills');
 $('show-connectors').onclick=()=>choose('connectors');
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
// --- V6 streamed timeline, portal client (ARCHITECTURE_V2 A6) ---------------
// Primary transport is a same-origin WebSocket at /v1/stream. It is only ever
// opened while the page is visible, never wakes or infers anything by
// itself, and any close/error backs off (1,2,4…30s) and reconnects. While it
// is not open, a slower visibility-gated poll (not the old fixed 5s) is the
// fallback; a 404/426 on the upgrade (the feature not deployed) is
// indistinguishable from a transient failure in the browser WebSocket API,
// so it is handled the same way — capped backoff, with fallback polling
// covering the gap the whole time.
let wsSocket=null,wsReconnectDelay=1000,wsReconnectTimer=null,wsCursor=null,wsPingTimer=null,streamActive=false;
// Stream frames append timeline events immediately; task cards, notices and
// runtime state still come from /v1/state, so any frame schedules one
// debounced snapshot refresh instead of relying on the fallback poll.
let streamRefreshTimer=null;
function scheduleStreamRefresh(){if(streamRefreshTimer)return;streamRefreshTimer=setTimeout(()=>{streamRefreshTimer=null;refresh();},400);}
function stopStream(){
 streamActive=false;
 if(wsPingTimer){clearInterval(wsPingTimer);wsPingTimer=null;}
 if(wsSocket){try{wsSocket.onclose=null;wsSocket.close();}catch{}wsSocket=null;}
}
function scheduleStreamReconnect(){
 if(wsReconnectTimer)return;
 wsReconnectTimer=setTimeout(()=>{wsReconnectTimer=null;if(document.visibilityState==='visible')connectStream();},wsReconnectDelay);
 wsReconnectDelay=Math.min(30000,wsReconnectDelay*2);
}
function connectStream(){
 if(document.visibilityState!=='visible'||wsSocket)return;
 let socket;
 try{socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/v1/stream');}catch{scheduleStreamReconnect();return;}
 wsSocket=socket;
 socket.onopen=()=>{
  wsReconnectDelay=1000;streamActive=true;
  try{socket.send(JSON.stringify({type:'subscribe',cursor:wsCursor}));}catch{}
  if(wsPingTimer)clearInterval(wsPingTimer);
  wsPingTimer=setInterval(()=>{try{socket.send('ping');}catch{}},25000);
 };
 socket.onmessage=event=>{
  let frame;try{frame=JSON.parse(event.data);}catch{return;} // "pong" and other non-JSON frames are ignored.
  if(!frame||typeof frame!=='object')return;
  if(frame.type==='events'&&Array.isArray(frame.events)){
   if(Number.isFinite(frame.cursor))wsCursor=frame.cursor;
   notifyNative(frame.events);
   const relevant=frame.events.filter(e=>e&&e.conversation_id===selected);
   if(relevant.length){
    const combined=[...events,...relevant];
    events=[...new Map(combined.map(e=>[e.sequence,e])).values()].sort((a,b)=>a.sequence-b.sequence);
    reconcileOutboxEchoes(selected,relevant);lastSignature='';render();
   }
   if(frame.events.length)scheduleStreamRefresh();
  }else if(frame.type==='snapshot_required'){
   // A full resync is required; refresh() reseeds wsCursor from the
   // snapshot's next_cursor before resubscribing.
   wsCursor=null;refresh(true).then(()=>{try{socket.send(JSON.stringify({type:'subscribe',cursor:wsCursor}));}catch{}});
  }
  else if(frame.type==='runtime')scheduleStreamRefresh();
  // "live" frames are presentation-only observations with no committed state
  // of their own; they are not required to show a reply.
 };
 socket.onerror=()=>{};
 socket.onclose=()=>{streamActive=false;if(wsPingTimer){clearInterval(wsPingTimer);wsPingTimer=null;}wsSocket=null;scheduleStreamReconnect();};
}
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)stopStream();
 else{wsReconnectDelay=1000;connectStream();refresh(true);}
});
installImportSetup({trigger:$('import-setup'),api,command,onAdopted:()=>refresh(true)});
setInterval(()=>{if(alphaSeen)renderAlphaSession();},250);
document.addEventListener('visibilitychange',()=>{if(alphaSeen)renderAlphaSession();});
await refresh(true);if(selected==='connectors')loadConnectorCatalog();if(selected)$('message').value=localStorage.getItem('personal.draft.'+selected)??'';
await outboxReconcileOnLoad();
// Fallback polling only: never while hidden, never while the stream is open.
// 15s replaces the old fixed 5s full refresh (ARCHITECTURE_V2 A6).
setInterval(()=>{if(!streamActive&&!document.hidden)refresh();},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true);});
if(!document.hidden)connectStream();

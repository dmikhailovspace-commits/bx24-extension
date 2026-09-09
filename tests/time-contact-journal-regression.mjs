import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const model = require('../extension/native-time-control.js');
const source = fs.readFileSync(process.env.PENA_CONTACT_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
function extract(name) {
 const begin = source.indexOf(`\n\tfunction ${name}(`) >= 0 ? source.indexOf(`\n\tfunction ${name}(`) : source.indexOf(`\n\tasync function ${name}(`);
 if (begin < 0) return '';
 const tail = source.slice(begin + 1); const next = tail.slice(1).search(/\n\t(?:async )?function /);
 return next < 0 ? tail : tail.slice(0, next + 1);
}
const names = ['_pauseDialogTimeDurationForPanel','_isDialogTimeSystemMessage','_readDialogTimeVisits','_getDialogTimeMessageContactIdentity','_getDialogTimePendingQualificationMs','_syncDialogTimePendingLease','_qualifyPendingDialogTimeDuration','_stageDialogTimeActivity','_flushDialogTimePendingActivities','_getDialogTimeContactDateKey','_queueDialogTimeContactEvent','_journalDialogTimeContactEvents','_readDialogTimeContactEvents','_commitDialogTimeContactEvent','_reportDialogTimeContactError','_writeDialogTimeVisits'];
function createLocks(){let tail=Promise.resolve();return{request(_name,callback){const next=tail.then(callback);tail=next.catch(()=>{});return next;}};}
function frame({ storage = new Map(), locks = createLocks(), id = 'frame1' } = {}) {
 let now = Date.parse('2026-09-06T20:59:00Z'), user = '7', resolver, delay = false, failWrite = false, failAck = false, eligibility = true, portalOffset = 180, portalFail = false, portalCalls = 0;
 const writes = [], warnings = [], invalidations = [];
 writes.invalidations = invalidations;
 const localStorage = { get length(){ return storage.size; }, key(i){ return [...storage.keys()][i] ?? null; }, getItem:k=>storage.get(k)??null,
 setItem(k,v){ if(failWrite) throw Error('quota'); storage.set(k,String(v)); }, removeItem(k){ if(failAck) throw Error('ack failure');storage.delete(k); } };
 const ctx = vm.createContext({ window:{}, navigator:{locks}, console:{warn:(...x)=>warnings.push(x)}, Date:class extends Date { static now(){ return now; } }, Map, Set, Promise, JSON, Number, String, Math, Array,
 localStorage, setTimeout:()=>1, clearTimeout:()=>{}, _PENA_TIME_CONTROL:model,
 _PENA_TIME_VISITS_KEY:'pena.timeVisitedTasks.v1', _PENA_TIME_CONTACT_OUTBOX_KEY:'pena.timeContactOutbox.v1',
 _dialogTimePortalUtcOffsetMinutes:180, _dialogTimeFrameId:id, _dialogTimeTaskTitles:new Map(),
 _getCurrentBitrixUserId:()=>user, _ensureCurrentBitrixUserId:async()=>user,
 _getDialogTimeTodayKey:()=>new Date(now+180*60000).toISOString().slice(0,10),
 _getDialogTimeCalendarZone:()=>({utcOffsetMinutes:ctx._dialogTimePortalUtcOffsetMinutes}),
 _getDialogTimeScopedStorageKey:(prefix,date='')=>`${prefix}.${user}${date?'.'+date:''}`,
 _isDialogTimeLocalCoordinator:()=>true, _isDialogTimeFrameActive:()=>true,
 _getActiveDialogTimeActivity:()=>({taskId:'101'}), normId:x=>String(x||''),
 _getFreshDialogTimeTaskEligibility:()=>true,
 _ensureDialogTimeTaskEligibility:()=>delay?new Promise(r=>{resolver=r;}):Promise.resolve(eligibility),
 _ensureDialogTimePortalDate:async()=>{portalCalls++;if(portalFail)throw Error('offline');ctx._dialogTimePortalUtcOffsetMinutes=portalOffset;return '';},
 _scheduleDialogTimeDeferredFlush:()=>{}, _queueDialogTimeUiSync:()=>{},
 _invalidateDialogTimeTaskSnapshot:id=>invalidations.push(id),
 _getDialogTimeTaskTitle:(id,title)=>title, _isDialogTimePlaceholderTaskTitle:()=>false,
 _claimDialogTimeActivityLease:(activityId)=>{storage.set('lease',JSON.stringify({frameId:id,activityId}));return true;},
 _readDialogTimeActivityLease:()=>JSON.parse(storage.get('lease')||'null'),
 _releaseDialogTimeActivityLease:()=>{},
 _persistDialogTimeActivity:(entry,opts)=>{writes.push({taskId:entry.taskId,qualify:opts.qualify,at:now});return true;},
 _removeDialogTimeActivity:()=>{}
 });
 vm.runInContext(`const _dialogTimePendingActivities=new Map(); const _dialogTimeContactEvents=new Map(); let _dialogTimeContactEventSequence=0; let _dialogTimeContactJournalTimer=null; let _dialogTimeContactRetryAttempt=0; let _dialogTimeContactLastError=''; let _dialogTimeContactRecoveryScope=''; let _dialogTimeLeaseHeartbeatTimer=null; let _dialogTimePendingActiveId=''; let _dialogTimeQualificationTimer=null; let _dialogTimeDeferredFlushPromise=null; let _dialogControlNativeWorkspaceTab=''; ${names.map(extract).join('\n')}\n globalThis.probe={stage:_stageDialogTimeActivity,flush:_flushDialogTimePendingActivities,pending:_dialogTimePendingActivities, events:_dialogTimeContactEvents,write:_writeDialogTimeVisits,qualify:_qualifyPendingDialogTimeDuration,messageIdentity:_getDialogTimeMessageContactIdentity,panel:open=>{if(open)_pauseDialogTimeDurationForPanel();_dialogControlNativeWorkspaceTab=open?'time':'';}};`,ctx);
 return { ...ctx.probe, storage,writes,warnings,titles:ctx._dialogTimeTaskTitles, tick:ms=>{now+=ms;}, setUser:id=>{user=id;}, eligibility:value=>{eligibility=value;}, delay:()=>{delay=true;}, resolve:()=>{delay=false;resolver?.(eligibility);}, failWrite:value=>{failWrite=value;},failAck:value=>{failAck=value;}, unknownPortal:(offset,fail=false)=>{ctx._dialogTimePortalUtcOffsetMinutes=null;portalOffset=offset;portalFail=fail;},portalCalls:()=>portalCalls, total:()=>[...storage].filter(([k])=>k.startsWith('pena.timeVisitedTasks.v1.')).flatMap(([,v])=>JSON.parse(v)).reduce((n,x)=>n+x.visits,0) };
}
const scenarios = [];
await check('time panel pauses task duration during backdated bookkeeping and preserves real outgoing messages',async()=>{
 const f=frame();f.tick(-120000);f.stage({taskId:'101'});f.tick(20000);f.panel(true);
 f.tick(180000);assert.equal(f.qualify(f.pending.get('task:101')),false);await f.flush();assert.equal(f.total(),0);
 assert.equal(f.stage({taskId:'102'}),false,'searching bookkeeping tasks cannot open contact sessions');
 f.stage({taskId:'102'},{qualify:true});await f.flush();assert.equal(f.total(),1,'real outgoing message remains a contact while time panel is open');
 f.panel(false);f.stage({taskId:'101'});f.tick(61000);assert.equal(f.qualify(f.pending.get('task:101')),false);await f.flush();assert.equal(f.total(),1);
 return{panelDurationContacts:0,messageDuringPanel:1,resumedTaskVisit:0};
});
await check('pausing a short visit preserves only its pre-panel visible duration',async()=>{
 const f=frame();f.tick(-120000);f.stage({taskId:'101'});f.tick(20000);f.panel(true);f.tick(120000);f.panel(false);f.stage({taskId:'101'});
 f.tick(39000);assert.equal(f.qualify(f.pending.get('task:101')),false);f.tick(1000);assert.equal(f.qualify(f.pending.get('task:101')),false);await f.flush();
 assert.equal(f.total(),0);return{visibleBeforePanel:20,hiddenInPanel:120,visibleAfterPanel:40,contacts:0};
});
await check('structured system notifications from the employee cannot qualify a contact; real time-related text and attachments can',()=>{
 const start=source.indexOf('const captureOutgoingTaskMessage = (...eventArgs) => {');
 const end=source.indexOf("BXNS.addCustomEvent('onPullEvent-im', captureOutgoingTaskMessage);",start);
 const contacts=[];let metaReads=0;
 const ctx=vm.createContext({Date,Map,String,Number,Array,normId:x=>String(x||''),_isDialogTimeFrameActive:()=>true,_currentPanelMode:'tasks',_getCurrentBitrixUserId:()=> '7',_dialogTimeOutgoingIntentAt:Date.now(),_dialogTimeOutgoingPullSeen:new Map(),
  _getDialogRecentMeta:()=>{metaReads++;return{taskId:'101',isTask:true}},_getActiveDialogTimeActivity:()=>({taskId:'101',dialogId:'chat101'}),_dialogTimePendingActivities:new Map(),_dialogTimeTaskIdsByChatDialogId:new Map([['chat101','101']]),_dialogTimeTaskTitles:new Map(),_rememberDialogTimeTaskChat:()=>{},_rememberTaskChatDialogVisit:(dialogId,title,taskId,options)=>contacts.push({taskId,...options})});
 vm.runInContext(extract('_isDialogTimeSystemMessage')+extract('_getDialogTimeMessageContactIdentity')+source.slice(start,end)+'\nglobalThis.capture=captureOutgoingTaskMessage;',ctx);
 let id=900;const emit=(extra={},outer={})=>ctx.capture('messageAdd',{...outer,message:{id:String(++id),author_id:'7',dialog_id:'chat101',...extra}});
 for(const system of [{system:true},{SYSTEM:'Y'},{isSystem:1},{is_system:'true'},{params:{SYSTEM:['Y']}},{PARAMS:{CLASS:'bx-messenger-content-item-system'}},{params:{componentId:'SystemMessage'}}])emit(system);
 emit({}, {SYSTEM:'Y'});emit({}, {PARAMS:{IS_SYSTEM:true}});
 assert.equal(contacts.length,0);assert.equal(metaReads,0,'system events do not even resolve tasks or schedule eligibility work');
 emit({system:false,text:'Я добавил 30 минут за позавчера'});
 emit({SYSTEM:'N',params:{FILE_ID:['51']}});
 emit({params:{COMPONENT_ID:'CustomUserCard'},text:'Проверь вложение'});
 assert.equal(contacts.length,3);return{systemEventsIgnored:9,realMessages:3,systemMetadataReads:0};
});
await check('task messages with a proven mapping qualify while the main list shows Chats; ordinary and incoming messages do not',()=>{
 const start=source.indexOf('const captureOutgoingTaskMessage = (...eventArgs) => {');
 const end=source.indexOf("BXNS.addCustomEvent('onPullEvent-im', captureOutgoingTaskMessage);",start);
 const contacts=[];let coordinator=true;
 const ctx=vm.createContext({Date,Map,String,Number,Array,normId:x=>String(x||''),_isDialogTimeFrameActive:()=>coordinator,_currentPanelMode:'chats',_getCurrentBitrixUserId:()=> '7',_dialogTimeOutgoingIntentAt:Date.now(),_dialogTimeOutgoingPullSeen:new Map(),
  _getDialogRecentMeta:()=>null,_getActiveDialogTimeActivity:()=>null,_dialogTimePendingActivities:new Map(),_dialogTimeTaskIdsByChatDialogId:new Map([['chat101','101']]),_dialogTimeTaskTitles:new Map(),_rememberDialogTimeTaskChat:()=>{},_rememberTaskChatDialogVisit:(dialogId,title,taskId,options)=>contacts.push({taskId,...options}),
  _getDialogControlItemsForMode:()=>[],findChatElementById:()=>null,_extractTaskIdFromTaskUrl:()=>'',_isDialogControlFolder:()=>false});
 vm.runInContext(extract('_isDialogTimeSystemMessage')+extract('_getDialogTimeMessageContactIdentity')+source.slice(start,end)+'\nglobalThis.capture=captureOutgoingTaskMessage;',ctx);
 let id=1000;const emit=(extra={})=>ctx.capture('messageAdd',{message:{id:String(++id),author_id:'7',dialog_id:'chat101',...extra}});
 emit();emit({author_id:'8'});emit({dialog_id:'chat909'});emit({system:true});coordinator=false;emit();
 assert.equal(contacts.length,1);assert.equal(contacts[0].taskId,'101');assert.equal(contacts[0].qualify,true);
 return{mappedTaskMessages:1,ordinaryChats:0,incomingMessages:0,systemMessages:0,foreignFrameMessages:0};
});
await check('replayed message after ACK and frame reload retains one durable contact; new message remains pending',async()=>{
 const f=frame(),day='2026-09-06',at=Date.parse('2026-09-06T20:59:00Z');
 const identity=f.messageIdentity({date:at/1000},{},'chat101','501',at);
 f.stage({taskId:'101',dialogId:'chat101'},{qualify:true,...identity});await f.flush();
 await f.write(rows=>model.markActivityAccounted(rows,'task:101',at+10000,{itemId:'901'}),day);
 const reloaded=frame({storage:f.storage,id:'reloaded'});reloaded.tick(40000);
 const replay=reloaded.messageIdentity({date:at/1000},{},'chat101','501',at+40000);
 reloaded.stage({taskId:'101',dialogId:'chat101'},{qualify:true,...replay});await reloaded.flush();
 let rows=JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.'+day));
 assert.equal(rows[0].visits,1);assert.equal(model.selectUntrackedVisits(rows).length,0);
 reloaded.stage({taskId:'101',dialogId:'chat101'},{qualify:true,...reloaded.messageIdentity({date:(at+40000)/1000},{},'chat101','502',at+40000)});await reloaded.flush();
 rows=JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.'+day));
 assert.equal(rows[0].visits,2);assert.equal(model.selectUntrackedVisits(rows)[0].pendingContacts,1);
 return{replayAfterReloadAdded:0,newMessageAdded:1};
});
await check('late first delivery uses original send time across accounting cutoff and midnight',async()=>{
 const f=frame(),day='2026-09-06',at=Date.parse('2026-09-06T20:59:00Z');
 await f.write(rows=>model.markActivityAccounted(rows,'task:101',at+10000,{itemId:'902'}),day);f.tick(120000);
 const identity=f.messageIdentity({date:'2026-09-06T23:59:00+03:00'},{},'chat101','503',at+120000);
 f.stage({taskId:'101',dialogId:'chat101'},{qualify:true,...identity});await f.flush();
 const rows=JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.'+day));
 assert.equal(rows[0].lastQualifiedAt,at);assert.equal(model.selectUntrackedVisits(rows).length,0);
 assert.equal(f.storage.has('pena.timeVisitedTasks.v1.7.2026-09-07'),false);
 return{capturedDay:day,pendingContacts:0};
});
await check('saving the open unqualified session prevents a later phantom duration contact but permits a new message',async()=>{
 const f=frame(),day='2026-09-06',at=Date.parse('2026-09-06T20:59:00Z')-120000;f.tick(-120000);
 f.stage({taskId:'101'});f.tick(10000);
 await f.write(rows=>model.markActivityAccounted(rows,'task:101',at+10000,{itemId:'903'}),day);
 f.tick(60000);assert.equal(f.qualify(f.pending.get('task:101')),false);await f.flush();
 let rows=JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.'+day));assert.equal(model.selectUntrackedVisits(rows).length,0);
 f.stage({taskId:'101'},{qualify:true});await f.flush();rows=JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.'+day));
 assert.equal(model.selectUntrackedVisits(rows)[0].pendingContacts,1);
 return{phantomDurationContacts:0,newMessageContacts:1};
});
await check('new qualified contact invalidates once; durable replay and 15s dedupe do not',async()=>{const f=frame();f.stage({taskId:'101'},{qualify:true});f.failAck(true);await f.flush();assert.deepEqual(f.writes.invalidations,['101']);await f.flush();assert.deepEqual(f.writes.invalidations,['101']);f.failAck(false);f.tick(1000);f.stage({taskId:'101'},{qualify:true});await f.flush();assert.deepEqual(f.writes.invalidations,['101']);f.tick(20000);f.stage({taskId:'101'},{qualify:true});await f.flush();assert.deepEqual(f.writes.invalidations,['101','101']);return{qualifiedContacts:2,invalidations:2,replayAndDedupInvalidations:0};});
await check('two frame accounting receipts and later contact preserve immutable pending watermark',async()=>{const storage=new Map(),locks=createLocks(),a=frame({storage,locks,id:'A'}),b=frame({storage,locks,id:'B'});const day='2026-09-06',at=Date.parse('2026-09-06T20:59:00Z');a.stage({taskId:'101'},{qualify:true});await a.flush();a.tick(40000);a.stage({taskId:'101'},{qualify:true});await Promise.all([a.flush(),b.write(rows=>model.markActivityAccounted(rows,'task:101',at+10000,{itemId:'501'}),day)]);await a.write(rows=>model.markActivityAccounted(rows,'task:101',at+60000,{itemId:'501'}),day);const rows=JSON.parse(storage.get('pena.timeVisitedTasks.v1.7.'+day));assert.equal(rows[0].visits,2);assert.equal(rows[0].accountedEntries[0].cutoffAt,at+10000);assert.equal(model.selectUntrackedVisits(rows)[0].pendingContacts,1);return{frames:2,contacts:2,pendingContacts:1,duplicateAckAdvanced:false};});
async function check(name, run){ try{const detail=await run();scenarios.push({name,status:'PASS',detail});}catch(e){scenarios.push({name,status:'FAIL',error:e.message});} }
await check('qualified A→B→A survives replacement',async()=>{const f=frame();f.stage({taskId:'101'},{qualify:true});f.stage({taskId:'102'});f.stage({taskId:'101'});await f.flush();assert.equal(f.total() || f.writes.filter(x=>x.qualify).length,1);return {contacts:f.total()};});
await check('message while eligibility awaits is a separate immutable event',async()=>{const f=frame();f.stage({taskId:'101'},{qualify:true});f.delay();const pending=f.flush();await Promise.resolve();f.tick(20000);f.stage({taskId:'101'},{qualify:true});f.resolve();await pending;await f.flush();assert.equal(f.total()||f.writes.filter(x=>x.qualify).length,2);return {contacts:f.total()};});
await check('daily ledger retains 41+ tasks',()=>{const rows=model.mergeVisitedTasks(Array.from({length:65},(_,i)=>({taskId:String(i+1),visits:1,visitedAt:100+i,lastQualifiedAt:100+i})));assert.equal(rows.length,65);return{tasks:rows.length};});
await check('midnight and offline replay keep captured day and qualification time',async()=>{const f=frame();f.stage({taskId:'101'},{qualify:true});f.eligibility(null);await f.flush();f.tick(120000);f.eligibility(true);await f.flush();const row=JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.2026-09-06'))[0];assert.equal(row.lastQualifiedAt,Date.parse('2026-09-06T20:59:00Z'));assert.equal(f.total(),1);return{day:'2026-09-06',qualifiedAt:row.lastQualifiedAt};});
await check('user swap during REST cannot write into either wrong namespace',async()=>{const f=frame();f.stage({taskId:'101'},{qualify:true});f.delay();const p=f.flush();await Promise.resolve();f.setUser('8');f.resolve();await p;assert.equal(f.total(),0);assert.equal([...f.storage.keys()].filter(x=>x.startsWith('pena.timeContactOutbox.v1.7')).length,1);f.setUser('7');await f.flush();assert.equal(f.total(),1);return{contacts:f.total()};});
await check('journal write failure retains event in memory and retries',async()=>{const f=frame();f.stage({taskId:'101'},{qualify:true});f.failWrite(true);await f.flush();assert.equal(f.events.size,1);assert.equal(f.total(),0);f.failWrite(false);await f.flush();assert.equal(f.events.size,0);assert.equal(f.total(),1);return{diagnostics:f.warnings.length};});
await check('ledger write followed by failed ack reloads without duplicate',async()=>{const f=frame();f.stage({taskId:'101'},{qualify:true});f.failAck(true);await f.flush();assert.equal(f.total(),1);const reloaded=frame({storage:f.storage});await reloaded.flush();assert.equal(reloaded.total(),1);assert.equal([...f.storage.keys()].filter(x=>x.startsWith('pena.timeContactOutbox')).length,0);return{contacts:reloaded.total()};});
await check('two frames commit different events to one day with shared lock',async()=>{const storage=new Map(),locks=createLocks(),a=frame({storage,locks,id:'A'}),b=frame({storage,locks,id:'B'});a.stage({taskId:'101'},{qualify:true});b.stage({taskId:'102'},{qualify:true});await Promise.all([a.flush(),b.flush()]);assert.equal(a.total(),2);return{contacts:a.total(),rows:JSON.parse(storage.get('pena.timeVisitedTasks.v1.7.2026-09-06')).length};});
await check('65 qualified tasks survive bounded batches and reload',async()=>{const f=frame();for(let i=1;i<=65;i++) f.stage({taskId:String(i)},{qualify:true});for(let i=0;i<4;i++) await f.flush();assert.equal(f.total(),65);assert.equal(f.pending.size,1);return{contacts:f.total(),sessions:f.pending.size};});
await check('out-of-order events preserve deterministic 15 second dedupe and IDs',()=>{const events=[0,10000,20000].map((delta,i)=>({taskId:'1',eventId:String(i),qualifiedAt:100000+delta,reason:'message'}));let a=[],b=[];for(const event of events)a=model.applyQualifiedContact(a,event);for(const event of [events[1],events[2],events[0]])b=model.applyQualifiedContact(b,event);assert.equal(a[0].visits,2);assert.equal(b[0].visits,2);assert.equal(b[0].contactEvents.length,3);assert.equal(model.applyQualifiedContact(b,events[0])[0].visits,2);return{visits:a[0].visits,eventIds:b[0].contactEvents.length};});
await check('stale ordinary writer cannot erase an acknowledged contact or inflate its count',async()=>{const f=frame();const key='pena.timeVisitedTasks.v1.7.2026-09-06';f.storage.set(key,JSON.stringify([{taskId:'10',visits:1,lastQualifiedAt:1000}]));const stale=JSON.parse(f.storage.get(key));f.stage({taskId:'101'},{qualify:true});await f.flush();assert.equal(await f.write(model.markActivityAccounted(stale,'task:10',30000),'2026-09-06'),true);assert.equal(f.total(),2);const inflated=JSON.parse(f.storage.get(key));inflated.find(row=>row.taskId==='101').visits=500;await f.write(inflated,'2026-09-06');assert.equal(f.total(),2);assert.equal(JSON.parse(f.storage.get(key)).find(row=>row.taskId==='10').accountedAt,30000);return{contacts:f.total(),metadataPreserved:true};});
await check('event commit preserves intervening accounting metadata and active foreign lease',async()=>{const f=frame();f.stage({taskId:'101'},{qualify:true});await f.flush();f.tick(20000);f.stage({taskId:'101'},{qualify:true});f.delay();const p=f.flush();await Promise.resolve();await f.write(rows=>model.markActivityAccounted(rows,'task:101',40000),'2026-09-06');const lease=JSON.stringify({frameId:'B',activityId:'task:999',heartbeatAt:123});f.storage.set('lease',lease);f.resolve();await p;assert.equal(f.total(),2);assert.equal(f.storage.get('lease'),lease);assert.equal(JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.2026-09-06'))[0].accountedAt,40000);return{contacts:f.total(),foreignLeaseUnchanged:true};});
await check('queued session writer checks the lease revision inside the storage lock',async()=>{const locks=createLocks(),f=frame({locks});let release;const blocked=locks.request('x',()=>new Promise(r=>{release=r;}));await Promise.resolve();const lease={frameId:'frame1',activityId:'task:101',heartbeatAt:10};f.storage.set('lease',JSON.stringify(lease));const pending=f.write([{taskId:'101',visits:1}],'2026-09-06',{lease});f.storage.set('lease',JSON.stringify({...lease,heartbeatAt:11}));release();await blocked;assert.equal(await pending,false);assert.equal(f.total(),0);return{staleWrites:0};});
await check('unknown portal timezone: pre-midnight qualification survives next-day resolution',async()=>{const f=frame();f.tick(8*3600000);f.unknownPortal(-300,true);f.stage({taskId:'101'},{qualify:true});await f.flush();assert.equal(f.total(),0);const pending=JSON.parse([...f.storage].find(([k])=>k.startsWith('pena.timeContactOutbox'))[1]);assert.equal(pending.datePending,true);assert.equal(pending.dateKey,'');f.tick(120000);f.unknownPortal(-300);await f.flush();assert.equal(JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.2026-09-06'))[0].visits,1);f.stage({taskId:'102'},{qualify:true});await f.flush();assert.equal(JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.2026-09-07'))[0].visits,1);return{beforeMidnight:'2026-09-06',afterMidnight:'2026-09-07',portalCalls:f.portalCalls()};});
await check('unresolved date failure is one request per bounded flush, never per event',async()=>{const f=frame();f.unknownPortal(-300,true);for(let i=0;i<20;i++)f.stage({taskId:String(400+i)},{qualify:true});await f.flush();assert.equal(f.portalCalls(),1);assert.equal(f.total(),0);assert.equal([...f.storage.keys()].filter(x=>x.startsWith('pena.timeContactOutbox')).length,20);return{events:20,serverTimeCalls:f.portalCalls()};});
await check('confirmed title for the event task replaces an unrelated side-panel caption before commit',async()=>{const f=frame();f.stage({taskId:'5',dialogId:'chat5',title:'Задача 405'},{qualify:true});f.delay();const pending=f.flush();await Promise.resolve();f.titles.set('405','Задача 405');f.titles.set('5','Задача 5');f.resolve();await pending;const row=JSON.parse(f.storage.get('pena.timeVisitedTasks.v1.7.2026-09-06'))[0];assert.equal(row.taskId,'5');assert.equal(row.title,'Задача 5');return{taskId:row.taskId,title:row.title};});
await check('foreign side panel cannot suppress native task lookup for an outgoing dialog',()=>{
 const start=source.indexOf('const captureOutgoingTaskMessage = (...eventArgs) => {');const end=source.indexOf("BXNS.addCustomEvent('onPullEvent-im', captureOutgoingTaskMessage);",start);assert.ok(start>=0&&end>start);
 let reads=0,contact=null;const context=vm.createContext({Date,Map,String,Number,normId:x=>String(x||''),_isDialogTimeFrameActive:()=>true,_currentPanelMode:'tasks',_getCurrentBitrixUserId:()=> '7',_dialogTimeOutgoingIntentAt:0,_dialogTimeOutgoingPullSeen:new Map(),_getDialogRecentMeta:()=>null,
  _getActiveDialogTimeActivity:()=>({taskId:'405',dialogId:'chat405',title:'Задача 405'}),_dialogTimePendingActivities:new Map(),_dialogTimeTaskIdsByChatDialogId:new Map(),_dialogTimeTaskTitles:new Map([['5','Задача 5']]),
  _getDialogControlItemsForMode:()=>{reads++;return[{id:'chat5',taskId:'5',title:'Чат 5'}]},_isDialogControlFolder:()=>false,_rememberDialogTimeTaskChat:()=>{},_rememberTaskChatDialogVisit:(dialogId,title,taskId)=>{contact={dialogId,title,taskId}}});
 vm.runInContext(extract('_isDialogTimeSystemMessage')+extract('_getDialogTimeMessageContactIdentity')+source.slice(start,end)+"\ncaptureOutgoingTaskMessage('message',{message:{author_id:'7',dialog_id:'chat5',id:'msg-contact-title'}});",context);
 assert.equal(reads,1);assert.deepEqual(contact,{dialogId:'chat5',taskId:'5',title:'Задача 5'});return{nativeTaskLookups:reads,contact};
});
await check('legacy ledger taskId/id aliases persist as one canonical row without losing accounting metadata',async()=>{
 const f=frame(),day='2026-09-06',key='pena.timeVisitedTasks.v1.7.'+day,at=Date.parse('2026-09-06T20:59:00Z');
 f.storage.set(key,JSON.stringify([
  {taskId:'00101',visitedAt:at,lastQualifiedAt:at,visits:2,accountedAt:at-1000,accountedVisits:1},
  {id:101,visitedAt:at+1000,lastQualifiedAt:at,visits:2,title:'Актуальная задача'}
 ]));
 assert.equal(await f.write(rows=>rows,day),true);
 const saved=JSON.parse(f.storage.get(key));
 assert.equal(saved.length,1);assert.equal(saved[0].taskId,'101');assert.equal(saved[0].visits,2);
 assert.equal(saved[0].accountedAt,at-1000);assert.equal(saved[0].accountedVisits,1);
 assert.equal(model.selectUntrackedVisits(saved)[0].pendingContacts,1);
 return{persistedRows:1,taskId:'101',pendingContacts:1,accountingPreserved:true};
});
await check('time contact identity ignores message task links, arbitrary numbers and untyped entity IDs',()=>{
 const ctx=vm.createContext({_buildTaskUrl:id=>`/tasks/task/view/${id}/`,_normalizeBitrixPath:x=>x,
  _extractTaskIdFromTaskUrl:url=>/\/tasks\/task\/view\/(\d+)/.exec(url)?.[1]||''});
 vm.runInContext(extract('_extractDialogTimeTaskMetaFromElement')+'\nglobalThis.read=_extractDialogTimeTaskMetaFromElement;',ctx);
 const row=(attrs={},links=[])=>({dataset:{},textContent:'Обсудить задачу #999',getAttribute:key=>attrs[key]||'',querySelectorAll:()=>links});
 const link=(id,preview=false)=>({getAttribute:()=>`/tasks/task/view/${id}/`,closest:()=>preview?{}:null});
 assert.equal(ctx.read(row({},[link(999,true)])),null);
 assert.equal(ctx.read(row({entityId:'999'})),null);
 assert.equal(ctx.read(row({},[link(10),link(999)])),null,'ambiguous task links do not identify the dialog');
 assert.equal(ctx.read(row({'data-task-id':'0010'},[link(999)]))?.taskId,'10');
 assert.equal(ctx.read(row({'data-entity-type':'TASKS','data-entity-id':'10'}))?.taskId,'10');
 assert.equal(ctx.read(row({},[link(10)]))?.taskId,'10');
 return{falsePreviewContacts:0,falseNumberContacts:0,explicitIdentityWins:true};
});
await check('active time contact keeps known chat-task identity when preview points at another task',()=>{
 const ctx=vm.createContext({IS_OL_FRAME:false,_PENA_TIME_CONTROL:model,document:{visibilityState:'visible'},
  isTasksChatsModeNow:()=>true,_dialogTimeActiveSidePanelTaskId:'',normId:x=>x,_readDialogControlOpenedId:()=> 'chat10',
  findChatElementById:()=>({}),getChatTitleFromElement:()=> 'Одна задача',_extractDialogTimeTaskMetaFromElement:()=>({taskId:'999'}),
  _getDialogControlItemsForMode:()=>[{id:'chat10',taskId:'10',title:'Одна задача'}],_isDialogControlFolder:()=>false,
  _getDialogRecentMeta:()=>({taskId:'10',isTask:true}),_dialogTimeTaskIdsByChatDialogId:new Map([['chat10','10']]),
  _getDialogTimeTaskTitle:id=>`Задача ${id}`});
 vm.runInContext(extract('_getActiveDialogTimeActivity')+'\nglobalThis.activity=_getActiveDialogTimeActivity();',ctx);
 assert.equal(ctx.activity.taskId,'10');assert.equal(ctx.activity.title,'Задача 10');
 return{taskId:ctx.activity.taskId,previewTaskId:'999',falseContactCreated:false};
});
if(!process.env.PENA_CONTACT_SKIP_BROWSER) await check('Chromium two pages: real Web Locks, lease ownership, restart, missing capability and ack replay',async()=>{
 const {startHarnessServer}=await import('./lib/harness-server.mjs');const{chromium}=require('playwright');
 const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),context=await browser.newContext();
 await context.route('**/contact-journal-blank',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Contact journal contract</title>'}));
 const extra=['_getDialogTimeContactDiagnostics','_getDialogTimeScopedStorageKey','_getDialogTimeActivityLeaseKey','_readDialogTimeActivityLease','_claimDialogTimeActivityLease'];
 const boot=async(page,id)=>{
  await page.goto(server.baseUrl+'/contact-journal-blank');
  await page.addScriptTag({content:fs.readFileSync(new URL('../extension/native-time-control.js',import.meta.url),'utf8')});
  await page.addScriptTag({content:`const _PENA_TIME_CONTROL=window.__PENA_TIME_CONTROL__,_PENA_TIME_VISITS_KEY='pena.timeVisitedTasks.v1',_PENA_TIME_CONTACT_OUTBOX_KEY='pena.timeContactOutbox.v1',_PENA_TIME_ACTIVITY_LEASE_KEY='pena.timeActivityOwner.v1',_PENA_TIME_ACTIVITY_LEASE_STALE_MS=15000;
   const _dialogTimeFrameId=${JSON.stringify(id)},_dialogTimePortalUtcOffsetMinutes=180,_dialogTimePendingActivities=new Map(),_dialogTimeContactEvents=new Map(),_dialogTimeTaskTitles=new Map();
   let _dialogTimeContactEventSequence=0,_dialogTimeContactJournalTimer=null,_dialogTimeContactRetryAttempt=0,_dialogTimeContactLastError='',_dialogTimeContactRecoveryScope='',_dialogTimeLeaseHeartbeatTimer=null,_dialogTimePendingActiveId='',_dialogTimeQualificationTimer=null,_dialogTimeDeferredFlushPromise=null,_dialogControlNativeWorkspaceTab='',_dialogTimeOwnedActivityId='';
   function _getCurrentBitrixUserId(){return '7'} function _isDialogTimeLocalCoordinator(){return true} function _isDialogTimeFrameActive(){return true}
   function _getDialogTimeCalendarZone(){return {utcOffsetMinutes:_dialogTimePortalUtcOffsetMinutes}}
   function _getActiveDialogTimeActivity(){return null} function normId(x){return String(x||'')} function _ensureDialogTimeTaskEligibility(){return Promise.resolve(true)}
   function _scheduleDialogTimeDeferredFlush(){} function _queueDialogTimeUiSync(){} function _invalidateDialogTimeTaskSnapshot(){}
   ${[...names,...extra].map(extract).join('\n')}
   window.probe={stage:_stageDialogTimeActivity,flush:_flushDialogTimePendingActivities,journal:_journalDialogTimeContactEvents,diagnostics:_getDialogTimeContactDiagnostics,heartbeat:_syncDialogTimePendingLease,qualify:()=>_qualifyPendingDialogTimeDuration(_dialogTimePendingActivities.get(_dialogTimePendingActiveId)),rows:()=>{let rows=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith('pena.timeVisitedTasks.v1.7.'))rows.push(...JSON.parse(localStorage.getItem(k)));}return rows;}};`});
 };
 try{
  const a=await context.newPage(),b=await context.newPage();await boot(a,'A');await boot(b,'B');
  for(let batch=0;batch<8;batch++){
   await Promise.all([a.evaluate(batch=>{probe.stage({taskId:String(100+batch)},{qualify:true});probe.journal();},batch),b.evaluate(batch=>{probe.stage({taskId:String(200+batch)},{qualify:true});probe.journal();},batch)]);
   await Promise.all([a.evaluate(()=>probe.flush()),b.evaluate(()=>probe.flush())]);
  }
  const before=await a.evaluate(()=>({rows:probe.rows(),diag:probe.diagnostics()}));assert.equal(before.rows.length,16);assert.equal(before.rows.reduce((n,r)=>n+r.visits,0),16);assert.equal(before.diag.secureContext,true);assert.equal(before.diag.storageLockAvailable,true);
  await a.evaluate(()=>{Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});probe.stage({taskId:'301'},{qualify:true});});await a.evaluate(()=>probe.flush());
  const unavailable=await a.evaluate(()=>probe.diagnostics());assert.equal(unavailable.pendingDurable,1);assert.equal(unavailable.lastError,'CONTACT_STORAGE_LOCK_UNAVAILABLE');
  await boot(a,'A-reloaded');await a.evaluate(()=>probe.flush());assert.equal(await a.evaluate(()=>probe.rows().length),17);
  await a.evaluate(()=>{const remove=Storage.prototype.removeItem;Storage.prototype.removeItem=function(key){if(String(key).startsWith('pena.timeContactOutbox'))throw Error('injected ack failure');return remove.call(this,key)};probe.stage({taskId:'302'},{qualify:true});});await a.evaluate(()=>probe.flush());
  assert.equal(await a.evaluate(()=>probe.rows().length),18);await boot(a,'A-after-ack-failure');await a.evaluate(()=>probe.flush());
  const result=await a.evaluate(()=>({rows:probe.rows(),diag:probe.diagnostics()}));assert.equal(result.rows.length,18);assert.equal(result.rows.reduce((n,r)=>n+r.visits,0),18);assert.equal(result.diag.pendingDurable,0);
  for(const tab of [a,b])await tab.evaluate(()=>{for(let i=0;i<30;i++)probe.stage({taskId:String(401+i)},{takeover:true});});
  assert.equal(await a.evaluate(()=>probe.heartbeat()),false);assert.equal(await b.evaluate(()=>probe.heartbeat()),false);
  assert.equal(await a.evaluate(()=>probe.qualify()),false);assert.equal(await b.evaluate(()=>probe.qualify()),false);
  await a.evaluate(()=>probe.flush());await b.evaluate(()=>probe.flush());
  assert.equal(await a.evaluate(()=>probe.rows().length),18,'reading many tasks does not add contacts');
  await b.evaluate(()=>probe.stage({taskId:'501'},{qualify:true,reason:'message'}));await b.evaluate(()=>probe.flush());
  assert.equal(await b.evaluate(()=>probe.rows().find(row=>row.taskId==='501')?.visits),1);
  return{browser:browser.version(),pages:2,concurrentBatches:8,contacts:19,secureContext:result.diag.secureContext,webLocks:result.diag.storageLockAvailable,ackReplayDuplicateCount:0,dualVisibleReadingContacts:0,ownMessageContacts:1};
 }finally{await browser.close();await server.close();}
});
fs.mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});
fs.writeFileSync(process.env.PENA_CONTACT_REPORT || new URL('./artifacts/time-contact-journal-regression.json',import.meta.url),JSON.stringify({scenarios,passed:scenarios.filter(x=>x.status==='PASS').length,total:scenarios.length},null,2));
console.log(JSON.stringify(scenarios,null,2));
if(scenarios.some(x=>x.status==='FAIL')) process.exitCode=1;

import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const model=createRequire(import.meta.url)('../extension/native-time-control.js');
const source=readFileSync(process.env.PENA_COUNTER_SOURCE || new URL('../extension/injected.js',import.meta.url),'utf8');
const extract=name=>{const at=source.search(new RegExp('\\t(?:async )?function '+name+'\\('));assert(at>=0,name);return source.slice(at,source.indexOf('\n\t}',at)+4);};
const range={from:'2026-09-07',to:'2026-09-07'},report={sourceSha:createHash('sha256').update(source).digest('hex'),phases:[]};
const entry=(seconds=60)=>({ID:'501',TASK_ID:'1',USER_ID:'7',SECONDS:seconds,CREATED_DATE:'2026-09-07T12:00:00'});
async function phase(name,fn){try{report.phases.push({name,status:'PASS',evidence:await fn()});}catch(error){report.phases.push({name,status:'FAIL',error:error.stack});}}
function fixture(){
 const state={now:1000000,scope:'portal~7',user:'7',calls:[],rows:[entry()]};class Clock extends Date{static now(){return state.now;}}
 const c=vm.createContext({Date:Clock,Map,Set,Promise,document:{visibilityState:'visible'},navigator:{onLine:true},_PENA_TIME_CONTROL:model,
  _dialogTimeRange:range,_dialogTimePortalDateKey:range.from,_dialogTimeView:'day',_dialogControlNativeWorkspaceTab:'time',
  _dialogTimeCache:new Map(),_dialogTimeInFlight:new Map(),_dialogTimeForcedRefreshes:new Map(),_dialogTimeRangeRechecks:new Map(),_dialogTimePanelRefreshes:new Map(),
  _dialogTimeTaskRevisions:new Map(),_dialogTimeRangeRevisions:new Map(),_dialogTimeTaskChangedAt:new Map(),_dialogTimeTaskLogEvidence:new Map(),
  _dialogTimeTaskTitles:new Map(),_dialogTimeTaskEligibility:new Map(),_dialogTimeProjectTaskIds:new Set(['1']),_dialogTimeCatalogCursor:1,_dialogTimeCatalogScope:state.scope,
  // This elapsed/evidence oracle begins with a user-selected, fully committed catalog.
  // The project-scope suite proves the independent initial setup gate.
  _getDialogTimeProjectScopeKey:()=>state.scope,_getDialogTimeIdentityScopeKey:()=>state.scope,_getCurrentBitrixUserId:()=>state.user,
  _getDialogTimeContactExceptionTaskIds:()=>new Set(),_readDialogTimeManualDraft:()=>({}),_readDialogTimeTracker:()=>null,
  _ensureDialogTimeProjectCatalog:async()=>{c._dialogTimeCatalogScope=state.scope;return true;},_isDialogTimeProjectTask:id=>id==='1',
  _DIALOG_TIME_FIRST_WAVE_SIZE:16,_DIALOG_TIME_WAVE_SIZE:50,_queueDialogTimeUiSync:()=>{},_loadDialogTimeTaskTitles:async()=>{},_sleepDialogControl:async()=>{},
  _getDialogTimeFriendlyError:error=>error.message,_isBxRestBatchPressureError:()=>false,
  _buildDialogTimeWriteFields:(_seconds,dateKey)=>({CREATED_DATE:`${dateKey}T12:00:00`}),
  _parseDialogRecentDate:value=>Date.parse(value)||0,_readDialogTaskTimeTrackingFlag:()=>true,_rememberDialogTimeTaskChat:()=>{},_setDialogTimeTaskEligibility:()=>{},
  _callDialogTimeElapsedPages:async requests=>{state.calls.push(...requests.map(p=>String(p[0])));if(state.hold) await state.hold; return requests.map(p=>({data:structuredClone(state.rows.filter(r=>String(r.USER_ID)===String(p[2].USER_ID))),requestedAt:state.now}));}
 });
 vm.runInContext(['_getDialogTimeWorkingTaskIds','_getDialogTimeCacheKey','_setDialogTimeCacheRecord','_hasDialogTimeVerifiedData','_publishDialogTimeTaskIndexRows','_loadDialogTimeRange','_invalidateDialogTimeCachesForDates','_applyDialogTimeOptimisticEntry'].map(extract).join('\n'),c);
 const capture=()=>({scope:state.scope,at:state.now,revisions:new Map(c._dialogTimeTaskRevisions)});
 const publish=(fields={},proof=capture())=>c._publishDialogTimeTaskIndexRows([{ID:'1',TITLE:'Task 1',...fields}],proof);
 return{state,c,capture,publish,load:options=>c._loadDialogTimeRange(range,options),record:()=>c._dialogTimeCache.get(c._getDialogTimeCacheKey(range))};
}
await phase('post-ACK catalog null keeps confirmed time until one task journal is checked',async()=>{
 const f=fixture();await f.load();
 f.c._invalidateDialogTimeCachesForDates(range.from,{taskId:'1',preserveTaskFreshness:true});
 f.c._applyDialogTimeOptimisticEntry('1',120,range.from,'502');
 f.state.rows.push({...entry(120),ID:'502'});
 assert.equal(f.record().data.totalSeconds,180);
 f.state.now+=100;f.publish({TIME_SPENT_IN_LOGS:null});
 let release;f.state.hold=new Promise(resolve=>{release=resolve;});
 const pending=f.load({force:true});
 await Promise.resolve();await Promise.resolve();
 assert.equal(f.record().data.totalSeconds,180,'Unconfirmed null must not erase an acknowledged entry');
 assert.deepEqual(f.state.calls,['1','1']);
 release();await pending;
 assert.equal(f.record().data.totalSeconds,180);
 assert.equal(f.record().data.entryCount,2);
 assert.equal(f.record().hasCompleteSnapshot,true);
 return{beforeAck:60,afterAck:180,duringRead:180,afterRead:180,verificationRequests:1};
});
await phase('real deletion is accepted only after elapsed endpoint confirms empty and warm reads stay deduplicated',async()=>{
 const f=fixture();await f.load();f.state.rows=[];f.state.now+=10;
 f.publish({TIME_SPENT_IN_LOGS:null});await f.load();
 assert.deepEqual(f.state.calls,['1','1']);
 assert.equal(f.record().data.totalSeconds,0);assert.equal(f.record().data.entryCount,0);
 await f.load();assert.equal(f.state.calls.length,2);
 return{verificationRequests:1,confirmedEmpty:true,warmExtraRequests:0};
});
await phase('known zero-duration row is checked and its journal ID is retained',async()=>{
 const f=fixture();f.state.rows=[entry(0)];await f.load();
 f.publish({TIME_SPENT_IN_LOGS:null});await f.load();
 assert.equal(f.state.calls.length,2);assert.equal(f.record().data.entryCount,1);
 assert.equal(f.record().data.items[0].id,'501');
 return{seconds:0,entryCount:1,itemId:'501'};
});
await phase('preview restored after null publication is protected again when evidence is consumed',async()=>{
 const f=fixture();f.publish({TIME_SPENT_IN_LOGS:null});
 f.c._setDialogTimeCacheRecord(f.c._getDialogTimeCacheKey(range),{range,status:'ready',restored:true,
  data:{...model.aggregateElapsedItems([entry()]),range},hasVerifiedData:true,hasCompleteSnapshot:false,taskFreshness:{}});
 await f.load();assert.equal(f.state.calls.length,1);assert.equal(f.record().data.totalSeconds,60);
 return{restoredSeconds:60,verifiedSeconds:60,elapsedRequests:1};
});
await phase('unseen empty journal keeps its zero-request fast path',async()=>{
 const f=fixture();f.state.rows=[];f.publish({TIME_SPENT_IN_LOGS:null});await f.load();
 assert.equal(f.state.calls.length,0);assert.equal(f.record().data.totalSeconds,0);
 assert.equal(f.record().hasVerifiedData,true);assert.equal(f.record().hasCompleteSnapshot,true);
 return{elapsedRequests:0,verifiedEmpty:true};
});
const putRange=(f,r)=>f.c._setDialogTimeCacheRecord(f.c._getDialogTimeCacheKey(r),{
 range:r,status:'ready',data:{...model.aggregateElapsedItems([]),range:r},hasVerifiedData:true,hasCompleteSnapshot:true});
await phase('browsing twelve past days cannot evict today before the next acknowledged ADD',async()=>{
 const f=fixture();await f.load();const sizes=[];
 for(let offset=1;offset<=12;offset++){
  const day=model.addDays(range.from,-offset);f.c._dialogTimeRange=model.normalizeRange(day,day);
  putRange(f,f.c._dialogTimeRange);sizes.push(f.c._dialogTimeCache.size);
  assert.ok(f.record(),'Today was evicted by history navigation');
  assert.ok(f.c._dialogTimeCache.has(f.c._getDialogTimeCacheKey(f.c._dialogTimeRange)));
  assert.ok(f.c._dialogTimeCache.size<=8);
 }
 f.c._invalidateDialogTimeCachesForDates(range.from,{taskId:'1',preserveTaskFreshness:true});
 f.c._applyDialogTimeOptimisticEntry('1',120,range.from,'502');
 assert.equal(f.record().data.totalSeconds,180);assert.equal(f.record().hasCompleteSnapshot,true);
 return{previousSeconds:60,addedSeconds:120,actualSeconds:180,sizes};
});
await phase('selected day and its visible statistics range stay pinned alongside today with at most eight records',async()=>{
 const f=fixture();await f.load();
 f.c._dialogTimeRange=model.normalizeRange('2026-09-04','2026-09-04');f.c._dialogTimeView='stats';
 const stats=model.normalizeRange('2026-08-29','2026-09-04');putRange(f,f.c._dialogTimeRange);putRange(f,stats);
 for(let offset=10;offset<=22;offset++){
  const day=model.addDays(range.from,-offset);putRange(f,model.normalizeRange(day,day));
  assert.ok(f.record());assert.ok(f.c._dialogTimeCache.has(f.c._getDialogTimeCacheKey(stats)));
  assert.ok(f.c._dialogTimeCache.has(f.c._getDialogTimeCacheKey(f.c._dialogTimeRange)));
  assert.ok(f.c._dialogTimeCache.size<=8);
 }
 return{pinnedRanges:3,size:f.c._dialogTimeCache.size};
});
await phase('in-flight historical snapshots cannot grow retained cache beyond eight',async()=>{
 const f=fixture();await f.load();
 for(let offset=1;offset<=20;offset++){
  const day=model.addDays(range.from,-offset),r=model.normalizeRange(day,day);
  f.c._dialogTimeInFlight.set(f.c._getDialogTimeCacheKey(r),Promise.resolve());
  putRange(f,r);assert.ok(f.c._dialogTimeCache.size<=8);assert.ok(f.record());
 }
 return{inFlightKeys:f.c._dialogTimeInFlight.size,retainedRecords:f.c._dialogTimeCache.size,todayRetained:true};
});
await phase('switching identity releases the old today pin and never leaks its total',async()=>{
 const f=fixture();await f.load();const oldKey=f.c._getDialogTimeCacheKey(range);
 f.state.scope='other~8';f.state.user='8';putRange(f,range);
 for(let offset=1;offset<=12;offset++){
  const day=model.addDays(range.from,-offset);putRange(f,model.normalizeRange(day,day));
 }
 assert.equal(f.c._dialogTimeCache.has(oldKey),false);
 assert.equal(f.record().data.totalSeconds,0);assert.ok(f.c._dialogTimeCache.size<=8);
 return{oldIdentityRetained:false,currentSeconds:0,size:f.c._dialogTimeCache.size};
});
function selectionFixture(existingStorage=null){
 const storage=existingStorage || new Map();const state={storage,user:'7',host:'portal.test',now:Date.parse('2026-09-07T12:30:00Z')};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[state.now]));}static now(){return state.now;}}
 const c=vm.createContext({Date:Clock,Map,Set,_PENA_TIME_CONTROL:model,
  location:{get host(){return state.host;}},_getCurrentBitrixUserId:()=>state.user,
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(state.failStorage)throw new Error('Storage failed');storage.set(key,String(value));}},
  _dialogTimeProjectPreference:null,_dialogTimeProjectGeneration:0,_dialogTimeRange:range,_dialogTimeView:'day',_dialogTimePortalDateKey:range.from,
  _dialogTimePortalUtcOffsetMinutes:0,_dialogTimeCache:new Map(),_dialogTimeInFlight:new Map(),_dialogTimeTaskEligibility:new Map([['42',true]]),
  _dialogTimeManualSearchToken:0,_dialogTimeManualSelectedTask:null,_dialogTimeManualSearchQuery:'',_dialogTimeManualSearchResults:[],_dialogTimeManualSearchTimer:null,
  _dialogTimeTodayPreviewReadKey:'',_dialogTimeTodayPreviewWriteKey:'',_dialogTimeTodayPreviewTimer:null,_dialogTimeTodayPreviewPendingKey:'',_dialogTimeTodayPreviewRetry:null,
  _queueDialogTimeUiSync:()=>{},clearTimeout:()=>{},setTimeout:()=>1,_getDialogTimeTodayKey:()=>range.from
 });
 for(const name of ['_getDialogTimeIdentityScopeKey','_normalizeDialogTimeProjectPreference','_getDialogTimeProjectStorageKey',
  '_readDialogTimeProjectPreference','_getDialogTimeProjectScopeKey','_migrateDialogTimeProjectSnapshots','_saveDialogTimeProjectPreference',
  '_getDialogTimeCacheKey','_getDialogTimeRecord','_setDialogTimeCacheRecord','_hasDialogTimeVerifiedData','_syncDialogTimeTodayPreview']){
  // Frozen before sources have no migration helper. Run their actual save path
  // unchanged so the negative control fails on the missing user-visible snapshot.
  if(name==='_migrateDialogTimeProjectSnapshots' && process.env.PENA_COUNTER_SOURCE && !source.includes('function '+name+'('))continue;
  vm.runInContext(extract(name),c);
 }
 const selected={version:1,all:false,ids:['10'],includeUnassigned:false};
 const seed=()=>{
  c._saveDialogTimeProjectPreference(selected);
  const data={...model.aggregateElapsedItems([entry(3600)]),range};
  c._setDialogTimeCacheRecord(c._getDialogTimeCacheKey(range),{range,status:'ready',data,hasVerifiedData:true,hasCompleteSnapshot:true,globalSnapshotRead:true,readForce:true,failedTaskRevisions:{'1':0},taskFreshness:{'1':{at:state.now,revision:0}}});
  storage.set('pena.timeToday.v1.portal.test~7',JSON.stringify({version:1,scope:c._getDialogTimeProjectScopeKey().replace(/:g\d+$/,''),day:range.from,offset:0,savedAt:state.now,items:data.items}));
  storage.set('pena.timeActiveTracker.v1.7',JSON.stringify({taskId:'42',startedAt:state.now-45000,dateKey:range.from}));
  storage.set('pena.timeVisitedTasks.v1.7.2026-09-07',JSON.stringify([{taskId:'42',visits:2,lastQualifiedAt:state.now}]));
 };
 return{c,state,seed,record:()=>c._getDialogTimeRecord(range)};
}
await phase('changing one project to all immediately retains the confirmed hour, contacts, eligibility and tracker',async()=>{
 const f=selectionFixture();f.seed();
 const tracker=f.state.storage.get('pena.timeActiveTracker.v1.7'),contacts=f.state.storage.get('pena.timeVisitedTasks.v1.7.2026-09-07');
 f.c._saveDialogTimeProjectPreference({version:1,all:true,ids:[],includeUnassigned:true});
 assert.ok(f.record(),'Changing to all projects discarded the confirmed current-day snapshot');
 assert.equal(f.record().data.totalSeconds,3600);assert.equal(f.record().hasVerifiedData,true);
 assert.equal(f.record().hasCompleteSnapshot,false);assert.equal(f.record().status,'loading');
 assert.equal(Object.keys(f.record().taskFreshness).length,0);
 assert.equal(f.record().globalSnapshotRead,false,'A global read for the old selection cannot suppress the new scope global audit');
 assert.equal(f.record().readForce,false);assert.equal(f.record().failedTaskRevisions,null);
 assert.equal(f.state.storage.get('pena.timeActiveTracker.v1.7'),tracker);
 assert.equal(f.state.storage.get('pena.timeVisitedTasks.v1.7.2026-09-07'),contacts);
 assert.equal(f.c._dialogTimeTaskEligibility.get('42'),true);
 const reload=selectionFixture(new Map(f.state.storage));reload.c._syncDialogTimeTodayPreview(range);
 assert.equal(reload.record().data.totalSeconds,3600);assert.equal(reload.record().hasVerifiedData,true);
 assert.equal(reload.record().hasCompleteSnapshot,false);
 return{immediateSeconds:3600,reloadedSeconds:3600,fullSnapshotClaimed:false,contactsAndTrackerUnchanged:true};
});
await phase('excluding the old project keeps an explicit unverified preview instead of displaying its sum or false zero',async()=>{
 const f=selectionFixture();f.seed();f.c._saveDialogTimeProjectPreference({version:1,all:false,ids:['20'],includeUnassigned:false});
 assert.equal(f.record().data.totalSeconds,3600,'Keep raw snapshot for scoped reconciliation');
 assert.equal(f.c._hasDialogTimeVerifiedData(f.record()),false,'Old selected total is not a verified total for the new project');
 assert.equal(f.record().status,'loading');assert.equal(f.record().hasCompleteSnapshot,false);
 const reload=selectionFixture(new Map(f.state.storage));reload.c._syncDialogTimeTodayPreview(range);
 assert.equal(reload.c._hasDialogTimeVerifiedData(reload.record()),false);
 assert.equal(reload.record().hasCompleteSnapshot,false);
 return{oldRawSeconds:3600,presentedAsVerified:false,reloadPresentedAsVerified:false};
});
await phase('failed project preference write leaves old scope, total and storage intact',async()=>{
 const f=selectionFixture();f.seed();const scope=f.c._getDialogTimeProjectScopeKey(),before=Array.from(f.state.storage);
 f.state.failStorage=true;
 assert.throws(()=>f.c._saveDialogTimeProjectPreference({version:1,all:true,ids:[],includeUnassigned:true}),/Storage failed/);
 assert.equal(f.c._getDialogTimeProjectScopeKey(),scope);assert.equal(f.record().data.totalSeconds,3600);
 assert.deepEqual(Array.from(f.state.storage),before);
 return{savedScopeUnchanged:true,totalSeconds:3600};
});
await phase('migration refuses cached data and saved preview from another identity',async()=>{
 const f=selectionFixture();f.seed();const oldScope=f.c._getDialogTimeProjectScopeKey();
 f.state.user='8';f.c._saveDialogTimeProjectPreference({version:1,all:true,ids:[],includeUnassigned:true});
 f.c._migrateDialogTimeProjectSnapshots({all:false,ids:['10'],includeUnassigned:false},{all:true,ids:[],includeUnassigned:true},oldScope,f.c._getDialogTimeProjectScopeKey());
 assert.equal(f.record(),null);f.c._syncDialogTimeTodayPreview(range);assert.equal(f.record(),null);
 assert.equal(f.state.storage.has('pena.timeToday.v1.portal.test~8'),false);
 return{foreignTotalRestored:false};
});
mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});
writeFileSync(new URL('./artifacts/time-counter-reset-report.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(report.phases.some(item=>item.status!=='PASS'))process.exitCode=1;

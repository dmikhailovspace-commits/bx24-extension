import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const model=createRequire(import.meta.url)('../extension/native-time-control.js');
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const extract=name=>{if(name==='_loadDialogTimeRange'&&process.env.PENA_TIME_LOAD_BASELINE)return readFileSync(process.env.PENA_TIME_LOAD_BASELINE,'utf8');const start=source.search(new RegExp('\\t(?:async )?function '+name+'\\('));assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n\t}',start)+4);};
const phases=[];
const phase=async(name,fn)=>{const at=performance.now();const metrics=await fn();phases.push({name,status:'PASS',ms:performance.now()-at,...metrics});};
const row=(task,id,seconds,day='2026-09-07')=>({ID:String(id),TASK_ID:String(task),USER_ID:'7',SECONDS:seconds,CREATED_DATE:day+'T12:00:00+03:00',DATE_START:day+'T17:30:00+03:00'});
const canonical=data=>({...data,tasks:[...data.tasks].sort((a,b)=>a.taskId.localeCompare(b.taskId))});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

function fixture(count=51){
 const range={from:'2026-09-07',to:'2026-09-07'}, ids=Array.from({length:count},(_,i)=>String(i+1));
 const state={scope:'portal~7',userId:'7',active:true,today:range.from,calls:[],catalogCalls:0,hold:null,onPage:null};
 const c=vm.createContext({window:{},Date,setTimeout,clearTimeout,document:{visibilityState:'visible'},navigator:{onLine:true},
  _PENA_TIME_CONTROL:model,_dialogTimeRange:range,_dialogTimeView:'day',_dialogControlNativeWorkspaceTab:'',_dialogTimePortalDateKey:range.from,
  _dialogTimeBootstrapToken:null,_dialogTimeBootstrapPromise:null,_dialogTimeBootstrapSequence:0,
  _dialogTimeCache:new Map(),_dialogTimeInFlight:new Map(),_dialogTimeRangeRevisions:new Map(),_dialogTimeTaskRevisions:new Map(),
  _dialogTimeForcedRefreshes:new Map(),_dialogTimeRangeRechecks:new Map(),_dialogTimePanelRefreshes:new Map(),
  _dialogTimeCatalogCursor:100,_dialogTimeCatalogScope:state.scope,_DIALOG_TIME_FIRST_WAVE_SIZE:16,_DIALOG_TIME_WAVE_SIZE:50,
  _getCurrentBitrixUserId:()=>state.userId,_getDialogNativeSharedAuditScopeKey:()=>state.scope,_isDialogTimeFrameActive:()=>state.active&&c.document.visibilityState!=='hidden',
  // These clock/CPU oracles start with a saved project choice; the separate
  // project-scope suite verifies actual persistence and catalog membership.
  _getDialogTimeProjectScopeKey:()=>state.scope,
  _isDialogTimeProjectTask:id=>ids.includes(String(id)),
  _dialogTimeProjectCatalogDirty:false,_dialogTimeProjectCatalogError:null,
  _ensureDialogTimeProjectCatalog:async()=>{if(c._dialogTimeCatalogCursor&&c._dialogTimeCatalogScope===state.scope)return true;state.catalogCalls++;c._dialogTimeCatalogCursor=100;c._dialogTimeCatalogScope=state.scope;return true;},
  _ensureDialogTimePortalDate:async()=>range.from,_syncDialogTimePortalDay:()=>{},_getDialogTimeTodayKey:()=>state.today,
  _getDialogTimeWorkingTaskIds:()=>ids.slice(),_getDialogTimeRecord:r=>c._dialogTimeCache.get(c._getDialogTimeCacheKey(r)),
  _queueDialogTimeUiSync:()=>{},_loadDialogTimeTaskTitles:async()=>{},_sleepDialogControl:async()=>{},_getDialogTimeFriendlyError:e=>e.message,
  _syncDialogTaskCatalog:async()=>{state.catalogCalls++;c._dialogTimeCatalogCursor=100;c._dialogTimeCatalogScope=state.scope;return {complete:true};},
  _callDialogTimeElapsedPages:async params=>{state.calls.push(...params.map(p=>String(p[0])));if(state.hold)await state.hold.promise;state.onPage?.();return params.map(p=>({data:[{...row(p[0],p[0],60,p[2]['>=CREATED_DATE'].slice(0,10)),USER_ID:String(p[2].USER_ID)}],total:1,next:null,requestedAt:Date.now()}));}
 });
 vm.runInContext(['_getDialogTimeCacheKey','_hasDialogTimeVerifiedData','_setDialogTimeCacheRecord','_scheduleDialogTimeBootstrap','_loadDialogTimeRange'].map(extract).join('\n'),c);
 return {c,state,range,ids};
}

function pendingClockFixture(){
 const result=fixture(),{c,state}=result,clock=deferred();
 c._dialogControlNativeWorkspaceTab='time';c._dialogTimePortalDateKey='';c._dialogTimePortalUtcOffsetMinutes=null;c._dialogTimePortalDatePromise=null;
 c._dialogTimeRange=model.normalizeRange('2026-09-08','2026-09-08');
 c._PENA_TIME_CONTROL={...model,getQuickRange:(kind,base)=>model.getQuickRange(kind,base??'2026-09-08')};
 state.clockCalls=0;state.requestDays=[];
 c._callBxRestPageWithTimeout=()=>{state.clockCalls++;return clock.promise;};
 const elapsed=c._callDialogTimeElapsedPages;c._callDialogTimeElapsedPages=async params=>{state.requestDays.push(...params.map(p=>String(p[2]['>=CREATED_DATE']).slice(0,10)));return elapsed(params);};
 vm.runInContext(extract('_ensureDialogTimePortalDate'),c);
 return {...result,clock};
}

try {
 await phase('first catalog page waits for portal clock and coalesces with panel initialization on the resolved day',async()=>{
  const {c,state,clock,range}=pendingClockFixture();
  const early=c._loadDialogTimeRange(c._dialogTimeRange);
  const initialization=c._ensureDialogTimePortalDate().then(()=>c._loadDialogTimeRange(c._dialogTimeRange));
  await Promise.resolve();assert.equal(state.calls.length,0,'Elapsed read started on an unconfirmed host-local date');assert.equal(state.clockCalls,1);
  clock.resolve({data:'2026-09-07T22:00:00Z'});await Promise.all([early,initialization]);
  assert.equal(state.calls.length,51);assert.equal(new Set(state.calls).size,51);assert.deepEqual([...new Set(state.requestDays)],['2026-09-07']);
  assert.equal(c._getDialogTimeRecord(range).hasCompleteSnapshot,true);return{beforeClock:0,afterClock:51,clockRequests:1};
 });
 await phase('pending clock preserves explicit history and remaps only the selected provisional week',async()=>{
  for(const stats of [false,true]){
   const {c,state,clock}=pendingClockFixture();c._dialogTimeView=stats?'stats':'day';
   const requested=stats?model.normalizeRange('2026-09-02','2026-09-08'):model.normalizeRange('2026-09-05','2026-09-05');
   const read=c._loadDialogTimeRange(requested);assert.equal(state.calls.length,0);clock.resolve({data:'2026-09-07T22:00:00Z'});await read;
   assert.deepEqual([...new Set(state.requestDays)],[stats?'2026-09-01':'2026-09-05']);assert.equal(state.calls.length,51);
  }
 });
 await phase('pending clock cannot dispatch after scope, close, visibility or connectivity changes',async()=>{
  for(const change of ['scope','close','hidden','offline']){
   const {c,state,clock}=pendingClockFixture();const read=c._loadDialogTimeRange(c._dialogTimeRange);
   if(change==='scope')state.scope='portal~8';if(change==='close')c._dialogControlNativeWorkspaceTab='';if(change==='hidden')c.document.visibilityState='hidden';if(change==='offline')c.navigator.onLine=false;
   clock.resolve({data:'2026-09-07T22:00:00Z'});await read;assert.equal(state.calls.length,0,change);
  }
  const closed=pendingClockFixture();closed.c._dialogControlNativeWorkspaceTab='';await closed.c._loadDialogTimeRange(closed.range);assert.equal(closed.state.clockCalls,0);
  const failed=pendingClockFixture();const read=failed.c._loadDialogTimeRange(failed.c._dialogTimeRange);failed.clock.resolve({data:''});await assert.rejects(read,/дату портала/);assert.equal(failed.state.calls.length,0);assert.equal(failed.c._dialogTimeCache.size,0);
 });
 await phase('switching the selected view during clock initialization drops the obsolete week and loads only the day',async()=>{
  const {c,state,clock}=pendingClockFixture();c._dialogTimeView='stats';
  const week=c._loadDialogTimeRange(model.normalizeRange('2026-09-02','2026-09-08'));
  c._dialogTimeView='day';const day=c._loadDialogTimeRange(c._dialogTimeRange);
  clock.resolve({data:'2026-09-07T22:00:00Z'});await Promise.all([week,day]);
  assert.equal(state.calls.length,51);assert.deepEqual([...new Set(state.requestDays)],['2026-09-07']);
 });
 await phase('incremental replacement preserves complete totals, dates, receipts and unchanged record identity',()=>{
  let data=model.aggregateElapsedItems(Array.from({length:400},(_,i)=>row(i+1,i+1,60+i%37,i%2?'2026-09-07':'2026-09-06')));
  for(let iteration=0;iteration<60;iteration++){
   const id=String(1+iteration*7%400), accepted=new Set([id]);
   const incoming=model.aggregateElapsedItems(iteration%4?[{...row(id,1000+iteration,iteration*11),contactCutoffAt:1788800000000}]:[]);
   const previous=JSON.stringify(data), unchanged=data.items.find(item=>item.taskId!==id);
   const expected=model.aggregateElapsedItems([...data.items.filter(item=>item.taskId!==id),...incoming.items]);
   const result=model.replaceElapsedTasks(data,incoming,accepted);
   assert.deepEqual(canonical(result),canonical(expected));assert.equal(JSON.stringify(data),previous);
   assert.equal(result.items.find(item=>item.id===unchanged.id),unchanged);
   data=result;
  }
  return {replacements:60,originalRecords:400};
 });
 await phase('4149-task working set preserves every ID without quadratic membership scans',()=>{
  const ids=Array.from({length:4149},(_,i)=>String(i+1));
  const c=vm.createContext({_PENA_TIME_CONTROL:model,_dialogTimeRange:{from:'2026-09-07',to:'2026-09-07'},_dialogTimeCache:new Map([['day',{data:{tasks:ids.map(taskId=>({taskId}))}}]]),
   _dialogTimeProjectTaskIds:new Set(ids),_dialogTimeCatalogCursor:1,_dialogTimeCatalogScope:'configured',_getDialogTimeProjectScopeKey:()=> 'configured',
   _dialogTimeTaskTitles:new Map(ids.map(id=>[id,'Task '+id])),_dialogTimeTaskEligibility:new Map(ids.map(id=>[id,true])),
   _readDialogTimeVisits:()=>[],_dialogTimeManualSelectedTask:null,_readDialogTimeTracker:()=>null,_getActiveDialogTimeActivity:()=>null,
   _getDialogTimeEligibleTaskIds:()=>ids,_getDialogRecentUniqueMeta:()=>[],_getDialogTimeTaskEligibilityForDisplay:()=>true});
  vm.runInContext(extract('_getDialogTimeWorkingTaskIds'),c);
  vm.runInContext('globalThis.membershipScanned=0; const original=Array.prototype.includes; Array.prototype.includes=function(...args){ membershipScanned+=this.length; return original.apply(this,args); };',c);
  const got=c._getDialogTimeWorkingTaskIds();assert.deepEqual(Array.from(got),ids);assert.equal(c.membershipScanned,0);
  return {taskCount:got.length,arrayMembershipElements:c.membershipScanned};
 });
 await phase('ordinary closed panel cannot start elapsed reads; common startup loads today once',async()=>{
  const {c,state,range}=fixture();await c._loadDialogTimeRange(range);assert.equal(state.calls.length,0);
  await c._scheduleDialogTimeBootstrap(Promise.resolve({value:{complete:true},error:null}));
  assert.equal(state.calls.length,51);assert.equal(new Set(state.calls).size,51);assert.equal(c._getDialogTimeRecord(range).data.totalSeconds,3060);
  assert.equal(c._dialogTimeBootstrapToken.phase,'ready');
  await c._scheduleDialogTimeBootstrap(null);assert.equal(state.calls.length,51);
  c._dialogControlNativeWorkspaceTab='time';await c._loadDialogTimeRange(range);assert.equal(state.calls.length,51);
  return {initial:51,reopenAdditional:0};
 });
 await phase('native feed without REST metadata starts one shared catalog before today',async()=>{
  const {c,state}=fixture();c._dialogTimeCatalogCursor=0;await c._scheduleDialogTimeBootstrap(null);assert.equal(state.catalogCalls,1);assert.equal(state.calls.length,51);
  await c._scheduleDialogTimeBootstrap(null);assert.equal(state.catalogCalls,1);return {catalogs:1};
 });
 await phase('two startup signals coalesce and a closed-panel task change reads only that task',async()=>{
  const {c,state}=fixture();state.hold=deferred();const first=c._scheduleDialogTimeBootstrap(null),second=c._scheduleDialogTimeBootstrap(null);
  assert.equal(first,second);state.hold.resolve();await first;state.hold=null;
  c._dialogTimeTaskRevisions.set('30',1);await c._scheduleDialogTimeBootstrap(null);assert.deepEqual(state.calls.slice(51),['30']);return {dirtyReads:1};
 });
 await phase('hidden startup discards late rows and resumes unfinished work without accepting a partial snapshot',async()=>{
  const {c,state,range}=fixture();state.onPage=()=>{c.document.visibilityState='hidden';};await c._scheduleDialogTimeBootstrap(null);
  assert.equal(state.calls.length,16);assert.notEqual(c._getDialogTimeRecord(range)?.hasCompleteSnapshot,true);
  state.onPage=null;c.document.visibilityState='visible';await c._scheduleDialogTimeBootstrap(null);
  assert.equal(c._getDialogTimeRecord(range).data.totalSeconds,3060);assert.equal(c._getDialogTimeRecord(range).hasCompleteSnapshot,true);
  return {discardedLateTaskResponses:16,resumedRequests:state.calls.length-16};
 });
 await phase('scope change and uncompleted catalog cannot publish another user or false zero',async()=>{
  const first=fixture();first.state.onPage=()=>{first.state.scope='portal~8';};await first.c._scheduleDialogTimeBootstrap(null);
  assert.equal(first.c._getDialogTimeRecord(first.range),undefined);
  const second=fixture();second.c._ensureDialogTimeProjectCatalog=async()=>false;
  await second.c._scheduleDialogTimeBootstrap(null);assert.equal(second.state.calls.length,0);assert.equal(second.c._dialogTimeBootstrapToken.phase,'paused');
 });
 await phase('midnight wake waits for the old read and starts the new day exactly once',async()=>{
  const {c,state,range}=fixture();state.hold=deferred();const first=c._scheduleDialogTimeBootstrap(null);
  while(!state.calls.length)await Promise.resolve();
  state.today='2026-09-08';c._dialogTimePortalDateKey=state.today;
  const wake=c._scheduleDialogTimeBootstrap(null),duplicate=c._scheduleDialogTimeBootstrap(null);
  state.hold.resolve();await Promise.all([first,wake,duplicate]);
  const next=c._getDialogTimeRecord({from:state.today,to:state.today});
  assert.equal(next.hasCompleteSnapshot,true);assert.equal(next.data.totalSeconds,3060);assert.ok(next.data.items.every(item=>item.dateKey===state.today));
  assert.equal(state.calls.length,16+51);assert.notEqual(c._getDialogTimeRecord(range)?.hasCompleteSnapshot,true);
  assert.equal(c._dialogTimeBootstrapToken.phase,'ready');return{oldDiscarded:16,newDayReads:51};
 });
 await phase('unmounted Messenger stops its bootstrap owner and restores only unfinished work',async()=>{
  const {c,state,range}=fixture();state.onPage=()=>{state.active=false;};await c._scheduleDialogTimeBootstrap(null);
  assert.equal(state.calls.length,16);assert.notEqual(c._getDialogTimeRecord(range)?.hasCompleteSnapshot,true);
  state.active=true;state.onPage=null;await c._scheduleDialogTimeBootstrap(null);
  assert.equal(c._getDialogTimeRecord(range).data.totalSeconds,3060);assert.equal(state.calls.length,67);
 });
 await phase('new scope completes while old held answers cannot clear its bootstrap owner',async()=>{
  const {c,state,range}=fixture();state.hold=deferred();const first=c._scheduleDialogTimeBootstrap(null);
  while(!state.calls.length)await Promise.resolve();const held=state.hold;state.hold=null;
  state.scope='portal~8';state.userId='8';await c._scheduleDialogTimeBootstrap(null);held.resolve();await first;
  assert.equal(c._getDialogTimeRecord(range).data.totalSeconds,3060);assert.ok(c._getDialogTimeRecord(range).data.items.every(item=>item.userId==='8'));
  assert.equal(c._dialogTimeCache.get('portal~7:'+range.from+':'+range.to)?.data,null);assert.equal(c._dialogTimeBootstrapToken.scope,state.scope);
  assert.equal(c._dialogTimeBootstrapToken.phase,'ready');assert.equal(c._dialogTimeInFlight.size,0);
 });
 for(const held of [false,true])await phase(held?'default wake waits for native guard and reuses today':'default native view starts metadata and today without inventing DOM proof',async()=>{
  const {c,state,range}=fixture(),guard=held?deferred():null;
  Object.assign(c,{isInternalChatsDOM:()=>true,findContainer:()=>({matches:()=>false}),findInternalScrollContainer:()=>({}),_getDialogNativeSourceGeneration:()=>1,
   _dialogNativeAttemptStates:new Map(),_dialogControlNeedsCompleteNativeMaterialization:()=>false,_refreshDialogNativeVisibleWindow:()=>{},_setDialogNativeAttemptState:()=>{},_publishDialogRecentSyncState:()=>{},_dialogNativeOriginalScrollPromise:guard?.promise||null});
  c._dialogTimeCatalogCursor=0;vm.runInContext(extract('_runDialogWakeReconcile'),c);
  await c._runDialogWakeReconcile('periodic-freshness',{metadataOnly:true});
  if(held){assert.equal(state.catalogCalls,0);assert.equal(state.calls.length,0);guard.resolve();}
  await c._dialogTimeBootstrapPromise;assert.equal(state.catalogCalls,1);assert.equal(state.calls.length,51);assert.equal(c._getDialogTimeRecord(range).hasCompleteSnapshot,true);
  await c._runDialogWakeReconcile('focus-freshness',{metadataOnly:true});await c._dialogTimeBootstrapPromise;
  assert.equal(state.catalogCalls,1);assert.equal(state.calls.length,51);return{catalogs:1,elapsed:51,repeated:0};
 });
} finally {mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/time-snapshot-performance.json',JSON.stringify({phases},null,2));}
console.log(JSON.stringify(phases));

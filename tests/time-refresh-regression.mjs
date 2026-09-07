import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const model = require('../extension/native-time-control.js');
const source = readFileSync(process.env.PENA_TIME_REFRESH_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
const range = model.normalizeRange('2026-09-07', '2026-09-07');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function extract(name) {
 const start = source.search(new RegExp('\\t(?:async )?function ' + name + '\\('));
 assert.ok(start >= 0, `Missing production boundary ${name}`);
 const match = /\n\t(?:async )?function /.exec(source.slice(start + 1));
 return source.slice(start, match ? start + 1 + match.index : undefined);
}
function fixture(count = 2) {
 const state = { clock: 1000000, scope:'portal:7', taskIds:Array.from({length:count},(_,i)=>String(i+1)), calls:[], writes:[], paints:[], entries:[], hold:null, eligibility:null, nextId:100, catalogCalls:[], titleCalls:0, draft:null, tracker:null };
 class TestDate extends Date { static now() { return state.clock; } }
 const sandbox = {
  Date:TestDate, setTimeout:()=>0, clearTimeout:()=>{}, document:{visibilityState:'visible'}, navigator:{onLine:true},
  _PENA_TIME_CONTROL:model, _PENA_TIME_CACHE_TTL_MS:120000, _DIALOG_TIME_LOGGED_TTL_MS:10000, _DIALOG_TIME_EMPTY_TTL_MS:120000,
  _DIALOG_TIME_FIRST_WAVE_SIZE:16, _DIALOG_TIME_WAVE_SIZE:50,
  _dialogTimeRange:range, _dialogTimeView:'day', _dialogControlNativeWorkspaceTab:'time', _dialogControlNativeSwitcherNode:null,
  _dialogTimeCache:new Map(), _dialogTimeInFlight:new Map(), _dialogTimeForcedRefreshes:new Map(), _dialogTimeRangeRechecks:new Map(),
  _dialogTimeRangeRevisions:new Map(), _dialogTimeTaskRevisions:new Map(), _dialogTimeTaskChangedAt:new Map(), _dialogTimePanelRefreshes:new Map(),
  _dialogTimeTaskTitles:new Map(), _dialogTimeTaskEligibility:new Map(), _readDialogTaskTimeTrackingFlag:row=>row.ALLOW_TIME_TRACKING==='Y', _rememberDialogTimeTaskChat:()=>{},
  _setDialogTimeTaskEligibility:(id,enabled)=>sandbox._dialogTimeTaskEligibility.set(id,enabled), _parseDialogRecentDate:value=>Date.parse(value)||0,
  _dialogTimeActionInFlight:false, _dialogTimeManualError:'', _dialogTimeManualSelectedTask:null, _dialogTimeManualSearchQuery:'', _dialogTimeManualSearchResults:[],
  _dialogTimeManualRetryConfirmKey:'', _dialogTimeTrackerRetryConfirmKey:'', _PENA_TIME_MANUAL_DRAFT_KEY:'manual', _PENA_TIME_TRACKER_KEY:'tracker', _dialogTimePortalUtcOffsetMinutes:0,
  _dialogTimeDeleteConfirmEntryId:'', _dialogTimeEditingEntryId:'',
  _getCurrentBitrixUserId:()=> '7', _ensureCurrentBitrixUserId:async()=> '7', _getDialogNativeSharedAuditScopeKey:()=>state.scope,
  _getDialogTimeWorkingTaskIds:()=>state.taskIds.slice(), _getDialogTimeSelectedRange:()=>range, _getDialogTimeStatsRange:()=>range,
  _queueDialogTimeUiSync:()=>state.paints.push(sandbox._dialogTimeCache.get('7:2026-09-07:2026-09-07')?.data?.totalSeconds ?? null),
  _loadDialogTimeTaskTitles:async()=>{ state.titleCalls++; }, _getDialogTimeFriendlyError:e=>e.message,
  _isBxRestBatchPressureError:e=>/TIMEOUT|LIMIT|NETWORK/.test(e.code || ''),
  _sleepDialogControl:async()=>{}, _showDialogDockToast:()=>{}, _markDialogTimeTaskAccounted:async()=>true, warn:()=>{},
  _getDialogTimeScopedStorageKey:key=>`${key}:7`,
  _readDialogTimeManualDraft:()=>structuredClone(state.draft || {}), _writeDialogTimeManualDraft:draft=>{state.draft=structuredClone(draft);return !state.storageFailure;},
  _readDialogTimeTracker:()=>structuredClone(state.tracker), _writeDialogTimeTracker:tracker=>{state.tracker=structuredClone(tracker);return !state.storageFailure;},
  _ensureDialogTimeTrackerTick:()=>{}, _ensureDialogTimePortalDate:async()=>{},
  _ensureDialogTimeTaskEligibility:()=>state.eligibility?.promise || Promise.resolve(true),
  _refreshDialogTimeTaskCatalog:async options=>{state.catalogCalls.push(options || {});},
  _callBxRestMethod:async(method,params)=>{
   state.writes.push({method,params});
   if(state.writeHold) await state.writeHold.promise;
   if(state.rejectFalse) return false;
   const failure=state.writeErrors?.shift();
   if(failure) throw failure;
   if(state.noId) return true;
   if(method.endsWith('.add')) { const id=String(++state.nextId); state.entries.push({ID:id,TASK_ID:String(params.TASKID),USER_ID:'7',SECONDS:params.ARFIELDS.SECONDS,CREATED_DATE:params.ARFIELDS.CREATED_DATE}); return id; }
   if(method.endsWith('.update')) Object.assign(state.entries.find(e=>String(e.ID)===String(params.ITEMID)),{SECONDS:params.ARFIELDS.SECONDS,CREATED_DATE:params.ARFIELDS.CREATED_DATE});
   if(method.endsWith('.delete')) state.entries=state.entries.filter(e=>String(e.ID)!==String(params.ITEMID));
   return true;
  },
  _callDialogTimeElapsedPages:async(paramsList,options={})=>{
   if(options.isCurrent && !options.isCurrent()) throw new Error('cancelled before dispatch');
   state.calls.push(paramsList.map(p=>String(p[0])));
   const pages=paramsList.map(p=>{ const matching=state.entries.filter(e=>String(e.TASK_ID)===String(p[0])); const page=p[4].NAV_PARAMS.iNumPage; return {data:structuredClone(matching.slice((page-1)*50,page*50)),total:matching.length,next:null,requestedAt:state.dispatchAt || state.clock}; });
   if(state.denied) {
    const failures=paramsList.map(p=>state.denied.has(String(p[0])) ? Object.assign(new Error('Denied'),{code:'ACCESS_DENIED'}) : null);
    if(failures.some(Boolean)) throw Object.assign(new Error('Denied'),{code:'ACCESS_DENIED',partialPages:pages.map((page,index)=>failures[index]?undefined:page),partialErrors:failures});
   }
   if(state.hold) { const hold=state.hold; state.hold=null; state.held=hold; await hold.promise; }
   return pages;
  }
 };
 const names=['_publishDialogTimeTaskIndexRows','_withDialogTimeTrackerLock','_buildDialogTimeWriteFields','_getDialogTimeTrackerSeconds','_getDialogTimeCacheKey','_setDialogTimeCacheRecord','_invalidateDialogTimeCachesForDates','_applyDialogTimeOptimisticEntry','_removeDialogTimeCachedEntry','_loadDialogTimeRange','_refreshDialogTimePanel','_getDialogTimeSavedItemId','_isDialogTimeDefiniteWriteFailure','_getDialogTimeWriteIntentKey','_withDialogTimeManualWriteLock','_commitDialogTimeManualEntry','_addDialogTimeManualEntry','_deleteDialogTimeEntry','_updateDialogTimeEntry','_stopDialogTimeTracker'];
 vm.createContext(sandbox); vm.runInContext(names.map(extract).join('\n'),sandbox);
 state.seed=(entries=[])=>{
  state.entries=structuredClone(entries);
  const data={...model.aggregateElapsedItems(entries),range,pages:1,totalAvailable:entries.length};
  sandbox._dialogTimeCache.set('7:2026-09-07:2026-09-07',{status:'ready',range,data,updatedAt:state.clock,taskIdsKey:state.taskIds.join(','),taskFreshness:Object.fromEntries(state.taskIds.map(id=>[id,{at:state.clock,revision:0}]))});
 };
 state.record=()=>sandbox._dialogTimeCache.get('7:2026-09-07:2026-09-07');
 return {state,api:sandbox};
}
const entry=(id,task,seconds,date='2026-09-07')=>({ID:String(id),TASK_ID:String(task),USER_ID:'7',SECONDS:seconds,CREATED_DATE:date+'T12:00:00'});
const phases=[];
async function phase(name,fn) { const at=performance.now(); try { const metrics=await fn(); phases.push({name,status:'PASS',ms:performance.now()-at,...metrics}); } catch(e) { phases.push({name,status:'FAIL',ms:performance.now()-at,error:e.stack}); throw e; } }
try {
 await phase('confirmed add retains the existing day and overlapping week immediately',async()=>{
  const {state,api}=fixture();state.seed([entry(1,1,3600),entry(2,2,1800)]);
  const week=model.normalizeRange('2026-09-01','2026-09-07');
  api._dialogTimeCache.set('7:2026-09-01:2026-09-07',{status:'ready',range:week,data:{...model.aggregateElapsedItems(state.entries),range:week},updatedAt:state.clock});
  api._invalidateDialogTimeCachesForDates(range.from,{taskId:'1'});api._applyDialogTimeOptimisticEntry('1',600,range.from,'9');
  assert.equal(state.record().data.totalSeconds,6000);
  assert.equal(api._dialogTimeCache.get('7:2026-09-01:2026-09-07').data.totalSeconds,6000);
  return {immediateSeconds:6000};
 });
 await phase('pre-write response cannot roll back the confirmed value',async()=>{
  const {state,api}=fixture();state.seed([entry(1,1,3600),entry(2,2,1800)]);
  const gate=deferred();state.hold=gate;const read=api._loadDialogTimeRange(range,{force:true});
  await Promise.resolve();api._invalidateDialogTimeCachesForDates(range.from,{taskId:'1'});api._applyDialogTimeOptimisticEntry('1',600,range.from,'9');
  gate.resolve();await read;assert.equal(state.record().data.totalSeconds,6000);
  assert.equal(state.record().status,'ready');return {oldReadSeconds:5400,visibleSeconds:6000};
 });
 await phase('two adds while eligibility is delayed produce exactly one write',async()=>{
  const {state,api}=fixture();state.seed([entry(1,1,3600),entry(2,2,1800)]);
  state.eligibility=deferred();const a=api._addDialogTimeManualEntry({taskId:'1'},0,10,range.from);const b=api._addDialogTimeManualEntry({taskId:'1'},0,10,range.from);
  assert.equal(api._dialogTimeActionInFlight,true);state.eligibility.resolve(true);await Promise.all([a,b]);
  await api._loadDialogTimeRange(range);assert.equal(state.writes.length,1);assert.equal(state.record().data.totalSeconds,6000);
  assert.deepEqual(state.calls.flat(),['1']);return {writes:state.writes.length,reconciledTasks:state.calls.flat().length};
 });
 await phase('two edits while eligibility is delayed preserve one mutation and target one task',async()=>{
  const {state,api}=fixture();state.seed([entry(1,1,3600),entry(2,2,1800)]);state.eligibility=deferred();
  const old={id:'1',taskId:'1',dateKey:range.from};const a=api._updateDialogTimeEntry(old,0,45,range.from),b=api._updateDialogTimeEntry(old,0,45,range.from);
  state.eligibility.resolve(true);await Promise.all([a,b]);await api._loadDialogTimeRange(range);
  assert.equal(state.writes.length,1);assert.equal(state.record().data.totalSeconds,4500);assert.deepEqual(state.calls.flat(),['1']);
  return {writes:1,reconciledTasks:1};
 });
 await phase('cold coverage is progressive, warm refresh reuses empty tasks',async()=>{
  const {state,api}=fixture(117);state.entries=[entry(1,117,1800)];await api._loadDialogTimeRange(range);
  assert.equal(state.record().data.totalSeconds,1800);assert.equal(state.record().data.coverage.checkedTasks,117);
  assert.deepEqual(state.calls.map(x=>x.length),[16,50,50,1]);
  const cold=state.calls.length;state.clock+=10001;await api._loadDialogTimeRange(range);assert.equal(state.calls.length,cold+1);assert.deepEqual(state.calls.at(-1),['117']);
  state.clock+=120000;await api._loadDialogTimeRange(range);assert.equal(state.calls.slice(cold+1).flat().length,117);
  return {coldTasks:117,coldBatches:cold,loggedRefreshTasks:1,emptyExpiryTasks:117};
 });
 await phase('manual refresh coalesces and uses task catalog delta',async()=>{
  const {state,api}=fixture(30);state.seed([entry(1,30,600)]);const gate=deferred();state.hold=gate;
  const a=api._refreshDialogTimePanel(range),b=api._refreshDialogTimePanel(range);gate.resolve();await Promise.all([a,b]);
  assert.equal(state.catalogCalls.length,1);assert.notEqual(state.catalogCalls[0].force,true);assert.equal(state.calls.flat().length,30);
  return {manualCallers:2,catalogReads:1,elapsedTaskReads:30};
 });
 await phase('closing the panel stops the remaining cold scan',async()=>{
  const {state,api}=fixture(117);state.entries=[entry(1,1,600)];const gate=deferred();state.hold=gate;const read=api._loadDialogTimeRange(range);
  await Promise.resolve();api._dialogControlNativeWorkspaceTab='';gate.resolve();await read;assert.equal(state.calls.length,1);assert.equal(state.record().status,'ready');
  return {dispatchedBatches:1,remainingTasksNotSent:101};
 });
 await phase('one inaccessible task preserves other pages and reports incomplete coverage',async()=>{
  const {state,api}=fixture(67);state.entries=[entry(1,2,600),entry(2,67,1200)];state.denied=new Set(['1']);
  await assert.rejects(api._loadDialogTimeRange(range),/Не удалось проверить задачи: 1/);
  assert.equal(state.record().data.totalSeconds,1800);assert.equal(state.record().data.coverage.checkedTasks,66);
  assert.equal(state.record().data.coverage.complete,false);assert.equal(state.record().status,'error');assert.equal(state.calls.flat().length,67);
  return {availableSeconds:1800,checkedTasks:66,totalTasks:67};
 });
 await phase('timer stores exact seconds across midnight and retries only the unsaved segment',async()=>{
  const {state,api}=fixture();state.clock=Date.parse('2026-09-07T00:00:10Z');
  state.tracker={taskId:'1',startedAt:state.clock-20000,dateKey:'2026-09-06',pendingSeconds:0};
  state.writeErrors=[null,Object.assign(new Error('Denied'),{code:'ACCESS_DENIED'})];
  await api._stopDialogTimeTracker();
  assert.deepEqual(state.tracker.saveSegments.map(s=>s.status),['saved','pending']);assert.equal(state.tracker.pendingSeconds,10);
  const savedId=state.tracker.saveSegments[0].itemId;
  await api._stopDialogTimeTracker();assert.equal(state.tracker,null);assert.equal(state.writes.length,3);
  assert.deepEqual(state.entries.map(e=>[e.CREATED_DATE.slice(0,10),e.SECONDS]),[['2026-09-06',10],['2026-09-07',10]]);
  assert.equal(state.entries[0].ID,savedId);return {confirmedSeconds:20,daySegments:2,addAttempts:3,firstDayDuplicates:0};
 });
 await phase('zero-second timer stops without a server write',async()=>{
  const {state,api}=fixture();state.tracker={taskId:'1',startedAt:state.clock,dateKey:range.from,pendingSeconds:0};
  await api._stopDialogTimeTracker();assert.equal(state.tracker,null);assert.equal(state.writes.length,0);return {writes:0};
 });
 await phase('unknown timer result persists and a normal retry does not resend',async()=>{
  const {state,api}=fixture();state.clock=Date.parse('2026-09-07T12:00:10Z');state.tracker={taskId:'1',startedAt:state.clock-10000,dateKey:range.from,pendingSeconds:0};state.noId=true;
  await api._stopDialogTimeTracker();assert.equal(state.tracker.saveSegments[0].status,'unknown');assert.equal(state.writes.length,1);
  await api._stopDialogTimeTracker();assert.equal(state.writes.length,1);
  const restored=fixture();restored.state.tracker=structuredClone(state.tracker);await restored.api._stopDialogTimeTracker();assert.equal(restored.state.writes.length,0);
  return {unconfirmedWrites:1,automaticOrReloadRetries:0};
 });
 await phase('unknown manual add survives reload and requires explicit retry confirmation',async()=>{
  const {state,api}=fixture();state.noId=true;await api._addDialogTimeManualEntry({taskId:'1',title:'Task'},0,10,range.from);
  assert.equal(state.draft.pendingWrite.status,'unknown');assert.equal(state.writes.length,1);
  const restored=fixture();restored.state.draft=structuredClone(state.draft);
  await restored.api._addDialogTimeManualEntry({taskId:'1'},0,10,range.from);assert.equal(restored.state.writes.length,0);
  await restored.api._addDialogTimeManualEntry({taskId:'1'},0,10,range.from);assert.equal(restored.state.writes.length,1);assert.equal(restored.state.draft,null);
  return {initialWrites:1,firstReloadClickWrites:0,explicitConfirmedRetries:1};
 });
 await phase('timer does not send before its recovery state is persisted',async()=>{
  const {state,api}=fixture();state.clock=Date.parse('2026-09-07T12:00:10Z');state.tracker={taskId:'1',startedAt:state.clock-10000,dateKey:range.from,pendingSeconds:0};state.storageFailure=true;
  await api._stopDialogTimeTracker();assert.equal(state.writes.length,0);assert.equal(state.tracker.saveSegments[0].status,'pending');return {writes:0};
 });
 await phase('malformed elapsed data is an error, while explicit zero seconds remains valid',async()=>{
  const good=entry(1,1,0);
  for(const field of ['USER_ID','CREATED_DATE','SECONDS']) {
   const malformed={...good};delete malformed[field];
   await assert.rejects(model.loadElapsedItems({taskIds:['1'],...range,userId:'7',callPages:async()=>[{data:[malformed]}]}),e=>e.code==='TIME_RESPONSE_INVALID');
  }
  const result=await model.loadElapsedItems({taskIds:['1'],...range,userId:'7',callPages:async()=>[{data:[good]}]});
  assert.equal(result.entryCount,1);assert.equal(result.totalSeconds,0);
  return {malformedResponsesRejected:3,explicitZeroEntries:1};
 });
 await phase('new CHANGED_DATE invalidates one empty task, repeated overlap does no work',async()=>{
  const {state,api}=fixture(30);state.seed([]);
  const row={ID:'30',TITLE:'Task',ALLOW_TIME_TRACKING:'Y',CHANGED_DATE:'2026-09-07T10:00:00Z'};
  api._publishDialogTimeTaskIndexRows([row]);await api._loadDialogTimeRange(range);assert.equal(state.calls.length,0);
  state.entries=[entry(1,30,600)];api._publishDialogTimeTaskIndexRows([{...row,CHANGED_DATE:'2026-09-07T10:00:01Z'}]);await api._loadDialogTimeRange(range);
  assert.deepEqual(state.calls.flat(),['30']);assert.equal(state.record().data.totalSeconds,600);
  api._publishDialogTimeTaskIndexRows([{...row,CHANGED_DATE:'2026-09-07T10:00:01Z'}]);await api._loadDialogTimeRange(range);assert.equal(state.calls.length,1);
  return {changedTaskReads:1,overlapExtraReads:0};
 });
 await phase('scope changes fence update eligibility and late mutation acknowledgements',async()=>{
  const first=fixture();first.state.seed([entry(1,1,600)]);first.state.eligibility=deferred();
  const update=first.api._updateDialogTimeEntry({id:'1',taskId:'1',dateKey:range.from},0,20,range.from);
  first.state.scope='portal:8';first.state.eligibility.resolve(true);await update;assert.equal(first.state.writes.length,0);
  for(const operation of ['update','delete']) {
   const {state,api}=fixture();state.seed([entry(1,1,600)]);state.writeHold=deferred();
   const old={id:'1',taskId:'1',dateKey:range.from};
   if(operation==='delete') api._dialogTimeDeleteConfirmEntryId='1';
   const pending=operation==='delete'?api._deleteDialogTimeEntry(old):api._updateDialogTimeEntry(old,0,20,range.from);
   while(!state.writes.length) await Promise.resolve();
   state.scope='portal:8';state.writeHold.resolve();await pending;
   assert.equal(state.record().data.totalSeconds,600);assert.equal(state.calls.length,0);
  }
  return {wrongScopeDispatches:0,lateAckCacheMutations:0};
 });
 await phase('explicit timer rejection remains safely retryable',async()=>{
  const {state,api}=fixture();state.clock=Date.parse('2026-09-07T12:00:10Z');state.tracker={taskId:'1',startedAt:state.clock-10000,dateKey:range.from};state.rejectFalse=true;
  await api._stopDialogTimeTracker();assert.equal(state.tracker.saveSegments[0].status,'pending');assert.equal(state.writes.length,1);
  return {unknownStates:0,knownRejectedAttempts:1};
 });
 await phase('timer freezes exact duration until portal timezone is known',async()=>{
  const {state,api}=fixture();state.clock=Date.parse('2026-09-07T12:00:10Z');state.tracker={taskId:'1',startedAt:state.clock-10000,dateKey:range.from};api._dialogTimePortalUtcOffsetMinutes=null;
  await api._stopDialogTimeTracker();assert.equal(state.writes.length,0);assert.equal(state.tracker.pendingSeconds,10);assert.equal(state.tracker.stoppedAt,state.clock);
  state.clock+=60000;api._dialogTimePortalUtcOffsetMinutes=0;await api._stopDialogTimeTracker();assert.equal(state.writes.length,1);assert.equal(state.entries[0].SECONDS,10);
  return {unknownTimezoneWrites:0,confirmedSecondsAfterRetry:10};
 });
 await phase('freshness starts at transport dispatch but still expires a slow server response',async()=>{
  for (const queued of [true,false]) {
   const {state,api}=fixture(30);state.entries=[entry(1,1,600)];const gate=deferred();state.hold=gate;
   state.dispatchAt=state.clock+(queued?15000:0);const read=api._loadDialogTimeRange(range);await Promise.resolve();state.clock+=15000;gate.resolve();await read;
   const before=state.calls.flat().length;state.dispatchAt=state.clock;await api._loadDialogTimeRange(range);
   assert.equal(state.calls.flat().length-before,queued?0:1);
  }
  return {afterQueueExtraReads:0,slowServerLoggedTaskRechecks:1};
 });
 console.log(`PASS time refresh: ${phases.length} phases`);
} finally {
 mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});
 writeFileSync(new URL('./artifacts/time-refresh-report.json',import.meta.url),JSON.stringify({phases},null,2));
}

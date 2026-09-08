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
  _PENA_TIME_CONTROL:model, _dialogTimePortalDateKey:range.from, _PENA_TIME_CACHE_TTL_MS:120000, _DIALOG_TIME_CATALOG_REFRESH_MS:10000,
  _DIALOG_TIME_FIRST_WAVE_SIZE:16, _DIALOG_TIME_WAVE_SIZE:50,
  _dialogTimeElapsedEventTimer:null, _dialogTimeElapsedEventScope:'', _dialogTimeCatalogCursor:1, _dialogTimeCatalogScope:'portal:7', _dialogTimeRange:range, _dialogTimeView:'day', _dialogControlNativeWorkspaceTab:'time', _dialogControlNativeSwitcherNode:null,
  _dialogTimeCache:new Map(), _dialogTimeInFlight:new Map(), _dialogTimeForcedRefreshes:new Map(), _dialogTimeRangeRechecks:new Map(),
  _dialogTimeRangeRevisions:new Map(), _dialogTimeTaskRevisions:new Map(), _dialogTimeTaskLogEvidence:new Map(), _dialogTimeTaskChangedAt:new Map(), _dialogTimePanelRefreshes:new Map(),
  _dialogTimeTaskTitles:new Map(), _dialogTimeTaskEligibility:new Map(), _readDialogTaskTimeTrackingFlag:row=>row.ALLOW_TIME_TRACKING==='Y', _rememberDialogTimeTaskChat:()=>{},
  _setDialogTimeTaskEligibility:(id,enabled)=>sandbox._dialogTimeTaskEligibility.set(id,enabled), _parseDialogRecentDate:value=>Date.parse(value)||0,
  _dialogTimeActionInFlight:false, _dialogTimeActiveManualWriteIntent:null, _dialogTimeManualError:'', _dialogTimeManualSelectedTask:null, _dialogTimeManualSearchQuery:'', _dialogTimeManualSearchResults:[],
  _dialogTimeAcknowledgedManualMemory:null, _dialogTimeAccountingRecoveryTimer:null, _dialogTimeAccountingRecoveryAttempt:0, _dialogTimeAccountingRecoveryPromise:null,
  _dialogTimeManualRetryConfirmKey:'', _dialogTimeTrackerRetryConfirmKey:'', _PENA_TIME_MANUAL_DRAFT_KEY:'manual', _PENA_TIME_TRACKER_KEY:'tracker', _dialogTimePortalUtcOffsetMinutes:0,
  _dialogTimeDeleteConfirmEntryId:'', _dialogTimeEditingEntryId:'',
  _getCurrentBitrixUserId:()=> '7', _ensureCurrentBitrixUserId:async()=> '7', _getDialogNativeSharedAuditScopeKey:()=>state.scope,_getDialogTimeIdentityScopeKey:()=>state.scope,
  // CRUD/elapsed tests assume an explicitly configured scope. They do not certify
  // preference persistence or the initial catalog gate; the scope suite does that.
  _getDialogTimeProjectScopeKey:()=>state.scope,_isDialogTimeProjectTask:id=>state.taskIds.includes(String(id)),
  _rememberDialogTimeProjectTask:()=>{},
  _ensureDialogTimeProjectCatalog:async()=>true,
  _getDialogTimeWorkingTaskIds:()=>state.taskIds.slice(), _getDialogTimeSelectedRange:()=>range, _getDialogTimeStatsRange:()=>range,
  _queueDialogTimeUiSync:()=>state.paints.push(sandbox._dialogTimeCache.get('portal:7:2026-09-07:2026-09-07')?.data?.totalSeconds ?? null),
  _loadDialogTimeTaskTitles:async()=>{ state.titleCalls++; }, _getDialogTimeFriendlyError:e=>e.message,
  _isBxRestBatchPressureError:e=>/TIMEOUT|LIMIT|NETWORK/.test(e.code || ''),
  _sleepDialogControl:async()=>{}, _showDialogDockToast:()=>{}, _markDialogTimeTaskAccounted:async()=>true, warn:()=>{},
  _getDialogTimeScopedStorageKey:key=>`${key}:7`,
  _readDialogTimeManualDraft:()=>structuredClone(state.draft || {}), _writeDialogTimeManualDraft:draft=>{state.draft=structuredClone(draft);return !state.storageFailure;},
  _readDialogTimeTracker:()=>structuredClone(state.tracker), _writeDialogTimeTracker:tracker=>{state.tracker=structuredClone(tracker);return !state.storageFailure;},
  _ensureDialogTimeTrackerTick:()=>{}, _ensureDialogTimePortalDate:async()=>{},
  _ensureDialogTimeTaskEligibility:()=>state.eligibility?.promise || Promise.resolve(true),
  _refreshDialogTimeTaskCatalog:async options=>{state.catalogCalls.push(options || {});return true;},
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
 const names=['_invalidateDialogTimeTaskSnapshot','_scheduleDialogTimeElapsedRefresh','_hasDialogTimeVerifiedData','_publishDialogTimeTaskIndexRows','_withDialogTimeTrackerLock','_buildDialogTimeWriteFields','_getDialogTimeTrackerSeconds','_getDialogTimeCacheKey','_setDialogTimeCacheRecord','_invalidateDialogTimeCachesForDates','_applyDialogTimeOptimisticEntry','_removeDialogTimeCachedEntry','_loadDialogTimeRange','_refreshDialogTimePanel','_getDialogTimeSavedItemId','_isDialogTimeDefiniteWriteFailure','_getDialogTimeWriteIntentKey','_withDialogTimeManualWriteLock','_commitDialogTimeManualEntry','_addDialogTimeManualEntry','_deleteDialogTimeEntry','_updateDialogTimeEntry','_stopDialogTimeTracker'];
 names.push('_finishDialogTimeAcknowledgedManualWrite','_scheduleDialogTimeAccountingRecovery','_recoverDialogTimeContactAccounting');
 vm.createContext(sandbox); vm.runInContext(names.map(extract).join('\n'),sandbox);
 state.seed=(entries=[])=>{
  state.entries=structuredClone(entries);
  const data={...model.aggregateElapsedItems(entries),range,pages:1,totalAvailable:entries.length};
  sandbox._dialogTimeCache.set('portal:7:2026-09-07:2026-09-07',{status:'ready',range,data,hasVerifiedData:true,hasCompleteSnapshot:true,updatedAt:state.clock,taskIdsKey:state.taskIds.join(','),taskFreshness:Object.fromEntries(state.taskIds.map(id=>[id,{at:state.clock,revision:0}]))});
 };
 state.record=()=>sandbox._dialogTimeCache.get('portal:7:2026-09-07:2026-09-07');
 return {state,api:sandbox};
}
const entry=(id,task,seconds,date='2026-09-07')=>({ID:String(id),TASK_ID:String(task),USER_ID:'7',SECONDS:seconds,CREATED_DATE:date+'T12:00:00'});
const phases=[];
async function phase(name,fn) { const at=performance.now(); try { const metrics=await fn(); phases.push({name,status:'PASS',ms:performance.now()-at,...metrics}); } catch(e) { phases.push({name,status:'FAIL',ms:performance.now()-at,error:e.stack}); throw e; } }
try {
 await phase('confirmed add retains the existing day and overlapping week immediately',async()=>{
  const {state,api}=fixture();state.seed([entry(1,1,3600),entry(2,2,1800)]);
  const week=model.normalizeRange('2026-09-01','2026-09-07');
  api._dialogTimeCache.set('portal:7:2026-09-01:2026-09-07',{status:'ready',range:week,data:{...model.aggregateElapsedItems(state.entries),range:week},updatedAt:state.clock});
  api._invalidateDialogTimeCachesForDates(range.from,{taskId:'1'});api._applyDialogTimeOptimisticEntry('1',600,range.from,'9');
  assert.equal(state.record().data.totalSeconds,6000);
  assert.equal(api._dialogTimeCache.get('portal:7:2026-09-01:2026-09-07').data.totalSeconds,6000);
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
  assert.deepEqual(state.calls.flat(),[]);return {writes:state.writes.length,reconciledTasks:0};
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
  const cold=state.calls.length;state.clock+=86400000;await api._loadDialogTimeRange(range);assert.equal(state.calls.length,cold);
  api._dialogTimeTaskRevisions.set('117',1);await api._loadDialogTimeRange(range);assert.deepEqual(state.calls.slice(cold).flat(),['117']);
  return {coldTasks:117,coldBatches:cold,unchangedAfterDayReads:0,dirtyTaskReads:1};
 });
 await phase('manual refresh coalesces and completes explicit catalog reconciliation before elapsed',async()=>{
  const {state,api}=fixture(30);state.seed([entry(1,30,600)]);const gate=deferred();state.hold=gate;
  const a=api._refreshDialogTimePanel(range),b=api._refreshDialogTimePanel(range);gate.resolve();await Promise.all([a,b]);
  assert.equal(state.catalogCalls.length,1);assert.equal(state.catalogCalls[0].force,true);assert.equal(state.calls.flat().length,30);
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
  await restored.api._addDialogTimeManualEntry({taskId:'1'},0,10,range.from);await restored.api._recoverDialogTimeContactAccounting();assert.equal(restored.state.writes.length,1);assert.equal(restored.state.draft.pendingWrite,null);
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
 await phase('dispatch metadata survives queue and slow responses without a perpetual age-expiry reread',async()=>{
  for (const queued of [true,false]) {
   const {state,api}=fixture(30);state.entries=[entry(1,1,600)];const gate=deferred();state.hold=gate;
   state.dispatchAt=state.clock+(queued?15000:0);const read=api._loadDialogTimeRange(range);await Promise.resolve();state.clock+=15000;gate.resolve();await read;
   const before=state.calls.flat().length;state.dispatchAt=state.clock;await api._loadDialogTimeRange(range);
   assert.equal(state.calls.flat().length-before,0);assert.ok(state.record().taskFreshness['1'].at>0);
  }
  return {afterQueueExtraReads:0,slowServerLoggedTaskRechecks:0};
 });
 const titleFixture = (known = false) => {
  const state={scope:'portal:7',batches:[],commits:[],nativeFinds:0,gate:null,partial:false,clock:1000000};
  class TitleDate extends Date { static now(){return state.clock;} }
  const api={Date:TitleDate,Promise,document:{visibilityState:'visible'},navigator:{onLine:true},_dialogControlNativeWorkspaceTab:'time',
   _dialogTimeTitleLoadPromise:null,_dialogTimeTitleLoadQueued:false,_dialogTimeTaskTitles:new Map(known?Array.from({length:50},(_,i)=>[String(i+1),'Task '+(i+1)]):[]),_dialogTimeTaskTitleAttempted:new Map(),
   _getDialogNativeSharedAuditScopeKey:()=>state.scope,_getDialogTimeIdentityScopeKey:()=>state.scope,_getDialogTimeProjectScopeKey:()=>state.scope,_isDialogTimeProjectTask:()=>true,_readDialogTimeVisits:()=>[],_findDialogTimeTaskItem:()=>{state.nativeFinds++;return null;},_isDialogTimePlaceholderTaskTitle:(id,title)=>!title,
   _getFreshDialogTimeTaskEligibility:()=>null,_queueDialogTimeUiSync:()=>{},_sleepDialogControl:async()=>{},
   _rememberDialogTimeTaskEligibility:(id,data)=>{state.commits.push(id);api._dialogTimeTaskTitles.set(id,data.task.title);},
   _callBxRestPagesFast:async(jobs,timeout,options)=>{assert.equal(options.isCurrent(),true);state.batches.push(jobs.map(j=>j.params.taskId));if(state.gate)await state.gate.promise;
    const pages=jobs.map(j=>({data:{task:{id:j.params.taskId,title:'Task '+j.params.taskId}}}));
    if(state.partial){pages[0]=undefined;throw Object.assign(new Error('partial'),{partialPages:pages});}return pages;}
  };vm.createContext(api);vm.runInContext(extract('_loadDialogTimeTaskTitles'),api);return{state,api};
 };
 await phase('known titles never create eligibility-only hydration requests',async()=>{
  const {state,api}=titleFixture(true);await api._loadDialogTimeTaskTitles({tasks:Array.from({length:50},(_,i)=>({taskId:String(i+1)}))});assert.equal(state.batches.length,0);assert.equal(state.nativeFinds,0);
  return{knownTitles:50,baselineSingleGets:50,currentRequests:0};
 });
 await phase('missing title batches stop on close or scope change and reject late commits',async()=>{
  for(const kind of ['close','scope']){
   const {state,api}=titleFixture();state.gate=deferred();const request=api._loadDialogTimeTaskTitles({tasks:Array.from({length:120},(_,i)=>({taskId:String(i+1)}))});
   assert.equal(state.batches.length,1);if(kind==='close')api._dialogControlNativeWorkspaceTab='';else state.scope='portal:8';state.gate.resolve();await request;
   assert.equal(state.batches.length,1);assert.equal(state.commits.length,0);assert.equal(api._dialogTimeTaskTitleAttempted.size,0);
  }return{sentBatches:1,unsentTailTasks:70,lateCommits:0};
 });
 await phase('title hydration combines history with current data and preserves partial successes',async()=>{
  const {state,api}=titleFixture();state.partial=true;
  const data={tasks:Array.from({length:25},(_,i)=>({taskId:String(i+1)}))},visits=Array.from({length:25},(_,i)=>({taskId:String(i+26),title:''}));
  await api._loadDialogTimeTaskTitles(data,visits);assert.equal(state.batches.length,1);assert.equal(state.batches[0].length,50);assert.equal(state.commits.length,49);
  state.partial=false;state.clock+=61000;await api._loadDialogTimeTaskTitles(data,visits);assert.equal(state.batches.length,2);assert.deepEqual(Array.from(state.batches[1]),['1']);
  return{firstBatchTasks:50,preservedSuccessfulTitles:49,retryTaskCount:1};
 });

 await phase('live manual intent is sending, recovered intent remains unknown',async()=>{
  const {state,api}=fixture(); const storage=new Map();api.localStorage={getItem:key=>storage.get(key)||null};
  vm.runInContext(extract('_readDialogTimeManualDraft'),api);
  const intent={taskId:'1',seconds:600,dateKey:range.from,operationId:'live',status:'sending'};
  storage.set('manual:7:write-intent',JSON.stringify(intent));
  api._dialogTimeActionInFlight=true;api._dialogTimeActiveManualWriteIntent={operationId:'live',storageKey:'manual:7'};
  assert.equal(api._readDialogTimeManualDraft().pendingWrite.status,'sending');
  api._dialogTimeActiveManualWriteIntent=null;assert.equal(api._readDialogTimeManualDraft().pendingWrite.status,'unknown');
  api._dialogTimeActiveManualWriteIntent={operationId:'other',storageKey:'manual:7'};assert.equal(api._readDialogTimeManualDraft().pendingWrite.status,'unknown');
  api._dialogTimeActiveManualWriteIntent={operationId:'live',storageKey:'manual:8'};assert.equal(api._readDialogTimeManualDraft().pendingWrite.status,'unknown');
  return {live:'sending',reload:'unknown',foreignOperation:'unknown',foreignScope:'unknown'};
 });
 await phase('confirmed add paints and unlocks before local ledger settles without a false write error',async()=>{
  const {state,api}=fixture();state.seed([entry(1,1,3600),entry(2,2,1800)]);
  const ledger=deferred(),toasts=[];api._markDialogTimeTaskAccounted=()=>ledger.promise;api._showDialogDockToast=(message,kind)=>toasts.push({message,kind});
  await api._addDialogTimeManualEntry({taskId:'1'},0,10,range.from);
  assert.ok(state.paints.includes(6000));assert.equal(api._dialogTimeActionInFlight,false);assert.equal(state.calls.length,0);
  assert.equal(api._dialogTimeManualError,'');assert.equal(toasts.filter(t=>t.kind==='ok').length,1);
  ledger.reject(new Error('Storage write failed'));await api._recoverDialogTimeContactAccounting();for(let i=0;i<4;i++)await Promise.resolve();
  assert.equal(api._dialogTimeManualError,'');assert.equal(toasts.filter(t=>t.kind==='danger').length,0);assert.equal(toasts.filter(t=>t.kind==='warning').length,1);
  assert.equal(state.writes.length,1);assert.equal(state.record().data.totalSeconds,6000);
  return {paintBeforeLedgerSeconds:6000,readsAfterAck:0,writeErrors:0,bookkeepingWarnings:1};
 });
 await phase('ADD preserves original freshness only while task snapshot is valid',async()=>{
  for(const mode of ['fresh','old','missing','event']){
   const {state,api}=fixture();state.seed([entry(1,1,3600),entry(2,2,1800)]);const at=state.clock;
   if(mode==='old')state.clock+=86400000;
   if(mode==='missing')delete state.record().taskFreshness['1'];
   if(mode==='event')api._dialogTimeTaskRevisions.set('1',1);
   await api._addDialogTimeManualEntry({taskId:'1'},0,10,range.from);await api._loadDialogTimeRange(range);
   assert.equal(state.record().data.totalSeconds,6000);
   if(mode==='fresh'||mode==='old'){
    assert.equal(state.calls.length,0);assert.equal(state.record().taskFreshness['1'].at,at);
    state.clock+=10001;await api._loadDialogTimeRange(range);assert.deepEqual(state.calls.flat(),[]);
   }else assert.ok(state.calls.flat().includes('1'),mode+' must reconcile');
  }
  return {freshAckReads:0,missingOrInvalidated:'reconciled',ageAloneCausesReads:false};
 });
 await phase('warm validation reports this wave progress independently of existing full coverage',async()=>{
  const {state,api}=fixture(17);state.seed([entry(1,1,600)]);state.record().data.coverage={complete:true,checkedTasks:17,totalTasks:17};
  const gate=deferred();state.hold=gate;const read=api._loadDialogTimeRange(range,{force:true});await Promise.resolve();
  assert.equal(state.record().readProgress.completedTasks,0);assert.equal(state.record().readProgress.totalTasks,17);assert.equal(state.record().data.totalSeconds,600);
  gate.resolve();await read;assert.equal(state.record().readProgress.completedTasks,17);assert.equal(state.record().data.coverage.complete,true);
  return {initialCompleted:0,finalCompleted:17,retainedSeconds:600};
 });

 await phase('first elapsed snapshot stays unverified while every response is held',async()=>{
  const {state,api}=fixture(1);
  const gate=deferred();state.hold=gate;const pending=api._loadDialogTimeRange(range);
  await Promise.resolve();assert.equal(state.record().status,'loading');assert.equal(state.record().readProgress.completedTasks,0);
  assert.equal(api._hasDialogTimeVerifiedData(state.record()),false);
  gate.resolve();await pending;
  assert.equal(api._hasDialogTimeVerifiedData(state.record()),true);assert.equal(state.record().data.totalSeconds,0);
  return {beforeFirstResponseVerified:false,actualEmptyResponseVerified:true,actualSeconds:0};
 });
 await phase('confirmed empty selected catalog needs no elapsed requests and stays verified while a new task loads',async()=>{
  const {state,api}=fixture(0);await api._loadDialogTimeRange(range);
  assert.equal(api._hasDialogTimeVerifiedData(state.record()),true);assert.equal(state.calls.length,0);
  state.taskIds=['1'];const gate=deferred();state.hold=gate;const pending=api._loadDialogTimeRange(range);await Promise.resolve();
  assert.equal(api._hasDialogTimeVerifiedData(state.record()),true);assert.equal(state.record().data.totalSeconds,0);
  gate.reject(Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'}));await assert.rejects(pending);
  assert.equal(state.record().status,'error');assert.equal(api._hasDialogTimeVerifiedData(state.record()),true);
  return {emptyCatalogReads:0,confirmedZeroRetainedOnLoad:true,confirmedZeroRetainedOnError:true};
 });
 await phase('unknown catalog scope and failed first read cannot confirm synthetic zero; positive ACK can',async()=>{
  const {state,api}=fixture(0);api._dialogTimeCatalogCursor=state.clock;api._dialogTimeCatalogScope='portal:8';api._ensureDialogTimeProjectCatalog=async()=>false;await api._loadDialogTimeRange(range);
  assert.equal(api._hasDialogTimeVerifiedData(state.record()),false);
  api._dialogTimeCatalogScope=state.scope;state.taskIds=['1'];const gate=deferred();state.hold=gate;const pending=api._loadDialogTimeRange(range);await Promise.resolve();
  gate.reject(Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'}));await assert.rejects(pending);assert.equal(api._hasDialogTimeVerifiedData(state.record()),false);
  api._invalidateDialogTimeCachesForDates(range.from,{taskId:'1'});api._applyDialogTimeOptimisticEntry('1',600,range.from,'101');
  assert.equal(api._hasDialogTimeVerifiedData(state.record()),true);assert.equal(state.record().data.totalSeconds,600);
  return {foreignCatalogVerified:false,failedReadVerified:false,confirmedAddSeconds:600};
 });

 await phase('dirty task arriving during a held wave is rechecked once without restarting accepted tasks',async()=>{
  const {state,api}=fixture(117);state.entries=[entry(1,1,600)];const gate=deferred();state.hold=gate;
  const first=api._loadDialogTimeRange(range);await Promise.resolve();api._dialogTimeTaskRevisions.set('1',1);
  state.entries[0].SECONDS=900;gate.resolve();await first;
  assert.equal(state.record().data.coverage.checkedTasks,116);assert.equal(state.record().data.coverage.complete,false);
  const before=state.calls.flat().length;await api._loadDialogTimeRange(range);
  assert.deepEqual(state.calls.flat().slice(before),['1']);assert.equal(state.record().data.totalSeconds,900);
  assert.equal(state.record().data.coverage.complete,true);return {initialTasks:117,dirtyDuringReadRechecks:1,finalSeconds:900};
 });
 await phase('cancelled cold sweep resumes remaining task IDs and never ages out completed waves',async()=>{
  const {state,api}=fixture(117);state.entries=[entry(1,1,600)];
  api._sleepDialogControl=async()=>{api._dialogControlNativeWorkspaceTab='';};await api._loadDialogTimeRange(range);
  assert.equal(state.record().data.coverage.checkedTasks,16);assert.equal(state.calls.flat().length,16);
  state.clock+=86400000;api._dialogControlNativeWorkspaceTab='time';api._sleepDialogControl=async()=>{};
  await api._loadDialogTimeRange(range);assert.equal(state.calls.flat().length,117);assert.equal(new Set(state.calls.flat()).size,117);
  assert.equal(state.record().data.coverage.complete,true);return {completedBeforeClose:16,remainingAfterReopen:101,repeatedTaskReads:0};
 });

 await phase('complete snapshot provenance waits for catalog and elapsed tails and survives targeted invalidation',async()=>{
  const {state,api}=fixture(117);api._dialogTimeCatalogCursor=0;
  const catalog=deferred();api._ensureDialogTimeProjectCatalog=async()=>{await catalog.promise;api._dialogTimeCatalogCursor=state.clock;return true;};
  const gate=deferred();state.hold=gate;const tail=api._loadDialogTimeRange(range);await Promise.resolve();
  assert.equal(state.calls.length,0);assert.equal(state.record(),undefined);
  catalog.resolve();while(!state.calls.length)await Promise.resolve();
  assert.equal(state.record().hasCompleteSnapshot,false);gate.resolve();await tail;
  assert.equal(state.calls.flat().length,117);assert.equal(state.record().hasCompleteSnapshot,true);
  api._dialogTimeTaskRevisions.set('1',1);const dirty=deferred();state.hold=dirty;const refresh=api._loadDialogTimeRange(range);
  await Promise.resolve();assert.equal(state.record().hasCompleteSnapshot,true);dirty.resolve();await refresh;
  assert.equal(state.record().hasCompleteSnapshot,true);return {beforeCatalogElapsed:0,full117Complete:true,dirtyRetainsCompleteProvenance:true};
 });
 await phase('confirmed empty selected catalog yields a complete snapshot without elapsed requests',async()=>{
  const {state,api}=fixture(0);await api._loadDialogTimeRange(range);assert.equal(state.record().hasCompleteSnapshot,true);assert.equal(state.record().data.coverage.checkedTasks,0);assert.equal(state.record().data.coverage.totalTasks,0);assert.equal(state.record().data.coverage.complete,true);
  state.taskIds=['1'];const hold=deferred();state.hold=hold;const read=api._loadDialogTimeRange(range);await Promise.resolve();
  assert.equal(state.record().hasCompleteSnapshot,true);hold.resolve();await read;assert.equal(state.calls.flat().length,1);
  return {emptyFullSnapshot:true,newTaskRetainsProvenance:true};
 });
 await phase('manual refresh joins a cold pass and concurrent forced calls share one warm audit',async()=>{
  const {state,api}=fixture(117);api._dialogTimeCatalogCursor=state.clock;const hold=deferred();state.hold=hold;
  const cold=api._loadDialogTimeRange(range);await Promise.resolve();const manual=api._refreshDialogTimePanel(range);hold.resolve();await Promise.all([cold,manual]);
  assert.equal(state.calls.flat().length,117);assert.equal(state.record().hasCompleteSnapshot,true);
  const next=deferred();state.hold=next;const a=api._loadDialogTimeRange(range,{force:true});await Promise.resolve();const b=api._loadDialogTimeRange(range,{force:true});
  next.resolve();await Promise.all([a,b]);assert.equal(state.calls.flat().length,234);
  return {coldPlusManualTasks:117,twoForcedCallersTasks:117};
 });

 await phase('event wake during an accepted or held page drains one dirty task automatically',async()=>{
  for(const accepted of [false,true]){
   const {state,api}=fixture(117);state.entries=[entry(1,1,600)];api._dialogTimeCatalogCursor=state.clock;
   const gate=deferred();if(!accepted)state.hold=gate;else api._sleepDialogControl=async()=>{if(state.calls.length===1)state.hold=gate;};
   const first=api._loadDialogTimeRange(range);
   for(let i=0;i<40&&!state.held;i++)await Promise.resolve();assert.ok(state.held);
   state.entries[0].SECONDS=900;api._dialogTimeTaskRevisions.set('1',1);
   const wakeA=api._loadDialogTimeRange(range),wakeB=api._loadDialogTimeRange(range);
   gate.resolve();await Promise.all([first,wakeA,wakeB]);
   assert.equal(state.calls.flat().length,118);assert.equal(state.calls.flat().filter(id=>id==='1').length,2);
   assert.equal(state.record().data.totalSeconds,900);assert.equal(state.record().data.coverage.complete,true);
  }
  return {initialTasks:117,dirtyRechecks:1,repeatedWakeExtraReads:0};
 });

 await phase('qualified task invalidation is closed-panel silent, visible debounced and scope fenced',async()=>{
  const {state,api}=fixture(117);state.seed([entry(1,1,600)]);const timers=new Map();let nextTimer=0;
  api.setTimeout=fn=>{timers.set(++nextTimer,fn);return nextTimer;};api.clearTimeout=id=>timers.delete(id);
  api._dialogControlNativeWorkspaceTab='';assert.equal(api._invalidateDialogTimeTaskSnapshot('1'),true);
  assert.equal(timers.size,0);assert.equal(state.calls.length,0);
  state.entries[0].SECONDS=900;api._dialogControlNativeWorkspaceTab='time';await api._loadDialogTimeRange(range);
  assert.deepEqual(state.calls.flat(),['1']);assert.equal(state.record().data.totalSeconds,900);
  api._invalidateDialogTimeTaskSnapshot('1');api._invalidateDialogTimeTaskSnapshot('1');assert.equal(timers.size,1);
  const callback=timers.values().next().value;timers.clear();callback();await api._dialogTimeInFlight.get('portal:7:2026-09-07:2026-09-07');
  assert.deepEqual(state.calls.flat(),['1','1']);
  api._invalidateDialogTimeTaskSnapshot('1');const old=timers.values().next().value;timers.clear();state.scope='portal:8';old();
  assert.equal(state.calls.flat().length,2);assert.equal(api._invalidateDialogTimeTaskSnapshot('not-a-task'),false);
  return {closedReads:0,closedTimers:0,reopenTaskReads:1,twoVisibleEventsTaskReads:1,foreignScopeReads:0};
 });
 await phase('inaccessible task keeps last data and retries only on manual refresh or new task evidence',async()=>{
  const {state,api}=fixture(2);state.seed([entry(1,1,600),entry(2,2,900)]);state.denied=new Set(['1']);
  await assert.rejects(api._loadDialogTimeRange(range,{force:true}));assert.equal(state.record().data.totalSeconds,1500);
  const before=state.calls.flat().length;state.clock+=86400000;await api._loadDialogTimeRange(range);assert.equal(state.calls.flat().length,before);
  assert.equal(state.record().status,'error');assert.equal(state.record().data.coverage.complete,false);
  state.denied.clear();await api._loadDialogTimeRange(range,{force:true});assert.equal(state.record().data.coverage.complete,true);
  state.denied.add('1');await assert.rejects(api._loadDialogTimeRange(range,{force:true}));state.denied.clear();state.clock+=15001;
  api._dialogTimeTaskRevisions.set('1',(api._dialogTimeTaskRevisions.get('1')||0)+1);const dirtyBefore=state.calls.flat().length;await api._loadDialogTimeRange(range);
  assert.deepEqual(state.calls.flat().slice(dirtyBefore),['1']);assert.equal(state.record().status,'ready');
  return {unchangedDeniedRetryReads:0,preservedSeconds:1500,manualRecovery:true,newEvidenceRecoveryTasks:1};
 });

 await phase('new task evidence bypasses a failed revision once while repeated failures keep backoff',async()=>{
  const {state,api}=fixture(2);state.seed([entry(1,1,600),entry(2,2,900)]);state.denied=new Set(['1']);
  await assert.rejects(api._loadDialogTimeRange(range,{force:true}));const before=state.calls.flat().length;
  api._dialogTimeTaskRevisions.set('1',1);await assert.rejects(api._loadDialogTimeRange(range));assert.deepEqual(state.calls.flat().slice(before),['1']);
  const failedAgain=state.calls.flat().length;await api._loadDialogTimeRange(range);await api._loadDialogTimeRange(range);
  assert.equal(state.calls.flat().length,failedAgain);assert.equal(state.record().failedTaskRevisions['1'],1);
  state.denied.clear();api._dialogTimeTaskRevisions.set('1',2);state.entries[0].SECONDS=1200;await api._loadDialogTimeRange(range);
  assert.deepEqual(state.calls.flat().slice(failedAgain),['1']);assert.equal(state.record().data.totalSeconds,2100);assert.equal(state.record().status,'ready');
  return {firstNewRevisionImmediateReads:1,repeatedFailedRevisionReads:0,recoveredNewRevisionReads:1,seconds:2100};
 });
 await phase('revision arriving during a failed request is retained as a new immediate recheck',async()=>{
  const {state,api}=fixture(2);state.seed([entry(1,1,600),entry(2,2,900)]);const gate=deferred();state.hold=gate;
  const failing=api._loadDialogTimeRange(range,{force:true});await Promise.resolve();api._dialogTimeTaskRevisions.set('1',1);state.entries[0].SECONDS=1200;
  gate.reject(Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'}));await assert.rejects(failing);
  assert.equal(state.record().failedTaskRevisions['1'],0);const before=state.calls.flat().length;await api._loadDialogTimeRange(range);
  assert.deepEqual(state.calls.flat().slice(before),['1']);assert.equal(state.record().data.totalSeconds,2100);
  return {failureCapturedRevision:0,newRevision:1,immediateTaskReads:1,globalTransportPolicy:'unchanged'};
 });
 await phase('catalog expansion during first read cannot promote incomplete range through a fast path',async()=>{
  const {state,api}=fixture(16),gate=deferred();state.hold=gate;const pending=api._loadDialogTimeRange(range);await Promise.resolve();
  state.taskIds.push('17');api._dialogTimeCatalogCursor=state.clock;gate.resolve();await pending;
  assert.equal(state.record().hasCompleteSnapshot,false);const before=state.calls.flat().length;await api._loadDialogTimeRange(range);
  assert.deepEqual(state.calls.flat().slice(before),['17']);assert.equal(state.record().hasCompleteSnapshot,true);
  return {beforeLateTaskAcceptedComplete:false,lateTaskReads:1,afterLateTaskAcceptedComplete:true};
 });
 await phase('manual ACK receipt survives failed bookkeeping and reload without another ADD or consuming during-write contact',async()=>{
  const {state,api}=fixture(1);state.clock=Date.parse('2026-09-07T10:00:00Z');state.seed([]);
  let rows=model.applyQualifiedContact([],{taskId:'1',eventId:'before',qualifiedAt:state.clock-20000,reason:'message'});
  const gate=deferred();state.writeHold=gate;api._markDialogTimeTaskAccounted=async()=>false;
  const add=api._addDialogTimeManualEntry({taskId:'1'},0,10,range.from);for(let i=0;i<8;i++)await Promise.resolve();
  const cutoff=state.clock;state.clock+=20000;rows=model.applyQualifiedContact(rows,{taskId:'1',eventId:'during',qualifiedAt:state.clock,reason:'message'});
  gate.resolve();await add;await api._recoverDialogTimeContactAccounting();
  assert.equal(state.draft.pendingWrite.status,'acknowledged');assert.equal(state.draft.pendingWrite.contactCutoffAt,cutoff);assert.equal(state.draft.pendingWrite.itemId,'101');
  const reload=fixture(1);reload.state.draft=structuredClone(state.draft);reload.state.entries=structuredClone(state.entries);
  reload.api._markDialogTimeTaskAccounted=async(id,at,day,options)=>{assert.equal(day,range.from);rows=model.markActivityAccounted(rows,`task:${id}`,at,options);return true;};
  await reload.api._recoverDialogTimeContactAccounting();assert.equal(reload.state.draft.pendingWrite,null);assert.equal(reload.state.writes.length,0);
  const tracked=model.aggregateElapsedItems([{...state.entries[0],DATE_START:new Date(state.clock+1000).toISOString()}]).tasks;
  assert.equal(model.selectUntrackedVisits(rows,tracked)[0].pendingContacts,1);
  return{serverAdds:state.writes.length,reloadAdds:0,immutableCutoff:cutoff,pendingContacts:1};
 });
 await phase('timer saved segments retain immutable contact cutoff and metadata recovery never repeats ADD',async()=>{
  const {state,api}=fixture(1);state.clock=Date.parse('2026-09-07T10:00:10Z');state.seed([]);
  const stoppedAt=state.clock;state.tracker={taskId:'1',startedAt:state.clock-10000,dateKey:range.from,pendingSeconds:0};
  api._markDialogTimeTaskAccounted=async()=>false;await api._stopDialogTimeTracker();
  assert.equal(state.tracker.saveSegments[0].status,'saved');assert.equal(state.tracker.saveSegments[0].contactsCutoffAt,stoppedAt);assert.equal(state.tracker.saveSegments[0].contactsAccounted,false);
  const reload=fixture(1);reload.state.tracker=structuredClone(state.tracker);const marks=[];
  reload.api._markDialogTimeTaskAccounted=async(...args)=>{marks.push(args);return true;};
  await reload.api._recoverDialogTimeContactAccounting();assert.equal(reload.state.tracker,null);assert.equal(reload.state.writes.length,0);
  assert.equal(marks[0][1],stoppedAt);assert.equal(marks[0][3].itemId,'101');
  return{savedSeconds:10,originalAdds:1,reloadAdds:0,receiptCutoff:stoppedAt};
 });
 await phase('acknowledged intent parsing survives ordinary form reset and stale foreign ACK cannot clear it',async()=>{
  const {api}=fixture();const storage=new Map();api.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  vm.runInContext(extract('_readDialogTimeManualDraft')+'\n'+extract('_writeDialogTimeManualDraft'),api);
  const intent={operationId:'ack1',taskId:'1',seconds:600,dateKey:range.from,status:'acknowledged',itemId:'101',attemptedAt:1000,contactCutoffAt:1000};
  storage.set('manual:7:write-intent',JSON.stringify(intent));
  api._writeDialogTimeManualDraft(null);assert.equal(api._readDialogTimeManualDraft().pendingWrite.status,'acknowledged');
  assert.equal(api._writeDialogTimeManualDraft({pendingWrite:null},{writeIntent:true,resolvePendingKey:'old-operation'}),false);
  assert.equal(api._readDialogTimeManualDraft().pendingWrite.itemId,'101');return{formResetPreserved:true,staleAckRejected:true};
 });
 await phase('late manual ACK or rejection preserves the new project draft and keeps the old write identity',async()=>{
  const results=[];
  for(const outcome of ['ack','rejected','unknown']){
   const {state,api}=fixture(1),storage=new Map(),gate=deferred();let projectScope='project-A';
   api._getDialogTimeProjectScopeKey=()=>projectScope;
   api.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
   vm.runInContext(extract('_readDialogTimeManualDraft')+'\n'+extract('_writeDialogTimeManualDraft'),api);
   api._writeDialogTimeManualDraft({taskId:'1',title:'Task A',query:'Task A',hours:'0',minutes:'10',dateKey:range.from});
   state.writeHold=gate;if(outcome==='rejected')state.rejectFalse=true;if(outcome==='unknown')state.noId=true;
   const add=api._commitDialogTimeManualEntry({taskId:'1',title:'Task A'},0,10,range.from);
   for(let i=0;i<20&&!state.writes.length;i++)await Promise.resolve();assert.equal(state.writes.length,1);
   const original=api._readDialogTimeManualDraft().pendingWrite;assert.equal(original.taskId,'1');assert.equal(original.seconds,600);
   projectScope='project-B';state.taskIds=['2'];api._dialogTimeCatalogScope=projectScope;
   api._writeDialogTimeManualDraft({taskId:'2',title:'Task B',query:'Task B',hours:'0',minutes:'17',dateKey:range.from});
   const selected={taskId:'2',title:'Task B'},searchResults=[selected];
   api._dialogTimeManualSelectedTask=selected;api._dialogTimeManualSearchQuery='Task B';api._dialogTimeManualSearchResults=searchResults;
   const hours={value:'0'},minutes={value:'17'};
   api._dialogControlNativeSwitcherNode={querySelector:()=>({querySelector:selector=>selector.endsWith('hours')?hours:minutes})};
   gate.resolve();await add;
   const draft=api._readDialogTimeManualDraft();
   assert.equal(draft.taskId,'2');assert.equal(draft.query,'Task B');assert.equal(draft.minutes,'17');assert.equal(draft.hours,'0');
   assert.equal(api._dialogTimeManualSelectedTask,selected);assert.equal(api._dialogTimeManualSearchQuery,'Task B');assert.equal(api._dialogTimeManualSearchResults,searchResults);
   assert.equal(hours.value,'0');assert.equal(minutes.value,'17');assert.equal(state.writes.length,1);
   assert.equal(state.writes[0].params.TASKID,1);assert.equal(state.writes[0].params.ARFIELDS.SECONDS,600);
   if(outcome==='rejected')assert.equal(draft.pendingWrite,null);
   else {assert.equal(draft.pendingWrite.operationId,original.operationId);assert.equal(draft.pendingWrite.taskId,'1');assert.equal(draft.pendingWrite.seconds,600);assert.equal(draft.pendingWrite.status,outcome==='ack'?'acknowledged':'unknown');if(outcome==='ack')assert.equal(draft.pendingWrite.itemId,'101');}
   results.push({outcome,draftTask:draft.taskId,draftMinutes:draft.minutes,serverWrites:state.writes.length,pendingStatus:draft.pendingWrite?.status||'none'});
  }
  return {results};
 });
 await phase('acknowledged timer clear failure stays neutral and retries bookkeeping without another ADD',async()=>{
  const {state,api}=fixture(1);state.clock=Date.parse('2026-09-07T10:00:10Z');state.seed([]);
  state.tracker={taskId:'1',startedAt:state.clock-10000,dateKey:range.from,pendingSeconds:0};
  let failClear=true;const toasts=[];api._showDialogDockToast=(message,kind)=>toasts.push({message,kind});
  api._writeDialogTimeTracker=value=>{if(value===null&&failClear)return false;state.tracker=structuredClone(value);return true;};
  await api._stopDialogTimeTracker();assert.equal(state.tracker.saveSegments[0].status,'saved');assert.equal(state.tracker.saveSegments[0].contactsAccounted,true);
  assert.equal(toasts.some(toast=>toast.kind==='danger'),false);assert.equal(state.writes.length,1);
  failClear=false;await api._recoverDialogTimeContactAccounting();assert.equal(state.tracker,null);assert.equal(state.writes.length,1);
  return{positiveAckAdds:1,metadataRetryAdds:0,falseWriteErrors:0};
 });
 console.log(`PASS time refresh: ${phases.length} phases`);
} finally {
 mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});
 writeFileSync(new URL('./artifacts/time-refresh-report.json',import.meta.url),JSON.stringify({phases},null,2));
}

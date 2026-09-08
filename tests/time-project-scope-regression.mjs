import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

// Actual preference, project catalog and elapsed loader. Only storage/SDK/DOM
// services are controlled; no configured/complete/membership production bypass.
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const model=createRequire(import.meta.url)('../extension/native-time-control.js');
const extract=name=>{const at=source.search(new RegExp('\\t(?:async )?function '+name+'\\('));assert(at>=0,name);return source.slice(at,source.indexOf('\n\t}',at)+4);};
async function until(predicate){for(let i=0;i<1000;i++){if(predicate())return;await Promise.resolve();}throw new Error('Controlled request did not reach its expected gate');}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const choice=(ids=['10'],includeUnassigned=false)=>({version:1,all:false,ids,includeUnassigned});
const task=(id,group='10')=>({ID:String(id),TITLE:'Task '+id,GROUP_ID:group,ALLOW_TIME_TRACKING:id===101?'N':'Y'});
const report={sourceSha:createHash('sha256').update(source).digest('hex'),phases:[],limitations:'Production helpers in VM with controlled SDK/storage; no live portal, DOM settings clicks or physical device timing.'};
async function phase(name,fn){try{report.phases.push({name,status:'PASS',evidence:await fn()});}catch(error){report.phases.push({name,status:'FAIL',error:error.stack});}}
function fixture(storage=new Map()){
 const state={scope:'portal.test~7',now:1000000,storage,storageFailure:false,rows:[...Array.from({length:101},(_,i)=>task(i+1)),task(201,'20'),task(202,'20'),task(301,'0')],calls:[],elapsed:[],catalogHook:null,elapsedHook:null,ignoredFilter:false};
 class Clock extends Date{static now(){return state.now++;}}
 const range={from:'2026-09-07',to:'2026-09-07'};
 const c=vm.createContext({Date:Clock,Map,Set,Promise,clearTimeout:()=>{},setTimeout:()=>0,
  document:{visibilityState:'visible'},navigator:{onLine:true},_PENA_TIME_CONTROL:model,
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(state.storageFailure)throw new Error('storage denied');storage.set(key,value);}},
  _getDialogNativeSharedAuditScopeKey:()=>state.scope,_getCurrentBitrixUserId:()=>state.scope.split('~').at(-1),_isDialogTimeFrameActive:()=>true,
  _dialogTimeProjectPreference:null,_dialogTimeProjectGeneration:0,_dialogTimeProjectTaskIds:new Set(),_dialogTimeProjectCatalogOwner:null,_dialogTimeProjectListOwner:null,
  _dialogTaskCatalogLastResult:null,_dialogTaskCatalogScopeKey:'',_dialogTaskCatalogFetchedAt:0,_dialogTaskCatalogSyncFlights:new Map(),
  _dialogTimeProjectCatalogError:null,_dialogTimeProjectCatalogDirty:false,_dialogTimeCatalogScope:'',_dialogTimeCatalogCursor:0,
  _dialogTimeManualSearchToken:0,_dialogTimeManualSelectedTask:null,_dialogTimeManualSearchQuery:'',_dialogTimeManualSearchResults:[],_dialogTimeManualSearchTimer:null,
  _dialogTimeRange:range,_dialogTimeView:'day',_dialogControlNativeWorkspaceTab:'time',_dialogTimePortalDateKey:range.from,
  _dialogTimePortalUtcOffsetMinutes:0,
  _dialogTimeBootstrapToken:null,_dialogTimeBootstrapPromise:null,_dialogTimeBootstrapSequence:0,
  _dialogTimeCache:new Map(),_dialogTimeInFlight:new Map(),_dialogTimeRangeRevisions:new Map(),_dialogTimeTaskRevisions:new Map(),
  _dialogTimeForcedRefreshes:new Map(),_dialogTimeRangeRechecks:new Map(),_dialogTimePanelRefreshes:new Map(),
  _dialogTimeTaskTitles:new Map([['999','Foreign task']]),_dialogTimeTaskEligibility:new Map([['999',true]]),
  _DIALOG_TIME_FIRST_WAVE_SIZE:16,_DIALOG_TIME_WAVE_SIZE:50,_queueDialogTimeUiSync:()=>{},_loadDialogTimeTaskTitles:async()=>{},
  _sleepDialogControl:async()=>{},_getDialogTimeFriendlyError:error=>error.message,_isBxRestBatchPressureError:()=>false,
  _getDialogTimeTodayKey:()=>range.from,_syncDialogTimePortalDay:()=>{},_ensureDialogTimePortalDate:async()=>range.from,
  _extractDialogTaskCatalogRows:data=>data.tasks,
  _publishDialogTimeTaskIndexRows:rows=>rows.forEach(row=>c._dialogTimeTaskTitles.set(String(row.ID),row.TITLE)),
  _getDialogTimeTaskEligibilityForDisplay:()=>true,_getDialogRecentUniqueMeta:()=>[{isTask:true,taskId:'999',title:'Foreign task',id:'chat999'}],
  _getDialogControlItemsForMode:()=>[],_isDialogControlFolder:()=>false,_readDialogTimeVisits:()=>[{taskId:'999',title:'Foreign task'}],normId:value=>value||'',
  _callBxRestPageWithTimeout:async(method,params,timeout,options)=>{
   assert.equal(method,'tasks.task.list');assert.equal(options.isCurrent(),true);
   assert(params.filter.GROUP_ID||params.filter['>GROUP_ID']===0||c._readDialogTimeProjectPreference()?.all&&c._readDialogTimeProjectPreference()?.includeUnassigned,'Unscoped request without explicit all+unassigned choice');
   const request={scope:c._getDialogTimeProjectScopeKey(),params:structuredClone(params)};state.calls.push(request);
   let rows=state.rows.filter(row=>Number(row.ID)>Number(params.filter['>ID']||0));
   if(!state.ignoredFilter){if(params.filter.GROUP_ID)rows=rows.filter(row=>params.filter.GROUP_ID.includes(row.GROUP_ID));else if(params.filter['>GROUP_ID']===0)rows=rows.filter(row=>Number(row.GROUP_ID)>0);}
   const data={tasks:structuredClone(rows.slice(0,50))};if(state.catalogHook)await state.catalogHook(request);
   return {data,next:rows.length>50?50:null};
  },
  _callDialogTimeElapsedPages:async jobs=>{
   const requested=jobs.map(p=>String(p[0]));state.elapsed.push(...requested);
   const result=jobs.map(p=>({data:[{ID:String(p[0]),TASK_ID:String(p[0]),USER_ID:String(p[2].USER_ID),SECONDS:60,CREATED_DATE:p[2]['>=CREATED_DATE'].slice(0,10)+'T12:00:00'}]}));
   if(state.elapsedHook)await state.elapsedHook(requested);return result;
  }
 });
 const names=['_normalizeDialogTimeProjectPreference','_getDialogTimeProjectStorageKey','_readDialogTimeProjectPreference','_getDialogTimeProjectScopeKey','_getDialogTimeProjectFilter','_matchesDialogTimeProjectTask','_isDialogTimeProjectTask','_rememberDialogTimeProjectTask','_pruneDialogTimeProjectSnapshots','_saveDialogTimeProjectPreference','_getDialogTimeReusableNativeCatalog','_ensureDialogTimeProjectCatalog','_getDialogTaskKeysetCursor','_getDialogTimeWorkingTaskIds','_getDialogTimeCacheKey','_getDialogTimeRecord','_setDialogTimeCacheRecord','_hasDialogTimeVerifiedData','_loadDialogTimeRange','_scheduleDialogTimeBootstrap','_getDialogTimeLocalTaskSearchResults','_buildDialogTimeWriteFields','_applyDialogTimeOptimisticEntry'];
 vm.runInContext(names.map(extract).join('\n'),c);
 return {state,c,range,save:value=>c._saveDialogTimeProjectPreference(value),load:()=>{const promise=c._loadDialogTimeRange(range);promise.catch(()=>{});return promise;},record:()=>c._getDialogTimeRecord(range)};
}

await phase('unconfigured startup and direct range requests perform no catalog or elapsed reads',async()=>{
 const f=fixture();await f.c._scheduleDialogTimeBootstrap();await f.load();await f.load();
 assert.equal(f.state.calls.length,0);assert.equal(f.state.elapsed.length,0);assert.equal(f.record(),null);assert.equal(f.c._getDialogTimeProjectScopeKey(),'');
 return {catalogRequests:0,elapsedRequests:0};
});
await phase('save persists before activation; reload preserves choice; failures and malformed data remain unconfigured',async()=>{
 const f=fixture();f.state.storageFailure=true;assert.throws(()=>f.save(choice()),/storage denied/);assert.equal(f.c._getDialogTimeProjectScopeKey(),'');await f.load();assert.equal(f.state.elapsed.length,0);
 f.state.storageFailure=false;f.state.storage.set('contact-journal','immutable');f.save(choice(['20','10','20']));const scope=f.c._getDialogTimeProjectScopeKey();assert.equal(f.save(choice(['10','20'])),false);assert.equal(f.c._getDialogTimeProjectScopeKey(),scope);
 const reloaded=fixture(f.state.storage);assert.deepEqual(Array.from(reloaded.c._readDialogTimeProjectPreference().ids),['10','20']);assert.equal(reloaded.state.storage.get('contact-journal'),'immutable');
 for(const raw of ['{broken','{"version":1,"all":false,"ids":[]}','{"version":9,"all":true,"ids":[]}']){const bad=fixture(new Map([['pena.timeProjects.v1.portal.test~7',raw]]));await bad.load();assert.equal(bad.state.elapsed.length,0);}
 return {persistedIds:['10','20'],failedSaveReads:0};
});
await phase('held catalog tail prevents every elapsed request; committed membership excludes global cache IDs',async()=>{
 const f=fixture();f.save(choice());const gate=deferred();let held=false;f.state.catalogHook=async request=>{if(request.params.filter['>ID']===100){held=true;await gate.promise;}};
 const read=f.load();await until(()=>held);assert.equal(f.state.elapsed.length,0);assert.equal(f.c._dialogTimeCatalogCursor,0);assert.equal(f.c._dialogTimeProjectTaskIds.size,0);assert.equal(f.record(),null);
 gate.resolve();await read;assert.equal(f.state.calls.length,3);assert.equal(f.state.elapsed.length,101);assert.equal(new Set(f.state.elapsed).size,101);assert(!f.state.elapsed.includes('999'));assert.equal(f.record().data.totalSeconds,6060);
 const before=f.state.calls.length;await f.load();assert.equal(f.state.calls.length,before);assert.equal(f.state.elapsed.length,101);
 assert.equal(f.c._getDialogTimeLocalTaskSearchResults('Foreign').length,0);
 return {beforeTailElapsed:0,afterTailUnique:101,historicalDisabledIncluded:f.state.elapsed.includes('101'),warmExtraReads:0};
});
await phase('server ignoring GROUP_ID fails without publishing membership or elapsed',async()=>{
 const f=fixture();f.save(choice(['20']));f.state.ignoredFilter=true;await assert.rejects(f.load(),/вне выбранных/);assert.equal(f.state.elapsed.length,0);assert.equal(f.c._dialogTimeCatalogCursor,0);assert.equal(f.c._dialogTimeProjectTaskIds.size,0);
 return {requestsBeforeError:1,elapsed:0};
});
await phase('old catalog response cannot clear a new project owner or publish its rows',async()=>{
 const f=fixture(),a=deferred(),b=deferred();let heldA=false,heldB=false;f.save(choice());
 f.state.catalogHook=async request=>{if(request.params.filter.GROUP_ID?.[0]==='10'){heldA=true;await a.promise;}else{heldB=true;await b.promise;}};
 const old=f.load();await until(()=>heldA);f.save(choice(['20']));const fresh=f.load();await until(()=>heldB);const owner=f.c._dialogTimeProjectCatalogOwner;
 a.resolve();await old;assert.equal(f.c._dialogTimeProjectCatalogOwner,owner);assert.equal(f.state.elapsed.length,0);b.resolve();await fresh;
 assert.deepEqual(Array.from(f.c._dialogTimeProjectTaskIds),['201','202']);assert.deepEqual(f.state.elapsed,['201','202']);return {lateOldRowsAccepted:0,newElapsed:2};
});
await phase('A to B to A revokes the old elapsed generation despite matching project IDs',async()=>{
 const f=fixture();f.save(choice());const gate=deferred();let held=false;f.state.elapsedHook=async()=>{if(!held){held=true;await gate.promise;}};const old=f.load();await until(()=>held);const oldKey=f.c._getDialogTimeCacheKey(f.range);
 f.save(choice(['20']));f.save(choice());const newKey=f.c._getDialogTimeCacheKey(f.range);assert.notEqual(newKey,oldKey);await f.load();const good=f.record();gate.resolve();await old;assert.equal(f.record(),good);assert.equal(good.data.totalSeconds,6060);assert.equal(f.c._dialogTimeCache.get(oldKey).data,null);
 return {newGenerationTotal:6060,oldGenerationAccepted:false};
});
await phase('user and portal switches require their own preference and discard pending old catalog',async()=>{
 for(const scope of ['portal.test~8','other.test~7']){const f=fixture();f.save(choice());const gate=deferred();let held=false;f.state.catalogHook=async()=>{held=true;await gate.promise;};const read=f.load();await until(()=>held);f.state.scope=scope;gate.resolve();await read;await f.load();assert.equal(f.c._getDialogTimeProjectScopeKey(),'');assert.equal(f.state.elapsed.length,0);assert.equal(f.record(),null);}
 return {foreignScopes:2,foreignElapsed:0};
});
await phase('explicit all and unassigned policies have distinct membership and preserve selected IDs',async()=>{
 const f=fixture();f.save({version:1,all:true,ids:[],includeUnassigned:false});await f.load();assert.equal(f.state.elapsed.length,103);assert(!f.state.elapsed.includes('301'));assert.equal(f.state.calls[0].params.filter['>GROUP_ID'],0);
 f.save(choice([],true));f.state.elapsed=[];await f.load();assert.deepEqual(f.state.elapsed,['301']);
 f.save({version:1,all:true,ids:[],includeUnassigned:true});f.state.elapsed=[];await f.load();assert.equal(f.state.elapsed.length,104);
 return {allProjects:103,onlyUnassigned:1,explicitEverything:104};
});
await phase('manual full replacement removes moved tasks from membership and cached totals',async()=>{
 const f=fixture();f.save(choice());await f.load();f.state.rows=f.state.rows.map(row=>row.ID==='1'?{...row,GROUP_ID:'20'}:row).filter(row=>row.ID!=='2');const before=f.state.calls.length;
 await f.c._ensureDialogTimeProjectCatalog({force:true});assert(!f.c._dialogTimeProjectTaskIds.has('1'));assert(!f.c._dialogTimeProjectTaskIds.has('2'));assert.equal(f.record().data.totalSeconds,5940);
 assert(f.state.calls.slice(before).every(call=>!call.params.filter['>=CHANGED_DATE']));return {remainingMembers:99,visibleSeconds:5940};
});
await phase('confirmed write for the previous selection cannot add a foreign task to current totals',async()=>{
 const f=fixture();f.save(choice());await f.load();f.save(choice(['20']));await f.load();assert.equal(f.record().data.totalSeconds,120);
 // Same path as a positive ADD acknowledgement or timer recovery after its
 // project selection changed while awaiting the server. The write still exists.
 f.c._applyDialogTimeOptimisticEntry('1',600,f.range.from,'saved-old-project');
 assert.equal(f.record().data.totalSeconds,120,'Confirmed A write polluted selected B');assert(f.record().data.items.every(item=>['201','202'].includes(item.taskId)));
 return {newSelectionSeconds:120,foreignWriteSeconds:600,foreignProjection:0};
});
await phase('only a fresh complete same-user native catalog with group metadata can replace scoped discovery',async()=>{
 for(const invalid of ['', 'partial', 'head', 'scope', 'stale', 'missingGroup']){
  const f=fixture();f.save(choice());f.c._dialogTaskCatalogLastResult={complete:invalid!=='partial',headOnly:invalid==='head',rows:structuredClone(f.state.rows),startedAt:999800};
  f.c._dialogTaskCatalogScopeKey=invalid==='scope'?'other.test~7':f.state.scope;f.c._dialogTaskCatalogFetchedAt=invalid==='stale'?900000:999900;
  if(invalid==='missingGroup')delete f.c._dialogTaskCatalogLastResult.rows[0].GROUP_ID;
  await f.load();assert.equal(f.state.elapsed.length,101);assert.equal(f.state.calls.length,invalid?3:0,invalid||'valid reuse');assert.equal(f.record().data.totalSeconds,6060);
 }
 return {validReuseOwnCatalogRequests:0,invalidProofVariants:5,eachInvalidScopedPages:3};
});
await phase('configured all joins a running native full owner without duplicate catalog or early elapsed',async()=>{
 const f=fixture(),gate=deferred();f.save({version:1,all:true,ids:[],includeUnassigned:true});f.c._dialogTaskCatalogSyncFlights.set(f.state.scope+':full',gate.promise);
 const read=f.load();await Promise.resolve();await Promise.resolve();assert.equal(f.state.calls.length,0);assert.equal(f.state.elapsed.length,0);
 f.c._dialogTaskCatalogLastResult={complete:true,rows:structuredClone(f.state.rows),startedAt:999800};f.c._dialogTaskCatalogScopeKey=f.state.scope;f.c._dialogTaskCatalogFetchedAt=999900;gate.resolve();await read;
 assert.equal(f.state.calls.length,0);assert.equal(f.state.elapsed.length,104);assert.equal(new Set(f.state.elapsed).size,104);assert.equal(f.c._dialogTimeCatalogCursor,999800);
 return {duplicateCatalogRequests:0,beforeNativeProofElapsed:0,afterNativeProofElapsed:104};
});

mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/time-project-scope-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(report.phases.some(p=>p.status==='FAIL'))process.exitCode=1;

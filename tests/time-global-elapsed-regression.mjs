import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const model = createRequire(import.meta.url)('../extension/native-time-control.js');
const source = readFileSync(new URL('../extension/injected.js', import.meta.url), 'utf8');
const range = { from:'2026-09-08', to:'2026-09-08' };
const raw = (id, task=id, user=7, day=range.from, seconds=60) => ({ ID:String(id), TASK_ID:String(task), USER_ID:String(user), SECONDS:seconds, CREATED_DATE:`${day}T12:00:00+03:00`, DATE_START:`${day}T12:01:00+03:00` });
const rows321 = () => [...Array.from({length:321}, (_,i)=>raw(i+1)), raw(1000,1,8), raw(1001,1,7,'2026-09-07')];
const extract = name => { const at=source.search(new RegExp('\\t(?:async )?function '+name+'\\(')); assert(at>=0,name); return source.slice(at,source.indexOf('\n\t}',at)+4); };
const deferred = () => { let resolve; const promise=new Promise(r=>resolve=r); return {promise,resolve}; };
async function until(test) { for(let i=0;i<2000;i++){ if(test())return; await Promise.resolve(); } throw new Error('Expected gate not reached'); }
const report={sourceSha:createHash('sha256').update(source).digest('hex'),phases:[],limitations:'Actual model/load/transport functions with controlled server; no live portal claim. Global sentinel proven in mirrored Bitrix23.675.0 PHP; runtime capability is verified.'};
async function phase(name,fn){const start=performance.now();try{const evidence=await fn();report.phases.push({name,status:'PASS',ms:performance.now()-start,evidence});}catch(error){report.phases.push({name,status:'FAIL',error:error.stack});}}
function backend(rows=rows321()) {
 const state={rows,calls:[],mode:'normal',hook:null};
 const call=async params=>{
  const [taskId,order,filter,,nav]=params;state.calls.push(structuredClone(params));
  if(state.hook)await state.hook(params);
  if(taskId===0&&state.mode==='unsupported')throw Object.assign(new Error('Task not found'),{code:'TASK_NOT_FOUND'});
  if(taskId===0&&state.mode==='numeric-unsupported')throw Object.assign(new Error('0x000100'),{code:'0x000100'});
  if(taskId===0&&state.mode==='timeout')throw Object.assign(new Error('Timeout'),{code:'TIMEOUT'});
  if(taskId===0&&state.mode==='silent-empty')return{data:[],total:0,next:null};
  let selected=state.rows.filter(row=>(!taskId||String(taskId)===row.TASK_ID)&&String(filter.USER_ID)===row.USER_ID&&
    (filter.ID==null||String(filter.ID)===row.ID)&&(filter['>ID']==null||Number(row.ID)>Number(filter['>ID']))&&
    (!filter['>=CREATED_DATE']||row.CREATED_DATE>=filter['>=CREATED_DATE'])&&(!filter['<CREATED_DATE']||row.CREATED_DATE<filter['<CREATED_DATE']));
  selected.sort((a,b)=>(Number(a.ID)-Number(b.ID))*(String(order.ID).toUpperCase()==='DESC'?-1:1));
  const total=selected.length,size=nav.NAV_PARAMS.nPageSize,start=(nav.NAV_PARAMS.iNumPage-1)*size;
  return{data:structuredClone(selected.slice(start,start+size)),total,next:null,requestedAt:Date.now()};
 };
 return{state,call};
}
function fixture(count=4149) {
 const api=backend(),ids=Array.from({length:count},(_,i)=>String(i+1));
 const state={scope:'portal~7:projects:*:1:g1',identity:'portal~7',user:'7',pointCalls:[],catalogCalls:0,catalogHold:null};
 const c=vm.createContext({ Date, Map, Set, Promise, document:{visibilityState:'visible'}, navigator:{onLine:true}, _PENA_TIME_CONTROL:model,
  _dialogTimeRange:range,_dialogTimeView:'day',_dialogControlNativeWorkspaceTab:'time',_dialogTimePortalDateKey:range.from,
  _dialogTimeCache:new Map(),_dialogTimeInFlight:new Map(),_dialogTimeRangeRevisions:new Map(),_dialogTimeTaskRevisions:new Map(),_dialogTimeTaskLogEvidence:new Map(),
  _dialogTimeTaskChangedAt:new Map(),_dialogTimeTaskTitles:new Map(),_dialogTimeTaskEligibility:new Map(),_parseDialogRecentDate:Date.parse,
  _readDialogTaskTimeTrackingFlag:()=>true,_rememberDialogTimeTaskChat:()=>{},_setDialogTimeTaskEligibility:()=>{},
  _dialogTimeForcedRefreshes:new Map(),_dialogTimeRangeRechecks:new Map(),_dialogTimePanelRefreshes:new Map(),_dialogTimeCatalogCursor:1,_dialogTimeCatalogScope:state.scope,
  _DIALOG_TIME_FIRST_WAVE_SIZE:16,_DIALOG_TIME_WAVE_SIZE:50,_getDialogTimeIdentityScopeKey:()=>state.identity,_getDialogTimeProjectScopeKey:()=>state.scope,_getCurrentBitrixUserId:()=>state.user,
  _getDialogTimeWorkingTaskIds:()=>ids.filter(id=>!c._isDialogTimeTaskExcluded(id)),_getDialogTimeFriendlyError:e=>e.message,_isBxRestBatchPressureError:e=>e.code==='TIMEOUT',
  _runDialogRecentJobs:async(jobs,worker)=>{for(const job of jobs)await worker(job);},
  _queueDialogTimeUiSync:()=>{},_loadDialogTimeTaskTitles:async()=>{},_sleepDialogControl:async()=>{},
  _ensureDialogTimeProjectCatalog:async()=>{state.catalogCalls++;if(state.catalogHold)await state.catalogHold.promise;c._dialogTimeCatalogCursor=1;c._dialogTimeCatalogScope=state.scope;return true;},
  _callBxRestPageWithTimeout:async(method,params,_timeout,options)=>{assert.equal(options.isCurrent(),true);if(method==='tasks.task.get')return{data:{task:{id:params.taskId}}};assert.equal(method,'task.elapseditem.getlist');return api.call(params);},
  _callDialogTimeElapsedPages:async params=>{state.pointCalls.push(...params.map(p=>p[0]));return Promise.all(params.map(api.call));},
  _isDialogTimeProjectTask:id=>ids.includes(String(id)),_buildDialogTimeWriteFields:(_seconds,date)=>({CREATED_DATE:`${date}T12:00:00+03:00`}),
 });
 vm.runInContext(['_isDialogTimeTaskExcluded','_confirmDialogTimeTaskUnavailable','_callDialogTimeGlobalElapsedPage','_getDialogTimeCacheKey','_hasDialogTimeVerifiedData','_setDialogTimeCacheRecord','_loadDialogTimeRange','_invalidateDialogTimeCachesForDates','_applyDialogTimeOptimisticEntry','_publishDialogTimeTaskIndexRows'].map(extract).join('\n'),c);
 return{api,state,c,ids,load:options=>c._loadDialogTimeRange(range,options),record:()=>c._dialogTimeCache.get(c._getDialogTimeCacheKey(range))};
}
await phase('global321 records use7 keyset pages; other users/days excluded and zero-duration IDs retained',async()=>{
 const f=backend();f.state.rows[0].SECONDS=0;const result=await model.loadGlobalElapsedItems({callPage:f.call,...range,userId:'7'});
 assert.equal(result.supported,true);assert.equal(result.entryCount,321);assert.equal(result.totalSeconds,320*60);assert.equal(f.state.calls.length,7);
 assert.deepEqual(f.state.calls.map(p=>p[2]['>ID']),[0,50,100,150,200,250,300]);assert.ok(f.state.calls.every(p=>p[0]===0&&p[4].NAV_PARAMS.iNumPage===1));
 return{entries:321,pages:7,legacyTaskReads:4149};
});
await phase('empty global response needs an own historical witness; unresolved zero is not complete',async()=>{
 const unknown=backend([]),answer=await model.loadGlobalElapsedItems({callPage:unknown.call,...range,userId:7});assert.equal(answer.supported,false);assert.equal(answer.reason,'empty-unverified');assert.equal(unknown.state.calls.length,2);
 const known=backend([raw(5,2,7,'2026-09-07')]),empty=await model.loadGlobalElapsedItems({callPage:known.call,...range,userId:7});assert.equal(empty.supported,true);assert.equal(empty.entryCount,0);assert.equal(known.state.calls.length,2);
});
await phase('empty range contradicted by exact saved-ID witness fails closed',async()=>{
 const f=backend([raw(9)]);const call=async p=>p[2].ID?f.call(p):{data:[],total:0,next:null};
 await assert.rejects(model.loadGlobalElapsedItems({callPage:call,...range,userId:7,knownItems:[model.normalizeElapsedItem(raw(9))]}),e=>e.code==='GLOBAL_TIME_RESPONSE_INVALID');
});
await phase('strict row validation rejects foreign user/day, invalid IDs and malformed seconds',async()=>{
 const variants=[{USER_ID:'8'},{CREATED_DATE:'2026-09-07T10:00:00Z'},{CREATED_DATE:null},{ID:'0'},{TASK_ID:'0'},{TASK_ID:'9007199254740993'},{SECONDS:null},{SECONDS:'wrong'},{SECONDS:-1},{SECONDS:1.5},{SECONDS:false},{SECONDS:[]}];
 for(const patch of variants)await assert.rejects(model.loadGlobalElapsedItems({callPage:async()=>({data:[{...raw(1),...patch}],next:null,total:1}),...range,userId:7}),e=>e.code==='GLOBAL_TIME_RESPONSE_INVALID');
 return{malformedVariants:variants.length};
});
await phase('partial/error global envelopes cannot become a complete snapshot or trigger legacy fanout',async()=>{
 for(const envelope of [{partial:true},{complete:false},{error:{code:'QUERY_LIMIT_EXCEEDED'}}]){
  const f=fixture();f.c._callBxRestPageWithTimeout=async()=>({data:[raw(1)],total:1,next:null,...envelope});
  await assert.rejects(f.load(),e=>['GLOBAL_TIME_RESPONSE_INCOMPLETE','QUERY_LIMIT_EXCEEDED'].includes(e.code));
  assert.equal(f.state.pointCalls.length,0);assert.equal(f.record().hasCompleteSnapshot,false);
 }
});
await phase('repeated pages and deletion between pages retain strict ID completeness',async()=>{
 const f=backend(Array.from({length:101},(_,i)=>raw(i+1)));let n=0;const call=async p=>{const result=await f.call(p);if(!n++)f.state.rows.shift();return result;};
 const data=await model.loadGlobalElapsedItems({callPage:call,...range,userId:7});assert.equal(data.entryCount,101);assert.ok(data.items.some(i=>i.id==='51'));
 let calls=0;await assert.rejects(model.loadGlobalElapsedItems({callPage:async()=>{calls++;return{data:Array.from({length:50},(_,i)=>raw(i+1)),total:100,next:null};},...range,userId:7}),e=>e.code==='GLOBAL_TIME_RESPONSE_INVALID');assert.equal(calls,2);
});
await phase('definite unsupported permits fallback; quota and timeout never fan out',async()=>{
 const f=backend();f.state.mode='unsupported';assert.equal((await model.loadGlobalElapsedItems({callPage:f.call,...range,userId:7})).reason,'unsupported');
 f.state.mode='timeout';await assert.rejects(model.loadGlobalElapsedItems({callPage:f.call,...range,userId:7}),e=>e.code==='TIMEOUT');
 const integrated=fixture();integrated.api.state.mode='timeout';await assert.rejects(integrated.load(),e=>e.code==='TIMEOUT');assert.equal(integrated.api.state.calls.length,1);assert.equal(integrated.state.pointCalls.length,0);assert.equal(integrated.record().hasCompleteSnapshot,false);
 const coldDiagnostics=integrated.c._callDialogTimeGlobalElapsedPage.diagnostics;
 assert.equal(coldDiagnostics.attemptedGlobalPages,1);assert.equal(coldDiagnostics.errorCode,'TIMEOUT');assert.equal(coldDiagnostics.state,'error');assert.ok(coldDiagnostics.durationMs>=0);assert.equal(integrated.record().errorCode,'TIMEOUT');
 const saved=fixture(3);saved.api.state.rows=[raw(1),raw(2),raw(3)];await saved.load();saved.api.state.mode='timeout';
 await assert.rejects(saved.load({force:true}),e=>e.code==='TIMEOUT');assert.equal(saved.record().data.totalSeconds,180);assert.equal(saved.record().hasVerifiedData,true);
 const diagnostics=saved.c._callDialogTimeGlobalElapsedPage.diagnostics;
 assert.equal(diagnostics.attemptedGlobalPages,1);assert.equal(diagnostics.errorCode,'TIMEOUT');assert.equal(diagnostics.state,'error');assert.equal(saved.state.pointCalls.length,0);
});
await phase('numeric/core sentinel refusal requires one validated ordinary-task probe',async()=>{
 const codes=['0x000001','0x000004','0x000100','0x100002','ERROR_CORE','ACTION_NOT_ALLOWED','ACCESS_DENIED'];
 for(const code of codes)for(const empty of [false,true]){
  const calls=[];const result=await model.loadGlobalElapsedItems({...range,userId:7,probeTaskId:'2',callPage:async p=>{
   calls.push(p);if(p[0]===0)throw Object.assign(new Error(code),{code});
   return{data:empty?[]:[raw(2)],total:empty?0:1,next:null};
  }});
  assert.equal(result.supported,false);assert.equal(result.reason,'unsupported-confirmed-by-task');assert.equal(result.items,undefined,'Probe is not a time snapshot');
  assert.deepEqual(calls.map(p=>p[0]),[0,2]);assert.equal(calls[1][4].NAV_PARAMS.nPageSize,1);assert.equal(calls[1][2].USER_ID,7);
  assert.equal(calls[1][2]['>=CREATED_DATE'],range.from+'T00:00:00');
 }
 return{codes:codes.length,probeRequestsPerRefusal:1,probeCanConfirmSnapshot:false};
});
await phase('failed, foreign, malformed or superseded probes never authorize legacy fanout',async()=>{
 const variants=[{data:[raw(2,99)]},{data:[raw(2,2,8)]},{data:[raw(2,2,7,'2026-09-07')]},{data:[{...raw(2),SECONDS:null}]},{data:[],partial:true},{data:[],complete:false},{data:[],error:{code:'ACCESS_DENIED'}},{data:[raw(1),raw(2)]},{throwCode:'TIMEOUT'},{throwCode:'QUERY_LIMIT_EXCEEDED'},{throwCode:'ACCESS_DENIED'},{throwCode:'0x000004'}];
 for(const variant of variants){
  const calls=[];await assert.rejects(model.loadGlobalElapsedItems({...range,userId:7,probeTaskId:2,callPage:async p=>{
   calls.push(p);if(p[0]===0)throw Object.assign(new Error('Invalid parameters'),{code:'0x000100'});
   if(variant.throwCode)throw Object.assign(new Error(variant.throwCode),{code:variant.throwCode});return variant;
  }}),e=>e.code==='0x000100'&&!e.globalFallback);assert.deepEqual(calls.map(p=>p[0]),[0,2]);
 }
 for(const code of ['TIMEOUT','QUERY_LIMIT_EXCEEDED','OPERATION_TIME_LIMIT','OVERLOAD_LIMIT','INTERNAL_SERVER_ERROR','0x000040']){
  let calls=0;await assert.rejects(model.loadGlobalElapsedItems({...range,userId:7,probeTaskId:2,callPage:async()=>{calls++;throw Object.assign(new Error(code),{code});}}),e=>e.code===code);assert.equal(calls,1);
 }
 for(const probeTaskId of ['',0,-1,'9007199254740993']){
  let calls=0;await assert.rejects(model.loadGlobalElapsedItems({...range,userId:7,probeTaskId,callPage:async()=>{calls++;throw Object.assign(new Error('0x000100'),{code:'0x000100'});}}),e=>e.code==='0x000100');assert.equal(calls,1);
 }
 let current=true,calls=0;await assert.rejects(model.loadGlobalElapsedItems({...range,userId:7,probeTaskId:2,isCurrent:()=>current,callPage:async p=>{calls++;if(p[0]===0)throw Object.assign(new Error('0x000100'),{code:'0x000100'});current=false;return{data:[]};}}),e=>e.code==='SUPERSEDED');assert.equal(calls,2);
 const partialCalls=[];await assert.rejects(model.loadGlobalElapsedItems({...range,userId:7,probeTaskId:2,callPage:async p=>{partialCalls.push(p);if(partialCalls.length===1)return{data:Array.from({length:50},(_,i)=>raw(i+1)),total:51};throw Object.assign(new Error('ERROR_CORE'),{code:'ERROR_CORE'});}}),e=>e.code==='ERROR_CORE');assert.ok(partialCalls.every(p=>p[0]===0),'Later-page errors must not trigger a capability probe');
 return{failedProbeVariants:variants.length,pressureOrUnknownNoProbe:6,invalidProbeIds:4};
});
await phase('numeric unsupported fallback reuses safe empty-log proofs and reads only logged task',async()=>{
 const f=fixture(100);f.api.state.rows=[raw(1)];f.api.state.mode='numeric-unsupported';
 for(let id=2;id<=100;id++)f.c._dialogTimeTaskLogEvidence.set(String(id),{scope:f.state.identity,revision:0,at:Date.now()});
 const data=await f.load();assert.equal(data.totalSeconds,60);assert.equal(data.entryCount,1);assert.equal(f.record().hasCompleteSnapshot,true);
 assert.deepEqual(f.state.pointCalls,[1]);assert.deepEqual(f.api.state.calls.map(p=>p[0]),[0,1,1]);
 const before=f.api.state.calls.length;await f.load();assert.equal(f.api.state.calls.length,before);assert.equal(f.c._callDialogTimeGlobalElapsedPage.diagnostics.fallbackReason,'unsupported-confirmed-by-task');
 for(const kind of ['invalidated','foreign','expired','future']){
  const held=fixture(4),gate=deferred();held.api.state.rows=[raw(1),raw(2)];held.api.state.mode='numeric-unsupported';
  for(let id=2;id<=4;id++)held.c._dialogTimeTaskLogEvidence.set(String(id),{scope:held.state.identity,revision:0,at:Date.now()});
  held.api.state.hook=async p=>{if(p[0]===1&&p[4].NAV_PARAMS.nPageSize===1)await gate.promise;};
  const load=held.load();await until(()=>held.api.state.calls.length===2);
  const proof=held.c._dialogTimeTaskLogEvidence.get('2');
  if(kind==='invalidated')held.c._dialogTimeTaskRevisions.set('2',1);
  if(kind==='foreign')proof.scope='other~9';
  if(kind==='expired')proof.at=Date.now()-60001;
  if(kind==='future')proof.at=Date.now()+60000;
  gate.resolve();await load;assert.deepEqual(held.state.pointCalls,[1,2],kind+' evidence must be rejected after probe wait');assert.equal(held.record().data.totalSeconds,120);assert.equal(held.record().data.coverage.complete,true);
 }
 const known=fixture(3);known.api.state.rows=[raw(1),raw(2)];await known.load();assert.equal(known.record().data.totalSeconds,120);
 known.api.state.mode='numeric-unsupported';for(const id of ['1','3'])known.c._dialogTimeTaskLogEvidence.set(id,{scope:known.state.identity,revision:0,at:Date.now()});
 const readGate=deferred();known.api.state.hook=async p=>{if(p[0]!==0&&p[4].NAV_PARAMS.nPageSize===50)await readGate.promise;};
 const reread=known.load({force:true});await until(()=>known.state.pointCalls.length>0);assert.deepEqual(known.state.pointCalls,[1,2]);
 assert.equal(known.record().data.totalSeconds,120,'Null evidence cannot erase a known record while per-task GET is held');assert.equal(known.c._dialogTimeTaskLogEvidence.has('1'),false);
 readGate.resolve();await reread;assert.deepEqual(known.state.pointCalls,[1,2]);assert.equal(known.record().data.totalSeconds,120);
 const swapped=fixture(3),scopeGate=deferred();swapped.api.state.mode='numeric-unsupported';swapped.api.state.hook=async p=>{if(p[0]!==0)await scopeGate.promise;};
 const stale=swapped.load();await until(()=>swapped.api.state.calls.length===2);swapped.state.scope='other~9:projects:*:1:g2';swapped.state.identity='other~9';swapped.state.user='9';scopeGate.resolve();await stale;
 assert.equal(swapped.state.pointCalls.length,0);assert.equal(swapped.record(),undefined);assert.equal(swapped.c._callDialogTimeGlobalElapsedPage.capabilities.size,0,'Stale probe cannot set capability for either identity');
 const waves=fixture(100),waveGate=deferred();waves.api.state.mode='numeric-unsupported';waves.api.state.rows=Array.from({length:18},(_,i)=>raw(i+1));
 for(let id=19;id<=100;id++)waves.c._dialogTimeTaskLogEvidence.set(String(id),{scope:waves.state.identity,revision:0,at:Date.now()});
 waves.api.state.hook=async p=>{if(p[0]!==0&&p[4].NAV_PARAMS.nPageSize===50)await waveGate.promise;};const waveLoad=waves.load();await until(()=>waves.state.pointCalls.length===16);
 assert.equal(waves.state.pointCalls.length,16,'First legacy wave stays bounded after probe');waveGate.resolve();await waveLoad;assert.equal(waves.state.pointCalls.length,18);assert.equal(waves.record().data.totalSeconds,1080);
 return{tasks:100,globalAttempts:1,ordinaryProbes:1,legacyTaskReads:1,warmRequests:0,rejectedProofVariants:4,knownSecondsPreserved:120,firstWaveTasks:16};
});
await phase('actual load pipeline:4149 tasks with missing/positive all-time fields uses global7; warm0; dirty1; manual7',async()=>{
 for(const fieldKind of ['missing','all-positive']){
  const f=fixture();
  f.c._publishDialogTimeTaskIndexRows(f.ids.map(ID=>({ID,TITLE:`Task ${ID}`,GROUP_ID:'1',...(fieldKind==='all-positive'?{TIME_SPENT_IN_LOGS:3600}:{})})),{scope:f.state.identity,at:Date.now(),revisions:new Map()});
  assert.equal(f.c._dialogTimeTaskLogEvidence.size,0,'Missing/positive task totals cannot fake checked journals');
  const data=await f.load();assert.equal(data.entryCount,321);assert.equal(data.totalSeconds,19260);assert.equal(f.api.state.calls.length,7);assert.equal(f.state.pointCalls.length,0);assert.equal(f.record().hasCompleteSnapshot,true);
  await f.load();assert.equal(f.api.state.calls.length,7);
  f.c._dialogTimeTaskRevisions.set('2',1);await f.load();assert.equal(f.state.pointCalls.length,1);assert.equal(f.api.state.calls.length,8);
  await f.load({force:true});assert.equal(f.api.state.calls.length,15);assert.equal(f.c._callDialogTimeGlobalElapsedPage.diagnostics.strategy,'global');
  assert.equal(f.c._callDialogTimeGlobalElapsedPage.diagnostics.pages,7);
 }
 return{tasks:4149,ownEntries:321,seconds:19260,coldGlobalPages:7,warmRequests:0,dirtyRequests:1,manualGlobalPages:7};
});
await phase('global read waits for catalog; project intersection and late task revision stay fenced',async()=>{
 const f=fixture(50),hold=deferred();f.c._dialogTimeCatalogCursor=0;f.state.catalogHold=hold;const load=f.load();await until(()=>f.state.catalogCalls===1);assert.equal(f.api.state.calls.length,0);hold.resolve();const result=await load;
 assert.equal(result.entryCount,50);assert.equal(result.totalSeconds,3000);assert.equal(f.api.state.calls.length,7);
 const late=fixture(),gate=deferred();late.api.state.hook=async()=>{late.api.state.hook=null;await gate.promise;};const loading=late.load();await until(()=>late.api.state.calls.length===1);late.c._dialogTimeTaskRevisions.set('2',1);gate.resolve();await loading;
 assert.equal(late.record().data.coverage.complete,false);assert.equal(late.record().globalSnapshotRead,true);await late.load();assert.deepEqual(late.state.pointCalls,[2]);assert.equal(late.record().data.coverage.complete,true);
});
await phase('unknown-empty backend falls back once per identity; known cache is kept while point reads are held',async()=>{
 const f=fixture(3);f.api.state.mode='silent-empty';const data=await f.load();assert.equal(data.totalSeconds,180);assert.equal(f.api.state.calls.filter(p=>p[0]===0).length,2);assert.equal(f.state.pointCalls.length,3);
 await f.load();await f.load({force:true});assert.equal(f.api.state.calls.filter(p=>p[0]===0).length,2);assert.equal(f.state.pointCalls.length,6);assert.equal(f.record().data.totalSeconds,180);
 assert.equal(f.c._callDialogTimeGlobalElapsedPage.diagnostics.fallbackReason,'empty-unverified');
 const held=fixture(3);held.api.state.rows=Array.from({length:3},(_,i)=>raw(i+1));await held.load();held.api.state.mode='silent-empty';const gate=deferred();
 held.api.state.hook=async params=>{if(params[0]!==0)await gate.promise;};const refresh=held.load({force:true});await until(()=>held.state.pointCalls.length===3);
 assert.equal(held.record().data.totalSeconds,180,'Unverified global empty erased the previous value before corroboration');gate.resolve();await refresh;assert.equal(held.record().data.totalSeconds,180);
});
await phase('late pre-ACK global reply and identity switch cannot overwrite current totals',async()=>{
 const f=fixture();await f.load();const hold=deferred();f.api.state.hook=async()=>{f.api.state.hook=null;await hold.promise;};const reading=f.load({force:true});await until(()=>f.api.state.calls.length===8);
 f.c._invalidateDialogTimeCachesForDates(range.from,{taskId:'1',preserveTaskFreshness:true});f.c._applyDialogTimeOptimisticEntry('1',600,range.from,'99999');assert.equal(f.record().data.totalSeconds,19860);hold.resolve();await reading;assert.equal(f.record().data.totalSeconds,19860);
 const before=f.api.state.calls.length;await f.load();assert.equal(f.api.state.calls.length,before,'ACK snapshot needs no eager repeat read');
 const swap=fixture(),gate=deferred();swap.api.state.hook=async()=>{swap.api.state.hook=null;await gate.promise;};const old=swap.load();await until(()=>swap.api.state.calls.length===1);swap.state.scope='other~8:projects:*:1:g2';swap.state.identity='other~8';swap.state.user='8';gate.resolve();await old;assert.equal(swap.record(),undefined);
});
await phase('Save All projects keeps old confirmed totals while rebuilding scope, then uses global pages rather than N task reads',async()=>{
 const f=fixture(50);await f.load();assert.equal(f.record().data.totalSeconds,3000);assert.equal(f.record().globalSnapshotRead,true);
 vm.runInContext(extract('_migrateDialogTimeProjectSnapshots'),f.c);
 const previousScope=f.state.scope;f.state.scope='portal~7:projects:*:1:g2';
 f.c._migrateDialogTimeProjectSnapshots({all:false,ids:['1'],includeUnassigned:false},{all:true,ids:[],includeUnassigned:true},previousScope,f.state.scope,{persistPreview:false});
 f.ids.push(...Array.from({length:4099},(_,i)=>String(i+51)));f.c._dialogTimeCatalogCursor=0;
 assert.equal(f.record().globalSnapshotRead,false);assert.equal(f.record().hasCompleteSnapshot,false);assert.equal(f.record().data.totalSeconds,3000);
 const gate=deferred();f.state.catalogHold=gate;const calls=f.api.state.calls.length;const load=f.load();await until(()=>f.state.catalogCalls===1);
 assert.equal(f.api.state.calls.length,calls);assert.equal(f.record().data.totalSeconds,3000);gate.resolve();await load;
 assert.equal(f.api.state.calls.length-calls,7);assert.equal(f.state.pointCalls.length,0);assert.equal(f.record().data.totalSeconds,19260);assert.equal(f.record().hasCompleteSnapshot,true);
 return{preservedWhileLoading:3000,finalSeconds:19260,expandedTaskCount:4149,globalPages:7,pointReads:0};
});
await phase('one revoked task cannot block sentinel capability detection or discard other tasks in a batch',async()=>{
 const calls=[];
 const capability=await model.loadGlobalElapsedItems({...range,userId:7,probeTaskId:1,probeTaskIds:[1,2,3],callPage:async p=>{
  calls.push(p[0]);if(p[0]===0||p[0]===1)throw Object.assign(new Error('Access denied'),{code:'0x000004'});return {data:[]};
 }});
 assert.equal(capability.supported,false);assert.deepEqual(calls,[0,1,2]);
 const f=fixture(80);f.api.state.mode='unsupported';f.api.state.rows=Array.from({length:80},(_,i)=>raw(i+1));
 f.c._callDialogTimeElapsedPages=async params=>{
  f.state.pointCalls.push(...params.map(p=>p[0]));
  const partialPages=await Promise.all(params.map(p=>Number(p[0])===2?null:f.api.call(p)));
  if(partialPages.includes(null))throw Object.assign(new Error('Access denied'),{partialPages,partialErrors:params.map(p=>Number(p[0])===2?{code:'0x000004',message:'Access denied'}:null)});
  return partialPages;
 };
 await assert.rejects(f.load(),/Не удалось проверить задачи: 1/);
 assert.equal(f.state.pointCalls.length,80);assert.equal(f.record().data.entryCount,79);assert.equal(f.record().data.totalSeconds,79*60);assert.equal(f.record().hasCompleteSnapshot,false);
 f.record().taskFreshness['2'].at=Date.now()-16000;f.record().failedAt=Date.now()-16000;
 f.c._callDialogTimeElapsedPages=async params=>{assert.deepEqual(Array.from(params,p=>Number(p[0])),[2]);return Promise.all(params.map(f.api.call));};
 await f.load();assert.equal(f.record().data.entryCount,80);assert.equal(f.record().hasCompleteSnapshot,true);
 return {accessibleRecordsPreserved:79,inaccessibleTasks:1,recoveryReads:1};
});
await phase('documented Desktop task access errors do not stop the journal at a missing task',async()=>{
 const adapter=vm.createContext({_PENA_TIME_CONTROL:model});
 vm.runInContext([extract('_createBxRestError'),extract('_normalizeBxRestPageResult'),extract('_getDialogTimeFriendlyError')].join('\n'),adapter);
 let nativeError;
 try { adapter._normalizeBxRestPageResult({error:()=>({getError:()=>({error:'ERROR_CORE',error_description:'0x000001'})}),error_description:()=>undefined}); } catch(error) { nativeError=error; }
 assert.equal(nativeError.code,'ERROR_CORE');assert.equal(nativeError.message,'0x000001');
 assert.equal(model.isElapsedAccessError(nativeError),true);assert.match(adapter._getDialogTimeFriendlyError(nativeError),/Нет доступа/);
 for(const error of [{code:'ERROR_CORE',message:'0x000001'}, {code:'ERROR_CORE',description:'ACTION_NOT_ALLOWED'}, {code:'0x000001'}]) {
  assert.equal(model.isElapsedAccessError(error),true,JSON.stringify(error));
 }
 assert.equal(model.isElapsedAccessError({code:'ERROR_CORE',message:'0x000100'}),false);
 const calls=[];
 const capability=await model.loadGlobalElapsedItems({...range,userId:7,probeTaskIds:[1,2],callPage:async params=>{
  calls.push(params[0]);if(params[0]!==2)throw Object.assign(new Error('0x000001'),{code:'ERROR_CORE'});return{data:[]};
 }});
 assert.equal(capability.supported,false);assert.deepEqual(calls,[0,1,2]);
 const f=fixture(80);f.api.state.mode='unsupported';f.api.state.rows=Array.from({length:80},(_,i)=>raw(i+1));
 f.c._callDialogTimeElapsedPages=async params=>{
  f.state.pointCalls.push(...params.map(p=>p[0]));
  const partialPages=await Promise.all(params.map(p=>Number(p[0])===2?null:f.api.call(p)));
  if(partialPages.includes(null))throw Object.assign(new Error('0x000001'),{code:'ERROR_CORE',partialPages,partialErrors:params.map(p=>Number(p[0])===2?{code:'ERROR_CORE',message:'0x000001'}:null)});
  return partialPages;
 };
 await assert.rejects(f.load());assert.equal(f.record().data.entryCount,79);assert.equal(f.state.pointCalls.length,80);assert.equal(f.record().hasCompleteSnapshot,false);
});
await phase('only confirmed view denial excludes tasks; transient errors, scope and late replies cannot hide them',async()=>{
 const f=fixture(1);f.api.state.mode='unsupported';f.api.state.rows=[raw(1)];await f.load();
 const original=f.c._callBxRestPageWithTimeout;
 const deny=error=>{f.c._callBxRestPageWithTimeout=async()=>{throw Object.assign(new Error(error.message),{code:error.code});};};
 for(const error of [{code:'TIMEOUT',message:'Timeout'},{code:'INVALID_CREDENTIALS',message:'Access denied'},{code:'insufficient_scope',message:'Access denied'},{code:'ERROR_CORE',message:'Unknown failure'},{code:'ERROR_CORE',message:'0x000100'},{code:'ACCESS_DENIED',message:'Available only on commercial plans'},{code:'ERROR_METHOD_NOT_FOUND',message:'Method not found'}]){
  deny(error);assert.equal(await f.c._confirmDialogTimeTaskUnavailable('1'),false,JSON.stringify(error));assert.equal(f.c._isDialogTimeTaskExcluded('1'),false);
 }
 deny({code:'0',message:'Access denied.'});assert.equal(await f.c._confirmDialogTimeTaskUnavailable('1'),true);
 assert.equal(f.record().data.totalSeconds,0);assert.equal(f.record().data.coverage.complete,true);assert.equal(f.record().data.coverage.totalTasks,0);
 const proof=f.c._isDialogTimeTaskExcluded.proofs.get('portal~7:1');proof.at-=300001;
 assert.equal(f.c._isDialogTimeTaskExcluded('1'),false);f.c._callBxRestPageWithTimeout=original;
 await f.load();assert.equal(f.record().data.totalSeconds,60,'Expired denial must not reuse a removed window proof');
 deny({code:'ERROR_CORE',message:'0x000001'});await f.c._confirmDialogTimeTaskUnavailable('1');
 f.state.identity='other~8';assert.equal(f.c._isDialogTimeTaskExcluded('1'),false);f.state.identity='portal~7';
 f.c._dialogTimeTaskRevisions.set('1',1);assert.equal(f.c._isDialogTimeTaskExcluded('1'),false);
 assert.equal(await f.c._confirmDialogTimeTaskUnavailable('1',{isCurrent:()=>false}),false);
 assert.equal(f.c._isDialogTimeTaskExcluded('1'),false);
 return {nonExcludingErrors:7,removedStaleEntries:true,expiryRecovery:true,identityAndRevisionFenced:true};
});
await phase('exact Desktop task-unavailable exception is sufficient only after individual confirmation',async()=>{
 const f=fixture(2);f.api.state.mode='unsupported';f.api.state.rows=[raw(1),raw(2)];await f.load();
 const message='TASKS_ERROR_EXCEPTION_#1; Task not found or not accessible; 1/TE/TASK_NOT_FOUND_OR_NOT_ACCESSIBLE<br>';
 const failure={code:'ERROR_CORE',message,elapsedIndividualConfirmed:true};
 const original=f.c._callBxRestPageWithTimeout;let viewChecks=0;
 f.c._callBxRestPageWithTimeout=async(method,...args)=>{if(method==='tasks.task.get')viewChecks++;return original(method,...args);};
 for(const error of [{...failure,elapsedIndividualConfirmed:false},{...failure,code:'TIMEOUT'},{...failure,message:'TASKS_ERROR_EXCEPTION_#512; Item not found; 512/TE/ITEM_NOT_FOUND_OR_NOT_ACCESSIBLE'},{...failure,message:'Access denied'}]){
  assert.equal(await f.c._confirmDialogTimeTaskUnavailable('1',{elapsedError:error}),false);
 }
 assert.equal(viewChecks,4);viewChecks=0;
 f.c._callDialogTimeElapsedPages=async params=>{
  const partialPages=await Promise.all(params.map(p=>Number(p[0])===1?null:f.api.call(p)));
  throw Object.assign(new Error(message),{partialPages,partialErrors:params.map(p=>Number(p[0])===1?failure:null)});
 };
 await f.load({force:true});assert.equal(viewChecks,0);assert.equal(f.record().data.totalSeconds,60);
 assert.equal(f.c._isDialogTimeTaskExcluded('1'),true);assert.equal(f.record().hasCompleteSnapshot,true);
 assert.equal(f.record().data.coverage.totalTasks,1);assert.equal(f.record().error,'');
 return {exactUserResponse:true,extraViewRequests:0,accessibleTotalSeconds:60,complete:true};
});
await phase('all tasks becoming invisible is a complete empty accessible result',async()=>{
 const f=fixture(1);f.api.state.mode='unsupported';
 f.c._callDialogTimeElapsedPages=async params=>{throw Object.assign(new Error('Access denied'),{partialPages:params.map(()=>null),partialErrors:params.map(()=>({code:'ERROR_CORE',message:'Access denied'}))});};
 const original=f.c._callBxRestPageWithTimeout;
 f.c._callBxRestPageWithTimeout=async(method,...args)=>{if(method==='tasks.task.get')throw Object.assign(new Error('Access denied.'),{code:'0'});return original(method,...args);};
 await f.load();assert.equal(f.record().data.totalSeconds,0);assert.equal(f.record().hasCompleteSnapshot,true);assert.equal(f.record().data.coverage.totalTasks,0);assert.equal(f.record().error,'');
});
await phase('selected day never waits for unrelated monthly global entries',async()=>{
 const f=fixture(100);f.api.state.rows=[...Array.from({length:3000},(_,i)=>raw(i+1,1,7,'2026-09-07')),raw(3001,1)];
 await f.load();assert.equal(f.record().data.totalSeconds,60);assert.equal(f.record().hasCompleteSnapshot,true);
 assert.equal(f.api.state.calls.length,1);assert.equal(f.api.state.calls[0][2]['>=CREATED_DATE'],'2026-09-08T00:00:00');
 await f.load();assert.equal(f.api.state.calls.length,1,'Ready date is cached');
 f.c._dialogTimeRange={from:'2026-09-07',to:'2026-09-07'};
 const adjacent=await f.c._loadDialogTimeRange(f.c._dialogTimeRange);assert.equal(adjacent.totalSeconds,3000*60);
 assert.equal(adjacent.entryCount,3000,'A one-day proof must never mark the whole month complete');
 return {unrelatedEntries:3000,selectedEntries:1,requests:1,previousMonthlyRequests:61};
});
mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});writeFileSync(new URL('./artifacts/time-global-elapsed-regression.json',import.meta.url),JSON.stringify(report,null,2));
for(const p of report.phases)console.log(`${p.status}: ${p.name}${p.error?'\n'+p.error:''}`);assert.equal(report.phases.filter(p=>p.status==='FAIL').length,0,'Global time regression failed');

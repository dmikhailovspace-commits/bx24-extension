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
  _getDialogTimeWorkingTaskIds:()=>ids.slice(),_getDialogTimeFriendlyError:e=>e.message,_isBxRestBatchPressureError:e=>e.code==='TIMEOUT',
  _queueDialogTimeUiSync:()=>{},_loadDialogTimeTaskTitles:async()=>{},_sleepDialogControl:async()=>{},
  _ensureDialogTimeProjectCatalog:async()=>{state.catalogCalls++;if(state.catalogHold)await state.catalogHold.promise;c._dialogTimeCatalogCursor=1;c._dialogTimeCatalogScope=state.scope;return true;},
  _callBxRestPageWithTimeout:async(method,params,_timeout,options)=>{assert.equal(method,'task.elapseditem.getlist');assert.equal(options.isCurrent(),true);return api.call(params);},
  _callDialogTimeElapsedPages:async params=>{state.pointCalls.push(...params.map(p=>p[0]));return Promise.all(params.map(api.call));},
  _isDialogTimeProjectTask:id=>ids.includes(String(id)),_buildDialogTimeWriteFields:(_seconds,date)=>({CREATED_DATE:`${date}T12:00:00+03:00`}),
 });
 vm.runInContext(['_callDialogTimeGlobalElapsedPage','_getDialogTimeCacheKey','_hasDialogTimeVerifiedData','_setDialogTimeCacheRecord','_loadDialogTimeRange','_invalidateDialogTimeCachesForDates','_applyDialogTimeOptimisticEntry','_publishDialogTimeTaskIndexRows'].map(extract).join('\n'),c);
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
mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});writeFileSync(new URL('./artifacts/time-global-elapsed-regression.json',import.meta.url),JSON.stringify(report,null,2));
for(const p of report.phases)console.log(`${p.status}: ${p.name}${p.error?'\n'+p.error:''}`);assert.equal(report.phases.filter(p=>p.status==='FAIL').length,0,'Global time regression failed');

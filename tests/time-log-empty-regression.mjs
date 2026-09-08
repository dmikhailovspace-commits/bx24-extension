import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const model=createRequire(import.meta.url)('../extension/native-time-control.js');
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
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
  _callDialogTimeElapsedPages:async requests=>{state.calls.push(...requests.map(p=>String(p[0])));return requests.map(p=>({data:structuredClone(state.rows.filter(r=>String(r.USER_ID)===String(p[2].USER_ID))),requestedAt:state.now}));}
 });
 vm.runInContext(['_getDialogTimeWorkingTaskIds','_getDialogTimeCacheKey','_setDialogTimeCacheRecord','_hasDialogTimeVerifiedData','_publishDialogTimeTaskIndexRows','_loadDialogTimeRange','_invalidateDialogTimeCachesForDates','_applyDialogTimeOptimisticEntry'].map(extract).join('\n'),c);
 const capture=()=>({scope:state.scope,at:state.now,revisions:new Map(c._dialogTimeTaskRevisions)});
 const publish=(fields={},proof=capture())=>c._publishDialogTimeTaskIndexRows([{ID:'1',TITLE:'Task 1',...fields}],proof);
 return{state,c,capture,publish,load:options=>c._loadDialogTimeRange(range,options),record:()=>c._dialogTimeCache.get(c._getDialogTimeCacheKey(range))};
}
await phase('only an explicit own null field proves empty logs; zero-valued journals remain readable',async()=>{
 const variants=[{}, {TIME_SPENT_IN_LOGS:undefined},{TIME_SPENT_IN_LOGS:null},{timeSpentInLogs:null},{TIME_SPENT_IN_LOGS:0},{TIME_SPENT_IN_LOGS:'0'},{TIME_SPENT_IN_LOGS:-1},{TIME_SPENT_IN_LOGS:''}];
 for(const fields of variants){const f=fixture();f.state.rows=[entry(0)];f.publish(fields);await f.load();const empty=Object.values(fields).includes(null);
  assert.equal(f.state.calls.length,empty?0:1,JSON.stringify(fields));assert.equal(f.record().data.entryCount,empty?0:1,'A zero-duration entry ID was hidden');assert.equal(f.record().hasVerifiedData,true);assert.equal(f.record().data.coverage.complete,true);
 }
 return{fieldVariants:variants.length,explicitNullVariants:2,zeroEntryRetained:true};
});
await phase('unscoped and uncaptured null metadata cannot replace an elapsed response',async()=>{
 for(const kind of ['noEvidence','wrongScope','noRevisions']){const f=fixture();const proof=kind==='noEvidence'?null:kind==='wrongScope'?{...f.capture(),scope:'other~7'}:{scope:f.state.scope,at:f.state.now};f.publish({TIME_SPENT_IN_LOGS:null},proof);await f.load();assert.equal(f.state.calls.length,1);assert.equal(f.record().data.totalSeconds,60);}
 return{untrustedVariants:3,realElapsedReadsEach:1};
});
await phase('task events and newer changed dates invalidate evidence captured before the catalog response',async()=>{
 for(const kind of ['eventDuringCatalog','eventAfterCatalog','changedDate']){const f=fixture();const proof=f.capture();
  if(kind==='eventDuringCatalog')f.c._dialogTimeTaskRevisions.set('1',1);
  if(kind==='changedDate')f.publish({CHANGED_DATE:'2026-09-07T10:00:00Z'});
  f.publish({TIME_SPENT_IN_LOGS:null,...(kind==='changedDate'?{CHANGED_DATE:'2026-09-07T11:00:00Z'}:{})},proof);
  if(kind==='eventAfterCatalog')f.c._dialogTimeTaskRevisions.set('1',1);
  await f.load();assert.equal(f.state.calls.length,1);assert.equal(f.record().data.totalSeconds,60);
 }
 return{revisionRaces:3,falseEmptyResults:0};
});
await phase('age boundary and backwards clocks cannot turn stale null evidence into a new empty snapshot',async()=>{
 for(const age of [-1,60000,60001]){const f=fixture();f.publish({TIME_SPENT_IN_LOGS:null});f.state.now+=age;await f.load();assert.equal(f.state.calls.length,1);assert.equal(f.record().data.totalSeconds,60);}
 const fresh=fixture();fresh.publish({TIME_SPENT_IN_LOGS:null});fresh.state.now+=59999;await fresh.load();assert.equal(fresh.state.calls.length,0);
 return{rejectedAges:[-1,60000,60001],lastAcceptedAge:59999};
});
await phase('a fresh null conflicting with known rows requires journal verification before clearing cached time',async()=>{
 const f=fixture();await f.load();assert.equal(f.record().data.totalSeconds,60);f.c._dialogTimeTaskRevisions.set('1',1);f.state.rows=[];f.publish({TIME_SPENT_IN_LOGS:null});
 await f.load();assert.equal(f.state.calls.length,2);assert.equal(f.record().data.totalSeconds,0);assert.equal(f.record().data.entryCount,0);assert.equal(f.record().data.coverage.complete,true);
 f.state.now+=120000;await f.load();assert.equal(f.state.calls.length,2);assert.equal(f.record().data.totalSeconds,0);
 return{initialElapsedRequests:1,reconciliationElapsedRequests:1,warmElapsedRequests:0};
});
await phase('a real journal total revokes an earlier null proof while an omitted field cannot contradict it',async()=>{
 for(const fields of [{TIME_SPENT_IN_LOGS:120},{TIME_SPENT_IN_LOGS:0}]){const f=fixture();f.publish({TIME_SPENT_IN_LOGS:null});f.publish(fields);await f.load();assert.equal(f.state.calls.length,1);assert.equal(f.record().data.totalSeconds,60);}
 const omitted=fixture();omitted.publish({TIME_SPENT_IN_LOGS:null});omitted.publish({});await omitted.load();assert.equal(omitted.state.calls.length,0);
 return{realJournalRevocations:2,omittedFieldExtraReads:0};
});
await phase('same task IDs in another user or portal never reuse an old empty-log proof',async()=>{
 for(const scope of ['portal~8','other~7']){const f=fixture();f.publish({TIME_SPENT_IN_LOGS:null});f.state.scope=scope;f.state.user=scope.split('~')[1];f.state.rows=[{...entry(120),USER_ID:f.state.user}];await f.load();assert.equal(f.state.calls.length,1);assert.equal(f.record().data.totalSeconds,120);}
 return{foreignScopeVariants:2,falseEmptyResults:0};
});
await phase('acknowledged ADD fences an older null catalog while retaining a patched fresh snapshot without another GET',async()=>{
 const f=fixture();await f.load();const before=f.capture();f.state.now+=100;
 f.c._invalidateDialogTimeCachesForDates(range.from,{taskId:'1',preserveTaskFreshness:true});
 f.c._applyDialogTimeOptimisticEntry('1',120,range.from,'502');
 assert.equal(f.record().data.totalSeconds,180);
 f.publish({TIME_SPENT_IN_LOGS:null},before);await f.load();
 assert.equal(f.record().data.totalSeconds,180);assert.equal(f.record().data.entryCount,2);assert.equal(f.state.calls.length,1);
 assert.equal(f.record().taskFreshness['1'].revision,f.c._dialogTimeTaskRevisions.get('1'));
 return{totalAfterAck:180,totalAfterLateCatalog:f.record().data.totalSeconds,extraElapsedReads:0,writeRevision:f.c._dialogTimeTaskRevisions.get('1')};
});
await phase('an elapsed request captured before ACK cannot replace the confirmed ADD and warm reads remain deduplicated',async()=>{
 const f=fixture();await f.load();let release;const original=f.c._callDialogTimeElapsedPages;
 f.c._callDialogTimeElapsedPages=async(...args)=>{const response=await original(...args);await new Promise(resolve=>{release=resolve;});return response;};
 const old=f.load({force:true});while(!release)await Promise.resolve();
 f.c._invalidateDialogTimeCachesForDates(range.from,{taskId:'1',preserveTaskFreshness:true});f.c._applyDialogTimeOptimisticEntry('1',120,range.from,'502');release();await old;
 await f.load();assert.equal(f.record().data.totalSeconds,180);assert.equal(f.record().data.entryCount,2);assert.equal(f.state.calls.length,2);
 return{acknowledgedTotal:180,initialAndExplicitReads:2,postAckExtraReads:0};
});
await phase('null-derived cached freshness becomes dirty when the source reports journal entries without a changed-date increment',async()=>{
 for(const seconds of [0,60]){const f=fixture();f.publish({TIME_SPENT_IN_LOGS:null});await f.load();f.state.now+=100;f.state.rows=[entry(seconds)];f.publish({TIME_SPENT_IN_LOGS:seconds});await f.load();
  assert.equal(f.record().data.totalSeconds,seconds);assert.equal(f.record().data.entryCount,1);assert.equal(f.state.calls.length,1);assert.equal(f.c._dialogTimeTaskRevisions.get('1'),1);
  f.publish({TIME_SPENT_IN_LOGS:seconds});await f.load();assert.equal(f.state.calls.length,1,'Repeated metadata must not trigger another GET');
 }
 return{zeroAndPositiveEntriesRetained:true,readsPerTransition:1,overlapExtraReads:0};
});
await phase('late catalog responses captured before a revision cannot remove or replace newer empty evidence',async()=>{
 for(const fields of [{TIME_SPENT_IN_LOGS:60},{TIME_SPENT_IN_LOGS:null}]){const f=fixture();const old=f.capture();f.c._dialogTimeTaskRevisions.set('1',1);f.state.now+=100;f.publish({TIME_SPENT_IN_LOGS:null});const fresh=f.c._dialogTimeTaskLogEvidence.get('1');f.publish(fields,old);
  assert.equal(f.c._dialogTimeTaskLogEvidence.get('1'),fresh);await f.load();assert.equal(f.state.calls.length,0);
 }
 return{lateResponseVariants:2,newProofPreserved:true};
});
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/time-log-empty-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.phases.some(p=>p.status==='FAIL'))process.exitCode=1;

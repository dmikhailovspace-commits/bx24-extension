import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const baseline=process.env.PENA_TIME_POLICY_BASELINE==='1';
const source=file=>baseline?execFileSync('git',['-C','E:/Codex/ReleaseStaging/bx24-v7.5.85','show',`v7.5.99:extension/${file}`],{encoding:'utf8',maxBuffer:16000000}):readFileSync(new URL(`../extension/${file}`,import.meta.url),'utf8');
const injected=source('injected.js'),model=vm.createContext({module:{exports:{}},Date});vm.runInContext(source('native-time-control.js'),model);
const report={baseline,sha:createHash('sha256').update(injected).digest('hex'),scenarios:[],limitations:'Actual production range functions and elapsed model in VM, controlled 2s/page-batch virtual latency; no live portal/DOM or real CPU timing.'};
function fixture(count=4149){
 const s={now:1000000,scope:'portal:7',calls:[],delay:2000,hook:null,rows:new Map([['1',600],[String(count),1200]])};
 class Clock extends Date{static now(){return s.now;}}
 const range={from:'2026-09-07',to:'2026-09-07'},ids=Array.from({length:count},(_,i)=>String(i+1));
 const c=vm.createContext({Date:Clock,document:{visibilityState:'visible'},navigator:{onLine:true},
  _PENA_TIME_CONTROL:model.module.exports,_dialogTimeRange:range,_dialogTimePortalDateKey:range.from,_dialogTimeView:'day',_dialogControlNativeWorkspaceTab:'time',
  _dialogTimeCache:new Map(),_dialogTimeInFlight:new Map(),_dialogTimeRangeRevisions:new Map(),_dialogTimeTaskRevisions:new Map(),
  _dialogTimeForcedRefreshes:new Map(),_dialogTimeRangeRechecks:new Map(),_dialogTimePanelRefreshes:new Map(),
  _dialogTimeCatalogCursor:999000,_dialogTimeCatalogScope:'portal:7',_DIALOG_TIME_LOGGED_TTL_MS:10000,_DIALOG_TIME_EMPTY_TTL_MS:120000,_DIALOG_TIME_FIRST_WAVE_SIZE:16,_DIALOG_TIME_WAVE_SIZE:50,
  _getCurrentBitrixUserId:()=> '7',_getDialogNativeSharedAuditScopeKey:()=>s.scope,
  // Configured, committed scope is the premise of this elapsed-policy oracle.
  // The mandatory settings/catalog gate has its own actual-helper acceptance suite.
  _getDialogTimeProjectScopeKey:()=>s.scope,_dialogTimeProjectTaskIds:new Set(ids),
  _isDialogTimeProjectTask:id=>ids.includes(String(id)),_ensureDialogTimeProjectCatalog:async()=>true,
  _dialogTimeTaskEligibility:new Map(ids.map(id=>[id,true])),_dialogTimeTaskTitles:new Map(ids.map(id=>[id,`Task ${id}`])),
  _getDialogTimeTaskEligibilityForDisplay:()=>true,_readDialogTimeVisits:()=>[],_dialogTimeManualSelectedTask:null,_readDialogTimeTracker:()=>null,
  _getActiveDialogTimeActivity:()=>null,_getDialogRecentUniqueMeta:()=>[],_queueDialogTimeUiSync:()=>{},_loadDialogTimeTaskTitles:async()=>{},
  _getDialogTimeFriendlyError:e=>e.message,_isBxRestBatchPressureError:()=>false,_sleepDialogControl:async()=>{},_refreshDialogTimeTaskCatalog:async()=>true,
  _callDialogTimeElapsedPages:async jobs=>{
   const requestedAt=s.now;s.calls.push(jobs.map(p=>String(p[0])));
   const result=jobs.map(p=>({requestedAt,data:s.rows.has(String(p[0]))?[{ID:`entry-${p[0]}`,TASK_ID:String(p[0]),USER_ID:'7',SECONDS:s.rows.get(String(p[0])),CREATED_DATE:`${p[2]['>=CREATED_DATE'].slice(0,10)}T12:00:00+03:00`}]:[]}));
   s.now+=s.delay; if(s.hook)await s.hook(jobs);return result;
  }
 });
 for(const name of ['_getDialogTimeEligibleTaskIds','_getDialogTimeWorkingTaskIds','_getDialogTimeCacheKey','_setDialogTimeCacheRecord','_hasDialogTimeVerifiedData','_loadDialogTimeRange','_refreshDialogTimePanel']){
  const start=new RegExp(`\\t(?:async )?function ${name}\\(`).exec(injected)?.index;assert.notEqual(start,undefined,name);
  const end=injected.indexOf('\n\t}',start)+4;vm.runInContext(injected.slice(start,end),c);
 }
 return {s,c,range,load:(options)=>c._loadDialogTimeRange(range,options),record:()=>c._dialogTimeCache.get(c._getDialogTimeCacheKey(range)),requests:()=>s.calls.flat().length};
}
async function run(name,fn){const evidence={};try{await fn(evidence);report.scenarios.push({name,status:'PASS',evidence});}catch(error){report.scenarios.push({name,status:'FAIL',error:error.message.slice(0,1200),evidence});}}

await run('4149-task scan exceeding empty TTL completes once; warm reopen and periodic hints do not rescan',async e=>{
 const f=fixture(),started=f.s.now;const data=await f.load();e.initial={taskRequests:f.requests(),batches:f.s.calls.length,virtualMs:f.s.now-started,seconds:data.totalSeconds,coverage:data.coverage};
 assert.equal(data.totalSeconds,1800);assert.equal(f.requests(),4149);assert(e.initial.virtualMs>120000);
 const before=f.requests();await f.load();e.immediateReopenRequests=f.requests()-before;
 const beforeHints=f.requests();for(let i=0;i<3;i++){f.s.now+=10000;await f.load();}e.threePeriodicHintRequests=f.requests()-beforeHints;
 assert.equal(e.immediateReopenRequests,0);assert.equal(e.threePeriodicHintRequests,0);
});
await run('one confirmed task event rereads exactly that task after a long idle',async e=>{
 const f=fixture();await f.load();f.s.now+=600000;f.s.rows.set('2048',300);f.c._dialogTimeTaskRevisions.set('2048',1);
 const before=f.s.calls.length;const data=await f.load();e.ids=f.s.calls.slice(before).flat();e.seconds=data.totalSeconds;
 assert.equal(e.ids.length,1);assert.deepEqual(e.ids,['2048']);assert.equal(data.totalSeconds,2100);
});
await run('two concurrent manual refresh requests share exactly one full 4149-task pass',async e=>{
 const f=fixture();await f.load();const before=f.s.calls.length;
 await Promise.all([f.c._refreshDialogTimePanel(f.range),f.c._refreshDialogTimePanel(f.range)]);
 const ids=f.s.calls.slice(before).flat();e.requests=ids.length;e.unique=new Set(ids).size;
 assert.equal(ids.length,4149);assert.equal(e.unique,4149);
});
await run('revision changed while its page is in flight cannot publish old elapsed seconds',async e=>{
 const f=fixture(41);let changed=false;f.s.hook=async jobs=>{if(!changed&&jobs.some(p=>String(p[0])==='1')){changed=true;f.s.rows.set('1',900);f.c._dialogTimeTaskRevisions.set('1',1);}};
 await f.load();const before=f.s.calls.length;await f.load();e.reconcileIds=f.s.calls.slice(before).flat();e.seconds=f.record().data.totalSeconds;
 assert.equal(e.seconds,2100);assert.deepEqual(e.reconcileIds,['1']);
});
await run('scope changes during page response discard old-user rows',async e=>{
 const f=fixture(41);f.s.hook=async()=>{f.s.scope='portal:8';};await f.load();e.seconds=f.record()?.data?.totalSeconds??null;
 assert.equal(e.seconds,null);
});
await run('manual refresh during the initial scan shares its one full pass',async e=>{
 const f=fixture();let release;const gate=new Promise(resolve=>{release=resolve;});let held=false;
 f.s.hook=async()=>{if(!held){held=true;await gate;}};
 const initial=f.load(),manual=f.c._refreshDialogTimePanel(f.range);release();await Promise.all([initial,manual]);
 e.requests=f.requests();e.unique=new Set(f.s.calls.flat()).size;e.seconds=f.record().data.totalSeconds;
 assert.equal(e.requests,4149);assert.equal(e.unique,4149);assert.equal(e.seconds,1800);
});
await run('closing mid-response and reopening reads unfinished tasks without losing final completeness',async e=>{
 const f=fixture(41);let closed=false;f.s.hook=async()=>{if(!closed){closed=true;f.c._dialogControlNativeWorkspaceTab='';}};
 await f.load();e.interruptedSeconds=f.record()?.data?.totalSeconds??null;f.c._dialogControlNativeWorkspaceTab='time';await f.load();
 e.seconds=f.record().data.totalSeconds;e.coverage=f.record().data.coverage;
 assert.equal(e.interruptedSeconds,null);assert.equal(e.seconds,1800);assert.equal(e.coverage.checkedTasks,41);
});
await run('two event wakes for an already accepted task drain one dirty read after the current scan',async e=>{
 const f=fixture(41);let changed=false;const wakes=[];
 f.s.hook=async jobs=>{
  if(!changed&&f.record()?.taskFreshness?.['1']&&!jobs.some(p=>String(p[0])==='1')){
   changed=true;f.s.rows.set('1',900);f.c._dialogTimeTaskRevisions.set('1',1);
   wakes.push(f.load(),f.load());
  }
 };
 await f.load();await Promise.all(wakes);e.wakes=wakes.length;e.requests=f.requests();e.lastIds=f.s.calls.at(-1);e.seconds=f.record().data.totalSeconds;e.coverage=f.record().data.coverage;
 assert.equal(e.wakes,2);assert.equal(e.requests,42);assert.deepEqual([...e.lastIds],['1']);assert.equal(e.seconds,2100);assert.equal(e.coverage.complete,true);
});
writeFileSync(new URL(`./artifacts/time-large-catalog-${baseline?'baseline99':'current'}.json`,import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(!baseline&&report.scenarios.some(s=>s.status==='FAIL'))process.exitCode=1;

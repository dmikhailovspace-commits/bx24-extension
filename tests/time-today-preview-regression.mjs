import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const model=createRequire(import.meta.url)('../extension/native-time-control.js');
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const extract=name=>{const at=source.search(new RegExp('\\t(?:async )?function '+name+'\\('));assert(at>=0,name);return source.slice(at,source.indexOf('\n\t}',at)+4);};
const report={sourceSha:createHash('sha256').update(source).digest('hex'),phases:[]};
async function phase(name,fn){try{report.phases.push({name,status:'PASS',evidence:await fn()});}catch(error){report.phases.push({name,status:'FAIL',error:error.stack});}}
const item=(id='501',seconds=600)=>model.normalizeElapsedItem({ID:id,TASK_ID:'1',USER_ID:'7',SECONDS:seconds,CREATED_DATE:'2026-09-08T12:00:00Z'});
function fixture(storage=new Map()){
 const state={now:Date.parse('2026-09-08T12:00:00Z'),day:'2026-09-08',identity:'portal~7',selection:'10',generation:1,storage,timers:new Map(),sequence:0,writes:[],reads:0,elapsed:[],serverRows:[item('502',1200)]};
 const scope=()=>`${state.identity}:projects:${state.selection}:0:g${state.generation}`;class Clock extends Date{static now(){return state.now;}}
 const today={from:state.day,to:state.day};
 const c=vm.createContext({Date:Clock,Map,Set,Promise,localStorage:{getItem:key=>{state.reads++;if(state.readError)throw new Error('storage read');return storage.get(key)??null;},setItem:(key,value)=>{if(state.writeError)throw new Error('storage write');state.writes.push({key,value});storage.set(key,value);}},
  setTimeout:(fn,ms)=>{assert.equal(ms,250);const id=++state.sequence;state.timers.set(id,fn);return id;},clearTimeout:id=>state.timers.delete(id),
  document:{visibilityState:'visible'},navigator:{onLine:true},_PENA_TIME_CONTROL:model,
  _dialogTimeTodayPreviewReadKey:'',_dialogTimeTodayPreviewWriteKey:'',_dialogTimeTodayPreviewTimer:null,_dialogTimeTodayPreviewPendingKey:'',_dialogTimeTodayPreviewRetry:null,_dialogTimePortalUtcOffsetMinutes:0,
  _getDialogTimeProjectScopeKey:scope,_getDialogTimeIdentityScopeKey:()=>state.identity,_getCurrentBitrixUserId:()=>state.identity.split('~')[1],_getDialogTimeTodayKey:()=>state.day,
  _dialogTimeRange:today,_dialogTimePortalDateKey:today.from,_dialogTimeView:'day',_dialogControlNativeWorkspaceTab:'time',
  _dialogTimeCache:new Map(),_dialogTimeInFlight:new Map(),_dialogTimeForcedRefreshes:new Map(),_dialogTimeRangeRechecks:new Map(),_dialogTimePanelRefreshes:new Map(),
  _dialogTimeTaskRevisions:new Map(),_dialogTimeRangeRevisions:new Map(),_dialogTimeTaskLogEvidence:new Map(),_dialogTimeProjectTaskIds:new Set(['1']),_dialogTimeCatalogCursor:1,_dialogTimeCatalogScope:scope(),
  _isDialogTimeProjectTask:id=>id==='1',_ensureDialogTimeProjectCatalog:async()=>{c._dialogTimeCatalogScope=scope();return true;},
  _DIALOG_TIME_FIRST_WAVE_SIZE:16,_DIALOG_TIME_WAVE_SIZE:50,_queueDialogTimeUiSync:()=>{},_loadDialogTimeTaskTitles:async()=>{},_sleepDialogControl:async()=>{},_getDialogTimeFriendlyError:e=>e.message,_isBxRestBatchPressureError:()=>false,
  _callDialogTimeElapsedPages:async jobs=>{state.elapsed.push(...jobs.map(p=>String(p[0])));return jobs.map(()=>({data:structuredClone(state.serverRows),requestedAt:state.now}));}
 });
 vm.runInContext(['_syncDialogTimeTodayPreview','_getDialogTimeWorkingTaskIds','_getDialogTimeCacheKey','_getDialogTimeRecord','_setDialogTimeCacheRecord','_hasDialogTimeVerifiedData','_loadDialogTimeRange'].map(extract).join('\n'),c);
 const record=()=>c._getDialogTimeRecord(today);
 const seed=(items=[item()],extra={})=>c._setDialogTimeCacheRecord(c._getDialogTimeCacheKey(today),{data:model.aggregateElapsedItems(items),range:today,status:'ready',hasVerifiedData:true,hasCompleteSnapshot:true,updatedAt:state.now,taskFreshness:{'1':{at:state.now,revision:0}},...extra});
 const payload=()=>({version:1,scope:scope().replace(/:g\d+$/,''),day:state.day,offset:0,savedAt:state.now,items:[item()]});
 return {state,c,today,record,seed,payload,sync:()=>c._syncDialogTimeTodayPreview(today),flush:()=>{const jobs=[...state.timers.values()];state.timers.clear();jobs.forEach(fn=>fn());},saveRaw:value=>storage.set(`pena.timeToday.v1.${state.identity}`,typeof value==='string'?value:JSON.stringify(value))};
}
await phase('confirmed preview writes later and restores immediately without certifying freshness; real reads replace it',async()=>{
 const original=fixture();original.seed();original.sync();assert.equal(original.state.writes.length,0);assert.equal(original.state.timers.size,1);original.flush();assert.equal(original.state.writes.length,1);
 const f=fixture(original.state.storage);f.state.generation=9;f.sync();assert.equal(f.record().data.totalSeconds,600);assert.equal(f.record().restored,true);assert.equal(f.record().hasCompleteSnapshot,false);assert.equal(Object.keys(f.record().taskFreshness).length,0);assert.equal(f.state.elapsed.length,0);
 await f.c._loadDialogTimeRange(f.today);assert.deepEqual(f.state.elapsed,['1']);assert.equal(f.record().data.totalSeconds,1200);assert.deepEqual(Array.from(f.record().data.items,r=>r.id),['502']);assert.equal(f.record().hasCompleteSnapshot,true);
 return {immediatePreviewSeconds:600,restoredFreshTasks:0,reconciliationReads:1,reconciledSeconds:1200};
});
await phase('user, portal, project, day, saved date and offset boundaries reject foreign previews',async()=>{
 const variants=['user','portal','project','day','stale','future','offsetNull','offsetString','offsetWrongDay','version','savedAtString'];
 for(const variant of variants){const f=fixture(),saved=f.payload();
  if(variant==='user')saved.scope=saved.scope.replace('~7','~8');if(variant==='portal')saved.scope=saved.scope.replace('portal','other');if(variant==='project')saved.scope=saved.scope.replace(':10:',':20:');if(variant==='day')saved.day='2026-09-07';if(variant==='stale')saved.savedAt-=86400000;if(variant==='future')saved.savedAt++;if(variant==='offsetNull')saved.offset=null;if(variant==='offsetString')saved.offset='0';if(variant==='offsetWrongDay')saved.offset=840;if(variant==='version')saved.version=2;if(variant==='savedAtString')saved.savedAt=String(saved.savedAt);
  f.saveRaw(saved);f.sync();assert.equal(f.record(),null,variant);assert.equal(f.state.timers.size,0);
 }
 return{rejectedVariants:variants.length};
});
await phase('corrupt item fields, duplicate IDs and contradictory creation dates never inflate the preview',async()=>{
 const variants=['null','id','task','user','date','negative','stringSeconds','duplicate','createdAt'];
 for(const variant of variants){const f=fixture(),saved=f.payload(),r=saved.items[0];
  if(variant==='null')saved.items[0]=null;if(variant==='id')r.id='0';if(variant==='task')r.taskId='x';if(variant==='user')r.userId='8';if(variant==='date')r.dateKey='2026-09-07';if(variant==='negative')r.seconds=-1;if(variant==='stringSeconds')r.seconds='600';if(variant==='duplicate')saved.items.push({...r});if(variant==='createdAt')r.createdAt='2026-09-07T12:00:00Z';
  f.saveRaw(saved);f.sync();assert.equal(f.record(),null,variant);
 }
 return {rejectedVariants:variants.length};
});
await phase('item and byte limits are enforced and corrupt storage reads fail closed',async()=>{
 const valid=fixture(),saved=valid.payload();saved.items=Array.from({length:2000},(_,i)=>item(String(i+1),1));valid.saveRaw(saved);valid.sync();assert.equal(valid.record().data.entryCount,2000);
 for(const kind of ['items','bytes','json','readError']){const f=fixture(),data=f.payload();if(kind==='items')data.items=Array.from({length:2001},(_,i)=>item(String(i+1),1));if(kind==='bytes')data.items[0].commentText='x'.repeat(524288);f.saveRaw(kind==='json'?'{broken':data);f.state.readError=kind==='readError';assert.doesNotThrow(()=>f.sync());assert.equal(f.record(),null);}
 return {acceptedItems:2000,rejectedStorageVariants:4};
});
await phase('partial, loading and failed snapshots never schedule a durable preview',async()=>{
 for(const extra of [{hasCompleteSnapshot:false},{status:'loading'},{error:'failed'}]){const f=fixture();f.seed([item()],extra);f.sync();assert.equal(f.state.timers.size,0);assert.equal(f.state.writes.length,0);}
 return{nonFinalVariants:3,writes:0};
});
await phase('deferred writes recheck scope, date, latest completeness and size before touching storage',async()=>{
 for(const change of ['user','project','day','partial','items','bytes']){const f=fixture();f.seed();f.sync();if(change==='user')f.state.identity='portal~8';if(change==='project')f.state.selection='20';if(change==='day')f.state.day='2026-09-09';if(change==='partial')f.record().hasCompleteSnapshot=false;if(change==='items')f.record().data.items=Array.from({length:2001},(_,i)=>item(String(i+1)));if(change==='bytes')f.record().data.items[0].commentText='x'.repeat(524288);f.flush();assert.equal(f.state.writes.length,0,change);}
 return{deferredFenceVariants:6,writes:0};
});
await phase('repeated final updates coalesce into one deferred write of the latest data',async()=>{
 const f=fixture();for(const seconds of [600,1200,1800]){f.state.now++;f.seed([item('501',seconds)]);f.sync();}assert.equal(f.state.sequence,1,'Repeated sync postponed the original timer');assert.equal(f.state.timers.size,1);f.flush();assert.equal(f.state.writes.length,1);assert.equal(JSON.parse(f.state.writes[0].value).items[0].seconds,1800);f.sync();assert.equal(f.state.timers.size,0);
 return{updates:3,writes:1,finalSeconds:1800};
});
await phase('a saved zero remains a stale preview, and each user has only one latest project payload',async()=>{
 const f=fixture();f.seed([]);f.sync();f.flush();assert.equal(f.state.storage.size,1);const reopened=fixture(f.state.storage);reopened.sync();assert.equal(reopened.record().data.totalSeconds,0);assert.equal(reopened.record().hasCompleteSnapshot,false);assert.equal(Object.keys(reopened.record().taskFreshness).length,0);
 await reopened.c._loadDialogTimeRange(reopened.today);assert.equal(reopened.record().data.totalSeconds,1200);assert.equal(reopened.state.elapsed.length,1);
 f.state.selection='20';f.state.now++;f.seed([item('503',900)]);f.sync();f.flush();assert.equal(f.state.storage.size,1);const saved=JSON.parse([...f.state.storage.values()][0]);assert(saved.scope.includes(':20:'));assert.equal(saved.items[0].seconds,900);
 return{restoredZeroCertifiedFresh:false,zeroReconciliationRequests:1,keysPerUser:1};
});
await phase('temporary storage failure does not poison the unchanged snapshot retry',async()=>{
 const f=fixture();f.seed();f.state.writeError=true;f.sync();assert.doesNotThrow(()=>f.flush());assert.equal(f.state.writes.length,0);f.state.writeError=false;f.sync();assert.equal(f.state.timers.size,0);f.state.now+=14999;f.sync();assert.equal(f.state.timers.size,0);f.state.now++;f.sync();assert.equal(f.state.timers.size,1);f.flush();assert.equal(f.state.writes.length,1);return{failedWrites:1,laterSuccessfulWrites:1};
});
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/time-today-preview-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.phases.some(p=>p.status==='FAIL'))process.exitCode=1;

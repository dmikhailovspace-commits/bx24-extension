import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const runtime=[
 section('\tfunction _getDialogTaskKeysetCursor(', '\n\tlet _dialogTimeCatalogPromise'),
 section('\tasync function _syncDialogTaskCatalog(', '\n\tfunction _commitDialogTaskCatalogResult'),
 section('\tasync function _refreshDialogTimeTaskCatalog(', '\n\tfunction _publishDialogTimeTaskIndexRows'),
 section('\tasync function _ensureDialogTimeProjectCatalog(', '\n\tasync function _loadDialogTimeProjects')
].join('\n');
const phases=[];
const phase=async(name,fn)=>{const started=Date.now();const evidence=await fn();phases.push({name,status:'PASS',ms:Date.now()-started,evidence});};
function setup({count=100,deleteAfterFirst=false,ignoreCursor=false,reverse=false,changeScope=false}={}){
 let rows=Array.from({length:count},(_,i)=>({ID:String(i+1),TITLE:'Task '+(i+1),GROUP_ID:'10',ALLOW_TIME_TRACKING:'Y'}));
 const calls=[],published=[];let context;
 const fetch=async(_method,params)=>{
  calls.push(JSON.parse(JSON.stringify(params)));
  const filtered=params.order?.ID==='asc'&&!ignoreCursor?rows.filter(r=>Number(r.ID)>Number(params.filter?.['>ID']||0)):rows;
  let batch=filtered.slice(params.start||0,(params.start||0)+50);
  if(reverse)batch=batch.slice().reverse();
  if(calls.length===1&&deleteAfterFirst)rows.shift();
  if(calls.length===1&&changeScope)context.scope='portal:8';
  return{data:{tasks:batch},total:100,next:null};
 };
 context=vm.createContext({scope:'portal:7',Date,Map,Set,Promise,
  setTimeout:()=>1,clearTimeout:()=>{},
  _getDialogNativeSharedAuditScopeKey:()=>context.scope,
  // Pagination-only oracle: the user has saved project 10; actual preference
  // normalization, persistence and generation fencing have their own suite.
  _getDialogTimeProjectScopeKey:()=>context.scope,_getDialogTimeProjectFilter:()=>({GROUP_ID:['10']}),
  _matchesDialogTimeProjectTask:row=>row.GROUP_ID==='10',_isDialogTimeFrameActive:()=>true,
  _dialogTimeProjectTaskIds:new Set(),_dialogTimeProjectCatalogOwner:null,_dialogTimeProjectCatalogDirty:false,_dialogTimeProjectCatalogError:null,
  _pruneDialogTimeProjectSnapshots:()=>{},_queueDialogTimeUiSync:()=>{},
  _isDialogTaskCatalogMetadataFresh:()=>false,
  _dialogTaskCatalogSyncFlights:new Map(),_dialogTaskCatalogSyncPromise:null,_dialogTaskCatalogSyncScopeKey:'',_dialogTaskCatalogLastResult:null,
  _DIALOG_TASK_CATALOG_MAX_PAGES:100,_DIALOG_TASK_CATALOG_PAGE_SIZE:50,_DIALOG_RECENT_PAGE_DELAY_MS:0,
  _DIALOG_TIME_CATALOG_REFRESH_MS:10000,
  _dialogTaskCatalogComplete:false,_dialogTaskCatalogFetchedAt:0,_dialogTaskCatalogScopeKey:'',
  _dialogTimeCatalogScope:'',_dialogTimeCatalogCursor:0,_dialogTimeCatalogPromise:null,_dialogTimeCatalogTimer:null,
  _callBxRestPageWithTimeout:fetch,_callBxRestPage:fetch,
  _extractDialogTaskCatalogRows:data=>data.tasks,
  _publishDialogTimeTaskIndexRows:batch=>{published.push(...batch.map(r=>r.ID));return false;},
  _mergeDialogTaskCatalogRows:batch=>batch.length,
  findContainer:()=>null,_getDialogNativeSourceRows:()=>[],
  _dialogControlNativeWorkspaceTab:'time',document:{visibilityState:'visible'},navigator:{onLine:true},
  _dialogTimeTaskRevisions:new Map(),_dialogTimeView:'day',_dialogTimeManualSearchQuery:'',
  _getDialogTimeSelectedRange:()=>({}),_loadDialogTimeRange:async()=>{},_sleepDialogControl:async()=>{}
 });
 // Native pagination delays are controlled here; immediately resolving the
 // timer must still happen asynchronously to preserve the actual promise fences.
 context.setTimeout=(fn,delay)=>{if(delay===0)queueMicrotask(fn);return 1;};
 vm.runInContext(runtime,context);
 return{context,calls,published};
}
try {
 await phase('full catalog does not skip unchanged task 51 after deletion behind page cursor',async()=>{
  const {context,calls,published}=setup({deleteAfterFirst:true});
  const result=await context._syncDialogTaskCatalog({forceNetwork:true,deferMerge:true});
  assert.equal(result.complete,true);assert.ok(published.includes('51'));
  assert.deepEqual([...new Set(published)].map(Number).sort((a,b)=>a-b),Array.from({length:100},(_,i)=>i+1));
  assert.deepEqual(calls.map(c=>c.filter['>ID']),[0,50,100,100]);
  assert.equal(context._dialogTimeCatalogCursor,0,'Native catalog cannot certify the selected time catalog');
  return{pages:calls.length,task51Present:true,complete:true};
 });
 for(const options of [{ignoreCursor:true},{reverse:true}])await phase(`invalid keyset fails closed: ${Object.keys(options)[0]}`,async()=>{
  const {context}=setup(options);
  await assert.rejects(context._syncDialogTaskCatalog({forceNetwork:true,deferMerge:true}),e=>e.code==='TASK_CATALOG_CURSOR_INVALID');
  assert.equal(context._dialogTimeCatalogCursor,0);assert.equal(context._dialogTaskCatalogComplete,false);
  return{watermark:0};
 });
 await phase('head-only activity projection never seeds a full-catalog watermark',async()=>{
  const {context,calls}=setup({count:20});
  const result=await context._syncDialogTaskCatalog({forceNetwork:true,deferMerge:true,headOnly:true});
  assert.equal(result.complete,true);assert.equal(context._dialogTimeCatalogCursor,0);
  assert.equal(calls[0].order.ACTIVITY_DATE,'desc');assert.equal(calls[0].start,0);
  return{headComplete:true,watermark:0};
 });
 await phase('changed identity discards full audit without advancing shared cursor',async()=>{
  const {context}=setup({changeScope:true});
  const result=await context._syncDialogTaskCatalog({forceNetwork:true,deferMerge:true});
  assert.equal(result.discarded,true);assert.equal(context._dialogTimeCatalogCursor,0);
  return{discarded:true,watermark:0};
 });
 await phase('time delta also uses keyset and retains unchanged rows shifted by deletion',async()=>{
  const {context,calls,published}=setup({deleteAfterFirst:true});
  context._dialogTimeCatalogScope=context.scope;context._dialogTimeCatalogCursor=Date.now()-5000;
  await context._ensureDialogTimeProjectCatalog({delta:true});
  assert.ok(published.includes('51'));assert.deepEqual(calls.map(c=>c.filter['>ID']),[0,50,100]);
  assert.ok(calls.every(c=>c.start===0&&c.filter['>=CHANGED_DATE']));
  return{pages:calls.length,task51Present:true};
 });
} finally {
 mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/task-keyset-report.json',JSON.stringify({phases},null,2));
 await phase('shared full owner pauses hidden or offline without falsely committing a complete catalog',async()=>{
  for(const condition of ['hidden','offline']){
   const {context,calls}=setup({count:100});const original=context._callBxRestPageWithTimeout;
   context._callBxRestPageWithTimeout=async(...args)=>{const page=await original(...args);if(condition==='hidden')context.document.visibilityState='hidden';else context.navigator.onLine=false;return page;};
   const result=await context._syncDialogTaskCatalog({forceNetwork:true,deferMerge:true});
   assert.equal(result.complete,false);assert.equal(result.discarded,true);assert.equal(calls.length,1);assert.equal(context._dialogTimeCatalogCursor,0);assert.equal(context._dialogTaskCatalogSyncFlights.size,0);
  }
  return {hiddenCalls:1,offlineCalls:1,partialCursor:0};
 });
console.log(JSON.stringify({phases},null,2));
}

import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const runtime=[
 section('\tfunction _createBxRestError(', '\n\tlet _dialogRestQueue'),
 section('\tfunction _normalizeBxRestPageResult(', '\n\tfunction _callBxRestPageWithTimeout'),
 section('\tfunction _isBxRestReadRetryable(', '\n\tasync function _callBxRestReadPage'),
 section('\tfunction _isBxRestBatchPressureError(', '\n\tfunction _extractDialogRecentItems'),
 section('\tasync function _runDialogRecentJobs(', '\n\tfunction _normalizeDialogRecentAuthorProfile'),
 section('\tasync function _callDialogTimeElapsedPages(', '\n\tconst _dialogTimeForcedRefreshes')
].join('\n');
const phases=[];
const phase=async(name,fn)=>{const start=Date.now();const evidence=await fn();phases.push({name,status:'PASS',ms:Date.now()-start,evidence});};
function setup(respond){
 const calls={batch:[],single:[]};
 const context=vm.createContext({setTimeout,clearTimeout,Promise,Map,Set,console,
  window:{BX24:{callBatch(jobs,callback){calls.batch.push(Object.values(jobs));respond(jobs,callback,calls.batch.length);}}},
  _getSafeTopWindow:()=>null,
  _scheduleBxRest:(_method,_params,run)=>run(),
  _callBxRestPageWithTimeout:async(method,params)=>{calls.single.push({method,params});return {data:params,next:null,total:null};},
  _sleepDialogControl:async()=>{},warn:()=>{}
 });
 vm.runInContext(runtime,context);
 return {context,calls};
}
const jobs=Array.from({length:50},(_,i)=>({method:'task.elapseditem.getlist',params:{TASKID:i+1}}));
const success=value=>({error:()=>null,data:()=>value});
try {
 for(const code of ['QUERY_LIMIT_EXCEEDED','OPERATION_TIME_LIMIT','NETWORK_ERROR'])await phase(`50-read ${code} does not fan out or retry`,async()=>{
  const {context,calls}=setup((_jobs,callback)=>callback({error:()=>code}));
  await assert.rejects(context._callDialogTimeElapsedPages(jobs.map(j=>j.params)),e=>e.code===code);
  assert.equal(calls.batch.length,1);assert.equal(calls.single.length,0);return {batch:1,single:0};
 });
 await phase('timed-out batch is not resubmitted as 50 individual requests',async()=>{
  const {context,calls}=setup(()=>{});
  await assert.rejects(context._callBxRestPagesFast(jobs,50),e=>e.code==='TIMEOUT');
  assert.equal(calls.batch.length,1);assert.equal(calls.single.length,0);return {batch:1,single:0};
 });
 await phase('partial success retries only one explicitly failed temporary subcall',async()=>{
  const {context,calls}=setup((batch,callback,round)=>callback(Object.fromEntries(Object.entries(batch).map(([key,job])=>[key,round===1&&job.params.TASKID===17?{error:()=> 'TEMPORARY_ERROR'}:success(job.params.TASKID)]))));
  const results=await context._callDialogTimeElapsedPages(jobs.map(j=>j.params));
  assert.deepEqual(Array.from(results,r=>r.data),jobs.map(j=>j.params.TASKID));
  assert.deepEqual(calls.batch.map(b=>b.length),[50,1]);assert.equal(calls.single.length,0);return {batchSizes:[50,1],pages:results.length};
 });
 await phase('missing partial result cannot be mistaken for a successful empty page',async()=>{
  const {context,calls}=setup((batch,callback)=>callback(Object.fromEntries(Object.entries(batch).filter(([_key,job])=>job.params.TASKID!==17).map(([key,job])=>[key,success(job.params.TASKID)]))));
  await assert.rejects(context._callDialogTimeElapsedPages(jobs.map(j=>j.params)),e=>e.code==='BATCH_PARTIAL_RESPONSE'&&e.partialPages.filter(Boolean).length===49);
  assert.equal(calls.batch.length,1);assert.equal(calls.single.length,0);return {retainedPages:49,batch:1,single:0};
 });
 await phase('individual fallback stops on pressure and settles both active reads before rejecting',async()=>{
  const {context,calls}=setup(()=>{});context.window.BX24=null;
  let active=0;
  context._callBxRestPageWithTimeout=async(method,params)=>{
   calls.single.push({method,params});active++;
   await new Promise(resolve=>setTimeout(resolve,params.TASKID===1?3:20));active--;
   if(params.TASKID===1)throw Object.assign(new Error('quota'),{code:'QUERY_LIMIT_EXCEEDED'});
   return {data:params.TASKID};
  };
  await assert.rejects(context._callDialogTimeElapsedPages(jobs.map(j=>j.params)),e=>e.code==='QUERY_LIMIT_EXCEEDED'&&e.partialPages[1]?.data===2);
  assert.equal(calls.single.length,2);assert.equal(active,0);return {single:2,stillActive:0,retainedPages:1};
 });
 await phase('explicit unsupported transport falls back to read pool, mutations never replay',async()=>{
  const {context,calls}=setup((_batch,callback)=>callback({error:()=> 'ERROR_METHOD_NOT_FOUND'}));
  const result=await context._callBxRestPagesFast(jobs);
  assert.equal(result.length,50);assert.equal(calls.single.length,50);
  await assert.rejects(context._callBxRestPagesFast([{method:'task.elapseditem.add',params:{}}]),e=>e.code==='BATCH_READ_ONLY');
  assert.equal(calls.batch.length,1);assert.equal(calls.single.length,50);return {batch:1,readFallback:50,mutationCalls:0};
 });
} finally {
 mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/native-batch-backpressure-report.json',JSON.stringify({phases},null,2));console.log(JSON.stringify({phases},null,2));
}

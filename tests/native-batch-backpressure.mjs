import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
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
  _PENA_TIME_CONTROL:createRequire(import.meta.url)('../extension/native-time-control.js'),
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
 await phase('task diagnostics retain textual Desktop errors, distinguish unknown reasons and redact credentials',async()=>{
  const {context}=setup(()=>{}),model=context._PENA_TIME_CONTROL;
  const error=context._createBxRestError({error:()=>({getError:()=> 'ERROR_CORE',ex:{error_description:'Task not found'}})});
  assert.equal(error.message,'Task not found');assert.equal(model.describeElapsedError(error).reason,'not-found-or-inaccessible');
  assert.equal(model.describeElapsedError({code:'ERROR_CORE',message:'Access denied'}).reason,'access-denied');
  assert.equal(model.describeElapsedError({code:'ERROR_CORE',message:'0x000100'}).reason,'parameters');
  assert.equal(model.describeElapsedError({code:'ERROR_CORE'}).reason,'unknown');
  const sanitized=model.describeElapsedError({code:'ERROR_CORE',message:'auth=secret https://portal.test/rest/token'});
  assert.doesNotMatch(JSON.stringify(sanitized),/secret|portal\.test|\/rest\/token/);
 });
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
 await phase('legacy 100-task wave uses exactly two 50-read lanes and preserves response order',async()=>{
  const held=[];const {context,calls}=setup((batch,callback)=>held.push(()=>callback(Object.fromEntries(Object.entries(batch).map(([key,job])=>[key,success(job.params.TASKID)])))));
  const params=Array.from({length:100},(_,i)=>({TASKID:i+1}));
  const reading=context._callDialogTimeElapsedPages(params);
  assert.equal(held.length,2,'Both independent batches must dispatch before either finishes');
  assert.deepEqual(calls.batch.map(batch=>batch.length),[50,50]);
  held[1]();held[0]();const rows=await reading;
  assert.deepEqual(Array.from(rows,row=>row.data),params.map(row=>row.TASKID));
  return {parallelBatches:2,reads:100,duplicates:0};
 });
 await phase('parallel legacy access failure retains all other 99 responses including the other lane',async()=>{
  const {context,calls}=setup((batch,callback)=>callback(Object.fromEntries(Object.entries(batch).map(([key,job])=>[key,job.params.TASKID===17?{error:()=> 'ERROR_CORE',error_description:()=> '0x000001'}:success(job.params.TASKID)]))));
  await assert.rejects(context._callDialogTimeElapsedPages(Array.from({length:100},(_,i)=>({TASKID:i+1}))),error=>error.code==='ERROR_CORE'&&error.partialPages.filter(Boolean).length===99&&error.partialErrors[16].message==='0x000001');
  assert.equal(calls.batch.length,2);assert.equal(calls.single.length,0);
 });
 await phase('558 legacy tasks stay complete with at most four concurrent 50-read batches',async()=>{
  let active=0,peak=0;
  const {context,calls}=setup((batch,callback)=>{
   active++;peak=Math.max(peak,active);
   setTimeout(()=>{active--;callback(Object.fromEntries(Object.entries(batch).map(([key,job])=>[key,success(job.params.TASKID)])));},10);
  });
  const params=Array.from({length:558},(_,i)=>({TASKID:i+1}));
  const rows=await context._callDialogTimeElapsedPages(params);
  assert.deepEqual(Array.from(rows,row=>row.data),params.map(row=>row.TASKID));
  assert.equal(peak,4);assert.equal(active,0);assert.equal(calls.batch.length,12);assert.ok(calls.batch.every(batch=>batch.length<=50));
  return {tasks:558,batches:12,maxActive:peak,missing:0,duplicates:0};
 });
 await phase('a task-specific batch error recovers through one individual read without replaying siblings',async()=>{
  const {context,calls}=setup((batch,callback)=>callback(Object.fromEntries(Object.entries(batch).map(([key,job])=>[key,job.params.TASKID===17?{error:()=> 'ERROR_CORE',error_description:()=> '0x000001'}:success(job.params.TASKID)]))));
  const rows=await context._callDialogTimeElapsedPages(jobs.map(j=>j.params),{verifyAccess:true});
  assert.equal(rows.length,50);assert.equal(rows[16].data.TASKID,17);assert.equal(calls.single.length,1);assert.equal(calls.single[0].params.TASKID,17);assert.equal(calls.batch.length,1);
  return {batch:1,individual:1,recovered:1};
 });
 await phase('persistent task denial is confirmed once and preserves the exact individual error',async()=>{
  const {context,calls}=setup((batch,callback)=>callback(Object.fromEntries(Object.entries(batch).map(([key,job])=>[key,job.params.TASKID===17?{error:()=> 'ERROR_CORE',error_description:()=> '0x000001'}:success(job.params.TASKID)]))));
  context._callBxRestPageWithTimeout=async(method,params)=>{calls.single.push({method,params});throw Object.assign(new Error('0x000001'),{code:'ERROR_CORE'});};
  await assert.rejects(context._callDialogTimeElapsedPages(jobs.map(j=>j.params),{verifyAccess:true}),error=>error.partialPages.filter(Boolean).length===49&&error.partialErrors[16].elapsedIndividualConfirmed===true&&error.partialErrors[16].message==='0x000001');
  assert.equal(calls.single.length,1);assert.equal(calls.batch.length,1);
 });
 await phase('parallel pressure drains the other three lanes and prevents all subsequent waves',async()=>{
  let active=0;
  const {context,calls}=setup((batch,callback,round)=>{
   active++;setTimeout(()=>{active--;callback(round===1?{error:()=> 'QUERY_LIMIT_EXCEEDED'}:Object.fromEntries(Object.entries(batch).map(([key,job])=>[key,success(job.params.TASKID)])));},round===1?2:20);
  });
  await assert.rejects(context._callDialogTimeElapsedPages(Array.from({length:558},(_,i)=>({TASKID:i+1}))),error=>error.code==='QUERY_LIMIT_EXCEEDED'&&error.partialPages.filter(Boolean).length===150);
  assert.equal(calls.batch.length,4);assert.equal(calls.single.length,0);assert.equal(active,0);
  return {batches:4,retainedPages:150,stillActive:0};
 });
} finally {
 mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/native-batch-backpressure-report.json',JSON.stringify({phases},null,2));console.log(JSON.stringify({phases},null,2));
}

await import('./native-rest-queue.mjs');

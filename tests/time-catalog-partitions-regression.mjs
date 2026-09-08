import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const model=createRequire(import.meta.url)('../extension/native-time-control.js');
const report={sourceSha:createHash('sha256').update(readFileSync(new URL('../extension/native-time-control.js',import.meta.url))).digest('hex'),phases:[]};
const row=ID=>({ID:String(ID),GROUP_ID:'10',TITLE:`Task ${ID}`});
const phases=async(name,fn)=>{try{report.phases.push({name,status:'PASS',evidence:await fn()});}catch(error){report.phases.push({name,status:'FAIL',error:error.stack});}};
function service(initial,{after=0,upper=Math.max(0,...initial),hook}={}){
 const state={rows:initial.map(row),waves:[],current:true};
 const filter={GROUP_ID:['10'],'>=CHANGED_DATE':'2026-09-08T00:00:00Z'},select=['ID','GROUP_ID','TITLE'];
 const callPages=async jobs=>{
  assert(jobs.length>0&&jobs.length<=16);state.waves.push(structuredClone(jobs));
  const response=jobs.map(job=>{
   assert.equal(job.method,'tasks.task.list');assert.deepEqual(job.params.order,{ID:'asc'});assert.equal(job.params.start,0);
   assert.deepEqual(job.params.filter.GROUP_ID,filter.GROUP_ID);assert.equal(job.params.filter['>=CHANGED_DATE'],filter['>=CHANGED_DATE']);assert.deepEqual(job.params.select,select);
   const lo=job.params.filter['>ID'],hi=job.params.filter['<=ID'];
   assert(lo>=after&&hi<=upper&&lo<hi,'Partition left the fixed read watermark');
   const available=state.rows.filter(r=>Number(r.ID)>lo&&Number(r.ID)<=hi).sort((a,b)=>Number(a.ID)-Number(b.ID));
   return {data:{tasks:available.slice(0,50)},next:available.length>50?50:null};
  });
  await hook?.({state,jobs,response});return response;
 };
 return {state,args:{afterId:after,upperId:upper,filter,select,callPages,isCurrent:()=>state.current}};
}
await phases('4149 sparse and skewed IDs survive deletion behind cursors; new high IDs belong to the next read',async()=>{
 const ids=[...Array.from({length:4000},(_,i)=>i+1),...Array.from({length:100},(_,i)=>100000+i*997),...Array.from({length:49},(_,i)=>9000000+i*113)];
 const upper=ids.at(-1),later=upper+1000;let deleted;
 const f=service(ids,{hook:({state,response})=>{if(state.waves.length===1){deleted=response.flatMap(p=>p.data.tasks)[0].ID;state.rows=state.rows.filter(r=>r.ID!==deleted);state.rows.push(row(later));}}});
 const result=await model.loadTaskCatalogPartitions(f.args);
 assert.deepEqual(result.rows.map(r=>Number(r.ID)),ids);assert.equal(new Set(result.rows.map(r=>r.ID)).size,4149);assert(!result.rows.some(r=>Number(r.ID)===later));assert(result.rows.some(r=>r.ID===deleted));
 assert.equal(result.pages,f.state.waves.reduce((n,w)=>n+w.length,0));
 const delta=service(f.state.rows.map(r=>Number(r.ID)),{after:upper,upper:later});const following=await model.loadTaskCatalogPartitions(delta.args);assert.deepEqual(following.rows.map(r=>Number(r.ID)),[later]);
 return {uniqueOldIds:result.rows.length,pages:result.pages,waves:f.state.waves.length,maxBatch:Math.max(...f.state.waves.map(w=>w.length)),deletedBehindCursor:deleted,nextReadNewIds:1};
});
await phases('empty partitions require two matching confirmations and a zero-width interval makes no requests',async()=>{
 const f=service([],{upper:15});const result=await model.loadTaskCatalogPartitions(f.args);assert.deepEqual(result.rows,[]);assert.equal(result.pages,30);
 const bounds=new Map();for(const job of f.state.waves.flat()){const key=JSON.stringify(job.params.filter);bounds.set(key,(bounds.get(key)||0)+1);}assert.equal(bounds.size,15);assert([...bounds.values()].every(n=>n===2));
 const zero=service([],{after:9,upper:9});assert.deepEqual(await model.loadTaskCatalogPartitions(zero.args),{rows:[],pages:0});assert.equal(zero.state.waves.length,0);
 return {emptyPartitions:15,confirmationsEach:2,zeroWidthCalls:0};
});
await phases('invalid numeric bounds fail before calling the SDK',async()=>{
 for(const [afterId,upperId] of [[-1,20],[20,19],[0,Infinity],[NaN,20],[0,Number.MAX_SAFE_INTEGER+1],['0',20],[0,1.5]]){let calls=0;await assert.rejects(model.loadTaskCatalogPartitions({afterId,upperId,callPages:async()=>{calls++;return[];}}),TypeError);assert.equal(calls,0);}
 return {variants:7,requests:0};
});
await phases('out-of-range, unordered and repeated IDs reject the whole result',async()=>{
 for(const fault of ['below','above','reverse','repeat','malformed']){
  const f=service(Array.from({length:100},(_,i)=>i+1),{upper:10000,hook:({jobs,response})=>{
   const index=response.findIndex(p=>p.data.tasks.length>1),job=jobs[index],batch=response[index].data.tasks;
   if(fault==='below')batch[0]=row(job.params.filter['>ID']);if(fault==='above')batch[0]=row(job.params.filter['<=ID']+1);
   if(fault==='reverse')batch.reverse();if(fault==='repeat')batch[1]=batch[0];if(fault==='malformed')batch[0]={ID:'not-an-id'};
  }});await assert.rejects(model.loadTaskCatalogPartitions(f.args),/границы/);assert.equal(f.state.waves.length,1);
 }
 return {invalidVariants:5,partialResultReturned:false};
});
await phases('missing, sparse and malformed batch responses cannot silently lose a partition',async()=>{
 for(const fault of ['short','hole','undefined','bad-data']){
  const f=service([1,2,3,4],{hook:({response})=>{if(fault==='short')response.pop();if(fault==='hole')delete response[1];if(fault==='undefined')response[1]=undefined;if(fault==='bad-data')response[1]={data:{tasks:{}}};}});
  await assert.rejects(model.loadTaskCatalogPartitions(f.args));assert.equal(f.state.waves.length,1);
 }
 return {invalidBatchVariants:4,partialResultReturned:false};
});
await phases('SDK error and partial flags reject otherwise plausible task rows',async()=>{
 for(const flag of [{error:{code:'ACCESS_DENIED'}},{partial:true},{complete:false}]){
  const f=service([1],{hook:({response})=>Object.assign(response[0],flag)});await assert.rejects(model.loadTaskCatalogPartitions(f.args));
 }
 return {errorFlagVariants:3,partialResultReturned:false};
});
await phases('transport failures propagate without retries or partial results',async()=>{
 const failure=Object.assign(new Error('controlled timeout'),{code:'TIMEOUT'});const f=service([1],{hook:()=>{throw failure;}});
 await assert.rejects(model.loadTaskCatalogPartitions(f.args),error=>error===failure);assert.equal(f.state.waves.length,1);return {automaticRetries:0};
});
await phases('scope and offline fences apply before dispatch and immediately after a pending response',async()=>{
 for(const when of ['before','pending']){
  const f=service([1,2,3],{hook:({state})=>{state.current=false;}});if(when==='before')f.state.current=false;
  await assert.rejects(model.loadTaskCatalogPartitions(f.args),error=>error.code==='STALE_REQUEST');assert.equal(f.state.waves.length,when==='before'?0:1);
 }
 return {beforeDispatchCalls:0,pendingResponsesDiscarded:true};
});
await phases('page cap is enforced before sending an excessive wave and never returns a truncated result',async()=>{
 const f=service(Array.from({length:1000},(_,i)=>i+1));await assert.rejects(model.loadTaskCatalogPartitions({...f.args,maxPages:16}),/большой список/);assert.equal(f.state.waves.length,1);assert.equal(f.state.waves[0].length,16);
 const tooSmall=service([1,2,3],{upper:16});await assert.rejects(model.loadTaskCatalogPartitions({...tooSmall.args,maxPages:15}),/большой список/);assert.equal(tooSmall.state.waves.length,0);
 return {boundedSentPages:16,partialResultReturned:false};
});
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/time-catalog-partitions-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.phases.some(p=>p.status==='FAIL'))process.exitCode=1;

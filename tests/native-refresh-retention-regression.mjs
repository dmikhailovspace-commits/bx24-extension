import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';

const source=readFileSync(process.env.PENA_RETENTION_SOURCE || new URL('../extension/injected.js',import.meta.url),'utf8');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
const probe=`
 window.retentionProbe={
  plan:null,calls:[],release:null,
  records:()=>_getDialogRecentUniqueMeta().map(x=>({...x})),
  seed:record=>_setDialogRecentMeta(_dialogRecentMeta,{availability:'available',...record}),
  replaceLive:record=>{const next=new Map(_dialogRecentMeta);_setDialogRecentMeta(next,record);_replaceDialogRecentMeta(next);},
  full:()=>_syncDialogRecentData({full:true,force:true,silent:true,reason:'retention-regression'}),
  head:()=>_syncDialogRecentData({incrementalOnly:true,force:true,silent:true,reason:'retention-head'}),
  reset:()=>{_clearDialogNativeMetadataRetry('chats');_dialogRecentLastSuccessAt=Date.now()-300000;},
  reconcile:reason=>_runDialogWakeReconcile(reason,{metadataOnly:true}),
  retryState:()=>_dialogNativeMetadataRetryStates.get('chats'),
  due:()=>{const state=_dialogNativeMetadataRetryStates.get('chats');if(state)state.retryAt=0;},
  delays:()=>{const old=window.__PENA_TEST_RECOVERY_RETRY_MS__;delete window.__PENA_TEST_RECOVERY_RETRY_MS__;try{return _getDialogNativeMetadataRetryDelays();}finally{window.__PENA_TEST_RECOVERY_RETRY_MS__=old;}},
  view:()=>({ids:[...(_dialogNativeMaterializedSources.get('chats')?.ids||[])],revision:_dialogNativeMaterializedSources.get('chats')?.revision})
 };
 const originalRead=_callBxRestPageWithTimeout;
 _callBxRestPageWithTimeout=async function(method,...args){
  retentionProbe.calls.push(method);
  if(/^im\\.recent\\.(list|get)$/.test(method)&&retentionProbe.plan){
   const plan=retentionProbe.plan;
   if(plan.hold)await new Promise(resolve=>retentionProbe.release=resolve);
   if(plan.error)throw new Error(plan.error);
   return {data:{items:plan.items||[],hasMore:false},total:(plan.items||[]).length,next:null};
  }
  return originalRead(method,...args);
 };
`;
assert.ok(source.includes(anchor));
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:430,height:780}}),errors=collectPageErrors(page),report={phases:[]};
const phase=async(name,fn)=>{const at=performance.now();const detail=await fn();report.phases.push({name,status:'PASS',ms:performance.now()-at,...detail});};
try{
 await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source.replace(anchor,anchor+probe)}));
 await page.goto(server.baseUrl+'/tests/native-resume-recovery-harness.html');
 await page.waitForFunction(()=>__resumeHarness.ready('chats')&&!__PENA_NATIVE_PREFETCH__.status().originalActive&&!__PENA_NATIVE_PREFETCH__.status().modeLoadPending&&!__PENA_NATIVE_PREFETCH__.status().reconcile.active,undefined,{timeout:30000});
 await page.waitForTimeout(500);
 const before=await page.evaluate(()=>retentionProbe.view());
 await phase('short successful native REST projection preserves every known dialog and the other mode',async()=>{
  const result=await page.evaluate(async()=>{
   retentionProbe.seed({id:'chat99001',displayTitle:'Task from another mode',isTask:true,taskId:'88001'});
   const ids=retentionProbe.records().map(x=>x.id).sort();
   retentionProbe.plan={items:[{id:1,dialog_id:'chat1',type:'chat',title:'Updated title',counter:0}]};
   await retentionProbe.full();
   return {before:ids,after:retentionProbe.records().map(x=>x.id).sort()};
  });
  assert.deepEqual(result.after,[...new Set([...result.before,'chat1'])].sort());return{retained:result.after.length};
 });
 await phase('repeated empty successful responses cannot erase native dialogs',async()=>{
  const result=await page.evaluate(async()=>{const ids=retentionProbe.records().map(x=>x.id).sort();retentionProbe.plan={items:[]};await retentionProbe.full();await retentionProbe.full();return{ids,after:retentionProbe.records().map(x=>x.id).sort()};});
  assert.deepEqual(result.after,result.ids);return{retained:result.ids.length};
 });
 for(const error of [null,'offline'])await phase('concurrent catalog replacement survives '+(error?'failed':'successful')+' refresh',async()=>{
  await page.evaluate(error=>{retentionProbe.plan={items:[],hold:true,error};window.retentionFlight=retentionProbe.full();},error);
  await page.waitForFunction(()=>!!retentionProbe.release);
  await page.evaluate(error=>{
   retentionProbe.replaceLive({id:error?'chat99003':'chat99002',displayTitle:'Arrived during request',availability:'available',recentListFetchedAt:Date.now()+1});
   retentionProbe.release();retentionProbe.release=null;
  },error);
  const result=await page.evaluate(async error=>{await retentionFlight;return retentionProbe.records().find(x=>x.id===(error?'chat99003':'chat99002'));},error);
  assert.equal(result?.displayTitle,'Arrived during request');
 });
 await phase('late REST response preserves newer counters and confirmed unavailability',async()=>{
  await page.evaluate(()=>{retentionProbe.plan={items:[{id:1,dialog_id:'chat1',type:'chat',title:'Old title',counter:9}],hold:true};window.retentionFlight=retentionProbe.full();});
  await page.waitForFunction(()=>!!retentionProbe.release);
  const record=await page.evaluate(async()=>{
   retentionProbe.seed({id:'chat1',displayTitle:'New title',availability:'unavailable',availabilityCheckedAt:Date.now()+1000,recentListFetchedAt:Date.now()+1000,counterFetchedAt:Date.now()+1000,unreadCount:0,hasUnread:false});
   retentionProbe.release();retentionProbe.release=null;await retentionFlight;
   return retentionProbe.records().filter(x=>x.id==='chat1');
  });
  assert.equal(record.length,1);assert.equal(record[0].displayTitle,'New title');assert.equal(record[0].availability,'unavailable');assert.equal(record[0].unreadCount,0);
 });
 await phase('forced concurrent head checks share one request',async()=>{
  await page.evaluate(()=>{retentionProbe.calls=[];retentionProbe.plan={items:[],hold:true};window.retentionFlight=retentionProbe.head();});
  await page.waitForFunction(()=>!!retentionProbe.release);
  await page.evaluate(()=>{window.secondHead=retentionProbe.head();retentionProbe.release();retentionProbe.release=null;retentionProbe.plan.hold=false;});
  const count=await page.evaluate(async()=>{await Promise.all([retentionFlight,secondHead]);return retentionProbe.calls.filter(x=>/^im\.recent\./.test(x)).length;});
  assert.equal(count,1);return{requests:count};
 });
 await phase('focus respects retry deadline and a head failure never triggers a full audit',async()=>{
  const result=await page.evaluate(async()=>{
   window.__PENA_TEST_RECOVERY_RETRY_MS__=[600000];retentionProbe.reset();retentionProbe.calls=[];retentionProbe.plan={error:'offline'};
   await retentionProbe.reconcile('periodic-freshness');
   const count=retentionProbe.calls.length,state=retentionProbe.retryState();
   for(let i=0;i<12;i++)await retentionProbe.reconcile(i%2?'focus-freshness':'visibility-freshness');
   const extra=retentionProbe.calls.length-count;
   retentionProbe.due();retentionProbe.plan={items:[]};retentionProbe.calls=[];
   await retentionProbe.reconcile('metadata-retry:test');
   return{extra,retryAt:state.retryAt,calls:retentionProbe.calls,remaining:retentionProbe.retryState()||null,background:__PENA_NATIVE_PREFETCH__.status().backgroundModes.includes('chats'),delays:retentionProbe.delays()};
  });
  assert.equal(result.extra,0);assert.equal(result.remaining,null);assert.equal(result.background,false);
  assert.equal(result.calls.filter(x=>x==='im.recent.get').length,1);
  assert.equal(result.calls.filter(x=>x==='im.recent.list'||x==='tasks.task.list').length,0);
  assert.deepEqual(result.delays,[30000,60000,120000,300000,600000]);return result;
 });
 assert.deepEqual(await page.evaluate(()=>retentionProbe.view()),before,'Metadata refresh changed physical dialog proof');
 assert.deepEqual(errors,[]);report.status='PASS';
 console.log('PASS native refresh retention: short/empty responses, concurrent replacement, coalesced head checks and retry backoff');
}finally{mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/native-refresh-retention-regression.json',JSON.stringify(report,null,2)+'\n');await page.close();await browser.close();await server.close();}

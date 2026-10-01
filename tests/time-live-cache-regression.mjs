import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const model=createRequire(import.meta.url)('../extension/native-time-control.js');
const cache=model.createElapsedWindowCache(2), day={from:'2024-02-29',to:'2024-02-29'};
assert.deepEqual(cache.rangeFor(day),{from:'2024-02-01',to:'2024-02-29'});
assert.deepEqual(cache.rangeFor({from:'2025-12-31',to:'2025-12-31'}),{from:'2025-12-01',to:'2025-12-31'});
const revisions=new Map([['1',2]]),proof={'1':{at:1,revision:2}},empty=model.aggregateElapsedItems([]);
cache.put('user7/projectsA/zone3',cache.rangeFor(day),empty,['1'],proof);
assert.equal(cache.get('user7/projectsA/zone3',day,['1'],revisions).complete,true);
assert.equal(cache.get('user8/projectsA/zone3',day,['1'],revisions),null);
assert.equal(cache.get('user7/projectsB/zone3',day,['1'],revisions),null);
revisions.set('1',3);assert.equal(cache.get('user7/projectsA/zone3',day,['1'],revisions),null);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1200,height:900}});
const errors=collectPageErrors(page),phases=[];
const raw=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const source=raw.replace('\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;',`\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;
 window.liveProbe={
  select:day=>_setDialogTimeRange({from:day,to:day}),
  record:()=>_getDialogTimeRecord(_getDialogTimeSelectedRange()),
  read:day=>_getDialogTimeRecord({from:day,to:day})?.data?.totalSeconds,
  idle:()=>!_dialogTimeInFlight.size&&!_dialogTimeElapsedEventTimer&&!_dialogTimeProjectCatalogOwner&&!_dialogTimeBootstrapPromise,
  reconcile:()=>{_reconcileDialogTimeVisible.owner=null;return _reconcileDialogTimeVisible();},
  parse:_getDialogTimeNativeElapsedMutation,
  visits:()=>_readDialogTimeVisits(),
  warm:()=>_loadDialogTimeRange(_getDialogTimeSelectedRange()),
  force:()=>_loadDialogTimeRange(_getDialogTimeSelectedRange(),{force:true})
 };`);
const ready=()=>page.waitForFunction(()=>liveProbe.record()?.hasCompleteSnapshot&&liveProbe.record()?.status==='ready'&&liveProbe.idle());
const phase=async(name,run)=>{await run();phases.push({name,status:'PASS'});};
try {
 await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');
 await page.locator('.pena-native-time-button').waitFor();
 await page.evaluate(()=>{window.timeSeedItems=[
  {ID:'501',TASK_ID:'101',USER_ID:'7',SECONDS:'600',CREATED_DATE:'2026-09-21T12:00:00+03:00'},
  {ID:'502',TASK_ID:'101',USER_ID:'7',SECONDS:'1200',CREATED_DATE:'2026-09-20T12:00:00+03:00'}
 ];});
 await page.locator('.pena-native-time-button').click();
 await ready();await page.evaluate(()=>liveProbe.select('2026-09-21'));await ready();
 await phase('adjacent and empty days share a verified month without REST',async()=>{
  assert.equal(await page.evaluate(()=>liveProbe.record().data.totalSeconds),600);
  const count=await page.evaluate(()=>timeRestCalls.length);
  await page.evaluate(()=>liveProbe.select('2026-09-20'));await ready();
  assert.equal(await page.evaluate(()=>liveProbe.record().data.totalSeconds),1200);
  await page.evaluate(()=>liveProbe.select('2026-09-19'));await ready();
  assert.equal(await page.evaluate(()=>liveProbe.record().data.totalSeconds),0);
  assert.equal(await page.evaluate(()=>timeRestCalls.length),count);
 });
 await phase('native manual edit updates every cached day and does not create work',async()=>{
  await page.evaluate(()=>liveProbe.select('2026-09-20'));await ready();
  const count=await page.evaluate(()=>timeRestCalls.length),visits=await page.evaluate(()=>liveProbe.visits());
  await page.evaluate(()=>{
   timeSeedItems.find(row=>row.ID==='502').SECONDS='2400';
   timeSeedItems.find(row=>row.ID==='501').SECONDS='1800';
   const config={action:'tasks.task.elapsedtime.update',data:{taskId:'101',itemId:'502'}};
   (nativeCustomEventHandlers.get('onAjaxSuccess')||[]).forEach(fn=>fn({status:'success',data:{id:'502'}},config));
  });
  await page.waitForFunction(()=>liveProbe.record()?.data?.totalSeconds===2400&&liveProbe.idle());
  assert.equal(await page.evaluate(()=>liveProbe.read('2026-09-21')),1800);
  const reads=await page.evaluate(count=>timeRestCalls.slice(count).map(params=>String(params[0])),count);
  assert.ok(reads.length>=1&&reads.length<=2&&reads.every(id=>id==='101'));assert.deepEqual(await page.evaluate(()=>liveProbe.visits()),visits);
  assert.equal(await page.evaluate(()=>timeAddCalls.length),0);
 });
 await phase('elapsed deletion through Pull removes the row, not the task',async()=>{
  await page.evaluate(()=>{
   timeSeedItems=timeSeedItems.filter(row=>row.ID!=='502');
   (nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).forEach(fn=>fn('task_elapsed_delete',{TASK_ID:'101',ID:'502'}));
  });
  await page.waitForFunction(()=>liveProbe.record()?.data?.totalSeconds===0&&liveProbe.idle());
  assert.equal(await page.evaluate(()=>liveProbe.read('2026-09-21')),1800);
 });
 await phase('visible fallback catches a missed event and is throttled',async()=>{
  await page.evaluate(()=>liveProbe.select('2026-09-21'));await ready();
  const calls=await page.evaluate(()=>timeRestCalls.length);
  await page.evaluate(()=>liveProbe.reconcile());
  assert.equal(await page.evaluate(()=>timeRestCalls.length),calls,'Freshly loaded panel must not repeat its journal read');
  await page.evaluate(async()=>{liveProbe.record().updatedAt=Date.now()-31000;timeSeedItems.find(row=>row.ID==='501').SECONDS='3000';await liveProbe.reconcile();});
  await ready();assert.equal(await page.evaluate(()=>liveProbe.record().data.totalSeconds),3000);
 });
 await phase('confirmed task deletion clears totals and cannot reappear from cached month',async()=>{
	 await page.evaluate(()=>{(nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).forEach(fn=>fn('task_comment_delete',{TASK_ID:'101'}));});
	 assert.equal(await page.evaluate(()=>liveProbe.record().data.totalSeconds),3000,'Comment deletion must not delete the task');
	 await page.evaluate(()=>{
	  const original=BX24.callBatch;
	  BX24.callBatch=function(calls,callback){
	   if(!Object.values(calls).every(call=>call.method==='task.elapseditem.getlist'))return original.apply(this,arguments);
	   BX24.callBatch=original;
	   return original.call(this,calls,result=>{
	    const frozen=Object.fromEntries(Object.entries(result).map(([key,value])=>{
	     const rows=structuredClone(value.data());return[key,{error:()=>null,data:()=>rows,total:()=>value.total?.(),answer:{...value.answer}}];
	    }));
	    window.releasePreDeleteRead=()=>callback(frozen);
	   });
	  };
	  liveProbe.force().catch(()=>{});
	 });
	 await page.waitForFunction(()=>typeof releasePreDeleteRead==='function');
  await page.evaluate(()=>{
   (nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).forEach(fn=>fn('task_delete',{FIELDS_BEFORE:{ID:'101'}}));
  });
	 assert.equal(await page.evaluate(()=>liveProbe.record().data.totalSeconds),0,'Deletion must be visible before the old request completes');
	 await page.evaluate(()=>releasePreDeleteRead());
  await page.waitForFunction(()=>liveProbe.record()?.data?.totalSeconds===0&&liveProbe.idle());
  await page.evaluate(()=>liveProbe.select('2026-09-20'));await ready();
  await page.evaluate(()=>liveProbe.select('2026-09-21'));await ready();
  assert.equal(await page.evaluate(()=>liveProbe.record().data.totalSeconds),0);
  assert.equal(await page.evaluate(()=>timeAddCalls.length),0);
 });
 await phase('failed, unrelated and foreign-origin actions never invalidate elapsed data',async()=>{
  const parsed=await page.evaluate(()=>[
   liveProbe.parse({status:'error'},{action:'tasks.task.delete',data:{taskId:101}}),
   liveProbe.parse({status:'success'},{action:'crm.item.delete',data:{taskId:101}}),
   liveProbe.parse({status:'success'},{url:'https://foreign.invalid/?action=tasks.task.delete',data:{taskId:101}}),
   liveProbe.parse({status:'success',data:false},{action:'tasks.task.delete',data:{taskId:101}})
  ]);assert.deepEqual(parsed,[null,null,null,null]);
 });
 assert.deepEqual(errors,[]);console.log(`PASS live cache: ${phases.length} phases`);
}catch(error){console.error(error);process.exitCode=1;}
finally {mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/time-live-cache-report.json',JSON.stringify({phases,errors},null,2));await browser.close();await server.close();}

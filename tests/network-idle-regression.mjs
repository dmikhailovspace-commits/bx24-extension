import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const server = await startHarnessServer(), browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1100,height:800}});
const errors = collectPageErrors(page), phases=[];
const phase = async(name,fn)=>{const start=Date.now();try{const evidence=await fn();phases.push({name,status:'PASS',ms:Date.now()-start,evidence});}catch(e){phases.push({name,status:'FAIL',ms:Date.now()-start,error:e.message});throw e;}};
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8').replace(
 '\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;',
 `\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;
 window.networkProbe={
  full:()=>_syncDialogTaskCatalog({forceNetwork:true,deferMerge:true}),
  refresh:()=>_refreshDialogTimeTaskCatalog(),
  tab:value=>{_dialogControlNativeWorkspaceTab=value;},
  cursor:()=>({scope:_dialogTimeCatalogScope,cursor:_dialogTimeCatalogCursor}),
  publish:rows=>_publishDialogTimeTaskIndexRows(rows),
  fresh:id=>_getFreshDialogTimeTaskEligibility(id),
  stage:(...args)=>_stageDialogTimeActivity(...args),
  flush:()=>_flushDialogTimePendingActivities(),
  visits:()=>_readDialogTimeVisits(),
  timers:()=>_dialogTimeChangedTaskTimers.size
 };`);
await page.route('**/extension/injected.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:source}));
try {
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks&taskCatalogRows=125&skipInitialMount=1');
 await page.locator('.pena-native-time-button').waitFor();
 await page.waitForFunction(()=>(window.nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).length>0);
 await page.evaluate(()=>{
  window.networkCalls=[];
  const original=window.BX.rest.callMethod;
  window.BX.rest.callMethod=function(method,params,cb){
   window.networkCalls.push({method,params:JSON.parse(JSON.stringify(params)),at:Date.now()});
   if(method==='tasks.task.list'&&params.filter?.['>=CHANGED_DATE'])return cb({error:()=>null,data:()=>({tasks:[]}),next:()=>null});
   return original.apply(this,arguments);
  };
 });
 await phase('native full catalog and time panel share one full scan with request-start delta',async()=>{
  const result=await page.evaluate(async()=>{
   const before=Date.now(), full=window.networkProbe.full();
   window.networkProbe.tab('time');
   const time=window.networkProbe.refresh();
   await Promise.all([full,time]);
   const initialDeltaPages=window.networkCalls.filter(c=>c.method==='tasks.task.list'&&c.params.filter?.['>=CHANGED_DATE']).length;
   await window.networkProbe.refresh(); // An explicit subsequent refresh uses the shared watermark.
   window.networkProbe.tab('dialogs');
   const calls=window.networkCalls.filter(c=>c.method==='tasks.task.list');
   return {before,initialDeltaPages,cursor:window.networkProbe.cursor(),full: calls.filter(c=>!c.params.filter?.['>=CHANGED_DATE']),delta:calls.filter(c=>c.params.filter?.['>=CHANGED_DATE'])};
  });
  assert.equal(result.full.length,3,'Time panel repeated the native 131-task full scan');
  assert.equal(result.initialDeltaPages,0,'Time opening performed a redundant delta immediately after its shared full scan');
  assert.equal(result.delta.length,1,'Expected one explicit subsequent delta after the shared full scan');
  const watermark=Date.parse(result.delta[0].params.filter['>=CHANGED_DATE'])+60000;
  assert.ok(watermark>=result.before&&watermark<=result.full[0].at,'Delta cursor skipped changes received during the full scan');
  return {fullPages:result.full.length,deltaPages:result.delta.length,watermark};
 });
 await phase('100 known task updates create no network or timers with time panel closed',async()=>{
  const result=await page.evaluate(async()=>{
   window.networkCalls=[];
   const handlers=window.nativeCustomEventHandlers.get('onPullEvent-tasks')||[];
   const start=performance.now();
   for(let i=0;i<100;i++)for(const fn of handlers)fn('task_update',{TASK_ID:String(50000+i)});
   const eventMs=performance.now()-start;
   await new Promise(resolve=>setTimeout(resolve,650));
   return {eventMs,gets:window.networkCalls.filter(c=>c.method==='tasks.task.get').length,timers:window.networkProbe.timers(),fresh:window.networkProbe.fresh('50000')};
  });
  assert.equal(result.gets,0);assert.equal(result.timers,0);assert.equal(result.fresh,null);
  return result;
 });
 await phase('closed panel qualification still rechecks disabled and enabled tasks',async()=>{
  const result=await page.evaluate(async()=>{
   window.networkCalls=[];
   window.timeTaskEligibilityOverrides['50000']='N';
   window.networkProbe.stage({taskId:'50000',dialogId:'chat50000'},{qualify:true,reason:'message'});
   await window.networkProbe.flush();
   const disabled=window.networkProbe.visits().find(v=>v.taskId==='50000')?.visits||0;
   window.timeTaskEligibilityOverrides['50000']='Y';
   window.networkProbe.stage({taskId:'50000',dialogId:'chat50000'},{qualify:true,reason:'message'});
   await window.networkProbe.flush();
   return {disabled,enabled:window.networkProbe.visits().find(v=>v.taskId==='50000')?.visits||0,gets:window.networkCalls.filter(c=>c.method==='tasks.task.get').length};
  });
  assert.equal(result.disabled,0);assert.equal(result.enabled,1);assert.equal(result.gets,2);
  return result;
 });
 await phase('visible panel adds unknown tracking task and coalesces repeated updates',async()=>{
  await page.evaluate(()=>{
   window.networkCalls=[];window.networkProbe.tab('time');
   for(let i=0;i<20;i++)for(const fn of window.nativeCustomEventHandlers.get('onPullEvent-tasks')||[])fn('task_update',{TASK_ID:'99999'});
  });
  await page.waitForFunction(()=>window.networkProbe.fresh('99999')===true);
  const gets=await page.evaluate(()=>window.networkCalls.filter(c=>c.method==='tasks.task.get'&&c.params.taskId==='99999').length);
  assert.equal(gets,1);return {gets};
 });
 await phase('closing or hiding panel cancels a deferred task refresh',async()=>{
  const result=await page.evaluate(async()=>{
   window.networkCalls=[];
   for(const fn of window.nativeCustomEventHandlers.get('onPullEvent-tasks')||[])fn('task_update',{TASK_ID:'99999'});
   window.networkProbe.tab('dialogs');
   await new Promise(resolve=>setTimeout(resolve,500));
   window.networkProbe.tab('time');
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
   for(const fn of window.nativeCustomEventHandlers.get('onPullEvent-tasks')||[])fn('task_update',{TASK_ID:'99999'});
   await new Promise(resolve=>setTimeout(resolve,500));
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});window.networkProbe.tab('dialogs');
   return {gets:window.networkCalls.filter(c=>c.method==='tasks.task.get').length,timers:window.networkProbe.timers()};
  });
  assert.equal(result.gets,0);assert.equal(result.timers,0);return result;
 });
 assert.deepEqual(errors,[]);
} finally {
 mkdirSync('tests/artifacts',{recursive:true});
 writeFileSync('tests/artifacts/network-idle-report.json',JSON.stringify({phases,errors},null,2));
 console.log(JSON.stringify({phases,errors},null,2));
 await browser.close();await server.close();
}

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';

const root=resolve(import.meta.dirname,'..');
const extension=resolve(process.env.PENA_EXTENSION_DIR||resolve(root,'extension'));
const label=process.env.PENA_FEEDBACK_LABEL||'current';
const reportOnly=process.env.PENA_FEEDBACK_REPORT_ONLY==='1';
const raw=readFileSync(resolve(extension,'injected.js'),'utf8');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
assert.equal(raw.split(anchor).length-1,1);
const source=raw.replace(anchor,anchor+`
 window.feedbackProbe={
  prepare:(...args)=>_prepareDialogTimeManualEntry(...args),
  load:(force=false)=>_loadDialogTimeRange(_getDialogTimeSelectedRange(),{force}),
  dirty:taskId=>_dialogTimeTaskRevisions.set(String(taskId),(_dialogTimeTaskRevisions.get(String(taskId))||0)+1),
  range:()=>_getDialogTimeSelectedRange(),
  select:range=>_setDialogTimeRange(range),
  record:()=>_getDialogTimeRecord(_getDialogTimeSelectedRange()),
  sync:()=>_syncDialogTimeUi(_dialogControlNativeSwitcherNode),
  active:()=>_dialogControlNativeWorkspaceTab,
 };`).replace('\tfunction _showDialogDockToast(msg, tone = \'\') {',`\tfunction _showDialogDockToast(msg, tone = '') {
 window.feedback?.toastLog.push({text:String(msg),tone});`);
const report={label,source:{sha256:createHash('sha256').update(raw).digest('hex')},phases:[],snapshots:[],
 limitations:['Actual Chromium UI and production handlers, controlled Bitrix SDK responses.','No live portal or installed desktop check. Delayed ACK/read and missing freshly written rows are injected scenarios.']};
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=collectPageErrors(page);
const phase=async(name,fn)=>{try{await fn();report.phases.push({name,status:'PASS'});}catch(error){report.phases.push({name,status:'FAIL',error:error.message});if(!reportOnly)throw error;}};
const snapshot=async(name)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const data=await page.evaluate(()=>window.feedback.snapshot());report.snapshots.push({name,...data});return data;};
try {
 await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');
 await page.locator('.pena-native-time-button').waitFor();
 await page.evaluate(()=>{
  const f=window.feedback={readMode:'hold',holdAdd:false,heldReads:[],heldAdds:[],readCalls:0,deliveredReads:0,readTaskIds:[],addCalls:0,hideAdded:false,toastLog:[]};
  const errorResult=()=>({error:()=> 'TEMPORARY_ERROR',error_description:()=> 'controlled elapsed refresh failed'});
  const transform=value=>{
   if(f.readMode==='fail')return errorResult();
   if(f.readMode==='timeout')return {error:()=> 'TIMEOUT',error_description:()=> 'controlled background elapsed timeout'};
   if(!f.hideAdded)return value;
   const data=(value.data?.()||[]).filter(item=>!String(item.ID||item.id).startsWith('90000'));
   return {error:()=>null,data:()=>data,total:()=>data.length,answer:{}};
  };
  const method=BX.rest.callMethod;
  BX.rest.callMethod=function(name,params,callback){
   if(name==='task.elapseditem.add') {
    f.addCalls++;
    return method.call(this,name,params,value=>{if(f.holdAdd)f.heldAdds.push(()=>callback(value));else callback(value);});
   }
   if(name!=='task.elapseditem.getlist')return method.call(this,name,params,callback);
   f.readCalls++;
   f.readTaskIds.push(String(params?.[0]||params?.TASKID||''));
   return method.call(this,name,params,value=>{const deliver=()=>{f.deliveredReads++;callback(transform(value));};if(f.readMode==='hold')f.heldReads.push(deliver);else deliver();});
  };
  const batch=BX24.callBatch;
  BX24.callBatch=function(calls,callback){
   const elapsed=Object.entries(calls).filter(([,call])=>call?.method==='task.elapseditem.getlist');
   if(!elapsed.length)return batch.call(this,calls,callback);
   f.readCalls+=elapsed.length;
   for(const[,call]of elapsed)f.readTaskIds.push(String(call.params?.[0]||''));
   return batch.call(this,calls,result=>{
    const deliver=()=>{const next={...result};for(const[key]of elapsed)next[key]=transform(next[key]);f.deliveredReads+=elapsed.length;callback(next);};
    if(f.readMode==='hold')f.heldReads.push(deliver);else deliver();
   });
  };
  f.releaseReads=mode=>{f.readMode=mode;for(const done of f.heldReads.splice(0))done();};
  f.releaseAdds=()=>{f.holdAdd=false;for(const done of f.heldAdds.splice(0))done();};
  f.snapshot=()=>{
   const panel=document.querySelector('.pena-native-time-panel'),record=window.feedbackProbe.record();
   const manualError=panel?.querySelector('.pena-native-time-manual-error'),refresh=panel?.querySelector('.pena-native-time-refresh');
   const status=panel?.querySelector('.pena-native-time-read-status,[role="status"]');
   return {active:window.feedbackProbe.active(),range:window.feedbackProbe.range(),cacheStatus:record?.status,error:record?.error||'',
    seconds:record?.data?.totalSeconds??null,entries:record?.data?.entryCount??null,total:panel?.querySelector('.pena-native-time-total-value')?.textContent,
    coverage:record?.data?.coverage??null,readProgress:record?.readProgress??null,deliveredReads:f.deliveredReads,
    manualError:manualError&&!manualError.hidden?manualError.textContent:'',submit:panel?.querySelector('.pena-native-time-manual-submit')?.textContent,
    statusText:status?.textContent||'',statusHidden:status?.hidden??null,
    refreshDisabled:refresh?.disabled,refreshAnimation:refresh?.querySelector('svg')?getComputedStyle(refresh.querySelector('svg')).animationName:'',
    refreshTitle:refresh?.title||'',readCalls:f.readCalls,task101Reads:f.readTaskIds.filter(id=>id==='101').length,addCalls:f.addCalls,heldReads:f.heldReads.length,
    toastLog:f.toastLog.slice(),toasts:[...document.querySelectorAll('.pena-native-toast')].map(node=>({text:node.textContent,className:node.className}))};
  };
 });
 await page.locator('.pena-native-time-button').click();
 await page.waitForFunction(()=>window.feedback.heldReads.length>0);
 await page.waitForTimeout(100);
 const first=await snapshot('first-open-before-response');
 await phase('before any elapsed response visible total is unknown, not a synthetic zero',()=>{
  assert.equal(first.error,'');assert.equal(first.manualError,'');assert.equal(first.deliveredReads,0);assert.equal(first.cacheStatus,'loading');
  // An internal aggregate([]) may contain numeric zero. It is not evidence
  // that this user's selected range has no entries before any response.
  assert.equal(first.total,'—');assert.match(first.statusText,/Загружаем список задач|Считаем время/);
 });
 await page.evaluate(()=>window.feedback.heldReads.shift()());
 await page.waitForFunction(()=>window.feedback.heldReads.length>0&&window.feedbackProbe.record()?.data?.coverage?.checkedTasks>0);
 const partial=await snapshot('first-open-partial-response');
 await phase('initial partial responses retain a visible loading status until the catalog is checked',()=>{
  assert(partial.coverage.checkedTasks<partial.coverage.totalTasks);assert.equal(partial.statusHidden,false);assert.equal(partial.cacheStatus,'loading');
 });
 await page.evaluate(()=>window.feedback.releaseReads('pass'));
 await page.waitForFunction(()=>window.feedbackProbe.record()?.status==='ready'&&window.feedbackProbe.record()?.data?.totalSeconds===5400);
 const ready=await snapshot('first-open-ready');
 await phase('a complete ready snapshot does not reserve a loading status row',()=>assert.equal(ready.statusHidden,true));

 await phase('background timeout and a queued manual successor retain distinct outcomes',async()=>{
  await page.waitForFunction(()=>{
   const queue=window.__PENA_REST_DIAGNOSTICS__?.snapshot();
   return document.querySelector('.pena-native-time-read-status')?.dataset.state==='ready'&&queue?.active===0&&queue?.queued===0;
  });
  await page.evaluate(()=>{window.feedback.readMode='hold';window.feedbackProbe.dirty('101');window.feedbackProbe.load().catch(()=>{});});
  await page.waitForFunction(()=>window.feedback.heldReads.length>0);
  const held=await snapshot('background-timeout-held');
  await page.locator('.pena-native-time-refresh').click();
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-refresh')?.disabled===true);
  await page.evaluate(()=>{window.feedback.releaseReads('timeout');window.feedback.readMode='pass';});
  await page.waitForFunction(()=>window.__PENA_REST_DIAGNOSTICS__?.snapshot()?.samples.some(s=>s.method==='batch:task.elapseditem.getlist'&&s.code==='TIMEOUT'));
  const failed=await snapshot('background-timeout-before-manual-successor');
  assert.equal(failed.seconds,5400);assert.equal(failed.refreshDisabled,true);
  assert.equal(failed.toastLog.slice(held.toastLog.length).some(toast=>toast.tone==='danger'),false);
  const cooldown=await page.evaluate(()=>window.__PENA_REST_DIAGNOSTICS__.snapshot().cooldownMs);
  assert(cooldown>=12000,`Actual queue cooldown was not active: ${cooldown}`);
  await page.waitForFunction(()=>!document.querySelector('.pena-native-time-refresh')?.disabled&&window.feedback.toastLog.some(toast=>toast.tone==='ok'&&toast.text.includes('Обновлено')),{},{timeout:22000});
  const recovered=await snapshot('background-timeout-manual-successor-ready');
  assert.equal(recovered.total,'1 ч 30 мин');assert.equal(recovered.error,'');
  assert.equal(recovered.toastLog.slice(held.toastLog.length).some(toast=>toast.tone==='danger'),false);
  report.backgroundTimeoutTrace=await page.evaluate(()=>window.__PENA_REST_DIAGNOSTICS__.snapshot().samples.filter(sample=>sample.method==='batch:task.elapseditem.getlist'));
  const timeoutIndex=report.backgroundTimeoutTrace.findIndex(sample=>sample.code==='TIMEOUT');
  assert.equal(report.backgroundTimeoutTrace.filter(sample=>sample.code==='TIMEOUT').length,1);
  const failedRead=report.backgroundTimeoutTrace[timeoutIndex], successorRead=report.backgroundTimeoutTrace[timeoutIndex+1];
  // Manual refresh now discovers selected tasks before elapsed. The catalog
  // request may consume the cooldown; measure dispatch time, not queue time
  // of the later elapsed job in isolation.
  assert(successorRead.startedAt-(failedRead.startedAt+failedRead.durationMs)>=cooldown-250,'Manual successor bypassed the real timeout cooldown');
 });

 await page.evaluate(()=>{window.feedback.holdAdd=true;window.feedback.readMode='hold';window.feedbackProbe.prepare({taskId:'101',title:'Задача 101'});});
 await page.locator('.pena-native-time-manual-minutes').fill('10');
 await page.locator('.pena-native-time-manual-submit').click();
 await page.waitForFunction(()=>window.feedback.heldAdds.length===1);
 await page.waitForTimeout(120);
 const pending=await snapshot('add-request-unanswered');
 // A second render while the same network request is alive must preserve its
 // sending state; a disk reload after an uncertain request is a different case.
 await page.evaluate(()=>window.feedbackProbe.sync());
 const rerendered=await snapshot('add-request-unanswered-rerender');
 await page.evaluate(()=>window.feedback.releaseAdds());
 await page.waitForFunction(()=>window.feedbackProbe.record()?.data?.totalSeconds===6000);
 const accepted=await snapshot('add-ack-before-reread');
 await phase('live ADD acknowledgement is not reported missing before it arrives',()=>{
  assert.equal(pending.manualError,'');assert.equal(rerendered.manualError,'');assert.equal(pending.submit,'Сохраняем…');assert.equal(pending.addCalls,1);
 });
 await phase('successful ADD updates cached total before a delayed reread',()=>{
  assert.equal(accepted.seconds,6000);assert.equal(accepted.entries,3);assert.equal(accepted.manualError,'');assert.equal(accepted.total,'1 ч 40 мин');
  assert(accepted.toasts.some(toast=>/Добавлено/.test(toast.text)&&toast.className.includes('--ok')));
  assert.equal(accepted.toasts.some(toast=>toast.className.includes('--danger')),false);
 });
 await phase('fresh confirmed ADD does not reread the same task eagerly',()=>{
  assert.equal(accepted.task101Reads,pending.task101Reads);assert.equal(accepted.seconds,6000);
 });
 await page.evaluate(()=>{if(!window.feedback.heldReads.length)window.feedbackProbe.load(true).catch(()=>{});});
 await page.waitForFunction(()=>window.feedback.heldReads.length>0);
 await page.evaluate(()=>window.feedback.releaseReads('fail'));
 await page.waitForFunction(()=>window.feedbackProbe.record()?.status!=='loading');
 await page.waitForTimeout(100);
 const rereadFailure=await snapshot('successful-add-failed-reread');
 await phase('reread failure preserves confirmed ADD and does not become a write error',()=>{
  assert.equal(rereadFailure.seconds,6000);assert.equal(rereadFailure.entries,3);assert.equal(rereadFailure.manualError,'');assert.equal(rereadFailure.addCalls,1);
 });

 await page.evaluate(()=>{window.feedback.readMode='pass';window.feedback.hideAdded=true;window.feedbackProbe.load(true).catch(()=>{});});
 await page.waitForFunction(()=>window.feedbackProbe.record()?.status!=='loading');
 await page.waitForTimeout(100);
 const staleRead=await snapshot('successful-add-stale-replica');
 await phase('explicit forced backend snapshot is authoritative',()=>{
  // This response might mean replica lag OR an external deletion. No real
  // portal lag contract is established, so do not require a fabricated ghost
  // row to survive an explicit forced read. Automatic post-ACK reads are
  // checked separately above, including request counts.
  assert.equal(staleRead.seconds,5400);assert.equal(staleRead.entries,2);
 });
 await page.evaluate(()=>{window.feedback.hideAdded=false;window.feedbackProbe.load(true).catch(()=>{});});
 await page.waitForFunction(()=>window.feedbackProbe.record()?.status==='ready'&&window.feedbackProbe.record()?.data?.totalSeconds===6000);

 await page.evaluate(()=>{window.timeAddFailures=1;window.feedbackProbe.prepare({taskId:'101',title:'Задача 101'});});
 await page.locator('.pena-native-time-manual-minutes').fill('10');
 await page.locator('.pena-native-time-manual-submit').click();
 await page.waitForFunction(()=>window.feedback.addCalls===2&&document.querySelector('.pena-native-time-manual-submit')?.textContent!=='Сохраняем…');
 const rejected=await snapshot('actual-add-rejection');
 await phase('actual ADD rejection stays actionable and cannot inflate totals',()=>{
  assert.match(rejected.manualError,/отклонил|сохран|запис|добав/i);assert.doesNotMatch(rejected.manualError,/получить затраченное/i);assert.equal(rejected.seconds,6000);assert.equal(rejected.addCalls,2);
  assert(rejected.toasts.some(toast=>toast.className.includes('--danger')&&/отклонил|сохран|запис|добав/i.test(toast.text)));
 });

 await page.evaluate(()=>{window.feedback.readMode='hold';window.feedbackProbe.dirty('101');window.feedbackProbe.load().catch(()=>{});});
 await page.waitForFunction(()=>window.feedback.heldReads.length>0);
 const background=await snapshot('cached-background-refresh');
 await phase('background refresh preserves cache and keeps refresh icon static',()=>{
  assert.equal(background.seconds,6000);assert.equal(background.refreshAnimation,'none');assert.equal(background.refreshDisabled,false);
  assert.equal(background.statusHidden,true);assert.match(background.statusText,/загруз|провер|обнов|собир/i);
 });
 await page.evaluate(()=>window.feedback.releaseReads('pass'));
 await page.waitForFunction(()=>window.feedbackProbe.record()?.status==='ready');
 await page.evaluate(()=>{window.feedback.readMode='hold';});
 await page.locator('.pena-native-time-refresh').click();
 await page.waitForFunction(()=>window.feedback.heldReads.length>0);
 const manualRefresh=await snapshot('manual-refresh-pending');
 await phase('manual refresh shares the same stable cached total',()=>{assert.equal(manualRefresh.seconds,6000);assert.equal(manualRefresh.refreshAnimation,'none');assert.equal(manualRefresh.refreshDisabled,true);assert.equal(manualRefresh.statusHidden,false);});

 const today=await page.evaluate(()=>window.feedbackProbe.range().from);
 await page.locator('.pena-native-time-date-prev').count().then(async count=>{
  if(count)await page.locator('.pena-native-time-date-prev').click();
  else await page.evaluate(()=>{const d=new Date(window.feedbackProbe.range().from+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);const day=d.toISOString().slice(0,10);window.feedbackProbe.select({from:day,to:day});});
 });
 await page.evaluate(()=>window.feedback.releaseReads('pass'));
 await page.waitForFunction(()=>window.feedbackProbe.record()?.status==='ready');
 const yesterday=await snapshot('different-range-after-old-read');
 await phase('completed empty read shows a verified zero on the selected date',()=>{assert.notEqual(yesterday.range.from,today);assert.equal(yesterday.seconds,0);assert.equal(yesterday.total,'0 мин');assert(yesterday.coverage.checkedTasks>0);});
 await phase('manual refresh completion does not toast for a different selected range',()=>{
  assert.equal(yesterday.toastLog.slice(manualRefresh.toastLog.length).some(toast=>/Обновлено/.test(toast.text)),false);
 });
 await page.evaluate(()=>{window.feedback.readMode='hold';});
 await page.locator('.pena-native-time-refresh').click();
 await page.waitForFunction(()=>window.feedback.heldReads.length>0);
 const closing=await snapshot('manual-refresh-before-close');
 await phase('refresh keeps a previously verified zero while new responses are held',()=>{
  assert.equal(closing.seconds,0);assert.equal(closing.total,'0 мин');assert.equal(closing.readProgress.completedTasks,0);assert(closing.coverage.checkedTasks>0);
  assert.match(closing.statusText,/Проверяем актуальность/);
 });
 await page.locator('.pena-native-time-header-actions > .pena-native-popover-close').click();
 await page.evaluate(()=>window.feedback.releaseReads('fail'));
 await page.waitForTimeout(120);
 const closed=await snapshot('manual-refresh-completion-after-close');
 await phase('manual refresh completion stays silent after close',()=>{
  assert.equal(closed.toastLog.length,closing.toastLog.length);
 });
 await page.evaluate(()=>{window.feedback.readMode='pass';});
 await page.locator('.pena-native-time-button').click();
 await page.waitForTimeout(120);
 const reopened=await snapshot('close-reopen-selected-date');
 await phase('close/reopen retains the selected range and its cached total',()=>{assert.equal(reopened.range.from,yesterday.range.from);assert.equal(reopened.seconds,0);});
 assert.deepEqual(errors,[]);
 await page.close();
 await phase('cold timezone failure is visible and manual retry recovers',async()=>{
  const cold=await browser.newPage({viewport:{width:1000,height:800}});
  const coldErrors=collectPageErrors(cold);
  try {
   await cold.addInitScript(()=>{
    window.feedbackFailTime=true;
    let bx;
    Object.defineProperty(window,'BX',{configurable:true,get:()=>bx,set(value){
     const original=value?.rest?.callMethod;
     if(original)value.rest.callMethod=function(method,params,callback){
      if(method==='server.time'&&window.feedbackFailTime){callback({error:()=> 'TEMPORARY_ERROR',error_description:()=> 'controlled server.time failure'});return;}
      return original.apply(this,arguments);
     };
     bx=value;
    }});
   });
   await cold.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
   await cold.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');
   await cold.locator('.pena-native-time-button').waitFor();await cold.locator('.pena-native-time-button').click();
   await cold.locator('.pena-native-time-panel').waitFor();await cold.waitForTimeout(150);
   const failed=await cold.evaluate(()=>{
    const status=document.querySelector('.pena-native-time-read-status');
    return {state:status?.dataset.state,text:status?.textContent,hidden:status?.hidden,readCount:window.timeRestCalls.length};
   });
   report.snapshots.push({name:'cold-server-time-error',...failed});
   assert.equal(failed.state,'error');assert.equal(failed.hidden,false);assert.equal(failed.readCount,0);
   await cold.evaluate(()=>{window.feedbackFailTime=false;});
   await cold.locator('.pena-native-time-refresh').click();
   await cold.waitForFunction(()=>window.feedbackProbe.record()?.data?.totalSeconds===5400);
   assert.deepEqual(coldErrors,[]);
  } finally {await cold.close();}
 });
 console.log(JSON.stringify(report.phases));
} finally {
 report.errors=errors;mkdirSync(resolve(root,'tests/artifacts'),{recursive:true});
 writeFileSync(resolve(root,`tests/artifacts/time-panel-feedback-${label}.json`),JSON.stringify(report,null,2));
 await browser.close();await server.close();
}

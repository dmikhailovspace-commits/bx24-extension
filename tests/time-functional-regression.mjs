import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const server = await startHarnessServer(), browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1000,height:800},timezoneId:process.env.PENA_TEST_BROWSER_TIMEZONE || undefined});
const errors = collectPageErrors(page), phases=[];let windowCatalogBoundary=null;
const phase = async (name, fn) => { const at=Date.now(); try { await fn(); phases.push({name,status:'PASS',ms:Date.now()-at}); } catch(e) { phases.push({name,status:'FAIL',ms:Date.now()-at,error:e.message}); throw e; } };
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8').replace(
 '\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;',
 `\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;
 window.timeProbe = {
 prepare: (...args) => _prepareDialogTimeManualEntry(...args),
 draft: () => _readDialogTimeManualDraft(),
 stage: (...args) => _stageDialogTimeActivity(...args),
 qualify: (...args) => _qualifyPendingDialogTimeDuration(...args),
 pending: id => _dialogTimePendingActivities.get('task:'+id),
 refresh: (force = true) => _refreshDialogTimeTaskCatalog({force}),
 projectCatalog: options => _ensureDialogTimeProjectCatalog(options),
 readWork: () => ({changedTaskTimers:_dialogTimeChangedTaskTimers.size,elapsedTimer:!!_dialogTimeElapsedEventTimer,elapsedReads:_dialogTimeInFlight.size,titleRead:!!_dialogTimeTitleLoadPromise,titleQueued:_dialogTimeTitleLoadQueued,eligibilityReads:_dialogTimeTaskEligibilityInFlight.size,projectCatalog:!!_dialogTimeProjectCatalogOwner}),
 eligibility: id => _getFreshDialogTimeTaskEligibility(id),
 flush: () => _flushDialogTimePendingActivities(),
 visits: () => _readDialogTimeVisits(),
 publish: rows => { rows.forEach(task => _rememberDialogTimeProjectTask(task)); return _publishDialogTimeTaskIndexRows(rows); },
 cacheTasks: () => _dialogTimeCache.get(_getDialogTimeCacheKey(_getDialogTimeSelectedRange()))?.taskIdsKey,
 loadAuto: () => _loadDialogTimeRange(_getDialogTimeSelectedRange()),
 load: () => _loadDialogTimeRange(_getDialogTimeSelectedRange(), {force:true})
 };
 const originalScheduleElapsed = _scheduleDialogTimeElapsedRefresh;
 _scheduleDialogTimeElapsedRefresh = (...args) => {
  const result = originalScheduleElapsed(...args);
  const notify = window.timeElapsedScheduled;
  window.timeElapsedScheduled = null;
  if (notify) notify(window.timeProbe.readWork());
  return result;
 };`).replace(
 '\tasync function _loadDialogTimeRange(range = _dialogTimeRange, { force = false, bootstrap = null } = {}) {',
 '\tasync function _loadDialogTimeRange(range = _dialogTimeRange, { force = false, bootstrap = null } = {}) {\n window.timeRangeLoadStarts = (window.timeRangeLoadStarts || 0) + 1; (window.timeRangeLoadTrace ||= []).push({at:Date.now(),stack:new Error().stack});'
 );
await page.route('**/extension/injected.js*',route=>route.fulfill({status:200,contentType:'application/javascript',body:source}));
try {
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');
 await page.locator('.pena-native-time-button').waitFor();
 await page.locator('.pena-native-time-button').click();
 await page.locator('.pena-native-time-panel').waitFor();
 await page.waitForFunction(()=>document.querySelector('.pena-native-time-total-value')?.textContent.includes('30'));
 await phase('edit survives a delayed pre-edit elapsed response',async()=>{
  await page.evaluate(()=>{
   const original=window.BX24.callBatch;
   window.BX24.callBatch=function(calls,callback,...rest){
    window.BX24.callBatch=original;
    return original.call(this,calls,result=>{
     const frozen=Object.fromEntries(Object.entries(result).map(([key,value])=>{
      const data=JSON.parse(JSON.stringify(value.data()));
      return [key,{error:()=>null,data:()=>data,total:()=>value.total?.(),answer:{next:value.answer?.next}}];
     }));
     window.heldElapsedRead=true;
     setTimeout(()=>callback(frozen),1400);
    },...rest);
   };
   window.timeProbe.load().catch(()=>{});
  });
  await page.waitForFunction(()=>window.heldElapsedRead);
  const row=page.locator('.pena-native-time-entry-row').filter({hasText:'Задача 101'});
  await row.locator('.pena-native-time-row-edit').click();
  await page.locator('.pena-native-time-entry-hours').fill('0');
  await page.locator('.pena-native-time-entry-minutes').fill('45');
  await page.locator('.pena-native-time-entry-save').click();
  await page.waitForFunction(()=>window.timeUpdateCalls.length>0 && document.querySelector('.pena-native-time-total-value').textContent==='1 ч 15 мин');
  await page.waitForTimeout(1600);
  assert.equal(await page.locator('.pena-native-time-total-value').textContent(),'1 ч 15 мин');
 });
 await phase('top layer defeats Bitrix z-index and transformed ancestor',async()=>{
  const result=await page.evaluate(()=>{
   const modal=document.querySelector('.pena-native-time-modal'), panel=modal.querySelector('.pena-native-time-panel');
   const badge=document.createElement('div'); badge.textContent='сегодня'; badge.id='foreign-badge';
   badge.style.cssText='position:fixed;inset:0;z-index:2147483647;background:red';document.body.append(badge);
   const host=modal.closest('.test-host');host.style.transform='translateZ(0)';host.style.zIndex='1';
   const r=panel.getBoundingClientRect(), hit=document.elementFromPoint(r.x+30,r.y+80);
   return {top:modal.matches(':popover-open'),hit:panel.contains(hit),width:r.width};
  });
  assert.equal(result.top,true);assert.equal(result.hit,true);assert.equal(result.width,960);
  await page.evaluate(()=>document.getElementById('foreign-badge').remove());
 });
 await phase('scrolling summary and centered icon geometry',async()=>{
  const metrics=await page.evaluate(()=>{
   const panel=document.querySelector('.pena-native-time-panel'), scroll=panel.querySelector('.pena-native-time-scroll'), summary=panel.querySelector('.pena-native-time-summary');
   const spacer=document.createElement('div');spacer.style.height='600px';scroll.append(spacer);
   const before=summary.getBoundingClientRect().top;scroll.scrollTop=80;
   const delta=before-summary.getBoundingClientRect().top;scroll.scrollTop=0;spacer.remove();
   const input=panel.querySelector('.pena-native-time-date-input');
   const icons=[...panel.querySelectorAll('.pena-native-time-row-edit svg,.pena-native-time-row-delete svg,.pena-native-time-refresh svg')].map(svg=>{
    const a=svg.getBoundingClientRect(),b=svg.parentElement.getBoundingClientRect(), ink=svg.getBBox();
    return {dx:(a.x+a.width/2)-(b.x+b.width/2),dy:(a.y+a.height/2)-(b.y+b.height/2),inkX:ink.x+ink.width/2,inkY:ink.y+ink.height/2};
   });
   return {delta,width:input.getBoundingClientRect().width,icons};
  });
  assert.equal(metrics.delta,80);assert.equal(metrics.width,124);assert.ok(metrics.icons.length>=3);
  metrics.icons.forEach(icon=>{assert.ok(Math.abs(icon.dx)<.6);assert.ok(Math.abs(icon.dy)<.6);assert.ok(Math.abs(icon.inkX-12)<=1);assert.ok(Math.abs(icon.inkY-12)<=1);});
 });
 await phase('search finds task without CHAT_ID and drops explicit N',async()=>{
  await page.evaluate(()=>{window.timeSearchOnlyEntries=[{ID:'90901',TITLE:'Без чата уникальная',ALLOW_TIME_TRACKING:'Y'},{ID:'90902',TITLE:'Без чата выключена',ALLOW_TIME_TRACKING:'N'}]});
  await page.locator('.pena-native-time-manual-search').fill('Без чата');
  await page.locator('#pena-time-task-option-90901').waitFor();
  assert.equal(await page.locator('#pena-time-task-option-90902').count(),0);
 });
 await phase('task changes refresh eligibility without full traversal',async()=>{
  await page.evaluate(()=>{
   const original=window.BX.rest.callMethod;
   window.BX.rest.callMethod=function(method,params,cb){
    if(method==='tasks.task.get' && String(params.taskId)==='90901')return cb({error:()=>null,data:()=>({task:{id:'90901',title:'Без чата уникальная',groupId:'1',allowTimeTracking:window.timeTaskEligibilityOverrides['90901']||'Y'}})});
    return original.apply(this,arguments);
   };
   window.timeTaskEligibilityOverrides['90901']='N';
   (window.nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).forEach(fn=>fn('task_update',{TASK_ID:'90901'}));
  });
  await page.waitForFunction(()=>window.timeProbe.eligibility('90901')===false);
  assert.equal(await page.locator('#pena-time-task-option-90901').count(),0);
  await page.evaluate(()=>{window.timeTaskEligibilityOverrides['90901']='Y';(window.nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).forEach(fn=>fn('task_update',{TASK_ID:'90901'}));});
  await page.locator('#pena-time-task-option-90901').waitFor();
 });
 // Exercise the boundary with a real deferred task event, so phase isolation
 // cannot accidentally pass only when the preceding UI wait happened to be slow.
 const deferredBoundary = await page.evaluate(()=>new Promise(resolve=>{
  window.timeElapsedScheduled=resolve;
  (window.nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).forEach(fn=>fn('task_update',{TASK_ID:'90901'}));
 }));
 assert.equal(deferredBoundary.elapsedTimer,true,'The actual prior task handler must schedule a deferred elapsed refresh');
 await phase('all catalog pages and incremental watermark',async()=>{
  windowCatalogBoundary = {pending:deferredBoundary,start:await page.evaluate(()=>window.timeRangeLoadStarts||0)};
  // Do not attribute an older task event's 100ms refresh to the catalog pages.
  // Wait for real owners, including chained title/eligibility work, before
  // replacing the SDK fixture and taking the exact-zero baseline.
  await page.waitForFunction(()=>Object.values(window.timeProbe.readWork()).every(value=>!value),null,{timeout:15000});
  windowCatalogBoundary.idle = await page.evaluate(()=>window.timeProbe.readWork());
  assert.ok(Object.values(windowCatalogBoundary.idle).every(value=>!value));
  await page.evaluate(()=>{
   window.catalogProbeCalls=[];
   const original=window.BX.rest.callMethod;window.catalogProbeOriginal=original;
   window.catalogProbeRows=Array.from({length:125},(_,i)=>({ID:String(92000+i),TITLE:'Каталог '+i,GROUP_ID:'1',ALLOW_TIME_TRACKING:i===124?'Y':'N'}));
   window.BX.rest.callMethod=function(method,params,cb){
    if(method==='tasks.task.list' && params.order?.ID==='asc'){
     window.catalogProbeCalls.push(params);
     const start=params.start||0, delta=!!params.filter?.['>=CHANGED_DATE'];
     const data=delta?[]:window.catalogProbeRows.filter(row=>Number(row.ID)>Number(params.filter?.['>ID']||0)).slice(start,start+50);
     return cb({error:()=>null,data:()=>({tasks:data}),next:()=>null});
    }
    return original.apply(this,arguments);
   };
  });
  const loadStarts = await page.evaluate(()=>window.timeRangeLoadStarts || 0);
  await page.evaluate(()=>window.timeProbe.refresh());
  await page.waitForFunction(()=>timeProbe.eligibility('92124')===true);
  assert.deepEqual(await page.evaluate(()=>window.catalogProbeCalls.map(c=>c.start)),[0,0,0]);
  assert.deepEqual(await page.evaluate(()=>window.catalogProbeCalls.map(c=>c.filter['>ID'])),[0,92049,92099]);
  const catalogTrace=await page.evaluate(start=>window.timeRangeLoadTrace.slice(start),loadStarts);
  writeFileSync(new URL('./artifacts/time-functional-catalog-boundary.json',import.meta.url),JSON.stringify({boundary:windowCatalogBoundary,catalogTrace},null,2));
  assert.equal((await page.evaluate(()=>window.timeRangeLoadStarts))-loadStarts,0,'Project metadata publication must not launch an elapsed crawl from each catalog page: '+JSON.stringify({boundary:windowCatalogBoundary,catalogTrace}));
  assert.ok(await page.evaluate(()=>{const pref=JSON.parse(localStorage.getItem(`pena.timeProjects.v1.${location.host.toLowerCase()}~7`));return pref.all&&pref.includeUnassigned&&window.catalogProbeCalls.every(call=>call.select.includes('GROUP_ID')&&call.filter.GROUP_ID==null&&call.filter['>GROUP_ID']==null);}), 'Explicit all+unassigned catalog must return verifiable GROUP_ID without excluding projects');
  const deltaStartedAt=await page.evaluate(()=>Date.now());
  await page.evaluate(()=>window.timeProbe.projectCatalog({delta:true}));
  const deltaWatermark=await page.evaluate(()=>Date.parse(window.catalogProbeCalls.at(-1).filter['>=CHANGED_DATE']));
  assert.ok(deltaWatermark>deltaStartedAt-65000&&deltaWatermark<=deltaStartedAt,'Project delta did not use the completed request-start watermark');
  // This fixture invokes only the catalog half of the shared load owner.
  // Finish its elapsed half before interacting: replacing the working set
  // correctly keeps the panel inert until that new set has a complete snapshot.
  await page.evaluate(()=>window.timeProbe.load());
  await page.waitForFunction(()=>!document.querySelector('.pena-native-time-scroll')?.inert);
  await page.locator('.pena-native-time-tracker-search').fill('Каталог');
  await page.locator('#pena-time-tracker-task-option-92124').waitFor();
  assert.equal(await page.locator('#pena-time-tracker-task-option-92000').count(),0);
  // Isolate successor coalescing from the number of history pages in the preceding catalog.
  await page.evaluate(async()=>{window.catalogProbeRows=window.catalogProbeRows.slice(-1);await window.timeProbe.projectCatalog({force:true});await window.timeProbe.load();});
 });
 await phase('new eligible task coalesces one successor to a delayed elapsed read',async()=>{
  await page.evaluate(()=>{
   const original=window.BX24.callBatch;
   window.workingSetHeld=[]; window.workingSetReads=0;
   window.BX24.callBatch=function(calls,callback,...rest){
    const number=++window.workingSetReads;
    if(number===3) window.BX24.callBatch=original;
    return original.call(this,calls,result=>{
     if(number<=2) window.workingSetHeld.push(()=>callback(result));
     else callback(result);
    },...rest);
   };
   window.workingSetFirst=window.timeProbe.load();
  });
  await page.waitForFunction(()=>window.workingSetHeld.length===1);
  await page.evaluate(()=>{
   window.timeProbe.publish([{ID:'5',TITLE:'Новая задача рабочего набора',GROUP_ID:'1',ALLOW_TIME_TRACKING:'Y'}]);
   window.workingSetNext=Promise.all(Array.from({length:20},()=>window.timeProbe.loadAuto()));
   window.workingSetHeld[0]();
  });
  await page.waitForFunction(()=>window.workingSetHeld.length===2);
  await page.evaluate(()=>{
   window.timeProbe.publish([{ID:'6',TITLE:'Следующая задача рабочего набора',GROUP_ID:'1',ALLOW_TIME_TRACKING:'Y'}]);
   window.workingSetThird=Promise.all(Array.from({length:20},()=>window.timeProbe.loadAuto()));
   window.workingSetHeld[1]();
  });
  await page.evaluate(()=>window.workingSetNext);
  await page.evaluate(()=>window.workingSetThird);
  const tasks=(await page.evaluate(()=>window.timeProbe.cacheTasks())).split(',');
  assert.ok(tasks.includes('5') && tasks.includes('6'));
  assert.equal(await page.evaluate(()=>window.workingSetReads),3,'40 concurrent refreshes need only one read per new working set');
  // Restore the real fixture catalog so subsequent write tests have confirmed project membership.
  await page.evaluate(async()=>{window.BX.rest.callMethod=window.catalogProbeOriginal;await window.timeProbe.refresh();await window.timeProbe.load();});
  await page.waitForFunction(()=>!document.querySelector('.pena-native-time-scroll')?.inert);
 });
 await phase('obsolete search stops eligibility fan-out',async()=>{
  await page.evaluate(()=>{
   window.timeSearchOnlyEntries=Array.from({length:80},(_,i)=>({ID:String(93000+i),TITLE:'Проверка очереди '+i,GROUP_ID:'1'}));
   window.obsoleteGets=[];
   const original=window.BX.rest.callMethod;
   window.BX.rest.callMethod=function(method,params,cb){
    if(method==='tasks.task.get' && Number(params.taskId)>=93000 && Number(params.taskId)<93100){
     window.obsoleteGets.push(params.taskId);
     return setTimeout(()=>cb({error:()=>null,data:()=>({task:{id:params.taskId,title:'Проверка очереди',groupId:'1',allowTimeTracking:'Y'}})}),250);
    }
    return original.apply(this,arguments);
   };
  });
  await page.locator('.pena-native-time-manual-search').fill('Проверка очереди');
  await page.waitForFunction(()=>window.obsoleteGets.length>0);
  await page.locator('.pena-native-time-manual-search').fill('Без чата');
  await page.waitForTimeout(650);
  assert.ok(await page.evaluate(()=>window.obsoleteGets.length)<=2);
  assert.equal(await page.locator('.pena-native-time-manual-result').filter({hasText:'Проверка очереди'}).count(),0);
 });
 await phase('qualification rechecks cached Y and N when a task event is lost',async()=>{
  const disabled=await page.evaluate(async()=>{
   window.timeTaskEligibilityOverrides['404']='N';
   window.timeProbe.stage({taskId:'404',dialogId:'chat404'},{qualify:true,reason:'message'});
   await window.timeProbe.flush();
   return window.timeProbe.visits().find(row=>row.taskId==='404')?.visits||0;
  });
  assert.equal(disabled,0,'Cached Y counted a disabled task');
  const enabled=await page.evaluate(async()=>{
   window.timeTaskEligibilityOverrides['404']='Y';
   window.timeProbe.stage({taskId:'404',dialogId:'chat404'},{qualify:true,reason:'message'});
   await window.timeProbe.flush();
   return window.timeProbe.visits().find(row=>row.taskId==='404')?.visits||0;
  });
  assert.equal(enabled,1,'Cached N lost the newly enabled contact');
 });
 await phase('hidden and visible reading never allocate or qualify contact sessions',async()=>{
  await page.locator('.pena-native-time-header-actions > .pena-native-popover-close').click();
  const r=await page.evaluate(()=>{
   window.timeProbe.stage({taskId:'101',dialogId:'chat101'});
   const pending=window.timeProbe.pending('101');
   const entry={taskId:'101',active:true,startedAt:Date.now()-20000,qualify:false};
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
   document.dispatchEvent(new Event('visibilitychange'));
   const hiddenQualified=entry.qualify;
   entry.startedAt=Date.now()-100000;
   const whileHidden=window.timeProbe.qualify(entry);
   Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
   window.timeProbe.stage({taskId:'101',dialogId:'chat101'});
   const resumedQualified=window.timeProbe.qualify(entry);
   entry.startedAt=Date.now()-41000;
   const afterMinute=window.timeProbe.qualify(entry);
   return {hiddenQualified,whileHidden,resumedQualified,afterMinute,pending:!!pending,resumedPending:!!window.timeProbe.pending('101')};
  });
  assert.deepEqual(r,{hiddenQualified:false,whileHidden:false,resumedQualified:false,afterMinute:false,pending:false,resumedPending:false});
  await page.locator('.pena-native-time-button').click();
 });
 await phase('uncertain manual write survives form changes and reload without an automatic duplicate',async()=>{
  await page.evaluate(()=>{
   const original=window.BX.rest.callMethod;
   window.BX.rest.callMethod=function(method,params,callback){
    if(method==='task.elapseditem.add') { window.timeAddCalls.push(params); callback({error:()=>null,data:()=>true}); return; }
    return original.apply(this,arguments);
   };
   window.timeProbe.prepare({taskId:'101',title:'Задача 101'});
  });
  await page.locator('.pena-native-time-manual-hours').fill('0');
  await page.locator('.pena-native-time-manual-minutes').fill('10');
  await page.locator('.pena-native-time-manual-submit').click();
  await page.waitForFunction(()=>window.timeAddCalls.length===1 && document.querySelector('.pena-native-time-manual-submit').textContent==='Проверить запись');
  assert.equal(await page.evaluate(()=>window.timeAddCalls.length),1);
  await page.evaluate(()=>window.timeProbe.prepare({taskId:'102',title:'Задача 102'}));
  assert.equal(await page.evaluate(()=>window.timeProbe.draft().pendingWrite.taskId),'101');
  await page.reload();
  await page.locator('.pena-native-time-button').waitFor();await page.locator('.pena-native-time-button').click();
  await page.locator('.pena-native-time-manual-recovery').waitFor();
  assert.equal(await page.locator('.pena-native-time-manual-recovery button').count(),2);
  assert.equal(await page.locator('.pena-native-time-manual-submit').textContent(),'Проверить запись');
  await page.locator('.pena-native-time-manual-submit').click();
  assert.equal(await page.evaluate(()=>window.timeAddCalls.length),0);
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-manual-submit').textContent==='Записи нет — повторить');
  await page.locator('.pena-native-time-manual-submit').click();
  await page.waitForFunction(()=>!window.timeProbe.draft().pendingWrite);
  assert.equal(await page.evaluate(()=>window.timeAddCalls.length),1);
  assert.equal(await page.evaluate(()=>String(window.timeAddCalls[0].TASKID)),'101');
  assert.equal(await page.evaluate(()=>window.timeAddCalls[0].ARFIELDS.SECONDS),600);
 });
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'tests/artifacts/time-panel-current.png'});
} finally {
 mkdirSync('tests/artifacts',{recursive:true});
 const network=await page.evaluate(()=>window.__PENA_REST_DIAGNOSTICS__?.snapshot()).catch(()=>null);
 writeFileSync('tests/artifacts/time-functional-report.json',JSON.stringify({phases,errors,network},null,2));
 console.log(JSON.stringify({phases,errors,network},null,2));
 await browser.close();await server.close();
}

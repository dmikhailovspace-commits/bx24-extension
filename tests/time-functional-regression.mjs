import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const server = await startHarnessServer(), browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1000,height:800}});
const errors = collectPageErrors(page), phases=[];
const phase = async (name, fn) => { const at=Date.now(); try { await fn(); phases.push({name,status:'PASS',ms:Date.now()-at}); } catch(e) { phases.push({name,status:'FAIL',ms:Date.now()-at,error:e.message}); throw e; } };
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8').replace(
 '\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;',
 `\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;
 window.timeProbe = {
 stage: (...args) => _stageDialogTimeActivity(...args),
 qualify: (...args) => _qualifyPendingDialogTimeDuration(...args),
 pending: id => _dialogTimePendingActivities.get('task:'+id),
 refresh: (force = true) => _refreshDialogTimeTaskCatalog({force}),
 eligibility: id => _getFreshDialogTimeTaskEligibility(id),
 flush: () => _flushDialogTimePendingActivities(),
 visits: () => _readDialogTimeVisits(),
 load: () => _loadDialogTimeRange(_getDialogTimeSelectedRange(), {force:true})
 };`);
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
      return [key,{error:()=>null,data:()=>data,total:()=>value.total?.(),next:()=>value.next?.()}];
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
  assert.equal(result.top,true);assert.equal(result.hit,true);assert.equal(result.width,720);
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
    if(method==='tasks.task.get' && String(params.taskId)==='90901')return cb({error:()=>null,data:()=>({task:{id:'90901',title:'Без чата уникальная',allowTimeTracking:window.timeTaskEligibilityOverrides['90901']||'Y'}})});
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
 await phase('all catalog pages and incremental watermark',async()=>{
  await page.evaluate(()=>{
   window.catalogProbeCalls=[];
   const original=window.BX.rest.callMethod;
   const rows=Array.from({length:125},(_,i)=>({ID:String(92000+i),TITLE:'Каталог '+i,ALLOW_TIME_TRACKING:i===124?'Y':'N'}));
   window.BX.rest.callMethod=function(method,params,cb){
    if(method==='tasks.task.list' && params.order?.ID==='asc'){
     window.catalogProbeCalls.push(params);
     const start=params.start||0, delta=!!params.filter?.['>=CHANGED_DATE'];
     const data=delta?[]:rows.slice(start,start+50);
     return cb({error:()=>null,data:()=>({tasks:data}),next:()=>null});
    }
    return original.apply(this,arguments);
   };
  });
  await page.evaluate(()=>window.timeProbe.refresh());
  await page.waitForFunction(()=>[...document.querySelectorAll('.pena-native-time-task-select option')].some(o=>o.value==='92124'));
  assert.deepEqual(await page.evaluate(()=>window.catalogProbeCalls.map(c=>c.start)),[0,50,100]);
  await page.evaluate(()=>window.timeProbe.refresh(false));
  assert.ok(await page.evaluate(()=>window.catalogProbeCalls.at(-1).filter['>=CHANGED_DATE']));
  assert.equal(await page.locator('.pena-native-time-task-select option[value="92000"]').count(),0);
 });
 await phase('obsolete search stops eligibility fan-out',async()=>{
  await page.evaluate(()=>{
   window.timeSearchOnlyEntries=Array.from({length:80},(_,i)=>({ID:String(93000+i),TITLE:'Проверка очереди '+i}));
   window.obsoleteGets=[];
   const original=window.BX.rest.callMethod;
   window.BX.rest.callMethod=function(method,params,cb){
    if(method==='tasks.task.get' && Number(params.taskId)>=93000 && Number(params.taskId)<93100){
     window.obsoleteGets.push(params.taskId);
     return setTimeout(()=>cb({error:()=>null,data:()=>({task:{id:params.taskId,title:'Проверка очереди',allowTimeTracking:'Y'}})}),250);
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
 await phase('hidden time is excluded from contact qualification',async()=>{
  const r=await page.evaluate(()=>{
   window.timeProbe.stage({taskId:'101',dialogId:'chat101'});
   const entry=window.timeProbe.pending('101');entry.durationQualified=false;entry.qualify=false;entry.startedAt=Date.now()-20000;
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
   return {hiddenQualified,whileHidden,resumedQualified,afterMinute,visibleMs:entry.visibleMs};
  });
  assert.equal(r.hiddenQualified,false);assert.equal(r.whileHidden,false);assert.equal(r.resumedQualified,false);assert.equal(r.afterMinute,true);
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

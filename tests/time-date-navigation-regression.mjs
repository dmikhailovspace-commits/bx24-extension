import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';

const raw=readFileSync(resolve(process.env.PENA_EXTENSION_DIR||'extension','injected.js'),'utf8');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
assert.equal(raw.split(anchor).length,2);
const source=raw.replace(anchor,anchor+`
 window.dateProbe={
  range:()=>['stats','stats30'].includes(_dialogTimeView)?_getDialogTimeStatsRange():_getDialogTimeSelectedRange(),
  record:()=>_getDialogTimeRecord(window.dateProbe.range()),
  selected:()=>_getDialogTimeSelectedRange(),
  view:()=>_dialogTimeView,
  idle:()=>!_dialogTimeInFlight.size&&!_dialogTimeProjectCatalogOwner&&!_dialogTimeBootstrapPromise,
  readKeys:()=>Array.from(_dialogTimeInFlight.keys()),
  select:range=>_setDialogTimeRange(range),
  warm:()=>_loadDialogTimeRange(window.dateProbe.range()),
  legacy(){_callDialogTimeGlobalElapsedPage.capabilities ||= new Map();_callDialogTimeGlobalElapsedPage.capabilities.set(_getDialogTimeIdentityScopeKey(),{supported:false,reason:'controlled-legacy-portal'});},
  taskCount:()=>_getDialogTimeWorkingTaskIds(window.dateProbe.range()).length,
  clear(){_dialogTimeCache.clear();},
  pressure(){
   for(let i=0;i<12;i++){const day=_PENA_TIME_CONTROL.addDays(_getDialogTimeTodayKey(),-100-i);const range={from:day,to:day};_setDialogTimeCacheRecord(_getDialogTimeCacheKey(range),{range,status:'ready'});}
   return{size:_dialogTimeCache.size,selected:_dialogTimeCache.has(_getDialogTimeCacheKey(window.dateProbe.range())),today:_dialogTimeCache.has(_getDialogTimeCacheKey(_getDialogTimeRange('today')))};
  },
  sync:()=>_syncDialogTimeUi(_dialogControlNativeSwitcherNode)
 };`);
const report={sourceSha:createHash('sha256').update(raw).digest('hex'),phases:[],limitations:'Actual Chromium date controls, production journal readers and REST queue; controlled Bitrix SDK responses, not a live portal.'};
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=collectPageErrors(page);
page.setDefaultTimeout(15000);
const phase=async(name,run)=>{const at=performance.now();try{const evidence=await run();report.phases.push({name,status:'PASS',ms:performance.now()-at,evidence});}catch(error){report.phases.push({name,status:'FAIL',ms:performance.now()-at,error:error.stack});throw error;}};
const ready=(timeout=15000)=>page.waitForFunction(()=>dateProbe.record()?.hasCompleteSnapshot===true&&dateProbe.record()?.status==='ready'&&
 !document.querySelector('.pena-native-time-panel')?.classList.contains('--read-blocked')&&
 document.querySelector('.pena-native-time-view-tab.--active')?.dataset.view===dateProbe.view(),undefined,{timeout});
const seconds=()=>page.evaluate(()=>dateProbe.record()?.data?.totalSeconds);
try {
 await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');
 await page.locator('.pena-native-time-button').waitFor();
 await page.evaluate(()=>{
  const model=window.__PENA_TIME_CONTROL__,today=window.timePortalDateKey();
  const state=window.dateBackend={today,calls:[],held:[],holdDay:'',partialDay:'',failDay:'',legacy:false};
  state.rows=Array.from({length:7},(_,i)=>({ID:String(8000+i),TASK_ID:'101',USER_ID:'7',SECONDS:String((i+1)*600),CREATED_DATE:model.addDays(today,-i)+'T12:00:00+03:00'}));
  state.rows.push({ID:'9000',TASK_ID:'405',USER_ID:'7',SECONDS:'1800',CREATED_DATE:model.addDays(today,-1)+'T13:00:00+03:00'});
  const result=params=>{
   const [taskId,order,filter,,nav]=params;
   if(state.failDay&&String(filter['>=CREATED_DATE']||'').startsWith(state.failDay))return{error:()=> 'TIMEOUT',error_description:()=> 'Controlled journal timeout'};
   if(state.legacy&&Number(taskId)===0)return{error:()=> 'TASK_NOT_FOUND',error_description:()=> 'controlled unsupported sentinel'};
   let rows=state.rows.filter(row=>(!taskId||String(taskId)===row.TASK_ID)&&String(filter.USER_ID)===row.USER_ID&&
    (filter.ID==null||String(filter.ID)===row.ID)&&(filter['>ID']==null||Number(row.ID)>Number(filter['>ID']))&&
    (!filter['>=CREATED_DATE']||row.CREATED_DATE>=filter['>=CREATED_DATE'])&&(!filter['<CREATED_DATE']||row.CREATED_DATE<filter['<CREATED_DATE']));
   rows.sort((a,b)=>(Number(a.ID)-Number(b.ID))*(String(order.ID).toUpperCase()==='DESC'?-1:1));
   const total=rows.length,size=nav.NAV_PARAMS.nPageSize,start=(nav.NAV_PARAMS.iNumPage-1)*size;
   rows=rows.slice(start,start+size);return{error:()=>null,data:()=>rows,total:()=>total,answer:{}};
  };
  const note=params=>state.calls.push({taskId:String(params[0]),from:String(params[2]['>=CREATED_DATE']||'').slice(0,10),to:String(params[2]['<CREATED_DATE']||'').slice(0,10)});
  const held=params=>{
   const day=String(params[2]['>=CREATED_DATE']||'').slice(0,10);
   return (state.holdDay&&day===state.holdDay)||(state.partialDay&&day===state.partialDay&&state.calls.filter(call=>call.from===day).length>16);
  };
  const method=BX.rest.callMethod;
  BX.rest.callMethod=function(name,params,callback){
   if(name!=='task.elapseditem.getlist')return method.call(this,name,params,callback);
   note(params);const deliver=()=>callback(result(params));
   if(held(params))state.held.push(deliver);else queueMicrotask(deliver);
  };
  const batch=BX24.callBatch;
  BX24.callBatch=function(calls,callback){
   const entries=Object.entries(calls);
   if(!entries.every(([,call])=>call.method==='task.elapseditem.getlist'))return batch.call(this,calls,callback);
   for(const[,call]of entries)note(call.params);
   const deliver=()=>callback(Object.fromEntries(entries.map(([key,call])=>[key,result(call.params)])));
   if(entries.some(([,call])=>held(call.params)))state.held.push(deliver);else queueMicrotask(deliver);
  };
  state.release=()=>{state.holdDay='';state.partialDay='';for(const deliver of state.held.splice(0))deliver();};
 });
 await page.locator('.pena-native-time-button').click();
 await ready();
 await page.waitForFunction(()=>dateProbe.idle());
 await phase('cold previous date and next date load distinct journals; disabled tracking does not hide historical time',async()=>{
  await page.locator('.pena-native-time-date-prev').click();await ready();
  assert.equal(await seconds(),3000);
  const prior=await page.evaluate(()=>({range:dateProbe.range(),calls:dateBackend.calls.slice(),tasks:dateProbe.record().data.tasks.map(task=>task.taskId)}));
  assert.ok(prior.tasks.includes('405'),'A task with ALLOW_TIME_TRACKING=N must keep its recorded historical time');
  assert.ok(prior.calls.some(call=>call.from===prior.range.from));
  await page.locator('.pena-native-time-date-next').click();await ready();assert.equal(await seconds(),600);
  return prior;
 });
 await phase('calendar change loads requested date and warm return uses no new journal requests',async()=>{
  const day=await page.evaluate(()=>__PENA_TIME_CONTROL__.addDays(dateBackend.today,-2));
  await page.locator('.pena-native-time-date-input').fill(day);await page.locator('.pena-native-time-date-input').dispatchEvent('change');await ready();assert.equal(await seconds(),1800);
  const before=await page.evaluate(()=>dateBackend.calls.length);
  await page.locator('.pena-native-time-date-next').click();await ready();assert.equal(await seconds(),3000);
  await page.locator('.pena-native-time-date-prev').click();await ready();assert.equal(await seconds(),1800);
  assert.equal(await page.evaluate(()=>dateBackend.calls.length),before);
  return{day,journalCalls:before,warmAdditionalCalls:0};
 });
 await phase('seven-day tab and row navigation retain exact day totals',async()=>{
  await page.locator('.pena-native-time-date-today').click();await ready();
  await page.locator('.pena-native-time-view-tab[data-view="stats"]').click();await ready();assert.equal(await seconds(),18600);
  await page.locator('.pena-native-time-stats-row').nth(1).click();await ready();assert.equal(await seconds(),3000);
  return{weekSeconds:18600,selectedDaySeconds:3000};
 });
 await phase('30-day view includes both boundary days, excludes the preceding day, and keeps a warm cache',async()=>{
  await page.evaluate(()=>{
   dateBackend.rows.push({ID:'9100',TASK_ID:'101',USER_ID:'7',SECONDS:'2400',CREATED_DATE:__PENA_TIME_CONTROL__.addDays(dateBackend.today,-29)+'T12:00:00+03:00'});
   dateBackend.rows.push({ID:'9101',TASK_ID:'101',USER_ID:'7',SECONDS:'9900',CREATED_DATE:__PENA_TIME_CONTROL__.addDays(dateBackend.today,-30)+'T12:00:00+03:00'});
  });
  await page.locator('.pena-native-time-date-today').click();await ready();
  await page.locator('.pena-native-time-view-tab[data-view="stats30"]').click();await ready();assert.equal(await seconds(),21000);
  await page.waitForFunction(()=>document.querySelectorAll('.pena-native-time-stats-row').length===30);assert.equal(await page.locator('.pena-native-time-stats-row').count(),30);
  assert.equal(await page.locator('.pena-native-time-stats .pena-native-time-section-copy strong').textContent(),'Статистика за 30 дней');
  assert.equal(await page.locator('.pena-native-time-refresh').getAttribute('aria-label'),'Обновить статистику за 30 дней');
  const evidence=await page.evaluate(()=>({range:dateProbe.range(),today:dateBackend.today,firstDay:__PENA_TIME_CONTROL__.addDays(dateBackend.today,-29),calls:dateBackend.calls.length}));
  assert.equal(evidence.range.from,evidence.firstDay);assert.equal(evidence.range.to,evidence.today);
  await page.locator('.pena-native-time-view-tab[data-view="stats"]').click();await ready();assert.equal(await seconds(),18600);
  await page.locator('.pena-native-time-view-tab[data-view="stats30"]').click();await ready();assert.equal(await seconds(),21000);
  assert.equal(await page.evaluate(()=>dateBackend.calls.length),evidence.calls);
  const pressure=await page.evaluate(()=>dateProbe.pressure());assert.equal(pressure.size,8);assert.equal(pressure.selected,true);assert.equal(pressure.today,true);
  await page.setViewportSize({width:360,height:800});
  const layout=await page.evaluate(()=>{
   const panel=document.querySelector('.pena-native-time-panel');const buttons=Array.from(panel.querySelectorAll('.pena-native-time-panel-head button'));const box=panel.getBoundingClientRect();
   return{panelFits:panel.scrollWidth<=panel.clientWidth+1,buttonsFit:buttons.every(button=>{const r=button.getBoundingClientRect();return r.left>=box.left&&r.right<=box.right+1;}),headerDoesNotOverlap:panel.querySelector('.pena-native-time-scroll').getBoundingClientRect().top>=panel.querySelector('.pena-native-time-panel-head').getBoundingClientRect().bottom-1,tabs:Array.from(panel.querySelectorAll('.pena-native-time-view-tab')).map(tab=>tab.textContent)};
  });
  assert.equal(layout.panelFits,true);assert.equal(layout.buttonsFit,true);assert.equal(layout.headerDoesNotOverlap,true);assert.deepEqual(layout.tabs,['День','7 дней','30 дней']);
  await page.screenshot({path:'tests/artifacts/time-30-days-360.png'});await page.setViewportSize({width:1200,height:900});
  await page.locator('.pena-native-time-stats-row').last().click();await ready();assert.equal(await seconds(),2400);
  assert.equal(await page.evaluate(()=>dateProbe.selected().from),evidence.firstDay);
  assert.equal(await page.locator('.pena-native-time-view-tab[data-view="day"]').getAttribute('aria-selected'),'true');
  await page.evaluate(()=>{dateBackend.rows=dateBackend.rows.filter(row=>!['9100','9101'].includes(row.ID));});
  return{...evidence,pressure,layout,totalSeconds:21000,lastDaySeconds:2400,warmAdditionalCalls:0};
 });
 await phase('30-day calendar navigation crosses leap February and year boundaries without changing its length',async()=>{
  const ranges=[];
  for(const [to,from] of [['2024-03-01','2024-02-01'],['2025-01-10','2024-12-12']]){
   await page.locator('.pena-native-time-date-input').fill(to);await page.locator('.pena-native-time-date-input').dispatchEvent('change');await ready();
   await page.locator('.pena-native-time-view-tab[data-view="stats30"]').click();await ready();
   const range=await page.evaluate(()=>dateProbe.range());assert.equal(range.from,from);assert.equal(range.to,to);await page.waitForFunction(()=>document.querySelectorAll('.pena-native-time-stats-row').length===30);assert.equal(await page.locator('.pena-native-time-stats-row').count(),30);
   ranges.push(range);
  }
  const callsBefore=await page.evaluate(()=>dateBackend.calls.length);
  await page.locator('.pena-native-time-refresh').click();await ready();await page.waitForFunction(()=>document.querySelector('.pena-native-time-refresh')?.getAttribute('aria-busy')==='false');
  const refreshCalls=await page.evaluate(before=>dateBackend.calls.slice(before),callsBefore);
  assert.ok(refreshCalls.length>0);assert.ok(refreshCalls.every(call=>call.from==='2024-12-12'&&call.to==='2025-01-11'));
  await page.locator('.pena-native-time-view-tab[data-view="day"]').click();await ready();
  return{ranges,refreshCalls};
 });
 await phase('no-time day is a verified zero, with a completed range record',async()=>{
  const day=await page.evaluate(()=>__PENA_TIME_CONTROL__.addDays(dateBackend.today,-8));
  await page.locator('.pena-native-time-date-input').fill(day);await page.locator('.pena-native-time-date-input').dispatchEvent('change');await ready();assert.equal(await seconds(),0);
  return await page.evaluate(()=>({range:dateProbe.range(),coverage:dateProbe.record().data.coverage}));
 });
 await phase('rapid navigation cancels unseen legacy tail and prioritizes the newest date',async()=>{
  const oldDay=await page.evaluate(()=>{
   dateProbe.legacy();dateBackend.legacy=true;
   const day=__PENA_TIME_CONTROL__.addDays(dateBackend.today,-10);dateBackend.holdDay=day;
   dateProbe.select({from:day,to:day});return day;
  });
  await page.waitForFunction(()=>dateBackend.held.length>0);
  const nextDay=await page.evaluate(()=>{
   const day=__PENA_TIME_CONTROL__.addDays(dateBackend.today,-11);dateProbe.select({from:day,to:day});return day;
  });
  await page.evaluate(()=>dateBackend.release());await ready();
  await page.waitForFunction(()=>dateProbe.idle());
  const evidence=await page.evaluate(({oldDay,nextDay})=>({oldDay,nextDay,oldCalls:dateBackend.calls.filter(call=>call.from===oldDay).length,newCalls:dateBackend.calls.filter(call=>call.from===nextDay).length,workingTasks:dateProbe.taskCount(),selected:dateProbe.selected()}),{oldDay,nextDay});
  assert.equal(evidence.selected.from,nextDay);assert.ok(evidence.oldCalls<=16,`Obsolete date still queried ${evidence.oldCalls} tasks instead of stopping after its first 16`);
  assert.equal(evidence.newCalls,evidence.workingTasks);return evidence;
 });
 await phase('partial today is masked until all tasks finish; loading and ready layouts fit desktop and narrow windows',async()=>{
  await page.evaluate(()=>{
   dateProbe.clear();dateBackend.calls=[];dateBackend.partialDay=dateBackend.today;
   dateProbe.select({from:dateBackend.today,to:dateBackend.today});
  });
  await page.waitForFunction(()=>dateBackend.held.length>0&&dateProbe.record()?.data?.totalSeconds===600&&dateProbe.record()?.status==='loading');
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-panel')?.classList.contains('--read-blocked'));
  const layouts=[];
  for(const width of [1000,360]){
   await page.setViewportSize({width,height:800});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const snapshot=await page.evaluate(()=>{
    const panel=document.querySelector('.pena-native-time-panel'),overlay=panel.querySelector('.pena-native-time-loading-overlay');
    const box=overlay.getBoundingClientRect();
    return{width:innerWidth,total:panel.querySelector('.pena-native-time-total-value').textContent,today:document.querySelector('.pena-native-time-button-label').textContent,
     overlayVisible:!overlay.hidden,headInert:panel.querySelector('.pena-native-time-panel-head').inert,scrollInert:panel.querySelector('.pena-native-time-scroll').inert,
     blur:getComputedStyle(panel.querySelector('.pena-native-time-scroll')).filter,left:box.left,right:box.right,scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth};
   });
   assert.equal(snapshot.overlayVisible,true);assert.equal(snapshot.headInert,true);assert.equal(snapshot.scrollInert,true);assert.match(snapshot.blur,/blur/);
   assert.equal(snapshot.total,'—');assert.doesNotMatch(snapshot.today,/10\s*мин|10\s*м/);
   assert.ok(snapshot.left>=0&&snapshot.right<=width+1);assert.ok(snapshot.scrollWidth<=snapshot.clientWidth+1);
   await page.screenshot({path:`tests/artifacts/time-date-loading-${width}.png`});layouts.push(snapshot);
  }
  await page.evaluate(()=>dateBackend.release());await ready();
  await page.waitForFunction(()=>!document.querySelector('.pena-native-time-panel')?.classList.contains('--read-blocked'));
  assert.equal(await seconds(),600);
  for(const width of [1000,360]){await page.setViewportSize({width,height:800});await page.screenshot({path:`tests/artifacts/time-date-ready-${width}.png`});}
  await page.setViewportSize({width:1000,height:800});return layouts;
 });
 await phase('cold timeout offers an explicit exit without totals; real manual refresh recovers the exact date',async()=>{
  const day=await page.evaluate(()=>{
   const day=__PENA_TIME_CONTROL__.addDays(dateBackend.today,-13);dateBackend.failDay=day;dateProbe.select({from:day,to:day});return day;
  });
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-loading-retry')?.hidden===false&&dateProbe.record()?.status==='error');
  const error=await page.evaluate(()=>{
   const panel=document.querySelector('.pena-native-time-panel'),overlay=panel.querySelector('.pena-native-time-loading-overlay');
   return{busy:panel.getAttribute('aria-busy'),barHidden:overlay.querySelector('.pena-native-time-loading-bar').hidden,label:overlay.querySelector('.pena-native-time-loading-label').textContent};
  });
  assert.equal(error.busy,'false');assert.equal(error.barHidden,true);assert.match(error.label,/Не удалось/);
  await page.locator('.pena-native-time-loading-continue').click();
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-loading-overlay')?.hidden===true);
  const continued=await page.evaluate(()=>{
   const panel=document.querySelector('.pena-native-time-panel');
   return{total:panel.querySelector('.pena-native-time-total-value').textContent,headInert:panel.querySelector('.pena-native-time-panel-head').inert,scrollInert:panel.querySelector('.pena-native-time-scroll').inert,refreshDisabled:panel.querySelector('.pena-native-time-refresh').disabled};
  });
  assert.equal(continued.total,'—');assert.equal(continued.headInert,false);assert.equal(continued.scrollInert,false);assert.equal(continued.refreshDisabled,false);
  await page.locator('.pena-native-time-project-button').click();
  await page.locator('.pena-native-time-project-cancel').click();
  await page.evaluate(()=>{dateBackend.failDay='';});await page.locator('.pena-native-time-refresh').click();await ready(22000);
  assert.equal(await seconds(),0);assert.equal(await page.evaluate(()=>dateProbe.selected().from),day);return{error,continued};
 });
 await phase('loading close and Escape remain available; reopening a completed day never blocks',async()=>{
  await page.evaluate(()=>{const day=__PENA_TIME_CONTROL__.addDays(dateBackend.today,-14);dateBackend.holdDay=day;dateProbe.select({from:day,to:day});});
  await page.waitForFunction(()=>dateBackend.held.length>0&&!document.querySelector('.pena-native-time-loading-overlay')?.hidden);
  await page.locator('.pena-native-time-loading-close').click();
  assert.equal(await page.locator('.pena-native-time-panel').count(),0);
  await page.evaluate(()=>dateBackend.release());await page.waitForFunction(()=>dateProbe.idle());
  await page.locator('.pena-native-time-button').click();await ready();
  await page.evaluate(()=>{const day=__PENA_TIME_CONTROL__.addDays(dateBackend.today,-15);dateBackend.holdDay=day;dateProbe.select({from:day,to:day});});
  await page.waitForFunction(()=>dateBackend.held.length>0&&!document.querySelector('.pena-native-time-loading-overlay')?.hidden);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.pena-native-time-panel').count(),0);
  await page.evaluate(()=>dateBackend.release());await page.waitForFunction(()=>dateProbe.idle());
  await page.locator('.pena-native-time-button').click();await ready();
  const before=await page.evaluate(()=>dateBackend.calls.length);
  await page.locator('.pena-native-time-panel-head .pena-native-popover-close').click();
  await page.evaluate(()=>{
   window.dateWarmBlocked=false;window.dateWarmObserver=new MutationObserver(()=>{const overlay=document.querySelector('.pena-native-time-loading-overlay');if(overlay&&!overlay.hidden)window.dateWarmBlocked=true;});
   dateWarmObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});
  });
  await page.locator('.pena-native-time-button').click();await ready();
  const after=await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));dateWarmObserver.disconnect();return{blocked:dateWarmBlocked,calls:dateBackend.calls.length};});
  assert.equal(after.blocked,false);assert.equal(after.calls,before);return{warmAdditionalCalls:after.calls-before,warmOverlayShown:after.blocked};
 });
 await phase('saving a narrower project selection never lets its preview marker block a complete read',async()=>{
  await page.locator('.pena-native-time-date-today').click();await ready();
  await page.locator('.pena-native-time-project-button').click();
  await page.locator('.pena-native-time-project-settings input[data-project-id="0"]').uncheck();
  await page.locator('.pena-native-time-project-save').click();await ready();
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-loading-overlay')?.hidden===true);
  const evidence=await page.evaluate(()=>({scopeSelectionPending:dateProbe.record().scopeSelectionPending===true,coverage:dateProbe.record().data.coverage,blocked:document.querySelector('.pena-native-time-panel').classList.contains('--read-blocked')}));
  assert.equal(evidence.coverage.complete,true);assert.equal(evidence.blocked,false);return evidence;
 });
 assert.deepEqual(errors,[]);
}catch(error){report.error=error.stack;report.failure=await page.evaluate(()=>({record:window.dateProbe?.record(),readKeys:window.dateProbe?.readKeys(),queue:window.__PENA_REST_DIAGNOSTICS__?.snapshot(),calls:window.dateBackend?.calls,overlay:document.querySelector('.pena-native-time-loading-overlay')?.innerText})).catch(()=>null);process.exitCode=1;}
finally{
 report.pageErrors=errors;mkdirSync('tests/artifacts',{recursive:true});writeFileSync(`tests/artifacts/time-date-navigation-regression${process.env.PENA_DATE_LABEL?'-'+process.env.PENA_DATE_LABEL:''}.json`,JSON.stringify(report,null,2)+'\n');
 await browser.close();await server.close();
 console.log(JSON.stringify(report,null,2));
}

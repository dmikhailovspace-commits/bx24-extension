import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const server=await startHarnessServer(), browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1100,height:900}}), errors=collectPageErrors(page), phases=[];
const phase=async(name,fn)=>{await fn();phases.push({name,status:'PASS'});};
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8').replace(
 '\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;',
 `\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;
 window.actionProbe={parse:_getDialogTimeNativeTaskMutation,stage:_stageDialogTimeActivity,qualify:_qualifyPendingDialogTimeDuration,flush:_flushDialogTimePendingActivities,
 rows:_readDialogTimeVisits, title:_getDialogTimeTaskTitle, pending:()=>_dialogTimePendingActivities.size,
 clear:()=>_writeDialogTimeVisits(()=>[]), model:()=>_PENA_TIME_CONTROL, remembered:id=>_getDialogControlItemsForMode('tasks').find(x=>String(x.taskId || _dialogTimeTaskIdsByChatDialogId.get(normId(x.id)) || '')===id),
 emit:(result,config)=>(nativeCustomEventHandlers.get('onAjaxSuccess')||[]).forEach(fn=>fn(result,config)),
 pull:(id,title)=>(nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).forEach(fn=>fn('task_update',{TASK_ID:id,FIELDS_AFTER:{ID:id,TITLE:title}}))};`);
await page.route('**/tests/native-consistency-harness.html*',r=>{const html=readFileSync(new URL('./native-consistency-harness.html',import.meta.url),'utf8').replace('window.timeRestCalls = [];',"window.renameFixtureTask=(id,title)=>{let task=taskCatalogEntries.find(x=>String(x.ID)===id);if(!task){task={ID:id,CHAT_ID:id,ALLOW_TIME_TRACKING:'Y'};taskCatalogEntries.push(task);}task.TITLE=title;}; window.timeRestCalls = [];");return r.fulfill({status:200,contentType:'text/html',body:html});});
await page.route('**/extension/injected.js*',r=>r.fulfill({status:200,contentType:'application/javascript',body:source}));
try {
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');
 await page.waitForFunction(()=>window.actionProbe && (nativeCustomEventHandlers.get('onAjaxSuccess')||[]).length);
 await page.evaluate(()=>actionProbe.clear());
 await phase('observer failures cannot abort native response completion',async()=>{
  const r=await page.evaluate(()=>{
   let nativeCompleted=0;
   const configs=[{get data(){throw Error('native payload unavailable');}}, {url:'/bitrix/services/main/ajax.php?action=tasks.task.get',data:{taskId:'5'}}, null];
   for(const config of configs){actionProbe.emit({status:'success'},config);nativeCompleted++;}
   return nativeCompleted;
  });
  assert.equal(r,3);assert.equal(await page.evaluate(()=>actionProbe.pending()),0);
 });
 await phase('100 opened/read tasks and elapsed viewing never qualify',async()=>{
  const r=await page.evaluate(async()=>{for(let i=1;i<=100;i++)actionProbe.stage({taskId:String(i)});actionProbe.qualify({taskId:'101',active:true,startedAt:Date.now()-3600000});await actionProbe.flush();return{rows:actionProbe.rows(),pending:actionProbe.pending()};});
  assert.equal(r.rows.length,0);assert.equal(r.pending,0);
 });
 await phase('old duration contacts are excluded without changing recorded time or real message contacts',async()=>{
  const r=await page.evaluate(()=>{const m=actionProbe.model();const old={taskId:'101',visits:2,contactEvents:[{id:'read',at:100000,reason:'duration'},{id:'message',at:101000,reason:'message'}]};const selected=m.selectUntrackedVisits([old],[{taskId:'101',seconds:4500,entries:2}]);return{pending:selected[0].pendingContacts,seconds:selected[0].trackedSeconds,entries:selected[0].trackedEntries,original:old.visits,passive:m.selectUntrackedVisits([{taskId:'102',visits:1,lastQualifiedAt:100000,lastQualificationReason:'duration'}]).length};});
  assert.deepEqual(r,{pending:1,seconds:4500,entries:2,original:2,passive:0});
 });
 await phase('successful save/checklist/status accepted; errors, reads, time-only and foreign task responses rejected',async()=>{
  const r=await page.evaluate(()=>{const p=actionProbe.parse, ok={status:'success',data:{task:{id:'101',title:'Обновлённая задача'}}};const cfg=(action,data)=>({url:'/bitrix/services/main/ajax.php?action='+action,data});return{
   save:!!p(ok,cfg('tasks.task.update',{taskId:'101',fields:{TITLE:'Обновлённая задача'}})), checklist:!!p({status:'success'},cfg('tasks.task.checklist.update',{taskId:'101',fields:{IS_COMPLETE:'Y'}})),status:!!p({status:'success'},cfg('tasks.task.complete',{taskId:'101'})),
   rejected:[p({status:'error'},cfg('tasks.task.update',{taskId:'101',fields:{TITLE:'x'}})),p(ok,cfg('tasks.task.get',{taskId:'101'})),p(ok,cfg('tasks.task.update',{taskId:'101',fields:{TIME_SPENT_IN_LOGS:100}})),p(ok,cfg('tasks.task.update',{taskId:'102',fields:{TITLE:'wrong'}})),p({status:'success'},cfg('tasks.task.elapseditem.add',{taskId:'101'}))].filter(Boolean).length};});
  assert.deepEqual(r,{save:true,checklist:true,status:true,rejected:0});
 });
 await phase('actual native success subscription creates one contact and batches repeated rename events',async()=>{
  await page.evaluate(()=>{renameFixtureTask('5','Новое название 5');const cfg={url:'/bitrix/services/main/ajax.php?action=tasks.task.update',data:{taskId:'5',fields:{TITLE:'Новое название 5'}}};const result={status:'success',data:{task:{id:'5',title:'Новое название 5'}}};actionProbe.emit(result,cfg);actionProbe.emit(result,cfg);});
  await page.waitForFunction(()=>actionProbe.title('5')==='Новое название 5');
  await page.evaluate(()=>actionProbe.flush());
  assert.equal(await page.evaluate(()=>actionProbe.rows().find(x=>x.taskId==='5')?.visits),1);
  await page.getByText('Новое название 5',{exact:true}).first().waitFor({state:'visible',timeout:5000});
  const before=await page.evaluate(()=>({gets:timeRestCalls.filter(x=>x.method==='tasks.task.get').length,elapsed:timeRestCalls.filter(x=>x.method==='task.elapseditem.getlist').length}));
  await page.evaluate(()=>{renameFixtureTask('5','Переименована из Bitrix');for(let i=0;i<25;i++)actionProbe.pull('5','Переименована из Bitrix');});
  try { await page.waitForFunction(()=>actionProbe.remembered('5')?.title==='Переименована из Bitrix',null,{timeout:5000}); } catch(e) { throw Error(JSON.stringify(await page.evaluate(()=>({title:actionProbe.title('5'),item:actionProbe.remembered('5'),handlers:(nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).length}))),{cause:e}); }
  assert.equal(await page.evaluate(()=>actionProbe.rows().find(x=>x.taskId==='5')?.visits),1,'remote title updates are not personal work');
  await page.waitForTimeout(1350);
  assert.deepEqual(await page.evaluate(()=>({gets:timeRestCalls.filter(x=>x.method==='tasks.task.get').length,elapsed:timeRestCalls.filter(x=>x.method==='task.elapseditem.getlist').length})),before,'25 title updates must cause no task or elapsed reads');
 });
 await phase('V2 task entity saves count work, while V2 reads and time bookkeeping do not',async()=>{
  const r=await page.evaluate(()=>{
   const p=actionProbe.parse,cfg=(action,task)=>({action,data:{task}}),ok={status:'success',data:{id:'101',title:'V2 title'}};
   return {accepted:p(ok,cfg('tasks.v2.Task.update',{id:'101',title:'V2 title'}))?.taskId,
    encoded:p({status:'success'},{action:'tasks.v2.Task.update',data:'task%5Bid%5D=101&task%5Btitle%5D=V2+title'})?.taskId,
    rejected:[p(ok,cfg('tasks.v2.Task.get',{id:'101'})),p(ok,cfg('tasks.v2.Task.update',{id:'102',title:'wrong'})),p(ok,cfg('tasks.v2.Task.update',{id:'101',timeSpent:120})),p({status:'error'},cfg('tasks.v2.Task.update',{id:'101',title:'failed'}))].filter(Boolean).length};
  });
  assert.deepEqual(r,{accepted:'101',encoded:'101',rejected:0});
 });
 assert.deepEqual(errors,[]);
} finally {writeFileSync(new URL('./artifacts/time-work-actions-regression.json',import.meta.url),JSON.stringify({phases,errors,liveBitrix:false},null,2));await browser.close();await server.close();}
console.log('PASS work actions: reading excluded, durable contacts, native saves, task titles and bounded event handling');

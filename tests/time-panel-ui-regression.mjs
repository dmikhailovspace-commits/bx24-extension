import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';

const source = readFileSync(new URL('../extension/injected.js', import.meta.url), 'utf8');
mkdirSync('tests/artifacts',{recursive:true});
const anchor = '\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
assert.equal(source.split(anchor).length, 2);
const instrumented = source.replace(anchor, `${anchor}
 window.timeUiProbe = {
  record: () => _getDialogTimeRecord(_getDialogTimeSelectedRange()),
 idle: () => !_dialogTimeCatalogPromise && !_dialogTimeInFlight.size,
 holdPrepare(taskId='101') {
  window.timeUiHeldPrepareFrames=[];
  const request=window.requestAnimationFrame;
  window.requestAnimationFrame=callback=>{window.timeUiHeldPrepareFrames.push(callback);return -window.timeUiHeldPrepareFrames.length;};
  try { _prepareDialogTimeManualEntry({taskId,title:'Задача '+taskId}); }
  finally { window.requestAnimationFrame=request; }
 },
 releasePrepare() { for(const callback of window.timeUiHeldPrepareFrames.splice(0))callback(performance.now()); },
 selectManual(taskId) { _selectDialogTimeManualTask({taskId,title:'Задача '+taskId},_dialogControlNativeSwitcherNode.querySelector('.pena-native-time-panel')); },
  seedHistory(count, dateKey = _getDialogTimeSelectedRange().from) {
   const range=_PENA_TIME_CONTROL.normalizeRange(dateKey,dateKey),today=_getDialogTimeTodayKey();
   const base=dateKey===today?90000:80000;
   const items=Array.from({length:count},(_,i)=>({ID:String(base+i),TASK_ID:'101',USER_ID:'7',SECONDS:60,CREATED_DATE:dateKey+'T12:00:00+03:00'}));
   const data={..._PENA_TIME_CONTROL.aggregateElapsedItems(items),range,coverage:{checkedTasks:1,totalTasks:1,complete:true}};
   _setDialogTimeCacheRecord(_getDialogTimeCacheKey(range),{status:'ready',range,data,hasVerifiedData:true,hasCompleteSnapshot:true,error:'',updatedAt:Date.now(),taskFreshness:Object.fromEntries(_getDialogTimeWorkingTaskIds(range).map(id=>[id,{at:Date.now(),revision:_dialogTimeTaskRevisions.get(id)||0}]))});
   _dialogTimeView='day';_dialogTimeTrackedExpanded=true;_syncDialogTimeUi(_dialogControlNativeSwitcherNode);
   return dateKey;
  },
  prepareOtherHistory() { return this.seedHistory(120,_PENA_TIME_CONTROL.addDays(_getDialogTimeTodayKey(),-1)); },
  prependHistory() {
   const range=_getDialogTimeSelectedRange(),record=this.record();
   const data={..._PENA_TIME_CONTROL.aggregateElapsedItems([{ID:'99999',TASK_ID:'101',USER_ID:'7',SECONDS:60,CREATED_DATE:range.from+'T23:59:59+03:00'},...record.data.items]),range,coverage:record.data.coverage};
   this.state({data});
  },
  async contactSnapshot(checked) {
   _dialogTimeView='day';
   const range=_getDialogTimeSelectedRange(),now=Date.now();
   let rows=_PENA_TIME_CONTROL.applyQualifiedContact([],{taskId:'101',eventId:'older-contact',qualifiedAt:now-60000,reason:'message'});
   rows=_PENA_TIME_CONTROL.markActivityAccounted(rows,'task:101',now-40000,{itemId:'900001'});
   rows=_PENA_TIME_CONTROL.applyQualifiedContact(rows,{taskId:'101',eventId:'newer-contact',qualifiedAt:now-20000,reason:'message'});
   await _writeDialogTimeVisits(rows,range.from);_setDialogTimeTaskEligibility('101',true);
   this.state({status:'loading',range,data:{..._PENA_TIME_CONTROL.aggregateElapsedItems([]),range,coverage:{checkedTasks:16,totalTasks:117,complete:false}},hasVerifiedData:true,hasCompleteSnapshot:false,taskFreshness:checked?{'101':{at:now,revision:0}}:{},readProgress:{completedTasks:16,totalTasks:117}});
  },
  state(patch) {
   const range = _getDialogTimeSelectedRange();
   _setDialogTimeCacheRecord(_getDialogTimeCacheKey(range), {..._getDialogTimeRecord(range), ...patch});
   _syncDialogTimeUi(_dialogControlNativeSwitcherNode);
  },
  emptyState(hasVerifiedData, status, view='day') {
   _dialogTimeView=view;
   const range=view==='stats'?_getDialogTimeStatsRange():_getDialogTimeSelectedRange();
   _setDialogTimeCacheRecord(_getDialogTimeCacheKey(range), {
    status, range, data:{..._PENA_TIME_CONTROL.aggregateElapsedItems([]), range, coverage:{checkedTasks:hasVerifiedData?30:0,totalTasks:30,complete:hasVerifiedData}}, hasVerifiedData, hasCompleteSnapshot:hasVerifiedData,
    readProgress:{completedTasks:hasVerifiedData?30:0,totalTasks:30},
    error:status==='error'?'Сеть недоступна':'',updatedAt:hasVerifiedData?Date.now():0
   });
   _syncDialogTimeUi(_dialogControlNativeSwitcherNode);
  },
  holdManual() {
   window.manualReadCalls = 0;
   _refreshDialogTimePanel = () => {
    window.manualReadCalls++;
    return new Promise((resolve,reject) => { window.resolveManual = () => resolve(this.record().data); window.rejectManual = () => reject(new Error('Сеть недоступна')); });
   };
  },
  sending(status) {
   const original = _readDialogTimeManualDraft;
   const draft = original();
   _readDialogTimeManualDraft = () => ({...draft,pendingWrite:{taskId:'101',dateKey:_getDialogTimeSelectedRange().from,seconds:60,attemptedAt:1,status}});
   _dialogTimeActionInFlight = status === 'sending';
   try { _syncDialogTimeUi(_dialogControlNativeSwitcherNode); }
   finally { _readDialogTimeManualDraft=original; _dialogTimeActionInFlight=false; }
  }
 };`);
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = collectPageErrors(page), phases = [];
const phase = async (name, run) => {
 const startedAt = Date.now();
 try { const detail = await run(); phases.push({name,status:'PASS',ms:Date.now()-startedAt,detail}); }
 catch (error) { phases.push({name,status:'FAIL',ms:Date.now()-startedAt,error:error.message}); throw error; }
};
const snapshot = () => page.evaluate(() => {
 const panel = document.querySelector('.pena-native-time-panel');
 const refresh = panel.querySelector('.pena-native-time-refresh');
 const status = panel.querySelector('.pena-native-time-read-status');
 const body = panel.querySelector('.pena-native-time-body').getBoundingClientRect();
 const icon = refresh.querySelector('svg');
 const iconBox = icon.getBoundingClientRect(), buttonBox = refresh.getBoundingClientRect();
 return {
  total: panel.querySelector('.pena-native-time-total-value').textContent,
  compactTotal: document.querySelector('.pena-native-time-button-label').textContent,
  historyTotal: panel.querySelector('.pena-native-time-tracked-total').textContent,
  historyLabel: panel.querySelector('.pena-native-time-tracked-label').textContent,
  entries: panel.querySelectorAll('.pena-native-time-entry-row').length,
  disabled: refresh.disabled, animation: getComputedStyle(icon).animationName,
  clockAnimation: getComputedStyle(document.querySelector('.pena-native-time-button > svg')).animationName,
  statusPresent: !!status, meta:panel.querySelector('.pena-native-time-meta').textContent, metaTitle:panel.querySelector('.pena-native-time-meta').title, refreshTitle:refresh.title, busy:refresh.getAttribute('aria-busy'),
  bodyTop: body.top, iconCenterX: iconBox.x+iconBox.width/2-buttonBox.x-buttonBox.width/2,
  iconCenterY: iconBox.y+iconBox.height/2-buttonBox.y-buttonBox.height/2,
  rotation: icon.querySelectorAll('path')[1]?.getAttribute('transform')
 };
});
try {
 await page.route('**/extension/injected.js*', route => route.fulfill({status:200,contentType:'application/javascript',body:instrumented}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');
 await page.locator('.pena-native-time-button').click();
 await page.waitForFunction(() => document.querySelector('.pena-native-time-total-value')?.textContent === '1 ч 30 мин');
 await page.waitForFunction(() => timeUiProbe.idle() && timeUiProbe.record()?.hasCompleteSnapshot === true);
 await phase('queued manual autofocus preserves explicit minutes input and ordinary default still focuses hours',async()=>{
  const hours=page.locator('.pena-native-time-manual-hours'),minutes=page.locator('.pena-native-time-manual-minutes');
  await page.evaluate(()=>{document.activeElement?.blur();timeUiProbe.holdPrepare();});
  await minutes.focus();await page.keyboard.type('10');
  await page.evaluate(()=>timeUiProbe.releasePrepare());await page.keyboard.type('1');
  const preserved=await page.evaluate(()=>({hours:document.querySelector('.pena-native-time-manual-hours').value,minutes:document.querySelector('.pena-native-time-manual-minutes').value,active:document.activeElement?.className}));
  assert.equal(preserved.hours,'');assert.equal(preserved.minutes,'101');assert.match(preserved.active,/manual-minutes/);
  await page.evaluate(()=>{document.activeElement?.blur();timeUiProbe.holdPrepare();timeUiProbe.releasePrepare();});
  assert.equal(await hours.evaluate(node=>document.activeElement===node),true,'Default prepare must focus hours when the user has not changed focus');
  return preserved;
 });
 await phase('queued manual autofocus cancels on another control, replaced task, closed or detached panel',async()=>{
  const outcomes=[];
  for(const mode of ['control','task','closed','detached','replaced']){
   await page.evaluate(mode=>{
    document.activeElement?.blur();timeUiProbe.holdPrepare();
    const panel=document.querySelector('.pena-native-time-panel'),hours=panel.querySelector('.pena-native-time-manual-hours');
    let focusCalls=0;const focus=hours.focus;hours.focus=function(...args){focusCalls++;return focus.apply(this,args);};
    let replacement;
    if(mode==='control')panel.querySelector('.pena-native-time-refresh').focus();
    if(mode==='task')timeUiProbe.selectManual('102');
    if(mode==='closed')panel.querySelector('.pena-native-popover-close').click();
    if(mode==='detached'){window.timeUiDetachedParent=panel.parentNode;panel.remove();}
    if(mode==='replaced'){replacement=panel.cloneNode(true);panel.replaceWith(replacement);}
    timeUiProbe.releasePrepare();
    window.timeUiFocusOutcome={mode,focusCalls,active:document.activeElement?.className};
    hours.focus=focus;
    if(mode==='closed')document.querySelector('.pena-native-time-button').click();
    if(mode==='detached')window.timeUiDetachedParent.append(panel);
    if(mode==='replaced')replacement.replaceWith(panel);
   },mode);
   const result=await page.evaluate(()=>window.timeUiFocusOutcome);assert.equal(result.focusCalls,0,mode);outcomes.push(result);
  }
  return outcomes;
 });
 await page.evaluate(() => { window.timeUiOriginalData=timeUiProbe.record().data; timeUiProbe.state({status:'ready',error:'',updatedAt:Date.now()}); });
 const ready = await snapshot();
 await phase('unverified bootstrap aggregate is unknown in every view, confirmed zero stays visible', async () => {
  await page.evaluate(() => timeUiProbe.emptyState(false,'loading'));
  const cold = await snapshot();
  assert.equal(cold.total,'—','an empty bootstrap aggregate is not a checked zero');
  assert.equal(cold.compactTotal,'Сегодня …');
  assert.equal(cold.historyTotal,'—'); assert.equal(cold.historyLabel,'Записи · …');
  assert.equal(cold.statusPresent,false); assert.match(cold.meta,/Загружаем время/);
  await page.evaluate(() => timeUiProbe.emptyState(false,'loading','stats'));
  const unknownDays = await page.locator('.pena-native-time-stats-duration').allTextContents();
  assert.equal(unknownDays.length,7); assert.ok(unknownDays.every(value=>value==='—'),'unverified stats days must not fabricate zeroes');
  await page.evaluate(() => timeUiProbe.emptyState(true,'ready'));
  const zero = await snapshot(); assert.equal(zero.total,'0 мин'); assert.equal(zero.historyLabel,'Записи · 0'); assert.match(zero.compactTotal,/Сегодня 0:00/); assert.equal(zero.statusPresent,false);
  await page.evaluate(() => timeUiProbe.emptyState(true,'loading'));
  const warm = await snapshot(); assert.equal(warm.total,'0 мин'); assert.equal(warm.compactTotal,zero.compactTotal); assert.equal(warm.statusPresent,false);
  await page.evaluate(() => timeUiProbe.emptyState(true,'error'));
  const failed = await snapshot(); assert.equal(failed.total,'0 мин'); assert.equal(failed.statusPresent,false); assert.doesNotMatch(failed.meta,/Не удалось/); assert.match(failed.metaTitle,/сохранённое время/);
  await page.evaluate(() => timeUiProbe.state({status:'ready',data:window.timeUiOriginalData,hasVerifiedData:true,hasCompleteSnapshot:true,error:'',updatedAt:Date.now()}));
  return {cold,unknownDays,zero,warm,failed};
 });
 await phase('background validation preserves known figures and keeps both icons static', async () => {
  await page.evaluate(() => timeUiProbe.state({status:'loading',readProgress:{completedTasks:7,totalTasks:20}}));
  const state = await snapshot();
  assert.equal(state.total,ready.total); assert.equal(state.entries,ready.entries);
  assert.equal(state.disabled,false); assert.equal(state.animation,'none'); assert.equal(state.clockAnimation,'none');
  assert.equal(state.statusPresent,false); assert.equal(state.busy,'false');
  assert.equal(state.bodyTop,ready.bodyTop);
  assert.ok(Math.abs(state.iconCenterX)<0.5 && Math.abs(state.iconCenterY)<0.5);
  assert.equal(state.rotation,'rotate(180 12 12)');
  await page.waitForTimeout(180);
  await page.locator('.pena-native-time-panel').screenshot({path:'tests/artifacts/time-panel-background.png'});
  return state;
 });
 await phase('large background reads stay quiet and do not shift the panel', async () => {
  await page.evaluate(() => timeUiProbe.state({status:'loading',hasCompleteSnapshot:true,readProgress:{completedTasks:0,totalTasks:50}}));
  assert.equal((await snapshot()).statusPresent,false);
  await page.evaluate(() => timeUiProbe.state({readProgress:{completedTasks:366,totalTasks:4149}}));
  const bulk = await snapshot(); assert.equal(bulk.statusPresent,false); assert.equal(bulk.bodyTop,ready.bodyTop);
  assert.equal(bulk.total,ready.total); assert.equal(bulk.busy,'false'); assert.doesNotMatch(bulk.meta,/загруз|провер|обнов|Не удалось/i);
  await page.evaluate(() => timeUiProbe.state({status:'ready',readProgress:{completedTasks:4149,totalTasks:4149}}));
  return bulk;
 });
 await phase('unknown and partial totals remain honest without a status bar; cached failure is quiet', async () => {
  assert.equal(ready.statusPresent,false);
  await page.evaluate(() => timeUiProbe.state({status:'loading',data:null,hasCompleteSnapshot:false,error:''}));
  const cold = await snapshot(); assert.equal(cold.total,'—'); assert.match(cold.meta,/Загружаем время/); assert.equal(cold.statusPresent,false); assert.equal(cold.bodyTop,ready.bodyTop);
  await page.evaluate(() => timeUiProbe.state({status:'loading',data:{...window.timeUiOriginalData,coverage:{checkedTasks:366,totalTasks:4149,complete:false}},hasCompleteSnapshot:false,readProgress:{completedTasks:366,totalTasks:4149}}));
  const partial = await snapshot(); assert.equal(partial.statusPresent,false); assert.match(partial.meta,/Часть данных/); assert.match(partial.metaTitle,/366 из 4149/); assert.equal(partial.total,ready.total);
  await page.evaluate(() => timeUiProbe.state({status:'error',data:window.timeUiOriginalData,hasCompleteSnapshot:true,error:'Сеть недоступна'}));
  const failed = await snapshot(); assert.equal(failed.total,ready.total); assert.equal(failed.entries,ready.entries);
  assert.equal(failed.statusPresent,false); assert.doesNotMatch(failed.meta,/Не удалось|Сеть недоступна|Часть данных/); assert.match(failed.metaTitle,/сохранённое время/); assert.equal(failed.bodyTop,cold.bodyTop); assert.equal(failed.disabled,false);
  await page.evaluate(() => timeUiProbe.state({status:'error',data:null,hasVerifiedData:false,hasCompleteSnapshot:false,error:'Сеть недоступна'}));
  const unavailable=await snapshot(); assert.equal(unavailable.total,'—'); assert.match(unavailable.meta,/Не удалось загрузить время/); assert.equal(unavailable.statusPresent,false);
  await page.evaluate(() => timeUiProbe.state({data:window.timeUiOriginalData,hasVerifiedData:true,hasCompleteSnapshot:true}));
  return {cold,partial,failed,unavailable};
 });
 await phase('manual refresh owns busy and reports actionable failure through a toast only', async () => {
  await page.evaluate(() => { timeUiProbe.state({status:'ready',error:''}); timeUiProbe.holdManual(); });
  await page.locator('.pena-native-time-refresh').click();
  const pending = await snapshot(); assert.equal(pending.disabled,true); assert.equal(pending.busy,'true'); assert.equal(pending.animation,'none'); assert.equal(pending.total,ready.total); assert.equal(pending.statusPresent,false);
  await page.evaluate(() => document.querySelector('.pena-native-time-refresh').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(await page.evaluate(() => manualReadCalls),1);
  await page.evaluate(() => rejectManual());
  await page.waitForFunction(() => !document.querySelector('.pena-native-time-refresh').disabled);
  const failed = await snapshot(); assert.equal(failed.statusPresent,false); assert.equal(failed.busy,'false'); assert.match(failed.refreshTitle,/Не удалось получить затраченное время/); assert.equal(failed.total,ready.total);
  await page.locator('.pena-native-toast.--danger.--show').filter({hasText:'Не удалось получить затраченное время'}).waitFor({state:'visible'});
  await page.locator('.pena-native-time-refresh').click(); await page.evaluate(() => resolveManual());
  await page.waitForFunction(() => !document.querySelector('.pena-native-time-refresh').disabled);
  const recovered = await snapshot(); assert.doesNotMatch(recovered.refreshTitle,/Не удалось/); assert.equal(recovered.statusPresent,false);
  return {pending,failed,recovered};
 });
 await phase('a live sending intent is neutral while an uncertain intent remains actionable', async () => {
  await page.evaluate(() => timeUiProbe.sending('sending'));
  assert.equal(await page.locator('.pena-native-time-manual-error').isVisible(),false);
  assert.equal(await page.locator('.pena-native-time-manual-recovery').isVisible(),false);
  assert.equal(await page.locator('.pena-native-time-manual-submit').textContent(),'Сохраняем…');
  await page.evaluate(() => timeUiProbe.sending('unknown'));
  assert.equal(await page.locator('.pena-native-time-manual-error').isVisible(),true);
  assert.equal(await page.locator('.pena-native-time-manual-recovery').isVisible(),true);
 });
 await phase('narrow layout keeps summary and refresh inside the panel without a status bar', async () => {
  await page.setViewportSize({width:360,height:800});
  await page.evaluate(() => timeUiProbe.state({status:'loading',hasCompleteSnapshot:false,error:'',readProgress:{completedTasks:7,totalTasks:20}}));
  const result = await page.evaluate(() => {
   const panel=document.querySelector('.pena-native-time-panel'), meta=panel.querySelector('.pena-native-time-meta'), refresh=panel.querySelector('.pena-native-time-refresh');
   const p=panel.getBoundingClientRect(),s=meta.getBoundingClientRect(),r=refresh.getBoundingClientRect();
   return {panelWidth:p.width,metaInside:s.left>=p.left&&s.right<=p.right,refreshInside:r.left>=p.left&&r.right<=p.right,statusPresent:!!panel.querySelector('.pena-native-time-read-status')};
  });
  assert.equal(result.metaInside,true); assert.equal(result.refreshInside,true); assert.equal(result.statusPresent,false);
  await page.waitForTimeout(180);
  await page.locator('.pena-native-time-panel').screenshot({path:'tests/artifacts/time-panel-background-360.png'});
  return result;
 });
 await phase('a contact card cannot invent zero before its own task has been checked in a partial read',async()=>{
  await page.evaluate(()=>timeUiProbe.contactSnapshot(false));
  const detail=page.locator('.pena-native-time-suggestions .pena-native-time-task-detail');
  const unknown=await detail.textContent();assert.match(unknown,/Учтено —/);assert.match(unknown,/\+1 контакт после записи/);
  await page.evaluate(()=>timeUiProbe.contactSnapshot(true));
  const checked=await detail.textContent();assert.match(checked,/Учтено 0 мин/);assert.match(checked,/\+1 контакт после записи/);
  return{unknown,checked};
 });
 await phase('history shows all 120 cached entries in pages without REST, preserves nodes and protects a displaced editor',async()=>{
  await page.setViewportSize({width:1000,height:800});await page.evaluate(()=>{timeUiProbe.seedHistory(120);timeUiProbe.prepareOtherHistory();});
  const rows=page.locator('.pena-native-time-entry-row'),more=page.locator('.pena-native-time-load-more');
  await page.waitForFunction(()=>document.querySelectorAll('.pena-native-time-entry-row').length===50);
  assert.equal(await page.locator('.pena-native-time-tracked-total').textContent(),'2 ч');assert.equal(await page.locator('.pena-native-time-tracked-label').textContent(),'Записи · 120');
  const restBefore=await page.evaluate(()=>{window.originalHistoryRow=document.querySelector('.pena-native-time-entry-row');return{native:window.nativeRestCalls.length,elapsed:window.timeRestCalls.length};});
  await more.click();await page.waitForFunction(()=>document.querySelectorAll('.pena-native-time-entry-row').length===100);
  assert.equal(await page.evaluate(()=>originalHistoryRow===document.querySelector('.pena-native-time-entry-row')),true);
  await more.click();await page.waitForFunction(()=>document.querySelectorAll('.pena-native-time-entry-row').length===120);
  assert.equal(await more.count(),0);assert.equal(await page.evaluate(()=>originalHistoryRow===document.querySelector('.pena-native-time-entry-row')),true);
  assert.equal(await page.locator('.pena-native-time-total-value').textContent(),'2 ч');
  assert.deepEqual(await page.evaluate(()=>({native:window.nativeRestCalls.length,elapsed:window.timeRestCalls.length})),restBefore,'load-more must expose cached entries without a new network read');
  await page.locator('.pena-native-time-date-prev').click();await page.waitForFunction(()=>document.querySelectorAll('.pena-native-time-entry-row').length===50&&document.querySelector('.pena-native-time-entry-row')?.dataset.penaEntry.startsWith('101:80'));
  await page.locator('.pena-native-time-date-next').click();await page.waitForFunction(()=>document.querySelectorAll('.pena-native-time-entry-row').length===50&&document.querySelector('.pena-native-time-entry-row')?.dataset.penaEntry.startsWith('101:90'));
  await rows.last().locator('.pena-native-time-row-edit').click();await page.locator('.pena-native-time-entry-minutes').fill('17');
  const editingId=await page.evaluate(()=>{window.savedEditor=document.querySelector('.pena-native-time-entry-minutes');return savedEditor.closest('.pena-native-time-entry-row').dataset.penaEntry;});
  await page.evaluate(()=>timeUiProbe.prependHistory());
  assert.equal(await page.locator('.pena-native-time-entry-minutes').inputValue(),'17');assert.equal(await page.evaluate(()=>savedEditor===document.querySelector('.pena-native-time-entry-minutes')),true);
  assert.equal(await rows.count(),51,'the edited 50th row must remain mounted when a new record moves it to position 51');
  assert.equal(await page.locator('.pena-native-time-entry-minutes').evaluate(node=>node.closest('.pena-native-time-entry-row').dataset.penaEntry),editingId);
  assert.equal(await page.locator('.pena-native-time-tracked-total').textContent(),'2 ч 1 мин');
  assert.equal(await page.locator('.pena-native-time-tracked-label').textContent(),'Записи · 121');
  await page.locator('.pena-native-time-entry-cancel').click();await page.waitForFunction(()=>document.querySelectorAll('.pena-native-time-entry-row').length===50);
  return{initial:50,expanded:[100,120],loadMoreRest:0,nodeRetained:true,rangeReset:50,displacedEditorRetained:true,draftMinutes:'17',totalAfterPrepend:'2 ч 1 мин'};
 });
 assert.deepEqual(errors,[]);
} finally {
 mkdirSync('tests/artifacts',{recursive:true});
 writeFileSync('tests/artifacts/time-panel-ui-report.json',JSON.stringify({phases,errors},null,2));
 console.log(JSON.stringify(phases,null,2));
 await browser.close(); await server.close();
}

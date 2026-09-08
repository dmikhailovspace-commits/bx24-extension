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
  state: status.dataset.state, label: status.textContent, statusHidden:status.hidden, statusHeight: status.getBoundingClientRect().height,
  progressAnimation: getComputedStyle(status.querySelector('.pena-native-time-read-progress'),'::after').animationName,
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
  assert.match(cold.label,/Считаем время/); assert.match(cold.label,/0 из 30 задач/);
  await page.evaluate(() => timeUiProbe.emptyState(false,'loading','stats'));
  const unknownDays = await page.locator('.pena-native-time-stats-duration').allTextContents();
  assert.equal(unknownDays.length,7); assert.ok(unknownDays.every(value=>value==='—'),'unverified stats days must not fabricate zeroes');
  await page.evaluate(() => timeUiProbe.emptyState(true,'ready'));
  const zero = await snapshot(); assert.equal(zero.total,'0 мин'); assert.equal(zero.historyLabel,'Записи · 0'); assert.match(zero.compactTotal,/Сегодня 0:00/); assert.equal(zero.statusHidden,true);
  await page.evaluate(() => timeUiProbe.emptyState(true,'loading'));
  const warm = await snapshot(); assert.equal(warm.total,'0 мин'); assert.equal(warm.compactTotal,zero.compactTotal); assert.equal(warm.statusHidden,true);
  await page.evaluate(() => timeUiProbe.emptyState(true,'error'));
  const failed = await snapshot(); assert.equal(failed.total,'0 мин'); assert.equal(failed.state,'error'); assert.equal(failed.statusHidden,false);
  await page.evaluate(() => timeUiProbe.state({status:'ready',data:window.timeUiOriginalData,hasVerifiedData:true,hasCompleteSnapshot:true,error:'',updatedAt:Date.now()}));
  return {cold,unknownDays,zero,warm,failed};
 });
 await phase('background validation preserves known figures and keeps both icons static', async () => {
  await page.evaluate(() => timeUiProbe.state({status:'loading',readProgress:{completedTasks:7,totalTasks:20}}));
  const state = await snapshot();
  assert.equal(state.total,ready.total); assert.equal(state.entries,ready.entries);
  assert.equal(state.disabled,false); assert.equal(state.animation,'none'); assert.equal(state.clockAnimation,'none');
  assert.equal(state.state,'loading'); assert.match(state.label,/Проверяем актуальность/);
  assert.equal(state.bodyTop,ready.bodyTop); assert.equal(state.statusHeight,0); assert.equal(state.statusHidden,true);
  assert.ok(Math.abs(state.iconCenterX)<0.5 && Math.abs(state.iconCenterY)<0.5);
  assert.equal(state.rotation,'rotate(180 12 12)');
  assert.equal(state.progressAnimation,'none');
  await page.waitForTimeout(180);
  await page.locator('.pena-native-time-panel').screenshot({path:'tests/artifacts/time-panel-background.png'});
  return state;
 });
 await phase('a real bulk change reveals progress while single-batch updates remain quiet', async () => {
  await page.evaluate(() => timeUiProbe.state({status:'loading',hasCompleteSnapshot:true,readProgress:{completedTasks:0,totalTasks:50}}));
  assert.equal((await snapshot()).statusHidden,true);
  await page.evaluate(() => timeUiProbe.state({readProgress:{completedTasks:16,totalTasks:51}}));
  const bulk = await snapshot(); assert.equal(bulk.statusHidden,false); assert.equal(bulk.statusHeight,24);
  assert.match(bulk.label,/Обновляем изменённые задачи/); assert.match(bulk.label,/16 из 51 задачи/); assert.equal(bulk.total,ready.total);
  await page.evaluate(() => timeUiProbe.state({status:'ready',readProgress:{completedTasks:51,totalTasks:51}}));
  assert.equal((await snapshot()).statusHidden,true);
  return bulk;
 });
 await phase('cold coverage and errors reveal status; completed idle view releases its space', async () => {
  assert.equal(ready.statusHidden,true); assert.equal(ready.statusHeight,0);
  await page.evaluate(() => timeUiProbe.state({status:'loading',data:null,hasCompleteSnapshot:false,error:''}));
  const cold = await snapshot(); assert.equal(cold.total,'—'); assert.match(cold.label,/Считаем время/); assert.equal(cold.statusHeight,24); assert.ok(cold.bodyTop>ready.bodyTop);
  await page.evaluate(() => timeUiProbe.state({status:'loading',data:{...window.timeUiOriginalData,coverage:{checkedTasks:366,totalTasks:4149,complete:false}},hasCompleteSnapshot:false,readProgress:{completedTasks:366,totalTasks:4149}}));
  const partial = await snapshot(); assert.equal(partial.statusHidden,false); assert.match(partial.label,/366 из 4149 задач/); assert.equal(partial.total,ready.total);
  await page.evaluate(() => timeUiProbe.state({status:'error',data:window.timeUiOriginalData,hasCompleteSnapshot:true,error:'Сеть недоступна'}));
  const failed = await snapshot(); assert.equal(failed.total,ready.total); assert.equal(failed.entries,ready.entries);
  assert.equal(failed.state,'error'); assert.match(failed.label,/Сеть недоступна/); assert.equal(failed.bodyTop,cold.bodyTop); assert.equal(failed.disabled,false);
  return {cold,partial,failed};
 });
 await phase('manual refresh owns its disabled state and reports a real failure separately', async () => {
  await page.evaluate(() => { timeUiProbe.state({status:'ready',error:''}); timeUiProbe.holdManual(); });
  await page.locator('.pena-native-time-refresh').click();
  const pending = await snapshot(); assert.equal(pending.disabled,true); assert.equal(pending.animation,'none'); assert.equal(pending.total,ready.total); assert.equal(pending.statusHidden,false);
  assert.equal(pending.progressAnimation,'pena-time-read-pending');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal((await snapshot()).progressAnimation,'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => document.querySelector('.pena-native-time-refresh').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(await page.evaluate(() => manualReadCalls),1);
  await page.evaluate(() => rejectManual());
  await page.waitForFunction(() => !document.querySelector('.pena-native-time-refresh').disabled);
  const failed = await snapshot(); assert.equal(failed.state,'error'); assert.match(failed.label,/Не удалось получить затраченное время/); assert.equal(failed.total,ready.total);
  await page.locator('.pena-native-time-refresh').click(); await page.evaluate(() => resolveManual());
  await page.waitForFunction(() => !document.querySelector('.pena-native-time-refresh').disabled);
  const recovered = await snapshot(); assert.notEqual(recovered.state,'error'); assert.equal(recovered.statusHidden,true);
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
 await phase('narrow layout keeps the compact status and refresh icon inside the panel', async () => {
  await page.setViewportSize({width:360,height:800});
  await page.evaluate(() => timeUiProbe.state({status:'loading',hasCompleteSnapshot:false,error:'',readProgress:{completedTasks:7,totalTasks:20}}));
  const result = await page.evaluate(() => {
   const panel=document.querySelector('.pena-native-time-panel'), status=panel.querySelector('.pena-native-time-read-status'), refresh=panel.querySelector('.pena-native-time-refresh');
   const p=panel.getBoundingClientRect(),s=status.getBoundingClientRect(),r=refresh.getBoundingClientRect();
   return {panelWidth:p.width,statusInside:s.left>=p.left&&s.right<=p.right,refreshInside:r.left>=p.left&&r.right<=p.right,statusHeight:s.height};
  });
  assert.equal(result.statusInside,true); assert.equal(result.refreshInside,true); assert.equal(result.statusHeight,24);
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

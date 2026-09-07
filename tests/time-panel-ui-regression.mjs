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
  state(patch) {
   const range = _getDialogTimeSelectedRange();
   _setDialogTimeCacheRecord(_getDialogTimeCacheKey(range), {..._getDialogTimeRecord(range), ...patch});
   _syncDialogTimeUi(_dialogControlNativeSwitcherNode);
  },
  emptyState(hasVerifiedData, status, view='day') {
   _dialogTimeView=view;
   const range=view==='stats'?_getDialogTimeStatsRange():_getDialogTimeSelectedRange();
   _setDialogTimeCacheRecord(_getDialogTimeCacheKey(range), {
    status, range, data:{..._PENA_TIME_CONTROL.aggregateElapsedItems([]), range}, hasVerifiedData,
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
  state: status.dataset.state, label: status.textContent, statusHeight: status.getBoundingClientRect().height,
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
 await page.waitForFunction(() => timeUiProbe.idle());
 await page.evaluate(() => { window.timeUiOriginalData=timeUiProbe.record().data; timeUiProbe.state({status:'ready',error:'',updatedAt:Date.now()}); });
 const ready = await snapshot();
 await phase('unverified bootstrap aggregate is unknown in every view, confirmed zero stays visible', async () => {
  await page.evaluate(() => timeUiProbe.emptyState(false,'loading'));
  const cold = await snapshot();
  assert.equal(cold.total,'—','an empty bootstrap aggregate is not a checked zero');
  assert.equal(cold.compactTotal,'Сегодня …');
  assert.equal(cold.historyTotal,'—'); assert.equal(cold.historyLabel,'Записи · …');
  assert.match(cold.label,/Загружаем данные/); assert.match(cold.label,/0 из 30 задач/);
  await page.evaluate(() => timeUiProbe.emptyState(false,'loading','stats'));
  const unknownDays = await page.locator('.pena-native-time-stats-duration').allTextContents();
  assert.equal(unknownDays.length,7); assert.ok(unknownDays.every(value=>value==='—'),'unverified stats days must not fabricate zeroes');
  await page.evaluate(() => timeUiProbe.emptyState(true,'ready'));
  const zero = await snapshot(); assert.equal(zero.total,'0 мин'); assert.equal(zero.historyLabel,'Записи · 0'); assert.match(zero.compactTotal,/Сегодня 0:00/);
  await page.evaluate(() => timeUiProbe.emptyState(true,'loading'));
  const warm = await snapshot(); assert.equal(warm.total,'0 мин'); assert.equal(warm.compactTotal,zero.compactTotal); assert.match(warm.label,/Проверяем актуальность/);
  await page.evaluate(() => timeUiProbe.emptyState(true,'error'));
  const failed = await snapshot(); assert.equal(failed.total,'0 мин'); assert.equal(failed.state,'error');
  await page.evaluate(() => timeUiProbe.state({status:'ready',data:window.timeUiOriginalData,hasVerifiedData:true,error:'',updatedAt:Date.now()}));
  return {cold,unknownDays,zero,warm,failed};
 });
 await phase('background validation preserves known figures and keeps both icons static', async () => {
  await page.evaluate(() => timeUiProbe.state({status:'loading',readProgress:{completedTasks:7,totalTasks:20}}));
  const state = await snapshot();
  assert.equal(state.total,ready.total); assert.equal(state.entries,ready.entries);
  assert.equal(state.disabled,false); assert.equal(state.animation,'none'); assert.equal(state.clockAnimation,'none');
  assert.equal(state.state,'loading'); assert.match(state.label,/Проверяем актуальность/);
  assert.equal(state.bodyTop,ready.bodyTop); assert.equal(state.statusHeight,24);
  assert.ok(Math.abs(state.iconCenterX)<0.5 && Math.abs(state.iconCenterY)<0.5);
  assert.equal(state.rotation,'rotate(180 12 12)');
  assert.equal(state.progressAnimation,'none');
  await page.waitForTimeout(180);
  await page.locator('.pena-native-time-panel').screenshot({path:'tests/artifacts/time-panel-background.png'});
  return state;
 });
 await phase('cold load and failed validation use the same reserved status row', async () => {
  await page.evaluate(() => timeUiProbe.state({status:'loading',data:null,error:''}));
  const cold = await snapshot(); assert.equal(cold.total,'—'); assert.match(cold.label,/Загружаем данные/); assert.equal(cold.bodyTop,ready.bodyTop);
  await page.evaluate(() => timeUiProbe.state({status:'error',data:window.timeUiOriginalData,error:'Сеть недоступна'}));
  const failed = await snapshot(); assert.equal(failed.total,ready.total); assert.equal(failed.entries,ready.entries);
  assert.equal(failed.state,'error'); assert.match(failed.label,/Сеть недоступна/); assert.equal(failed.bodyTop,ready.bodyTop); assert.equal(failed.disabled,false);
  return {cold,failed};
 });
 await phase('manual refresh owns its disabled state and reports a real failure separately', async () => {
  await page.evaluate(() => { timeUiProbe.state({status:'ready',error:''}); timeUiProbe.holdManual(); });
  await page.locator('.pena-native-time-refresh').click();
  const pending = await snapshot(); assert.equal(pending.disabled,true); assert.equal(pending.animation,'none'); assert.equal(pending.total,ready.total);
  assert.equal(pending.progressAnimation,'pena-time-read-pending');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal((await snapshot()).progressAnimation,'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(() => document.querySelector('.pena-native-time-refresh').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(await page.evaluate(() => manualReadCalls),1);
  await page.evaluate(() => rejectManual());
  await page.waitForFunction(() => !document.querySelector('.pena-native-time-refresh').disabled);
  const failed = await snapshot(); assert.equal(failed.state,'error'); assert.match(failed.label,/Не удалось получить затраченное время/); assert.equal(failed.total,ready.total);
  await page.locator('.pena-native-time-refresh').click(); await page.evaluate(() => resolveManual());
  await page.waitForFunction(() => !document.querySelector('.pena-native-time-refresh').disabled);
  const recovered = await snapshot(); assert.notEqual(recovered.state,'error');
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
  await page.evaluate(() => timeUiProbe.state({status:'loading',error:'',readProgress:{completedTasks:7,totalTasks:20}}));
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
 assert.deepEqual(errors,[]);
} finally {
 mkdirSync('tests/artifacts',{recursive:true});
 writeFileSync('tests/artifacts/time-panel-ui-report.json',JSON.stringify({phases,errors},null,2));
 console.log(JSON.stringify(phases,null,2));
 await browser.close(); await server.close();
}

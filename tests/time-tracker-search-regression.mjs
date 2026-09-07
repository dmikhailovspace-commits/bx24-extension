import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
import {selectTimeTrackerTask} from './lib/native-time-task-search.mjs';
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1000,height:800}});
const phases=[],errors=collectPageErrors(page);page.setDefaultTimeout(8000);
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8').replace(anchor,`${anchor}
 window.trackerUiProbe={sync:()=>_syncDialogTimeUi(_dialogControlNativeSwitcherNode),tracker:()=>_readDialogTimeTracker(),query:()=>({..._getDialogTimeTaskSearchState('tracker')}),
  age:()=>{const tracker=_readDialogTimeTracker();_writeDialogTimeTracker({...tracker,startedAt:Date.now()-61000});},
  publish:()=>{_dialogTimeTaskTitles.set('101','Задача 101');_queueDialogTimeUiSync();}};`);
await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
async function phase(name,run){const at=Date.now();try{phases.push({name,status:'PASS',ms:0,detail:await run()});phases.at(-1).ms=Date.now()-at;}catch(error){phases.push({name,status:'FAIL',error:error.message});throw error;}}
try{
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');await page.locator('.pena-native-time-button').click();
 await page.waitForFunction(()=>document.querySelector('.pena-native-time-total-value')?.textContent==='1 ч 30 мин');
 await phase('timer is the final full-width block and has a neutral search instead of a global select',async()=>{
  assert.equal(await page.locator('.pena-native-time-task-select').count(),0);assert.equal(await page.locator('.pena-native-time-tracker-search').inputValue(),'');assert.equal(await page.locator('.pena-native-time-start').isDisabled(),true);
  const bounds=await page.evaluate(()=>{const tracker=document.querySelector('.pena-native-time-tracker'),body=document.querySelector('.pena-native-time-body');const a=tracker.getBoundingClientRect(),b=body.getBoundingClientRect();const contentBottom=Math.max(...[...body.querySelectorAll('.pena-native-time-task-row,.pena-native-time-manual')].filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect().bottom));return{last:tracker.parentElement.lastElementChild===tracker,after:a.top>=b.bottom,afterActualContent:a.top>=contentBottom,width:a.width,bodyWidth:b.width,left:a.left,bodyLeft:b.left};});
  assert.equal(bounds.last,true);assert.equal(bounds.after,true);assert.equal(bounds.afterActualContent,true);assert.ok(Math.abs(bounds.width-bounds.bodyWidth)<1);assert.ok(Math.abs(bounds.left-bounds.bodyLeft)<1);return bounds;
 });
 await phase('timer title search supports keyboard choice and remains independent of manual selection',async()=>{
  await page.locator('.pena-native-time-tracker-search').fill('Задача 101');await page.locator('#pena-time-tracker-task-option-101').waitFor();
  await page.locator('.pena-native-time-tracker-search').press('Enter');await page.locator('.pena-native-time-tracker-selected').waitFor({state:'visible'});
  const toggle=page.locator('.pena-native-time-manual-toggle');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  await page.locator('.pena-native-time-manual-search').fill('Задача 102');await page.locator('#pena-time-task-option-102').click();
  await page.evaluate(()=>trackerUiProbe.publish());await page.waitForTimeout(50);
  assert.match(await page.locator('.pena-native-time-tracker-selected').textContent(),/101/);assert.match(await page.locator('.pena-native-time-manual-selected').textContent(),/102/);
  assert.equal(await page.locator('.pena-native-time-start').isDisabled(),false);return{timer:'101',manual:'102'};
 });
 await phase('background UI sync preserves typed query and result nodes without rebuilding the list',async()=>{
  await page.locator('.pena-native-time-tracker-selected').click();await page.locator('.pena-native-time-tracker-search').fill('Задача');await page.locator('#pena-time-tracker-task-option-101').waitFor();
  const result=await page.evaluate(()=>{const first=document.querySelector('.pena-native-time-tracker-result');for(let i=0;i<20;i++)trackerUiProbe.sync();return{sameNode:first===document.querySelector('.pena-native-time-tracker-result'),query:document.querySelector('.pena-native-time-tracker-search').value};});
  assert.equal(result.sameNode,true);assert.equal(result.query,'Задача');return result;
 });
 await phase('a late search response cannot replace a newer query or selected task',async()=>{
  await page.evaluate(()=>{const original=window.BX.rest.callMethod;window.BX.rest.callMethod=function(method,params,callback){if(method==='tasks.task.list'&&String(params.filter?.TITLE).includes('Старый')){window.oldTrackerSearchHeld=true;window.releaseTrackerSearch=()=>callback({error:()=>null,data:()=>({tasks:[{ID:'99001',TITLE:'Старый ответ',ALLOW_TIME_TRACKING:'Y'}]}),answer:{next:null}});return;}return original.apply(this,arguments);};});
  await page.locator('.pena-native-time-tracker-search').fill('Старый');await page.waitForFunction(()=>window.oldTrackerSearchHeld);
  await page.locator('.pena-native-time-tracker-search').fill('Задача 101');await page.locator('#pena-time-tracker-task-option-101').click();
  await page.evaluate(()=>releaseTrackerSearch());await page.waitForTimeout(80);
  assert.match(await page.locator('.pena-native-time-tracker-selected').textContent(),/101/);assert.equal(await page.locator('#pena-time-tracker-task-option-99001').count(),0);return{staleOptions:0,selected:'101'};
 });
 await phase('selected task starts, stops and persists actual time while manual form stays independent',async()=>{
  const before=await page.evaluate(()=>window.timeAddCalls.length);await page.locator('.pena-native-time-start').click();await page.waitForFunction(()=>trackerUiProbe.tracker()?.taskId==='101');
  assert.equal(await page.locator('.pena-native-time-tracker-search-wrap').isVisible(),false);assert.match(await page.locator('.pena-native-time-manual-selected').textContent(),/102/);
  await page.evaluate(()=>trackerUiProbe.age());await page.locator('.pena-native-time-stop').click();await page.waitForFunction(()=>!trackerUiProbe.tracker());
  assert.equal(await page.evaluate(()=>window.timeAddCalls.length),before+1);assert.match(await page.locator('.pena-native-time-tracker-selected').textContent(),/101/);return{addCalls:1,retainedSelection:'101'};
 });
 await phase('cancel keeps its confirmation and does not save time',async()=>{
  const before=await page.evaluate(()=>window.timeAddCalls.length);await page.locator('.pena-native-time-start').click();await page.waitForFunction(()=>!!trackerUiProbe.tracker());
  const cancel=page.locator('.pena-native-time-tracker .pena-native-time-cancel:not(.pena-native-time-tracker-journal)');await cancel.click();await page.waitForFunction(()=>document.querySelector('.pena-native-time-tracker .pena-native-time-cancel')?.textContent==='Сбросить?');await cancel.click();await page.waitForFunction(()=>!trackerUiProbe.tracker());assert.equal(await page.evaluate(()=>window.timeAddCalls.length),before);return{adds:0};
 });
 await phase('wide and narrow layouts keep full-width bottom search and actions inside one scroll owner',async()=>{
  const measures=[];mkdirSync('tests/artifacts',{recursive:true});
  for(const width of [1000,360]){await page.setViewportSize({width,height:800});await page.locator('.pena-native-time-tracker').scrollIntoViewIfNeeded();
   const measure=await page.evaluate(()=>{const t=document.querySelector('.pena-native-time-tracker'),p=document.querySelector('.pena-native-time-panel'),s=document.querySelector('.pena-native-time-scroll'),b=document.querySelector('.pena-native-time-body');const tr=t.getBoundingClientRect(),pr=p.getBoundingClientRect(),br=b.getBoundingClientRect();return{viewport:innerWidth,trackerWidth:tr.width,bodyWidth:br.width,inside:tr.left>=pr.left&&tr.right<=pr.right,controls:[...t.querySelectorAll('input,button')].filter(n=>n.getClientRects().length).map(n=>{const r=n.getBoundingClientRect();return{width:r.width,height:r.height,inside:r.left>=tr.left&&r.right<=tr.right};}),last:s.lastElementChild===t};});
   assert.equal(measure.inside,true);assert.equal(measure.last,true);assert.ok(Math.abs(measure.trackerWidth-measure.bodyWidth)<1);assert.ok(measure.controls.every(c=>c.inside&&Math.abs(c.height-32)<1));measures.push(measure);
   await page.locator('.pena-native-time-panel').screenshot({path:`tests/artifacts/time-tracker-bottom-${width}.png`});
  }return measures;
 });
 assert.deepEqual(errors,[]);console.log(`PASS tracker search: ${phases.length} phases`);
}finally{mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/time-tracker-search-report.json',JSON.stringify({phases,errors},null,2));await browser.close();await server.close();}

import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=collectPageErrors(page),phases=[];
await page.addInitScript(()=>{window.timeTaskGroupOverrides={'101':'1','102':'2','303':'0'};});
const phase=async(name,run)=>{const start=Date.now();try{const detail=await run();phases.push({name,status:'PASS',ms:Date.now()-start,detail});}catch(error){phases.push({name,status:'FAIL',ms:Date.now()-start,error:String(error)});throw error;}};
const preference=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(`pena.timeProjects.v1.${location.host.toLowerCase()}~7`)||'null'));
const project=id=>page.locator(`.pena-native-time-project-settings input[data-project-id="${id}"]`);
const openSettings=async()=>{await page.locator('.pena-native-time-project-button').click();await project('1').waitFor({state:'visible'});};
const save=async()=>{await page.locator('.pena-native-time-project-save').click();await page.locator('.pena-native-time-project-settings').waitFor({state:'hidden'});};
const settled=async(expectedTotal)=>page.waitForFunction(expected=>document.querySelector('.pena-native-time-read-status')?.dataset.state==='ready'&&document.querySelector('.pena-native-time-total-value')?.textContent===expected,expectedTotal,{timeout:15000});
const timeIds=()=>page.evaluate(()=>window.timeRestCalls.map(params=>String(params[0])));
const artifacts=new URL('./artifacts/',import.meta.url);mkdirSync(artifacts,{recursive:true});
try{
 await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=tasks&timeProjects=unconfigured`);
 await page.locator('.pena-native-time-button').waitFor({state:'visible'});
 await page.evaluate(()=>{
  const original=window.BX.rest.callMethod;window.projectLookupAttempts=0;
  window.BX.rest.callMethod=function(method,params,callback){
   if(method==='sonet_group.get'&&++window.projectLookupAttempts===1){callback({error:()=> 'TEMPORARY_ERROR',error_description:()=> 'Project fixture failure'});return;}
   return original.apply(this,arguments);
  };
 });
 await phase('mandatory selection blocks time reads; project failure has a working retry',async()=>{
  await page.locator('.pena-native-time-button').click();
  await page.locator('.pena-native-time-project-status.--error').waitFor({state:'visible'});
  assert.equal(await preference(),null);assert.deepEqual(await timeIds(),[]);
  assert.equal(await page.locator('.pena-native-time-project-save').isDisabled(),true);
  assert.equal(await page.locator('.pena-native-time-project-cancel').isVisible(),false,'Mandatory first selection exposed cancel');
  assert.equal(await page.locator('.pena-native-time-summary').isVisible(),false);
  await page.locator('.pena-native-time-project-status').getByRole('button',{name:'Повторить'}).click();
  await project('1').waitFor({state:'visible'});
  assert.equal(await page.locator('.pena-native-time-project-status').evaluate(n=>n.classList.contains('--error')),false);
  assert.equal(await page.evaluate(()=>window.projectLookupAttempts),2);
  assert.deepEqual(await timeIds(),[]);
  const timeCatalogCalls=await page.evaluate(()=>window.nativeRestCalls.filter(c=>c.method==='tasks.task.list'&&(c.params?.filter?.GROUP_ID!=null||c.params?.filter?.['>GROUP_ID']!=null)));
  assert.deepEqual(timeCatalogCalls,[],'Unconfigured projects launched a time catalog crawl');
 });
 await phase('task selection before the initial project catalog is confirmed cannot write time',async()=>{
  await page.evaluate(()=>{
   const original=window.BX.rest.callMethod;
   window.initialProjectCatalogHolds=[];window.releaseInitialProjectCatalog=false;
   window.BX.rest.callMethod=function(method,params,callback){
    if(method==='tasks.task.list'&&params.order?.ID==='asc'&&!window.releaseInitialProjectCatalog){
     window.initialProjectCatalogHolds.push(()=>original.call(this,method,params,callback));return;
    }
    return original.apply(this,arguments);
   };
  });
  await project('1').check();await save();
  await page.waitForFunction(()=>window.initialProjectCatalogHolds.length===1);
  await page.locator('.pena-native-time-manual-search').fill('Задача 101');
  await page.locator('#pena-time-task-option-101').click();
  await page.locator('.pena-native-time-manual-minutes').fill('10');
  await page.locator('.pena-native-time-tracker-search').fill('Задача 101');
  await page.locator('#pena-time-tracker-task-option-101').click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('.pena-native-time-manual-submit').isDisabled(),true,'Manual write became available before project membership was confirmed');
  assert.equal(await page.locator('.pena-native-time-start').isDisabled(),true,'Timer became available before project membership was confirmed');
  const held=await page.evaluate(()=>({catalog:window.initialProjectCatalogHolds.length,elapsed:window.timeRestCalls.length,adds:window.timeAddCalls.length,updates:window.timeUpdateCalls.length,deletes:window.timeDeletedItems.length}));
  assert.deepEqual(held,{catalog:1,elapsed:0,adds:0,updates:0,deletes:0});
  await page.evaluate(()=>{window.releaseInitialProjectCatalog=true;window.initialProjectCatalogHolds.splice(0).forEach(release=>release());});
  await settled('1 ч');
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-manual-submit')?.disabled===false&&document.querySelector('.pena-native-time-start')?.disabled===false);
  assert.equal(await page.evaluate(()=>window.timeAddCalls.length),0,'Releasing project metadata must not write time automatically');
  return held;
 });
 await phase('saving project 1 persists the exact selection and reads only its elapsed tasks',async()=>{
  assert.deepEqual(await preference(),{version:1,all:false,ids:['1'],includeUnassigned:false});
  assert.equal(await page.locator('.pena-native-time-total-value').innerText(),'1 ч');
  const ids=await timeIds();assert.ok(ids.includes('101'));assert.ok(!ids.includes('102')&&!ids.includes('303'));
  return{elapsedTaskIds:ids};
 });
 await phase('search and project change exclude the old project',async()=>{
  await openSettings();await page.locator('.pena-native-time-project-search').fill('Проект 2');
  assert.equal(await project('1').count(),0);assert.equal(await project('2').isVisible(),true);
  await page.locator('.pena-native-time-project-search').fill('');await project('1').uncheck();await project('2').check();
  const count=(await timeIds()).length;await save();await settled('30 мин');
  assert.deepEqual(await preference(),{version:1,all:false,ids:['2'],includeUnassigned:false});
  assert.equal(await page.locator('.pena-native-time-total-value').innerText(),'30 мин');
  const delta=(await timeIds()).slice(count);assert.ok(delta.includes('102'));assert.ok(!delta.includes('101')&&!delta.includes('303'));
  return{elapsedTaskIds:delta};
 });
 await phase('reopen, cancel and reload preserve the configured projects',async()=>{
  await openSettings();assert.equal(await project('1').isChecked(),false);assert.equal(await project('2').isChecked(),true);
  await project('1').check();await page.locator('.pena-native-time-project-cancel').click();
  assert.deepEqual((await preference()).ids,['2']);
  await page.reload();await page.locator('.pena-native-time-button').click();await settled('30 мин');
  assert.deepEqual((await preference()).ids,['2']);
  assert.equal(await page.locator('.pena-native-time-total-value').innerText(),'30 мин');
  await openSettings();assert.equal(await project('2').isChecked(),true);assert.equal(await project('1').isChecked(),false);
 });
 await phase('select all and unassigned remain separate, and both survive save',async()=>{
  await page.locator('.pena-native-time-project-all input').check();
  assert.equal(await project('1').isChecked(),true);assert.equal(await project('2').isChecked(),true);assert.equal(await project('0').isChecked(),false);
  await project('0').check();await save();await settled('1 ч 30 мин');
  assert.deepEqual(await preference(),{version:1,all:true,ids:[],includeUnassigned:true});
  assert.equal(await page.locator('.pena-native-time-total-value').innerText(),'1 ч 30 мин');
  assert.ok((await timeIds()).includes('303'),'Selecting unassigned tasks did not read the group-zero task');
  await openSettings();assert.equal(await page.locator('.pena-native-time-project-all input').isChecked(),true);assert.equal(await project('0').isChecked(),true);
 });
 await phase('actual settings fit the enlarged desktop and narrow viewport',async()=>{
  const result=[];
  for(const viewport of [{width:1280,height:900},{width:360,height:760}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(180);
   const geometry=await page.locator('.pena-native-time-panel').evaluate(panel=>{const r=panel.getBoundingClientRect(),scroll=panel.querySelector('.pena-native-time-scroll');return{width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:scroll.scrollWidth-scroll.clientWidth};});
   assert.equal(geometry.width,viewport.width===360?344:960);assert.equal(geometry.height,viewport.width===360?744:720);assert.ok(geometry.overflow<=1);
   await page.screenshot({path:new URL(`time-project-settings-${viewport.width}.png`,artifacts).pathname.replace(/^\/(?=[A-Za-z]:)/,'')});
   result.push({viewport,geometry});
  }
  return result;
 });
 assert.deepEqual(errors,[]);console.log(`PASS actual project settings: ${phases.length} phases`);
}catch(error){
 console.error(JSON.stringify(await page.evaluate(()=>({errors:window.__PENA_REST_DIAGNOSTICS__?.snapshot(),text:document.querySelector('.pena-native-time-panel')?.innerText,calls:window.nativeRestCalls,timeCalls:window.timeRestCalls})),null,2));
 throw error;
}finally{
 writeFileSync(new URL('time-project-settings-ui-report.json',artifacts),JSON.stringify({phases,errors},null,2));
 await browser.close();await server.close();
}

import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync('extension/injected.js','utf8');
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),phases=[];
const errors=[];
const injected=source.replace('\tasync function boot() {',`\tasync function boot() {
 window.previewRace={items:_getDialogControlItemsForMode,save:_saveDialogControlItemsForMode,key:_dialogAutomationKey,receive:_receiveDialogAutomationTask,apply:_applyDialogAutomation,facts:_dialogAutomationFacts,open:_openDialogAutomation};
 const originalPrepare=_prepareDialogAutomationSnapshot;
 _prepareDialogAutomationSnapshot=async(...args)=>{if(window.raceHoldSave)await new Promise(resolve=>window.raceReleaseSave=resolve);return originalPrepare(...args);};`);
async function fixture(legacy=false){
 const page=await browser.newPage({viewport:{width:1100,height:850}});page.on('pageerror',e=>errors.push(e.message));
 let body=injected;
 if(legacy){
  const fixed="(_dialogAutomationDirtyTasks.has(_getDialogTimeIdentityScopeKey()+':'+item.taskId)&&previewFacts.get(item.id)?.identity!==identity(item))";
  assert.ok(body.includes(fixed),'Legacy probe must target only the dirty-preview cache fix');
  body=body.replace(fixed,"_dialogAutomationDirtyTasks.has(_getDialogTimeIdentityScopeKey()+':'+item.taskId)");
 }
 await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&passThrough=1');
 await page.locator('.task-host .pena-native-rules-button').waitFor();
 await page.waitForFunction(()=>previewRace.items('tasks').filter(x=>x.taskId).length>=12);
 await page.evaluate(()=>{
  window.raceReads=[];window.raceHeld=[];window.raceHold=false;
  const call=BX.rest.callMethod;
  BX.rest.callMethod=function(method,params,callback){
   if(method==='tasks.task.get'){
    const id=String(params.taskId),owner=window.raceOwner||'7';raceReads.push(id);
    const deliver=()=>callback({error:()=>null,data:()=>({task:{id,responsibleId:owner}})});
    if(raceHold)raceHeld.push(deliver);else deliver();return;
   }
   return call.call(this,method,params,callback);
  };
  for(const item of previewRace.items('tasks').filter(x=>x.taskId))previewRace.receive(String(item.taskId),{RESPONSIBLE_ID:'8'});
 });
 return page;
}
async function addOwnerRule(page){
 await page.evaluate(()=>previewRace.open());await page.getByRole('tab',{name:'Правила',exact:true}).click();
 await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
 await page.getByLabel('Поле условия').selectOption('responsibleId');
 await page.getByLabel('Значение условия').fill('7');
 await page.getByLabel('Папка назначения').selectOption('folder:test');
}
async function dirty(page,count=1){return page.evaluate(count=>{
 const chosen=previewRace.items('tasks').filter(x=>x.taskId).slice(0,count);
 chosen.forEach(item=>previewRace.receive(String(item.taskId),{}));return chosen.map(x=>String(x.taskId));
},count);}
async function check(page){await page.getByRole('button',{name:'Проверить',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.pena-automation-status')?.textContent.includes('Совпадений:'));return page.locator('.pena-automation-status').innerText();}
async function beginHeld(page){await page.evaluate(()=>{raceHold=true;raceReads.length=0;});await page.getByRole('button',{name:'Проверить',exact:true}).click();await page.waitForFunction(()=>raceHeld.length>0);}
async function release(page){await page.evaluate(()=>{raceHold=false;raceHeld.splice(0).forEach(fn=>fn());});}
async function snapshot(page){return page.evaluate(()=>({items:localStorage.getItem('pena.dialogControl.v1.tasks'),rules:localStorage.getItem(previewRace.key('tasks'))}));}
async function phase(name,fn){const page=await fixture();try{await fn(page);phases.push({name,passed:true});console.log('PASS '+name);}finally{await page.close();}}
try{
 await phase('Conflict badges follow lookup selection, live facts and dirty task invalidation without saving',async page=>{
  await page.evaluate(()=>{
   previewRace.save('tasks',[...previewRace.items('tasks'),{id:'folder:conflict',type:'folder',title:'Другая папка'}]);
   const call=BX.rest.callMethod;BX.rest.callMethod=function(method,params,callback){if(method==='im.search.user.list'){callback({error:()=>null,data:()=>[{id:7,name:'Тестовый исполнитель'}]});return;}return call.call(this,method,params,callback);};
  });
  await addOwnerRule(page);await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
  await page.getByLabel('Поле условия').last().selectOption('responsibleId');await page.getByLabel('Значение условия').last().fill('7');await page.getByLabel('Папка назначения').last().selectOption('folder:conflict');
  await page.evaluate(()=>{const item=previewRace.items('tasks').find(x=>x.taskId);window.conflictId=String(item.taskId);previewRace.receive(conflictId,{RESPONSIBLE_ID:'7'});});
  await page.waitForFunction(()=>document.querySelectorAll('.pena-automation-conflict:not([hidden])').length===2);
  await page.getByLabel('Значение условия').last().fill('Тестовый');
  await page.waitForFunction(()=>document.querySelectorAll('.pena-automation-conflict:not([hidden])').length===0);
  await page.locator('.pena-automation-person-option').last().click();
  await page.waitForFunction(()=>document.querySelectorAll('.pena-automation-conflict:not([hidden])').length===2);
  await page.evaluate(()=>previewRace.receive(conflictId,{}));
  await page.waitForFunction(()=>document.querySelectorAll('.pena-automation-conflict:not([hidden])').length===0);
  await page.evaluate(()=>previewRace.receive(conflictId,{RESPONSIBLE_ID:'7'}));
  await check(page); // A partial Pull patch cannot clear unknown fields; a detail read can.
  await page.waitForFunction(()=>document.querySelectorAll('.pena-automation-conflict:not([hidden])').length===2);
  await page.evaluate(()=>previewRace.receive(conflictId,{RESPONSIBLE_ID:'8'}));
  await page.waitForFunction(()=>document.querySelectorAll('.pena-automation-conflict:not([hidden])').length===0);
 });
 await phase('Twelve dirty tasks progress across two preview batches without writes',async page=>{
  await addOwnerRule(page);const ids=await dirty(page,12),before=await snapshot(page);
  assert.match(await check(page),/Совпадений: 10/);assert.match(await check(page),/Совпадений: 12/);
  assert.deepEqual((await page.evaluate(()=>raceReads)).sort(),ids.sort(),'Each dirty task is read once; the second batch advances');
  assert.deepEqual(await snapshot(page),before,'Preview must not save rules or placements');
 });
 const legacy=await fixture(true);try{
  await addOwnerRule(legacy);await dirty(legacy,12);await check(legacy);const second=await check(legacy);
  assert.match(second,/Совпадений: 10/);assert.equal(await legacy.evaluate(()=>new Set(raceReads).size),10);
  phases.push({name:'Previous dirty-preview expression reproduces starvation at ten tasks',passed:true});
 }finally{await legacy.close();}
 await phase('Closing during a pending preview discards the result and keeps storage',async page=>{
  await addOwnerRule(page);await dirty(page);const before=await snapshot(page);await beginHeld(page);
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();await release(page);
  await page.waitForTimeout(80);assert.equal(await page.locator('.pena-automation-panel').count(),0);assert.deepEqual(await snapshot(page),before);
 });
 await phase('Editing while preview waits discards the old match and rereads for the new draft',async page=>{
  await addOwnerRule(page);await dirty(page);await beginHeld(page);
  await page.getByLabel('Значение условия').fill('8');await release(page);
  await page.waitForFunction(()=>[...document.querySelectorAll('.pena-automation-panel button')].find(x=>x.textContent==='Проверить')?.disabled===false);
  assert.equal(await page.locator('.pena-automation-status').innerText(),'');
  const remaining=await page.evaluate(()=>previewRace.items('tasks').filter(x=>x.taskId).length-1);
  assert.match(await check(page),new RegExp(`Совпадений: ${remaining}\\b`));
  assert.equal(await page.evaluate(()=>raceReads.length),2,'Cancelled draft cannot cache its task response');
 });
 await phase('A Pull change invalidates a pending preview response and its cache',async page=>{
  await addOwnerRule(page);const [id]=await dirty(page);await beginHeld(page);
  await page.evaluate(id=>{previewRace.receive(id,{RESPONSIBLE_ID:'8'});window.raceOwner='8';},id);await release(page);
  await page.waitForFunction(()=>[...document.querySelectorAll('.pena-automation-panel button')].find(x=>x.textContent==='Проверить')?.disabled===false);
  assert.match(await page.locator('.pena-automation-status').innerText(),/Совпадений: 0/);
  assert.match(await check(page),/Совпадений: 0/);assert.equal(await page.evaluate(()=>raceReads.length),2,'Stale response must not be cached under a changed task identity');
 });
 await phase('Reordering during a pending preview discards its winner and allows a fresh check',async page=>{
  await addOwnerRule(page);
  await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
  await page.getByLabel('Значение условия').last().fill('Задача');await page.getByLabel('Папка назначения').last().selectOption('folder:test');
  await dirty(page);const before=await snapshot(page);await beginHeld(page);
  await page.getByRole('button',{name:'Переместить правило',exact:true}).last().press('Alt+ArrowUp');
  assert.equal(await page.getByRole('button',{name:'Проверить',exact:true}).isEnabled(),true);
  await release(page);await page.waitForTimeout(80);
  assert.match(await page.locator('.pena-automation-status').innerText(),/Порядок изменён/);
  assert.deepEqual(await snapshot(page),before);assert.match(await check(page),/Совпадений:/);
 });
 await phase('Save supersedes a pending preview and keeps all controls locked until activation completes',async page=>{
  await addOwnerRule(page);await dirty(page);await beginHeld(page);await page.evaluate(()=>raceHoldSave=true);
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.waitForFunction(()=>typeof raceReleaseSave==='function');
  await release(page);await page.waitForTimeout(80);
  assert.equal(await page.getByRole('button',{name:'Проверить',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('.pena-automation-status').innerText(),'Проверяем список существующих диалогов…');
  await page.evaluate(()=>raceReleaseSave());await page.locator('.pena-automation-panel').waitFor({state:'detached',timeout:20000});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(previewRace.key('tasks'))).rules[0].conditions[0].value),'7');
 });
 await phase('A skipped unassigned proposal is not promised as an automatic move',async page=>{
  await page.evaluate(()=>{
   const api=previewRace,items=api.items('tasks'),item=items.find(x=>x.taskId);window.skippedId=item.id;
   item.folderId='';delete item.automationHandled;api.save('tasks',items);
   const rules=[{id:'skipped',enabled:true,name:'Пропущено',folderId:'folder:test',match:'all',conditions:[{field:'responsibleId',op:'eq',value:'7'}]}];
   localStorage.setItem(api.key('tasks'),JSON.stringify({version:1,rules,excludedIds:[item.id]}));
   api.apply('tasks',items);api.receive(String(item.taskId),{RESPONSIBLE_ID:'7'});api.apply('tasks',items);api.open();
  });
  await page.getByRole('button',{name:'Пропустить',exact:true}).click();await page.getByRole('tab',{name:'Правила',exact:true}).click();
  await page.getByLabel('Распределить уже существующие диалоги').check();
  const text=await check(page);assert.match(text,/Сейчас будут распределены: 0/);assert.match(text,/Ранее пропущены: 1/);
  assert.equal(await page.evaluate(()=>previewRace.items('tasks').find(x=>x.id===skippedId).folderId),'');
 });
 assert.deepEqual(errors,[]);
}finally{
 await browser.close();await server.close();mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/rules-preview-races.json',JSON.stringify({phases,errors,livePortal:false},null,2));
}
console.log(`PASS preview races: ${phases.length} phases`);

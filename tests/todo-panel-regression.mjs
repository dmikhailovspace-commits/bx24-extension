import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
import {createTodoWorker} from './lib/todo-worker-harness.mjs';
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1100,height:850}});
const worker=createTodoWorker({},values=>{
 for(const [key,value] of Object.entries(values)){
  const match=key.match(/^pena\.todos\.v1\.([^~]+)~(.+)$/);if(!match)continue;
  const change={scope:{portalHost:decodeURIComponent(match[1]),userId:decodeURIComponent(match[2])},revision:value.revision};
  for(const page of context.pages())page.evaluate(change=>document.dispatchEvent(new CustomEvent('pena-todo-changed',{detail:JSON.stringify(change)})),change).catch(()=>{});
 }
});
await context.exposeFunction('todoBridge',async(command,scope,payload)=>{try{return{ok:true,result:await worker.request(command,scope,payload)};}catch(error){return{ok:false,error:error.message,code:error.code};}});
await context.addInitScript(()=>{
 const call=async(command,scope,payload)=>{const response=await window.todoBridge(command,scope,payload);if(!response.ok)throw Object.assign(new Error(response.error),{code:response.code});return response.result;};
 window.__PENA_DIALOG_REPOSITORY__={todoList:scope=>call('todo.list',scope),todoSave:(scope,payload)=>call('todo.save',scope,payload)};
});
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8').replace(anchor,`${anchor}
 window.todoProbe={state:()=>_getDialogTodoState(),tracker:()=>_readDialogTimeTracker({fresh:true}),sync:()=>_syncDialogTimeUi(_dialogControlNativeSwitcherNode),
  age:()=>{const tracker=_readDialogTimeTracker();_writeDialogTimeTracker({...tracker,startedAt:Date.now()-65000});},
  start:task=>_startDialogTimeTracker(task),eligibility:(id,value)=>_setDialogTimeTaskEligibility(id,value),outgoing:()=>_dialogTimeOutgoingIntentAt,
  user:id=>{currentBitrixUserId=id;_acceptCurrentBitrixUserId(id);_syncDialogTimeUi(_dialogControlNativeSwitcherNode);}};`);
await context.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
const page=await context.newPage(),errors=collectPageErrors(page),phases=[];page.setDefaultTimeout(10000);
async function phase(name,fn){const at=Date.now();try{const detail=await fn();phases.push({name,status:'PASS',ms:Date.now()-at,detail});}catch(error){phases.push({name,status:'FAIL',error:error.message});await page.screenshot({path:'tests/artifacts/todo-failure.png'});throw error;}}
const open=async(p=page)=>{await p.locator('.pena-native-todo-button').click();await p.waitForFunction(()=>todoProbe.state().loaded);};
const add=async(title)=>{await page.getByRole('textbox',{name:'Новое дело',exact:true}).fill(title);await page.locator('.pena-native-todo-add button').click();await page.getByRole('button',{name:title,exact:true}).waitFor();};
const row=title=>page.locator('.pena-native-todo-row').filter({has:page.getByRole('button',{name:title,exact:true})});
mkdirSync('tests/artifacts',{recursive:true});
try{
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');await open();
 await phase('separate panel and local checklist need no Bitrix writes',async()=>{
  assert.equal(await page.locator('.pena-native-time-panel').count(),0);
  await add('Подготовить презентацию');await add('Позвонить подрядчику');
  await row('Позвонить подрядчику').getByRole('checkbox',{name:'Выполнить: Позвонить подрядчику',exact:true}).click();
  await page.waitForFunction(()=>todoProbe.state().items.some(item=>item.title==='Позвонить подрядчику'&&item.doneAt));
  await page.getByRole('button',{name:'Готово',exact:true}).click();await row('Позвонить подрядчику').waitFor();
  await row('Позвонить подрядчику').getByRole('checkbox',{name:'Вернуть в работу: Позвонить подрядчику'}).click();
  await page.getByRole('button',{name:'В работе',exact:true}).click();await row('Позвонить подрядчику').waitFor();
  assert.equal(await page.evaluate(()=>timeAddCalls.length),0);
 });
 await phase('inline subtasks, reversible checks, editing and undo',async()=>{
  await page.getByRole('button',{name:'Все',exact:true}).click();
  const parent=row('Подготовить презентацию');
  await parent.getByRole('button',{name:'+ Подзадача',exact:true}).click();
  const input=parent.getByRole('textbox',{name:'Новая подзадача: Подготовить презентацию'});
  await input.fill('Собрать материалы');await input.press('Enter');
  await parent.getByRole('checkbox',{name:'Выполнить подзадачу: Собрать материалы'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-todo-action="add-step"]')?.value==='');
  assert.equal(await input.evaluate(node=>node===document.activeElement),true);
  await input.fill('Проверить цифры');await input.press('Enter');
  await parent.getByRole('checkbox',{name:'Выполнить подзадачу: Проверить цифры'}).waitFor();
  await parent.getByRole('checkbox',{name:'Выполнить подзадачу: Собрать материалы'}).focus();
  await page.keyboard.press('Space');
  await parent.getByRole('checkbox',{name:'Вернуть подзадачу: Собрать материалы'}).waitFor();
  assert.match(await parent.textContent(),/1\/2 подзадач/);
  await parent.getByRole('checkbox',{name:'Выполнить: Подготовить презентацию',exact:true}).click();
  await parent.getByRole('checkbox',{name:'Вернуть в работу: Подготовить презентацию',exact:true}).click();
  await parent.getByRole('checkbox',{name:'Выполнить: Подготовить презентацию',exact:true}).waitFor();
  assert.equal(await parent.getByRole('checkbox',{name:'Вернуть подзадачу: Собрать материалы'}).getAttribute('aria-checked'),'true');
  const title=parent.getByRole('textbox',{name:'Название подзадачи: Проверить цифры'});
  await title.fill('Проверить смету');await title.press('Enter');
  await parent.getByRole('textbox',{name:'Название подзадачи: Проверить смету'}).waitFor();
  await parent.getByRole('button',{name:'Удалить подзадачу: Проверить смету'}).click();
  await page.getByText('Подзадача удалена.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Вернуть',exact:true}).click();
  await parent.getByRole('textbox',{name:'Название подзадачи: Проверить смету'}).waitFor();
  await input.fill('Черновик');await page.evaluate(()=>{for(let i=0;i<20;i++)todoProbe.sync();});
  assert.equal(await input.inputValue(),'Черновик');await input.fill('');
  worker.failWrite(true);await input.fill('Сохранить подзадачу');await input.press('Enter');
  await page.getByText('Не удалось сохранить дело.',{exact:false}).waitFor();
  assert.equal(await input.inputValue(),'Сохранить подзадачу');worker.failWrite(false);await input.press('Enter');
  await parent.getByRole('checkbox',{name:'Выполнить подзадачу: Сохранить подзадачу'}).waitFor();
  await page.screenshot({path:'tests/artifacts/todo-checklist-1100.png'});
  await page.setViewportSize({width:360,height:850});await page.screenshot({path:'tests/artifacts/todo-checklist-360.png'});
  await page.setViewportSize({width:1100,height:850});
  await page.reload();await open();await parent.getByRole('button',{name:'1/3 подзадач'}).waitFor();
  await page.getByRole('searchbox',{name:'Найти дело',exact:true}).fill('смету');await parent.waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.pena-native-todo-row').length===1);
  await page.getByRole('searchbox',{name:'Найти дело',exact:true}).fill('');
 });
 await phase('edit title, note, date and task with keyboard search',async()=>{
  await page.getByRole('button',{name:'Подготовить презентацию',exact:true}).click();
  await page.locator('.pena-native-todo-edit-note').fill('Проверить финальные макеты');
  const outgoing=await page.evaluate(()=>todoProbe.outgoing());await page.locator('.pena-native-todo-edit-note').press('Enter');
  assert.equal(await page.evaluate(()=>todoProbe.outgoing()),outgoing,'todo note must not count as an outgoing Bitrix message');
  await page.locator('.pena-native-todo-edit-date').fill('2026-01-01');
  await page.locator('.pena-native-todo-task-search').fill('101');await page.locator('#pena-todo-task-101').waitFor();
  await page.locator('.pena-native-todo-task-search').press('Enter');await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await row('Подготовить презентацию').waitFor();assert.match(await row('Подготовить презентацию').textContent(),/#101/);
  assert.match(await row('Подготовить презентацию').textContent(),/Просрочено/);
 });
 await phase('one timer shared with time panel; stop is the only elapsed write',async()=>{
  await row('Подготовить презентацию').getByRole('button',{name:'Начать таймер: Подготовить презентацию'}).click();
  await page.waitForFunction(()=>!!todoProbe.tracker()?.todoId);assert.equal(await page.evaluate(()=>timeAddCalls.length),0);
  await page.evaluate(()=>{for(let i=0;i<5;i++)todoProbe.sync();});
  assert.equal(await row('Подготовить презентацию').getByRole('checkbox',{name:'Выполнить: Подготовить презентацию'}).isDisabled(),true);
  await page.evaluate(()=>todoProbe.start({taskId:'102',title:'Задача 102'}));assert.equal(await page.evaluate(()=>todoProbe.tracker().taskId),'101');
  await page.locator('.pena-native-todo-timer').getByRole('button',{name:'Учёт времени',exact:true}).click();
  await page.locator('.pena-native-time-panel').waitFor();assert.equal(await page.locator('.pena-native-todo-panel').count(),0);
  assert.equal(await page.evaluate(()=>todoProbe.tracker().taskId),'101');
  await page.locator('.pena-native-time-header-actions > .pena-native-popover-close').click();await open();
  await page.reload();await open();assert.ok(await page.evaluate(()=>todoProbe.tracker()?.todoId),'active todo timer survives reload');
  await page.evaluate(()=>{todoProbe.age();timeAddFailures=1;});await page.getByRole('button',{name:'Остановить и записать',exact:true}).click();
  await page.getByRole('button',{name:'Повторить запись',exact:true}).waitFor();assert.ok(await page.evaluate(()=>todoProbe.tracker().stoppedAt));
  await page.getByRole('button',{name:'Повторить запись',exact:true}).click();
  await page.waitForFunction(()=>!todoProbe.tracker());assert.equal(await page.evaluate(()=>timeAddCalls.length),2);
  assert.equal(await page.evaluate(()=>timeAddedItems.length),1,'one successful save after explicit rejection');
  assert.ok(await page.evaluate(()=>Number(timeAddCalls[0].ARFIELDS.SECONDS)>=60));
 });
 await phase('persistence and cross-window changes, failure keeps typed draft',async()=>{
  await page.reload();await open();await row('Подготовить презентацию').waitFor();
  const other=await context.newPage();await other.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');await open(other);
  await other.getByRole('textbox',{name:'Новое дело',exact:true}).fill('Из другого окна');await other.locator('.pena-native-todo-add button').click();await row('Из другого окна').waitFor();
  await other.close();worker.failWrite(true);
  await page.getByRole('textbox',{name:'Новое дело',exact:true}).fill('Сохранить при ошибке');await page.locator('.pena-native-todo-add button').click();
  await page.getByText('Не удалось сохранить дело.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Новое дело',exact:true}).inputValue(),'Сохранить при ошибке');worker.failWrite(false);
  await page.locator('.pena-native-todo-add button').click();await row('Сохранить при ошибке').waitFor();
 });
 await phase('delete and undo do not touch Bitrix task or time',async()=>{
  await page.getByRole('button',{name:'Позвонить подрядчику',exact:true}).click();await page.getByRole('button',{name:'Удалить',exact:true}).click();
  await page.locator('.pena-native-todo-undo').waitFor({state:'visible'});assert.equal(await row('Позвонить подрядчику').count(),0);
  await page.getByRole('button',{name:'Вернуть',exact:true}).click();await row('Позвонить подрядчику').waitFor();
  assert.equal(await page.evaluate(()=>timeAddCalls.length),0);
 });
 await phase('user change does not expose another personal list',async()=>{
  await page.evaluate(()=>todoProbe.user('8'));
  await page.waitForFunction(()=>todoProbe.state().loaded&&todoProbe.state().scope.endsWith('~8'));
  assert.equal(await page.locator('.pena-native-todo-row').count(),0);
  await page.evaluate(()=>todoProbe.user('7'));await row('Подготовить презентацию').waitFor();
 });
 await phase('real mouse wheel, narrow layout, draft and focus survive refresh',async()=>{
  const scope=await page.evaluate(()=>({portalHost:location.hostname,userId:String(currentBitrixUserId)}));
  for(let i=0;i<20;i++)await worker.request('todo.save',scope,{id:`seed-todo-${i}`,baseRevision:0,operationId:`seed-op-${i}`,changes:{title:`Дополнительное дело ${i}`}});
  await page.waitForFunction(()=>todoProbe.state().items.length>=24);
  const list=page.locator('.pena-native-todo-list');await list.hover();await page.mouse.wheel(0,550);
  await page.waitForFunction(()=>document.querySelector('.pena-native-todo-list').scrollTop>100);
  await page.getByRole('searchbox',{name:'Найти дело',exact:true}).fill('Дополнительное');
  await list.hover();await page.mouse.wheel(0,500);await page.waitForFunction(()=>document.querySelector('.pena-native-todo-list').scrollTop>100);
  for(const zoom of [0.67,0.8,1,1.25,1.5,2]) {
   await page.evaluate(zoom=>document.documentElement.style.zoom=zoom,zoom);
   for(const width of [1100,360]){
    await page.setViewportSize({width,height:850});
    const geometry=await page.locator('.pena-native-todo-row').first().evaluate(row=>{
     const main=row.querySelector('.pena-native-todo-row-main').getBoundingClientRect();
     const check=row.querySelector('.pena-native-todo-check').getBoundingClientRect();
     const box=row.querySelector('.pena-native-todo-check-box').getBoundingClientRect();
     const svg=row.querySelector('.pena-native-todo-check svg').getBoundingClientRect();
     return {main,check,box,svg};
    });
    const center=r=>[r.x+r.width/2,r.y+r.height/2];
    assert.ok(Math.abs(center(geometry.main)[1]-center(geometry.check)[1])<0.6,`row center ${width} zoom ${zoom}`);
    for(const rect of [geometry.box,geometry.svg]) for(let axis=0;axis<2;axis++)assert.ok(Math.abs(center(rect)[axis]-center(geometry.check)[axis])<0.6,`check center ${width} zoom ${zoom}`);
    assert.equal(await page.locator('.pena-native-todo-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,`overflow ${width} zoom ${zoom}`);
   }
  }
  await page.evaluate(()=>document.documentElement.style.zoom='');
  for(const width of [1100,360]){
   await page.setViewportSize({width,height:850});await page.screenshot({path:`tests/artifacts/todo-panel-${width}.png`});
   const rect=await page.locator('.pena-native-todo-panel').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width);
   assert.equal(await page.locator('.pena-native-todo-panel').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
  }
  await page.getByRole('searchbox',{name:'Найти дело',exact:true}).fill('');await page.getByRole('button',{name:'Подготовить презентацию',exact:true}).click();
  await page.locator('.pena-native-todo-edit-title').fill('Не потерять черновик');
  await page.evaluate(()=>{for(let i=0;i<20;i++)todoProbe.sync();});assert.equal(await page.locator('.pena-native-todo-edit-title').inputValue(),'Не потерять черновик');
  await page.locator('.pena-native-todo-edit-title').press('Escape');await page.getByRole('textbox',{name:'Новое дело',exact:true}).press('Escape');
  await page.locator('.pena-native-todo-panel').waitFor({state:'detached'});await page.waitForFunction(()=>document.querySelector('.pena-native-todo-button')===document.activeElement);
 });
 assert.deepEqual(errors,[]);console.log(`PASS todo panel: ${phases.length} phases`);
}finally{writeFileSync('tests/artifacts/todo-panel-report.json',JSON.stringify({phases,errors},null,2));await browser.close();await server.close();}

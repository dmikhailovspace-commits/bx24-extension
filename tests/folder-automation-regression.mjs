import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync} from 'node:fs';
import {startHarnessServer, collectPageErrors} from './lib/harness-server.mjs';
const require=createRequire(import.meta.url);
const model=require('../extension/native-catalog.js');
const condition=(field,op,value)=>({field,op,value});
const rule=(id,conditions,match='all')=>({id,enabled:true,folderId:'folder:test',conditions,match});
const folders=new Set(['folder:test']);
assert.equal(model.automationCondition(condition('title','contains','  Участок  А '),{title:'Ремонт участка / УЧАСТОК   А'},'tasks'),true);
assert.equal(model.automationCondition(condition('responsibleId','eq','2'),{responsibleId:'12'},'tasks'),false);
assert.equal(model.automationCondition(condition('auditors','eq','12'),{auditors:[2,12]},'tasks'),true);
assert.equal(model.automationCondition(condition('responsibleId','neq','2'),{},'tasks'),null);
assert.equal(model.automationCondition(condition('responsibleId','eq','2'),{responsibleId:'2'},'chats'),false);
assert.equal(model.automationCondition(condition('deadline','overdue',''),{deadline:'2020-01-01',status:'5'},'tasks'),false);
assert.equal(model.automationCondition(condition('deadline','overdue',''),{deadline:'2020-01-01',status:'3'},'tasks'),true);
assert.deepEqual(model.taskAutomationFacts({RESPONSIBLE_ID:42,createdBy:'5',ACCOMPLICES:[],DEADLINE:null}),{responsibleId:42,createdBy:'5',accomplices:[],deadline:''});
assert.deepEqual(model.automationDecision([rule('first',[condition('responsibleId','eq','2')]),rule('second',[condition('title','contains','task')])],{title:'task'},'tasks',folders),{pending:true});
for(const [field,value] of [['createdBy','7'],['groupId','9'],['status','3'],['priority','2']]) {
 assert.equal(model.automationCondition(condition(field,'eq',value),{[field]:value},'tasks'),true,field);
 assert.equal(model.automationCondition(condition(field,'neq',value),{[field]:value},'tasks'),false,field);
}
assert.equal(model.automationCondition(condition('accomplices','eq','12'),{accomplices:[{id:'12'}]},'tasks'),true);
assert.equal(model.automationCondition(condition('deadline','before','2027-01-01'),{deadline:'2026-12-01'},'tasks'),true);
assert.equal(model.automationCondition(condition('deadline','empty',''),{deadline:''},'tasks'),true);
assert.equal(model.automationDecision([rule('any',[condition('status','eq','3'),condition('title','contains','test')],'any')],{title:'test'},'tasks',folders).ruleId,'any');
assert.equal(model.automationDecision([rule('first',[condition('responsibleId','eq','2'),condition('title','contains','no')])],{title:'task'},'tasks',folders),null);
assert.equal(model.automationDecision([rule('first',[condition('responsibleId','eq','2'),condition('title','contains','task')],'any')],{title:'task'},'tasks',folders).ruleId,'first');
assert.equal(model.automationDecision([{...rule('missing',[condition('title','contains','task')]),folderId:'deleted'}],{title:'task'},'tasks',folders),null);

const server=await startHarnessServer();
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1100,height:800}});
const errors=collectPageErrors(page);
const items=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')||'[]'));
const open=async()=>{
 await page.locator('.recent-host .pena-native-folder-tab').filter({hasText:'Тестовая папка'}).click({button:'right'});
 await page.getByRole('menuitem',{name:'Автосортировка',exact:true}).click();
 await page.getByRole('dialog',{name:'Автосортировка',exact:true}).waitFor();
};
try {
 await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1`);
 await page.locator('.recent-host .pena-native-folder-switcher').waitFor();
 await open();
 await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
 assert.equal(await page.getByLabel('Поле условия').locator('option').count(),2);
 await page.getByLabel('Значение условия').fill('Чат 5');
 assert.equal(await page.getByLabel('Распределить уже существующие диалоги').isChecked(),false);
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 assert.match(await page.locator('.pena-automation-panel [role=status]').innerText(),/останутся на месте/);
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.locator('.pena-automation-panel').waitFor({state:'detached',timeout:15000});
 await page.waitForTimeout(500);
 assert.ok(!(await items()).find(item=>item.id==='chat5')?.folderId,'Default must leave existing dialogs unchanged');
 assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith('pena.automation.v1.')&&key.endsWith('.chats')))).excludedIds.includes('chat50000')),'Baseline must include old tasks outside the visible DOM');
 await page.evaluate(()=>{
  const list=document.querySelector('.recent-host .bx-im-list-container-recent__elements');
  const row=list.querySelector('[data-id="chat5"]').cloneNode(true);row.dataset.id='chat5999';
  row.querySelector('.bx-im-chat-title__text').textContent='Чат 5999';list.append(row);
 });
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')||'[]').find(item=>item.id==='chat5999')?.folderId==='folder:test',{},{timeout:10000});
 assert.ok(!(await items()).find(item=>item.id==='chat5')?.folderId,'Existing chat remains excluded after a new arrival');
 await open();
 await page.getByLabel('Распределить уже существующие диалоги').check();
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 assert.match(await page.locator('.pena-automation-panel [role=status]').innerText(),/распределены: 1/);
 assert.ok(!(await items()).find(item=>item.id==='chat5')?.folderId,'Preview must not mutate');
 mkdirSync('tests/artifacts',{recursive:true});
 await page.screenshot({path:'tests/artifacts/folder-automation-desktop.png'});
 await page.setViewportSize({width:390,height:780});
 assert.equal(await page.locator('.pena-automation-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:'tests/artifacts/folder-automation-mobile.png'});
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')||'[]').find(item=>item.id==='chat5')?.folderId==='folder:test');
 assert.equal((await items()).find(item=>item.id==='chat225').folderId,'folder:test','Existing assignment preserved');
 await page.setViewportSize({width:1100,height:800});
 await open();
 assert.equal(await page.getByLabel('Значение условия').inputValue(),'Чат 5');
 await page.keyboard.press('Escape');
 // New live dialog is assigned without reopening the editor or the page.
 await page.evaluate(()=>{
  const list=document.querySelector('.recent-host .bx-im-list-container-recent__elements');
  const row=list.querySelector('[data-id="chat5"]').cloneNode(true);row.dataset.id='chat5555';
  row.querySelector('.bx-im-chat-title__text').textContent='Чат 5555';list.append(row);
 });
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')||'[]').find(item=>item.id==='chat5555')?.folderId==='folder:test',{},{timeout:10000});
 const movedChat=page.locator('.recent-host [data-id="chat5"]').first();
 await movedChat.dragTo(page.locator('.recent-host .pena-native-folder-tab').filter({hasText:'Все папки'}));
 await page.waitForFunction(()=>{const item=JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')||'[]').find(item=>item.id==='chat5');return item&&!item.folderId&&item.automationHandled;});
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForTimeout(500);
 assert.equal((await items()).find(item=>item.id==='chat5')?.folderId||'','');
 await page.reload();
 await page.locator('.recent-host .pena-native-folder-switcher').waitFor();
 await open();
 assert.equal(await page.getByLabel('Значение условия').inputValue(),'Чат 5','Rules persist across reload');
 // A stale editor cannot overwrite another tab's saved rules.
 await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('pena.automation.v1.'));localStorage.setItem(key,JSON.stringify({version:1,rules:[]}));});
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 assert.match(await page.locator('.pena-automation-panel [role=status]').innerText(),/другом окне/);
 await page.keyboard.press('Escape');
 await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&passThrough=1`);
 await page.locator('.task-host .pena-native-folder-switcher').waitFor();
 await page.evaluate(()=>{
  const call=window.BX.rest.callMethod;
  window.automationDetailCalls=0;
  window.BX.rest.callMethod=function(method,params,callback){
   if(method==='im.search.user.list'){callback({error:()=>null,data:()=>({'12':{id:'12',name:'Ирина Тестовая',work_position:'Продюсер'}})});return;}
   if(method==='tasks.task.get' && String(params.taskId)==='101'){
    window.automationDetailCalls++;
    setTimeout(()=>callback({error:()=>null,data:()=>({task:{id:'101',responsibleId:'12',createdBy:'7',status:'3',deadline:'2020-01-01'}})}),900);return;
   }
   return call.call(this,method,params,callback);
  };
 });
 await page.locator('.task-host .pena-native-folder-tab').filter({hasText:'Тестовая папка'}).click({button:'right'});
 await page.getByRole('menuitem',{name:'Автосортировка',exact:true}).click();
 await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
 assert.equal(await page.getByLabel('Поле условия').locator('option').count(),9);
 await page.getByLabel('Значение условия').fill('Задача 101');
 await page.getByRole('button',{name:'Добавить условие',exact:true}).click();
 await page.getByLabel('Поле условия').nth(1).selectOption('responsibleId');
 await page.getByLabel('Значение условия').nth(1).fill('Ирина');
 await page.getByRole('button',{name:'Ирина Тестовая · 12',exact:true}).click();
 await page.getByLabel('Распределить уже существующие диалоги').check();
 await page.screenshot({path:'tests/artifacts/folder-automation-tasks.png'});
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.tasks')||'[]').find(item=>item.id==='chat101')?.folderId==='folder:test',{},{timeout:15000});
 assert.ok(await page.evaluate(()=>window.automationDetailCalls>0),'Missing task fields must request detail');
 // Directory fixtures follow the documented ID-keyed response, including paging,
 // duplicate names, empty replies, errors and responses arriving after query changes.
 await page.locator('.task-host .pena-native-rules-button').click();
 assert.equal(await page.locator('.task-host .pena-native-rules-button svg').count(),1);
 await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
 await page.getByLabel('Поле условия').last().selectOption('createdBy');
 await page.evaluate(()=>{
  const original=BX.rest.callMethod;window.directoryRequests=[];window.directoryRetry=0;
  BX.rest.callMethod=function(method,params,callback){
   if(method==='sonet_group.get'){callback({error:()=>null,data:()=>[{ID:'91',NAME:'Проект Альфа'},{ID:'92',NAME:'Проект Бета'}]});return;}
   if(method!=='im.search.user.list')return original.call(this,method,params,callback);
   directoryRequests.push(params);
   const data=params.FIND==='Пусто'?[]:params.FIND==='Новый'?{'23':{id:23,name:'Новый Сотрудник'}}:
    params.OFFSET===20?{'22':{id:22,name:'Анна Тестовая',work_position:'Продюсер'}}:
    {'21':{id:21,name:'Анна Тестовая',work_position:'Дизайнер'},'99':{id:99,name:'Бот',bot:true}};
   setTimeout(()=>callback({error:()=>params.FIND==='Ошибка'&&window.directoryRetry++===0?{error:'NETWORK_ERROR'}:null,
    data:()=>data,answer:{next:params.FIND==='Анна'&&!params.OFFSET?20:null}}),params.FIND==='Старый'?700:20);
  };
 });
 const employee=page.getByLabel('Значение условия').last();
 await employee.fill('А');await page.getByText('Введите хотя бы 2 буквы',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>directoryRequests.length),0);
 await employee.fill('Анна');await page.getByRole('button',{name:'Анна Тестовая · 21'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Бот · 99'}).count(),0);
 await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
 await page.getByRole('button',{name:'Анна Тестовая · 22'}).waitFor();
 await page.screenshot({path:'tests/artifacts/folder-automation-directory.png'});
 await page.getByRole('button',{name:'Анна Тестовая · 22'}).click();
 assert.equal(await employee.inputValue(),'Анна Тестовая');
 await employee.fill('Пусто');await page.getByText('Сотрудники не найдены',{exact:true}).waitFor();
 await employee.fill('Ошибка');await page.getByRole('button',{name:'Повторить',exact:true}).click();
 await page.getByRole('button',{name:'Анна Тестовая · 21'}).waitFor();
 await employee.fill('Старый');await page.waitForFunction(()=>directoryRequests.some(request=>request.FIND==='Старый'));
 await employee.fill('Новый');await page.getByRole('button',{name:'Новый Сотрудник · 23'}).waitFor();
 await page.waitForTimeout(800);
 assert.equal(await page.getByRole('button',{name:'Анна Тестовая · 21'}).count(),0,'Late response cannot replace new results');
 await employee.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await employee.inputValue(),'Новый Сотрудник');
 await page.getByLabel('Поле условия').last().selectOption('groupId');
 await employee.fill('Бета');await page.getByRole('button',{name:'Проект Бета · 92'}).click();
 assert.equal(await employee.inputValue(),'Проект Бета');
 await page.getByRole('button',{name:'Создать папку',exact:true}).click();
 await page.getByLabel('Название папки',{exact:true}).fill('Автоматические');
 await page.getByLabel('Название папки',{exact:true}).press('Enter');
 assert.match(await page.getByLabel('Папка назначения').last().locator('option:checked').innerText(),/Автоматические/);
 await page.getByRole('button',{name:'Поднять правило',exact:true}).last().click();
 assert.equal(await page.getByLabel('Поле условия').first().inputValue(),'groupId');
 await page.getByRole('button',{name:'Опустить правило',exact:true}).first().click();
 for(const width of [1280,768,680,420,360]) {
  await page.setViewportSize({width,height:800});
  const geometry=await page.locator('.pena-automation-panel').evaluate(panel=>({
   overflow:panel.scrollWidth>panel.clientWidth,
   bad:[...panel.querySelectorAll('input,select,button')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().width<15).map(el=>el.outerHTML),
   footer:panel.querySelector('footer').getBoundingClientRect().bottom<=panel.getBoundingClientRect().bottom,
   headerHeight:panel.querySelector('header').getBoundingClientRect().height
  }));
  assert.equal(geometry.overflow,false,JSON.stringify({width,geometry}));assert.deepEqual(geometry.bad,[]);assert.equal(geometry.footer,true);assert.equal(geometry.headerHeight,48);
 }
 await page.setViewportSize({width:1100,height:800});
 await page.getByRole('button',{name:'Удалить правило',exact:true}).last().click();
 assert.equal(await page.locator('.pena-automation-rule').count(),1);
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.locator('.pena-automation-panel').waitFor({state:'detached',timeout:15000});
 assert.deepEqual(errors,[]);
 const {verifyEmployeeSearch}=await import('./lib/employee-search.mjs');
 await verifyEmployeeSearch(browser,readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8'));
 console.log('PASS folder automation: model, editor, preview, persistence, live arrival, concurrency, responsive layout');
} finally {await browser.close();await server.close();}

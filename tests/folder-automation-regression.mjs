import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync} from 'node:fs';
import {startHarnessServer, collectPageErrors} from './lib/harness-server.mjs';
const require=createRequire(import.meta.url);
const model=require('../extension/native-catalog.js');
const condition=(field,op,value)=>({field,op,value});
const rule=(id,conditions,match='all')=>({id,enabled:true,folderId:'folder:test',conditions,match});
const folders=new Set(['folder:test']);
const verifyControlAlignment=async()=>{
 const evidence=await page.locator('.pena-automation-panel').evaluate(panel=>{
  const labels=[...panel.querySelectorAll('button')].filter(button=>button.getClientRects().length&&!button.classList.contains('pena-automation-person-option')).map(button=>{
   const box=button.getBoundingClientRect(),label=button.querySelector('.pena-automation-button-label,svg');
   const range=document.createRange();range.selectNodeContents(button);
   const content=label?label.getBoundingClientRect():range.getBoundingClientRect();
   return {text:button.getAttribute('aria-label')||button.textContent,dx:Math.abs((box.left+box.right-content.left-content.right)/2),dy:Math.abs((box.top+box.bottom-content.top-content.bottom)/2),fits:content.width<=box.width&&content.height<=box.height};
  });
  const selects=[...panel.querySelectorAll('select')].filter(el=>el.getClientRects().length).map(el=>{const css=getComputedStyle(el);return {appearance:css.appearance,padding:parseFloat(css.paddingRight),position:css.backgroundPosition,image:css.backgroundImage};});
  return {labels,selects};
 });
 for(const item of evidence.labels){assert.ok(item.dx<=1&&item.dy<=2&&item.fits,`Button alignment: ${JSON.stringify(item)}`);}
 for(const item of evidence.selects){assert.equal(item.appearance,'none');assert.ok(item.padding>=32&&item.position.includes('12px')&&item.image.includes('svg'),JSON.stringify(item));}
};
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
 await verifyControlAlignment();
 await page.getByLabel('Название правила').fill('Работы по участку А');
 await page.getByLabel('Значение условия').fill('Чат 5');
 const firstRule=page.locator('.pena-automation-rule').first();
 await firstRule.getByRole('button',{name:'Свернуть правило',exact:true}).click();
 assert.equal(await firstRule.locator('.pena-automation-rule-body').isVisible(),false);
 assert.equal(await firstRule.locator('.pena-automation-rule-summary').count(),0,'Collapsed rules do not add a second strip of explanatory text');
 assert.equal(await firstRule.evaluate(card=>{
  const head=card.querySelector('.pena-automation-rule-head');
  return getComputedStyle(card).backgroundColor===getComputedStyle(head).backgroundColor&&Math.abs(card.getBoundingClientRect().height-head.getBoundingClientRect().height-2)<1;
 }),true,'Collapsed card is one continuous surface with no empty strip');
 await firstRule.getByRole('button',{name:'Развернуть правило',exact:true}).press('Enter');
 assert.equal(await firstRule.locator('.pena-automation-rule-body').isVisible(),true);
 assert.equal(await page.getByLabel('Название правила').inputValue(),'Работы по участку А');
 assert.equal(await page.getByLabel('Значение условия').inputValue(),'Чат 5');
 await firstRule.getByRole('button',{name:'Свернуть правило',exact:true}).press('Space');
 await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
 assert.equal(await firstRule.locator('.pena-automation-rule-body').isVisible(),false,'Adding another rule preserves folded state');
 const secondRule=page.locator('.pena-automation-rule').last();
 assert.equal(await secondRule.locator('.pena-automation-rule-body').isVisible(),true,'New rule is expanded');
 await secondRule.getByRole('button',{name:'Свернуть правило',exact:true}).click();
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 assert.equal(await secondRule.locator('.pena-automation-rule-body').isVisible(),true,'Validation reveals an invalid folded rule');
 assert.equal(await secondRule.getByLabel('Значение условия').evaluate(el=>el===document.activeElement),true);
 await secondRule.getByRole('button',{name:'Удалить правило',exact:true}).click();
 await firstRule.getByRole('button',{name:'Развернуть правило',exact:true}).click();
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
 const savedBeforeCollapse=await page.evaluate(()=>localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith('pena.automation.v1.')&&key.endsWith('.chats'))));
 await page.getByRole('button',{name:'Свернуть правило',exact:true}).click();
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await open();
 assert.equal(await page.getByRole('button',{name:'Развернуть правило',exact:true}).count(),1,'Accordion state survives reopening');
 assert.equal(await page.evaluate(()=>localStorage.getItem(Object.keys(localStorage).find(key=>key.startsWith('pena.automation.v1.')&&key.endsWith('.chats')))),savedBeforeCollapse,'Folding does not rewrite active rules');
 await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
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
 await page.evaluate(()=>{const key=Object.keys(localStorage).find(key=>key.startsWith('pena.automation.v1.')&&key.endsWith('.chats'));localStorage.setItem(key,JSON.stringify({version:1,rules:[]}));});
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
 // Existing tasks move only through the confirmation panel after Pull changes.
 const savedConfig=await page.evaluate(()=>{
  const key=Object.keys(localStorage).find(key=>key.startsWith('pena.automation.v1.')&&key.endsWith('.tasks'));
  const original=localStorage.getItem(key),config=JSON.parse(original);
  config.rules.push({...config.rules[0],id:'other-owner',conditions:[{field:'responsibleId',op:'eq',value:'77'}],folderId:'folder:other'});
  const itemKey='pena.dialogControl.v1.tasks',items=JSON.parse(localStorage.getItem(itemKey));
  items.push({id:'folder:other',type:'folder',title:'Новый исполнитель'});
  localStorage.setItem(itemKey,JSON.stringify(items));
  window.dispatchEvent(new StorageEvent('storage',{key:itemKey,newValue:JSON.stringify(items)}));
  localStorage.setItem(key,JSON.stringify(config));window.dispatchEvent(new Event('online'));
  return {key,original};
 });
 await page.waitForTimeout(700);
 const pull=fields=>page.evaluate(fields=>(nativeCustomEventHandlers.get('onPullEvent-tasks')||[]).forEach(fn=>fn('task_update',{TASK_ID:'101',FIELDS_AFTER:{ID:'101',...fields}})),fields);
 const taskFolder=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.tasks')).find(item=>item.id==='chat101').folderId||'');
 await pull({RESPONSIBLE_ID:'77'});
 await page.locator('.task-host .pena-native-rules-button.--pending').waitFor();
 assert.equal(await taskFolder(),'folder:test','A changed responsible must not move an existing task silently');
 await page.locator('.task-host .pena-native-rules-button').click();
 assert.equal(await page.getByRole('tab',{name:'Панель',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('button',{name:'Оставить на месте',exact:true}).click();
 await page.getByText('Нет переносов для подтверждения',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(400);
 assert.equal(await page.locator('.pena-native-rules-button.--pending').count(),0,'Rejected change does not reopen');
 await pull({RESPONSIBLE_ID:'12'});await page.waitForTimeout(500);
 await pull({RESPONSIBLE_ID:'77'});
 await page.locator('.task-host .pena-native-rules-button.--pending').waitFor();
 await page.locator('.task-host .pena-native-rules-button').click();
 await page.screenshot({path:'tests/artifacts/folder-confirmations-desktop.png'});
 await page.setViewportSize({width:360,height:780});
 assert.equal(await page.locator('.pena-automation-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:'tests/artifacts/folder-confirmations-mobile.png'});
 await page.getByRole('button',{name:'Подтвердить перенос',exact:true}).click();
 assert.equal(await taskFolder(),'folder:other');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await pull({RESPONSIBLE_ID:'12',TITLE:'Переименованная задача'});
 await page.locator('.task-host .pena-native-rules-button.--pending').waitFor();
 assert.equal(await taskFolder(),'folder:other','Title no longer matching proposes removal without moving');
 await pull({RESPONSIBLE_ID:'77'});
 await page.waitForTimeout(500);
 assert.equal(await page.locator('.pena-native-rules-button.--pending').count(),0,'Returning to current destination cancels stale ticket');
 await page.evaluate(()=>{
  const key='pena.dialogControl.v1.tasks',items=JSON.parse(localStorage.getItem(key));
  items.find(item=>item.id==='chat101').segmentId='segment:keep';
  items.find(item=>item.id==='folder:other').segmentId='segment:keep';
  localStorage.setItem(key,JSON.stringify(items));
  window.dispatchEvent(new StorageEvent('storage',{key,newValue:JSON.stringify(items)}));
 });
 await pull({RESPONSIBLE_ID:'12'});
 await page.locator('.task-host .pena-native-rules-button.--pending').waitFor();
 await page.locator('.task-host .pena-native-rules-button').click();
 await page.getByRole('button',{name:'Подтвердить перенос',exact:true}).click();
 assert.equal(await taskFolder(),'');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.tasks')).find(item=>item.id==='chat101').segmentId),'segment:keep','Confirming removal from a folder preserves the dialog group');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.setViewportSize({width:1100,height:800});
 await page.evaluate(({key,original})=>{localStorage.setItem(key,original);localStorage.removeItem(key+'.review');window.dispatchEvent(new Event('online'));},savedConfig);
 await page.waitForTimeout(500);
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
 await employee.fill('Анна');await page.getByRole('button',{name:'Анна Тестовая · 21'}).waitFor();
 await employee.press('ArrowDown');await page.keyboard.press('Escape');
 assert.equal(await employee.evaluate(el=>el===document.activeElement),true,'Escape returns focus from results to the input');
 assert.equal(await page.locator('.pena-automation-results:visible').count(),0);
 assert.equal(await page.locator('.pena-automation-panel').count(),1,'Escape dismisses results before the editor');
 await page.evaluate(()=>window.directoryRequests=[]);
 await employee.fill('Старый');await page.waitForFunction(()=>directoryRequests.some(request=>request.FIND==='Старый'));
 await page.getByRole('button',{name:'Свернуть правило',exact:true}).last().click();
 await page.waitForTimeout(800);
 await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 assert.equal(await page.locator('.pena-automation-results:visible').count(),0,'Late results stay dismissed after collapsing and reopening');
 assert.equal(await employee.inputValue(),'Старый');
 await page.getByLabel('Поле условия').last().focus();
 await page.getByLabel('Поле условия').last().selectOption('groupId');
 assert.equal(await page.getByLabel('Поле условия').last().evaluate(el=>el===document.activeElement),true,'Field replacement preserves keyboard focus');
 await employee.fill('Бета');await page.getByRole('button',{name:'Проект Бета · 92'}).click();
 assert.equal(await employee.inputValue(),'Проект Бета');
 await page.getByRole('button',{name:'Создать папку',exact:true}).click();
 await page.getByLabel('Название папки',{exact:true}).fill('Автоматические');
 await page.getByLabel('Название папки',{exact:true}).press('Enter');
 assert.match(await page.getByLabel('Папка назначения').last().locator('option:checked').innerText(),/Автоматические/);
 await page.getByRole('button',{name:'Поднять правило',exact:true}).last().click();
 assert.equal(await page.getByLabel('Поле условия').first().inputValue(),'groupId');
 await page.getByRole('button',{name:'Опустить правило',exact:true}).first().click();
 await page.getByRole('button',{name:'Свернуть правило',exact:true}).first().click();
 await page.getByRole('button',{name:'Поднять правило',exact:true}).last().click();
 assert.equal(await page.locator('.pena-automation-rule').last().locator('.pena-automation-rule-body').isVisible(),false,'Folded state follows the rule when reordered');
 await page.getByRole('button',{name:'Опустить правило',exact:true}).first().click();
 await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 await page.addStyleTag({content:'button{line-height:48px;text-indent:14px;letter-spacing:3px;text-transform:uppercase}'});
 for(const width of [1280,768,680,420,360,320]) {
  await page.setViewportSize({width,height:800});
  await verifyControlAlignment();
  const geometry=await page.locator('.pena-automation-panel').evaluate(panel=>({
   overflow:panel.scrollWidth>panel.clientWidth,
   bad:[...panel.querySelectorAll('input,select,button')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().width<15).map(el=>el.outerHTML),
   footer:panel.querySelector('footer').getBoundingClientRect().bottom<=panel.getBoundingClientRect().bottom,
   headerHeight:panel.querySelector('header').getBoundingClientRect().height,
   scrollPadding:parseFloat(getComputedStyle(panel.querySelector('.pena-automation-scroll')).paddingLeft),
   bottomPadding:parseFloat(getComputedStyle(panel.querySelector('.pena-automation-bottom')).paddingLeft),
   cards:[...panel.querySelectorAll('.pena-automation-rule')].map(card=>({overflow:card.scrollWidth>card.clientWidth,headPadding:parseFloat(getComputedStyle(card.querySelector('.pena-automation-rule-head')).paddingTop),background:getComputedStyle(card).backgroundColor,headBackground:getComputedStyle(card.querySelector('.pena-automation-rule-head')).backgroundColor}))
  }));
  assert.equal(geometry.overflow,false,JSON.stringify({width,geometry}));assert.deepEqual(geometry.bad,[]);assert.equal(geometry.footer,true);assert.equal(geometry.headerHeight,48);
  assert.ok(geometry.scrollPadding>=16&&geometry.bottomPadding>=16,'Panel content has consistent outer spacing');
  for(const card of geometry.cards){assert.equal(card.overflow,false);assert.ok(card.headPadding>=12);assert.equal(card.background,card.headBackground);}
 }
 await page.setViewportSize({width:1100,height:800});
 await page.getByRole('button',{name:'Свернуть правило',exact:true}).first().click();
 await page.screenshot({path:'tests/artifacts/folder-automation-accordion.png'});
 await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 await page.getByRole('button',{name:'Удалить правило',exact:true}).last().click();
 assert.equal(await page.locator('.pena-automation-rule').count(),1);
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.locator('.pena-automation-panel').waitFor({state:'detached',timeout:15000});
 await page.locator('.task-host .pena-native-rules-button').click();
 await page.getByLabel('Значение условия').last().fill('Быстрый');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>directoryRequests.some(request=>request.FIND==='Быстрый')),false,'Closing cancels pending debounce requests');
 assert.deepEqual(errors,[]);
 const {verifyEmployeeSearch}=await import('./lib/employee-search.mjs');
 await verifyEmployeeSearch(browser,readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8'));
 console.log('PASS folder automation: model, editor, preview, persistence, live arrival, concurrency, responsive layout');
} finally {await browser.close();await server.close();}

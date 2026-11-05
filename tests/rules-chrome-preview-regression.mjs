import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildChrome} from '../tools/build-chrome.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
mkdirSync('tests/artifacts',{recursive:true});
const dir=mkdtempSync(resolve('tests/artifacts/rules-mv3-'));
const build=buildChrome(dir), origin='https://rules.chrome.test';
const granted=join(dir,'granted-fixture');cpSync(build.unpacked,granted,{recursive:true});
const manifest=JSON.parse(readFileSync(join(granted,'manifest.json')));
manifest.host_permissions=[origin+'/*'];writeFileSync(join(granted,'manifest.json'),JSON.stringify(manifest));
const profile=mkdtempSync(join(tmpdir(),'bx24-rules-preview-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1100,height:800},args:[`--disable-extensions-except=${granted}`,`--load-extension=${granted}`]});
const errors=[],phases=[];let page;
try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const id=new URL(worker.url()).host;
 const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
 assert.equal((await popup.evaluate(()=>chrome.runtime.sendMessage({channel:'pena.chrome.portal.v1',action:'sync'}))).ok,true);await popup.close();
 let fixture=readFileSync('tests/native-consistency-harness.html','utf8').replace(/<link[^>]+injected\.css[^>]*>/g,'').replace(/<script src="\.\.\/extension\/[^>]+><\/script>/g,'');
 await context.route('https://**/*',route=>route.fulfill({contentType:'text/html',body:fixture}));
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/online/?mode=chats&nativeCatalog=1&passThrough=1');
 await page.locator('.recent-host .pena-native-rules-button').waitFor();
 const open=async()=>{await page.locator('.recent-host .pena-native-rules-button').click();await page.getByRole('tab',{name:'Правила',exact:true}).click();};
 await open();await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
 await page.getByLabel('Название правила').fill('Название и тип');
 await page.getByLabel('Значение условия').fill('Чат 225');
 await page.getByLabel('Папка назначения').selectOption('folder:test');
 await page.getByRole('button',{name:'Добавить условие',exact:true}).click();
 await page.getByLabel('Поле условия').nth(1).selectOption('kind');
 await page.getByLabel('Значение условия').nth(1).selectOption('group');
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 assert.match(await page.locator('.pena-automation-status').innerText(),/Совпадений: 1/,'Preview includes a matching dialog already in a folder');
 const items=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')));
 assert.equal((await items()).find(x=>x.id==='chat225').folderId,'folder:test');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.locator('.pena-automation-panel').waitFor({state:'detached'});
 await open();
 assert.equal(await page.locator('.pena-automation-rule-body:visible').count(),0,'Saved rules start collapsed on opening');
 await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await open();
 assert.equal(await page.locator('.pena-automation-rule-body:visible').count(),0,'Expanded state does not leak into another opening');
 await page.screenshot({path:'tests/artifacts/rules-preview-collapsed.png'});
 phases.push('actual MV3: title + kind, matches include assigned dialogs, save, collapsed on every opening');
 await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 const title=page.getByLabel('Значение условия').first();
 // Both matching and nonmatching cases use the editor and actual packaged model.
 for(const [op,value,count] of [['eq','Чат 225',1],['neq','Чат 225',null],['contains','Чат 225',1],['notContains','Чат 225',null],['starts','Чат 225',1],['ends','225',1]]) {
  await page.getByLabel('Оператор').first().selectOption(op);await title.fill(value);
  await page.getByRole('button',{name:'Проверить',exact:true}).click();
  const text=await page.locator('.pena-automation-status').innerText(),number=Number(text.match(/Совпадений: (\d+)/)?.[1]);
  if(count!==null)assert.equal(number,count,op);else assert.ok(number>1,op);
 }
 await page.getByLabel('Оператор').first().selectOption('eq');await title.fill('не существует');
 await page.getByRole('button',{name:'Проверить',exact:true}).click();assert.match(await page.locator('.pena-automation-status').innerText(),/Совпадений: 0/);
 await page.getByLabel('Совпадение условий').selectOption('any');
 await page.getByRole('button',{name:'Проверить',exact:true}).click();assert.ok(Number((await page.locator('.pena-automation-status').innerText()).match(/Совпадений: (\d+)/)?.[1])>1);
 phases.push('editor: six text operators and all/any');
 await title.fill('');await page.getByRole('button',{name:'Свернуть правило',exact:true}).click();
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 assert.equal(await page.locator('.pena-automation-rule-body:visible').count(),1,'Validation expands only the invalid rule');
 assert.equal(await title.getAttribute('aria-invalid'),'true');
 await page.setViewportSize({width:360,height:780});
 assert.equal(await page.locator('.pena-automation-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:'tests/artifacts/rules-preview-narrow-error.png'});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.reload();
 await page.locator('.recent-host .pena-native-rules-button').waitFor();await open();
 assert.equal(await page.locator('.pena-automation-rule-body:visible').count(),0);
 await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 assert.equal(await title.inputValue(),'Чат 225','Closing an invalid draft does not overwrite saved rules');
 phases.push('validation opens error, narrow layout, reload persists saved rules but not expansion');
 await page.getByLabel('Оператор').first().selectOption('eq');await title.fill('Личный тест');
 await page.getByLabel('Значение условия').nth(1).selectOption('personal');
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('.pena-automation-panel').waitFor({state:'detached'});
 await page.evaluate(()=>{
  const list=document.querySelector('.recent-host .bx-im-list-container-recent__elements');
  const row=list.querySelector('[data-id="chat5"]').cloneNode(true);row.dataset.id='user909090';row.querySelector('.bx-im-chat-title__text').textContent='Личный тест';list.append(row);
 });
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')).find(x=>x.id==='user909090')?.folderId==='folder:test');
 await page.evaluate(()=>document.querySelector('.recent-host [data-id="user909090"] .bx-im-chat-title__text').textContent='Новое название');
 await page.locator('.recent-host .pena-native-rules-button.--pending').waitFor({timeout:8000}).catch(async error=>{
  console.log(await page.evaluate(()=>({dom:document.querySelector('.recent-host [data-id="user909090"]')?.textContent,item:JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')).find(x=>x.id==='user909090'),reviews:Object.fromEntries(Object.keys(localStorage).filter(k=>k.endsWith('.chats.review')).map(k=>[k,JSON.parse(localStorage.getItem(k)).records?.user909090]))})));throw error;
 });
 assert.equal((await items()).find(x=>x.id==='user909090').folderId,'folder:test','Rename only proposes removing a previously sorted personal dialog');
 await page.locator('.recent-host .pena-native-rules-button').click();
 const ticket=page.locator('.pena-automation-ticket').filter({hasText:'Новое название'});
 await ticket.getByRole('button',{name:'Подтвердить перенос',exact:true}).click();
 assert.equal((await items()).find(x=>x.id==='user909090').folderId,'','Explicit confirmation applies the renamed-dialog proposal');
 phases.push('actual MV3: new personal dialog auto-sorts, live rename proposes removal, only confirmation moves');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.setViewportSize({width:1100,height:800});
 await page.goto(origin+'/online/?mode=tasks&nativeCatalog=1&passThrough=1');
 await page.locator('.task-host .pena-native-rules-button').waitFor();
 await page.evaluate(()=>{
  const call=BX.rest.callMethod;window.previewDetailReads=0;
  BX.rest.callMethod=function(method,params,callback){
   if(method==='tasks.task.get'&&String(params.taskId)==='101'){
    previewDetailReads++;callback({error:()=>null,data:()=>({task:{id:'101',title:'Задача 101',responsibleId:'12',createdBy:'7',accomplices:['13'],auditors:['14'],groupId:'1',status:'3',priority:'2',deadline:'2030-01-01T10:00:00+03:00'}})});return;
   }
   return call.call(this,method,params,callback);
  };
 });
 await page.locator('.task-host .pena-native-rules-button').click();await page.getByRole('tab',{name:'Правила',exact:true}).click();
 await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
 await page.getByLabel('Значение условия').fill('Задача 101');await page.getByLabel('Оператор').selectOption('eq');
 await page.getByLabel('Папка назначения').selectOption('folder:test');
 for(const [field,value] of [['responsibleId','12'],['createdBy','7'],['accomplices','13'],['auditors','14'],['groupId','1'],['status','3'],['priority','2'],['deadline','']]) {
  const previousFields=await page.getByLabel('Поле условия').evaluateAll(elements=>elements.map(el=>el.value));
  await page.getByRole('button',{name:'Добавить условие',exact:true}).click();
  assert.equal(await page.getByLabel('Поле условия').count(),previousFields.length+1,'Adding '+field);
  const row=page.locator('.pena-automation-condition').last();await row.getByLabel('Поле условия').selectOption(field);
  if(field==='deadline')await row.getByLabel('Оператор').selectOption('present');
  else if(['status','priority'].includes(field))await row.getByLabel('Значение условия').selectOption(value);
  else await row.getByLabel('Значение условия').fill(value);
  assert.deepEqual(await page.getByLabel('Поле условия').evaluateAll(elements=>elements.map(el=>el.value)),[...previousFields,field],'Editing '+field+' preserves earlier conditions');
 }
 assert.deepEqual(await page.getByLabel('Поле условия').evaluateAll(elements=>elements.map(el=>el.value)),['title','responsibleId','createdBy','accomplices','auditors','groupId','status','priority','deadline']);
 const before=await page.evaluate(()=>localStorage.getItem('pena.dialogControl.v1.tasks'));
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.pena-automation-status')?.textContent.includes('Совпадений:'));
 assert.match(await page.locator('.pena-automation-status').innerText(),/Совпадений: 1/,'Unsaved task-rule preview resolves required facts');
 assert.ok(await page.evaluate(()=>previewDetailReads)>0,'Preview reads missing task facts without requiring save');
 assert.equal(await page.evaluate(()=>localStorage.getItem('pena.dialogControl.v1.tasks')),before,'Preview does not move tasks');
 await page.screenshot({path:'tests/artifacts/rules-preview-task-all-fields.png'});
 phases.push('actual MV3: all nine task fields in one rule, missing facts resolved before saving, read-only preview');
 assert.deepEqual(errors,[]);
} finally {
 await context.close();
 if(profile.startsWith(join(tmpdir(),'bx24-rules-preview-')))rmSync(profile,{recursive:true,force:true});
 writeFileSync('tests/artifacts/rules-chrome-preview.json',JSON.stringify({phases,errors,version:build.version,packageSha256:build.sha256,livePortal:false,nativePermissionPrompt:false},null,2));
}
console.log(`PASS Chrome rules preview: ${phases.length} phases`);

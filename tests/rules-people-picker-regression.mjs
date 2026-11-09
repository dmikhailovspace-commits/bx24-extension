import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync('extension/injected.js','utf8').replace('\tasync function boot() {',`\tasync function boot() {
 window.peopleTest={open:_openDialogAutomation,key:_dialogAutomationKey,snapshot:_sortingTransferSnapshot,transfer:_openSortingTransfer};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),phases=[],errors=[];
const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));
const rule=(value,label)=>({id:'people-rule',name:'Исполнитель',enabled:true,folderId:'folder:test',match:'all',conditions:[{field:'responsibleId',op:'eq',value,...(label?{label}:{})}]});
async function openStored(value,label){
 await page.evaluate(rule=>{localStorage.setItem(peopleTest.key('tasks'),JSON.stringify({version:1,rules:[rule],excludedIds:[]}));peopleTest.open();},rule(value,label));
 await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
}
const input=()=>page.getByLabel('Значение условия').last();
const close=()=>page.getByRole('button',{name:'Закрыть',exact:true}).click();
try{
 await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'text/javascript',body:source}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&passThrough=1');
 await page.locator('.task-host .pena-native-rules-button').waitFor();
 await page.evaluate(()=>{
  window.peopleCalls=[];window.peopleHeld={};window.holdPerson=false;window.failPerson=false;window.personCalls=[];window.personDelivered=[];
  const original=BX.rest.callMethod;BX.rest.callMethod=function(method,params,callback){
   if(method==='im.search.user.list'){
    peopleCalls.push({...params});const query=params.FIND;
    const respond=()=>callback({error:()=>null,data:()=>query==='Пусто'?[]:{'42':{id:42,name:query==='Старый'?'Старое имя':'Анна Тестовая'}}});
    if(query==='Старый')peopleHeld.search=respond;else setTimeout(respond,40);return;
   }
   if(method==='im.user.get'&&['42','43'].includes(String(params.ID))){
    personCalls.push(String(params.ID));const failed=failPerson;const respond=()=>{personDelivered.push({id:String(params.ID),failed});callback({error:()=>failed?{error:'ACCESS_DENIED'}:null,data:()=>({id:String(params.ID),name:'Имя из портала '+params.ID})});};
    if(holdPerson)peopleHeld.person=respond;else setTimeout(respond,30);return;
   }
   return original.call(this,method,params,callback);
  };
 });
 await page.evaluate(()=>peopleTest.open());await page.getByRole('button',{name:'Добавить правило',exact:true}).click();
 await page.getByLabel('Поле условия').selectOption('responsibleId');
 await input().pressSequentially('А');await page.getByText('Введите хотя бы 2 буквы',{exact:true}).waitFor();
 await input().pressSequentially('н');
 assert.equal(await page.getByText('Введите хотя бы 2 буквы',{exact:true}).isVisible(),false,'Second typed letter removes the minimum-length hint immediately, before debounce');
 await page.getByRole('button',{name:'Анна Тестовая · 42',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>peopleCalls.at(-1).FIND),'Ан');
 for(const query of ['李雷','𐐀𐐁','E\u0301a']){
  await input().fill(query);await page.getByRole('button',{name:'Анна Тестовая · 42',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>peopleCalls.at(-1).FIND),query.normalize('NFC'));
 }
 const before=await page.evaluate(()=>peopleCalls.length);await input().fill('E\u0301');
 await page.getByText('Введите хотя бы 2 буквы',{exact:true}).waitFor();await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>peopleCalls.length),before,'A combining accent is not counted as a second letter');
 const beforeComposition=await page.evaluate(()=>peopleCalls.length);
 await input().evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='李雷';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,inputType:'insertCompositionText',data:'李雷'}));});
 await page.waitForTimeout(350);assert.equal(await page.evaluate(()=>peopleCalls.length),beforeComposition,'Composing text does not send a partial search');
 await input().evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:el.value})));
 await page.getByRole('button',{name:'Анна Тестовая · 42',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>peopleCalls.at(-1).FIND),'李雷');

 await input().fill('Пусто');await page.getByText('Сотрудники не найдены',{exact:true}).waitFor();
 await input().fill('Старый');await page.waitForFunction(()=>!!peopleHeld.search);
 await input().fill('Ан');await page.getByRole('button',{name:'Анна Тестовая · 42',exact:true}).waitFor();
 await page.evaluate(()=>peopleHeld.search());await page.waitForTimeout(80);
 assert.equal(await page.getByRole('button',{name:'Старое имя · 42',exact:true}).count(),0,'Late results cannot replace a newer query');
 await page.getByRole('button',{name:'Анна Тестовая · 42',exact:true}).click();
 await page.getByLabel('Оператор').selectOption('neq');assert.equal(await input().inputValue(),'Анна Тестовая','Selected name survives draft redraw');
 phases.push('Two-letter typing, Unicode normalization, empty and stale results, selected redraw');await close();
 // An actual portable import must preserve the ID and presentation label.
 const imported=await page.evaluate(rule=>{const snapshot=peopleTest.snapshot();snapshot.modes.tasks.automation.rules=[rule];return JSON.stringify(snapshot);},rule({ID:'00042'},'Анна из файла'));
 await page.evaluate(()=>peopleTest.transfer());
 await page.getByText('Вставить код вместо файла',{exact:true}).click();await page.getByLabel('Код импорта').fill(imported);
 await page.getByRole('button',{name:'Проверить код',exact:true}).click();await page.getByRole('status').filter({hasText:'Папок:'}).waitFor();
 await page.getByRole('button',{name:'Подтвердить импорт',exact:true}).click();await page.getByRole('status').filter({hasText:'Настройки перенесены'}).waitFor();await close();
 await page.evaluate(()=>peopleTest.open());await page.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 assert.equal(await input().inputValue(),'Анна из файла');
 const importedCondition=await page.evaluate(()=>peopleTest.snapshot().modes.tasks.automation.rules[0].conditions[0]);
 assert.equal(importedCondition.value,'42');assert.equal(importedCondition.label,'Анна из файла');await close();
 phases.push('Actual transfer import keeps canonical user ID and selected display name');
 await openStored('00042');await page.waitForFunction(()=>document.querySelector('.pena-automation-person input')?.value==='Имя из портала 42');
 assert.equal(await page.evaluate(()=>personCalls.at(-1)),'42');await page.getByLabel('Оператор').selectOption('neq');assert.equal(await input().inputValue(),'Имя из портала 42');await close();
 phases.push('Legacy ID-only selections hydrate canonical ID and retain the label on redraw');
 await page.evaluate(()=>{holdPerson=true;peopleHeld={};});await openStored('43');await page.waitForFunction(()=>!!peopleHeld.person);
 await input().fill('Ан');await page.evaluate(()=>peopleHeld.person());await page.getByRole('button',{name:'Анна Тестовая · 42',exact:true}).waitFor();
 assert.equal(await input().inputValue(),'Ан','Late name hydration cannot overwrite an edited query');await close();
 await page.evaluate(()=>{holdPerson=false;failPerson=true;});await openStored('43');await page.waitForFunction(()=>personDelivered.at(-1)?.failed===true);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await input().inputValue(),'43','Unavailable user keeps its ID instead of inventing a selected name');
 await page.evaluate(()=>failPerson=false);await input().focus();await page.waitForFunction(()=>document.querySelector('.pena-automation-person input')?.value==='Имя из портала 43');await close();
 phases.push('Edited hydration is discarded and failed lookups retry on focus');
 assert.deepEqual(errors,[]);mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/rules-people-picker.json',JSON.stringify({fixture:true,realPortal:false,phases},null,2));
 console.log('PASS rules people picker: '+phases.join('; '));
}finally{await browser.close();await server.close();}

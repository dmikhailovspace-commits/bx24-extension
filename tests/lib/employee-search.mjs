import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

export async function verifyEmployeeSearchIntegration(page, base) {
 await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1`);
 await page.locator('.pena-native-folder-switcher').waitFor({state:'visible'});
 await page.waitForFunction(()=>window.__PENA_NATIVE_PREFETCH__?.status?.().freshModes?.includes('chats'));
 await page.evaluate(()=>{
  const original=BX.rest.callMethod;
  window.employeeDirectoryCalls=[];window.employeeOpened=[];
  BX.rest.callMethod=function(method,params,callback){
   if(method!=='im.search.user.list')return original.call(this,method,params,callback);
   employeeDirectoryCalls.push(params);
   setTimeout(()=>callback({error:()=>null,data:()=>[{id:987654,name:'Мария Новая',work_position:'Дизайнер'}]}),60);
  };
  window.BX24={im:{openMessenger(id){employeeOpened.push(id);return true}}};
 });
 const input=page.locator('.bx-im-list-container-recent__header_container input').first();
 await input.fill('Мария');
 const person=page.locator('[data-employee-id="987654"]');await person.waitFor({state:'visible'});
 await person.click();
 assert.deepEqual(await page.evaluate(()=>employeeOpened),['987654']);
 await page.waitForTimeout(800);
 const state=await page.evaluate(()=>({
  calls:employeeDirectoryCalls.length,
  panels:document.querySelectorAll('.pena-employee-search').length,
  outside:!document.querySelector('.pena-employee-search').closest('.pena-native-managed-list,.bx-im-list-recent__container'),
  stored:JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')||'[]').some(item=>String(item.id).includes('987654')),
  viewport:document.querySelector('.pena-native-list-scroll-viewport').getBoundingClientRect().height,
  contained:document.querySelector('.pena-native-list-scroll-viewport').getBoundingClientRect().bottom<=document.querySelector('.pena-native-folder-switcher-host').getBoundingClientRect().bottom+1
 }));
 assert.equal(state.calls,1,'Reconciliation must not repeatedly search');assert.equal(state.panels,1);
 assert.equal(state.outside,true);assert.equal(state.stored,false,'Directory search never changes persistent dialog catalog');assert.ok(state.viewport>80,JSON.stringify(state));assert.equal(state.contained,true,'Native list must stay within the bounded host');
 await page.screenshot({path:'tests/artifacts/employee-search804.png'});
 await input.fill('');await page.waitForFunction(()=>!document.querySelector('.pena-employee-search'));
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.pena-native-chat-row')).filter(row=>getComputedStyle(row).display!=='none').length>1);
}

export async function verifyEmployeeSearch(browser, source) {
 const extract=name=>{const start=source.search(new RegExp('\\t(?:async )?function '+name+'\\('));assert.ok(start>=0,name);const next=/\n\t(?:async )?function /.exec(source.slice(start+1));return source.slice(start,next?start+1+next.index:undefined)};
 const page=await browser.newPage();
 try {
  await page.setContent('<main style="display:flex;flex-direction:column;width:340px;height:600px"><header class="bx-im-list-container-recent__header_container"><input type="search"></header><div class="pena-native-folder-switcher"></div><div id="native-list"><div data-id="user1">Старый диалог</div></div></main>');
  await page.addStyleTag({content:readFileSync(new URL('../../extension/injected.css',import.meta.url),'utf8')});
  await page.addScriptTag({content:`let _penaEmployeeSearch=null;const IS_OL_FRAME=false,filters={query:''};window.mode='chats';window.scope='portal~7';window.calls=[];window.pending=[];window.opened=[];
   const _dialogControlNativeSwitcherNode=document.querySelector('.pena-native-folder-switcher');function findContainer(){return document.getElementById('native-list')}
   function _isDialogNativeLazyMode(){return false} function _pMode(){return window.mode} function _getDialogNativeSharedAuditScopeKey(){return window.scope} function _getBitrixListSearchInput(){return document.querySelector('input')}
   function _callBxRestReadPage(method,params,options){calls.push({method,params});return new Promise((resolve,reject)=>pending.push({resolve,reject,options}))}
   async function _openDialogControlViaBitrixApi(item){opened.push(item);return true}
   ${['_syncPenaEmployeeSearch','_isPenaEmployeeSearchCurrent','_loadPenaEmployeeSearch','_renderPenaEmployeeSearch'].map(extract).join('\n')}
   window.search=q=>{filters.query=q;_syncPenaEmployeeSearch()};window.answer=(i,data,next=null)=>pending[i].resolve({data,next});window.refresh=_syncPenaEmployeeSearch;
  `});
  await page.evaluate(()=>{search('');search('А')});await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>calls.length),0,'No startup or one-letter requests');
  await page.evaluate(()=>{search('Мар');search('Мария')});await page.waitForFunction(()=>calls.length===1);
  assert.deepEqual(await page.evaluate(()=>calls[0]),{method:'im.search.user.list',params:{FIND:'Мария',OFFSET:0,LIMIT:20}});
  await page.evaluate(()=>answer(0,[{id:907,name:'Мария Новая',work_position:'Дизайнер',avatar:'javascript:alert(1)'},{id:0,name:'bad'},{id:908,name:'bot',bot:true}],20));
  await page.locator('[data-employee-id="907"]').waitFor();
  assert.equal(await page.locator('.pena-employee-search-person').count(),1);
  assert.equal(await page.locator('.pena-employee-search img').count(),0);
  await page.locator('[data-employee-id="907"]').click();
  assert.deepEqual(await page.evaluate(()=>opened),[{id:'user907',dialogId:'907'}]);
  assert.equal(await page.locator('#native-list').innerText(),'Старый диалог','Search must not synthesize native catalog rows');
  await page.getByRole('button',{name:'Показать ещё'}).click();await page.waitForFunction(()=>calls.length===2);
  assert.equal(await page.evaluate(()=>calls[1].params.OFFSET),20);
  await page.evaluate(()=>answer(1,[{id:907,name:'Мария Новая'},{id:909,name:'<img onerror=alert(1)>',avatar:null}],null));
  await page.locator('[data-employee-id="909"]').waitFor();
  assert.equal(await page.locator('.pena-employee-search-person').count(),2);
  assert.equal(await page.locator('.pena-employee-search img').count(),0,'Employee names are text');
  await page.evaluate(()=>search('Старый'));await page.waitForFunction(()=>calls.length===3);
  await page.evaluate(()=>search('Новый'));await page.waitForFunction(()=>calls.length===4);
  await page.evaluate(()=>{answer(3,[{id:911,name:'Новый'}]);answer(2,[{id:910,name:'Старый'}])});
  await page.locator('[data-employee-id="911"]').waitFor();assert.equal(await page.locator('[data-employee-id="910"]').count(),0,'Late response discarded');
  await page.evaluate(()=>search('Ошибка'));await page.waitForFunction(()=>calls.length===5);
  await page.evaluate(()=>pending[4].reject(new Error('offline')));await page.getByRole('button',{name:'Повторить'}).click();await page.waitForFunction(()=>calls.length===6);
  await page.evaluate(()=>answer(5,[]));await page.getByText('Сотрудники не найдены').waitFor();
  await page.evaluate(()=>{search('Смена');});await page.waitForFunction(()=>calls.length===7);
  await page.evaluate(()=>{scope='portal~8';refresh();answer(6,[{id:912,name:'Old account'}])});await page.waitForFunction(()=>calls.length===8);
  assert.equal(await page.locator('[data-employee-id="912"]').count(),0);
  await page.evaluate(()=>{mode='tasks';refresh();answer(7,[{id:913,name:'Late'}])});await page.waitForTimeout(50);assert.equal(await page.locator('.pena-employee-search').count(),0);
  await page.evaluate(()=>{mode='chats';search('Очистить')});await page.waitForFunction(()=>calls.length===9);
  await page.evaluate(()=>{search('');answer(8,[{id:914,name:'Cleared'}])});await page.waitForTimeout(50);assert.equal(await page.locator('.pena-employee-search').count(),0);
  assert.equal(await page.locator('#native-list [data-id]').count(),1);
  return {requests:9,unknownEmployeeOpened:true,pagination:true,staleQueryAndIdentityDiscarded:true,nativeListPreserved:true};
 } finally {await page.close()}
}

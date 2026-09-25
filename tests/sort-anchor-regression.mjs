import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const probe=source.replace('\tasync function boot() {', `\tasync function boot() {
window.orderAudit={prefs:_getDialogControlViewPrefs,folder:_setDialogControlNativeActiveFolderId,items:_getDialogControlItems,save:_saveDialogControlItems,color:_setDialogControlItemColor,paint:_applyDialogControlNativeView,clear:_clearDialogControlNativeView,query:q=>{filters.query=q;_applyDialogControlNativeView();}};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),report={phases:[]};
try {for(const mode of ['chats','tasks']) {
 const page=await browser.newPage(),errors=collectPageErrors(page);
 try {
  await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:probe}));
  await page.route('**/tests/native-consistency-harness.html?*',async route=>{
   const response=await route.fetch();const html=(await response.text()).replace('localStorage.setItem(`pena.dialogControlView.${storageMode}`, JSON.stringify({ sortMode:', 'if(!localStorage.getItem(`pena.dialogControlView.${storageMode}`)) localStorage.setItem(`pena.dialogControlView.${storageMode}`, JSON.stringify({ sortMode:');await route.fulfill({response,body:html});
  });
  await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=${mode}&lazyNative=1&nativeCatalog=1&nativeFirst=1&passThrough=1&eager=0&catalogRows=20`);
  const host=page.locator('.test-host:not([hidden])'),rows=host.locator('.bx-im-list-recent-item__wrap'),row=id=>host.locator(`[data-id="${id}"]`);
  await page.locator('.pena-native-folder-switcher').waitFor();await page.waitForFunction(()=>window.__PENA_RECENT_SYNC__?.gateReady);
  const ids=()=>rows.evaluateAll(rows=>rows.map(row=>row.dataset.id));
  const visual=()=>rows.evaluateAll(rows=>rows.filter(r=>r.getClientRects().length&&getComputedStyle(r).display!=='none').map(r=>({id:r.dataset.id,y:r.getBoundingClientRect().top})).sort((a,b)=>a.y-b.y).map(r=>r.id));
  await page.evaluate(()=>{
   window.originalOrderRows=[...document.querySelectorAll('.test-host:not([hidden]) .bx-im-list-recent-item__wrap')];window.originalAvatars=originalOrderRows.map(r=>r.querySelector('.test-avatar'));
   const parent=originalOrderRows[0].parentElement,pinned=document.createElement('div'),general=document.createElement('div');pinned.className='bx-im-list-recent__pinned_container';general.className='bx-im-list-recent__general_container';parent.append(pinned,general);pinned.append(originalOrderRows[0]);originalOrderRows.slice(1).forEach(r=>general.append(r));window.generalOrderParent=general;
   orderAudit.color('chat5','#ef4444');orderAudit.color('chat77','#22c55e');orderAudit.color('chat1000','#22c55e');orderAudit.paint();
  });
  const baseline=await ids();
  await page.getByRole('button',{name:/Фильтры/}).click();await page.locator('[data-pena-sort-mode="color"]').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.test-host:not([hidden]) [data-id="chat77"]')).order!=='0');
  assert.deepEqual((await visual()).slice(0,5),['chat225','chat77','chat1000','chat5','chat1001']);assert.deepEqual(await ids(),baseline,'Vue DOM order unchanged');
  assert.equal(await page.locator('[data-pena-sort-direction]').count(),0);await page.mouse.click(600,30);
  await page.evaluate(()=>{document.querySelector('.test-host:not([hidden]) [data-id="chat77"]').className='bx-im-list-recent-item__wrap';});
  await page.waitForFunction(()=>document.querySelector('.test-host:not([hidden]) [data-id="chat77"]').classList.contains('pena-native-sort-row'));
  const scroll=await page.evaluate(async()=>{
    const viewport=document.querySelector('.test-host:not([hidden]) [class*="__scroll-container"]');viewport.scrollTop=180;
    await new Promise(requestAnimationFrame);const before=viewport.scrollTop;orderAudit.color('chat5','#111111');orderAudit.paint();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const after=viewport.scrollTop;
    orderAudit.color('chat5','#ef4444');orderAudit.paint();viewport.scrollTop=0;return {before,after};
  });
  assert.ok(scroll.before>0);assert.ok(Math.abs(scroll.before-scroll.after)<1,'Color change must not jump scrollbar');
  await row('chat77').click({modifiers:['Control']});await row('chat5').click({modifiers:['Shift']});
  assert.deepEqual((await host.locator('.--native-multi-selected').evaluateAll(rows=>rows.map(r=>r.dataset.id))).sort(),['chat1000','chat5','chat77'].sort(),'Shift follows visible order');await page.keyboard.press('Escape');
  await page.evaluate(()=>{orderAudit.color('chat5','#111111');orderAudit.paint();});assert.deepEqual((await visual()).slice(0,4),['chat225','chat5','chat77','chat1000']);
  await page.evaluate(()=>{orderAudit.color('chat5','');orderAudit.paint();generalOrderParent.prepend(generalOrderParent.querySelector('[data-id="chat1000"]'));});
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.test-host:not([hidden]) [data-id="chat1000"]')).order)<Number(getComputedStyle(document.querySelector('.test-host:not([hidden]) [data-id="chat77"]')).order));
  assert.deepEqual((await visual()).slice(0,3),['chat225','chat1000','chat77']);
  await page.evaluate(()=>{orderAudit.items().push({id:'chat9999',title:'Поздний диалог',color:'#111111',folderId:'folder:test'});orderAudit.save();orderAudit.folder('folder:test');const late=generalOrderParent.lastElementChild.cloneNode(true);late.dataset.id='chat9999';late.removeAttribute('data-task-id');late.querySelector('.bx-im-chat-title__text').textContent='Поздний диалог';generalOrderParent.append(late);});
  await row('chat9999').waitFor({state:'visible'});await row('chat5').waitFor({state:'hidden'});assert.deepEqual(await visual(),['chat225','chat9999']);
  await page.evaluate(()=>{orderAudit.folder('');orderAudit.paint();});await row('chat5').waitFor({state:'visible'});assert.deepEqual((await visual()).slice(0,4),['chat225','chat9999','chat1000','chat77']);
  await page.evaluate(()=>{const late=generalOrderParent.querySelector('[data-id="chat9999"]');late.dataset.id='chat9998';late.querySelector('.bx-im-chat-title__text').textContent='Без цвета';});
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.test-host:not([hidden]) [data-id="chat9998"]')).order)>Number(getComputedStyle(document.querySelector('.test-host:not([hidden]) [data-id="chat77"]')).order));
  await page.evaluate(()=>orderAudit.query('поиск'));assert.equal(await host.locator('.pena-native-sort-parent').count(),0);
  await page.evaluate(()=>orderAudit.query(''));assert.ok(await host.locator('.pena-native-sort-parent').count()>0);
  await page.getByRole('button',{name:/Фильтры/}).click();await page.locator('.pena-native-unread-filter').click();await row('chat5').waitFor({state:'hidden'});await row('chat225').waitFor({state:'visible'});
  await page.locator('.pena-native-unread-filter').click();await row('chat5').waitFor({state:'visible'});await page.locator('[data-pena-sort-mode="date"]').click();
  await page.waitForFunction(()=>!document.querySelector('.test-host:not([hidden]) .pena-native-sort-row'));assert.deepEqual(await visual(),await ids(),'Date restores current native order');
  assert.equal(await page.evaluate(()=>originalOrderRows.every((r,i)=>r.isConnected&&r.querySelector('.test-avatar')===originalAvatars[i])),true);
  await page.locator('[data-pena-sort-mode="color"]').click();await page.reload();await page.locator('.pena-native-folder-switcher').waitFor();await page.waitForFunction(()=>document.querySelector('.test-host:not([hidden]) .pena-native-sort-row'));assert.equal(await page.evaluate(()=>orderAudit.prefs().sortMode),'color');
  assert.equal(await page.evaluate(()=>{orderAudit.clear();return document.querySelectorAll('.test-host:not([hidden]) .pena-native-sort-row,.test-host:not([hidden]) .pena-native-sort-parent').length;}),0);
  assert.equal(await page.locator('.pena-native-managed-row,.pena-native-remote-row,.pena-native-original-load-guard').count(),0);assert.deepEqual(errors,[]);
  report.phases.push({mode,status:'PASS',nativeDomPreserved:true,pinnedGroups:true,liveColor:true,nativeReorder:true,latePage:true,recycling:true,folders:true,unread:true,visualShift:true,searchRelevance:true,persistence:true,cleanup:true});
 }finally{await page.close();}
}console.log('PASS native sort: date/color, DOM, pinned groups, live mutations, folders/unread, Shift, search and reload');
}finally{await browser.close();await server.close();writeFileSync(new URL('./artifacts/native-order-report.json',import.meta.url),JSON.stringify(report,null,2));}

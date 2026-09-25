import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const probe=source.replace('\tasync function boot() {', `\tasync function boot() {
window.orderAudit={prefs:_getDialogControlViewPrefs,key:_dialogControlViewKey,set:_setDialogControlViewPrefs,apply:applyFilters,folder:_setDialogControlNativeActiveFolderId};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),report={phases:[]};
try {
 for(const mode of ['chats','tasks']) for(const savedSort of ['color','date']) {
  const page=await browser.newPage(),errors=collectPageErrors(page);
  try {
   await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:`for(const mode of ['chats','tasks'])localStorage.setItem('pena.dialogControlView.'+mode,JSON.stringify({sortMode:'${savedSort}',sortDirection:'asc',unreadOnly:true}));\n`+probe}));
   await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=${mode}&lazyNative=1&nativeCatalog=1&nativeFirst=1&passThrough=1&eager=0&catalogRows=80`);
   const host=page.locator('.test-host:not([hidden])');
   await page.locator('.pena-native-folder-switcher').waitFor({state:'visible'});
   await page.waitForFunction(()=>window.__PENA_RECENT_SYNC__?.gateReady);
   assert.deepEqual(await page.evaluate(()=>orderAudit.prefs()),{sortMode:'date',sortDirection:'desc',unreadOnly:true});
   await page.evaluate(()=>{window.originalOrderRows=[...document.querySelectorAll('.test-host:not([hidden]) .bx-im-list-recent-item__wrap')];});
   const ids=()=>host.locator('.bx-im-list-recent-item__wrap').evaluateAll(rows=>rows.map(row=>row.dataset.id));
   const baseline=await ids();
   await page.getByRole('button',{name:/Фильтры/}).click();
   const panel=page.locator('.pena-native-filter-panel');
   assert.equal(await page.locator('[data-pena-sort-mode],[data-pena-sort-direction],.dialog-control-sort-btn').count(),0,'No entry point for removed sorting');
   assert.equal(await panel.getByRole('checkbox').count(),1);
   assert.equal(await panel.getByRole('checkbox').isChecked(),true,'Migration preserves unread');
   await panel.locator('.pena-native-unread-filter').click();
   await host.locator('[data-id="chat5"]').waitFor({state:'visible'});
   assert.deepEqual(await ids(),baseline);
   await panel.locator('.pena-native-unread-filter').click();
   await host.locator('[data-id="chat5"]').waitFor({state:'hidden'});
   await host.locator('[data-id="chat225"]').waitFor({state:'visible'});
   await page.evaluate(()=>{const row=document.querySelector('.test-host:not([hidden]) [data-id="chat5"]');const badge=document.createElement('span');badge.className='bx-im-list-recent-item__counter_number';badge.textContent='2';row.appendChild(badge);});
   await host.locator('[data-id="chat5"]').waitFor({state:'visible'});
   await page.evaluate(()=>document.querySelector('.test-host:not([hidden]) [data-id="chat5"] .bx-im-list-recent-item__counter_number')?.remove());
   await host.locator('[data-id="chat5"]').waitFor({state:'hidden'});
   await panel.locator('.pena-native-unread-filter').click();
   await page.evaluate(()=>{orderAudit.set({sortMode:'color',sortDirection:'asc'});orderAudit.apply();});
   assert.deepEqual(await page.evaluate(()=>orderAudit.prefs()),{sortMode:'date',sortDirection:'desc',unreadOnly:false});
   await page.mouse.click(600,30);
   for(let i=0;i<4;i++) {
    await page.evaluate(()=>orderAudit.folder('folder:test'));
    await host.locator('[data-id="chat5"]').waitFor({state:'hidden'});
    await page.evaluate(()=>orderAudit.folder(''));
    await host.locator('[data-id="chat5"]').waitFor({state:'visible'});
   }
   assert.deepEqual(await ids(),baseline,'Folder changes preserve native order');
   assert.equal(await page.evaluate(()=>originalOrderRows.every((row,index)=>row===document.querySelectorAll('.test-host:not([hidden]) .bx-im-list-recent-item__wrap')[index])),true,'Keep native nodes and avatars');
   assert.equal(await page.locator('.pena-native-managed-row,.pena-native-remote-row').count(),0);
   assert.equal(await page.evaluate(()=>nativeScrollAudit.filter(event=>event.top>0).length),0,'No automatic scroll');
   const quota=await page.evaluate(()=>{
    const original=Storage.prototype.setItem;
    localStorage.setItem(orderAudit.key(),JSON.stringify({sortMode:'color',sortDirection:'asc',unreadOnly:true}));
    Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};
    try{return orderAudit.prefs();}finally{Storage.prototype.setItem=original;}
   });
   assert.equal(quota.unreadOnly,true,'Failed migration cannot clear unread');
   assert.deepEqual(errors,[]);
   report.phases.push({mode,savedSort,status:'PASS',nativeRows:baseline.length,unreadLiveUpdates:true,nativeOrderPreserved:true});
  }finally{await page.close();}
 }
 console.log('PASS native order: removed sort UI, migration, unread live updates, folders, nodes and storage failure');
}finally{await browser.close();await server.close();writeFileSync(new URL('./artifacts/native-order-report.json',import.meta.url),JSON.stringify(report,null,2));}

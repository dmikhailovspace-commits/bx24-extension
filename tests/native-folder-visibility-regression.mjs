import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer, collectPageErrors} from './lib/harness-server.mjs';

const source = readFileSync(process.env.PENA_FOLDER_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
const anchor = '\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
const probe = `
 window.folderProbe = {
  prepare: _preparePenaSearchInput, apply: applyFilters,
  select: id => _setDialogControlNativeActiveFolderId(id),
  filter: _applyDialogControlRowFilter, state: _applyDialogControlNativeRowState,
  keys: _getDialogControlNativeRowIdentityKeys, matches: _matchesDialogControlNativeFilter,
  cached: _getCachedDialogControlElementMeta,
  index: buildChatElementIndex, live: _getDialogControlItemLiveMeta,
  syncTitle: _syncDialogControlItemTitleFromElement,
  merge: _mergeDialogRecentWithDomMeta,
  seed: meta => _setDialogRecentMeta(_dialogRecentMeta, {..._getDialogRecentMeta(meta.id),...meta}),
  capture: _captureDialogNativeWindow,
  invalidate: _invalidateDialogControlDomReadCache,
  view: _applyDialogControlNativeView,
  get: _getDialogRecentMeta,
  status: _scheduleDialogNativeStatusRefresh,
  prefs: _setDialogControlViewPrefs,
  notifyData: _notifyDialogRecentDataChanged,
  snapshot: data => _applyDialogCounterSnapshot(_dialogRecentMeta, {..._parseDialogCounterSnapshot(data),startedAt:Date.now()-1}),
  busy: (kind, value) => {
   if(kind==='health') _dialogNativeHealthProbeActive=value;
   if(kind==='traversal') _dialogNativeOriginalScrollActive=value;
   if(kind==='prefetch') _dialogNativePrefetchActive=value;
  },
  items: () => _getDialogControlItems(),
  item: row => _getDialogControlItemForNativeRow(row)
 };
`;
assert.ok(source.includes(anchor));
const server = await startHarnessServer(), browser = await chromium.launch({headless:true});
const report = {phases:[]};
async function scenario(name, run, mode = 'chats') {
 const page = await browser.newPage();
 const errors = collectPageErrors(page), started = performance.now();
 try {
  await page.route('**/extension/injected.js*', route => route.fulfill({contentType:'application/javascript', body:source.replace(anchor,anchor+probe)}));
  await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode='+mode+'&nativeCatalog=1&nativeFirst=1&passThrough=1&activeFolder=1&skipInitialMount=1');
  await page.waitForFunction(mode => {
   const host=mode==='tasks'?'.task-host':'.recent-host';
   const folder=document.querySelector(host+' .pena-native-folder-tab[title="Тестовая папка"]');
   const foreign=document.querySelector(host+' [data-id="chat5"]');
   return window.folderProbe && folder?.classList.contains('--active') && foreign && getComputedStyle(foreign).display==='none';
  }, mode);
  await run(page);
  assert.deepEqual(errors, []);
  report.phases.push({name,status:'PASS',ms:performance.now()-started});
 } catch(error) { report.phases.push({name,status:'FAIL',error:String(error.stack),ms:performance.now()-started}); }
 finally { await page.close(); }
}
try {
 for(const mode of ['chats','tasks']) for(const reminder of [false,true]) await scenario(mode+' Messenger v2 '+(reminder?'reminder':'unread and mention')+' repairs a saved zero and survives the legacy REST projection',async page=>{
  await page.evaluate(()=>folderProbe.apply());
  await page.waitForFunction(()=>{const s=__PENA_NATIVE_PREFETCH__.status();return s.loadedModes.length>0&&!s.originalActive&&!s.modeLoadPending;});
  await page.evaluate(reminder=>{
   const row=document.querySelector('.test-host:not([hidden]) [data-id="chat225"]');
   row.querySelectorAll('.bx-im-list-recent-item__counter_number,[class*="mention"]').forEach(el=>el.remove());
   const badge=document.createElement('div');badge.className='bx-im-list-recent-item__counter_number'+(reminder?' --no-counter':'');badge.textContent=reminder?'':'1';row.append(badge);
   if(!reminder){const marker=document.createElement('div');marker.className='bx-im-list-recent-item__mention';row.append(marker);}
   folderProbe.seed({id:'chat225',isTask:true,taskId:'225',hasUnread:false,hasLater:false,hasMention:false,unreadCount:0,counterFetchedAt:Date.now(),counterConfirmedAt:Date.now()});
   const listeners=new Set();
   const store=window.testCounterStore={state:{counters:{collection:{225:{chatId:225,counter:reminder?0:1,isMarkedAsUnread:reminder}}}},mention:!reminder,userId:window.BX.message('USER_ID'),getters:{},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},emit(type){listeners.forEach(fn=>fn({type}))},listeners};
   store.getters['chats/get']=id=>id==='chat225'?{chatId:225}:null;
   store.getters['messages/anchors/isChatHasAnchorsWithType']=(id,type)=>id===225&&type==='mention'&&store.mention;
   window.BX.Messenger??={};window.BX.Messenger.v2={Application:{Core:{getStore:()=>window.testCounterStore,getUserId:()=>window.testCounterStore.userId}},Const:{AnchorType:{mention:'mention'}}};
   folderProbe.notifyData();
  },reminder);
  const count=()=>page.locator('.test-host:not([hidden]) .pena-native-folder-tab[data-native-folder-id="folder:test"] .pena-native-tab-count').textContent();
  assert.equal(await count(),'1','Folder must use the same v2 state as the unchanged native badge');
  await page.evaluate(()=>{folderProbe.snapshot({CHAT:{},DIALOG:{},CHAT_UNREAD:[],DIALOG_UNREAD:[]});folderProbe.notifyData();});
  assert.equal(await count(),'1','An empty legacy REST projection must not erase v2 notifications');
  assert.equal(await page.evaluate(()=>testCounterStore.listeners.size),1,'Only one native subscription');
  // The row never mutates again: the model must update counters outside the DOM window too.
  await page.evaluate(()=>{testCounterStore.state.counters.collection[225]={chatId:225,counter:4,isMarkedAsUnread:false};testCounterStore.mention=false;testCounterStore.emit('counters/setCounters');});
  await page.waitForFunction(()=>folderProbe.get('chat225').unreadCount===4);
  assert.equal(await count(),'4');
  await page.evaluate(()=>{delete testCounterStore.state.counters.collection[225];testCounterStore.emit('counters/clearById');});
  await page.waitForFunction(()=>folderProbe.get('chat225').unreadCount===0&&!folderProbe.get('chat225').hasLater);
  assert.equal(await count(),'0','Native clear must beat the old rendered badge');
  await page.evaluate(()=>{testCounterStore.state.counters.collection[225]={chatId:225,counter:0,isMarkedAsUnread:true};testCounterStore.emit('counters/setCounters');});
  await page.waitForFunction(()=>folderProbe.get('chat225').hasLater);
  assert.equal(await count(),'1');
  // Parent totals match Bitrix ItemCounters, without adding child reminders to a parent.
  await page.evaluate(()=>{testCounterStore.state.counters.collection[226]={chatId:226,parentChatId:225,counter:3,isMarkedAsUnread:false};testCounterStore.emit('counters/setCounters');});
  await page.waitForFunction(()=>folderProbe.get('chat225').unreadCount===3);
  assert.equal(await count(),'3');
  await page.evaluate(()=>{testCounterStore.userId='999999';folderProbe.seed({id:'chat225',hasUnread:false,hasLater:false,hasMention:false,unreadCount:0,counterConfirmedAt:Date.now()});folderProbe.notifyData();});
  assert.equal(await count(),'0','Another user cannot supply native counters');
  assert.equal(await page.evaluate(()=>testCounterStore.listeners.size),0,'Old user subscription removed');
 }, mode);
 for(const kind of ['health','traversal','prefetch']) await scenario('folder badge catches a native unread/mention update during '+kind,async page=>{
  await page.evaluate(()=>folderProbe.apply());
  await page.waitForFunction(()=>{
   const s=__PENA_NATIVE_PREFETCH__.status();return s.loadedModes.includes('chats')&&!s.originalActive&&!s.modeLoadPending;
  },undefined,{timeout:30000});
  await page.evaluate(()=>{
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]');
   row.querySelectorAll('.bx-im-list-recent-item__counter_number,[class*="mention"]').forEach(node=>node.remove());
   p.seed({id:'chat225',unreadCount:0,hasUnread:false,hasLater:false,hasMention:false,counterFetchedAt:Date.now(),counterConfirmedAt:Date.now()});
   p.notifyData();
  });
  await page.waitForTimeout(120);
  await page.evaluate(kind=>{
   folderProbe.busy(kind,true);
   const row=document.querySelector('.recent-host [data-id="chat225"]');
   const badge=document.createElement('span');badge.className='bx-im-list-recent-item__counter_number';badge.textContent='1';
   const mention=document.createElement('span');mention.className='bx-im-list-recent-item__counter_mention';mention.textContent='@';
   row.append(mention,badge);
  },kind);
  await page.waitForTimeout(220);
  await page.evaluate(kind=>folderProbe.busy(kind,false),kind);
  await page.waitForFunction(()=>{
   const folder=document.querySelector('.recent-host .pena-native-folder-tab[data-native-folder-id="folder:test"]');
   const meta=folderProbe.get('chat225');
   return meta.unreadCount===1&&meta.hasMention&&folder?.querySelector('.pena-native-tab-count')?.textContent==='1';
  },undefined,{timeout:2500});
  assert.equal(await page.locator('.recent-host [data-id="chat225"] .bx-im-list-recent-item__counter_number').textContent(),'1');
 });
 for(const newerRead of [false,true]) await scenario('pending counter '+(newerRead?'cannot undo a newer read':'resumes after returning to the visible window'),async page=>{
  await page.evaluate(()=>folderProbe.apply());
  await page.waitForFunction(()=>{
   const s=__PENA_NATIVE_PREFETCH__.status();return s.loadedModes.includes('chats')&&!s.originalActive&&!s.modeLoadPending;
  },undefined,{timeout:30000});
  await page.evaluate(newerRead=>{
   folderProbe.seed({id:'chat225',unreadCount:0,hasUnread:false,hasLater:false,hasMention:false,counterFetchedAt:Date.now(),counterConfirmedAt:Date.now()});
   folderProbe.notifyData();
   if(newerRead)folderProbe.busy('health',true);
   else {
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
   }
   const row=document.querySelector('.recent-host [data-id="chat225"]');
   row.querySelectorAll('.bx-im-list-recent-item__counter_number').forEach(node=>node.remove());
   const badge=document.createElement('span');badge.className='bx-im-list-recent-item__counter_number';badge.textContent='3';row.append(badge);
  },newerRead);
  await page.waitForTimeout(180);
  await page.evaluate(newerRead=>{
   if(newerRead)folderProbe.seed({id:'chat225',unreadCount:0,hasUnread:false,counterFetchedAt:Date.now(),counterConfirmedAt:Date.now()});
   if(newerRead)folderProbe.busy('health',false);
   else {
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    document.dispatchEvent(new Event('visibilitychange'));
   }
  },newerRead);
  if(newerRead){await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>folderProbe.get('chat225').unreadCount),0);}
  else await page.waitForFunction(()=>folderProbe.get('chat225').unreadCount===3,undefined,{timeout:2500});
 });
 await scenario('unmapped recycled row keeps its display baseline through repeated decoration cleanup', async page => {
  const result = await page.evaluate(() => {
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]');
   p.state(row,p.items().find(x=>x.id==='chat225'));
   row.setAttribute('data-id','chat987659');
   row.querySelector('.bx-im-chat-title__text').textContent='Unknown dialog';
   const filter={folderId:'test',ids:new Set(['chat225']),titles:new Set()};
   for(let i=0;i<3;i++) {
    p.filter(row,filter);p.view(row.parentElement,{restoreDisplay:false,forceShow:true});
   }
   const hidden=getComputedStyle(row).display;
   p.filter(row,null);
   return {hidden,display:getComputedStyle(row).display};
  });
  assert.equal(result.hidden,'none');assert.notEqual(result.display,'none');
 });
 for(const reminder of [false,true]) await scenario('confirmed '+(reminder?'reminder':'unread count')+' survives 45-second DOM fallback expiry',async page=>{
  const result=await page.evaluate(reminder=>{
   const p=folderProbe,id='chat225',at=Date.now()-60000;
   p.seed({id,unreadCount:reminder?0:7,hasUnread:!reminder,hasLater:reminder,hasMention:false,counterFetchedAt:at,counterConfirmedAt:at});
   return p.merge(id,{id,unreadCount:0,hasUnread:false,hasLater:false,hasMention:false,observedAt:Date.now()});
  },reminder);
  assert.equal(result.unreadCount,reminder?0:7);assert.equal(result.hasLater,reminder);
 });
 await scenario('native window capture preserves a reminder hidden behind a numeric badge',async page=>{
  const result=await page.evaluate(()=>{
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]'),id='chat225';
   const counter=row.querySelector('.bx-im-list-recent-item__counter_number')||row.appendChild(document.createElement('span'));
   counter.className='bx-im-list-recent-item__counter_number';counter.textContent='4';
   p.invalidate();
   const at=Date.now()-60000;
   p.seed({id,hasLater:true,hasUnread:true,unreadCount:4,counterFetchedAt:at,counterConfirmedAt:at});
   const target=new Map(),state={mode:'chats',seen:new Set(),orderById:new Map(),startedAt:Date.now()};
   p.capture(row.parentElement,target,state);
   return target.get(id);
  });
  assert.equal(result.unreadCount,4);assert.equal(result.hasLater,true);
 });
 await scenario('native status changes still update and clear confirmed counters and reminders',async page=>{
  await page.evaluate(()=>folderProbe.apply());
  await page.waitForFunction(()=>{
   const s=__PENA_NATIVE_PREFETCH__.status();return s.loadedModes.includes('chats')&&!s.originalActive&&!s.modeLoadPending;
  },undefined,{timeout:30000});
  await page.evaluate(()=>{
   const p=folderProbe,id='chat225',at=Date.now()-60000;
   p.seed({id,hasLater:true,hasUnread:true,unreadCount:3,counterFetchedAt:at,counterConfirmedAt:at});
   p.prefs({unreadOnly:true});p.apply();
  });
  for(const [count,reminder] of [[6,true],[0,true],[0,false],[2,false]]) {
   await page.evaluate(({count,reminder})=>{
    const row=document.querySelector('.recent-host [data-id="chat225"]');
    row.querySelectorAll('.bx-im-list-recent-item__counter_number').forEach(node=>node.remove());
    if(count||reminder) {
     const counter=document.createElement('span');
     counter.className='bx-im-list-recent-item__counter_number'+(!count?' --no-counter':'');
     counter.textContent=count?String(count):'';row.append(counter);
    }
    folderProbe.status(row.parentElement,['chat225'],30);
   },{count,reminder});
   await page.waitForFunction(({count,reminder})=>{
    const meta=folderProbe.get('chat225');return meta.unreadCount===count&&meta.hasLater===reminder;
   },{count,reminder},{timeout:5000});
   await page.waitForFunction(expected=>{
    const row=document.querySelector('.recent-host [data-id="chat225"]');return (getComputedStyle(row).display!=='none')===expected;
   },!!(count||reminder),{timeout:5000});
  }
  for(const count of [0,8]) {
   await page.evaluate(count=>{
    folderProbe.seed({id:'chat225',unreadCount:count,hasUnread:count>0,hasLater:false,counterFetchedAt:Date.now(),counterConfirmedAt:Date.now()});
    folderProbe.notifyData();
   },count);
   await page.waitForFunction(expected=>{
    const row=document.querySelector('.recent-host [data-id="chat225"]');return (getComputedStyle(row).display!=='none')===expected;
   },count>0,{timeout:5000});
  }
 });
 await scenario('replacing native search while a folder is active does not permanently hide other dialogs', async page => {
  const result = await page.evaluate(() => {
   const p=folderProbe, row=document.querySelector('.recent-host [data-id="chat5"]');
   p.apply(); const hidden=getComputedStyle(row).display;
   const input=document.querySelector('.recent-host input[type="search"]'), next=input.cloneNode(true);
   input.replaceWith(next); p.prepare(next); p.select(''); p.apply();
   return {hidden,display:getComputedStyle(row).display,original:row.dataset.penaNativeOriginalDisplay};
  });
  assert.equal(result.hidden,'none');
  assert.notEqual(result.display,'none',JSON.stringify(result));
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.recent-host [data-id="chat5"]').isVisible(),true);
 });
 await scenario('recycled rows keep the new folder filter through decoration in the same frame', async page => {
  const result=await page.evaluate(() => {
   const p=folderProbe, row=document.querySelector('.recent-host [data-id="chat225"]');
   const old=p.items().find(x=>x.id==='chat225'), next=p.items().find(x=>x.id==='chat5');
   p.state(row,old); row.setAttribute('data-id','chat5');
   p.filter(row,{folderId:'isolated',ids:new Set(['chat999999']),titles:new Set()});
   const before=getComputedStyle(row).display;
   p.state(row,next);
   return {before,after:getComputedStyle(row).display,filter:row.dataset.penaNativeFilterDisplay};
  });
  assert.equal(result.before,'none'); assert.equal(result.after,'none',JSON.stringify(result));
  assert.equal(result.filter,'none');
 });
 await scenario('old decoration identity cannot put an unknown recycled task in the previous folder', async page => {
  const result=await page.evaluate(() => {
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]');
   p.state(row,p.items().find(x=>x.id==='chat225'));
   row.setAttribute('data-id','chat987654');
   row.querySelector('.bx-im-chat-title__text').textContent='New unrelated task';
   return {keys:p.keys(row),matches:p.matches(row,{id:'chat987654'}, {folderId:'test',ids:new Set(['chat225']),titles:new Set()}),item:p.item(row)?.id||null};
  });
  assert.deepEqual(result.keys,['chat987654']); assert.equal(result.matches,false); assert.equal(result.item,null);
 });
 await scenario('DOM metadata cache follows the current dialog identity instead of the recycled node', async page => {
  const result=await page.evaluate(() => {
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]');
   const before=p.cached(row); row.setAttribute('data-id','chat987655');
   const after=p.cached(row);
   return {before:before.id,after:after.id};
  });
  assert.equal(result.before,'chat225'); assert.equal(result.after,'chat987655');
 });
 await scenario('cached row index cannot rename or transfer metadata to the previous task', async page => {
  const result=await page.evaluate(() => {
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]');
   const item={...p.items().find(x=>x.id==='chat225')}, index=p.index();
   row.setAttribute('data-id','chat987656');
   row.querySelector('.bx-im-chat-title__text').textContent='Unrelated recycled title';
   const live=p.live(item,index); p.syncTitle(item,index);
   return {liveId:live?.id||null,title:item.title};
  });
  assert.notEqual(result.liveId,'chat987656'); assert.notEqual(result.title,'Unrelated recycled title');
 });
} finally {
 await browser.close(); await server.close();
 report.status=report.phases.every(p=>p.status==='PASS')?'PASS':'FAIL';
 mkdirSync('tests/artifacts',{recursive:true});
 writeFileSync(process.env.PENA_FOLDER_REPORT || 'tests/artifacts/native-folder-visibility-regression.json',JSON.stringify(report,null,2)+'\n');
 for(const phase of report.phases) console.log(phase.status+' '+phase.name+(phase.error?'\n'+phase.error:''));
}
assert.equal(report.status,'PASS');

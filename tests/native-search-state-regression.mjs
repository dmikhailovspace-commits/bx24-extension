import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const raw=readFileSync(process.env.PENA_STABILITY_SOURCE || new URL('../extension/injected.js',import.meta.url),'utf8');
const source=raw.replace('\tasync function boot() {',`\tasync function boot() {
window.stability={apply:applyFilters,arm:_armPenaSearchFlow,query:()=>filters.query,stored:_readStoredBitrixSearchQuery,pending:()=>_dialogControlReadActions.size,selected:()=>[..._dialogControlMultiSelected],unread:value=>{_setDialogControlViewPrefs({unreadOnly:value});applyFilters()}, folder:_setDialogControlNativeActiveFolderId, items:_getDialogControlItems};`);
const server=await startHarnessServer();const browser=await chromium.launch({headless:true});const report=[];
try {
 for(const mode of ['chats','tasks']) {
 const page=await browser.newPage();const errors=collectPageErrors(page);
 await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:source}));
 await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=${mode}&lazyNative=1&nativeCatalog=1&nativeFirst=1&passThrough=1&eager=0&lazy=1&catalogRows=40&nativeService=1`);
 await page.locator('.pena-native-folder-switcher').waitFor({state:'visible'});
 await page.evaluate(()=>{BX.Vue3={BitrixVue:{install(){}}};});
 await page.addScriptTag({url:`${server.baseUrl}/tests/fixtures/vendor/bitrix-vue-prod.js`});
 await page.evaluate(mode=>{
  const {createApp,h}=BX.Vue3;
  const host=document.querySelector(mode==='tasks'?'.task-host':'.recent-host');
  const oldInput=host.querySelector('input[type="search"]');const fieldRoot=document.createElement('div');oldInput.replaceWith(fieldRoot);
  const list=host.querySelector('.bx-im-list-container-recent__elements,.bx-im-list-container-task__elements');
  const resultRoot=document.createElement('div');list.prepend(resultRoot);
  const SearchItem={name:'SearchItem',props:['dialogId'],render(){return h('div',{class:'bx-im-search-item__container',onClick:()=>{window.nativeOpened=this.dialogId;window.nativeSearch.onCloseSearch();}},[h('div',{class:'bx-im-search-item__avatar-container'},[h('div',{class:'bx-im-avatar__container',style:'width:42px;height:42px;border-radius:50%'},'U')]),h('span',{class:'bx-im-chat-title__text'+(this.dialogId==='708'?' --collab':'')},'Native '+this.dialogId)])}};
  const results=createApp({data:()=>({ids:[]}),render(){return h('div',{class:'bx-im-chat-search__container'},this.ids.map(id=>h(SearchItem,{key:id,dialogId:id})));}}).mount(resultRoot);
  const nativeRows=()=>[...list.querySelectorAll('.bx-im-list-recent-item__wrap')];
  window.nativeSearchApp=createApp({
   name:mode==='tasks'?'TaskListContainer':'RecentListContainer',
   data:()=>({searchMode:false,searchQuery:'',inputValue:''}),
   created(){window.nativeSubscribedOpen=this.onOpenSearch;window.nativeSubscribedUpdate=this.onUpdateSearch;},
   beforeUnmount(){window.nativeUnsubscribeMatched=this.onOpenSearch===window.nativeSubscribedOpen;},
   methods:{
    onOpenSearch(){this.searchMode=true;nativeRows().forEach(row=>row.style.display='none');results.ids=['chat225'];},
    onUpdateSearch(query){this.searchMode=true;this.searchQuery=query;nativeRows().forEach(row=>{row.style.display=query?'none':row.style.display;});
     if(!query){results.ids=[];setTimeout(()=>{if(!this.searchQuery)nativeRows().forEach(row=>row.style.display='');},80);return;}
     const delay=query==='first'?650:query==='slow'?180:20;
     setTimeout(()=>{if(this.searchQuery===query)results.ids=query==='other'?['chat77']:['chat225','chat5','707','708'];},delay);
    },
    onCloseSearch(){this.searchMode=false;this.searchQuery='';this.inputValue='';results.ids=[];nativeRows().forEach(row=>row.style.display='');},
    onCloseRecentSearch(){this.onCloseSearch();}
   },
   render(){return h('div',[h('input',{type:'search',placeholder:mode==='tasks'?'Найти задачу':'Найти чат',value:this.inputValue,onFocus:this.onOpenSearch,onClick:this.onOpenSearch,onInput:event=>{this.inputValue=event.target.value;this.onUpdateSearch(event.target.value);},onKeydown:event=>{if(event.key==='Escape')this.onCloseRecentSearch();}}),h('button',{class:'native-clear',onClick:this.onCloseRecentSearch},'×')]);}
  });
  window.nativeSearch=nativeSearchApp.mount(fieldRoot);window.nativeSearchResults=results;
  window.nativeTestList=list;
  // Messenger can focus the field before extension binding completes.
  nativeSearch.onOpenSearch();stability.arm();
 },mode);
 const input=page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} input[type="search"]`);

 const rows=page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} .bx-im-list-recent-item__wrap:visible`);
 const visibleIds=()=>rows.evaluateAll(nodes=>nodes.map(row=>row.dataset.id));
 const baselineIds=await visibleIds();
 // Bitrix's EventEmitter retains the bound callback from created(), even after
 // Vue event props have been refreshed. Exercise that bypass, not the wrapper.
 await page.evaluate(()=>nativeSubscribedOpen());await input.blur();await page.mouse.click(700,500);await page.waitForTimeout(80);
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Cached native open callback must not leave empty search active');
 assert.deepEqual(await visibleIds(),baselineIds,'Empty native history must not replace dialogs after outside click');
 await input.click();await page.waitForTimeout(100);
 assert.deepEqual(await visibleIds(),baselineIds,'Empty search focus must preserve the native list');
 assert.equal(await input.evaluate(el=>document.activeElement===el),true,'Empty focus must keep the keyboard in the search field');
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Empty focus must not open native search history');
 for(const folder of ['', 'folder:test']) for(const unread of [false,true]) {
  await page.evaluate(({folder,unread})=>{stability.folder(folder);stability.unread(unread);},{folder,unread});await page.waitForTimeout(100);
  const filteredIds=await visibleIds();assert.ok(filteredIds.length,'Fixture must contain visible rows');
  await page.evaluate(()=>{
   window.focusFrames=[];window.focusAudit=true;
   window.focusNodes=[...nativeTestList.querySelectorAll('.bx-im-list-recent-item__wrap')];
   const sample=()=>{if(!focusAudit)return;focusFrames.push(focusNodes.filter(row=>row.getBoundingClientRect().height>0).map(row=>row.dataset.id));requestAnimationFrame(sample);};sample();
  });
  for(let n=0;n<3;n++) {await input.blur();await input.focus();await input.click();await page.evaluate(()=>nativeSubscribedOpen());await page.waitForTimeout(30);}
  const frames=await page.evaluate(()=>{focusAudit=false;return focusFrames;});
  assert.ok(frames.length>=3);for(const ids of frames)assert.deepEqual(ids,filteredIds,'No frame may show a shortened list on empty focus');
  assert.deepEqual(await visibleIds(),filteredIds,'Repeated empty focus preserves folder and unread projection');
  assert.equal(await page.evaluate(()=>focusNodes.every(row=>row.isConnected)),true,'Focus preserves original rows and avatars');
 }
 await page.evaluate(()=>{stability.folder('');stability.unread(false);});await page.waitForTimeout(100);
 await input.fill('   ');await page.waitForTimeout(100);
 assert.deepEqual(await visibleIds(),baselineIds,'Whitespace-only input must preserve the native list');
 await input.fill('');
 await input.fill('slow');
 await input.evaluate(el=>{el.value='';el.dispatchEvent(new Event('search',{bubbles:true}));});
 await input.blur();await page.mouse.click(700,500);await page.waitForTimeout(240);
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Native clear without input must close search');
 assert.equal(await page.evaluate(()=>stability.query()),'');
 assert.deepEqual(await visibleIds(),baselineIds,'Late response cannot revive cleared search');
 await page.evaluate(()=>{nativeSearch.onUpdateSearch('slow');nativeSubscribedUpdate('slow');nativeSubscribedOpen();});await page.waitForTimeout(220);
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Delayed native callbacks cannot reopen empty search');
 assert.deepEqual(await visibleIds(),baselineIds);
 await input.fill('slow');await input.evaluate(el=>{el.value='';});await input.blur();await page.mouse.click(700,500);await page.waitForTimeout(230);
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Blur repairs an empty field even without input/change');
 assert.deepEqual(await visibleIds(),baselineIds);
 await input.fill('first');await page.locator('.bx-im-search-item__container').first().waitFor({state:'visible'});
 await page.getByText('Native chat225',{exact:true}).click({button:'right'});
 await page.locator('.dialog-control-context-menu').waitFor({state:'visible',timeout:1500});
 await page.keyboard.press('Escape');
 await page.getByText('Native chat225',{exact:true}).click();await page.waitForTimeout(100);
 assert.equal(await input.inputValue(),'first','Opening a dialog preserves the query');
 assert.equal(await page.evaluate(()=>nativeSearch.searchQuery),'first','Native model and field stay in sync');
 assert.equal(await page.evaluate(()=>nativeOpened),'chat225');
 await page.evaluate(()=>nativeSearch.onCloseSearch());await page.waitForTimeout(30);
 assert.equal(await input.inputValue(),'first','Outside click does not erase sticky search');
 assert.equal(await page.evaluate(()=>stability.stored()),'first','Query is saved under the same scoped key used for restoration');
 await page.evaluate(()=>{
  const root=nativeSearchApp._container;const component=nativeSearchApp._component;
  nativeSearchApp.unmount();nativeSearchApp=BX.Vue3.createApp(component);nativeSearch=nativeSearchApp.mount(root);stability.arm();
 });
 assert.equal(await page.evaluate(()=>nativeUnsubscribeMatched),true,'Restore native callback identity before Bitrix unmount cleanup');
 await page.waitForTimeout(80);
 assert.equal(await input.inputValue(),'first','Native remount restores the saved query');
 // Unknown ordinary and collab users share the exact same actions and numeric
 // REST identity. Do not pre-import search results into the recent catalog.
 await page.evaluate(()=>{
  window.searchWrites=[];const original=BX.rest.callMethod;
  BX.rest.callMethod=function(method,params,callback){
   if(!['im.dialog.read','im.recent.unread'].includes(method))return original.apply(this,arguments);
   searchWrites.push({method,params});setTimeout(()=>callback({error:()=>null,data:()=>true}),1);
  };
 });
 const ordinary=page.getByText('Native 707',{exact:true});const collab=page.getByText('Native 708',{exact:true});
 assert.equal(await page.evaluate(()=>stability.items().some(item=>item.id==='user708')),false);
 await collab.click({button:'right'});
 await page.locator('.dialog-control-context-color-marker').waitFor({state:'visible',timeout:1500});
 await page.locator('.dialog-control-context-color-marker').click();
 await page.locator('.dialog-control-palette.--open .dialog-control-swatch[data-color="#4d9dff"]').click();
 await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('.bx-im-search-item__container[data-pena-native-dialog-id="user708"] .pena-native-avatar-ring'));
 assert.equal(await page.evaluate(()=>{const item=stability.items().find(item=>item.id==='user708');return !item.folderId&&item.color==='#4d9dff';}),true,'Unfiled collab search result accepts and displays a marker');
 await collab.click({button:'right'});
 const menu=page.locator('.dialog-control-context-menu');await menu.waitFor({state:'visible'});
 await menu.getByRole('menuitem',{name:'Прочитать позже',exact:true}).click();
 await page.waitForFunction(()=>!stability.pending()&&searchWrites.length===1);
 assert.deepEqual(await page.evaluate(()=>searchWrites[0].params),{DIALOG_ID:'708',ACTION:'Y'});
 await ordinary.click({modifiers:['Control']});await collab.click({modifiers:['Control']});
 assert.deepEqual(await page.evaluate(()=>stability.selected().sort()),['user707','user708']);
 assert.equal(await page.locator('.bx-im-search-item__container.--native-multi-selected').count(),2,'Search selection must be visible');
 await collab.click({button:'right'});
 await menu.getByRole('menuitem',{name:'Прочитать позже',exact:true}).click();
 await page.waitForFunction(()=>!stability.pending()&&searchWrites.length===3);
 assert.deepEqual(await page.evaluate(()=>searchWrites.slice(1).map(x=>x.params.DIALOG_ID).sort()),['707','708']);
 await collab.click({button:'right'});
 await menu.getByRole('menuitem',{name:'Снять отметку «прочитать позже»',exact:true}).click();
 await page.waitForFunction(()=>!stability.pending()&&searchWrites.length===5);
 await collab.click({button:'right'});
 await menu.getByRole('menuitem',{name:'Прочитано',exact:true}).click();
 await page.waitForFunction(()=>!stability.pending()&&searchWrites.length===9);
 assert.deepEqual(await page.evaluate(()=>searchWrites.slice(5).filter(x=>x.method==='im.dialog.read').map(x=>x.params.DIALOG_ID).sort()),['707','708']);
 await collab.click({button:'right'});
 await menu.getByRole('menuitem',{name:'Добавить в новую папку',exact:true}).click();
 await page.locator('.pena-native-confirm-input').fill('Search users');await page.getByRole('button',{name:'Создать',exact:true}).click();
 assert.equal(await page.evaluate(()=>{const f=stability.items().find(x=>x.title==='Search users');return !!f&&['user707','user708'].every(id=>stability.items().find(x=>x.id===id)?.folderId===f.id)}),true);
 await collab.click({button:'right'});await menu.getByRole('menuitem',{name:'Цветовой маркер',exact:true}).click();
 await page.locator('.dialog-control-palette.--open .dialog-control-palette-tool.--random').click();
 assert.equal(await page.evaluate(()=>{const a=stability.items().find(x=>x.id==='user707'),b=stability.items().find(x=>x.id==='user708');return /^#[a-f0-9]{6}$/.test(a.color)&&a.color===b.color}),true);
 await page.waitForFunction(()=>document.querySelectorAll('.bx-im-search-item__container[data-pena-native-dialog-id^="user70"] .pena-native-avatar-ring').length===2, null, {timeout:1500});
 assert.equal(await page.locator('.bx-im-search-item__container[draggable="true"]').count()>=2,true);
 await page.keyboard.press('Escape');
 await ordinary.click({modifiers:['Control']});await collab.click({modifiers:['Shift']});
 assert.deepEqual(await page.evaluate(()=>stability.selected().sort()),['user707','user708'],'Shift selects visible search order, not hidden recent entries');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>stability.unread(true));await page.waitForTimeout(80);
 assert.equal(await page.getByText('Native chat225',{exact:true}).isVisible(),true);
 assert.equal(await page.getByText('Native chat5',{exact:true}).isVisible(),false,'Unread filtering applies to real SearchItem without data-id');
 await page.evaluate(()=>stability.unread(false));await page.waitForTimeout(60);
 assert.equal(await page.getByText('Native chat5',{exact:true}).isVisible(),true,'Turning off unread restores the result');
 await input.fill('slow');await input.fill('other');await page.waitForTimeout(250);
 assert.equal(await page.locator('.bx-im-search-item__container:visible .bx-im-chat-title__text').allTextContents().then(a=>a.join(',')),'Native chat77','Late response cannot freeze the old query');
 await input.fill('');await page.waitForTimeout(180);
 const expected=await page.evaluate(()=>nativeTestList.querySelectorAll('.bx-im-list-recent-item__wrap').length);
 assert.equal(await page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} .bx-im-list-recent-item__wrap:visible`).count(),expected,'Delayed native reset does not poison the display baseline');
 await input.fill('again');await page.waitForTimeout(60);
 await page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} .native-clear`).click();await page.waitForTimeout(80);
 assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>stability.query()),'','Native clear is explicit and persistent');
 await input.fill('escape');await input.press('Escape');await page.waitForTimeout(80);
 assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>stability.query()),'');
 await input.fill('private query');
 await page.evaluate(()=>{window.currentBitrixUserId='8';stability.arm();});await page.waitForTimeout(80);
 assert.equal(await input.inputValue(),'','Changing the account clears the previous account query');
 assert.equal(await page.evaluate(()=>stability.stored()),'');
 assert.deepEqual(errors,[]);report.push({mode,status:'PASS',cachedOpenCallback:true,cachedUpdateCallback:true,nativeSearchEventClear:true,emptyBlurWithoutInput:true,emptyFocusPreservesList:true,repeatedFocus:true,whitespacePreservesList:true,stickySearch:true,nativeQuery:true,unreadSearch:true,lateResponse:true,clearRestoresNativeRows:true,folderUnreadFocusMatrix:true,frameAudit:true,startupEmptySearchRecovery:true});await page.close();
 }
 console.log('PASS native search state: sticky selection, unread results, delayed reset, stale response, native clear and Escape');
} finally {await browser.close();await server.close();writeFileSync(new URL('./artifacts/native-search-state-report.json',import.meta.url),JSON.stringify(report,null,2));}

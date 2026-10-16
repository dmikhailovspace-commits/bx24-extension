import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const raw=readFileSync(process.env.PENA_STABILITY_SOURCE || new URL('../extension/injected.js',import.meta.url),'utf8');
const source=raw.replace('\tasync function boot() {',`\tasync function boot() {
window.stability={apply:applyFilters,arm:_armPenaSearchFlow,query:()=>filters.query,stored:_readStoredBitrixSearchQuery,pending:()=>_dialogControlReadActions.size,selected:()=>[..._dialogControlMultiSelected],unique:value=>{_setDialogControlViewPrefs({uniqueOnly:value});applyFilters()},unread:value=>{_setDialogControlViewPrefs({unreadOnly:value});applyFilters()}, folder:_setDialogControlNativeActiveFolderId, items:_getDialogControlItems,
seed:meta=>_setDialogRecentMeta(_dialogRecentMeta,{..._getDialogRecentMeta(meta.id),...meta}), notify:_notifyDialogRecentCountersChanged, render:()=>_renderDialogControlNativeSwitcher(findContainer(),_getDialogControlItems())};`);
const server=await startHarnessServer();const browser=await chromium.launch({headless:true});const report=[];
try {
 for(const mode of ['chats','tasks']) {
 for(const scrollName of ['current','renamed','opaque']) {
 const basePage=await browser.newPage();
 const baseErrors=collectPageErrors(basePage);
 await basePage.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=${mode}&baseViewport=1&renamedBaseScroll=${scrollName==='renamed'?1:0}&opaqueBaseScroll=${scrollName==='opaque'?1:0}&nativeCatalog=1&nativeFirst=1&eager=0&catalogRows=40&nativeService=1`);
 await basePage.locator('.pena-native-folder-switcher').waitFor({state:'visible'});
 const baseState=await basePage.evaluate(mode=>{
  const list=document.querySelector(mode==='tasks'?'.task-host .bx-im-list-container-task__elements':'.recent-host .bx-im-list-container-recent__elements');
  const scroll=list?.querySelector(':scope > .bx-im-list-base__container > [class*="scroll-container"],:scope > .bx-im-list-base__container > [data-test-scroll-owner]');
  return {scroll:!!scroll,owner:window.__PENA_ACTIVE_LIST_CONTEXT__?.list===list,
   panelCount:document.querySelectorAll('.pena-native-folder-switcher').length,
   rows:scroll?.querySelectorAll('.bx-im-list-recent-item__wrap').length||0};
 },mode);
	assert.equal(baseState.scroll,true);
	assert.equal(baseState.owner,true);
	assert.equal(baseState.panelCount,1);
	assert.ok(baseState.rows>=40,
  `Bitrix ${scrollName} BaseRecentList must mount one panel over the native ${mode} list`);
 assert.deepEqual(baseErrors,[],`BaseRecentList ${mode} runtime errors`);
 await basePage.close();
 }
 const page=await browser.newPage();const errors=collectPageErrors(page);
 await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:source}));
 await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=${mode}&baseViewport=1&lazyNative=1&nativeCatalog=1&nativeFirst=1&passThrough=1&eager=0&lazy=1&catalogRows=40&nativeService=1`);
 await page.locator('.pena-native-folder-switcher').waitFor({state:'visible'});
 await page.evaluate(()=>{BX.Vue3={BitrixVue:{install(){}}};});
 await page.addScriptTag({url:`${server.baseUrl}/tests/fixtures/vendor/bitrix-vue-prod.js`});
 await page.evaluate(mode=>{
  const {createApp,h}=BX.Vue3;
  const host=document.querySelector(mode==='tasks'?'.task-host':'.recent-host');
  const oldInput=host.querySelector('input[type="search"]');const fieldRoot=document.createElement('div');oldInput.replaceWith(fieldRoot);
  const list=host.querySelector('.bx-im-list-container-recent__elements,.bx-im-list-container-task__elements');
  const resultRoot=document.createElement('div');list.prepend(resultRoot);
  const SearchItemLayout={name:'SearchItemLayout',emits:['click','contextmenu'],render(){return h('div',{class:window.opaqueSearchLayout?'future-search-row':window.legacySearchLayout?'bx-im-search-item__container':'bx-im-search-item-layout__container',onClick:e=>this.$emit('click',e),onContextmenu:e=>{e.preventDefault();this.$emit('contextmenu',e);}},this.$slots.default());}};
  const SearchItem={name:'SearchItem',props:['dialogId'],emits:['openContextMenu'],render(){return h(SearchItemLayout,{onClick:()=>{window.nativeOpened=this.dialogId;window.nativeSearch.onCloseSearch();},onContextmenu:nativeEvent=>this.$emit('openContextMenu',{dialogId:this.dialogId,nativeEvent})},()=>[h('div',{class:'bx-im-search-item-layout__avatar-container'},[h('div',{class:'bx-im-avatar__container',style:'width:42px;height:42px;border-radius:50%'},'U')]),h('span',{class:'bx-im-chat-title__text'+(this.dialogId==='708'?' --collab':'')},'Native '+this.dialogId)])}};
  const results=createApp({name:'RecentSearch',data:()=>({ids:[],contextMenuManager:null}),methods:{onOpenContextMenu(event){if(window.menuFactory){this.contextMenuManager ||= BX.Vue3.markRaw(window.menuFactory());this.contextMenuManager.openMenu({dialogId:event.dialogId},{left:event.nativeEvent.pageX,top:event.nativeEvent.pageY});}}},render(){return h('div',{class:'bx-im-chat-search__container'},this.ids.map(id=>h(SearchItem,{key:id,dialogId:id,onOpenContextMenu:this.onOpenContextMenu})));}}).mount(resultRoot);
  const nativeRows=()=>[...list.querySelectorAll('.bx-im-list-recent-item__wrap')];
  // RecentList is v-show="!searchMode" in Bitrix. TaskList stays mounted and
  // visible. Hiding only individual rows misses the real Chats lifecycle bug.
  const nativeBranch=list.querySelector('.bx-im-list-base__container,.bx-im-list-recent__container,.bx-im-list-task__container');
  const setSearchBranch=active=>{if(mode==='chats')nativeBranch.style.display=active?'none':'';};
  window.nativeSearchApp=createApp({
   name:mode==='tasks'?'TaskListContainer':'RecentListContainer',
   data:()=>({searchMode:false,searchQuery:'',inputValue:'',inputMounted:true,inputKey:0}),
   created(){window.nativeSubscribedOpen=this.onOpenSearch;window.nativeSubscribedUpdate=this.onUpdateSearch;window.nativeSubscribedClose=this.onCloseSearch;},
   beforeUnmount(){window.nativeUnsubscribeMatched=this.onOpenSearch===window.nativeSubscribedOpen;},
   methods:{
    onOpenSearch(){this.searchMode=true;setSearchBranch(true);nativeRows().forEach(row=>row.style.display='none');results.ids=['chat225'];},
    onUpdateSearch(query){this.searchMode=true;setSearchBranch(true);this.searchQuery=query;nativeRows().forEach(row=>{row.style.display=query?'none':row.style.display;});
     if(!query){results.ids=[];setTimeout(()=>{if(!this.searchQuery)nativeRows().forEach(row=>row.style.display='');},80);return;}
     const delay=query==='first'?650:query==='slow'?180:20;
     setTimeout(()=>{if(this.searchQuery===query)results.ids=query==='other'?['chat77']:['chat225','chat5','707','708'];},delay);
    },
    onCloseSearch(){this.searchMode=false;setSearchBranch(false);this.searchQuery='';this.inputValue='';if(window.nativeCollapseInput)this.inputMounted=false;results.ids=[];nativeRows().forEach(row=>row.style.display='');},
    onCloseRecentSearch(){this.onCloseSearch();}
   },
   render(){return h('div',[this.inputMounted?h('input',{key:this.inputKey,type:'search',class:'bx-im-search-input__input',placeholder:'',value:this.inputValue,onFocus:this.onOpenSearch,onClick:this.onOpenSearch,onInput:event=>{this.inputValue=event.target.value;this.onUpdateSearch(event.target.value);},onKeydown:event=>{if(event.key==='Escape')this.onCloseRecentSearch();}}):h('button',{class:'native-open',onClick:()=>{this.inputMounted=true;}},'Find'),h('button',{class:'native-clear',onClick:this.onCloseRecentSearch},'×')]);}
  });
  window.nativeSearch=nativeSearchApp.mount(fieldRoot);window.nativeSearchResults=results;
  window.nativeTestList=list;
  // The real header initially contains a button. Its newly mounted field can
  // receive typing before any list refresh has had a chance to bind it.
  const lateInput=fieldRoot.querySelector('input');lateInput.value='late field';
  lateInput.dispatchEvent(new Event('input',{bubbles:true}));
  if(stability.query()!=='late field')throw Error('First input from a late native search field must enable global search synchronously');
  lateInput.value='';lateInput.dispatchEvent(new Event('input',{bubbles:true}));
  // Messenger can focus the field before extension binding completes.
  nativeSearch.onOpenSearch();stability.arm();
 },mode);
 const input=page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} input[type="search"]`);

 const rows=page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} .bx-im-list-recent-item__wrap:visible`);
 const visibleIds=()=>rows.evaluateAll(nodes=>nodes.map(row=>row.dataset.id));
 const baselineIds=await visibleIds();
 await page.evaluate(()=>{
  window.searchPanel=document.querySelector('.pena-native-folder-switcher');
  window.searchContext=window.__PENA_ACTIVE_LIST_CONTEXT__;
 });
 await input.fill('first');
 const loadingFrames=await page.evaluate(()=>new Promise(resolve=>{
  const frames=[];const start=performance.now();const sample=()=>{
   frames.push({panel:searchPanel.isConnected&&searchPanel.getBoundingClientRect().height>0&&getComputedStyle(searchPanel).visibility==='visible',
    same:document.querySelector('.pena-native-folder-switcher')===searchPanel,
    context:window.__PENA_ACTIVE_LIST_CONTEXT__?.list===searchContext.list,
    duplicate:document.querySelectorAll('.pena-native-folder-switcher').length});
   if(performance.now()-start<800)requestAnimationFrame(sample);else resolve(frames);
  };requestAnimationFrame(sample);
 }));
 assert.ok(loadingFrames.every(frame=>frame.panel&&frame.same&&frame.context&&frame.duplicate===1),'Native search loading must retain the same visible panel and list owner on every frame');
 assert.equal(await page.locator('.bx-im-search-item-layout__container:visible').count(),4,'Native delayed search results must arrive');
 await input.fill('');await page.waitForTimeout(100);
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
  assert.ok(frames.length>=3);for(const ids of frames)assert.deepEqual(ids,filteredIds,`No frame may show a shortened list on empty focus (${mode}, ${folder}, unread=${unread})`);
  assert.deepEqual(await visibleIds(),filteredIds,'Repeated empty focus preserves folder and unread projection');
  assert.equal(await page.evaluate(()=>focusNodes.every(row=>row.isConnected)),true,'Focus preserves original rows and avatars');
 }
 await page.evaluate(()=>{stability.folder('');stability.unread(false);});await page.waitForTimeout(100);
 // Search temporarily exposes the global results. Clearing must restore the
 // folder before the first paint, not merely converge after a debounce.
 for(const unique of [false,true]) for(const unread of [false,true]) for(const clearVia of ['input','button','escape','search','cached']) {
  await page.evaluate(value=>stability.unique(value),unique);
  await page.evaluate(unread=>{stability.folder('folder:test');stability.unread(unread);},unread);await page.waitForTimeout(60);
  const expectedIds=await visibleIds();assert.ok(expectedIds.length);
  await input.fill('slow');await page.waitForTimeout(240);
  assert.equal(await page.evaluate(()=>stability.query()),'slow','A header without placeholder must still own the native query');
  if(!unread) assert.deepEqual(await page.locator('.bx-im-search-item-layout__container:visible .bx-im-chat-title__text').allTextContents(),['Native chat225','Native chat5','Native 707','Native 708'],'Search must include chats and people outside the selected folder, including with unique-only enabled');
  const frames=await page.evaluate(clearVia=>new Promise(resolve=>{
   requestAnimationFrame(()=>{
    const field=nativeSearch.$el.querySelector('input');
    const clear=()=>{field.value='';field.dispatchEvent(new Event(clearVia==='search'?'search':'input',{bubbles:true}));};
    if(clearVia==='button')nativeSearch.$el.querySelector('button').click();
    else if(clearVia==='escape')field.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    else {clear();if(clearVia==='cached'){nativeSubscribedUpdate('slow');nativeSubscribedOpen();}}
    const frames=[];const sample=()=>{
     frames.push([...nativeTestList.querySelectorAll('.bx-im-list-recent-item__wrap')].filter(row=>row.getBoundingClientRect().height>0).map(row=>row.dataset.id));
     if(frames.length<8)requestAnimationFrame(sample);else resolve(frames);
    };requestAnimationFrame(sample);
   });
  }),clearVia);
  for(const ids of frames)assert.deepEqual(ids,expectedIds,`Clearing via ${clearVia} must restore folder/unread before every paint`);
  assert.deepEqual(await visibleIds(),expectedIds);
 }
 await page.evaluate(()=>{stability.unique(false);stability.folder('');stability.unread(false);});await page.waitForTimeout(60);
 await input.fill('   ');await page.waitForTimeout(100);
 assert.deepEqual((await visibleIds()).slice(0,baselineIds.length),baselineIds,'Whitespace-only input must preserve the native list');
 await input.fill('');
 await input.fill('slow');
 await input.evaluate(el=>{el.value='';el.dispatchEvent(new Event('search',{bubbles:true}));});
 await input.blur();await page.mouse.click(700,500);await page.waitForTimeout(240);
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Native clear without input must close search');
 assert.equal(await page.evaluate(()=>stability.query()),'');
 assert.deepEqual((await visibleIds()).slice(0,baselineIds.length),baselineIds,'Late response cannot revive cleared search');
 await page.evaluate(()=>{nativeSearch.onUpdateSearch('slow');nativeSubscribedUpdate('slow');nativeSubscribedOpen();});await page.waitForTimeout(220);
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Delayed native callbacks cannot reopen empty search');
 assert.deepEqual((await visibleIds()).slice(0,baselineIds.length),baselineIds);
 await input.fill('slow');await input.evaluate(el=>{el.value='';});await input.blur();await page.mouse.click(700,500);await page.waitForTimeout(230);
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Blur repairs an empty field even without input/change');
 assert.deepEqual((await visibleIds()).slice(0,baselineIds.length),baselineIds);
 await input.fill('first');await page.locator('.bx-im-search-item-layout__container').first().waitFor({state:'visible'});
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
 await page.waitForFunction(()=>document.querySelector('.bx-im-search-item-layout__container[data-pena-native-dialog-id="user708"] .pena-native-avatar-ring'));
 assert.equal(await page.evaluate(()=>{const item=stability.items().find(item=>item.id==='user708');return !item.folderId&&item.color==='#4d9dff';}),true,'Unfiled collab search result accepts and displays a marker');
 await collab.click({button:'right'});
 const menu=page.locator('.dialog-control-context-menu');await menu.waitFor({state:'visible'});
 const originalMenuStyle=await menu.evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.color,s.borderRadius,s.padding];});
 await menu.getByRole('menuitem',{name:'Прочитать позже',exact:true}).click();
 await page.waitForFunction(()=>!stability.pending()&&searchWrites.length===1);
 assert.deepEqual(await page.evaluate(()=>searchWrites[0].params),{DIALOG_ID:'708',ACTION:'Y'});
 await ordinary.click({modifiers:['Control']});await collab.click({modifiers:['Control']});
 assert.deepEqual(await page.evaluate(()=>stability.selected().sort()),['user707','user708']);
 assert.equal(await page.locator('.bx-im-search-item-layout__container.--native-multi-selected').count(),2,'Search selection must be visible');
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
 await page.waitForFunction(()=>document.querySelectorAll('.bx-im-search-item-layout__container[data-pena-native-dialog-id^="user70"] .pena-native-avatar-ring').length===2, null, {timeout:1500});
 assert.equal(await page.locator('.bx-im-search-item-layout__container[draggable="true"]').count()>=2,true);
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
 assert.equal(await page.locator('.bx-im-search-item-layout__container:visible .bx-im-chat-title__text').allTextContents().then(a=>a.join(',')),'Native chat77','Late response cannot freeze the old query');
 await input.fill('');await page.waitForTimeout(180);
 const expected=await page.evaluate(()=>nativeTestList.querySelectorAll('.bx-im-list-recent-item__wrap').length);
 assert.equal(await page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} .bx-im-list-recent-item__wrap:visible`).count(),expected,'Delayed native reset does not poison the display baseline');
 await input.fill('again');await page.waitForTimeout(60);
 await page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} .native-clear`).click();await page.waitForTimeout(80);
 assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>stability.query()),'','Native clear is explicit and persistent');
 await input.fill('escape');await input.press('Escape');await page.waitForTimeout(80);
 assert.equal(await input.inputValue(),'');assert.equal(await page.evaluate(()=>stability.query()),'');
 // Exercise the current system-menu contract with native handlers, dynamic
 // permission filtering and nested folders, inside the unchanged PENA menu.
 await page.evaluate(()=>{
  window.menuLog=[];
  window.menuFactory=()=>new class {
   context=null;menuInstance=null;
   getMenuItems(){
    const action=title=>({title,onClick:()=>{if(!this.menuInstance)throw Error('Missing native menu lifecycle');menuLog.push({title,id:this.context.dialogId});}});
    return ['Прочитано Bitrix','Закрепить','Выключить звук','Открыть профиль','Общие чаты','Скрыть чат','Выйти из чата',window.extraNativeAction].filter(Boolean).map(action).concat([null,{title:'Недоступное действие',disabled:true,onClick:()=>{throw Error('Disabled action executed');}},{title:'Папки Bitrix',subMenu:{items:[{...action('Нативная папка'),isSelected:true}]}}]);
   }
   getMenuOptions(){return {items:this.getMenuItems().filter(Boolean),events:{onDestroy:()=>this.close()}};}
   openMenu(context){
    this.close();this.context=context;const options=this.getMenuOptions();const root=document.createElement('div');root.className='test-system-menu';root.style='position:fixed;left:450px;top:0;z-index:2147483647;background:white;max-height:90vh;overflow:auto';root.setAttribute('role','menu');
    const render=items=>{root.replaceChildren();for(const item of items.filter(Boolean)){const b=document.createElement('button');b.style.display='block';b.textContent=item.title;b.setAttribute('role','menuitem');b.onclick=()=>{if(item.subMenu)render(item.subMenu.items);else {item.onClick?.();this.close();}};root.append(b);}};
    const native={getPopupContainer:()=>root,destroy:()=>{root.remove();options.events.onDestroy?.();},close:()=>this.close()};this.menuInstance=native;render(options.items);document.body.append(root);
   }
   close(){const old=this.menuInstance;this.menuInstance=null;old?.destroy();}
  };
 });
 await input.fill('native menu');await page.waitForTimeout(80);
 const nativeMenu=menu;
 await page.getByText('Native chat225',{exact:true}).click({button:'right'});
 await nativeMenu.waitFor();
 assert.equal(await page.locator('.test-system-menu').count(),0,'The native popup must not replace the original PENA menu');
 assert.deepEqual(await menu.evaluate(el=>{const s=getComputedStyle(el);return [s.backgroundColor,s.color,s.borderRadius,s.padding];}),originalMenuStyle,'Keep the existing menu appearance');
 assert.deepEqual((await menu.locator(':scope > button').allTextContents()).slice(0,3),['Прочитать позже','Прочитано','Цветовой маркер'],'Existing actions stay directly available in their original order');
 assert.deepEqual(await menu.locator(':scope > .dialog-control-context-native').allTextContents(),['Прочитано Bitrix','Закрепить','Выключить звук','Открыть профиль','Общие чаты','Скрыть чат','Выйти из чата','Недоступное действие','Папки Bitrix']);
 assert.equal(await menu.getByRole('menuitem',{name:'Недоступное действие',exact:true}).isEnabled(),false);
 await nativeMenu.getByRole('menuitem',{name:'Папки Bitrix',exact:true}).click();
 assert.equal(await menu.getByRole('menuitemcheckbox',{name:'Нативная папка',exact:true}).getAttribute('aria-checked'),'true');
 await nativeMenu.getByRole('menuitemcheckbox',{name:'Нативная папка',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>menuLog),[{title:'Нативная папка',id:'chat225'}]);
 await page.waitForTimeout(30);
 await page.evaluate(()=>{window.extraNativeAction='Новый пункт Bitrix';});
 await ordinary.click({button:'right'});await nativeMenu.waitFor();
 await nativeMenu.getByRole('menuitem',{name:'Новый пункт Bitrix',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>menuLog.at(-1)),{title:'Новый пункт Bitrix',id:'707'});
 await page.waitForTimeout(30);
 await ordinary.click({button:'right'});
 await nativeMenu.getByRole('menuitem',{name:'Цветовой маркер',exact:true}).click();
 await page.locator('.dialog-control-palette.--open').waitFor();await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>Object.hasOwn(nativeSearchResults.contextMenuManager,'getMenuItems')),false,'Restore the native prototype; do not patch subsequent menus globally');
 await ordinary.click({button:'right'});await nativeMenu.waitFor();
 await page.evaluate(()=>{window.extraNativeAction=null;});
 const actionCount=await page.evaluate(()=>menuLog.length);
 await nativeMenu.getByRole('menuitem',{name:'Новый пункт Bitrix',exact:true}).click();
 assert.equal(await page.evaluate(()=>menuLog.length),actionCount,'An action removed by Bitrix permissions must not execute from an old menu');
 assert.equal(await page.locator('.test-system-menu').count(),0,'No hidden native menu remains after an action');
 await page.evaluate(()=>{window.menuFactory=null;window.legacySearchLayout=true;});
 await input.fill('');await input.fill('legacy');await page.waitForTimeout(80);
 await page.getByText('Native 707',{exact:true}).click({modifiers:['Control']});
 assert.ok((await page.evaluate(()=>stability.selected())).includes('user707'),'Previous search layout remains selectable');
 await page.keyboard.press('Escape');await input.fill('');
 await page.evaluate(()=>{window.legacySearchLayout=false;window.opaqueSearchLayout=true;});
 await input.fill('future layout');await page.waitForTimeout(100);
 await page.getByText('Native 708',{exact:true}).click({modifiers:['Control']});
 assert.ok((await page.evaluate(()=>stability.selected())).includes('user708'),'Vue dialog identity survives another CSS class rename');
 await page.keyboard.press('Escape');await input.fill('');
 await page.evaluate(mode=>{
  const list=nativeTestList;
  const instance=mode==='chats'?list.__vueParentComponent:list.closest('.test-host')._vnode.component.subTree.children[0].component;
  instance.proxy.contextMenuManager=nativeSearchResults.contextMenuManager;
  instance.proxy.onItemRightClick=({item,event})=>instance.proxy.contextMenuManager.openMenu({dialogId:item.dialogId,recentItem:item},event);
  list.addEventListener('contextmenu',event=>{const row=event.target.closest('.bx-im-list-recent-item__wrap');if(!row)return;event.preventDefault();event.stopPropagation();instance.proxy.onItemRightClick({item:{dialogId:row.dataset.id},event});});
 },mode);
 await page.locator(`${mode==='tasks'?'.task-host':'.recent-host'} [data-id="chat225"]`).click({button:'right'});
 await nativeMenu.getByRole('menuitem',{name:'Закрепить',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>menuLog.at(-1)),{title:'Закрепить',id:'chat225'},'Ordinary chats/tasks retain their own native menu context');
 await page.waitForTimeout(30);
 // Native search may match information absent from our catalog. Conversely,
 // cached previews matching a single letter are not native search results.
 await page.evaluate(()=>{
  stability.unique(false);stability.unread(false);stability.folder('');
  for(const item of stability.items().filter(x=>x.type!=='folder'))stability.seed({id:item.id,unreadCount:0,hasUnread:false,hasLater:false,hasMention:false,counterConfirmedAt:Date.now()});
  stability.seed({id:'chat5',title:'a cached match',lastText:'a',unreadCount:51,hasUnread:true,counterConfirmedAt:Date.now()});
  stability.seed({id:'chat225',title:'Unrelated',lastText:'',unreadCount:0,hasUnread:false,counterConfirmedAt:Date.now()});
 });
 const total=page.locator('.pena-native-group-tab[data-native-segment-id=""] .pena-native-tab-count');
 await input.fill('a');
 await page.waitForTimeout(80);
 await page.evaluate(()=>{nativeSearchResults.ids=['chat225'];});
 await page.waitForFunction(()=>document.querySelectorAll('[data-pena-native-search-row]').length===1);
 await page.waitForFunction(()=>document.querySelector('.pena-native-group-tab[data-native-segment-id=""] .pena-native-tab-count')?.textContent==='0');
 assert.equal(await total.textContent(),'0','One-letter native result must not inherit notifications from cached text matches');
 await page.evaluate(()=>{stability.seed({id:'chat225',unreadCount:3,hasUnread:true,counterConfirmedAt:Date.now()});stability.notify();});
 assert.equal(await total.textContent(),'3','Lightweight counter updates must use the same search result set');
 await page.evaluate(()=>{stability.render();});assert.equal(await total.textContent(),'3');
 await input.fill('zz');
 await page.waitForFunction(()=>document.querySelector('.pena-native-group-tab[data-native-segment-id=""] .pena-native-tab-count')?.textContent==='54');
 assert.equal(await total.textContent(),'54','Native results count even when their cached text does not match the query');
 await page.evaluate(()=>{nativeSearchResults.ids=[];});
 await page.waitForFunction(()=>document.querySelector('.pena-native-group-tab[data-native-segment-id=""] .pena-native-tab-count')?.textContent==='0');
 await input.fill('');
 await page.waitForFunction(()=>document.querySelector('.pena-native-group-tab[data-native-segment-id=""] .pena-native-tab-count')?.textContent==='54');
 assert.equal(await total.textContent(),'54','Clearing search restores full counters without erasing catalog notifications');
 // Current Bitrix removes the field on close. Cached native callbacks bypass
 // our wrapper; the detached old field still contains the previous query.
 await page.evaluate(()=>{stability.folder('folder:test');});await page.waitForTimeout(80);
 const beforeCollapse=await visibleIds();assert.ok(beforeCollapse.length);
 await input.fill('collapsed query');await page.waitForTimeout(80);
 await page.evaluate(()=>{window.nativeCollapseInput=true;nativeSubscribedClose();});
 await page.waitForTimeout(120);
 assert.equal(await input.count(),0,'Native close must really remove the search field');
 assert.equal(await page.evaluate(()=>stability.query()),'','A removed field and closed native model must clear the extension query');
 assert.equal(await page.evaluate(()=>stability.stored()),'','Closed native search must not be restored from storage');
 assert.deepEqual(await visibleIds(),beforeCollapse,'Closing to the native search button restores the selected folder');
 await page.evaluate(()=>{nativeSubscribedUpdate('collapsed query');nativeSubscribedOpen();});await page.waitForTimeout(120);
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false,'Late cached callbacks must not reopen search after its field was removed');
 assert.equal(await page.evaluate(()=>stability.query()),'');
 assert.deepEqual(await visibleIds(),beforeCollapse);
 await page.evaluate(()=>{window.nativeCollapseInput=false;nativeSearch.inputMounted=true;});
 await page.waitForTimeout(60);await page.evaluate(()=>stability.arm());
 assert.equal(await input.inputValue(),'','Reopening the field must not resurrect the old query');
 // A clear may replace the input within the same container instance.
 await input.fill('replaced query');await page.waitForTimeout(80);
 await page.evaluate(()=>{nativeSearch.inputValue='';nativeSearch.inputKey++;});
 await page.waitForTimeout(60);await page.evaluate(()=>stability.arm());await page.waitForTimeout(80);
 assert.equal(await input.inputValue(),'','An empty replacement field is authoritative over the old controller query');
 assert.equal(await page.evaluate(()=>stability.query()),'');
 assert.equal(await page.evaluate(()=>nativeSearch.searchMode),false);
 assert.deepEqual(await visibleIds(),beforeCollapse);
 await input.fill('private query');
 await page.evaluate(()=>{window.currentBitrixUserId='8';stability.arm();});await page.waitForTimeout(80);
 assert.equal(await input.inputValue(),'','Changing the account clears the previous account query');
 assert.equal(await page.evaluate(()=>stability.stored()),'');
 assert.deepEqual(errors,[]);report.push({mode,status:'PASS',clearFolderFrameMatrix:true,cachedOpenCallback:true,cachedUpdateCallback:true,nativeSearchEventClear:true,emptyBlurWithoutInput:true,emptyFocusPreservesList:true,repeatedFocus:true,whitespacePreservesList:true,stickySearch:true,nativeQuery:true,unreadSearch:true,lateResponse:true,clearRestoresNativeRows:true,folderUnreadFocusMatrix:true,frameAudit:true,startupEmptySearchRecovery:true});await page.close();
 }
 console.log('PASS native search state: sticky selection, unread results, delayed reset, stale response, native clear and Escape');
} finally {await browser.close();await server.close();writeFileSync(new URL('./artifacts/native-search-state-report.json',import.meta.url),JSON.stringify(report,null,2));}

import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const{chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync(process.env.PENA_MENTION_SOURCE || new URL('../extension/injected.js',import.meta.url),'utf8');
const extract=name=>{const start=source.search(new RegExp('\\t(?:async )?function '+name+'\\('));if(start<0)return '';const next=/\n\t(?:async )?function /.exec(source.slice(start+1));return source.slice(start,next?start+1+next.index:undefined);};
const names=['isVisibleElement','_isPenaNativeListSearchInput','_getBitrixListSearchInput','_findNativeLifecycleSearchInput','_preparePenaSearchInput','_armPenaSearchFlow'];
const browser=await chromium.launch({headless:true});const phases=[];
async function fixture(placeholder){const page=await browser.newPage();await page.setContent(`<main id="listHost"><div id="list" class="bx-im-list-container-task__elements"></div></main><aside class="ui-selector-dialog popup-window"><input id="mention" type="search" placeholder="${placeholder}"><div id="composer" contenteditable="true"></div></aside>`);await page.addScriptTag({content:`const IS_OL_FRAME=false,_PENA_NATIVE_ONLY=true;let _bitrixSearchSourceInput=null,_penaSearchFlowArmed=false,_penaSearchResetInput=null;const _penaSearchQueriesByMode=new Map(),_penaSearchPreparedInputs=new WeakSet(),_penaSearchUserActivatedInputs=new WeakSet(),filters={query:''};const filtersHost=null;window.nativeInputs=0;window.nativeKeys=0;window.penaQueries=0;
 function _syncPenaEmployeeSearch(){} function _isDialogNativeLazyMode(){return false} function _pMode(){return 'tasks'} function _isElementTopHit(){return true} function _readStoredBitrixSearchQuery(){return ''} function _setInputValueNative(input,value){input.value=value} function findContainer(){return document.getElementById('list')} function _getCurrentFilterRows(){return []} function _restorePenaSearchInput(){} function _setPenaSearchQuery(){window.penaQueries++} function _ensureBitrixListSearchSticky(){return _getBitrixListSearchInput()}
 ${names.map(extract).join('\n')}
 window.probe={get:_getBitrixListSearchInput,find:()=>_findNativeLifecycleSearchInput(document.getElementById('list'),'tasks'),arm:_armPenaSearchFlow,prepare:_preparePenaSearchInput};document.addEventListener('input',()=>window.nativeInputs++);document.addEventListener('keydown',()=>window.nativeKeys++);`});return page;}
async function check(name,fn){try{const detail=await fn();phases.push({name,status:'PASS',detail});}catch(error){phases.push({name,status:'FAIL',error:error.message});}}
try{
 await check('employee directory results, pagination and cancellation',async()=>{const {verifyEmployeeSearch}=await import('./lib/employee-search.mjs');return verifyEmployeeSearch(browser,source);});
 await check('employee entity selector is never native list search',async()=>{const page=await fixture('Поиск сотрудников');const result=await page.evaluate(()=>{probe.arm();const field=document.getElementById('mention');field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'a'}));return{selected:probe.get()?.id||null,owned:field.dataset.penaSearchOwner||'',nativeInputs,nativeKeys};});await page.close();assert.deepEqual(result,{selected:null,owned:'',nativeInputs:1,nativeKeys:1});return result;});
 await check('task entity selector cannot become lifecycle search via body ancestor',async()=>{const page=await fixture('Поиск задач');const result=await page.evaluate(()=>({search:probe.find()?.id||null}));await page.close();assert.equal(result.search,null);return result;});
 await check('late native header mounts while mention input and composer remain native',async()=>{const page=await fixture('Поиск сотрудников');const result=await page.evaluate(()=>{const header=document.createElement('div');header.className='bx-im-list-container-task__header_container';header.innerHTML='<input id="native-search" type="search" placeholder="Найти задачу">';document.getElementById('listHost').prepend(header);probe.arm();const mention=document.getElementById('mention'),composer=document.getElementById('composer'),native=document.getElementById('native-search');for(const node of [mention,composer]){node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new KeyboardEvent('keydown',{key:'@',bubbles:true}));}return{selected:probe.get()?.id,lifeSearch:probe.find()?.id,owned:native.dataset.penaSearchOwner,nativeInputs,nativeKeys};});await page.close();assert.deepEqual(result,{selected:'native-search',lifeSearch:'native-search',owned:'pena',nativeInputs:2,nativeKeys:2});return result;});
 await check('native search remains isolated while a recycled input loses PENA event ownership',async()=>{const page=await fixture('Поиск сотрудников');await page.evaluate(()=>{const header=document.createElement('div');header.className='bx-im-list-container-task__header_container';header.innerHTML='<input id="native-search" type="search" placeholder="Найти задачу">';document.getElementById('listHost').prepend(header);probe.arm();});await page.locator('#native-search').fill('задача');assert.equal(await page.evaluate(()=>penaQueries),1);assert.equal(await page.evaluate(()=>nativeInputs),0);const result=await page.evaluate(()=>{const field=document.getElementById('native-search');document.querySelector('.ui-selector-dialog').append(field);window.__PENA_ACTIVE_LIST_CONTEXT__={searchInput:field};field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true}));return{selected:probe.get()?.id||null,nativeInputs,nativeKeys};});await page.close();assert.deepEqual(result,{selected:null,nativeInputs:1,nativeKeys:1});return result;});
 await check('mounted native toolbar settles without observing its own toggle label forever',async()=>{
  const page=await fixture('Поиск сотрудников');
  await page.evaluate(()=>{const header=document.createElement('div');header.className='bx-im-list-container-task__header_container';header.innerHTML='<input id="native-search" type="search" placeholder="Найти задачу">';document.getElementById('listHost').prepend(header);});
  await page.addScriptTag({content:`const VER='test';function _isPenaExtensionEnabled(){return true} function _setPenaExtensionEnabled(){} ${['_getBitrixListSearchHost','_ensureBitrixListSystemToolbarSticky','_ensurePenaExtensionToolbarControls','_armPenaExtensionToolbarControls'].map(extract).join('\n')} window.toolbarRefreshes=0;const originalEnsure=_ensurePenaExtensionToolbarControls;_ensurePenaExtensionToolbarControls=function(...args){window.toolbarRefreshes++;return originalEnsure(...args)};_armPenaExtensionToolbarControls();`});
  const result=await page.evaluate(async()=>{
   const frames=async count=>{for(let i=0;i<count;i++)await new Promise(resolve=>requestAnimationFrame(resolve))};
   await frames(5);const before=toolbarRefreshes;await frames(12);const idleRefreshes=toolbarRefreshes-before;
   const header=document.querySelector('.bx-im-list-container-task__header_container');header.querySelector('.pena-extension-toolbar-controls').remove();await frames(5);
   const removedControlsRepaired=!!header.querySelector('.pena-extension-toolbar-controls');
   const settled=toolbarRefreshes;await frames(12);return{idleRefreshes,removedControlsRepaired,repairIdleRefreshes:toolbarRefreshes-settled};
  });
  await page.close();assert.deepEqual(result,{idleRefreshes:0,removedControlsRepaired:true,repairIdleRefreshes:0});return result;
 });
 await check('popup result replacement batches route discovery without losing nested native sources',async()=>{
  const page=await fixture('Поиск сотрудников');
  await page.addScriptTag({content:`let routeObs=null,_nativeLifecycleDisconnect=null,_dialogControlNativeSwitcherNode=null;function _ensureNativeLifecycleController(){return {connect(details){window.routeProbe=details;return ()=>{}}}} ${extract('armRouteObserverIfNeeded')} armRouteObserverIfNeeded();`});
  const result=await page.evaluate(()=>{
   const classify=records=>routeProbe.isRelevantMutations?routeProbe.isRelevantMutations(records):records.some(record=>routeProbe.isRelevantMutation(record));
   const popup=document.querySelector('.ui-selector-dialog');
   const makeRows=()=>Array.from({length:240},()=>{const row=document.createElement('div');row.innerHTML='<span>Result</span>';return row});
   const old=makeRows();popup.replaceChildren(...old);
   const rows=makeRows();popup.replaceChildren(...rows);
   let queries=0;
   for(const node of [popup,...old,...rows]){const original=node.querySelectorAll.bind(node);node.querySelectorAll=selector=>{queries++;return original(selector)}}
   const relevant=classify([{type:'childList',target:popup,addedNodes:rows,removedNodes:old}]);
   const popupQueries=queries;
   const newSource=document.createElement('div');newSource.className='bx-im-list-container-task__elements';rows[239].append(newSource);rows[239].hidden=true;
   const nestedSourceDetected=classify([{type:'childList',target:popup,addedNodes:rows,removedNodes:[]}]);
   const hiddenSourceRemembered=classify([{type:'attributes',target:rows[239],attributeName:'hidden'}]);
   const source=document.getElementById('list'),oldHost=source.parentElement;oldHost.remove();
   const removedAncestorDetected=classify([{type:'childList',target:document.body,addedNodes:[],removedNodes:[oldHost]}]);
   let bodyQueries=0;const bodyQuery=document.body.querySelectorAll.bind(document.body);document.body.querySelectorAll=selector=>{bodyQueries++;return bodyQuery(selector)};
   const leaves=Array.from({length:240},()=>document.createElement('div'));document.body.append(...leaves);
   const leafRelevant=classify([{type:'childList',target:document.body,addedNodes:leaves,removedNodes:[]}]);
   return{popupQueries,relevant,nestedSourceDetected,hiddenSourceRemembered,removedAncestorDetected,bodyQueries,leafRelevant};
  });
  await page.close();assert.deepEqual(result,{popupQueries:1,relevant:false,nestedSourceDetected:true,hiddenSourceRemembered:true,removedAncestorDetected:true,bodyQueries:0,leafRelevant:false});return result;
 });
}finally{await browser.close();mkdirSync('tests/artifacts',{recursive:true});writeFileSync(process.env.PENA_MENTION_REPORT||'tests/artifacts/mention-search-ownership.json',JSON.stringify({phases,passed:phases.filter(p=>p.status==='PASS').length,total:phases.length},null,2));console.log(JSON.stringify(phases,null,2));if(phases.some(p=>p.status==='FAIL'))process.exitCode=1;}

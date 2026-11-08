import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
import {checkQuietCachedAction} from './lib/settings-transfer-ui.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const baseline=process.argv.includes('--baseline'),textareaProbe=process.argv.includes('--textarea-probe'),fullTextareaProbe=process.argv.includes('--full-textarea-probe'),ref='47103a0';
const read=path=>baseline?execFileSync('git',['show',`${ref}:${path}`],{encoding:'utf8',maxBuffer:20*1024*1024}):readFileSync(path,'utf8');
const sourceHashes=Object.fromEntries(['extension/injected.js','extension/injected.css','extension/native-catalog.js'].map(path=>[path,createHash('sha256').update(read(path)).digest('hex')]));
let runtime=read('extension/injected.js');
runtime=runtime.replace('function _openSortingTransfer() {',`window.__transferReadState=()=>({revision:_dialogControlDataRevision,raw:localStorage.getItem('pena.dialogControl.v1.chats')});\n function _openSortingTransfer() {`);
// Diagnostic flags change only the served fixture, never the packaged runtime.
if(textareaProbe||fullTextareaProbe)runtime=runtime.replace('const preview=exportCache.text.length>12000;','const preview=false;');
runtime=runtime.replace('function _sortingTransferSnapshot() {',`function _sortingTransferSnapshot() { const started=performance.now();window.__transferPerf.calls++;try{return _sortingTransferSnapshotMeasured();}finally{window.__transferPerf.snapshotMs+=performance.now()-started;}}\n function _sortingTransferSnapshotMeasured() {`);
if(!baseline)runtime=runtime.replace('async function _sortingTransferSnapshotAsync(scope, checkpoint, progress) {',`async function _sortingTransferSnapshotAsync(...args) {const start=performance.now(),beat=window.__transferBeat,frames=beat?.frames||0,ticks=beat?.ticks||0;window.__transferPerf.asyncCalls++;const report=args[2];args[2]=value=>{report(value);if(value>=5&&window.__transferMutation){const mutate=window.__transferMutation;window.__transferMutation=null;mutate();}};try{return await _sortingTransferSnapshotAsyncMeasured(...args);}finally{window.__transferPerf.buildSpan={elapsedMs:performance.now()-start,frames:(beat?.frames||0)-frames,ticks:(beat?.ticks||0)-ticks};}}\n async function _sortingTransferSnapshotAsyncMeasured(scope, checkpoint, progress) {`);
if(!baseline)runtime=runtime.replace('async function _sortingTransferCodeAsync(snapshot, checkpoint, progress) {',`async function _sortingTransferCodeAsync(...args) {const start=performance.now(),beat=window.__transferBeat,frames=beat?.frames||0,ticks=beat?.ticks||0;try{return await _sortingTransferCodeAsyncMeasured(...args);}finally{window.__transferPerf.codeSpan={start,elapsedMs:performance.now()-start,frames:(beat?.frames||0)-frames,ticks:(beat?.ticks||0)-ticks};}}\n async function _sortingTransferCodeAsyncMeasured(snapshot, checkpoint, progress) {`);
if(!baseline)runtime=runtime.replace('function _sortingTransferStateMatches(state) {',`function _sortingTransferStateMatches(state) {const result=_sortingTransferStateMatchesMeasured(state);if(!result){const now=_sortingTransferState();(window.__transferCacheMisses||=[]).push({at:performance.now(),oldRevision:state.revision,newRevision:now.revision,changedKeys:state.values.filter(([key,value])=>localStorage.getItem(key)!==value).map(([key,value])=>({key,oldLength:value?.length,newLength:localStorage.getItem(key)?.length}))});}return result;}\n function _sortingTransferStateMatchesMeasured(state) {`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const results=[];
try {
 for(const count of [4000,10000]){
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.addInitScript(textareaProbe=>{
   window.__transferPerf={calls:0,snapshotMs:0,asyncCalls:0};window.__transferLongTasks=[];window.__transferValueSets=[];
   new PerformanceObserver(list=>window.__transferLongTasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration,name:x.name})))).observe({type:'longtask',buffered:true});
   const descriptor=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
   Object.defineProperty(HTMLTextAreaElement.prototype,'value',{...descriptor,set(value){const started=performance.now(),exportField=this.getAttribute('aria-label')==='Код экспорта';if(exportField)window.__transferFullValue=value;const rendered=textareaProbe&&exportField?value.slice(0,32768):value;descriptor.set.call(this,rendered);if(exportField){const record={start:started,length:value.length,renderedLength:rendered.length,elapsedMs:performance.now()-started,nextRafMs:null};window.__transferValueSets.push(record);requestAnimationFrame(()=>record.nextRafMs=performance.now()-started);}}});
  },textareaProbe);
  await page.route('**/extension/injected.js*',r=>r.fulfill({contentType:'text/javascript',body:runtime}));
  if(baseline)await page.route('**/extension/injected.css*',r=>r.fulfill({contentType:'text/css',body:read('extension/injected.css')}));
  if(baseline)await page.route('**/extension/native-catalog.js*',r=>r.fulfill({contentType:'text/javascript',body:read('extension/native-catalog.js')}));
  await page.goto(server.baseUrl+'/tests/native-cold-start-layout-harness.html?layoutDelay=50');
  await page.locator('.pena-native-folder-switcher').waitFor();
  await page.evaluate(count=>{
   BX.message=key=>key==='USER_ID'?'7':'';
   const items=Array.from({length:count},(_,i)=>({id:`chat${i+1}`,type:'chat',title:`Portable dialogue ${i}`.padEnd(120,'x')}));
   const raw=JSON.stringify(items);localStorage.setItem('pena.dialogControl.v1.chats',raw);window.dispatchEvent(new StorageEvent('storage',{key:'pena.dialogControl.v1.chats',newValue:raw}));
  },count);
  await page.getByRole('button',{name:'Фильтры',exact:true}).click();
  const settings=page.locator('.pena-settings-section');await settings.locator(':scope>summary').click();
  if(baseline)await settings.locator('details>summary').click();
  await settings.getByRole('button',{name:'Перенос настроек',exact:true}).waitFor();
  // The cold-start fixture deliberately continues materialization after the
  // switcher appears. Wait for actual source quiescence, not merely a visible
  // panel: otherwise late native title hydration correctly invalidates cache.
  await page.waitForFunction(()=>{
   const state=window.__transferReadState(),now=performance.now(),previous=window.__transferQuiet;
   if(!previous||previous.revision!==state.revision||previous.raw!==state.raw)window.__transferQuiet={...state,since:now};
   return window.__coldStartHarness.phase==='settled'&&now-window.__transferQuiet.since>=1200;
  },null,{polling:100,timeout:15000});
  const fixtureSettled=await page.evaluate(()=>({phase:window.__coldStartHarness.phase,quietMs:performance.now()-window.__transferQuiet.since,revision:window.__transferQuiet.revision}));
  const open=await page.evaluate(()=>{window.__transferPerf={calls:0,snapshotMs:0,asyncCalls:0};const start=performance.now();document.querySelector('.pena-settings-transfer').click();return {elapsedMs:performance.now()-start,...window.__transferPerf};});
  const panel=page.getByRole('dialog',{name:'Перенос настроек',exact:true});await panel.waitFor();
  if(!baseline){
   assert.equal(open.calls,0,'Opening settings must not snapshot the catalog');
   assert.equal(open.asyncCalls,0,'Opening settings must not start a background export');
   assert.equal(await panel.getByLabel('Код экспорта').inputValue(),'','Opening settings does not generate export');
   assert.equal(await panel.getByLabel('Код экспорта').isVisible(),false,'Opening settings leaves code hidden');
   assert.equal(await panel.locator('.pena-transfer-copy').isVisible(),false,'Opening settings leaves Copy hidden');
  }
  await page.evaluate(()=>{
   window.__transferBeat={frames:0,ticks:0,inputEvents:0,maxGap:0,gaps:[],last:performance.now(),active:true};
   const step=()=>{const p=window.__transferBeat;if(!p.active)return;const now=performance.now(),gap=now-p.last;p.maxGap=Math.max(p.maxGap,gap);if(gap>40)p.gaps.push({at:now,ms:gap});p.last=now;p.frames++;requestAnimationFrame(step);};requestAnimationFrame(step);
   document.addEventListener('keydown',()=>{if(document.querySelector('.pena-transfer-panel')?.dataset.exportState==='building')window.__transferBeat.inputEvents++;});
   window.__transferBeat.timer=setInterval(()=>window.__transferBeat.ticks++,0);
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}});
  });
  let build=null;
  if(!baseline){
   const start=await page.evaluate(()=>{const now=performance.now();Object.assign(window.__transferBeat,{frames:0,ticks:0,inputEvents:0,maxGap:0,gaps:[],last:now});document.querySelector('.pena-transfer-build').click();return now;});
   await page.keyboard.press('Shift');
   await page.waitForFunction(()=>{const el=document.querySelector('[aria-label="Код экспорта"]');return el?.value.length>0;});
   build=await page.evaluate(start=>({elapsedMs:performance.now()-start,...window.__transferBeat,...window.__transferPerf}),start);
   assert.ok(build.buildSpan.elapsedMs<16||(build.buildSpan.frames>0&&build.buildSpan.ticks>0),`A snapshot longer than one frame must yield: ${JSON.stringify(build.buildSpan)}`);
  }
  const copy=await page.evaluate(()=>{const calls=window.__transferPerf.calls,asyncCalls=window.__transferPerf.asyncCalls,start=performance.now();[...document.querySelectorAll('.pena-transfer-panel button')].find(x=>x.textContent==='Скопировать код').click();return {elapsedMs:performance.now()-start,snapshotCalls:window.__transferPerf.calls-calls,asyncCalls:window.__transferPerf.asyncCalls-asyncCalls};});
  await panel.getByRole('button',{name:'Скопировано',exact:true}).waitFor();
  const exportData=JSON.parse(await page.evaluate(()=>window.__copied));
  assert.equal(exportData.modes.chats.items.length,count,'Copy carries the full requested catalog');
  if(!baseline&&!textareaProbe&&!fullTextareaProbe){
   assert.equal(await panel.getByLabel('Код экспорта').getAttribute('data-preview'),'true');
   assert.ok((await panel.getByLabel('Код экспорта').inputValue()).length<=8000);
   assert.equal(await panel.getByText('Фрагмент кода · копируется полностью',{exact:true}).isVisible(),true);
   const fullManual=await panel.getByLabel('Код экспорта').evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain');});
   assert.equal(fullManual,await page.evaluate(()=>window.__copied),'Ctrl+C and the copy button transfer the same full payload');
  }
  if(!baseline){assert.equal(copy.snapshotCalls,0,'Copy never regenerates the snapshot');assert.equal(copy.asyncCalls,0,'Copy never starts an async snapshot');}
  const beat=await page.evaluate(()=>{const p=window.__transferBeat;p.active=false;clearInterval(p.timer);return {frames:p.frames,ticks:p.ticks,inputEvents:p.inputEvents,maxGapMs:p.maxGap,gaps:p.gaps};});
  const diagnostics=await page.evaluate(()=>({valueSets:window.__transferValueSets,longTasks:window.__transferLongTasks}));
  if(!baseline&&!textareaProbe&&!fullTextareaProbe){
   const calls=await page.evaluate(()=>window.__transferPerf.asyncCalls);
   if(process.argv.includes('--cache-delay'))await page.waitForTimeout(1200);
   await checkQuietCachedAction(panel,'.pena-transfer-build');
   assert.equal(await page.evaluate(()=>window.__transferPerf.asyncCalls),calls,'Rebuilding ready code uses the existing snapshot');
   const download=page.waitForEvent('download');await checkQuietCachedAction(panel,'.pena-transfer-download');await download;
   assert.equal(await panel.getByText('Фрагмент кода · копируется полностью',{exact:true}).isVisible(),true,'Download retains the visible partial-code disclosure');
   assert.equal(await panel.getByLabel('Код экспорта').isVisible(),true,'Downloading an already built code leaves its preview visible');
   assert.equal(await page.evaluate(()=>window.__transferPerf.asyncCalls),calls,'Downloading a ready code reuses its complete cached payload: '+JSON.stringify(await page.evaluate(()=>window.__transferCacheMisses||[])));
  }
  let cancellation=null,staleBuild=null;
  if(!baseline){
   await panel.getByRole('button',{name:'Закрыть',exact:true}).click();
   if(!await page.locator('.pena-native-filter-panel').isVisible())await page.getByRole('button',{name:'Фильтры',exact:true}).click();
   if(!await settings.evaluate(el=>el.open))await settings.locator(':scope>summary').click();
   await settings.getByRole('button',{name:'Перенос настроек',exact:true}).click();
   cancellation=await page.evaluate(async()=>{
    const panel=document.querySelector('.pena-transfer-panel');
    [...panel.querySelectorAll('button')].find(x=>x.textContent==='Собрать код').click();
    const wasBuilding=panel.dataset.exportState==='building';
    [...panel.querySelectorAll('button')].find(x=>x.textContent==='Закрыть').click();
    await new Promise(resolve=>setTimeout(resolve,250));
    return {wasBuilding,removed:!panel.isConnected,code:panel.querySelector('[aria-label="Код экспорта"]').value};
   });
   assert.deepEqual(cancellation,{wasBuilding:true,removed:true,code:''},'Closing cancels pending export before it fills a detached dialog');
   await page.evaluate(()=>document.querySelector('.pena-settings-transfer').click());
   await page.evaluate(()=>{
    const panel=document.querySelector('.pena-transfer-panel');
    window.__transferMutation=()=>{
    const key='pena.dialogControl.v1.chats',items=JSON.parse(localStorage.getItem(key));items[0].title='Changed during build';const raw=JSON.stringify(items);
    localStorage.setItem(key,raw);window.dispatchEvent(new StorageEvent('storage',{key,newValue:raw}));
    };
    [...panel.querySelectorAll('button')].find(x=>x.textContent==='Собрать код').click();
   });
   await page.waitForFunction(()=>document.querySelector('.pena-transfer-panel').dataset.exportState!=='building');
   staleBuild=await panel.evaluate(el=>({state:el.dataset.exportState,codeLength:el.querySelector('[aria-label="Код экспорта"]').value.length}));
   assert.equal(staleBuild.codeLength,0,'Concurrent settings changes do not leave an apparently ready stale export');
   assert.notEqual(staleBuild.state,'ready');
  }
  results.push({items:count,fixtureSettled,open,build,copy,beat,diagnostics,cancellation,staleBuild,exportBytes:Buffer.byteLength(JSON.stringify(exportData))});
  await page.close();
 }
 mkdirSync('tests/artifacts',{recursive:true});writeFileSync(`tests/artifacts/transfer-performance-${baseline?'before':textareaProbe?'textarea-probe':fullTextareaProbe?'full-textarea-probe':'after'}.json`,JSON.stringify({source:baseline?ref:'working tree',sourceHashes,fixture:true,realPortal:false,textareaProbe,fullTextareaProbe,results},null,2));
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();await server.close();}

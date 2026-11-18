import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {startHarnessServer} from './lib/harness-server.mjs';

const count=Number(process.env.PENA_PERF_TASKS||4000), label=process.env.PENA_PERF_LABEL||'current';
let source=readFileSync(process.env.PENA_PERF_SOURCE||'extension/injected.js','utf8');
const modelSha256=createHash('sha256').update(readFileSync(join(process.env.PENA_EXTENSION_DIR||'extension','native-catalog.js'))).digest('hex');
const runtimeSha256=createHash('sha256').update(source).digest('hex');
for(const name of ['_applyDialogAutomation','_hydrateAllDialogControlModesFromRecent','_notifyDialogRecentDataChanged','_renderDialogControlNativeSwitcher','_getDialogControlItemsForMode','_dialogAutomationRefreshCandidates','_getDialogTimeIdentityScopeKey']){
 const pattern=new RegExp('(function '+name+'\\([^\\n]*\\) \\{)');
 assert.ok(pattern.test(source),name);source=source.replace(pattern,'$1\n window.perfCounts && (window.perfCounts["'+name+'"]=(window.perfCounts["'+name+'"]||0)+1);');
}
source=source.replace('\tasync function boot() {',`\tasync function boot() {
 window.perfApi={isLazy:_isDialogNativeLazyMode,seed:meta=>_setDialogRecentMeta(_dialogRecentMeta,meta),save:_saveDialogControlItemsForMode,items:_getDialogControlItemsForMode,
 key:_dialogAutomationKey,schedule:_scheduleDialogAutomation,get:_getDialogRecentMeta,merge:_mergeDialogTaskCatalogRows,render:()=>_renderDialogControlNativeSwitcher(findContainer(),_getDialogControlItems()),tickets:_dialogAutomationTickets};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const cdp=await page.context().newCDPSession(page);
const browserCdp=await browser.newBrowserCDPSession();
const rendererCpu=async()=>{
 const {processInfo}=await browserCdp.send('SystemInfo.getProcessInfo');
 return new Map(processInfo.filter(p=>p.type.toLowerCase()==='renderer').map(p=>[p.id,p.cpuTime]));
};
const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
const phases=[];
const profiling=process.env.PENA_PERF_PROFILE==='1';
async function phase(name,action){
 await page.evaluate(()=>{window.perfCounts={};window.perfLong=[];window.perfLag=[];window.perfApiCalls=0;window.perfBytes=0;});
 const cpuBefore=await rendererCpu();const before=await metrics();if(profiling)await cdp.send('Profiler.start');const at=performance.now();await action();
 const elapsed=performance.now()-at,after=await metrics(),{profile}=profiling?await cdp.send('Profiler.stop'):{profile:{nodes:[]}};
 const cpuAfter=await rendererCpu();
 assert.deepEqual([...cpuAfter.keys()].sort(),[...cpuBefore.keys()].sort(),'Renderer population must stay stable during measurement');
 const rendererCpuMs=[...cpuAfter].reduce((ms,[id,seconds])=>ms+(seconds-cpuBefore.get(id))*1000,0);
 const sample=await page.evaluate(()=>({counts:perfCounts,long:perfLong,lag:perfLag,apiCalls:perfApiCalls,storageBytes:perfBytes,heap:performance.memory?.usedJSHeapSize}));
 const top=new Map(),nodes=new Map(profile.nodes.map(n=>[n.id,n]));
 for(let i=0;i<(profile.samples||[]).length;i++){
  const node=nodes.get(profile.samples[i]),name=node?.callFrame.functionName||(node?.callFrame.url+':'+node?.callFrame.lineNumber)||'(anonymous)';
  top.set(name,(top.get(name)||0)+(profile.timeDeltas?.[i]||0));
 }
 const quantile=(v,q)=>v.length?v.slice().sort((a,b)=>a-b)[Math.min(v.length-1,Math.floor(v.length*q))]:0;
 const result={name,rendererCpuMs,elapsedMs:elapsed,scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskMs:(after.TaskDuration-before.TaskDuration)*1000,
  layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,longTasks:sample.long.length,longTaskTotal:sample.long.reduce((a,b)=>a+b,0),longTaskMax:Math.max(0,...sample.long),
  lagP95:quantile(sample.lag,.95),lagMax:Math.max(0,...sample.lag),...sample,top:[...top].sort((a,b)=>b[1]-a[1]).slice(0,18)};
 delete result.long;delete result.lag;phases.push(result);console.log(JSON.stringify(result));
}
try{
 // The visual-regression harness serializes its entire state every 5 ms.
 // Disable only that diagnostic observer in BOTH compared builds; it is
 // not Bitrix or extension work and otherwise dominates large catalogs.
 await page.route('**/tests/native-consistency-harness.html*',async route=>{
  const response=await route.fetch();let html=(await response.text()).replace(/\r\n/g,'\n');
  const probe="setInterval(() => {\n\t  const activeHost";
  assert.ok(html.includes(probe));
  html=html.replace(probe,"(() => {})/* performance probe disabled */(() => {\n\t  const activeHost");
  await route.fulfill({response,body:html});
 });
 await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&passThrough=1&nativeFirst=1&lazyNative=1&skipInitialMount=1');
 await page.waitForFunction(()=>window.perfApi&&window.nativeCustomEventHandlers.get('onPullEvent-tasks')?.length);
 assert.equal(await page.evaluate(()=>perfApi.isLazy()),true,'Benchmark uses the shipping native list');
 await page.evaluate(count=>{
  window.perfRecords=new Map();window.perfApiCalls=0;window.perfBytes=0;window.perfCounts={};window.perfLong=[];window.perfLag=[];
  new PerformanceObserver(list=>perfLong.push(...list.getEntries().map(x=>x.duration))).observe({type:'longtask'});
  let expected=performance.now()+25;setInterval(()=>{perfLag.push(Math.max(0,performance.now()-expected));expected=performance.now()+25;},25);
  const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){perfBytes+=String(value).length*2;return write.call(this,key,value);};
  const original=BX.rest.callMethod;
  BX.rest.callMethod=function(method,params,callback){
   if(method==='tasks.task.list'&&Array.isArray(params.filter?.ID)){
    perfApiCalls++;const tasks=params.filter.ID.map(id=>perfRecords.get(String(id))).filter(Boolean);
    setTimeout(()=>callback({error:()=>null,data:()=>({tasks:structuredClone(tasks)})}),15);return;
   }
   if(method==='im.dialog.get'){
    const task=perfRecords.get(String(Number(String(params.DIALOG_ID).replace(/^chat/,''))-110000));
    if(task){setTimeout(()=>callback({error:()=>null,data:()=>({chat:{id:Number(task.chatId),dialog_id:params.DIALOG_ID,name:task.title,entity_type:'TASKS',entity_id:task.id}})}),15);return;}
   }
   if(method==='tasks.task.get'&&perfRecords.has(String(params.taskId))){
    setTimeout(()=>callback({error:()=>null,data:()=>({task:structuredClone(perfRecords.get(String(params.taskId)))})}),15);return;
   }
   return original.call(this,method,params,callback);
  };
  const items=perfApi.items('tasks').filter(x=>!/^chat99/.test(x.id));
  items.push({id:'folder:perf-a',type:'folder',title:'A'},{id:'folder:perf-b',type:'folder',title:'B'});
  for(let i=0;i<count;i++){
   const taskId=String(880000+i),id='chat'+(990000+i),title='Performance task '+i;
   const task={id:taskId,chatId:id.slice(4),title,responsibleId:String(10+i%12),createdBy:'7',status:'3',groupId:'210',priority:'1',deadline:'',accomplices:[],auditors:[]};
   perfRecords.set(taskId,task);perfApi.seed({id,taskId,isTask:true,displayTitle:title,automationFacts:task,availability:'available',taskCatalogFetchedAt:Date.now()-3600000});
   items.push({id,taskId,title,folderId:'folder:perf-a',automationHandled:true});
  }
  // Match a hydrated real catalog before timing the missed-event audit.
  perfApi.merge([...perfRecords.values()]);
  perfApi.save('tasks',items);
  window.perfConfig={version:1,excludedIds:[],autoAcceptTransfers:false,rules:Array.from({length:12},(_,i)=>({id:'owner-'+i,enabled:true,folderId:'folder:perf-a',match:'all',conditions:[{field:'responsibleId',op:'eq',value:String(10+i)}]}))};
 },count);
 await page.waitForTimeout(2500);await cdp.send('Performance.enable');await cdp.send('Profiler.enable');
 await phase('rules-and-refresh',async()=>{
  await page.evaluate(()=>{localStorage.setItem(perfApi.key('tasks'),JSON.stringify(perfConfig));perfApi.schedule();});
  await page.waitForTimeout(14000);
 });
 await phase('unchanged-refresh',async()=>{await page.waitForTimeout(12000);});
 if(!process.env.PENA_PERF_SOURCE){
  const quiet=phases.at(-1);
  assert.ok(quiet.apiCalls>=8,'Freshness audit remains active');
  assert.equal(quiet.counts._hydrateAllDialogControlModesFromRecent||0,0,'Unchanged data never rebuilds the catalog');
  assert.equal(quiet.counts._applyDialogAutomation||0,0,'Unchanged data never reruns rules');
  assert.equal(quiet.counts._renderDialogControlNativeSwitcher||0,0,'Unchanged data never redraws folders');
 }
 await page.evaluate(()=>{perfApi.render();window.perfOriginalFolderButton=document.querySelector('[data-native-folder-id="folder:perf-a"]');});
 await phase('folder-interactions',async()=>{
  for(let i=0;i<10;i++){await page.locator('[data-native-folder-id="'+(i%2?'folder:perf-a':'folder:perf-b')+'"]').click();await page.waitForTimeout(150);}
  await page.waitForTimeout(1500);
 });
 assert.deepEqual(errors,[]);
 if(!process.env.PENA_PERF_SOURCE){
  assert.equal(await page.evaluate(()=>perfOriginalFolderButton===document.querySelector('[data-native-folder-id="folder:perf-a"]')),true,'Folder selection preserves the tab node and focus target');
  assert.equal(await page.locator('[data-native-folder-id="folder:perf-a"]').evaluate(el=>el.classList.contains('--active')),true,'The existing tab reflects the current folder');
 }
 assert.equal(await page.evaluate(()=>perfApi.items('tasks').filter(x=>/^chat990/.test(x.id)&&x.folderId==='folder:perf-a').length),Math.min(count,1000));
 assert.equal(await page.evaluate(()=>perfApi.items('tasks').filter(x=>/^chat99/.test(x.id)&&!x.title.startsWith('Performance task ')).length),0,'Detail reads preserve canonical titles');
 // A user reviews a small selection from a large catalog. Prepare manual placements
 // outside the measurement, then time the actual dialog, checkbox and bulk action.
 const selectionSize=Math.min(count,48);
 await page.evaluate(n=>{
  const items=perfApi.items('tasks');
  window.reviewedIds=Array.from({length:n},(_,i)=>'chat'+(990000+i));
  const ids=new Set(reviewedIds);
  for(const item of items)if(ids.has(item.id))item.folderId='folder:perf-b';
  perfApi.save('tasks',items);
 },selectionSize);
 await phase('confirm-transfers',async()=>{
  await page.getByRole('button',{name:'Правила',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Автосортировка',exact:true});
  await panel.getByRole('tab',{name:'Пересортировка',exact:true}).click();
  assert.equal(await panel.locator('.pena-automation-ticket-heading input').count(),selectionSize);
  await panel.getByRole('checkbox',{name:'Выбрать всё',exact:true}).check();
  await panel.getByRole('button',{name:'Подтвердить всё',exact:true}).click();
  await page.waitForFunction(()=>reviewedIds.every(id=>perfApi.items('tasks').find(item=>item.id===id)?.folderId==='folder:perf-a')&&!document.querySelector('.pena-automation-tickets[aria-busy]'));
  assert.equal(await panel.locator('.pena-automation-ticket-heading input').count(),0);
 });
 assert.deepEqual(errors,[]);

}finally{
 mkdirSync('tests/artifacts',{recursive:true});writeFileSync(`tests/artifacts/automation-perf-${label}-${count}.json`,JSON.stringify({label,count,runtimeSha256,modelSha256,profiling,node:process.version,browser:browser.version(),phases,errors},null,2));
 await browser.close();await server.close();
}

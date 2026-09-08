import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
import {evaluateStartupTimeBudget} from './lib/native-startup-time-budget.mjs';

// Integrated startup workload. Normal native recycled source, full accessible
// task catalog, real controlled HTTP, actual production panel/read handlers.
const root=resolve(import.meta.dirname,'..');
const extension=resolve(process.env.PENA_EXTENSION_DIR||resolve(root,'extension'));
const label=process.env.PENA_STARTUP_LABEL||'current';
const cpu=Number(process.env.PENA_STARTUP_CPU||4);
const limit=Number(process.env.PENA_STARTUP_LIMIT||180000);
const membership=process.env.PENA_STARTUP_TASK_MEMBERSHIP==='1';
const logMetadata=process.env.PENA_STARTUP_LOG_METADATA==='1';
const raw=readFileSync(resolve(extension,'injected.js'),'utf8');
const optimized=logMetadata&&raw.includes('function _loadDialogTaskCatalogPartitionTail(');
const report={label,protocol:2,source:{sha256:createHash('sha256').update(raw).digest('hex')},configuration:{tasks:4149,physicalChats:108,physicalTaskChats:92,cpu,httpMs:80,httpLanes:4,guardSampler:false,productionFlags:true},phases:[],
 limitations:['Real Chromium and local HTTP with a controlled SDK dataset, not the authenticated desktop portal.','Input field above the controlled modal models shared event-loop/HTTP contention; it is not a Bitrix modal usability assertion.','All task titles are populated; every thirteenth task and final task has an own-user elapsed row. Two RAFs measure paint opportunity, not physical display.']};
const server=await startHarnessServer();
const queue=[],transportSamples=[];let active=0;
function pump(){while(active<4&&queue.length){const job=queue.shift();active++;const began=performance.now();setTimeout(()=>{const sample={kind:job.kind,queuedMs:began-job.at,serviceMs:performance.now()-began};transportSamples.push(sample);job.response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(sample));active--;pump();},80);}}
const transport=createServer(async(request,response)=>{const url=new URL(request.url,'http://localhost');if(url.pathname==='/__latency'){queue.push({kind:url.searchParams.get('kind'),response,at:performance.now()});pump();return;}try{const upstream=await fetch(server.baseUrl+request.url);response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/octet-stream'}).end(Buffer.from(await upstream.arrayBuffer()));}catch(e){response.writeHead(500).end(String(e));}});
await new Promise(r=>transport.listen(0,'127.0.0.1',r));
const endpoint=`http://127.0.0.1:${transport.address().port}`;
function installProbe(){
 const p=window.startupProbe={startedAt:performance.now(),phase:'startup',work:{},rest:[],frames:[],longtasks:[],samples:[],observers:[],errors:[],stopped:false};
 p.wrap=(name,fn)=>function(...args){const began=performance.now();try{return fn.apply(this,args);}finally{const ms=performance.now()-began,w=p.work[name]||(p.work[name]={calls:0,ms:0,max:0});w.calls++;w.ms+=ms;w.max=Math.max(w.max,ms);}};
 let scope=null;const MO=MutationObserver;
 window.MutationObserver=class extends MO{constructor(callback){const rec={targets:[],calls:0,records:0,ms:0,max:0,queries:0};p.observers.push(rec);super((records,observer)=>{const began=performance.now(),prev=scope;scope=rec;try{return callback(records,observer);}finally{const ms=performance.now()-began;scope=prev;rec.calls++;rec.records+=records.length;rec.ms+=ms;rec.max=Math.max(rec.max,ms);}});this.rec=rec;}observe(node,options){this.rec.targets.push(node.id||node.className||node.nodeName);return super.observe(node,options);}};
 for(const proto of [Document.prototype,Element.prototype])for(const name of ['querySelector','querySelectorAll']){const old=proto[name];proto[name]=function(...args){if(scope)scope.queries++;return old.apply(this,args);};}
 let previous=0;const frame=now=>{if(p.stopped)return;if(previous&&p.frames.length<20000)p.frames.push(now-previous);previous=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 new PerformanceObserver(list=>{p.longtasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration,phase:p.phase})));}).observe({entryTypes:['longtask']});
 const summary=call=>({method:call.method,after:Number(call.params?.filter?.['>ID']||0),upper:call.params?.filter?.['<=ID'],order:call.params?.order?.ID,delta:Boolean(call.params?.filter?.['>=CHANGED_DATE']),start:Number(call.params?.start||0),select:call.params?.select?.join('|')||'',projectFilter:call.params?.filter?.GROUP_ID ?? call.params?.filter?.['>GROUP_ID'],taskId:call.method==='task.elapseditem.getlist'?String(call.params?.[0]):undefined,
   dateFrom:call.method==='task.elapseditem.getlist'?String(call.params?.[2]?.['>=CREATED_DATE']||''):undefined,dateTo:call.method==='task.elapseditem.getlist'?String(call.params?.[2]?.['<CREATED_DATE']||call.params?.[2]?.['<=CREATED_DATE']||''):undefined});
 const one=BX.rest.callMethod;
 BX.rest.callMethod=function(method,params,cb){p.rest.push({at:performance.now(),phase:p.phase,...summary({method,params})});fetch('/__latency?kind=extension').then(()=>one.call(this,method,params,cb)).catch(e=>p.errors.push(String(e)));};
 const batch=BX24.callBatch;
 BX24.callBatch=function(calls,cb){p.rest.push({at:performance.now(),phase:p.phase,method:'batch',commands:Object.values(calls).map(summary)});fetch('/__latency?kind=extension-batch').then(()=>batch.call(this,calls,cb)).catch(e=>p.errors.push(String(e)));};
 const box=document.createElement('div');box.style.cssText='position:fixed;left:800px;top:10px;width:250px;z-index:2147483647;background:white';box.innerHTML='<input id="startup-native-input" placeholder="Native message"><span id="startup-native-result"></span>';document.body.append(box);
 const input=box.querySelector('input');input.addEventListener('input',async event=>{const at=event.timeStamp,handler=performance.now(),phase=p.phase;const response=await fetch('/__latency?kind=native-input');await response.json();const complete=performance.now();box.querySelector('span').textContent=input.value;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));p.samples.push({phase,handler:handler-at,http:complete-at,paint:performance.now()-at,trusted:event.isTrusted});});
 p.snapshot=()=>({elapsedMs:performance.now()-p.startedAt,phase:p.phase,work:p.work,rest:p.rest,frames:p.frames,longtasks:p.longtasks,samples:p.samples,observers:p.observers,errors:p.errors,
  record:p.record?.(),native:window.__resumeHarness.state(),queue:window.__PENA_REST_DIAGNOSTICS__?.snapshot(),bootstrap:window.__PENA_TIME_LOAD_DIAGNOSTICS__?.snapshot(),visible:{toolbar:document.querySelector('.pena-native-time-button-label')?.textContent,total:document.querySelector('.pena-native-time-total-value')?.textContent,status:document.querySelector('.pena-native-time-read-status')?.textContent,statusHidden:document.querySelector('.pena-native-time-read-status')?.hidden,selectOptions:document.querySelectorAll('.pena-native-time-panel option').length}});
}
let fixture=readFileSync(resolve(root,'tests/native-resume-recovery-harness.html'),'utf8');
assert.equal(fixture.split('setInterval(sampleGuard, 16);').length-1,1);
fixture=fixture.replace('setInterval(sampleGuard, 16);','').replace(/^.*window\.__PENA_(?:TEST_|FORCE_REST_CATALOG).*$/gm,'').replace('const controlled = Number(delay) === 60 * 1000;','const controlled = false;').replace('#anit-filters, #anit-dialog-control-dock { display: none !important; }','');
fixture=fixture.replace('    const success = (data, options = {}) => ({',`
    const stableChangedDate=new Date(Date.now()-86400000).toISOString();
    taskEntries.forEach(task=>{task.changedDate=stableChangedDate;});
    for(let i=0;i<4149-recordsByMode.tasks.length;i++) taskEntries.push({id:String(50000+i),title:'Каталожная задача '+i+' — работа с документами и внутреннее согласование',allowTimeTracking:'Y',activityDate:stableChangedDate,changedDate:stableChangedDate});
    taskEntries.forEach((task,index)=>{task.groupId=index<149?'1':'2';});
    const selectedProjectOnly=params.get('selectedProjects')==='1';
    if(selectedProjectOnly)localStorage.setItem(timeProjectPreferenceKey,JSON.stringify({version:1,all:false,ids:['1'],includeUnassigned:false}));
    const elapsedIds=new Set(taskEntries.filter((task,index)=>index%13===0||index===4148).map(task=>task.id));
    if(${logMetadata})taskEntries.forEach(task=>{task.timeSpentInLogs=elapsedIds.has(task.id)?'60':null;});
    window.startupExpected={tasks:taskEntries.length,entries:elapsedIds.size,seconds:elapsedIds.size*60};
    const success = (data, options = {}) => ({`);
const from=fixture.indexOf("      if (method === 'tasks.task.list') {"),to=fixture.indexOf("      if (method === 'tasks.task.get')",from);
assert(from>0&&to>from);
fixture=fixture.slice(0,from)+`
      if(method==='server.time')return success(new Date().toISOString());
      if(method==='user.current')return success({ID:'7'});
      if(method==='task.elapseditem.getlist'){
        if(!Array.isArray(callParams)||callParams.length<5)throw new Error('Elapsed positional API contract violated');
        const id=String(callParams[0]),day=new Date().toISOString().slice(0,10),filter=callParams[2]||{};
        const inRange=(!filter['>=CREATED_DATE']||day>=String(filter['>=CREATED_DATE']).slice(0,10))&&(!filter['<=CREATED_DATE']||day<=String(filter['<=CREATED_DATE']).slice(0,10));
        const rows=inRange&&elapsedIds.has(id)?[{ID:String(Number(id)+100000),TASK_ID:id,USER_ID:'7',SECONDS:60,CREATED_DATE:day+'T12:00:00+00:00',DATE_START:day+'T10:00:00+00:00',COMMENT_TEXT:'Controlled entry'}]:[];
        return success(rows,{total:rows.length});
      }
      if(method==='tasks.task.list'){
        const after=Number(callParams.filter?.['>ID']||0),changed=String(callParams.filter?.['>=CHANGED_DATE']||'');
        let entries=taskEntries.map(window.timeFixtureTaskGroup).filter(task=>window.timeFixtureMatchesGroup(task,callParams.filter)&&Number(task.id)>after&&(!changed||Date.parse(task.changedDate)>=Date.parse(changed))&&(callParams.filter?.['<=ID']==null||Number(task.id)<=Number(callParams.filter['<=ID'])));
        if(callParams.order?.ID==='asc')entries=entries.slice().sort((a,b)=>Number(a.id)-Number(b.id));
        if(callParams.order?.ID==='desc')entries=entries.slice().sort((a,b)=>Number(b.id)-Number(a.id));
        const start=Math.max(0,Number(callParams.start)||0),page=entries.slice(start,start+50);
        return success({tasks:page},{next:start+page.length<entries.length?start+page.length:null,total:entries.length});
      }
`+fixture.slice(to);
fixture=fixture.replace('<script src="../extension/native-catalog.js">',`<script>(${installProbe.toString()})();</script><script src="../extension/native-catalog.js">`);
if(membership)fixture=fixture.replace('data-mode="chats">','data-mode="chats" hidden>').replace('data-mode="tasks" hidden>','data-mode="tasks">').replace("const elapsedIds=new Set", "taskEntries.forEach((task,index)=>{if(!task.chatId)task.chatId=String(5000000+index);});\n    const elapsedIds=new Set");
const names=['_syncDialogTimeUi','_getDialogTimeWorkingTaskIds','_publishDialogTimeTaskIndexRows','_runDialogNativeSilentPrefetch','_runDialogNativeOriginalScrollLoad','_syncDialogTimeTrackerClock','_refreshDialogTimeTaskCatalog','_syncDialogTaskCatalog','_loadDialogTimeRange'];
const hooks=names.filter(name=>new RegExp('function '+name+'\\(').test(raw)).map(name=>`${name}=window.startupProbe.wrap('${name}',${name});`).join('\n');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';assert.equal(raw.split(anchor).length-1,1);
const injected=raw.replace(anchor,anchor+`\n${hooks}\nwindow.startupProbe.record=()=>{const r=_getDialogTimeRecord(_getDialogTimeSelectedRange());return {status:r?.status,seconds:r?.data?.totalSeconds,entries:r?.data?.entryCount,coverage:r?.data?.coverage,complete:r?.hasCompleteSnapshot,verified:r?.hasVerifiedData,progress:r?.readProgress,taskTitles:_dialogTimeTaskTitles.size,timeCatalogCursor:_dialogTimeCatalogCursor,timeCatalogInFlight:Boolean(_dialogTimeCatalogPromise)};};`);
let model=readFileSync(resolve(extension,'native-time-control.js'),'utf8');
for(const name of ['aggregateElapsedItems','replaceElapsedTasks'])model=model.replace(new RegExp('^(\\s*)'+name+',$','m'),`$1${name}: window.startupProbe.wrap('model.${name}',${name}),`);
const browser=await chromium.launch({headless:true});let page;
const stats=values=>{const v=values.slice().sort((a,b)=>a-b);return{count:v.length,p50:v[Math.ceil(v.length*.5)-1]||0,p95:v[Math.ceil(v.length*.95)-1]||0,max:Math.max(0,...v)};};
const commands = snapshot => snapshot.rest.flatMap(call=>call.commands||[call]);
const counts = snapshot => {
 const all=commands(snapshot),elapsed=all.filter(call=>call.method==='task.elapseditem.getlist'),catalog=all.filter(call=>call.method==='tasks.task.list'&&!call.delta);
 return {elapsed:elapsed.length,uniqueElapsed:new Set(elapsed.map(call=>call.taskId)).size,fullPages:catalog.length,fullHeads:catalog.filter(call=>!call.after&&!call.start&&call.order!=='desc').length};
};
const exactRead = snapshot => {const count=counts(snapshot);return count.elapsed===(optimized?321:4149)&&count.uniqueElapsed===(optimized?321:4149)&&(optimized?count.fullPages<250:count.fullPages===83)&&count.fullHeads===1;};
try{
 if(!membership){const off=await browser.newPage({viewport:{width:1100,height:800}});
 await(await off.context().newCDPSession(off)).send('Emulation.setCPUThrottlingRate',{rate:cpu});
 await off.route('**/tests/native-resume-recovery-harness.html?*',route=>route.fulfill({contentType:'text/html',body:fixture.replace(/<script src="\.\.\/extension\/[^\"]+"><\/script>/g,'').replace(/<link rel="stylesheet" href="\.\.\/extension\/injected.css">/,'')}));
 await off.goto(endpoint+'/tests/native-resume-recovery-harness.html?autoBootstrap=1');
 for(let i=0;i<20;i++){await off.locator('#startup-native-input').press('x');await off.waitForFunction(n=>startupProbe.samples.length===n,i+1);}
 report.off=await off.evaluate(()=>startupProbe.snapshot());await off.close();}
 page=await browser.newPage({viewport:{width:1100,height:800}});const errors=collectPageErrors(page);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});await cdp.send('Performance.enable');
 await page.route('**/tests/native-resume-recovery-harness.html?*',route=>route.fulfill({contentType:'text/html',body:fixture}));
 await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:injected}));
 await page.route('**/extension/native-time-control.js',route=>route.fulfill({contentType:'application/javascript',body:model}));
 await page.goto(endpoint+'/tests/native-resume-recovery-harness.html?autoBootstrap=1');
 if(membership){
   await page.waitForTimeout(20000);report.membership20s=await page.evaluate(()=>startupProbe.snapshot());
   await page.waitForTimeout(30000);report.membership50s=await page.evaluate(()=>startupProbe.snapshot());
   report.pageErrors=errors;report.browserMetrics=(await cdp.send('Performance.getMetrics')).metrics;
   const state=report.membership50s.native.status.modeStates?.tasks;
   report.phases.push({name:'API-only task chat metadata preserves physical 92-chat proof',status:report.membership50s.record.taskTitles<4149?'INCONCLUSIVE':state?.materialization?.state==='ready'&&!state?.materialization?.needsColdConfirmation?'PASS':'FAIL'});
   console.log(JSON.stringify({label,states:state,source:report.membership50s.native.modes.tasks.sourceComplete,queries:report.membership50s.rest.length,errors}));
 }else{
 await page.locator('.pena-native-time-button').waitFor({timeout:30000});
 assert.deepEqual(await page.evaluate(()=>Object.keys(window).filter(k=>k.startsWith('__PENA_TEST_'))),[]);
 await page.locator('.pena-native-time-button').click();
 const began=Date.now();let done=false;
 while(Date.now()-began<limit){
   await page.locator('#startup-native-input').press('a',{timeout:15000});
   await page.waitForTimeout(180);
   done=await page.evaluate(()=>{const r=startupProbe.record();return r.complete&&r.taskTitles===4149&&r.entries===startupExpected.entries&&window.__resumeHarness.ready('chats');});
   if(done)break;
 }
 // Export only a small checkpoint while frame/CPU collection is active. A full
 // diagnostic snapshot crosses CDP with megabytes of native state and otherwise
 // measures the test's own serialization pause as extension frame contention.
 const checkpoint=()=>({commandCount:startupProbe.rest.reduce((sum,c)=>sum+(c.commands?.length||1),0),record:startupProbe.record(),visible:{statusHidden:document.querySelector('.pena-native-time-read-status')?.hidden}});
 report.initial=await page.evaluate(checkpoint);report.initialBrowserMetrics=(await cdp.send('Performance.getMetrics')).metrics;report.expected=await page.evaluate(()=>startupExpected);report.pageErrors=errors;
 report.phases.push({name:'integrated-first-open-complete',status:done?'PASS':'FAIL'});
 if(done){
   await page.evaluate(()=>startupProbe.phase='warm-reopen');
   await page.locator('.pena-native-time-header-actions > .pena-native-popover-close').click();
   await page.locator('.pena-native-time-button').click();
   for(let i=0;i<20;i++){await page.locator('#startup-native-input').press('b');await page.waitForTimeout(150);}
   report.warm=await page.evaluate(checkpoint);
 }
 await page.waitForTimeout(250);
 report.final=await page.evaluate(()=>{startupProbe.stopped=true;return startupProbe.snapshot();});report.browserMetrics=(await cdp.send('Performance.getMetrics')).metrics;
 report.statistics={frames:stats(report.final.frames),input:stats(report.final.samples.map(s=>s.handler)),http:stats(report.final.samples.map(s=>s.http)),paint:stats(report.final.samples.map(s=>s.paint))};
 report.budgets=evaluateStartupTimeBudget(report.final,report.off,report.browserMetrics);
 report.requestCounts={earlyOpen:counts(report.final)};
 report.phases.push({name:'early open reads all tasks exactly once through one full task catalog',status:exactRead(report.final)?'PASS':'FAIL'});
 const warmExtra=report.warm?commands(report.final).slice(report.initial.commandCount,report.warm.commandCount):[];
 report.phases.push({name:'warm reopen has complete cached totals, no elapsed rereads and no full catalog',status:done&&report.warm.record.seconds===19260&&report.warm.visible.statusHidden===true&&!warmExtra.some(c=>c.method==='task.elapseditem.getlist'||c.method==='tasks.task.list'&&!c.delta)?'PASS':'FAIL'});
 report.phases.push({name:'native physical source remains exactly 108 chats and one materialization pass',status:report.final.native.modes.chats.sourceComplete&&report.final.native.status.modeStates.chats.materialization.nativePassCount===1?'PASS':'FAIL'});
 report.phases.push({name:'paired native interaction and browser CPU budgets',status:report.budgets.every(b=>b.pass)?'PASS':'FAIL'});
 assert(report.final.samples.length>=20&&report.off.samples.length===20&&report.final.samples.every(s=>s.trusted),'Real trusted input samples must complete in both arms');
 report.transport=transportSamples;
 console.log(JSON.stringify({label,complete:done,elapsedMs:report.final.elapsedMs,record:report.final.record,work:report.final.work,statistics:report.statistics,longtasks:report.final.longtasks.length,pageErrors:errors}));
 if(done){
   const toggle=page.locator('.pena-native-time-tracked-toggle');
   if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
   const restBefore=await page.evaluate(()=>startupProbe.rest.length);
   const firstCount=await page.locator('.pena-native-time-tracked-list > .pena-native-time-entry-row').count();
   let clicks=0;
   while(await page.locator('.pena-native-time-load-more').count()&&clicks<10){await page.locator('.pena-native-time-load-more').click();clicks++;await page.waitForTimeout(80);}
   const finalCount=await page.locator('.pena-native-time-tracked-list > .pena-native-time-entry-row').count();
   const extra=await page.evaluate(n=>startupProbe.rest.slice(n).flatMap(c=>c.commands||[c]),restBefore);
   report.entryPagination={firstCount,clicks,finalCount,extraRequests:extra};
   report.phases.push({name:'all 321 loaded entries remain accessible through actual UI without new elapsed requests',status:finalCount===report.expected.entries&&!extra.some(c=>c.method==='task.elapseditem.getlist')?'PASS':'FAIL'});
 }
 await page.close();
 page=await browser.newPage({viewport:{width:1100,height:800}});const closedErrors=collectPageErrors(page);
 await(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:cpu});
 await page.route('**/tests/native-resume-recovery-harness.html?*',route=>route.fulfill({contentType:'text/html',body:fixture}));
 await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:injected}));
 await page.route('**/extension/native-time-control.js',route=>route.fulfill({contentType:'application/javascript',body:model}));
 await page.goto(endpoint+'/tests/native-resume-recovery-harness.html?autoBootstrap=1');
 const hasBootstrap=await page.evaluate(()=>Boolean(window.__PENA_TIME_LOAD_DIAGNOSTICS__));
 if(hasBootstrap){
   // Native auto-scrolling deliberately yields to trusted user activity. This
   // separate control lets that first physical walk finish, then types during
   // the expensive catalog/elapsed preload while the time panel stays closed.
   await page.waitForFunction(()=>__resumeHarness.ready('chats'),undefined,{timeout:30000});
   report.closedPhysicalBeforeTyping=await page.evaluate(()=>({sourceComplete:__resumeHarness.sourceComplete('chats'),native:__PENA_NATIVE_PREFETCH__.status().modeStates.chats.materialization,phase:__PENA_TIME_LOAD_DIAGNOSTICS__.snapshot()}));
   const closedStart=Date.now();let complete=false;
   while(Date.now()-closedStart<limit){await page.locator('#startup-native-input').press('c');await page.waitForTimeout(180);complete=await page.evaluate(()=>{const r=startupProbe.record();return r.complete&&r.taskTitles===4149&&r.entries===startupExpected.entries&&__resumeHarness.ready('chats');});if(complete)break;}
   report.closed=await page.evaluate(()=>startupProbe.snapshot());
   report.requestCounts.closed=counts(report.closed);
   report.phases.push({name:'closed first startup completes catalog and today before panel open',status:complete&&exactRead(report.closed)&&report.closed.visible.toolbar==='Сегодня 5:21'?'PASS':'FAIL'});
   await page.locator('.pena-native-time-button').click();await page.waitForTimeout(700);
   report.closedThenOpen=await page.evaluate(()=>startupProbe.snapshot());
   const extra=report.closedThenOpen.rest.slice(report.closed.rest.length).flatMap(c=>c.commands||[c]);
   report.phases.push({name:'first panel open after background completion uses cached full total without elapsed/full catalog requests',status:complete&&report.closedThenOpen.record.seconds===report.expected.seconds&&!extra.some(c=>c.method==='task.elapseditem.getlist'||c.method==='tasks.task.list'&&!c.delta)?'PASS':'FAIL'});
 }else{report.phases.push({name:'closed first startup completes catalog and today before panel open',status:'FAIL',reason:'Runtime has no automatic today bootstrap; old101 baseline negative control.'});}
 report.closedPageErrors=closedErrors;
 // The same 4149-task portal with one project selected must avoid every
 // excluded elapsed request. Native physical completeness remains unchanged.
 await page.close();
 page=await browser.newPage({viewport:{width:1100,height:800}});const selectedErrors=collectPageErrors(page);
 await(await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:cpu});
 await page.route('**/tests/native-resume-recovery-harness.html?*',route=>route.fulfill({contentType:'text/html',body:fixture}));
 await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:injected}));
 await page.route('**/extension/native-time-control.js',route=>route.fulfill({contentType:'application/javascript',body:model}));
 await page.goto(endpoint+'/tests/native-resume-recovery-harness.html?autoBootstrap=1&selectedProjects=1');
 await page.waitForFunction(()=>__resumeHarness.ready('chats')&&startupProbe.record().complete,undefined,{timeout:60000});
 report.selected=await page.evaluate(()=>startupProbe.snapshot());
 const selectedCalls=commands(report.selected),selectedElapsed=selectedCalls.filter(call=>call.method==='task.elapseditem.getlist');
 const selectedCatalog=selectedCalls.filter(call=>call.method==='tasks.task.list'&&Array.isArray(call.projectFilter));
 report.projectSavings={allElapsed:report.requestCounts.closed.elapsed,selectedElapsed:selectedElapsed.length,elapsedReduction:report.requestCounts.closed.elapsed/selectedElapsed.length,allMs:report.closed.elapsedMs,selectedMs:report.selected.elapsedMs,selectedErrors};
 report.phases.push({name:'selected project reads its 149-task catalog once and skips only proven empty logs',status:selectedElapsed.length===(optimized?12:149)&&new Set(selectedElapsed.map(call=>call.taskId)).size===(optimized?12:149)&&selectedCatalog.length===3&&selectedCatalog.every(call=>JSON.stringify(call.projectFilter)==='["1"]')&&report.selected.record.seconds===720&&selectedErrors.length===0?'PASS':'FAIL'});
 const selectedBefore=selectedElapsed.length;
 await page.locator('.pena-native-time-button').click();await page.waitForTimeout(350);
 const selectedAfter=await page.evaluate(()=>startupProbe.snapshot());
 report.phases.push({name:'selected project first panel open keeps the automatic initial total without recount',status:commands(selectedAfter).filter(call=>call.method==='task.elapseditem.getlist').length===selectedBefore&&selectedAfter.record.seconds===720&&selectedAfter.visible.statusHidden?'PASS':'FAIL'});
 if(process.env.PENA_STARTUP_REPORT_ONLY!=='1'){assert(done,'Initial full task/time/native completion');assert.deepEqual(errors,[]);assert.deepEqual(closedErrors,[]);assert.equal(report.final.record.seconds,report.expected.seconds);assert(report.phases.every(p=>p.status==='PASS'),JSON.stringify(report.phases));}
 }
}catch(error){report.failure=String(error);if(page)report.last=await page.evaluate(()=>startupProbe?.snapshot()).catch(()=>null);throw error;}
finally{writeFileSync(resolve(root,`tests/artifacts/native-startup-time-${label}.json`),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(r=>transport.close(r));await server.close();}

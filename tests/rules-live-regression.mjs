import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer} from './lib/harness-server.mjs';

const source=readFileSync(process.env.PENA_RULES_SOURCE || 'extension/injected.js','utf8');
const injected=source.replace('\tasync function boot() {',`\tasync function boot() {
 window.liveRules={items:_getDialogControlItemsForMode,save:_saveDialogControlItemsForMode,key:_dialogAutomationKey,
 seed:meta=>_setDialogRecentMeta(_dialogRecentMeta,meta),get:_getDialogRecentMeta,
 schedule:_scheduleDialogAutomation,tickets:_dialogAutomationTickets,select:_setDialogControlNativeActiveFolderId};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),results=[];
async function scenario(name,run){
 if(process.env.PENA_RULES_SCENARIO&&!name.includes(process.env.PENA_RULES_SCENARIO))return;
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:injected}));
  await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&passThrough=1&lazyNative=1&skipInitialMount=1');
  await page.waitForFunction(()=>window.liveRules&&window.nativeCustomEventHandlers.get('onPullEvent-tasks')?.length);
  await page.evaluate(()=>{
   window.liveTaskRecords={};window.liveRequests=[];window.liveHeld=[];window.liveListRequests=[];
   const original=BX.rest.callMethod;
   BX.rest.callMethod=function(method,params,callback){
    if(method==='tasks.task.list' && Array.isArray(params.filter?.ID)){
     liveListRequests.push([...params.filter.ID]);
     const tasks=params.filter.ID.map(id=>liveTaskRecords[id]).filter(Boolean).map(task=>structuredClone(task));
     const deliver=()=>callback({error:()=>window.liveListError||null,data:()=>({tasks})});
     if(window.liveListHold)liveHeld.push(deliver);else deliver();return;
    }
    if(method==='tasks.task.get' && liveTaskRecords[String(params.taskId)]){
     const task=structuredClone(liveTaskRecords[String(params.taskId)]);liveRequests.push(String(params.taskId));
     const deliver=()=>callback({error:()=>null,data:()=>({task})});
     if(window.liveHold)liveHeld.push(deliver);else deliver();return;
    }
    if(method==='im.dialog.get'&&params.DIALOG_ID==='chat99003'){
     callback({error:()=>null,data:()=>({id:99003,entity_type:'TASKS',entity_id:'88003'})});return;
    }
    return original.call(this,method,params,callback);
   };
   window.liveEmit=(id,fields={},command='task_update')=>{
    for(const fn of nativeCustomEventHandlers.get('onPullEvent-tasks')||[])fn(command,{TASK_ID:id,FIELDS_AFTER:{ID:id,...fields}});
   };
   const items=liveRules.items('tasks');
   liveRules.save('tasks',[...items,{id:'folder:live-a',type:'folder',title:'В работе'},{id:'folder:live-b',type:'folder',title:'Готово'}]);
   window.liveConfigure=(auto=true)=>localStorage.setItem(liveRules.key('tasks'),JSON.stringify({version:1,excludedIds:[],autoAcceptTransfers:auto,rules:[
    {id:'live-a',enabled:true,folderId:'folder:live-a',match:'all',conditions:[{field:'status',op:'eq',value:'3'}]},
    {id:'live-b',enabled:true,folderId:'folder:live-b',match:'all',conditions:[{field:'status',op:'eq',value:'5'}]}
   ]}));
   window.liveSeed=(id,taskId,status='3')=>{
    liveRules.seed({id,taskId,isTask:true,displayTitle:'Live task',automationFacts:{title:'Live task',status},availability:'available'});
    liveRules.save('tasks',[...liveRules.items('tasks').filter(x=>x.id!==id),{id,taskId,title:'Live task',folderId:'folder:live-a',automationHandled:true}]);
   };
   liveConfigure();
  });
  await run(page);assert.deepEqual(errors,[]);results.push({name,passed:true});
 }catch(error){results.push({name,passed:false,error:String(error.stack),state:await page.evaluate(()=>({requests:window.liveRequests,items:window.liveRules?.items('tasks').filter(x=>/^chat99/.test(x.id)).map(x=>({...x,meta:liveRules.get(x.id)}))})).catch(()=>null)});}finally{await page.close();console.log(JSON.stringify(results.at(-1)));}
}
const placed=(page,id,folder)=>page.waitForFunction(({id,folder})=>liveRules.items('tasks').find(x=>x.id===id)?.folderId===folder,{id,folder},{timeout:10000});
try{
 await scenario('missed Pull refreshes a previously assigned task on resume',async page=>{
  await page.evaluate(()=>{
   liveSeed('chat99006','88006');
   liveRules.seed({id:'chat99006',taskId:'88006',isTask:true,displayTitle:'Owner changed while closed',automationFacts:{title:'Owner changed while closed',responsibleId:'7'},taskCatalogFetchedAt:Date.now()-3600000,availability:'available'});
   liveTaskRecords['88006']={id:'88006',chatId:'99006',title:'Owner changed while closed',responsibleId:'8'};
   localStorage.setItem(liveRules.key('tasks'),JSON.stringify({version:1,excludedIds:[],autoAcceptTransfers:false,rules:[
    {id:'owner-a',enabled:true,folderId:'folder:live-a',match:'all',conditions:[{field:'responsibleId',op:'eq',value:'7'}]},
    {id:'owner-b',enabled:true,folderId:'folder:live-b',match:'all',conditions:[{field:'responsibleId',op:'eq',value:'8'}]}
   ]}));
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(()=>liveRules.tickets('tasks').some(([id,r])=>id==='chat99006'&&r.ticket.to==='folder:live-b'));
  assert.equal(await page.evaluate(()=>liveRules.items('tasks').find(x=>x.id==='chat99006').folderId),'folder:live-a');
  assert.equal(await page.evaluate(()=>liveRequests.length),0);
 });
 await scenario('quiet portal refreshes completed facts periodically without Pull',async page=>{
  await page.clock.install();
  await page.evaluate(()=>{liveSeed('chat99007','88007');liveTaskRecords['88007']={id:'88007',chatId:'99007',status:'3'};liveRules.schedule();});
  await page.waitForFunction(()=>liveListRequests.some(ids=>ids.includes('88007')));
  await page.waitForTimeout(600);
  await page.evaluate(()=>{
   liveTaskRecords['88007'].status='5';
   liveRules.seed({...liveRules.get('chat99007'),fetchedAt:Date.now(),taskCatalogFetchedAt:Date.now()});
  });
  await page.clock.fastForward(121000);
  await placed(page,'chat99007','folder:live-b');
  assert.equal(await page.evaluate(()=>liveListRequests.filter(ids=>ids.includes('88007')).length),2);
 });
 await scenario('background reconciliation is batched and respects exclusions',async page=>{
  await page.evaluate(()=>{
   liveConfigure(false);
   for(let i=0;i<65;i++){
    const taskId=String(88200+i),id='chat'+(99200+i);
    liveSeed(id,taskId);liveTaskRecords[taskId]={id:taskId,chatId:id.slice(4),status:'5'};
   }
   localStorage.setItem(liveRules.key('tasks')+'.locks',JSON.stringify(['chat99200']));
   liveRules.schedule();
  });
  await page.waitForFunction(()=>liveRules.tickets('tasks').filter(([id])=>/^chat992/.test(id)).length===64,null,{timeout:15000});
  assert.ok(await page.evaluate(()=>liveListRequests.every(ids=>ids.length<=50&&!ids.includes('88200'))));
  assert.equal(await page.evaluate(()=>liveRules.items('tasks').find(x=>x.id==='chat99200').folderId),'folder:live-a');
 });
 await scenario('failed background read preserves placement and retries with backoff',async page=>{
  await page.clock.install();
  await page.evaluate(()=>{liveSeed('chat99008','88008');liveTaskRecords['88008']={id:'88008',chatId:'99008',status:'5'};liveListError={error:'TEMPORARY_ERROR'};liveRules.schedule();});
  await page.waitForFunction(()=>liveListRequests.some(ids=>ids.includes('88008')));
  await page.waitForTimeout(600);
  await page.clock.fastForward(30000);
  assert.equal(await page.evaluate(()=>liveListRequests.filter(ids=>ids.includes('88008')).length),1);
  assert.equal(await page.evaluate(()=>liveRules.items('tasks').find(x=>x.id==='chat99008').folderId),'folder:live-a');
  await page.evaluate(()=>{liveListError=null;});
  await page.clock.fastForward(31000);
  await placed(page,'chat99008','folder:live-b');
 });
 await scenario('Pull during background audit fences the older list response',async page=>{
  await page.evaluate(()=>{liveSeed('chat99009','88009');liveTaskRecords['88009']={id:'88009',chatId:'99009',status:'5'};liveListHold=true;liveRules.schedule();});
  await page.waitForFunction(()=>liveHeld.length===1);
  await page.evaluate(()=>{liveTaskRecords['88009'].status='3';liveEmit('88009');liveListHold=false;liveHeld.splice(0).forEach(fn=>fn());});
  await page.waitForFunction(()=>liveRequests.includes('88009'));
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(()=>liveRules.items('tasks').find(x=>x.id==='chat99009').folderId),'folder:live-a');
 });
 await scenario('offline pause resumes reconciliation without changing manual preference',async page=>{
  await page.clock.install();
  await page.evaluate(()=>{
   Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});
   liveConfigure(false);liveSeed('chat99010','88010');liveTaskRecords['88010']={id:'88010',chatId:'99010',status:'5'};liveRules.schedule();
  });
  await page.clock.fastForward(125000);
  assert.equal(await page.evaluate(()=>liveListRequests.length),0);
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));});
  await page.waitForFunction(()=>liveRules.tickets('tasks').some(([id,r])=>id==='chat99010'&&r.ticket.to==='folder:live-b'));
  assert.equal(await page.evaluate(()=>liveRules.items('tasks').find(x=>x.id==='chat99010').folderId),'folder:live-a');
 });
 await scenario('a missing task is not marked fresh and recovers on the next retry',async page=>{
  await page.clock.install();
  await page.evaluate(()=>{liveSeed('chat99011','88011');liveRules.schedule();});
  await page.waitForFunction(()=>liveListRequests.some(ids=>ids.includes('88011')));
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(()=>liveRules.items('tasks').find(x=>x.id==='chat99011').folderId),'folder:live-a');
  await page.evaluate(()=>{liveTaskRecords['88011']={id:'88011',chatId:'99011',status:'5'};});
  await page.clock.fastForward(61000);
  await placed(page,'chat99011','folder:live-b');
 });
 await scenario('partial Pull rereads all conditions and moves an existing task',async page=>{
  await page.evaluate(()=>{liveSeed('chat99001','88001');liveTaskRecords['88001']={id:'88001',chatId:'99001',title:'Changed title',status:'5'};liveEmit('88001',{TITLE:'Changed title'});});
  await placed(page,'chat99001','folder:live-b');
  assert.equal(await page.evaluate(()=>liveRequests.filter(id=>id==='88001').length),1);
 });
 await scenario('task_add before native insertion hydrates and assigns the new task',async page=>{
  await page.evaluate(()=>{liveTaskRecords['88002']={id:'88002',chatId:'99002',title:'New task',status:'3'};liveEmit('88002',{},'task_add');});
  await placed(page,'chat99002','folder:live-a');
 });
 await scenario('native arrival without a task ID resolves the chat and assigns it',async page=>{
  await page.evaluate(()=>{
   liveTaskRecords['88003']={id:'88003',chatId:'99003',title:'Native new task',status:'3'};
   const list=document.querySelector('.task-host .bx-im-list-container-task__elements');
   const row=list.querySelector('[data-id]').cloneNode(true);row.dataset.id='chat99003';row.removeAttribute('data-task-id');
   row.querySelector('.bx-im-chat-title__text').textContent='Native new task';list.append(row);
  });
  await placed(page,'chat99003','folder:live-a');
  await page.evaluate(()=>liveRules.select('folder:live-a'));
  const row=page.locator('.task-host [data-id="chat99003"]');await row.waitFor({state:'visible'});
  await page.evaluate(()=>{liveTaskRecords['88003'].status='5';liveEmit('88003',{TITLE:'Native new task'});});
  await placed(page,'chat99003','folder:live-b');await row.waitFor({state:'hidden'});
  await page.evaluate(()=>liveRules.select('folder:live-b'));await row.waitFor({state:'visible'});
 });
 await scenario('live refresh covers every mutable rule field',async page=>{
  const ids=await page.evaluate(()=>{
   const fields={title:['Before','After'],responsibleId:['7','8'],createdBy:['7','8'],accomplices:[['7'],['8']],auditors:[['7'],['8']],groupId:['1','2'],priority:['0','2'],deadline:['2099-01-01T00:00:00Z','2000-01-01T00:00:00Z']};
   const rules=[],ids=[];
   Object.entries(fields).forEach(([field,[before,after]],index)=>{
    const taskId=String(88100+index),id='chat'+(99100+index),title=field==='title'?'Before':'Field '+field;
    liveSeed(id,taskId);liveRules.seed({id,taskId,isTask:true,displayTitle:title,automationFacts:{title,[field]:before},availability:'available'});
    rules.push({id:field,enabled:true,folderId:'folder:live-b',match:'all',conditions:[{field:'title',op:'eq',value:field==='title'?'After':title},{field,op:field==='deadline'?'overdue':'eq',value:Array.isArray(after)?after[0]:after}]});
    liveTaskRecords[taskId]={id:taskId,chatId:id.slice(4),title,status:'3',[field]:after};ids.push(id);
   });
   localStorage.setItem(liveRules.key('tasks'),JSON.stringify({version:1,rules,excludedIds:[],autoAcceptTransfers:true}));
   ids.forEach((id,index)=>liveEmit(String(88100+index),{}));return ids;
  });
  for(const id of ids)await placed(page,id,'folder:live-b');
 });
 await scenario('a newer event fences an old detail response and triggers one successor',async page=>{
  await page.evaluate(()=>{liveSeed('chat99004','88004');liveTaskRecords['88004']={id:'88004',chatId:'99004',status:'5'};liveHold=true;liveEmit('88004');});
  await page.waitForFunction(()=>liveHeld.length===1);
  await page.evaluate(()=>{liveTaskRecords['88004'].status='3';liveEmit('88004');liveHold=false;liveHeld.splice(0).forEach(fn=>fn());});
  await page.waitForFunction(()=>liveRequests.filter(id=>id==='88004').length===2);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(()=>liveRules.items('tasks').find(x=>x.id==='chat99004').folderId),'folder:live-a');
 });
 await scenario('manual confirmation stays required when auto acceptance is disabled',async page=>{
  await page.evaluate(()=>{liveConfigure(false);liveSeed('chat99005','88005');liveTaskRecords['88005']={id:'88005',chatId:'99005',status:'5'};liveEmit('88005',{TITLE:'Changed'});});
  await page.waitForFunction(()=>liveRules.tickets('tasks').some(([id,r])=>id==='chat99005'&&r.ticket.to==='folder:live-b'));
  assert.equal(await page.evaluate(()=>liveRules.items('tasks').find(x=>x.id==='chat99005').folderId),'folder:live-a');
 });
}finally{
 await browser.close();await server.close();mkdirSync('tests/artifacts',{recursive:true});
 writeFileSync(process.env.PENA_RULES_REPORT||'tests/artifacts/rules-live.json',JSON.stringify(results,null,2));
}
assert.ok(results.every(x=>x.passed));

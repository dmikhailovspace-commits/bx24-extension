import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {pathToFileURL} from 'node:url';

const require=createRequire(import.meta.url);
const model=require('../extension/native-catalog.js');
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');

function harness() {
 const storage=new Map(),metas=new Map(),timers=[],requests=[];
 const items={chats:[],tasks:[{id:'folder:a',type:'folder'},{id:'folder:b',type:'folder'}]};
 let now=Date.parse('2026-11-05T12:00:00Z'),scope='preview.invalid~1';
 const context={
  window:{__PENA_NATIVE_CATALOG__:model},Date:class extends Date {static now(){return now;}},
  localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  document:{hidden:false,visibilityState:'visible',dispatchEvent(){},querySelectorAll:()=>[]},navigator:{onLine:true},Event:class {},
  setTimeout:(callback,delay)=>{const timer={callback,delay,at:now+delay};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;},
  _getDialogTimeIdentityScopeKey:()=>scope,_pMode:()=> 'tasks',_getDialogRecentMeta:id=>metas.get(id),
  _isPenaExtensionEnabled:()=>true,_getDialogRecentUniqueMeta:()=>[...metas.values()],_dialogRecentMeta:metas,
  _setDialogRecentMeta:(target,meta)=>target.set(meta.id,meta),_scheduleDialogRecentCacheWrite(){},
  _isDialogControlFolder:item=>item.type==='folder',_isDialogControlItemUnavailable:item=>!!item.unavailable,
  _getDialogControlItemsForMode:mode=>items[mode],_saveDialogControlItemsForMode(){},_notifyDialogRecentDataChanged(){},_dialogControlNativeViewSig:'',
  _callBxRestMethod:(method,args)=>new Promise((resolve,reject)=>requests.push({method,args,resolve,reject})),_extractTaskRecordFromData:data=>data.task,
  _dialogTimeTaskTitles:new Map(),_dialogTimePendingTaskTitles:new Map(),_dialogTimeTaskIdsByChatDialogId:new Map(),
  _dialogTimeTaskTitleTimer:null,_markDialogRecentRepositoryDirty(){},_dialogRecentDataRevision:0,_queueDialogTimeUiSync(){},normId:id=>id,
  _getDialogNativeSharedAuditScopeKey:()=>scope,_dialogTaskCatalogSyncFlights:new Map(),_isDialogTaskCatalogMetadataFresh:()=>false,
  _dialogTimeTaskRevisions:new Map(),_DIALOG_TASK_CATALOG_MAX_PAGES:10,_DIALOG_TASK_CATALOG_PAGE_SIZE:50,_DIALOG_RECENT_PAGE_DELAY_MS:10,
  _callBxRestPageWithTimeout:(method,args)=>new Promise((resolve,reject)=>requests.push({method,args,resolve,reject})),
  _extractDialogTaskCatalogRows:data=>data.tasks,_getDialogTaskKeysetCursor:rows=>Number(rows.at(-1)?.id||0),_publishDialogTimeTaskIndexRows(){},
  findContainer:()=>null,_dialogTaskCatalogComplete:false,_dialogTaskCatalogFetchedAt:0,_dialogTaskCatalogScopeKey:'',
  _dialogTaskCatalogLastResult:null,_dialogTaskCatalogSyncPromise:null,_dialogTaskCatalogSyncScopeKey:'',
  _readDialogTaskTimeTrackingFlag:()=>null,_parseDialogRecentDate:()=>0,_buildTaskUrl:id=>'/task/'+id,_normalizeDialogControlRestDialogId:id=>id,
  _hydrateAllDialogControlModesFromRecent:()=>0,_markDialogRecentRepositoryFullCommit(){}
 };
 const start=source.indexOf('\tlet _dialogAutomationTimer = null;'),end=source.indexOf('\tfunction _openDialogAutomation(',start);
 const titleStart=source.indexOf('\tfunction _queueDialogTimeTaskTitle('),titleEnd=source.indexOf('\tfunction _getDialogTimeNativeTaskMutation(',titleStart);
 const catalogStart=source.indexOf('\tfunction _mergeDialogTaskCatalogRows('),catalogEnd=source.indexOf('\tasync function _runDialogRecentApiCatalogLoad(',catalogStart);
 runInNewContext(source.slice(start,end)+source.slice(titleStart,titleEnd)+source.slice(catalogStart,catalogEnd)+'\nthis.api={apply:_applyDialogAutomation,receive:_receiveDialogAutomationTask,schedule:_scheduleDialogAutomation,tickets:_dialogAutomationTickets,facts:_dialogAutomationFacts,title:_queueDialogTimeTaskTitle,syncCatalog:_syncDialogTaskCatalog,commitCatalog:_commitDialogTaskCatalogResult};',context);
 const key=()=>`pena.automation.v1.${scope}.tasks`;
 function rules(values){storage.set(key(),JSON.stringify({version:1,rules:values.map(([field,op,value,folderId='folder:a'],i)=>({id:'r'+i,enabled:true,folderId,match:'all',conditions:[{field,op,value}]})),excludedIds:[]}));}
 function task(facts={},extra={}){const item={id:'chat1',taskId:'1',title:'Original task',...extra};items.tasks.push(item);metas.set(item.id,{id:item.id,taskId:item.taskId,displayTitle:item.title,automationFacts:facts});return item;}
 function next(){timers.sort((a,b)=>a.at-b.at);let timer;while((timer=timers.shift())?.cancelled){}if(!timer)return null;now=timer.at;return {timer,result:timer.callback()};}
 return {context,api:context.api,storage,metas,items,requests,timers,rules,task,next,setScope:value=>{scope=value;}};
}

export async function verifyRulesRuntimePreview() {
 const results=[];
 async function check(name,fn){try{await fn();results.push({name,passed:true});}catch(error){results.push({name,passed:false,error:error.message});}}
 await check('A native title mutation updates title-rule facts and creates a safe proposal',()=>{
  const h=harness();h.rules([['title','eq','Original task','folder:a'],['title','eq','Renamed task','folder:b']]);
  const item=h.task({title:'Original task'});h.api.apply('tasks',h.items.tasks);assert.equal(item.folderId,'folder:a');
  h.api.title('1','Renamed task');h.next();
  assert.equal(h.api.facts(item).title,'Renamed task','Fresh native rename must not be shadowed by automationFacts.title');
  h.api.apply('tasks',h.items.tasks);assert.equal(item.folderId,'folder:a');assert.equal(h.api.tickets('tasks')[0][1].ticket.to,'folder:b');
 });
 await check('A transient detail-read error retries on a quiet portal and eventually sorts',async()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);const item=h.task();h.api.schedule();
  let run=h.next();assert.equal(h.requests.length,1);h.requests.shift().reject(new Error('temporary offline'));await run.result;
  for(let i=0;i<5&&!h.requests.length;i++){run=h.next();if(!run)break;if(!h.requests.length)await run.result;}
  assert.equal(h.requests.length,1,'Unresolved metadata must receive a bounded retry without another message or page reload');
  h.requests.shift().resolve({task:{id:'1',responsibleId:'7'}});await run.result;
  h.api.apply('tasks',h.items.tasks);assert.equal(item.folderId,'folder:a');
 });
 await check('A newer Pull update wins over an in-flight task detail response',async()=>{
  const h=harness();h.rules([['responsibleId','eq','7'],['responsibleId','eq','8','folder:b']]);const item=h.task();
  h.api.schedule();const run=h.next();h.api.receive('1',{RESPONSIBLE_ID:'8'});
  h.requests.shift().resolve({task:{id:'1',responsibleId:'7'}});await run.result;
  assert.equal(h.api.facts(item).responsibleId,'8');h.api.apply('tasks',h.items.tasks);assert.equal(item.folderId,'folder:b');
 });
 await check('A response from the previous account cannot write task facts',async()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);const item=h.task();h.api.schedule();const run=h.next();
  h.setScope('other.invalid~99');h.requests.shift().resolve({task:{id:'1',responsibleId:'7'}});await run.result;
  assert.equal(h.api.facts(item).responsibleId,undefined);assert.equal(item.folderId,undefined);
 });
 await check('A late catalog response cannot overwrite a newer Pull owner or title',async()=>{
  const h=harness();h.rules([['responsibleId','eq','7'],['responsibleId','eq','8','folder:b']]);const item=h.task({responsibleId:'7',title:'Original task'});
  const running=h.api.syncCatalog({force:true,headOnly:true});assert.equal(h.requests.length,1);
  h.api.receive('1',{RESPONSIBLE_ID:'8',TITLE:'Latest title'});
  h.requests.shift().resolve({data:{tasks:[{id:'1',chatId:'1',title:'Original task',responsibleId:'7'}],hasMore:false},total:1});await running;
  assert.equal(h.api.facts(item).responsibleId,'8','A slow catalog snapshot cannot undo the newer Pull owner');assert.equal(h.api.facts(item).title,'Latest title');
 });
 await check('Deferred catalog commit also preserves Pull changes made after the fetch',async()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);const item=h.task({responsibleId:'7'});
  const running=h.api.syncCatalog({force:true,headOnly:true,deferMerge:true});
  h.requests.shift().resolve({data:{tasks:[{id:'1',chatId:'1',title:'Original task',responsibleId:'7'}],hasMore:false},total:1});const result=await running;
  h.api.receive('1',{RESPONSIBLE_ID:'8'});h.api.commitCatalog(result);
  assert.equal(h.api.facts(item).responsibleId,'8','Saving rules must not restore stale task facts from its activation snapshot');
 });
 await check('An uncontested catalog update supplies unknown facts and sorts a new task',async()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);const item=h.task();
  const running=h.api.syncCatalog({force:true,headOnly:true});
  h.requests.shift().resolve({data:{tasks:[{id:'1',chatId:'1',title:'Catalog title',responsibleId:'7'}],hasMore:false},total:1});await running;
  assert.equal(h.api.facts(item).title,'Catalog title');assert.equal(h.api.facts(item).responsibleId,'7');
  assert.equal(h.api.apply('tasks',h.items.tasks),1);assert.equal(item.folderId,'folder:a');
 });
 await check('A paused old-account catalog fetch is discarded',async()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);const item=h.task();
  const running=h.api.syncCatalog({force:true,headOnly:true});h.setScope('other.invalid~99');
  h.requests.shift().resolve({data:{tasks:[{id:'1',chatId:'1',title:'Wrong account',responsibleId:'7'}],hasMore:false},total:1});const result=await running;
  assert.equal(result.discarded,true);assert.equal(h.api.facts(item).responsibleId,undefined);
 });
 await check('Dirty task facts suppress previous tickets until a verified fresh read',()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);const item=h.task({responsibleId:'7'},{folderId:'folder:b'});
  h.api.apply('tasks',h.items.tasks);assert.equal(h.api.tickets('tasks').length,1);
  h.api.receive('1',{});h.api.apply('tasks',h.items.tasks);assert.equal(h.api.tickets('tasks').length,0);assert.equal(item.folderId,'folder:b');
 });
 await check('A known nonmatch becoming a match requires confirmation, not an automatic move',()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);const item=h.task({responsibleId:'8'});
  assert.equal(h.api.apply('tasks',h.items.tasks),0);assert.equal(h.api.tickets('tasks').length,0);
  h.api.receive('1',{RESPONSIBLE_ID:'7'});assert.equal(h.api.apply('tasks',h.items.tasks),0);
  assert.equal(item.folderId,undefined);assert.equal(h.api.tickets('tasks')[0][1].ticket.to,'folder:a');
 });
 await check('Unknown facts resolving for a fresh arrival still allow its first automatic placement',()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);const item=h.task();
  assert.equal(h.api.apply('tasks',h.items.tasks),0);assert.equal(h.api.tickets('tasks').length,0);
  h.api.receive('1',{RESPONSIBLE_ID:'7'});assert.equal(h.api.apply('tasks',h.items.tasks),1);
  assert.equal(item.folderId,'folder:a');assert.equal(h.api.tickets('tasks').length,0);
 });
 await check('Repeated failures back off and cap retries at five minutes',async()=>{
  const h=harness();h.rules([['responsibleId','eq','7']]);h.task();h.api.schedule();
  const starts=[];
  for(let failure=0;failure<5;failure++){
   let run;
   for(let step=0;step<6&&!h.requests.length;step++){run=h.next();assert.ok(run);if(!h.requests.length)await run.result;}
   starts.push(h.context.Date.now());assert.equal(h.requests.length,1);h.requests.shift().reject(new Error('temporary failure'));await run.result;
  }
  const gaps=starts.slice(1).map((at,i)=>at-starts[i]);
  for(let i=0;i<gaps.length;i++)assert.ok(gaps[i]>=Math.min(300000,60000*2**i)&&gaps[i]<=Math.min(300000,60000*2**i)+1000,`Retry gap ${gaps[i]}`);
 });
 return results;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const results=await verifyRulesRuntimePreview();
 for(const result of results)console.log(`${result.passed?'PASS':'FAIL'} ${result.name}${result.error?'\n  '+result.error:''}`);
 if(results.some(result=>!result.passed))process.exitCode=1;
}

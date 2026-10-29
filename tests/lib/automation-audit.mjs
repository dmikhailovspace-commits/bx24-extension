import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

export async function verifyAutomationAudit(model,injectedSource) {
 const now=Date.parse('2026-10-29T12:00:00Z');
 const check=(field,op,value,actual,expected)=>assert.equal(model.automationCondition({field,op,value},{[field]:actual},'tasks',now),expected,`${field}/${op}: ${JSON.stringify(actual)}`);
 for(const [op,value,yes,no] of [
  ['contains','альфа','Проект АЛЬФА beta','Проект beta'],['notContains','альфа','Проект beta','Проект альфа'],
  ['eq','альфа','  АЛЬФА  ','альфа beta'],['neq','альфа','beta','альфа'],
  ['starts','альфа','АЛЬФА beta','beta альфа'],['ends','альфа','beta АЛЬФА','альфа beta']
 ]) {check('title',op,value,yes,true);check('title',op,value,no,false);}
 for(const field of ['responsibleId','createdBy','accomplices','auditors','groupId','status','priority']) {
  for(const op of ['eq','neq']) {
   check(field,op,'2',2,op==='eq');check(field,op,'2','12',op==='neq');
   assert.equal(model.automationCondition({field,op,value:'2'},{},'tasks',now),null,`${field}/${op} unknown`);
   assert.equal(model.automationCondition({field,op,value:'2'},{[field]:null},'tasks',now),null);
  }
 }
 for(const field of ['accomplices','auditors']) {
  check(field,'eq','12',[{id:12},'2'],true);check(field,'neq','12',[],true);check(field,'eq','12',[],false);
 }
 for(const op of ['eq','neq']) for(const actual of ['personal','group']) {
  assert.equal(model.automationCondition({field:'kind',op,value:'personal'},{kind:actual},'chats'),op==='eq'?actual==='personal':actual!=='personal');
 }
 for(const [op,value,actual,expected] of [
  ['empty','','',true],['empty','','2026-10-29',false],['present','','',false],['present','','2026-10-29',true],
  ['before','2026-10-29','2026-10-28',true],['before','2026-10-29','2026-10-29',false],
  ['after','2026-10-29','2026-10-30',true],['after','2026-10-29','2026-10-29',false],
  ['before','bad-date','2026-10-28',false],['after','2026-10-29','bad-date',false]
 ]) check('deadline',op,value,actual,expected);
 for(const status of ['2','3','4','5','6','7']) {
  assert.equal(model.automationCondition({field:'deadline',op:'overdue'},{deadline:'2026-10-28',status},'tasks',now),['2','3'].includes(status));
 }
 assert.equal(model.automationCondition({field:'deadline',op:'overdue'},{deadline:'2026-10-28'},'tasks',now),null);
 for(const status of [undefined,null,'']) {
  assert.equal(model.automationCondition({field:'deadline',op:'overdue'},{deadline:'2026-10-28',status},'tasks',now),null,'An empty status is unknown, not an active overdue task');
 }
 assert.equal(model.automationCondition({field:'deadline',op:'overdue'},{deadline:'2026-10-30'},'tasks',now),false);
 const destination='folder:a', folderIds=new Set([destination,'folder:b']);
 const makeRule=(conditions,match='all',extra={})=>({id:'a',enabled:true,folderId:destination,conditions,match,...extra});
 const conditions=[{field:'responsibleId',op:'eq',value:'2'},{field:'title',op:'eq',value:'match'}];
 // Exhaust all nine true/false/unknown pairs for both combinators.
 for(const first of [true,false,null]) for(const second of [true,false,null]) for(const match of ['all','any']) {
  const facts={};if(first!==null)facts.responsibleId=first?'2':'3';if(second!==null)facts.title=second?'match':'other';
  const expected=match==='all'?(first===false||second===false?false:first===null||second===null?null:true):
   (first===true||second===true?true:first===null||second===null?null:false);
  const decision=model.automationDecision([makeRule(conditions,match)],facts,'tasks',folderIds,now);
  assert.deepEqual(decision,expected===null?{pending:true}:expected?{ruleId:'a',folderId:destination}:null,`${match}: ${first},${second}`);
 }
 const fallback=makeRule([{field:'title',op:'eq',value:'match'}],'all',{id:'b',folderId:'folder:b'});
 assert.deepEqual(model.automationDecision([makeRule([conditions[0]]),fallback],{title:'match'},'tasks',folderIds),{pending:true});
 assert.equal(model.automationDecision([makeRule([conditions[0]],'all',{enabled:false}),fallback],{title:'match'},'tasks',folderIds).ruleId,'b');
 assert.equal(model.automationDecision([makeRule([conditions[0]],'all',{folderId:'deleted'}),fallback],{title:'match'},'tasks',folderIds).ruleId,'b');
 assert.deepEqual(model.taskAutomationFacts({TITLE:'renamed',ACCOMPLICES:[],DEADLINE:null},{title:'old',responsibleId:2,auditors:[3]}),{title:'renamed',responsibleId:2,auditors:[3],accomplices:[],deadline:''});

 // Execute the real integration functions with deterministic storage, metadata,
 // task responses and timers. No portal data or production rules are modified.
 const source=injectedSource||readFileSync(new URL('../../extension/injected.js',import.meta.url),'utf8');
 const start=source.indexOf('\tlet _dialogAutomationTimer = null;'),end=source.indexOf('\tfunction _openDialogAutomation(',start);
 assert.ok(start>0&&end>start);
 const storage=new Map(), metas=new Map(), timers=[], pendingResponses=[];
 let scope='portal.test~1',enabled=true;
 const items={chats:[],tasks:[]}, buttons=[];
 const context={
  window:{__PENA_NATIVE_CATALOG__:model},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  document:{hidden:false,dispatchEvent(){},querySelectorAll:()=>buttons},navigator:{onLine:true},Event:class {},
  setTimeout:(callback,delay)=>{const timer=()=>timer.cancelled?undefined:callback();timer.delay=delay;timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;},
  _getDialogTimeIdentityScopeKey:()=>scope,_pMode:()=> 'tasks',_getDialogRecentMeta:id=>metas.get(id),
  _isPenaExtensionEnabled:()=>enabled,
  _getDialogRecentUniqueMeta:()=>[...metas.values()],_dialogRecentMeta:metas,
  _setDialogRecentMeta:(target,meta)=>target.set(meta.id,meta),_scheduleDialogRecentCacheWrite(){},
  _isDialogControlFolder:item=>item.type==='folder',_isDialogControlItemUnavailable:item=>!!item.unavailable,
  _getDialogControlItemsForMode:mode=>items[mode],_saveDialogControlItemsForMode(){},_notifyDialogRecentDataChanged(){},_dialogControlNativeViewSig:'',
  _callBxRestMethod:()=>new Promise(resolve=>pendingResponses.push(resolve)),_extractTaskRecordFromData:data=>data.task
 };
 runInNewContext(source.slice(start,end)+'\nthis.api={apply:_applyDialogAutomation,receive:_receiveDialogAutomationTask,schedule:_scheduleDialogAutomation,tickets:_dialogAutomationTickets};',context);
 const {api}=context;
 const key=()=>`pena.automation.v1.${scope}.tasks`;
 const ownerRule=id=>makeRule([{field:'responsibleId',op:'eq',value:id}],'all',{id,folderId:id==='2'?'folder:a':'folder:b'});
 const config={version:1,rules:[ownerRule('2'),ownerRule('3')],excludedIds:[]};
 storage.set(key(),JSON.stringify(config));
 items.tasks=[{id:'folder:a',type:'folder',segmentId:'group:a'},{id:'folder:b',type:'folder',segmentId:'group:b'},
  {id:'chat1',taskId:'1',title:'Task'}];
 metas.set('chat1',{id:'chat1',taskId:'1',automationFacts:{responsibleId:'2'}});
 const task=items.tasks[2];
 assert.equal(api.apply('tasks',items.tasks),1);assert.equal(task.folderId,'folder:a');assert.equal(task.segmentId,'group:a');
 assert.equal(api.apply('tasks',items.tasks),0);assert.equal(api.tickets('tasks').length,0);
 api.receive('1',{RESPONSIBLE_ID:'3'});api.apply('tasks',items.tasks);
 assert.equal(task.folderId,'folder:a');assert.equal(api.tickets('tasks')[0][1].ticket.to,'folder:b');
 // A manual move cancels the pending suggestion and becomes the new baseline.
 task.folderId='manual';api.apply('tasks',items.tasks);assert.equal(api.tickets('tasks').length,0);
 api.apply('tasks',items.tasks);assert.equal(task.folderId,'manual');
 api.receive('1',{RESPONSIBLE_ID:'2'});api.apply('tasks',items.tasks);assert.equal(api.tickets('tasks')[0][1].ticket.to,'folder:a');
 const removedFolder=items.tasks.shift();api.apply('tasks',items.tasks);
 assert.equal(api.tickets('tasks')[0][1].ticket.to,'','A deleted destination cannot remain in a pending ticket');
 items.tasks.unshift(removedFolder);api.apply('tasks',items.tasks);
 assert.equal(api.tickets('tasks')[0][1].ticket.to,'folder:a');
 task.unavailable=true;api.apply('tasks',items.tasks);assert.equal(api.tickets('tasks').length,0);task.unavailable=false;
 // A genuinely new task with unknown owner stays pending and is assigned only
 // once the first authoritative owner arrives; no confirmation is required.
 const fresh={id:'chat2',taskId:'2',title:'New task'};items.tasks.push(fresh);metas.set(fresh.id,{id:fresh.id,taskId:'2',automationFacts:{}});
 api.apply('tasks',items.tasks);assert.equal(fresh.folderId,undefined);
 api.receive('2',{RESPONSIBLE_ID:'3'});assert.equal(api.apply('tasks',items.tasks),1);assert.equal(fresh.folderId,'folder:b');
 assert.equal(api.tickets('tasks').length,0);
 // Reloaded rules remain scoped to the numeric user and portal.
 scope='portal.test~2';assert.equal(api.apply('tasks',items.tasks),0);assert.equal(api.tickets('tasks').length,0);scope='portal.test~1';
 // Unspecified Pull fields force a fresh read. A late response cannot overwrite
 // a newer Pull owner; a second read resolves the remaining dirty state.
 api.receive('2',{});api.apply('tasks',items.tasks);assert.equal(api.tickets('tasks').length,0);
 const firstRun=timers.shift()();assert.equal(pendingResponses.length,1);
 api.receive('2',{RESPONSIBLE_ID:'2'});pendingResponses.shift()({task:{id:'2',responsibleId:'3'}});await firstRun;
 assert.equal(metas.get('chat2').automationFacts.responsibleId,'2','Late detail must not undo newer Pull');
 api.apply('tasks',items.tasks);assert.equal(api.tickets('tasks').length,0,'Unverified metadata cannot produce a transferable ticket');
 const secondRun=timers.shift()();assert.equal(pendingResponses.length,1);pendingResponses.shift()({task:{id:'2',responsibleId:'2'}});await secondRun;
 api.apply('tasks',items.tasks);assert.equal(api.tickets('tasks')[0][1].ticket.to,'folder:a');assert.equal(fresh.folderId,'folder:b');
 // Switching account during a read cannot write into the next account's facts.
 api.receive('2',{});const scopedRun=timers.shift()();assert.equal(pendingResponses.length,1);
 scope='other.test~9';pendingResponses.shift()({task:{id:'2',responsibleId:'99'}});await scopedRun;
 assert.equal(metas.get('chat2').automationFacts.responsibleId,'2');
 // Time itself is a rule input: a quiet portal must create the confirmation as
 // soon as the deadline passes, without an unrelated incoming message.
 timers.length=0;scope='deadline.test~1';let clock=now;
 context.Date=class extends Date {static now(){return clock;}};
 context.window.__PENA_NATIVE_CATALOG__={...model,automationDecision:(rules,facts,mode,folders)=>model.automationDecision(rules,facts,mode,folders,clock)};
 storage.set(key(),JSON.stringify({version:1,rules:[makeRule([{field:'deadline',op:'overdue'}])],excludedIds:[]}));
 items.tasks=items.tasks.slice(0,2).concat({id:'deadline-task',taskId:'50',title:'Timed task'});
 metas.set('deadline-task',{id:'deadline-task',taskId:'50',automationFacts:{deadline:new Date(now+1000).toISOString(),status:'2'}});
 api.schedule();await timers.shift()();
 assert.equal(api.tickets('tasks').length,0);
 assert.equal(timers.length,1,'Only one deadline wake-up is required');assert.equal(timers[0].delay,1001);
 clock+=1001;timers.shift()();await timers.shift()();
 assert.equal(api.tickets('tasks')[0][1].ticket.to,'folder:a','Passing the deadline must propose a move');
 assert.equal(items.tasks[2].folderId,undefined,'Existing timed tasks still require confirmation');
 assert.equal(timers.length,0,'Expired deadlines do not create a polling loop');
 metas.get('deadline-task').automationFacts.deadline=new Date(clock+3e9).toISOString();api.schedule();await timers.shift()();
 assert.equal(timers[0].delay,2147483647,'Long deadlines respect the browser timer limit');
 storage.set(key(),JSON.stringify({version:1,rules:[],excludedIds:[]}));api.schedule();
 assert.equal(timers[0].cancelled,true,'Disabling rules cancels the deadline wake-up');timers.length=0;
 const overdueConfig={version:1,rules:[makeRule([{field:'deadline',op:'overdue'}])],excludedIds:[]};
 storage.set(key(),JSON.stringify(overdueConfig));api.schedule();await timers.shift()();enabled=false;api.schedule();
 assert.equal(timers[0].cancelled,true,'Disabling the extension cancels its wake-up');assert.equal(api.apply('tasks',items.tasks),0);timers.length=0;enabled=true;
 api.schedule();await timers.shift()();scope='another.test~1';timers.shift()();assert.equal(timers.length,0,'Old user deadlines cannot schedule new-user processing');
 scope='deadline.test~1';
 context.document.hidden=true;api.schedule();await timers.shift()();assert.equal(timers.length,0,'Hidden pages do not run deadline checks');context.document.hidden=false;
 context.navigator.onLine=false;api.schedule();await timers.shift()();assert.equal(timers.length,0,'Offline pages wait for the online event');context.navigator.onLine=true;
 for(const status of ['4','5','6','7']) {
  metas.get('deadline-task').automationFacts.status=status;api.schedule();await timers.shift()();
  assert.equal(timers.length,0,`Status ${status} needs no overdue wake-up`);
 }
}

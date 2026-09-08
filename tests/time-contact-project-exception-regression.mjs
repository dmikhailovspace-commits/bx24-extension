import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
const require=createRequire(import.meta.url), model=require('../extension/native-time-control.js');
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const day='2026-09-08', range={from:day,to:day}, at=Date.parse(day+'T10:00:00Z');
const plain=value=>JSON.parse(JSON.stringify(value));
function extract(name) {
 const start=source.search(new RegExp('\\t(?:async )?function '+name+'\\('));
 assert.ok(start>=0,name);
 const next=/\n\t(?:async )?function /.exec(source.slice(start+1));
 return source.slice(start,next?start+1+next.index:undefined);
}
function fixture(storage=new Map()) {
 const s={user:'7',portal:'portal.test',configured:true,reads:0,eligibility:true,checks:[],writes:[],draft:{},tracker:null,hold:null};
 const key=(prefix,date='')=>s.user?`${s.portal}:${prefix}.${s.user}.${date}`:'';
 const a={Date,Map,Set,Promise,Number,String,Math,Array,JSON,setTimeout:()=>0,clearTimeout:()=>{},
  _PENA_TIME_CONTROL:model,_PENA_TIME_VISITS_KEY:'visits',_PENA_TIME_MANUAL_DRAFT_KEY:'manual',
  localStorage:{getItem:k=>{s.reads++;return storage.get(k)||null;}},
  _getDialogTimeScopedStorageKey:key,_getDialogTimeIdentityScopeKey:()=>s.user?`${s.portal}~${s.user}`:'',
  _getDialogTimeProjectScopeKey:()=>s.configured&&s.user?`${s.portal}~${s.user}:projects:1:g0`:'',
  _dialogTimeCatalogCursor:1,_dialogTimeCatalogScope:'portal.test~7:projects:1:g0',_dialogTimeProjectTaskIds:new Set(['101']),
  _getDialogTimeSelectedRange:()=>range,_getDialogTimeTodayKey:()=>day,_dialogTimeRange:range,
  _readDialogTimeManualDraft:()=>structuredClone(s.draft),_readDialogTimeTracker:opts=>{if(opts?.fresh)s.freshTrackerRead=true;return structuredClone(s.tracker);},
  _dialogTimeTaskTitles:new Map(),_getDialogTimeTaskEligibilityForDisplay:()=>true,
  _getDialogRecentUniqueMeta:()=>[],_getDialogControlItemsForMode:()=>[],_isDialogControlFolder:()=>false,
  _extractTaskIdFromTaskUrl:()=>'',normId:id=>String(id||''),
  _getDialogTimeEligibleTaskIds:()=>[...a._dialogTimeTaskTitles.keys()],_dialogTimeTaskChatDialogIds:new Map(),
  _isDialogTimePlaceholderTaskTitle:(_id,title)=>!title,_getDialogTimeTaskTitle:(id,title)=>a._dialogTimeTaskTitles.get(id)||title||`Задача #${id}`,
  _getDialogTimeTaskChatDialogId:()=>'',_dialogTimeManualSelectedTask:null,
  _dialogTimeActionInFlight:false,_dialogTimeManualError:'',_dialogTimeManualRetryConfirmKey:'',
  _dialogTimeActiveManualWriteIntent:null,_dialogTimeAcknowledgedManualMemory:null,
  _dialogTimeManualSearchQuery:'',_dialogTimeManualSearchResults:[],_dialogControlNativeSwitcherNode:null,_dialogTimeView:'day',
  _queueDialogTimeUiSync:()=>{},_showDialogDockToast:()=>{},_scheduleDialogTimeAccountingRecovery:()=>{},
  _finishDialogTimeAcknowledgedManualWrite:async()=>true,
  _ensureDialogTimeTaskEligibility:async(id,options)=>{s.checks.push({id,options});if(s.hold)await s.hold;return s.eligibility;},
  _writeDialogTimeManualDraft:draft=>{s.draft=structuredClone(draft);return true;},_getDialogTimeWriteIntentKey:()=>'',
  _callBxRestMethod:async(method,params)=>{s.writes.push({method,params});return '901';},
  _buildDialogTimeWriteFields:seconds=>({SECONDS:seconds}),_getDialogTimeSavedItemId:id=>String(id),
  _invalidateDialogTimeCachesForDates:()=>{},_applyDialogTimeOptimisticEntry:(...args)=>{s.optimistic=args;},
  _isDialogTimeDefiniteWriteFailure:()=>true,_getDialogTimeFriendlyError:e=>e.message,_loadDialogTimeRange:async()=>{},
  _withDialogTimeTrackerLock:async action=>action(s.tracker),_writeDialogTimeTracker:value=>{s.tracker=value;return true;},
  _rememberDialogTimeTaskVisit:()=>{},_ensureDialogTimeTrackerTick:()=>{},_dialogTimeTrackerCancelConfirmTaskId:'',
 };
 vm.createContext(a);
 const names=['_readDialogTimeVisits','_isDialogTimeProjectTask','_getDialogTimeContactExceptionTaskIds','_getDialogTimeWritableTaskIds','_isDialogTimeWritableTask','_getDialogTimeWorkingTaskIds','_getDialogTimeLocalTaskSearchResults','_getDialogTimeTaskCandidates','_commitDialogTimeManualEntry','_startDialogTimeTracker'];
 vm.runInContext(names.map(extract).join('\n'),a);
 return {a,s,storage,visits:(rows,date=day)=>storage.set(key('visits',date),JSON.stringify(rows))};
}
const contact=(id,count=1,last=at)=>({taskId:String(id),title:`Задача ${id}`,visits:count,lastQualifiedAt:last,visitedAt:last});
const report={sourceSha256:createHash('sha256').update(source).digest('hex'),phases:[],limitations:['Controlled SDK and local Chromium; no live Bitrix portal was used.']};
async function phase(name,fn){try{const result=await fn();report.phases.push({name,status:'PASS',...result});}catch(e){report.phases.push({name,status:'FAIL',error:e.stack});throw e;}}
try {
 await phase('qualified foreign contact is writable without expanding project membership',()=>{
  const {a,visits}=fixture();visits([contact(5)]);
  assert.equal(a._isDialogTimeProjectTask('5'),false);assert.equal(a._isDialogTimeWritableTask('5',day),true);
  assert.deepEqual(plain(a._getDialogTimeWorkingTaskIds(range)),['5','101']);assert.deepEqual([...a._dialogTimeProjectTaskIds],['101']);
 });
 await phase('unqualified counters, open-only rows and accounting placeholders cannot authorize writes',()=>{
  const {a,visits}=fixture();visits([contact(5,3,0),contact(6,0),{taskId:'7',visits:0,accountedEntries:[{id:'77',cutoffAt:at}]}]);
  for(const id of ['5','6','7','8'])assert.equal(a._isDialogTimeWritableTask(id,day),false,id);
  assert.deepEqual(plain(a._getDialogTimeWorkingTaskIds(range)),['7','101']);
 });
 await phase('contact permission is day-, portal-, user- and setup-scoped',()=>{
  const {a,s,visits}=fixture();visits([contact(5)]);assert.equal(a._isDialogTimeWritableTask('5','2026-09-09'),false);
  s.user='8';assert.equal(a._isDialogTimeWritableTask('5',day),false);s.user='7';s.portal='other.test';assert.equal(a._isDialogTimeWritableTask('5',day),false);
  s.portal='portal.test';s.configured=false;assert.equal(a._isDialogTimeWritableTask('5',day),false);assert.deepEqual(plain(a._getDialogTimeWorkingTaskIds(range)),[]);
 });
 await phase('accounted contact and next-day receipt survive reload without granting receipt-only writes',()=>{
  const f=fixture();f.visits(model.markActivityAccounted([contact(5)],'task:5',at+1000,{itemId:'901'}));
  f.visits(model.markActivityAccounted([],'task:9',at+1000,{itemId:'902'}),'2026-09-09');
  const {a}=fixture(f.storage);assert.equal(a._isDialogTimeWritableTask('5',day),true);
  assert.ok(a._getDialogTimeWorkingTaskIds({from:'2026-09-09',to:'2026-09-09'}).includes('9'));
  assert.equal(a._isDialogTimeWritableTask('9','2026-09-09'),false);
 });
 await phase('ordinary draft is excluded; scoped intent and persisted timer are read-only exceptions',()=>{
  const {a,s}=fixture();s.draft={taskId:'12',dateKey:day};assert.deepEqual(plain(a._getDialogTimeWorkingTaskIds(range)),['101']);
  s.draft.pendingWrite={taskId:'12',dateKey:day,scope:'other~7'};assert.deepEqual(plain(a._getDialogTimeWorkingTaskIds(range)),['101']);
  s.draft.pendingWrite.scope='portal.test~7';s.tracker={taskId:'13',dateKey:day};
  assert.deepEqual(plain(a._getDialogTimeWorkingTaskIds(range)),['12','13','101']);assert.equal(s.freshTrackerRead,true);
  assert.equal(a._isDialogTimeWritableTask('12',day),false);assert.equal(a._isDialogTimeWritableTask('13',day),false);
 });
 await phase('4149 titles use one contact ledger read per search and no reads for supplied render visits',()=>{
  const {a,s,visits}=fixture();const rows=[contact(4000)];visits(rows);
  a._dialogTimeProjectTaskIds=new Set(Array.from({length:149},(_,i)=>String(i+1)));
  a._dialogTimeTaskTitles=new Map(Array.from({length:4149},(_,i)=>[String(i+1),`Задача ${i+1}`]));
  s.reads=0;const found=a._getDialogTimeLocalTaskSearchResults('4000');assert.deepEqual(found.map(x=>x.taskId).join(','),'4000');assert.equal(s.reads,1);
  s.reads=0;const candidates=a._getDialogTimeTaskCandidates(null,rows);assert.equal(candidates.length,150);assert.equal(s.reads,0);
  return {titles:4149,selected:149,contactExceptions:1,searchLedgerReads:1,renderLedgerReads:0};
 });
 await phase('pending count wins over recency; ties use qualification time then task ID',()=>{
  const rows=[contact(9,1,at+9000),contact(4,3,at),contact(10,2,at+1000),contact(2,2,at+1000),contact(3,2,at+2000)];
  assert.deepEqual(model.selectUntrackedVisits(rows).map(x=>x.taskId),['4','3','2','10','9']);
  const withCutoff=model.selectUntrackedVisits([contact(4,3,at),contact(9,2,at+1000)], [{taskId:'4',recordedEntries:[{id:'90',recordedAt:at+1}]}]);
  assert.deepEqual(withCutoff.map(x=>x.taskId),['9']);
 });
 await phase('ADD revalidates fresh eligibility and writes exactly once for a qualified foreign task',async()=>{
  const {a,s,visits}=fixture();visits([contact(5)]);await a._commitDialogTimeManualEntry({taskId:'5'},0,10,day);
  assert.equal(s.writes.length,1);assert.equal(s.writes[0].params.TASKID,5);assert.equal(s.writes[0].params.ARFIELDS.SECONDS,600);assert.equal(s.checks[0].options.force,true);
  assert.equal(s.draft.pendingWrite.status,'acknowledged');assert.equal(s.optimistic[0],'5');assert.equal(a._isDialogTimeProjectTask('5'),false);
 });
 await phase('disabled or unavailable tracking rejects ADD despite a prior contact',async()=>{
  for(const eligibility of [false,null]){const {a,s,visits}=fixture();visits([contact(5)]);s.eligibility=eligibility;await a._commitDialogTimeManualEntry({taskId:'5'},0,10,day);assert.equal(s.writes.length,0);assert.equal(s.checks[0].options.force,true);}
 });
 await phase('scope change while fresh validation is held prevents the mutation',async()=>{
  const {a,s,visits}=fixture();visits([contact(5)]);let release;s.hold=new Promise(r=>release=r);
  const work=a._commitDialogTimeManualEntry({taskId:'5'},0,10,day);s.user='8';release();await work;assert.equal(s.writes.length,0);
 });
 await phase('tracker permits a qualified foreign task, with fresh validation, but rejects unqualified and disabled ones',async()=>{
  for(const [qualified,eligible]of [[true,true],[false,true],[true,false]]){
   const {a,s,visits}=fixture();visits([contact(5,1,qualified?at:0)]);s.eligibility=eligible;
   await a._startDialogTimeTracker({taskId:'5'});assert.equal(!!s.tracker,qualified&&eligible);assert.equal(s.checks[0].options.force,true);
  }
 });
 if(process.env.PENA_CONTACT_EXCEPTION_VM_ONLY!=='1') {
  await phase('Chromium: foreign-project contact enables the real form, revalidates permission, preserves ACK and reload totals',async()=>{
   const {chromium}=await import('playwright');
   const {startHarnessServer,collectPageErrors}=await import('./lib/harness-server.mjs');
   const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
   const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=collectPageErrors(page);
   try {
    const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
    assert.equal(source.split(anchor).length,2);
    const exposed=source.replace(anchor,anchor+`
     window.contactExceptionProbe={
      record:()=>_getDialogTimeRecord(_getDialogTimeSelectedRange()),
      visits:()=>_readDialogTimeVisits(_getDialogTimeSelectedRange().from),
      project:id=>_isDialogTimeProjectTask(id), writable:id=>_isDialogTimeWritableTask(id),
      working:()=>_getDialogTimeWorkingTaskIds(_getDialogTimeSelectedRange()),
      sync:()=>_syncDialogTimeUi(_dialogControlNativeSwitcherNode),
      prepare:task=>_prepareDialogTimeManualEntry(task),
      reloadRange:()=>_loadDialogTimeRange(_getDialogTimeSelectedRange(),{force:true}),
     };`);
    const fixtureHtml=readFileSync(new URL('./native-consistency-harness.html',import.meta.url),'utf8')
     .replace('{ version:1, all:true, ids:[], includeUnassigned:true }','{ version:1, all:false, ids:["1"], includeUnassigned:false }')
     .replace('window.timeFixtureTaskGroup =','window.timeTaskGroupOverrides={"5":"2"}; window.timeFixtureTaskGroup =');
    await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:exposed}));
    await page.route('**/tests/native-consistency-harness.html*',route=>route.fulfill({contentType:'text/html',body:fixtureHtml}));
    await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');
    await page.locator('.pena-native-time-button').click();
    await page.waitForFunction(()=>window.contactExceptionProbe.record()?.hasCompleteSnapshot && window.contactExceptionProbe.record()?.data?.totalSeconds===5400);
    await page.evaluate(()=>{
     window.contactExtraCatalogCalls=0;
     const method=BX.rest.callMethod,batch=BX24.callBatch;
     BX.rest.callMethod=function(name,...args){if(name==='tasks.task.list')window.contactExtraCatalogCalls++;return method.call(this,name,...args);};
     BX24.callBatch=function(calls,...args){window.contactExtraCatalogCalls+=Object.values(calls).filter(call=>call?.method==='tasks.task.list').length;return batch.call(this,calls,...args);};
     window.dispatchNativeTaskMessage('chat5');
    });
    await page.waitForFunction(()=>window.contactExceptionProbe.visits().some(visit=>visit.taskId==='5'&&visit.visits>0&&visit.lastQualifiedAt>0));
    await page.locator('.pena-native-time-suggestions-list button').filter({hasText:'Добавить'}).first().click();
    const minutes=page.locator('.pena-native-time-manual-minutes'),submit=page.locator('.pena-native-time-manual-submit');
    await minutes.fill('10');
    assert.equal(await submit.isEnabled(),true,'Qualified foreign contact must not have a gray submit button');
    assert.equal(await page.evaluate(()=>window.contactExceptionProbe.project('5')),false);
    await page.evaluate(()=>{window.timeTaskEligibilityOverrides['5']='N';});
    await submit.click();
    await page.waitForFunction(()=>document.querySelector('.pena-native-time-manual-error')?.textContent.includes('выключен'));
    assert.equal(await page.evaluate(()=>window.timeAddCalls.length),0,'Fresh N must block actual ADD');
    await page.evaluate(()=>{window.timeTaskEligibilityOverrides['5']='Y';});
    await submit.click();
    await page.waitForFunction(()=>window.timeAddCalls.length===1 && window.contactExceptionProbe.record()?.data?.totalSeconds===6000);
    await page.evaluate(()=>window.contactExceptionProbe.reloadRange());
    assert.equal(await page.evaluate(()=>window.contactExceptionProbe.record()?.data?.totalSeconds),6000,'Reconciliation must retain foreign contact time');
    assert.equal(await page.evaluate(()=>window.contactExceptionProbe.project('5')),false);
    assert.equal(await page.evaluate(()=>window.contactExtraCatalogCalls),0,'Contact and ADD must not broaden the selected catalog');
    const backend=await page.evaluate(()=>({seed:window.timeSeedItems,added:window.timeAddedItems}));
    // The harness backend is page-local. Preserve its accepted server rows when
    // reloading the client, without manufacturing extension cache or contacts.
    await page.addInitScript(state=>{window.__contactAcceptedBackend=state;},backend);
    const reloadHtml=fixtureHtml.replace('window.timeAddedItems = [];','window.timeAddedItems = window.__contactAcceptedBackend?.added || []; window.timeSeedItems=window.__contactAcceptedBackend?.seed;');
    await page.unroute('**/tests/native-consistency-harness.html*');
    await page.route('**/tests/native-consistency-harness.html*',route=>route.fulfill({contentType:'text/html',body:reloadHtml}));
    await page.reload();await page.locator('.pena-native-time-button').click();
    await page.waitForFunction(()=>window.contactExceptionProbe.record()?.hasCompleteSnapshot && window.contactExceptionProbe.record()?.data?.totalSeconds===6000);
    assert.equal(await page.evaluate(()=>window.contactExceptionProbe.project('5')),false);
    assert.ok((await page.evaluate(()=>window.contactExceptionProbe.working())).includes('5'));
    const visitsBeforeSave=await page.evaluate(()=>window.contactExceptionProbe.visits());
    await page.locator('.pena-native-time-project-button').click();
    await page.locator('.pena-native-time-project-save:enabled').waitFor();
    await page.locator('.pena-native-time-project-all input').check();
    await page.evaluate(()=>{
     const held=window.contactHeldRefresh={active:true,callbacks:[]};
     const method=BX.rest.callMethod,batch=BX24.callBatch;
     BX.rest.callMethod=function(name,params,callback){
      return method.call(this,name,params,result=>{if(held.active&&['tasks.task.list','task.elapseditem.getlist'].includes(name))held.callbacks.push(()=>callback(result));else callback(result);});
     };
     BX24.callBatch=function(calls,callback){
      return batch.call(this,calls,result=>{if(held.active&&Object.values(calls).some(call=>['tasks.task.list','task.elapseditem.getlist'].includes(call?.method)))held.callbacks.push(()=>callback(result));else callback(result);});
     };
    });
    await page.locator('.pena-native-time-project-save').click();
    await page.waitForFunction(()=>window.contactHeldRefresh.callbacks.length>0);
    const pendingSave=await page.evaluate(()=>{window.contactExceptionProbe.sync();return{seconds:window.contactExceptionProbe.record()?.data?.totalSeconds,verified:window.contactExceptionProbe.record()?.hasVerifiedData,total:document.querySelector('.pena-native-time-total-value')?.textContent,visits:window.contactExceptionProbe.visits()};});
    assert.equal(pendingSave.seconds,6000);assert.equal(pendingSave.verified,true);assert.notEqual(pendingSave.total,'—');assert.deepEqual(pendingSave.visits,visitsBeforeSave);
    await page.evaluate(()=>{window.contactHeldRefresh.active=false;for(const fn of window.contactHeldRefresh.callbacks.splice(0))fn();});
    await page.waitForFunction(()=>window.contactExceptionProbe.record()?.hasCompleteSnapshot && window.contactExceptionProbe.record()?.data?.totalSeconds===6000);
    assert.deepEqual(await page.evaluate(()=>window.contactExceptionProbe.visits()),visitsBeforeSave);
    assert.deepEqual(errors,[]);
    return {initialSeconds:5400,acceptedSeconds:6000,reloadedSeconds:6000,pendingSaveAllSeconds:6000,finalSaveAllSeconds:6000,addCalls:1,additionalCatalogRequestsBeforeSettings:0};
   } finally {await browser.close();await server.close();}
  });
 }
} finally {
 mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});
 writeFileSync(new URL('./artifacts/time-contact-project-exception-report.json',import.meta.url),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}

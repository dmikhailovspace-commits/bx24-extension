import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require=createRequire(import.meta.url);
const model=require(process.env.PENA_CONTACT_MODEL || '../extension/native-time-control.js');
const start=Date.parse('2026-09-07T10:00:00+03:00');
const event=(rows,id,seconds)=>model.applyQualifiedContact(rows,{eventId:id,taskId:'10',title:'Работа',qualifiedAt:start+seconds*1000,reason:'message'});
const logged=seconds=>[{taskId:'10',seconds,lastTrackedAt:'2026-09-07T12:00:00+03:00'}];
const pending=(rows,seconds=1800)=>model.selectUntrackedVisits(rows,logged(seconds));
const phases=[];
function check(name,run){try{const detail=run();phases.push({name,status:'PASS',detail});}catch(error){phases.push({name,status:'FAIL',error:error.message});}}
check('new contacts after an existing time entry reappear with day total and only their remaining count',()=>{
 let rows=event([], 'before-1',0);rows=event(rows,'before-2',30);rows=model.markActivityAccounted(rows,'task:10',start+45000);rows=event(rows,'after',60);
 const result=pending(rows);assert.equal(result.length,1);assert.equal(result[0].pendingContacts,1);assert.equal(result[0].visits,3);assert.equal(result[0].trackedSeconds,1800);return result[0];
});
check('successful ACK consumes only contacts preceding submission, even when another contact is already committed',()=>{
 let rows=event([], 'before',0);rows=event(rows,'during-write',30);rows=model.markActivityAccounted(rows,'task:10',start+10000);
 assert.equal(pending(rows)[0]?.pendingContacts,1);return{pendingContacts:pending(rows)[0].pendingContacts};
});
check('a successful write before the contact outbox flush still excludes older replayed events',()=>{
 let rows=model.markActivityAccounted([],'task:10',start+20000);rows=event(rows,'late-old',0);assert.equal(pending(rows).length,0);
 rows=event(rows,'later',40);assert.equal(pending(rows)[0]?.pendingContacts,1);return{pendingContacts:pending(rows)[0].pendingContacts};
});
check('duplicate and older acknowledgements cannot roll back a newer accounting cutoff',()=>{
 let rows=event([], 'first',0);rows=model.markActivityAccounted(rows,'task:10',start+45000);rows=event(rows,'new',60);
 rows=model.markActivityAccounted(rows,'task:10',start+20000);rows=model.markActivityAccounted(rows,'task:10',start+45000);
 assert.equal(pending(rows)[0]?.pendingContacts,1);assert.equal(rows[0].accountedAt,start+45000);return{pendingContacts:pending(rows)[0].pendingContacts};
});
check('changing or deleting tracked time does not consume newer contacts or revive accounted contacts',()=>{
 let rows=event([], 'before',0);rows=model.markActivityAccounted(rows,'task:10',start+10000);rows=event(rows,'after',30);
 for(const tracked of [logged(1800),logged(900),[]])assert.equal(model.selectUntrackedVisits(rows,tracked)[0]?.pendingContacts,1);
 return{pendingContacts:1};
});
check('contact summary reports journal entries including zero time and changes independently of total seconds',()=>{
 const visits=event([], 'new-contact',60);
 const entry=(ID,SECONDS)=>({ID,TASK_ID:'10',SECONDS,CREATED_DATE:'2026-09-07T12:00:00+03:00'});
 const first=model.aggregateElapsedItems([entry('1',3600),entry('2',900)]);
 const before=model.selectUntrackedVisits(visits,first.tasks)[0];
 assert.equal(before.trackedSeconds,4500);assert.equal(before.trackedEntries,2);
 const split=model.aggregateElapsedItems([entry('1',3600),entry('2',450),entry('3',450),entry('4',0)]);
 const after=model.selectUntrackedVisits(visits,split.tasks)[0];
 assert.equal(after.trackedSeconds,4500);assert.equal(after.trackedEntries,4);assert.equal(after.pendingContacts,before.pendingContacts);
 const removed=model.selectUntrackedVisits(visits,[])[0];assert.equal(removed.trackedEntries,0);assert.equal(removed.pendingContacts,1);
 return{seconds:4500,beforeEntries:2,afterEntries:4,afterDeleteEntries:0};
});
check('touch deduplication and an out-of-order replay use the same qualified event count',()=>{
 let rows=event([], 'later',40);rows=event(rows,'earlier',0);rows=event(rows,'duplicate-touch',5);rows=model.markActivityAccounted(rows,'task:10',start+20000);
 rows=event(rows,'later','40');assert.equal(rows[0].visits,2);assert.equal(pending(rows)[0]?.pendingContacts,1);return{dayContacts:rows[0].visits,pendingContacts:1};
});
check('legacy aggregate contacts establish a count baseline at successful accounting',()=>{
 let rows=[{taskId:'10',visits:3,visitedAt:start,lastQualifiedAt:start}];rows=model.markActivityAccounted(rows,'task:10',start+10000);
 rows=model.recordActivityTouch(rows,{taskId:'10',visitedAt:start+60000},{qualify:true});assert.equal(pending(rows)[0]?.pendingContacts,1);return{pendingContacts:1};
});
check('external DATE_START covers preceding contacts while CREATED_DATE and missing timezone cannot do so',()=>{
 let rows=event([], 'before',0);rows=event(rows,'after',40);
 const item={ID:'20',TASK_ID:'10',SECONDS:1800,CREATED_DATE:'2026-09-07T12:00:00+03:00',DATE_START:'2026-09-07T10:00:20+03:00'};
 const exact=model.aggregateElapsedItems([item]);assert.equal(model.selectUntrackedVisits(rows,exact.tasks)[0]?.pendingContacts,1);
 for(const DATE_START of ['', '2026-09-07T10:00:20'])assert.equal(model.selectUntrackedVisits(rows,model.aggregateElapsedItems([{...item,DATE_START}]).tasks)[0]?.pendingContacts,2);
 return{withRecordedAt:1,withoutReliableRecordedAt:2};
});
check('a local immutable receipt wins over server creation time and duplicate acknowledgement time',()=>{
 let rows=event([], 'before',0);rows=event(rows,'during-write',30);rows=model.markActivityAccounted(rows,'task:10',start+10000,{itemId:'20'});
 rows=model.markActivityAccounted(rows,'task:10',start+60000,{itemId:'20'});
 const tracked=model.aggregateElapsedItems([{ID:'20',TASK_ID:'10',SECONDS:1800,CREATED_DATE:'2026-09-07T12:00:00+03:00',DATE_START:'2026-09-07T10:00:45+03:00'}]);
 assert.equal(model.selectUntrackedVisits(rows,tracked.tasks)[0]?.pendingContacts,1);assert.equal(rows[0].accountedAt,start+10000);return{pendingContacts:1,cutoffAt:rows[0].accountedAt};
});
check('legacy numeric task aliases become one contact row without merging same-name tasks',()=>{
 const rows=model.mergeVisitedTasks([
  {taskId:'0010',title:'Общий заголовок',visitedAt:start,lastQualifiedAt:start,visits:2},
  {taskId:10,title:'Общий заголовок',visitedAt:start+30000,lastQualifiedAt:start+30000,visits:2},
  {taskId:'11',title:'Общий заголовок',visitedAt:start,lastQualifiedAt:start,visits:1},
  {taskId:'000',title:'Invalid',visitedAt:start,lastQualifiedAt:start,visits:99}
 ]);
 const result=model.selectUntrackedVisits(rows,[{taskId:10,seconds:1800}]);
 assert.deepEqual(result.map(row=>[row.taskId,row.pendingContacts,row.trackedSeconds]),[['10',2,1800],['11',1,0]]);
 assert.deepEqual(model.mergeVisitedTasks(rows),rows,'canonical migration must be idempotent');
 return{rows:result.length,zeroIds:0,distinctSameNameTasks:2};
});
check('alias accounting receipt consumes one task and keeps subsequent contacts sorted by count',()=>{
 let rows=event([], 'before',0);rows=model.markActivityAccounted(rows,'task:0010',start+10000,{itemId:'20'});
 rows=event(rows,'after',40);rows=model.applyQualifiedContact(rows,{taskId:'11',eventId:'other',qualifiedAt:start+60000});
 rows=model.applyQualifiedContact(rows,{taskId:'11',eventId:'other-2',qualifiedAt:start+90000});
 const result=model.selectUntrackedVisits(rows,[{taskId:'0010',seconds:1800}]);
 assert.deepEqual(result.map(row=>[row.taskId,row.pendingContacts,row.trackedSeconds]),[['11',2,0],['10',1,1800]]);
 return{order:result.map(row=>row.taskId),pending:[2,1]};
});
check('replayed contact event under an alias cannot create a second task or increment visits',()=>{
 let rows=event([], 'same',0);
 rows=model.applyQualifiedContact(rows,{taskId:'0010',eventId:'same',qualifiedAt:start,reason:'message'});
 assert.equal(rows.length,1);assert.equal(rows[0].visits,1);assert.equal(model.selectUntrackedVisits(rows)[0].pendingContacts,1);
 return{rows:1,contacts:1};
});
check('confirmed ACK covers contacts even before the read snapshot exposes its journal entry',()=>{
 const rows=event(event([], 'before',0),'during-save',40);
 const localReceipts=[{taskId:'10',id:'501',cutoffAt:start+20000}];
 for(const snapshot of [[],logged(0),logged(1800)]) {
  const result=model.selectUntrackedVisits(rows,snapshot,{localReceipts});
  assert.equal(result[0].pendingContacts,1);assert.equal(result[0].contactCutoffAt,start+20000);
 }
 return{pendingContacts:1,readSnapshotRequired:false};
});
check('duration around delayed ADD is ignored; only an actual later message stays pending',()=>{
 let rows=model.applyQualifiedContact([],{taskId:'10',eventId:'duration',qualifiedAt:start+60000,sessionStartedAt:start,reason:'duration'});
 rows=event(rows,'real-message',90);rows=model.markActivityAccounted(rows,'task:10',start+10000,{itemId:'502'});
 assert.equal(pending(rows)[0].pendingContacts,1);assert.equal(rows[0].visits,1);
 rows=model.applyQualifiedContact(rows,{taskId:'10',eventId:'new-session',qualifiedAt:start+160000,sessionStartedAt:start+100000,reason:'duration'});
 assert.equal(pending(rows)[0].pendingContacts,1);assert.equal(rows[0].visits,1);
 return{oldSessionPending:0,newMessagePending:1,newSessionPending:0};
});
check('covered duration does not suppress a real message within the 15 second dedupe window',()=>{
 let rows=model.applyQualifiedContact([],{taskId:'10',eventId:'duration-near-message',qualifiedAt:start+60000,sessionStartedAt:start,reason:'duration'});
 rows=event(rows,'real-message-near-duration',65);
 assert.equal(pending(rows)[0].pendingContacts,1,'without a receipt the same interaction window remains one contact');
 rows=model.markActivityAccounted(rows,'task:10',start+10000,{itemId:'503'});
 assert.equal(pending(rows)[0]?.pendingContacts,1,'covered session cannot consume the actual new message');
 rows=model.markActivityAccounted(rows,'task:10',start+70000,{itemId:'504'});
 assert.equal(pending(rows).length,0,'the next write accounts for that real message');
 return{coveredDurationPending:0,newMessagePending:1,afterNextWrite:0};
});
mkdirSync('tests/artifacts',{recursive:true});
writeFileSync(process.env.PENA_CONTACT_REPORT || 'tests/artifacts/time-contact-followup-report.json',JSON.stringify({phases},null,2));
console.log(JSON.stringify(phases,null,2));
if(phases.some(phase=>phase.status==='FAIL'))process.exitCode=1;

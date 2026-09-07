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
mkdirSync('tests/artifacts',{recursive:true});
writeFileSync(process.env.PENA_CONTACT_REPORT || 'tests/artifacts/time-contact-followup-report.json',JSON.stringify({phases},null,2));
console.log(JSON.stringify(phases,null,2));
if(phases.some(phase=>phase.status==='FAIL'))process.exitCode=1;

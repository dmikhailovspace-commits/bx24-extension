import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../extension/native-time-control.js',import.meta.url),'utf8');
const context=vm.createContext({module:{exports:{}},Date});vm.runInContext(source,context);const m=context.module.exports;
const at=clock=>Date.parse(`2026-09-07T${clock}:00+03:00`);
const event=(items,id,clock)=>m.applyQualifiedContact(items,{taskId:'101',title:'Task101',dialogId:'chat101',eventId:id,qualifiedAt:at(clock),reason:'message'});
const elapsed=(dateStart)=>m.aggregateElapsedItems([{ID:'501',TASK_ID:'101',USER_ID:'7',SECONDS:1200,CREATED_DATE:'2026-09-07T12:00:00+03:00',...(dateStart?{DATE_START:dateStart}:{})}]).tasks;
const report={modelSha:createHash('sha256').update(source).digest('hex'),cases:[],limitations:'Pure model acceptance; receipt persistence/SDK/manual handler concurrency are separate integration checks.'};
function test(name,fn){try{report.cases.push({name,status:'PASS',evidence:fn()});}catch(error){report.cases.push({name,status:'FAIL',error:error.message});}}
test('existing 20 logged minutes remain associated with a later new contact',()=>{
 const rows=m.selectUntrackedVisits(event([],'a','10:00'),elapsed('2026-09-07T09:00:00+03:00'));
 assert.equal(rows.length,1);assert.equal(rows[0].pendingContacts,1);assert.equal(rows[0].trackedSeconds,1200);return {pending:1,trackedSeconds:1200};
});
test('external creation cutoff counts only contacts strictly after it',()=>{
 const events=event(event(event([],'a','10:00'),'b','10:05'),'c','10:10');
 const rows=m.selectUntrackedVisits(events,elapsed('2026-09-07T10:05:00+03:00'));
 assert.equal(rows.length,1);assert.equal(rows[0].pendingContacts,1);return {dailyContacts:3,pending:1,equalBoundaryCovered:true};
});
test('synthetic selected-day noon is never used as an actual external creation cutoff',()=>{
 const rows=m.selectUntrackedVisits(event([],'a','10:00'),elapsed());
 assert.equal(rows.length,1);assert.equal(rows[0].pendingContacts,1);return {pendingMorningContact:1,syntheticNoonIgnored:true};
});
test('local submission receipt overrides a later server creation timestamp for that exact item',()=>{
 let events=event(event([],'a','10:00'),'b','10:10');events=m.markActivityAccounted(events,'task:101',at('10:05'),{itemId:'501'});
 const rows=m.selectUntrackedVisits(events,elapsed('2026-09-07T10:15:00+03:00'));
 assert.equal(rows.length,1);assert.equal(rows[0].pendingContacts,1);assert.equal(rows[0].contactCutoffAt,at('10:05'));return {contactDuringRequestRetained:true};
});
test('replayed acknowledgement of the same item cannot move its immutable cutoff forward',()=>{
 let events=event(event([],'a','10:00'),'b','10:10');events=m.markActivityAccounted(events,'task:101',at('10:05'),{itemId:'501'});
 events=m.markActivityAccounted(events,'task:101',at('10:20'),{itemId:'501'});
 const rows=m.selectUntrackedVisits(events,elapsed('2026-09-07T10:15:00+03:00'));
 assert.equal(rows.length,1);assert.equal(rows[0].pendingContacts,1);assert.equal(rows[0].contactCutoffAt,at('10:05'));return {pending:1,replayAdvancedCutoff:false};
});
test('outbox events committed after receipt retain their original before/after-cutoff meaning',()=>{
 let events=m.markActivityAccounted([],'task:101',at('10:05'),{itemId:'501'});events=event(event(events,'a','10:00'),'b','10:10');
 const rows=m.selectUntrackedVisits(events,elapsed('2026-09-07T10:15:00+03:00'));
 assert.equal(rows.length,1);assert.equal(rows[0].pendingContacts,1);return {lateOutboxCount:2,pending:1};
});
writeFileSync(new URL('./artifacts/time-contact-cutoff-acceptance.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.cases.some(x=>x.status==='FAIL'))process.exitCode=1;

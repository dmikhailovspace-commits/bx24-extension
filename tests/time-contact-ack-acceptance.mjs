import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';

const raw=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
assert.equal(raw.split(anchor).length,2);
const source=raw.replace(anchor,anchor+`
 window.contactAckProbe={
  prepare:()=>_prepareDialogTimeManualEntry({taskId:'101',title:'Task 101'}),
  draft:()=>_readDialogTimeManualDraft(),range:()=>_getDialogTimeSelectedRange(),
  record:()=>_getDialogTimeRecord(_getDialogTimeSelectedRange()),
  visits:()=>_readDialogTimeVisits(),load:()=>_loadDialogTimeRange(_getDialogTimeSelectedRange(),{force:true}),
  recover:()=>_recoverDialogTimeContactAccounting(),sync:()=>_syncDialogTimeUi(_dialogControlNativeSwitcherNode),
  contact:async(id,at)=>{
   const event={eventId:id,userId:String(_getCurrentBitrixUserId()),taskId:'101',dialogId:'101',title:'Task 101',qualifiedAt:at,dateKey:_getDialogTimeTodayKey(),reason:'message'};
   localStorage.setItem(_PENA_TIME_CONTACT_OUTBOX_KEY+'.'+event.userId+'.'+id,JSON.stringify(event));
   return _commitDialogTimeContactEvent(event,true);
  }
 };`);
const report={sourceSha:createHash('sha256').update(raw).digest('hex'),phases:[],snapshots:[],limitations:'Actual Chromium manual ADD handler and contact journal commit; synthetic qualified events, controlled SDK ACK and receipt-only storage failures. Server fixture data survives reload. No real messages or live Bitrix.'};
const server=await startHarnessServer(),browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1100,height:900}}),errors=collectPageErrors(page);
async function snapshot(name){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const value=await page.evaluate(()=>({
 draft:window.contactAckProbe.draft(),visits:window.contactAckProbe.visits(),record:window.contactAckProbe.record(),
 addCalls:Number(localStorage.getItem('test:ack-server-adds')||0),
 contactText:document.querySelector('.pena-native-time-suggestions')?.textContent,
 total:document.querySelector('.pena-native-time-total-value')?.textContent,
 toasts:[...document.querySelectorAll('.pena-native-toast.--show')].map(n=>({text:n.textContent,tone:n.className}))
}));report.snapshots.push({name,...value});return value;}
async function installServer(hold){await page.evaluate(hold=>{
 const persisted=JSON.parse(localStorage.getItem('test:ack-server-items')||'null');if(persisted)window.timeAddedItems=persisted;
 window.ackHold=hold;window.ackCallbacks=[];const original=BX.rest.callMethod;
 BX.rest.callMethod=function(method,params,callback){
  if(method!=='task.elapseditem.add')return original.apply(this,arguments);
  localStorage.setItem('test:ack-server-adds',String(Number(localStorage.getItem('test:ack-server-adds')||0)+1));
  return original.call(this,method,params,result=>{
   const done=()=>{for(const item of window.timeAddedItems)item.DATE_START=new Date(Date.now()).toISOString();localStorage.setItem('test:ack-server-items',JSON.stringify(window.timeAddedItems));callback(result);};
   if(window.ackHold)window.ackCallbacks.push(done);else done();
  });
 };
},hold);}
try{
 await page.addInitScript(()=>{
  const write=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){
   if(String(key).startsWith('pena.timeVisitedTasks.')&&localStorage.getItem('test:ack-fail-receipt')==='1'&&JSON.parse(String(value)).some(row=>row.accountedEntries?.length))throw new DOMException('controlled receipt failure','QuotaExceededError');
   return write.apply(this,arguments);
  };
 });
 await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks');await page.locator('.pena-native-time-button').waitFor();await installServer(true);
 await page.locator('.pena-native-time-button').click();await page.waitForFunction(()=>window.contactAckProbe.record()?.data?.totalSeconds===5400);
 assert.equal(await page.evaluate(()=>window.contactAckProbe.contact('independent-before',Date.now()-60000)),true);
 await page.evaluate(()=>window.contactAckProbe.prepare());await page.locator('.pena-native-time-manual-minutes').fill('10');await page.locator('.pena-native-time-manual-submit').click();
 await page.waitForFunction(()=>window.ackCallbacks.length===1);
 const intent=await page.evaluate(()=>window.contactAckProbe.draft().pendingWrite);assert.equal(intent.status,'sending');
 await page.evaluate(async attemptedAt=>{
  const now=Date.now.bind(Date),offset=Math.max(6000,attemptedAt+6000-now());Date.now=()=>now()+offset;
  if(!await window.contactAckProbe.contact('independent-during',attemptedAt+5000))throw new Error('Qualified contact did not commit');
  localStorage.setItem('test:ack-fail-receipt','1');window.ackHold=false;window.ackCallbacks.shift()();
 },intent.attemptedAt);
 await page.waitForFunction(()=>window.contactAckProbe.draft().pendingWrite?.status==='acknowledged');
 const failed=await snapshot('acknowledged-receipt-write-failed');assert.equal(failed.addCalls,1);assert.equal(failed.draft.pendingWrite.itemId,'900001');assert.equal(failed.total,'1 ч 40 мин');report.phases.push({name:'positive ACK is durable despite receipt failure',status:'PASS'});
 await page.evaluate(()=>window.contactAckProbe.load());const reread=await snapshot('forced-native-DATE_START-read-before-receipt');
 assert.match(reread.contactText,/1 контакт/);assert.equal(reread.addCalls,1);
 const nativeItem=reread.record.data.items.find(item=>item.id==='900001');
 assert(nativeItem.recordedAt>intent.attemptedAt+5000,'Native DATE_START must be later than the during-request contact');
 assert.equal(nativeItem.contactCutoffAt,0,'Forced read must actually replace the optimistic cutoff; durable receipt supplies precedence');
 report.phases.push({name:'native reread cannot cover a contact made during held ADD',status:'PASS'});
 await page.reload();await page.locator('.pena-native-time-button').waitFor();await installServer(false);await page.locator('.pena-native-time-button').click();
 await page.waitForFunction(()=>window.contactAckProbe.record()?.data?.totalSeconds===6000);
 const reloaded=await snapshot('reload-with-receipt-still-failing');assert.equal(reloaded.draft.pendingWrite.status,'acknowledged');assert.equal(reloaded.addCalls,1);assert.match(reloaded.contactText,/1 контакт/);
 await page.locator('.pena-native-time-manual-submit').click();await page.locator('.pena-native-time-manual-submit').click();
 assert.equal(await page.evaluate(()=>Number(localStorage.getItem('test:ack-server-adds')||0)),1);
 report.phases.push({name:'reload preserves acknowledged ID and original contact cutoff',status:'PASS'});
 await page.evaluate(()=>localStorage.setItem('test:ack-fail-receipt','0'));
 await page.locator('.pena-native-time-manual-submit').click();
 await page.waitForFunction(()=>window.contactAckProbe.draft().pendingWrite===null);
 await page.evaluate(()=>window.contactAckProbe.load());const recovered=await snapshot('receipt-recovered-and-native-reread');
 assert.equal(recovered.draft.pendingWrite,null);assert.equal(recovered.addCalls,1);assert.equal(recovered.total,'1 ч 40 мин');assert.match(recovered.contactText,/1 контакт/);
 const receipt=recovered.visits.find(row=>row.taskId==='101').accountedEntries.find(entry=>entry.id==='900001');assert.equal(receipt.cutoffAt,intent.contactCutoffAt||intent.attemptedAt);
 report.phases.push({name:'recovery only writes bookkeeping and never duplicates ADD',status:'PASS'});assert.deepEqual(errors,[]);
 for(const width of [344,720]){
  await page.setViewportSize({width,height:850});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const layout=await page.locator('.pena-native-time-suggestions').evaluate(section=>{
   const detail=section.querySelector('.pena-native-time-task-detail'),row=detail.closest('.pena-native-time-task-row'),button=row.querySelector('button.pena-native-time-activity-add');
   const d=detail.getBoundingClientRect(),b=button.getBoundingClientRect(),s=section.getBoundingClientRect();
   return {text:detail.textContent,height:d.height,lineHeight:parseFloat(getComputedStyle(detail).lineHeight),detailRight:d.right,buttonLeft:b.left,sectionLeft:s.left,sectionRight:s.right,viewport:innerWidth};
  });
  assert.match(layout.text,/^Учтено .+\n\+1 контакт после записи$/);assert(layout.height>=layout.lineHeight*2-1);assert(layout.detailRight<=layout.buttonLeft+1);assert(layout.sectionLeft>=0&&layout.sectionRight<=width);
  report.snapshots.push({name:`contact-card-${width}px`,...layout});
  await page.locator('.pena-native-time-panel').screenshot({path:new URL(`./artifacts/time-contact-ack-${width}.png`,import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 }
 report.phases.push({name:'344px and 720px contact cards keep both detail lines and the action legible',status:'PASS'});
 console.log(JSON.stringify(report.phases));
}catch(error){report.error=error.stack;throw error;}finally{report.pageErrors=errors;writeFileSync(new URL('./artifacts/time-contact-ack-acceptance.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();await server.close();}

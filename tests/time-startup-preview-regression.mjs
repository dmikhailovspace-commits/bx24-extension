import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';

const root=resolve(import.meta.dirname,'..');
const extension=resolve(process.env.PENA_EXTENSION_DIR||resolve(root,'extension'));
const raw=readFileSync(resolve(extension,'injected.js'),'utf8');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
assert.equal(raw.split(anchor).length-1,1);
// Read-only state access. All starts, reloads and Pull updates use actual handlers.
const source=raw.replace(anchor,anchor+`
 window.startupPreviewProbe={snapshot:()=>{
  const range=_getDialogTimeRange('today'),r=_getDialogTimeRecord(range);
  return {range,scope:_getDialogTimeProjectScopeKey(),restored:r?.restored===true,verified:r?.hasVerifiedData===true,complete:r?.hasCompleteSnapshot===true,
   seconds:r?.data?.totalSeconds??null,status:r?.status??null,userId:_getCurrentBitrixUserId(),pending:!!_dialogTimeElapsedEventTimer,
   catalog:!!_dialogTimeProjectCatalogOwner,tab:_dialogControlNativeWorkspaceTab};
 }};
`);
const fixture=readFileSync(resolve(root,'tests/native-consistency-harness.html'),'utf8');
const scriptAnchor='  <script src="../extension/injected.js"></script>';
assert.equal(fixture.split(scriptAnchor).length-1,1);
const instrumentedFixture=fixture.replace(scriptAnchor,`<script>
 (()=>{
  const query=new URLSearchParams(location.search),user=query.get('previewUser')||'7';
  if(user!=='7')window.currentBitrixUserId=user;
  if(user!=='7')localStorage.setItem('pena.timeProjects.v1.'+location.host.toLowerCase()+'~'+user,JSON.stringify({version:1,all:true,ids:[],includeUnassigned:true}));
  window.timeTaskGroupOverrides={'102':'2'};
  const day=window.timePortalDateKey();
  // Real Bitrix elapsed IDs are numeric. Seed both identities to verify USER_ID filtering.
  window.timeSeedItems=[
   {ID:'5001',TASK_ID:'101',USER_ID:'7',SECONDS:'3600',CREATED_DATE:day+'T10:00:00+03:00'},
   {ID:'5002',TASK_ID:'102',USER_ID:'7',SECONDS:'1800',CREATED_DATE:day+'T12:00:00+03:00'},
   {ID:'5003',TASK_ID:'101',USER_ID:'8',SECONDS:'900',CREATED_DATE:day+'T12:00:00+03:00'}
  ];
  let hold=query.get('previewHold')==='1';window.previewCatalogHeld=[];
  window.releasePreviewCatalog=()=>{hold=false;for(const release of previewCatalogHeld.splice(0))release();};
  const original=BX.rest.callMethod;
  BX.rest.callMethod=function(method,params,callback){
   if(method==='tasks.task.list'&&params?.order?.ID==='asc'&&hold){previewCatalogHeld.push(()=>original.call(this,method,params,callback));return;}
   if(method==='user.current'&&user!=='7')return callback({error:()=>null,data:()=>({ID:user})});
   return original.apply(this,arguments);
  };
 })();
 </script>\n`+scriptAnchor);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const phases=[],errors=[];
const page=await browser.newPage({viewport:{width:1100,height:800},timezoneId:'UTC'});
const attach=async page=>{
 errors.push(collectPageErrors(page));
 await page.route('**/tests/native-consistency-harness.html?*',route=>route.fulfill({contentType:'text/html',body:instrumentedFixture}));
 await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
};
const url=query=>server.baseUrl+'/tests/native-consistency-harness.html?mode=chats&passThrough=1&taskCatalogRows=4'+query;
const state=page=>page.evaluate(()=>({...startupPreviewProbe.snapshot(),toolbar:document.querySelector('.pena-native-time-button-label')?.textContent,
 panelOpen:!!document.querySelector('.pena-native-time-panel.--open'),elapsed:timeRestCalls.map(params=>String(params[0])),
 full:nativeRestCalls.filter(c=>c.method==='tasks.task.list'&&c.params?.order?.ID==='asc'&&!c.params?.filter?.['>=CHANGED_DATE']).length,
 bootstrap:window.__PENA_TIME_LOAD_DIAGNOSTICS__?.snapshot()}));
const paint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const ready=async(page,seconds,timeout=15000)=>{
 await page.waitForFunction(seconds=>{const s=startupPreviewProbe.snapshot();return s.complete&&s.seconds===seconds&&!s.catalog&&!s.pending&&window.__PENA_TIME_LOAD_DIAGNOSTICS__.snapshot().active===false;},seconds,{timeout});
 await paint(page);
};
const saved=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('pena.timeToday.v1.'+location.host.toLowerCase()+'~7')||'null'));
const waitSaved=page=>page.waitForFunction(()=>!!localStorage.getItem('pena.timeToday.v1.'+location.host.toLowerCase()+'~7'),null,{timeout:5000});
const held=async page=>{await page.waitForFunction(()=>previewCatalogHeld.length>0,null,{timeout:15000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
const phase=async(name,fn)=>{const began=performance.now();try{const detail=await fn();phases.push({name,status:'PASS',ms:performance.now()-began,detail});}catch(error){phases.push({name,status:'FAIL',error:String(error)});throw error;}};
// Shift only wall-clock dates. Native timers and RAF retain their real cadence;
// the fixed offset also preserves clock continuity across page reloads.
const installDateClock=(page,iso)=>page.addInitScript(offset=>{
 const NativeDate=Date;
 function ShiftedDate(...args){
  if(!new.target)return new NativeDate(NativeDate.now()+offset).toString();
  return Reflect.construct(NativeDate,args.length?args:[NativeDate.now()+offset],new.target);
 }
 Object.setPrototypeOf(ShiftedDate,NativeDate);ShiftedDate.prototype=NativeDate.prototype;
 ShiftedDate.now=()=>NativeDate.now()+offset;window.Date=ShiftedDate;
},Date.parse(iso)-Date.now());
let initialSaved;
try{
 await attach(page);await installDateClock(page,'2026-09-08T10:00:00Z');
 await phase('closed startup resolves API identity and loads own today without a panel click',async()=>{
  await page.goto(url('&timeUserCurrentFallback=1&timeUserCurrentDelay=120'));await ready(page,5400,5000);
  const s=await state(page);assert.equal(s.panelOpen,false);assert.notEqual(s.tab,'time');assert.equal(s.userId,'7');assert.match(s.toolbar,/1:30/);
  assert.equal(s.full,1);assert.equal(s.elapsed.length,10);assert.equal(new Set(s.elapsed).size,10);
  await waitSaved(page);initialSaved=await saved(page);assert.equal(initialSaved.offset,180);assert.equal(initialSaved.day,'2026-09-08');assert(initialSaved.items.every(item=>item.userId==='7'));
  return s;
 });
 await phase('reload restores confirmed cached total while the new catalog is held',async()=>{
  await page.goto(url('&previewHold=1'));await held(page);
  await page.waitForFunction(()=>startupPreviewProbe.snapshot().restored,null,{timeout:5000});await paint(page);const s=await state(page);
  assert.equal(s.seconds,5400);assert.equal(s.verified,true);assert.equal(s.complete,false);assert.deepEqual(s.elapsed,[]);assert.match(s.toolbar,/1:30/);assert.equal(s.panelOpen,false);
  await page.screenshot({path:resolve(root,'tests/artifacts/time-startup-preview-restored.png')});return s;
 });
 await phase('released catalog replaces preview with the current backend amount',async()=>{
  await page.evaluate(()=>{timeSeedItems.find(item=>item.ID==='5001').SECONDS='7200';releasePreviewCatalog();});await ready(page,9000);
  const s=await state(page);assert.equal(s.full,1);assert.equal(s.elapsed.length,10);assert.match(s.toolbar,/2:30/);assert.equal(s.panelOpen,false);return s;
 });
 await phase('closed known-task Pull updates toolbar through exactly one elapsed read and no full catalog',async()=>{
  const before=await state(page);
  await page.evaluate(()=>{timeSeedItems.find(item=>item.ID==='5001').SECONDS='10800';const handlers=nativeCustomEventHandlers.get('onPullEvent-tasks')||[];if(!handlers.length)throw Error('Missing actual task Pull handler');for(let i=0;i<12;i++)for(const fn of handlers)fn('task_update',{TASK_ID:'101'});});
  await ready(page,12600);const after=await state(page);
  assert.deepEqual(after.elapsed.slice(before.elapsed.length),['101']);assert.equal(after.full,before.full);assert.equal(after.panelOpen,false);assert.match(after.toolbar,/3:30/);return{before,after};
 });
 await phase('opening after closed completion does not duplicate reads',async()=>{
  const before=await state(page);await page.locator('.pena-native-time-button').click();
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-total-value')?.textContent==='3 ч 30 мин');await page.waitForTimeout(400);
  const after=await state(page);assert.deepEqual(after.elapsed,before.elapsed);assert.equal(after.full,before.full);return after;
 });
 for(const mismatch of ['projects','identity','host'])await phase(`cached preview cannot cross ${mismatch}`,async()=>{
  await page.evaluate(({saved,mismatch})=>{
   const host=location.host.toLowerCase();localStorage.setItem('pena.timeProjects.v1.'+host+'~7',JSON.stringify({version:1,all:mismatch!=='projects',ids:mismatch==='projects'?['2']:[],includeUnassigned:mismatch!=='projects'}));
   const value={...saved,scope:mismatch==='host'?saved.scope.replace(host,'foreign.bitrix24.test'):saved.scope};
   localStorage.setItem('pena.timeToday.v1.'+host+'~7',JSON.stringify(value));
   if(mismatch==='identity')localStorage.setItem('pena.timeToday.v1.'+host+'~8',JSON.stringify({...saved,scope:saved.scope.replace('~7:','~8:')}));
  },{saved:initialSaved,mismatch});
  await page.goto(url('&previewHold=1'+(mismatch==='identity'?'&previewUser=8':'')));await held(page);const s=await state(page);
  assert.equal(s.restored,false);assert.equal(s.seconds,null);assert.deepEqual(s.elapsed,[]);assert.doesNotMatch(s.toolbar,/1:30|3:30/);return s;
 });
 await phase('saved portal-day preview restores across the UTC midnight boundary before catalog completion',async()=>{
  const midnight=await browser.newPage({viewport:{width:1100,height:800},timezoneId:'UTC'});
  try{
   await attach(midnight);await installDateClock(midnight,'2026-09-08T22:30:00Z');
   await midnight.goto(url(''));await ready(midnight,5400);await waitSaved(midnight);
   const stored=await saved(midnight);assert.equal(stored.day,'2026-09-09');assert.equal(stored.offset,180);
   await midnight.goto(url('&previewHold=1'));await held(midnight);
   await midnight.waitForFunction(()=>startupPreviewProbe.snapshot().restored,null,{timeout:5000});await paint(midnight);const s=await state(midnight);
   assert.equal(s.range.from,'2026-09-09');assert.equal(s.seconds,5400);assert.equal(s.complete,false);assert.deepEqual(s.elapsed,[]);assert.match(s.toolbar,/1:30/);return s;
  }finally{await midnight.close();}
 });
 assert.deepEqual(errors.flat(),[]);console.log(`PASS time startup preview: ${phases.length} phases`);
}catch(error){console.error(JSON.stringify({phases,last:await state(page).catch(()=>null),errors:errors.flat()},null,2));throw error;}
finally{writeFileSync(resolve(root,'tests/artifacts/time-startup-preview-report.json'),JSON.stringify({phases,errors:errors.flat()},null,2));await browser.close();await server.close();}

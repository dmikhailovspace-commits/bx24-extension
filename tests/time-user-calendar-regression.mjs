import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const model=createRequire(import.meta.url)('../extension/native-time-control.js');
const report={phases:[],limitations:'Controlled Chromium REST fixture, browser timezone Europe/Moscow; no live portal.'};
const phase=async(name,run)=>{try{report.phases.push({name,status:'PASS',evidence:await run()});}catch(error){report.phases.push({name,status:'FAIL',error:error.stack});throw error;}};
const zone={timeZone:'Europe/Moscow',utcOffsetMinutes:180};
const rows=[
 {ID:'1',TASK_ID:'101',USER_ID:'7',SECONDS:600,CREATED_DATE:'2026-09-08T21:30:00Z'},
 {ID:'2',TASK_ID:'101',USER_ID:'7',SECONDS:1200,CREATED_DATE:'2026-09-09T12:00:00Z'},
 {ID:'3',TASK_ID:'101',USER_ID:'7',SECONDS:900,CREATED_DATE:'2026-09-08T20:30:00Z'},
 {ID:'4',TASK_ID:'101',USER_ID:'8',SECONDS:99900,CREATED_DATE:'2026-09-08T21:30:00Z'}
];
const read=params=>{
 const [task,order,filter,,nav]=params;
 const selected=rows.filter(row=>(!Number(task)||String(task)===row.TASK_ID)&&String(filter.USER_ID)===row.USER_ID&&
  (!filter['>=CREATED_DATE']||Date.parse(row.CREATED_DATE)>=Date.parse(filter['>=CREATED_DATE']))&&(!filter['<CREATED_DATE']||Date.parse(row.CREATED_DATE)<Date.parse(filter['<CREATED_DATE']))&&
  (filter.ID==null||String(filter.ID)===row.ID)&&(filter['>ID']==null||Number(row.ID)>Number(filter['>ID'])));
 selected.sort((a,b)=>(Number(a.ID)-Number(b.ID))*(String(order.ID).toUpperCase()==='DESC'?-1:1));
 return{data:selected.slice(0,nav.NAV_PARAMS.nPageSize),total:selected.length,next:null};
};
let browser,server;
try{
 await phase('user calendar and elapsed journal share midnight boundaries without double counting',async()=>{
  const at=Date.parse('2026-09-08T21:30:00Z');assert.equal(model.calendarDateKey(at,zone),'2026-09-09');
  const first=await model.loadGlobalElapsedItems({from:'2026-09-08',to:'2026-09-08',userId:'7',...zone,callPage:async params=>read(params)});
  const second=await model.loadGlobalElapsedItems({from:'2026-09-09',to:'2026-09-09',userId:'7',...zone,callPage:async params=>read(params)});
  assert.equal(first.totalSeconds,900);assert.equal(second.totalSeconds,1800);assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,3);
  assert.equal(second.items.find(item=>item.id==='1').dateKey,'2026-09-09');assert.equal(Date.parse(second.items.find(item=>item.id==='1').createdAt),at);
  assert.equal(model.aggregateElapsedItems(second.items).totalSeconds,1800);assert.equal(model.aggregateElapsedItems(second.items).days[0].dateKey,'2026-09-09');
  const legacy=await model.loadElapsedItems({taskIds:['101'],from:'2026-09-09',to:'2026-09-09',userId:'7',...zone,callPage:async params=>read(params)});
  assert.equal(legacy.totalSeconds,second.totalSeconds);
  const original=model.buildElapsedRequestParams({taskId:'101',from:'2026-09-09',to:'2026-09-09'});assert.equal(original[2]['>=CREATED_DATE'],'2026-09-09T00:00:00');
  return{day8:first.totalSeconds,day9:second.totalSeconds,firstUserTimestamp:second.items[0].createdAt,legacySeconds:legacy.totalSeconds};
 });
 await phase('IANA DST boundaries use the offset for each day and conserve all timer seconds',async()=>{
  const dst={timeZone:'America/New_York',utcOffsetMinutes:-300};
  const request=model.buildElapsedRequestParams({taskId:'101',from:'2026-03-08',to:'2026-03-08',...dst});
  assert.equal(request[2]['>=CREATED_DATE'],'2026-03-08T00:00:00-05:00');assert.equal(request[2]['<CREATED_DATE'],'2026-03-09T00:00:00-04:00');
  const start=Date.parse('2026-03-08T04:30:00Z'),stop=Date.parse('2026-03-09T04:30:00Z');
  const segments=model.segmentTimerByPortalDay({startedAt:start,stoppedAt:stop,...dst});assert.deepEqual(segments,[{dateKey:'2026-03-07',seconds:1800},{dateKey:'2026-03-08',seconds:82800},{dateKey:'2026-03-09',seconds:1800}]);
  const write=model.buildElapsedWriteFields({seconds:60,dateKey:'2026-03-08',offsetMinutes:-300,timeZone:dst.timeZone});assert.equal(write.CREATED_DATE,'2026-03-08T12:00:00-04:00');
  const fall=model.segmentTimerByPortalDay({startedAt:Date.parse('2026-11-01T04:00:00Z'),stoppedAt:Date.parse('2026-11-02T05:00:00Z'),...dst});
  assert.deepEqual(fall,[{dateKey:'2026-11-01',seconds:86400},{dateKey:'2026-11-01',seconds:3600}]);
  for(const segment of fall)assert.doesNotThrow(()=>model.buildElapsedWriteFields({...segment,offsetMinutes:-300,timeZone:dst.timeZone}));
  const repeated=[{ID:'10',TASK_ID:'101',USER_ID:'7',SECONDS:60,CREATED_DATE:'2026-11-01T05:30:00Z'},{ID:'11',TASK_ID:'101',USER_ID:'7',SECONDS:60,CREATED_DATE:'2026-11-01T06:00:00Z'}].map(item=>model.normalizeElapsedItem(item,dst));
  const repeatedTotal=model.aggregateElapsedItems(repeated);assert.deepEqual(repeatedTotal.items.map(item=>item.id),['11','10']);assert.equal(Date.parse(repeatedTotal.tasks[0].lastTrackedAt),Date.parse('2026-11-01T06:00:00Z'));
  const merged=model.replaceElapsedTasks(model.aggregateElapsedItems([]),repeatedTotal,new Set(['101']));assert.deepEqual(merged.items.map(item=>item.id),['11','10']);
  return{filter:request[2],segments,write,fall,fallOrder:merged.items.map(item=>item.id)};
 });
 server=await startHarnessServer();browser=await chromium.launch({headless:true});
 const raw=readFileSync(resolve('extension/injected.js'),'utf8'),anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
 const source=raw.replace(anchor,anchor+`
  window.userCalendarProbe={snapshot:()=>({today:_getDialogTimeRange('today'),selected:_getDialogTimeSelectedRange(),zone:_getDialogTimeCalendarZone(),offset:_dialogTimePortalUtcOffsetMinutes,
   record:_getDialogTimeRecord(_getDialogTimeRange('today')),selectedRecord:_getDialogTimeRecord(_getDialogTimeSelectedRange()),dayKey:_dialogTimePortalDateKey,contactDay:_getDialogTimeContactDateKey(Date.parse('2026-09-08T21:30:00Z'))})};`);
 let fixture=readFileSync(resolve('tests/native-consistency-harness.html'),'utf8');
 fixture=fixture.replace('  <script src="../extension/injected.js"></script>',`<script>
  (()=>{
   const old=BX.rest.callMethod,oldMessage=BX.message;window.userCalendarCalls=[];
   BX.message=key=>window.userCalendarNativeZone?.[key]??(key==='USER_TZ_AUTO'?'Y':oldMessage.call(BX,key));
   BX.rest.callMethod=function(method,params,callback){
    if(method==='server.time')return callback({error:()=>null,data:()=>new Date().toISOString()});
    if(method==='task.elapseditem.getlist'){
     userCalendarCalls.push(params);const rows=${JSON.stringify(rows)};
     const result=(${read.toString()})(params);return callback({error:()=>null,data:()=>result.data,total:()=>result.total,answer:{}});
    }
    return old.apply(this,arguments);
   };
  })();
 </script><script src="../extension/injected.js"></script>`);
 for(const [name,startAt,historical] of [['UTC8 becomes user9','2026-09-08T21:30:00Z',false],['open today follows midnight','2026-09-08T20:59:56Z',false],['historical date survives midnight','2026-09-08T20:59:56Z',true],['same-day profile timezone change rechecks its own journal','2026-09-09T12:30:00Z',false]]){
  await phase(name,async()=>{
   const page=await browser.newPage({viewport:{width:1100,height:800},timezoneId:'Europe/Moscow'}),errors=collectPageErrors(page);
   try{
    await page.addInitScript(offset=>{
     const Native=Date;function Shifted(...args){if(!new.target)return new Native(Native.now()+offset).toString();return Reflect.construct(Native,args.length?args:[Native.now()+offset],new.target);}
     Object.setPrototypeOf(Shifted,Native);Shifted.prototype=Native.prototype;Shifted.now=()=>Native.now()+offset;window.Date=Shifted;
    },Date.parse(startAt)-Date.now());
    await page.route('**/tests/native-consistency-harness.html?*',route=>route.fulfill({contentType:'text/html',body:fixture}));
    await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
    await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=chats&passThrough=1&taskCatalogRows=4');
    await page.waitForFunction(()=>userCalendarProbe.snapshot().record?.hasCompleteSnapshot===true,undefined,{timeout:10000});
    if(startAt.includes('20:59')){
     await page.locator('.pena-native-time-button').click();
     if(historical){await page.locator('.pena-native-time-date-input').fill('2026-09-06');await page.locator('.pena-native-time-date-input').dispatchEvent('change');}
     await page.waitForFunction(()=>userCalendarProbe.snapshot().dayKey==='2026-09-09'&&userCalendarProbe.snapshot().record?.hasCompleteSnapshot===true,undefined,{timeout:8000});
    }
    const state=await page.evaluate(()=>({...userCalendarProbe.snapshot(),calls:userCalendarCalls,toolbar:document.querySelector('.pena-native-time-button-label').textContent}));
    assert.equal(state.today.from,'2026-09-09');assert.equal(state.dayKey,'2026-09-09');assert.equal(state.record.data.totalSeconds,1800);assert.equal(state.contactDay,'2026-09-09');
    assert.equal(state.selected.from,historical?'2026-09-06':'2026-09-09');assert.equal(state.offset,180);assert.match(state.toolbar,/0:30/);
    assert.ok(state.calls.some(params=>params[2]['>=CREATED_DATE']==='2026-09-09T00:00:00+03:00'));assert.deepEqual(errors,[]);
    if(name.startsWith('same-day')){
     await page.locator('.pena-native-time-button').click();await page.locator('.pena-native-time-date-input').fill('2026-09-08');await page.locator('.pena-native-time-date-input').dispatchEvent('change');
     await page.waitForFunction(()=>userCalendarProbe.snapshot().selectedRecord?.hasCompleteSnapshot===true);
     await page.evaluate(()=>{window.userCalendarNativeZone={USER_TZ_AUTO:'N',SERVER_TZ_OFFSET:'0',USER_TZ_OFFSET:'0'};window.dispatchEvent(new Event('focus'));});
     await page.waitForFunction(()=>userCalendarProbe.snapshot().record?.hasCompleteSnapshot===true&&userCalendarProbe.snapshot().record.data.totalSeconds===1200&&userCalendarProbe.snapshot().selectedRecord?.hasCompleteSnapshot===true,undefined,{timeout:10000});
     const changed=await page.evaluate(()=>({...userCalendarProbe.snapshot(),calls:userCalendarCalls}));assert.equal(changed.today.from,'2026-09-09');assert.equal(changed.selected.from,'2026-09-08');assert.equal(changed.selectedRecord.data.totalSeconds,1500);assert.equal(changed.offset,0);
     assert.ok(changed.calls.some(params=>params[2]['>=CREATED_DATE']==='2026-09-09T00:00:00+00:00'));assert.equal(changed.record.data.items.length,1);return{before:1800,after:1200,unchangedDay:changed.today.from,historicalDay:changed.selected.from,historicalSeconds:changed.selectedRecord.data.totalSeconds};
    }
    return{today:state.today,selected:state.selected,offset:state.offset,seconds:state.record.data.totalSeconds,calls:state.calls.length};
   }finally{await page.close();}
  });
 }
 console.log('PASS user calendar: '+report.phases.length+' phases');
}catch(error){process.exitCode=1;console.error(error.stack);}
finally{mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/time-user-calendar-regression.json',JSON.stringify(report,null,2)+'\n');await browser?.close();await server?.close();}

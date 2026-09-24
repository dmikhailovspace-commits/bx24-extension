import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';

const root=resolve(import.meta.dirname,'..');
const extension=resolve(process.env.PENA_EXTENSION_DIR||resolve(root,'extension'));
const raw=readFileSync(resolve(extension,'injected.js'),'utf8');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
assert.equal(raw.split(anchor).length,2);
const source=raw.replace(anchor,anchor+`
 window.startupCycleProbe={snapshot:()=>{
  const day=_getDialogTimeRange('today'),r=_getDialogTimeRecord(day);
  return {user:_dialogCurrentBitrixUserId,range:day,complete:r?.hasCompleteSnapshot===true,seconds:r?.data?.totalSeconds??null,
   status:r?.status,scope:_getDialogTimeProjectScopeKey(),catalogScope:_dialogTimeCatalogScope,catalogReady:_dialogTimeCatalogCursor>0,
   bootstrap:_dialogTimeBootstrapToken?{..._dialogTimeBootstrapToken}:null,panelOpen:!!document.querySelector('.pena-native-time-panel'),
   tab:_dialogControlNativeWorkspaceTab,toolbar:document.querySelector('.pena-native-time-button-label')?.textContent};
 }};`);
let fixture=readFileSync(resolve(root,'tests/native-resume-recovery-harness.html'),'utf8');
fixture=fixture.replace(/^.*window\.__PENA_(?:TEST_|FORCE_REST_CATALOG).*$/gm,'')
 .replace('setInterval(sampleGuard, 16);','')
 .replace('const controlled = Number(delay) === 60 * 1000;','const controlled = false;')
 .replace('#anit-filters, #anit-dialog-control-dock { display: none !important; }','');
const apiAnchor="      if (method === 'im.recent.list') {";
assert.equal(fixture.split(apiAnchor).length,2);
fixture=fixture.replace(apiAnchor,`
      if(method==='server.time')return success(new Date().toISOString());
      if(method==='user.current')return success({ID:'7'});
      if(method==='task.elapseditem.getlist'){
        if(!Array.isArray(callParams)||!callParams[4]?.NAV_PARAMS)throw Error('Expected positional elapsed API');
        const [taskId,order,filter,,navigation]=callParams;
        const day=new Date().toISOString().slice(0,10),previous=new Date(Date.now()-86400000).toISOString().slice(0,10);
        const rows=[
          {ID:'7001',TASK_ID:String(taskEntries[0].id),USER_ID:'7',SECONDS:3600,CREATED_DATE:day+'T12:00:00Z'},
          {ID:'7002',TASK_ID:String(taskEntries[1].id),USER_ID:'7',SECONDS:1800,CREATED_DATE:day+'T13:00:00Z'},
          {ID:'7003',TASK_ID:String(taskEntries[0].id),USER_ID:'8',SECONDS:99900,CREATED_DATE:day+'T12:00:00Z'},
          {ID:'7004',TASK_ID:String(taskEntries[0].id),USER_ID:'7',SECONDS:99900,CREATED_DATE:previous+'T12:00:00Z'}
        ].filter(row=>(!Number(taskId)||String(taskId)===row.TASK_ID)&&String(filter.USER_ID)===row.USER_ID&&
          (!filter['>=CREATED_DATE']||row.CREATED_DATE>=filter['>=CREATED_DATE'])&&(!filter['<CREATED_DATE']||row.CREATED_DATE<filter['<CREATED_DATE'])&&
          (filter.ID==null||String(filter.ID)===row.ID)&&(filter['>ID']==null||Number(row.ID)>Number(filter['>ID'])));
        rows.sort((a,b)=>(Number(a.ID)-Number(b.ID))*(String(order.ID).toUpperCase()==='DESC'?-1:1));
        const size=navigation.NAV_PARAMS.nPageSize,start=(navigation.NAV_PARAMS.iNumPage-1)*size;
        return success(rows.slice(start,start+size),{total:rows.length,next:start+size<rows.length?start+size:null});
      }
`+apiAnchor);
const lateAnchor="    window.BX = { message(key) { return key === 'USER_ID' ? '7' : ({ SERVER_TZ_OFFSET:'0', USER_TZ_OFFSET:'0', USER_TZ_AUTO:'N' }[key] || ''); }, rest: { callMethod(method, callParams, callback) {";
assert.equal(fixture.split(lateAnchor).length,2);
fixture=fixture.replace(lateAnchor,`
    window.startupCycleLateSnapshot=()=>{
      const extra={...recordsByMode.chats.at(-1),id:'chat991999',numericId:991999,title:'Поздний подтверждённый диалог',timestamp:Date.now()-9999999};
      recordsByMode.chats.push(extra);chatEntries.push(apiEntry(extra));
      const physical=sources.chats;physical.physicalCount=recordsByMode.chats.length;physical.materializedThrough=recordsByMode.chats.length-1;
      physical.list.style.height=(recordsByMode.chats.length*ROW_HEIGHT)+'px';physical.scheduleRender();
      const ids=recordsByMode.chats.map(row=>row.id);
      return{manifest:{schema:2,revision:1,catalogVersion:1,savedAt:Date.now(),catalogModes:{chats:{complete:true,loadedAt:Date.now(),count:ids.length,confirmedIds:ids}}},
        records:recordsByMode.chats.map(row=>({id:row.id,mode:'chats',title:row.title,chatId:String(row.numericId),lastMessageTs:row.timestamp}))};
    };
`+lateAnchor);
// Hold SDK callbacks only. No production function is called by this fixture.
const scriptAnchor='  <script src="../extension/injected.js"></script>';
assert.equal(fixture.split(scriptAnchor).length,2);
fixture=fixture.replace(scriptAnchor,`<script>
 (()=>{
  const query=new URLSearchParams(location.search),mode=query.get('identityMode')||'early',repository=query.get('repository')||'',clockFailure=query.get('clockFailure')==='1';
  const state=window.startupCycleServer={mode,repository,clockFailure,startedAt:performance.now(),calls:[],repositoryCalls:0,repositoryResolvedAt:0,identityReleased:mode==='early',identityReleasedAt:mode==='early'?performance.now():0,heldIdentity:[],visibleCompletedAt:0,readyAt:0,totalAt:0};
  if(repository)window.__PENA_DIALOG_REPOSITORY__={
   get:()=>{state.repositoryCalls++;return new Promise(resolve=>{if(repository==='delayed'||repository==='late-tail')setTimeout(()=>{state.repositoryResolvedAt=performance.now();resolve(repository==='late-tail'?window.startupCycleLateSnapshot():{manifest:null,records:[]});},5000);});},
   patch:async()=>({ok:true}),commit:async()=>({ok:true})
  };
  const original=BX.rest.callMethod;
  BX.message=key=>key==='USER_ID'?(mode==='early'?'7':''):({ SERVER_TZ_OFFSET:'0', USER_TZ_OFFSET:'0', USER_TZ_AUTO:'N' }[key]||'');
  BX.rest.callMethod=function(method,params,callback){
   state.calls.push({method,params,at:performance.now()});
   if(method==='server.time'&&clockFailure&&state.calls.filter(call=>call.method==='server.time').length===1){
    queueMicrotask(()=>callback({error:()=>'NETWORK_ERROR',error_description:()=>'Controlled initial clock failure'}));return;
   }
   const send=()=>original.call(this,method,params,callback);
   if(method==='user.current'&&!state.identityReleased){state.heldIdentity.push(send);return;}
   return send();
  };
  state.releaseIdentity=()=>{
   if(state.identityReleased)return;state.identityReleased=true;state.identityReleasedAt=performance.now();
   for(const send of state.heldIdentity.splice(0))send();
  };
  const sample=()=>{
   if(document.querySelector('.bx-im-list-recent-item__wrap')&&!state.visibleCompletedAt)state.visibleCompletedAt=performance.now();
   if((window.__PENA_RECENT_SYNC__?.gateReady === true)&&!state.readyAt)state.readyAt=performance.now();
   if(window.startupCycleProbe?.snapshot().complete&&!state.totalAt)state.totalAt=performance.now();
   if(mode==='after-visible'&&state.visibleCompletedAt)state.releaseIdentity();
   if(mode==='after-ready'&&state.readyAt)state.releaseIdentity();
   requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
  if(mode==='delayed')setTimeout(state.releaseIdentity,1200);
 })();
 </script>\n`+scriptAnchor);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const report={sourceSha:createHash('sha256').update(raw).digest('hex'),phases:[],limitations:'Actual recycled 108-dialog Chromium fixture with production flags; controlled Bitrix REST replies and identity delay. No time-panel clicks, direct bootstrap calls, forced lifecycle events, or live portal.'};
const snapshot=page=>page.evaluate(()=>({time:startupCycleProbe.snapshot(),native:__resumeHarness.state(),server:{...startupCycleServer,heldIdentity:startupCycleServer.heldIdentity.length,releaseIdentity:undefined},queue:window.__PENA_REST_DIAGNOSTICS__?.snapshot()}));
try{
 const cases=[{name:'early',identityMode:'early'},{name:'delayed',identityMode:'delayed'},{name:'after-visible',identityMode:'after-visible'},
  {name:'after-ready',identityMode:'after-ready'},{name:'repository-never',identityMode:'early',repository:'never'},
  {name:'repository-delayed',identityMode:'early',repository:'delayed'},{name:'repository-late-tail',identityMode:'early',repository:'late-tail'},
  {name:'clock-retry',identityMode:'early',clockFailure:'1'},
  {name:'clock-after-ready',identityMode:'after-ready',clockFailure:'1'}];
 for(const scenario of cases.filter(item=>!process.env.PENA_STARTUP_CYCLE_CASE||process.env.PENA_STARTUP_CYCLE_CASE.split(',').includes(item.name))){
  const {name,identityMode}=scenario;
  const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=collectPageErrors(page),started=performance.now();
  try{
   await page.route('**/tests/native-resume-recovery-harness.html?*',route=>route.fulfill({contentType:'text/html',body:fixture}));
   await page.route('**/extension/*.js*',route=>{
    const filename=new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({contentType:'application/javascript',body:filename==='injected.js'?source:readFileSync(resolve(extension,filename),'utf8')});
   });
   await page.goto(server.baseUrl+'/tests/native-resume-recovery-harness.html?'+new URLSearchParams({autoBootstrap:'1',...scenario}));
   assert.deepEqual(await page.evaluate(()=>Object.keys(window).filter(key=>key.startsWith('__PENA_TEST_'))),[]);
   await page.waitForFunction(()=>(window.__PENA_RECENT_SYNC__?.gateReady === true)&&startupCycleProbe.snapshot().complete,undefined,{timeout:scenario.clockFailure?45000:25000});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const ready=await snapshot(page);
   assert.equal(ready.time.seconds,5400);assert.match(ready.time.toolbar,/1:30/);assert.equal(ready.time.panelOpen,false);assert.notEqual(ready.time.tab,'time');
   assert.equal(ready.native.modes.chats.sourceComplete,false);assert.equal(ready.native.modes.chats.observedIds.length,ready.native.modes.chats.poolSize);
   assert.ok(ready.native.modes.chats.poolSize<108);assert.equal(ready.native.status.modeStates.chats.materialization.nativePassCount,0);assert.equal(ready.server.calls.filter(call=>call.method==='im.recent.list').length,0);
   const elapsed=ready.server.calls.filter(call=>call.method==='task.elapseditem.getlist');assert.equal(elapsed.length,1);assert.equal(Number(elapsed[0].params[0]),0);
   if(identityMode!=='early'){assert.equal(ready.server.calls.filter(call=>call.method==='user.current').length,1);assert.ok(elapsed[0].at>=ready.server.identityReleasedAt);}
   if(identityMode==='after-visible')assert.ok(ready.server.identityReleasedAt>=ready.server.visibleCompletedAt);
   if(identityMode==='after-ready')assert.ok(ready.server.identityReleasedAt>=ready.server.readyAt);
   if(scenario.repository){assert.equal(ready.server.repositoryCalls,1);assert.ok(ready.server.readyAt-ready.server.startedAt<4500,'Repository must not delay physical startup');assert.ok(ready.server.totalAt-ready.server.startedAt<4500,'Repository must not delay today');}
   const taskHeads=ready.server.calls.filter(call=>call.method==='tasks.task.list'&&String(call.params.order?.ID).toLowerCase()==='asc'&&!Number(call.params.filter?.['>ID'])&&!Number(call.params.start)&&!call.params.filter?.['>=CHANGED_DATE']);
   assert.equal(taskHeads.length,1,'Native/time startup must share one full task catalog');
   if(scenario.clockFailure){assert.ok(ready.server.calls.filter(call=>call.method==='server.time').length>=2);assert.ok(elapsed[0].at>ready.server.calls.filter(call=>call.method==='server.time')[1].at,'Elapsed dates must come from the successful clock response');}
   await page.waitForTimeout(['delayed','late-tail'].includes(scenario.repository)?Math.max(800,5500-ready.server.totalAt):800);
   if(scenario.repository==='late-tail'){
    await page.waitForFunction(()=>(window.__PENA_RECENT_SYNC__?.gateReady === true)&&__resumeHarness.state().modes.chats.catalogIds.includes('chat991999'),undefined,{timeout:20000});
   }
   const settled=await snapshot(page);assert.equal(settled.server.calls.filter(call=>call.method==='task.elapseditem.getlist').length,1,'Ready cycle must not reread its journal');
   assert.equal(settled.time.seconds,5400);assert.deepEqual(errors,[]);
   if(scenario.repository==='late-tail'){assert.equal(settled.native.status.modeStates.chats.materialization.nativePassCount,0);assert.equal(settled.native.modes.chats.observedIds.includes('chat991999'),false);assert.ok(settled.native.modes.chats.catalogIds.includes('chat991999'));}
   report.phases.push({name,status:'PASS',ms:performance.now()-started,evidence:ready,settledTime:settled.time,settledNative:scenario.repository==='late-tail'?settled.native.modes.chats:undefined});
  }catch(error){report.phases.push({name,status:'FAIL',error:error.stack,evidence:await snapshot(page).catch(()=>null),errors});throw error;}
  finally{await page.close();}
 }
 console.log('PASS closed startup cycle: '+report.phases.length+' phases');
}catch(error){process.exitCode=1;console.error(error.stack);}
finally{mkdirSync(resolve(root,'tests/artifacts'),{recursive:true});writeFileSync(resolve(root,'tests/artifacts/time-startup-cycle-regression.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await server.close();}

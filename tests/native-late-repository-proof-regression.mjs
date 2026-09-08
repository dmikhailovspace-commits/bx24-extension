import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
let fixture=readFileSync(new URL('./native-resume-recovery-harness.html',import.meta.url),'utf8');
const anchor="    const restResult = (method, callParams = {}) => {";
assert.ok(fixture.includes(anchor));
fixture=fixture.replace(anchor,`
    const lateExtra={...recordsByMode.chats.at(-1),id:'chat991999',numericId:991999,title:'Поздний подтверждённый диалог',timestamp:Date.now()-99999999};
    window.lateRepoFixture={unavailable:false,checks:0,release:null,reveal(){
      recordsByMode.chats.push(lateExtra);const s=sources.chats;s.physicalCount=recordsByMode.chats.length;s.materializedThrough=recordsByMode.chats.length-1;
      s.list.style.height=(recordsByMode.chats.length*ROW_HEIGHT)+'px';s.scheduleRender();
    }};
    window.__PENA_DIALOG_REPOSITORY__={get:()=>new Promise(resolve=>{window.lateRepoFixture.release=()=>{
      const rows=[...recordsByMode.chats,lateExtra],ids=rows.map(row=>row.id);
      resolve({manifest:{schema:2,revision:1,catalogVersion:1,savedAt:Date.now(),catalogModes:{chats:{complete:true,loadedAt:Date.now(),count:ids.length,confirmedIds:ids}}},records:rows.map(row=>({id:row.id,mode:'chats',title:row.title,chatId:String(row.numericId),lastMessageTs:row.timestamp}))});
    };}),patch:async()=>({ok:true}),commit:async()=>({ok:true})};
`+anchor+`
      if(method==='im.dialog.get'&&String(callParams.DIALOG_ID)==='chat991999'){
        window.lateRepoFixture.checks++;
        return window.lateRepoFixture.unavailable ? {error:()=> 'CHAT_NOT_FOUND',error_description:()=> 'Chat not found',data:()=>null,answer:{}} : success({dialog:apiEntry(lateExtra)});
      }
`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});const phases=[];
try{for(const moment of ['during','after']){
 const page=await browser.newPage({viewport:{width:430,height:780}}),errors=collectPageErrors(page);
 await page.route('**/tests/native-resume-recovery-harness.html?*',r=>r.fulfill({status:200,contentType:'text/html',body:fixture}));
 await page.goto(server.baseUrl+'/tests/native-resume-recovery-harness.html?autoBootstrap=1&timeProjects=unconfigured');
 if(moment==='during')await page.waitForFunction(()=>window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive);
 else await page.waitForFunction(()=>window.__resumeHarness?.ready('chats')&&!window.__PENA_NATIVE_PREFETCH__.status().originalActive,null,{timeout:15000});
 await page.evaluate(()=>window.lateRepoFixture.release());
 await page.waitForFunction(()=>window.__PENA_NATIVE_FAILURE_DEBUG__?.blockingExpected?.includes('chat991999'),null,{timeout:18000});
 const blocked=await page.evaluate(()=>({failure:window.__PENA_NATIVE_FAILURE_DEBUG__,checks:window.lateRepoFixture.checks,ready:window.__resumeHarness.ready('chats'),state:window.__resumeHarness.state()}));
 assert.equal(blocked.ready,false,moment+' late baseline must prevent readiness');assert.ok(blocked.checks>0);assert.ok(blocked.failure.blockingExpected.includes('chat991999'));
 await page.waitForFunction(()=>!window.__PENA_NATIVE_PREFETCH__.status().originalActive);
 if(moment==='during')await page.evaluate(()=>{window.lateRepoFixture.unavailable=true;window.__PENA_NATIVE_PREFETCH__.runOriginal({reason:'manual'});});
 else await page.evaluate(()=>{window.lateRepoFixture.reveal();window.__PENA_NATIVE_PREFETCH__.runOriginal({reason:'manual'});});
 await page.waitForFunction(()=>window.__resumeHarness.ready('chats')&&!window.__PENA_NATIVE_PREFETCH__.status().originalActive,null,{timeout:20000}).catch(async error=>{writeFileSync(new URL('./artifacts/native-late-repository-failure.json',import.meta.url),JSON.stringify(await page.evaluate(()=>({fixture:window.lateRepoFixture,state:window.__resumeHarness.state(),bottom:window.__PENA_NATIVE_BOTTOM_DEBUG__,failure:window.__PENA_NATIVE_FAILURE_DEBUG__})),null,2));throw error;});
 const state=await page.evaluate(()=>window.__resumeHarness.state()),ids=state.modes.chats.observedIds;
 assert.equal(ids.length,moment==='during'?108:109);assert.equal(ids.includes('chat991999'),moment==='after');assert.equal(state.modes.chats.scrollTop,3377);assert.equal(state.guardVisible,false);assert.deepEqual(errors,[]);
 phases.push({moment,status:'PASS',blockedChecks:blocked.checks,finalDialogs:ids.length,resolution:moment==='during'?'API confirmed unavailable':'physically revealed'});await page.close();
}console.log('PASS late repository independent lower bound:',JSON.stringify(phases));}finally{writeFileSync(new URL('./artifacts/native-late-repository-proof-regression.json',import.meta.url),JSON.stringify({phases},null,2));await browser.close();await server.close();}

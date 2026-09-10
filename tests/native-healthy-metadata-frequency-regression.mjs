import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';

const raw=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
assert.ok(raw.includes(anchor));
const probe=`
 delete window.__PENA_TEST_DIALOG_HEAD_TTL_MS__;
 window.headFrequencyProbe={
  run:reason=>_runDialogWakeReconcile(reason,{metadataOnly:true}),
  resetFreshness:()=>{_dialogRecentLastSuccessAt=Date.now();},
  policy:change=>{
   const container=findContainer(),viewport=findInternalScrollContainer(container),mode='chats';
   const options={reason:'periodic-freshness',metadataOnly:true,mode,container,viewport,sourceGeneration:_getDialogNativeSourceGeneration(mode,container,viewport),...change};
   return _getDialogRecentHeadRefreshMs(options);
  },
  retryPolicy:()=>{_dialogNativeMetadataRetryStates.set('chats',{reason:'fixture'});try{return headFrequencyProbe.policy({});}finally{_dialogNativeMetadataRetryStates.delete('chats');}},
  retry:()=>{_dialogNativeMetadataRetryStates.set('chats',{reason:'fixture-required-audit',retryAttempt:0,retryAt:0});return _runDialogWakeReconcile('retry:fixture',{metadataOnly:true});},
  invalidPolicy:()=>{const m=_dialogNativeMaterializedSources.get('chats'),old=m.invalidated;m.invalidated=true;try{return headFrequencyProbe.policy({});}finally{m.invalidated=old;}},
  revision:()=>_dialogNativeMaterializedSources.get('chats')?.revision
 };
`;
// The v128 head policy was an unconditional 60-second TTL. Keep this causal
// comparison self-contained: all other runtime/fixture behavior is identical.
const baselineGetter=`\tfunction _getDialogRecentHeadRefreshMs() { return 60000; }\n\n`;
const begin=raw.indexOf('\tfunction _getDialogRecentHeadRefreshMs('),end=raw.indexOf('\tfunction _getDialogTaskCatalogRefreshMs(',begin);
assert.ok(begin>0&&end>begin);
const baseline=raw.slice(0,begin)+baselineGetter+raw.slice(end);
const report={limitations:'Controlled Chromium fixture; 12 simulated minutes, real runtime REST calls; v128 head-policy counterfactual, not live Bitrix timings.',runs:[]};
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
try{
 for(const [label,code] of [['v128-head-policy',baseline],['healthy-head-policy',raw]]){
  const page=await browser.newPage({viewport:{width:430,height:780}}),errors=collectPageErrors(page);
  try{
   await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:code.replace(anchor,anchor+probe)}));
   await page.goto(server.baseUrl+'/tests/native-resume-recovery-harness.html');
   await page.waitForFunction(()=>__resumeHarness.ready('chats')&&!__PENA_NATIVE_PREFETCH__.status().originalActive&&!__PENA_NATIVE_PREFETCH__.status().modeLoadPending&&!__PENA_NATIVE_PREFETCH__.status().reconcile.active,undefined,{timeout:30000});
   await page.waitForTimeout(500);
   const result=await page.evaluate(async()=>{
    headFrequencyProbe.resetFreshness();
    const mark=__resumeHarness.mark('chats'),revision=headFrequencyProbe.revision(),counts=[];
    for(let minute=1;minute<=12;minute++){
     __resumeHarness.advanceClock(60010);
     await headFrequencyProbe.run('periodic-freshness');
     await headFrequencyProbe.run('focus-freshness');
     await headFrequencyProbe.run('visibility-freshness');
     counts.push(__resumeHarness.state().restCalls.slice(mark.restCalls).filter(x=>(x.method==='im.recent.list'||x.method==='im.recent.get')).length);
    }
    const delta=__resumeHarness.delta('chats',mark);
    return{counts,headRequests:counts.at(-1),delta,revision,finalRevision:headFrequencyProbe.revision(),policy:headFrequencyProbe.policy({}),errors:__PENA_NATIVE_PREFETCH__.status().metadataRetryModes};
   });
   assert.equal(result.headRequests,label==='v128-head-policy'?12:3,JSON.stringify(result));
   assert.equal(result.delta.materialization.fullWalks,0);assert.equal(result.delta.movement.bottomVisits,0);assert.equal(result.delta.guardActivationTotal,0);
   assert.equal(result.finalRevision,result.revision);
   if(label==='healthy-head-policy'){
    const policy=await page.evaluate(()=>({healthy:headFrequencyProbe.policy({}),retry:headFrequencyProbe.retryPolicy(),invalid:headFrequencyProbe.invalidPolicy(),source:headFrequencyProbe.policy({sourceGeneration:-1}),online:headFrequencyProbe.policy({reason:'online-freshness'}),resume:headFrequencyProbe.policy({reason:'page-resume'}),tail:headFrequencyProbe.policy({tailProbe:true})}));
    assert.deepEqual(policy,{healthy:240000,retry:60000,invalid:60000,source:60000,online:60000,resume:60000,tail:60000});
    const urgent=await page.evaluate(async()=>{headFrequencyProbe.resetFreshness();__resumeHarness.advanceClock(60010);const before=__resumeHarness.state().restCalls.filter(x=>(x.method==='im.recent.list'||x.method==='im.recent.get')).length;await headFrequencyProbe.run('online-freshness');return __resumeHarness.state().restCalls.filter(x=>(x.method==='im.recent.list'||x.method==='im.recent.get')).length-before;});
    assert.equal(urgent,1,'online recovery must retain the original one-minute freshness contract');result.policyCases=policy;result.onlineRequests=urgent;
    const dirty=await page.evaluate(async()=>{headFrequencyProbe.resetFreshness();const mark=__resumeHarness.mark('chats');await headFrequencyProbe.retry();const delta=__resumeHarness.delta('chats',mark),calls=__resumeHarness.state().restCalls.slice(mark.restCalls);return{recentReads:calls.filter(x=>x.method==='im.recent.list'||x.method==='im.recent.get').length,taskReads:calls.filter(x=>x.method==='tasks.task.list').length,walks:delta.materialization.fullWalks,guards:delta.guardActivationTotal};});
    assert.ok(dirty.recentReads>0,'dirty metadata retry must read immediately inside the healthy TTL');assert.equal(dirty.walks,0);assert.equal(dirty.guards,0);result.dirtyRetry=dirty;
   }
   assert.deepEqual(errors,[]);report.runs.push({label,...result});
  }finally{await page.close();}
 }
 assert.equal(report.runs[0].headRequests/report.runs[1].headRequests,4);
 console.log('PASS healthy metadata frequency: 12 → 3 head requests, no physical walks; recovery policy unchanged');
}finally{mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/native-healthy-metadata-frequency-regression.json',JSON.stringify(report,null,2)+'\n');await browser.close();await server.close();}

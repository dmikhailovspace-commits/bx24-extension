import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const sourceRoot=process.env.PENA_EXTENSION_DIR||resolve('extension');
const source=readFileSync(resolve(sourceRoot,'injected.js'),'utf8');
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
assert.equal(source.split(anchor).length,2);
const instrumented=source.replace(anchor,anchor+`
 window.retryActionProbe={install:()=>{
  window.retryActionCalls=[];
  _scheduleDialogRecentMandatoryDetails=(ids,options)=>{retryActionCalls.push({kind:'details',options});};
  _refreshDialogRecentCatalog=options=>{retryActionCalls.push({kind:'catalog',options});return Promise.resolve({});};
  _beginDialogRecentInteractionGate=reason=>{retryActionCalls.push({kind:'gate',reason});};
 },canBypass:reason=>_canBypassDialogNativeRecoveryDelay(reason)};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=collectPageErrors(page);
const report={phases:[],pageErrors:errors,scope:'Actual toolbar click handlers with isolated downstream dispatch; native completion has separate browser coverage.'};
try{
 await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:instrumented}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=chats&passThrough=1');
 await page.locator('.pena-native-sync-chip').waitFor({state:'attached'});
 await page.evaluate(()=>retryActionProbe.install());
 for(const scenario of [
  {name:'native recovery takes priority over unresolved saved details',state:{recoveryActionRequired:true,controlledPendingCount:2},expected:'catalog'},
  {name:'legacy recovery flag also selects physical recovery',state:{recoveryPending:true,controlledPendingCount:2},expected:'catalog'},
  {name:'hard catalog failure takes priority over unresolved saved details',state:{error:'native failure',controlledPendingCount:2},expected:'catalog'},
  {name:'gate error selects catalog recovery',state:{gateError:'incomplete',controlledPendingCount:2},expected:'catalog'},
  {name:'details alone never trigger a full native pass',state:{controlledPendingCount:2},expected:'details'},
  {name:'healthy status does not initiate work',state:{},expected:null},
  {name:'an active load is not duplicated',state:{inFlight:true,recoveryActionRequired:true},expected:null},
  {name:'active detail dispatch is not duplicated',state:{detailsInFlight:true,recoveryActionRequired:true},expected:null}
 ]){
  const calls=await page.evaluate(state=>{
   window.retryActionCalls.length=0;
   window.__PENA_RECENT_SYNC__=Object.freeze({...state});
   document.querySelector('.pena-native-sync-chip').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
   return window.retryActionCalls;
  },scenario.state);
  const actions=calls.filter(call=>call.kind!=='gate');
  assert.equal(actions.length,scenario.expected?1:0,scenario.name);
  if(scenario.expected){assert.equal(actions[0].kind,scenario.expected,scenario.name);if(scenario.expected==='catalog')assert.deepEqual(actions[0].options,{force:true,full:true,reason:'gate-retry'});}
  report.phases.push({name:scenario.name,status:'PASS',calls});
 }
 const bypass=await page.evaluate(()=>({manual:retryActionProbe.canBypass('gate-retry'),routine:retryActionProbe.canBypass('periodic-freshness')}));
 assert.equal(bypass.manual,true);assert.equal(bypass.routine,false);
 report.phases.push({name:'manual retry bypasses a dormant automatic delay while routine polling does not',status:'PASS'});
 assert.deepEqual(errors,[]);console.log(`PASS retry action: ${report.phases.length} phases`);
}catch(error){report.error=error.stack;throw error;}
finally{mkdirSync('tests/artifacts',{recursive:true});writeFileSync(process.env.PENA_RETRY_REPORT||'tests/artifacts/native-retry-action-regression.json',JSON.stringify(report,null,2));await browser.close();await server.close();}

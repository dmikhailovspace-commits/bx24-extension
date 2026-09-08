import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const source=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
const anchor='async function _runDialogNativeExpectedCatalogAudit(mode, sourceGeneration, options = {}) {';
assert.ok(source.includes(anchor));
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const report={scope:'Existing task owner can enrich native physical proof without launching another task catalog',phases:[]};
try{
 for(const scenario of ['full','head','none']){
  const page=await browser.newPage({viewport:{width:430,height:780}}),errors=collectPageErrors(page);
  // Identical native list and API IDs. Type metadata is missing, as on older SDKs.
  await page.route('**/tests/native-resume-recovery-harness.html?*',async route=>{const response=await route.fetch();const body=(await response.text()).replace("type: 'chat',","type: '',");await route.fulfill({response,body});});
  const setup=scenario==='none'?'':`if(!window.__sharedAuditFixtureStarted){window.__sharedAuditFixtureStarted=true;_syncDialogTaskCatalog({forceNetwork:true,deferMerge:true,headOnly:${scenario==='head'},maxPages:1}).catch(()=>{});}`;
  // Controlled precondition, not implementation logic: a separate consumer has
  // already started its full/head request before the native audit inspects it.
  await page.route('**/extension/injected.js',r=>r.fulfill({status:200,contentType:'text/javascript',body:source.replace(anchor,anchor+'\n'+setup+'\n')}));
  const at=Date.now();await page.goto(server.baseUrl+'/tests/native-resume-recovery-harness.html?autoBootstrap=1&timeProjects=unconfigured');
  await page.waitForFunction(()=>{const s=window.__PENA_NATIVE_PREFETCH__?.status?.();return window.__resumeHarness?.ready('chats')&&!s.originalActive&&!s.modeLoadPending;},null,{timeout:25000});
  const state=await page.evaluate(()=>window.__resumeHarness.state()),view=state.modes.chats,proof=state.status.modeStates.chats.materialization;
  assert.deepEqual(view.catalogIds.slice().sort(),view.expectedIds.slice().sort(),scenario+' must preserve every physical ID');
  assert.deepEqual(proof.tailIds.slice().sort(),view.expectedIds.slice(-5).sort());
  assert.equal(view.scrollTop,3377);assert.equal(view.connectedPool,24);assert.equal(state.guardVisible,false);assert.deepEqual(errors,[]);
  const taskCalls=state.restCalls.filter(x=>x.method==='tasks.task.list').length;
  assert.equal(taskCalls,scenario==='full'?2:scenario==='head'?1:0,scenario+' must not start another global crawl');
  assert.equal(proof.confirmationKind,scenario==='full'?'api-exact-head-fenced':'native-second-pass',scenario+' completeness proof');
  const bottom=await page.evaluate(()=>window.__PENA_NATIVE_BOTTOM_DEBUG__);
  if(scenario==='full'){assert.equal(bottom.exactPhysicalCatalogProof,true);assert.equal(bottom.headFenceChecked,true);assert.equal(bottom.samples,6);}
  report.phases.push({scenario,status:'PASS',ms:Date.now()-at,dialogs:view.catalogIds.length,taskCalls,proof:proof.confirmationKind});
  await page.close();
 }
 console.log('PASS native shared task audit:',JSON.stringify(report.phases));
}finally{mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});writeFileSync(new URL('./artifacts/native-shared-task-startup-regression.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();await server.close();}

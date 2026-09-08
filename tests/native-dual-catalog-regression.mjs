import assert from 'node:assert/strict';
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((request, response) => {
	const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
	const path = normalize(join(root, pathname));
	if (!path.startsWith(root)) return response.writeHead(403).end();
	const stream = createReadStream(path);
	stream.on('error', () => response.writeHead(404).end());
	response.writeHead(200, { 'content-type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8` });
	stream.pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 760 } });

await page.addInitScript(() => {
	window.__PENA_TEST_EAGER_MATERIALIZATION__ = true;
	window.__PENA_TEST_NATIVE_EXPECTED_AUDIT__ = true;
	window.__PENA_TEST_NATIVE_TASK_AUDIT__ = true;
});

const snapshot = () => page.evaluate(() => ({
	status: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
	sync: window.__PENA_RECENT_SYNC__ || null,
	recentCalls: (window.nativeRestCalls || []).filter(call => call.method === 'im.recent.list').length,
	taskCalls: (window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length,
	restCalls: window.nativeRestCalls || [],
	batches: window.nativeBatchSizes || [],
	projectStarts:window.dualProjectStarts || [],
	startup:window.dualStartupState?.() || null
}));

try {
	const startSource = readFileSync(join(root,'extension/injected.js'),'utf8');
	const projectStart = '\tasync function _ensureDialogTimeProjectCatalog({ force = false, delta = false } = {}) {';
	assert.equal(startSource.split(projectStart).length-1,1);
	const startupAnchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
	const startupSource=startSource.replace(projectStart, projectStart+`\n (window.dualProjectStarts ||= []).push({at:Date.now(),force,delta,cursor:_dialogTimeCatalogCursor,scope:_dialogTimeCatalogScope,requestedScope:_getDialogTimeProjectScopeKey(),preference:_readDialogTimeProjectPreference(),reusableRows:_getDialogTimeReusableNativeCatalog()?.length ?? null});`).replace(startupAnchor,startupAnchor+`\n window.dualStartupState=()=>({cycle:_dialogTimeBootstrapSequence,active:!!_dialogTimeBootstrapPromise,phase:_dialogTimeBootstrapToken?.phase,projectActive:!!_dialogTimeProjectCatalogOwner,cursor:_dialogTimeCatalogCursor});`);
	await page.route('**/extension/injected.js*', route => route.fulfill({contentType:'application/javascript',body:startupSource}));
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=80&lazyChunk=12&lazyDelay=20&initialTop=24&startupBudget=10000`);
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.loadedModes?.includes('chats') && status?.sharedCatalog?.auditedAt > 0 &&
				status.originalActive === false && !status.apiActive;
		}, null, { timeout: 25000 });
	} catch (error) {
		throw new Error(`Shared cold catalog did not settle: ${JSON.stringify(await snapshot())}; ${error.message}`);
	}
	// Include the automatic time bootstrap in startup, before measuring the
	// source switch. All-projects time must reuse the complete native catalog.
	await page.waitForFunction(()=>{
		const state=window.dualStartupState?.();
		return state?.cycle>0 && !state.active && !state.projectActive && state.cursor>0;
	},null,{timeout:25000});
	const beforeSwitch = await snapshot();
	mkdirSync(join(root,'tests/artifacts'),{recursive:true});
	writeFileSync(join(root,'tests/artifacts/native-dual-catalog-startup.json'),JSON.stringify(beforeSwitch,null,2));
	assert.equal(beforeSwitch.taskCalls,1,'All-projects startup duplicated the complete native task catalog: '+JSON.stringify(beforeSwitch));
	await page.locator('#switch-mode').evaluate(button => button.click());
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.loadedModes?.includes('tasks') && status.originalActive === false;
		}, null, { timeout: 25000 });
	} catch (error) {
		throw new Error(`Task source did not settle from the shared catalog: ${JSON.stringify(await snapshot())}; ${error.message}`);
	}
	const afterSwitch = await snapshot();
	assert.equal(afterSwitch.recentCalls, beforeSwitch.recentCalls,
		`Task Chats downloaded the shared recent catalog again: ${JSON.stringify({ beforeSwitch, afterSwitch })}`);
	assert.equal(afterSwitch.taskCalls, beforeSwitch.taskCalls,
		`Task Chats downloaded the fresh task index again: ${JSON.stringify({ beforeSwitch, afterSwitch })}`);
	assert.equal(afterSwitch.status?.expectedCatalogs?.tasks?.complete, true,
		`Task Chats did not bind the shared catalog: ${JSON.stringify(afterSwitch)}`);

 const raw = readFileSync(join(root,'extension/injected.js'),'utf8');
 const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
 const instrumented=raw.replace(anchor,anchor+`\n window.catalogConcurrencyProbe={
  sync:options=>_syncDialogTaskCatalog(options),
  reset:()=>{_dialogTaskCatalogFetchedAt=0;_dialogTaskCatalogComplete=false;_dialogTaskCatalogLastResult=null;_dialogTimeCatalogCursor=0;},
  snapshot:()=>({nativeActive:!!_dialogTaskCatalogSyncPromise,timeActive:!!_dialogTimeCatalogPromise||!!_dialogTimeProjectCatalogOwner,projectActive:!!_dialogTimeProjectCatalogOwner,flights:_dialogTaskCatalogSyncFlights.size,cursor:_dialogTimeCatalogCursor,nativeRows:_dialogTaskCatalogLastResult?.rows?.length||0})
 };`);
 const concurrency=[];
 for(const scenario of ['full-head-full','time-first-native-full']){
  const probe=await browser.newPage({viewport:{width:900,height:800}});
  try{
   await probe.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:instrumented}));
   await probe.goto(base+'/tests/native-consistency-harness.html?mode=chats&taskCatalogRows=124');
   await probe.locator('.pena-native-time-button').waitFor();
   await probe.waitForFunction(()=>!catalogConcurrencyProbe.snapshot().nativeActive&&!catalogConcurrencyProbe.snapshot().timeActive);
   await probe.evaluate(()=>{
    catalogConcurrencyProbe.reset();window.catalogHolds=[];window.catalogDispatches=[];window.catalogRequests=[];window.catalogHoldEnabled=true;
    const original=BX.rest.callMethod;
    BX.rest.callMethod=function(method,params,callback){
     if(method==='tasks.task.list'){catalogDispatches.push({at:performance.now(),order:params.order,filter:params.filter});if(catalogHoldEnabled){catalogHolds.push(()=>original.call(this,method,params,callback));return;}}
     return original.call(this,method,params,callback);
    };
   });
   if(scenario==='full-head-full'){
    await probe.evaluate(()=>{catalogRequests.push(catalogConcurrencyProbe.sync({forceNetwork:true,deferMerge:true}));});
    await probe.waitForFunction(()=>catalogHolds.length===1);
    await probe.evaluate(()=>{catalogRequests.push(catalogConcurrencyProbe.sync({forceNetwork:true,deferMerge:true,headOnly:true}));catalogRequests.push(catalogConcurrencyProbe.sync({forceNetwork:true,deferMerge:true}));});
   }else{
    await probe.locator('.pena-native-time-button').click();await probe.waitForFunction(()=>catalogHolds.length===1);
    await probe.evaluate(()=>{catalogRequests.push(catalogConcurrencyProbe.sync({forceNetwork:true,deferMerge:true}));});
   }
   await probe.waitForTimeout(700);
   const during=await probe.evaluate(()=>({dispatches:catalogDispatches.slice(),state:catalogConcurrencyProbe.snapshot()}));
   assert.equal(during.dispatches.length,1,scenario+' duplicated a real SDK catalog request: '+JSON.stringify(during));
   assert.equal(during.state.flights,1);
   if(scenario==='time-first-native-full')assert.equal(during.state.projectActive,true,'Time-first catalog did not retain its selected-project owner while SDK response was held');
   await probe.evaluate(()=>{catalogHoldEnabled=false;for(const release of catalogHolds.splice(0))release();});
   await probe.evaluate(()=>Promise.all(catalogRequests));
   await probe.waitForFunction(()=>!catalogConcurrencyProbe.snapshot().nativeActive&&!catalogConcurrencyProbe.snapshot().timeActive);
   const complete=await probe.evaluate(()=>({dispatches:catalogDispatches.slice(),state:catalogConcurrencyProbe.snapshot()}));
   assert.equal(complete.dispatches.length,3,scenario+' must fetch exactly three pages for 130 tasks, with no repeated scan');
   const cursors=complete.dispatches.map(call=>Number(call.filter['>ID']));
   assert.deepEqual(cursors,[0,50043,50093],scenario+' duplicated or skipped a keyset page');
   assert.equal(complete.state.nativeRows,130,scenario+' lost tasks after the shared first page');
   concurrency.push({scenario,actualSdkRequests:3,cursors,tasks:130,nativeFlights:during.state.flights,projectOwnerActive:during.state.projectActive});
  }finally{await probe.close();}
 }
 mkdirSync(join(root,'tests/artifacts'),{recursive:true});writeFileSync(join(root,'tests/artifacts/native-dual-catalog-concurrency.json'),JSON.stringify(concurrency,null,2));
	console.log('native dual catalog regression: all checks passed',JSON.stringify(concurrency));

} finally {
	await browser.close();
	await new Promise(resolve => server.close(resolve));
}

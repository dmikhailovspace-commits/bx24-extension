import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';

// Controlled A/B acceptance, not a simulation of Bitrix server internals.
// Native actions use actual HTTP, sharing four fixed-cost server lanes with
// extension SDK reads. Both arms receive exactly the same unrelated DOM load.
const root = resolve(import.meta.dirname, '..');
const extension = resolve(process.env.PENA_EXTENSION_DIR || resolve(root, 'extension'));
const label = process.env.PENA_CONTENTION_LABEL || 'current';
const baselineOnly = process.env.PENA_CONTENTION_REPORT_ONLY === '1';
const samplesPerPhase = 24;
const phaseTimeoutMs = 60000;
const domCount = Number(process.env.PENA_CONTENTION_DOM_COUNT) || 4000;
const output = resolve(root, `tests/artifacts/acceptance-audit-${label}.json`);
const percentile = (xs, q) => xs.length ? xs.slice().sort((a,b)=>a-b)[Math.ceil(xs.length*q)-1] : 0;
const summary = xs => ({ count:xs.length, median:percentile(xs,.5), p95:percentile(xs,.95), max:Math.max(0,...xs), total:xs.reduce((a,b)=>a+b,0) });
let active = 0, queued = [], serverSamples = [];
function pump() {
  while (active < 4 && queued.length) {
    const job = queued.shift(); active++;
    const start = performance.now();
    setTimeout(() => {
      const sample = { kind:job.kind, queuedMs:start-job.at, serviceMs:performance.now()-start };
      serverSamples.push(sample); job.response.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify(sample));
      active--; pump();
    }, 80);
  }
}
const boot = `(${function() {
  const m = window.__contention = { samples:[], errors:[], frames:[], longtasks:[], observers:[], rest:[], phase:'startup', startedAt:performance.now(), measuring:true };
  let last=performance.now();
  function frame(now) { if(m.measuring) m.frames.push(now-last); last=now; requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  new PerformanceObserver(list => { if(m.measuring) m.longtasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))); }).observe({entryTypes:['longtask']});
  const MO=window.MutationObserver;
  window.MutationObserver=class extends MO {
    constructor(callback) {
      const data={targets:[],calls:0,records:0,ms:0,max:0}; m.observers.push(data);
      super((records, observer)=> { const start=performance.now(); try { callback(records,observer); } finally { if(m.measuring) { const ms=performance.now()-start; data.calls++;data.records+=records.length;data.ms+=ms;data.max=Math.max(data.max,ms); } } }); this.data=data;
    }
    observe(node,options) { this.data.targets.push(node.id || node.className || node.nodeName); return super.observe(node,options); }
  };
  const rest=BX.rest.callMethod;
  BX.rest.callMethod=function(method,params,callback) {
    const at=performance.now(); m.rest.push({method,at});
    fetch('/__latency?kind=extension').then(()=>rest.call(this,method,params,callback)).catch(e=>m.errors.push(String(e)));
  };
  const batch=BX24.callBatch;
  BX24.callBatch=function(calls,callback) {
    const at=performance.now(); m.rest.push({method:'batch',count:Object.keys(calls).length,at});
    fetch('/__latency?kind=extension-batch').then(()=>batch.call(this,calls,callback)).catch(e=>m.errors.push(String(e)));
  };
  const handlers=new Map();
  BX.addCustomEvent=(name,handler)=>{ if(!handlers.has(name)) handlers.set(name,[]);handlers.get(name).push(handler); };
  const area=document.createElement('section');area.id='native-workspace';area.style.cssText='position:fixed;left:450px;top:10px;width:480px;height:700px;overflow:auto';
  area.innerHTML='<button id="native-send">Send message</button><button id="native-task">Open task</button><div id="native-history"></div>';
  document.body.append(area);
  for(const [id,kind] of [['native-send','message'],['native-task','task-open']]) {
    document.getElementById(id).addEventListener('click',async event=>{
      const requestedAt=performance.now();const phase=m.phase;
      const inputAt=Number.isFinite(event.timeStamp)&&event.timeStamp<=requestedAt ? event.timeStamp : requestedAt;
      try {
        const response=await fetch('/__latency?kind=native-'+kind); const server=await response.json();
        const completion=performance.now();
        if(kind==='message') for(const handler of handlers.get('onPullEvent-im')||[]) handler({command:'message',params:{dialogId:'chat5000',message:{senderId:7,id:Math.floor(completion)}}});
        const row=document.createElement('div');row.className='native-action-result';row.textContent=kind+' complete';area.querySelector('#native-history').append(row);
        await new Promise(requestAnimationFrame);
        const paintedAt=performance.now();
        m.samples.push({kind,phase,trusted:event.isTrusted,requestedAt,inputAt,inputToHandlerMs:requestedAt-inputAt,inputToPaintMs:paintedAt-inputAt,completionMs:completion-requestedAt,paintMs:paintedAt-requestedAt,server});
      } catch(e) { m.errors.push(String(e)); }
    });
  }
  window.__startNoise=count=> {
    const host=document.createElement('div');host.id='native-unrelated-dom';host.style.cssText='position:absolute;left:460px;top:110px;width:440px;height:580px;overflow:auto';
    const fragment=document.createDocumentFragment();
    for(let i=0;i<count;i++) { const row=document.createElement('div'); row.className='native-discussion-message'; row.innerHTML='<span class="native-message-body">Message '+i+'</span><i class="native-status"></i>';fragment.append(row); }
    host.append(fragment);document.body.append(host);
    let tick=0;
    m.noiseTimer=setInterval(()=>{
      for(let i=0;i<120;i++) { const row=host.children[(tick*120+i)%count];row.classList.toggle('native-updated'); const text=document.createElement('span');text.className='native-message-body';text.textContent='Updated '+tick+':'+i;row.replaceChild(text,row.firstChild); }
      // Native app shells also toggle style/class during task navigation.
      // Keep these real host attributes in scope, not only leaf text changes.
      host.classList.toggle('native-panel-updating');
      area.classList.toggle('native-composer-active');
      tick++;
    },100);
  };
}.toString()})();`;
const fixtureSource=readFileSync(resolve(root,'tests/native-resume-recovery-harness.html'),'utf8');
const inheritedGuardSampler='setInterval(sampleGuard, 16);';
assert.equal(fixtureSource.split(inheritedGuardSampler).length-1,1,'Inherited recovery sampler anchor changed; review fixture CPU overhead');
let html=fixtureSource
  // This is instrumentation for recovery tests, not Bitrix runtime. At 60 Hz
  // it searches the whole document and reads scrollHeight, forcing layout on
  // the mutation load being measured here. Our RAF sampler performs no DOM reads.
  .replace(inheritedGuardSampler,'')
  .replace(/^.*window\.__PENA_(?:TEST_|FORCE_REST_CATALOG).*$/gm,'')
  .replace('const controlled = Number(delay) === 60 * 1000;','const controlled = false;')
  .replace('#anit-filters, #anit-dialog-control-dock { display: none !important; }','')
  .replace('<script src="../extension/native-catalog.js">',`<script>${boot}</script><script src="../extension/native-catalog.js">`);
assert(!html.includes(inheritedGuardSampler),'Contention fixture must not run the inherited layout-reading guard sampler');
const server=createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/__latency') { queued.push({response,kind:url.searchParams.get('kind'),at:performance.now()});pump();return; }
  if(url.pathname.endsWith('interaction.html')) {
    const body=url.searchParams.get('enabled')==='0' ? html.replace(/<script src="\.\.\/extension\/[^\"]+"><\/script>/g,'').replace(/<link rel="stylesheet" href="\.\.\/extension\/injected.css">/,'') : html;
    response.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end(body); return;
  }
  const path=url.pathname.startsWith('/extension/') ? resolve(extension,url.pathname.slice(11)) : resolve(root,url.pathname.slice(1));
  const stream=createReadStream(path);stream.on('error',()=>response.writeHead(404).end());response.setHeader('content-type',extname(path)==='.css'?'text/css':extname(path)==='.js'?'application/javascript':'application/octet-stream');stream.pipe(response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const report={label,at:new Date().toISOString(),source:{extension,sha256:createHash('sha256').update(readFileSync(resolve(extension,'injected.js'))).digest('hex')},configuration:{protocol:2,samplesPerPhase,phaseTimeoutMs,inheritedGuardSampler:false,domCount,cpuSlowdown:4,httpSlots:4,httpServiceMs:80,productionFlags:true},limitations:['Synthetic Bitrix SDK responses; controlled actual HTTP transport, not real Bitrix authentication/backend.','No full desktop-client installation or real portal measurement.','Native synthetic action handlers complete actual HTTP requests; trusted browser clicks are used.'],arms:[]};
try {
  for(const enabled of [false,true]) {
    const page=await browser.newPage({viewport:{width:1100,height:800}}); const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:4});
    const serverStart=serverSamples.length;
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/interaction.html?autoBootstrap=1&chatCount=300&taskCount=1000&enabled=${Number(enabled)}`);
    assert.deepEqual(await page.evaluate(()=>Object.keys(window).filter(k=>k.startsWith('__PENA_TEST_'))),[],'No production test flags may be active');
    await page.evaluate(count=>window.__startNoise(count),domCount);
    for(const phase of ['startup','settled']) {
      if(phase==='settled') {
        if(enabled) await page.waitForFunction(()=>{
          const s=window.__PENA_NATIVE_PREFETCH__?.status?.();
          return s && !s.originalActive && !s.apiActive && !s.modeLoadPending && !s.reconcile?.active;
        },undefined,{timeout:45000});
        await page.waitForTimeout(3000);
      }
      await page.evaluate(phase=>{
        window.__contention.phase=phase;
        if(phase==='settled') window.__contention.warmStartStatus=window.__PENA_NATIVE_PREFETCH__?.status?.();
      },phase);
      const deadline=Date.now()+phaseTimeoutMs;
      for(let i=0;i<samplesPerPhase;i++) {
        assert(Date.now()<deadline,`${phase} did not complete its fixed sample count within ${phaseTimeoutMs} ms`);
        await page.locator(i%2 ? '#native-task':'#native-send').click({timeout:10000});
        // Same number of completed actions in both arms. A fixed 5-second
        // sampling window made p95 equal to the single worst action when a
        // slower runner completed <20 samples, but excluded it in the other arm.
        await page.waitForFunction(({phase,count})=>window.__contention.samples.filter(sample=>sample.phase===phase).length>=count,{phase,count:i+1},{timeout:10000});
        await page.waitForTimeout(140);
      }
    }
    await page.waitForTimeout(1000);
    const data=await page.evaluate(()=>{clearInterval(__contention.noiseTimer);__contention.measuring=false;return {...__contention,noiseTimer:undefined,status:window.__PENA_NATIVE_PREFETCH__?.status?.(),restDiagnostic:window.__PENA_REST_DIAGNOSTICS__?.snapshot?.()};});
    const arm={enabled,errors,...data,server:serverSamples.slice(serverStart),statistics:{inputToHandler:summary(data.samples.map(s=>s.inputToHandlerMs)),inputToPaint:summary(data.samples.map(s=>s.inputToPaintMs)),completion:summary(data.samples.map(s=>s.completionMs)),paint:summary(data.samples.map(s=>s.paintMs)),frames:summary(data.frames),longtasks:summary(data.longtasks.map(s=>s.duration)),phases:Object.fromEntries(['startup','settled'].map(phase=>[phase,{inputToHandler:summary(data.samples.filter(s=>s.phase===phase).map(s=>s.inputToHandlerMs)),inputToPaint:summary(data.samples.filter(s=>s.phase===phase).map(s=>s.inputToPaintMs)),completion:summary(data.samples.filter(s=>s.phase===phase).map(s=>s.completionMs)),paint:summary(data.samples.filter(s=>s.phase===phase).map(s=>s.paintMs))}]))}};
    report.arms.push(arm);console.log(JSON.stringify({enabled,...arm.statistics,observers:arm.observers.map(o=>({targets:o.targets,calls:o.calls,ms:o.ms,max:o.max})),rest:data.rest.length}));
    assert.equal(data.samples.length,samplesPerPhase*2,'Both arms must finish the same number of native samples');
    for(const phase of ['startup','settled']) assert.equal(data.samples.filter(sample=>sample.phase===phase).length,samplesPerPhase,`Completed sample count differs in ${phase}`);
    assert(data.samples.every(s=>s.trusted),'Use trusted native input');assert.deepEqual(errors.concat(data.errors),[]);
    await page.close();
  }
  const [off,on]=report.arms;
  assert.equal(off.samples.length,on.samples.length,'A/B completed sample counts must match');
  report.ratios={inputToPaintP95:on.statistics.inputToPaint.p95/off.statistics.inputToPaint.p95,nativeCompletionP95:on.statistics.completion.p95/off.statistics.completion.p95,nativePaintP95:on.statistics.paint.p95/off.statistics.paint.p95,frameP95:on.statistics.frames.p95/off.statistics.frames.p95};
  const budget=(offStats,onStats)=>({
    nativeCompletion:{actualP95:onStats.completion.p95,limitP95:Math.max(300,offStats.completion.p95*2)},
    inputToPaint:{actualP95:onStats.inputToPaint.p95,limitP95:Math.max(350,offStats.inputToPaint.p95*2)}
  });
  report.budgets={combined:budget(off.statistics,on.statistics),...Object.fromEntries(['startup','settled'].map(phase=>[phase,budget(off.statistics.phases[phase],on.statistics.phases[phase])]))};
  if(!baselineOnly) {
    for(const [phase,checks] of Object.entries(report.budgets)) for(const [metric,check] of Object.entries(checks)) {
      assert(check.actualP95<=check.limitP95,`${phase} ${metric} p95 ${check.actualP95.toFixed(1)} ms exceeded A/B budget ${check.limitP95.toFixed(1)} ms`);
    }
  }
} finally {
  mkdirSync(resolve(root,'tests/artifacts'),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));await browser.close();await new Promise(resolve=>server.close(resolve));
}

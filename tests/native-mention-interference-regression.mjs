import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';

// Public native HTTP and popup-render acceptance. The SDK dataset and native
// selector implementation are controlled fixtures, not a captured live portal.
const root = resolve(import.meta.dirname, '..');
const extension = resolve(process.env.PENA_EXTENSION_DIR || resolve(root, 'extension'));
const label = process.env.PENA_MENTION_LABEL || 'current';
const reportOnly = process.env.PENA_MENTION_REPORT_ONLY === '1';
const ownershipOnly = process.env.PENA_MENTION_OWNERSHIP_ONLY === '1';
const samples = Number(process.env.PENA_MENTION_SAMPLES || 20);
const cpuRate = Number(process.env.PENA_MENTION_CPU || 4);
assert(Number.isInteger(samples)&&samples>=20&&samples<=60,'Foreground acceptance requires 20–60 completed samples per action');
assert(Number.isFinite(cpuRate)&&cpuRate>=1&&cpuRate<=8,'CPU slowdown must be between 1 and 8');
const stat = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { count: sorted.length, median: sorted[Math.ceil(sorted.length / 2) - 1] || 0,
    p95: sorted[Math.ceil(sorted.length * .95) - 1] || 0, max: Math.max(0, ...values), total: values.reduce((a,b) => a+b,0) };
};
let active = 0;
const pending = [], httpSamples = [];
function pump() {
  while (active < 4 && pending.length) {
    const job = pending.shift(); active++;
    const began = performance.now();
    setTimeout(() => {
      const sample = { kind: job.kind, queuedMs: began-job.at, serviceMs: performance.now()-began };
      httpSamples.push(sample);
      job.response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify(sample));
      active--; pump();
    }, 80);
  }
}
const transport = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if(url.pathname!=='/') {
    const upstream=await fetch(server.baseUrl+request.url);
    response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/octet-stream'}).end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }
  pending.push({ response, kind: url.searchParams.get('kind'), at: performance.now() }); pump();
});
await new Promise(resolve => transport.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${transport.address().port}/`;
const server = await startHarnessServer();

function installProbe(endpoint) {
  const m = window.__mentionProbe = { samples: [], rest: [], frames: [], longtasks: [], observers: [], errors: [],
    work: {}, measuring: false, negative: false, popupChanges: 0, inputEvents: 0, ready: false };
  const nativeMO = MutationObserver;
  let observerScope = null;
  window.MutationObserver = class extends nativeMO {
    constructor(callback) {
      const record = { targets: [], calls: 0, records: 0, ms: 0, max: 0, queries: 0 };
      m.observers.push(record);
      super((records, observer) => {
        const before = performance.now(), previous = observerScope; observerScope = record;
        try { return callback(records, observer); }
        finally {
          observerScope = previous;
          if (m.measuring) { const ms = performance.now()-before; record.calls++; record.records += records.length; record.ms += ms; record.max = Math.max(record.max, ms); }
        }
      }); this.record = record;
    }
    observe(node, options) { this.record.targets.push(node.id || node.className || node.nodeName); return super.observe(node, options); }
  };
  for (const prototype of [Document.prototype, Element.prototype]) {
    for (const method of ['querySelector', 'querySelectorAll']) {
      const original = prototype[method];
      prototype[method] = function(...args) {
        if (m.measuring && observerScope) observerScope.queries++;
        return original.apply(this, args);
      };
    }
  }
  m.hit = name => { if (m.measuring) m.work[name] = (m.work[name] || 0)+1; };
  let frameHandle = 0, lastFrame = 0;
  function frame(now) { if (m.measuring && lastFrame) m.frames.push(now-lastFrame); lastFrame=now; frameHandle=requestAnimationFrame(frame); }
  frameHandle=requestAnimationFrame(frame);
  const longtaskObserver = new PerformanceObserver(list => {
    if(m.measuring) m.longtasks.push(...list.getEntries().filter(e=>e.startTime>=m.startedAt).map(e=>({at:e.startTime,duration:e.duration})));
  }); longtaskObserver.observe({entryTypes:['longtask']});
  const rest = BX.rest.callMethod;
  BX.rest.callMethod = function(method, params, callback) {
    if(m.measuring) m.rest.push({method,at:performance.now()});
    fetch(endpoint+'?kind=extension').then(()=>rest.call(this,method,params,callback)).catch(e=>m.errors.push(String(e)));
  };
  const batch = BX24.callBatch;
  BX24.callBatch = function(calls, callback) {
    if(m.measuring) m.rest.push({method:'batch',count:Object.keys(calls).length,at:performance.now()});
    fetch(endpoint+'?kind=extension-batch').then(()=>batch.call(this,calls,callback)).catch(e=>m.errors.push(String(e)));
  };
  const handlers = new Map();
  BX.addCustomEvent = (name, callback) => { if(!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(callback); };
  const workspace = document.createElement('section'); workspace.id='mention-native-workspace';
  workspace.style.cssText='position:fixed;left:450px;top:10px;width:550px;height:700px;z-index:1000;background:white';
  workspace.innerHTML='<label>Message <input id="mention-input" class="bx-im-textarea__content" placeholder="Введите сообщение"></label><label>Task participants <input id="entity-input" class="ui-selector-search-input" placeholder="Поиск сотрудников"></label><button id="mention-send">Send</button><button id="mention-task">Open task</button><div id="mention-history" style="height:200px;overflow:auto"></div>';
  const history = workspace.querySelector('#mention-history');
  const fragment = document.createDocumentFragment();
  for(let i=0;i<4000;i++) {
    const row=document.createElement('div');row.className='bx-im-message-base';row.innerHTML='<span class="bx-im-message-default-content">Native history '+i+'</span><span class="native-status">Read</span>';fragment.append(row);
  }
  history.append(fragment);document.body.append(workspace);
  const popup = document.createElement('div');popup.id='mention-popup';popup.className='popup-window ui-selector-popup';
  popup.style.cssText='position:fixed;left:450px;top:300px;width:500px;height:360px;overflow:auto;z-index:1001;background:#eee';
  popup.innerHTML='<div class="ui-selector-dialog"><div class="ui-selector-items"></div></div>';document.body.append(popup);
  const items = popup.querySelector('.ui-selector-items');
  function renderPopup(kind, generation) {
    const fragment=document.createDocumentFragment();
    for(let i=0;i<240;i++) {
      const row=document.createElement('div');row.className='ui-selector-item';
      row.innerHTML='<span class="ui-selector-item-avatar"></span><span class="ui-selector-item-title">'+kind+' Person '+i+'</span><span class="ui-selector-item-subtitle">Department</span>';
      fragment.append(row);
    }
    items.replaceChildren(fragment);popup.classList.toggle('popup-window-visible',Boolean(generation%2));
    workspace.classList.toggle('native-selector-updated');m.popupChanges++;
  }
  renderPopup('initial',0);
  const negativeObserver = new nativeMO(() => {
    if(!m.negative || !m.measuring) return;
    const until=performance.now()+420; while(performance.now()<until) { /* Deliberately bad main-thread observer. */ }
  });negativeObserver.observe(items,{childList:true});
  let generation=0;
  async function run(kind,event) {
    const handlerAt=performance.now(), inputAt=Math.min(handlerAt,event.timeStamp), id=++generation;
    if(kind==='mention'||kind==='entity') { m.inputEvents++;renderPopup('loading',id); }
    const requestAt=performance.now();
    try {
      const response=await fetch(endpoint+'?kind=native-'+kind);const service=await response.json();const completionAt=performance.now();
      if(kind==='mention'||kind==='entity') renderPopup(kind,id);
      else {
        const result=document.createElement('div');result.textContent=kind+' ready';history.prepend(result);
        if(kind==='send') for(const callback of handlers.get('onPullEvent-im')||[]) callback({command:'messageAdd',params:{dialogId:'chat5000',message:{author_id:7,dialog_id:'chat5000',chat_id:5000,is_own:true,id:100000+id}}});
        if(kind==='task') workspace.classList.toggle('side-panel-open');
      }
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      m.samples.push({kind,trusted:event.isTrusted,handlerDelayMs:handlerAt-inputAt,requestDispatchMs:requestAt-inputAt,
        completionMs:completionAt-requestAt,inputToCompletionMs:completionAt-inputAt,inputToPaintMs:performance.now()-inputAt,service});
    } catch(error) { m.errors.push(String(error)); }
  }
  // Each trusted key adds a suffix to an already open mention/participant query.
  document.getElementById('mention-input').value='@Employee';
  document.getElementById('entity-input').value='Employee';
  document.getElementById('mention-input').addEventListener('input',event=>run('mention',event));
  document.getElementById('entity-input').addEventListener('input',event=>run('entity',event));
  document.getElementById('mention-send').addEventListener('click',event=>run('send',event));
  document.getElementById('mention-task').addEventListener('click',event=>run('task',event));
  m.start = negative => {
    m.negative=negative;m.measuring=true;m.startedAt=performance.now();m.samples=[];m.rest=[];m.frames=[];m.longtasks=[];m.work={};m.popupChanges=0;m.inputEvents=0;
    for(const record of m.observers) Object.assign(record,{calls:0,records:0,ms:0,max:0,queries:0});
  };
  m.stop = () => {
    m.measuring=false;cancelAnimationFrame(frameHandle);longtaskObserver.disconnect();negativeObserver.disconnect();
    return {samples:m.samples,rest:m.rest,frames:m.frames,longtasks:m.longtasks,work:m.work,observers:m.observers,errors:m.errors,popupChanges:m.popupChanges,inputEvents:m.inputEvents,
      historyRows:history.children.length,popupRows:items.children.length,status:window.__PENA_NATIVE_PREFETCH__?.status?.(),restDiagnostic:window.__PENA_REST_DIAGNOSTICS__?.snapshot?.()};
  };m.ready=true;
}

let fixture = readFileSync(resolve(root,'tests/native-resume-recovery-harness.html'),'utf8');
assert.equal(fixture.split('setInterval(sampleGuard, 16);').length-1,1);
fixture=fixture.replace('setInterval(sampleGuard, 16);','')
  .replace(/^.*window\.__PENA_(?:TEST_|FORCE_REST_CATALOG).*$/gm,'')
  .replace('const controlled = Number(delay) === 60 * 1000;','const controlled = false;')
  .replace('#anit-filters, #anit-dialog-control-dock { display: none !important; }','')
  .replace('<script src="../extension/native-catalog.js">',`<script>(${installProbe.toString()})(${JSON.stringify(endpoint)});</script><script src="../extension/native-catalog.js">`);
let injected=readFileSync(resolve(extension,'injected.js'),'utf8');
const originalSHA=createHash('sha256').update(injected).digest('hex');
for(const [signature,name] of [
  ['\tfunction findContainer() {','findContainer'],
  ['\tfunction isTasksChatsModeNow() {','isTasksChatsModeNow'],
  ['\tfunction _isDialogTimeFrameActive() {','timeFrameActive'],
  ['\tfunction _getDialogTimeActiveEntry() {','timeActiveEntry'],
  ['\tfunction _getDialogControlNativeEventRow(target) {','nativeEventRow']
]) {
  const count=injected.split(signature).length-1;assert(count<=1,`Ambiguous hook ${name}`);
  if(count) injected=injected.replace(signature,signature+`\nwindow.__mentionProbe?.hit('${name}');`);
}
const report={label,source:{extension,sha256:originalSHA},configuration:{samples,cpuRate,httpLanes:4,httpServiceMs:80,historyRows:4000,popupRows:240,productionFlags:true,guardSampler:false},
  limitations:['Actual local HTTP; mocked Bitrix SDK records and native popup logic.','Warm source, trusted typing/clicks; no real portal authentication, native entity-selector SDK or installed desktop process.','Double RAF records a paint opportunity, not pixel presentation proof.'],arms:[]};
const browser=await chromium.launch({headless:true});
try {
  for(const armName of (ownershipOnly?[]:['off','on','negative-observer'])) {
    const enabled=armName==='on', negative=armName==='negative-observer';
    const page=await browser.newPage({viewport:{width:1100,height:800}});const errors=collectPageErrors(page);
    page.on('requestfailed',request=>errors.push(`Transport ${request.url()} ${request.failure()?.errorText}`));
    await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:cpuRate});
    await page.route('**/tests/native-resume-recovery-harness.html?*',route=>route.fulfill({contentType:'text/html',body:enabled?fixture:fixture.replace(/<script src="\.\.\/extension\/[^\"]+"><\/script>/g,'').replace(/<link rel="stylesheet" href="\.\.\/extension\/injected.css">/,'')}));
    await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:injected}));
    await page.goto(endpoint+'tests/native-resume-recovery-harness.html?autoBootstrap=1&chatCount=300&taskCount=1000');
    await page.waitForFunction(()=>window.__mentionProbe?.ready);
    assert.deepEqual(await page.evaluate(()=>Object.keys(window).filter(k=>k.startsWith('__PENA_TEST_'))),[]);
    if(enabled) await page.waitForFunction(()=>{const s=window.__PENA_NATIVE_PREFETCH__?.status?.();return s&&!s.originalActive&&!s.apiActive&&!s.modeLoadPending&&!s.reconcile?.active;},undefined,{timeout:45000});
    await page.waitForTimeout(1500);
    const serverStart=httpSamples.length;
    await page.evaluate(negative=>window.__mentionProbe.start(negative),negative);
    const count=negative?3:samples;
    for(let i=0;i<count;i++) {
      for(const kind of ['mention','entity','send','task']) {
        const before=await page.evaluate(()=>window.__mentionProbe.samples.length);
        if(kind==='mention'||kind==='entity') await page.locator('#'+kind+'-input').press(String(i%10));
        else await page.locator('#mention-'+kind).click();
        await page.waitForFunction(before=>window.__mentionProbe.samples.length===before+1,before,{timeout:10000}).catch(async error=>{
          const failure=await page.evaluate(()=>({samples:window.__mentionProbe.samples,errors:window.__mentionProbe.errors,inputEvents:window.__mentionProbe.inputEvents,popupChanges:window.__mentionProbe.popupChanges,active:document.activeElement?.id}));
          report.failure={armName,iteration:i,kind,before,...failure,pageErrors:errors,server:httpSamples.slice(serverStart)};
          console.error(JSON.stringify(report.failure));throw error;
        });
      }
    }
    const data=await page.evaluate(()=>window.__mentionProbe.stop());
    const ownership=[];
    if(!negative) {
      await page.evaluate(()=>document.querySelectorAll('.test-header input').forEach(input=>input.remove()));
      for(const placeholder of ['Поиск сотрудников','Поиск задач']) {
        await page.locator('#entity-input').evaluate((input,placeholder)=>input.setAttribute('placeholder',placeholder),placeholder);
        await page.waitForTimeout(300);
        const before=await page.evaluate(()=>window.__mentionProbe.inputEvents);
        await page.locator('#entity-input').press('z');
        await page.waitForTimeout(250);
        ownership.push(await page.evaluate(({before,placeholder})=>({placeholder,delivered:window.__mentionProbe.inputEvents-before,
          owner:document.getElementById('entity-input').getAttribute('data-pena-search-owner'),
          value:document.getElementById('entity-input').value}),{before,placeholder}));
      }
    }
    const statistics=Object.fromEntries(['mention','entity','send','task'].map(kind=>{
      const matches=data.samples.filter(s=>s.kind===kind);
      return [kind,Object.fromEntries(['handlerDelayMs','requestDispatchMs','completionMs','inputToCompletionMs','inputToPaintMs'].map(metric=>[metric,stat(matches.map(s=>s[metric]))]))];
    }));
    report.arms.push({armName,enabled,negative,...data,ownership,errors:[...errors,...data.errors],statistics,
      frameStatistics:stat(data.frames),longtaskStatistics:stat(data.longtasks.map(sample=>sample.duration)),server:httpSamples.slice(serverStart)});
    assert.equal(data.samples.length,count*4);assert(data.samples.every(s=>s.trusted));assert.equal(data.popupRows,240);assert(data.historyRows>=4000);assert.equal(data.popupChanges,count*4);assert.deepEqual(errors.concat(data.errors),[]);
    console.log(JSON.stringify({armName,statistics,ownership,observerMs:data.observers.reduce((n,o)=>n+o.ms,0),observerQueries:data.observers.reduce((n,o)=>n+o.queries,0),work:data.work,rest:data.rest.length,longtasks:stat(data.longtasks.map(e=>e.duration))}));
    await page.close();
  }
  report.coldOwnership=[];
  for(const [enabled,placeholder] of [[false,'Поиск сотрудников'],[true,'Поиск сотрудников'],[true,'Поиск задач']]) {
    const page=await browser.newPage({viewport:{width:1100,height:800}});
    const errors=collectPageErrors(page);
    let coldFixture=fixture.replace(/<input type="search" placeholder="Найти (?:чат|задачу)">/g,'').replace('placeholder="Поиск сотрудников"',`placeholder="${placeholder}"`);
    assert(!coldFixture.includes('<input type="search" placeholder="Найти '),'Cold list search must be absent before runtime loads');
    if(!enabled) coldFixture=coldFixture.replace(/<script src="\.\.\/extension\/[^\"]+"><\/script>/g,'').replace(/<link rel="stylesheet" href="\.\.\/extension\/injected.css">/,'');
    await page.route('**/tests/native-resume-recovery-harness.html?*',route=>route.fulfill({contentType:'text/html',body:coldFixture}));
    await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:injected}));
    await page.goto(endpoint+'tests/native-resume-recovery-harness.html?autoBootstrap=1&chatCount=300&taskCount=1000');
    await page.waitForFunction(enabled=>window.__mentionProbe?.ready&&(!enabled||window.__PENA_RECENT_SYNC__?.version),enabled);
    await page.waitForTimeout(1200);
    const before=await page.evaluate(()=>window.__mentionProbe.inputEvents);
    await page.locator('#entity-input').press('z');
    await page.waitForTimeout(250);
    report.coldOwnership.push(await page.evaluate(({enabled,placeholder,before})=>({enabled,placeholder,
      delivered:window.__mentionProbe.inputEvents-before,owner:document.getElementById('entity-input').getAttribute('data-pena-search-owner'),
      actualPlaceholder:document.getElementById('entity-input').getAttribute('placeholder'),
      historyRows:document.getElementById('mention-history').children.length,
      popupRows:document.querySelectorAll('#mention-popup .ui-selector-item').length}),{enabled,placeholder,before}));
    await page.evaluate(()=>window.__mentionProbe.stop());
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log(JSON.stringify({coldOwnership:report.coldOwnership}));
  report.coldOwnershipFailures=report.coldOwnership.filter(sample=>sample.delivered!==1||sample.owner);
  assert.equal(report.coldOwnership[0].delivered,1,'Disabled extension cold entity input must receive trusted input');
  if(!reportOnly) assert.deepEqual(report.coldOwnershipFailures,[],'Extension stole a cold native entity-selector input');
  if(!ownershipOnly) {
  const [off,on,negative]=report.arms;
  const violations=arm=>['mention','entity','send','task'].flatMap(kind=>['inputToCompletionMs','inputToPaintMs'].flatMap(metric=>{
    // Three independent disabled arms varied by <=20 ms p95. This allows host
    // jitter without letting a +100 ms foreground regression hide under a
    // fixed 300/350 ms ceiling. The negative control uses this same predicate.
    const nativeP95=off.statistics[kind][metric].p95;
    const limit=Math.max(nativeP95*1.35,nativeP95+50);
    const actual=arm.statistics[kind][metric].p95;
    return actual>limit?[{kind,metric,actual,limit}]:[];
  }));
  report.violations=violations(on);report.negativeControlViolations=violations(negative);
  // The fixture emits two native batches per lookup and one per send/open:
  // 1.5 callbacks/action at baseline. Allow separate extension follow-up work,
  // but reject a self-sustaining toolbar RAF/mutation loop (986/80 previously).
  report.observerBudgets=['HTML','BODY'].map(target=>({target,
    calls:on.observers.filter(record=>record.targets.includes(target)).reduce((sum,record)=>sum+record.calls,0),
    limit:3*on.samples.length+20}));
  report.ownershipFailures=on.ownership.filter(sample=>sample.delivered!==1||sample.owner);
  assert(off.ownership.every(sample=>sample.delivered===1&&!sample.owner),'Native ownership control must receive every trusted input');
  assert(report.negativeControlViolations.some(v=>v.kind==='mention'&&v.metric==='inputToPaintMs'),'Blocking observer negative control was not detected');
  assert(negative.longtasks.length>0,'Negative control must record main-thread long tasks');
  if(!reportOnly) {
    assert.deepEqual(report.violations,[],'Extension exceeds foreground A/B budget');
    assert.deepEqual(report.ownershipFailures,[],'Extension stole a native entity-selector input');
    for(const budget of report.observerBudgets) assert(budget.calls<=budget.limit,`${budget.target} callbacks ${budget.calls} exceed ${budget.limit}; possible self-sustaining mutation loop`);
  }
  }
  console.log(`${reportOnly?'REPORT ONLY':'PASS'} native mention interference: ${ownershipOnly?'cold ownership':`${samples} samples/action, relative foreground budgets, bounded observers, cold ownership and negative control`}`);
} finally {
  writeFileSync(resolve(root,`tests/artifacts/native-mention-${label}.json`),JSON.stringify(report,null,2));
  await browser.close();await server.close();await new Promise(resolve=>transport.close(resolve));
}

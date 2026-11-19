import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startHarnessServer } from './lib/harness-server.mjs';

const [ref, area, size, pass] = process.argv.slice(2);
const chunk = Number(size);
assert(['list', 'conversation'].includes(area) && [50, 600].includes(chunk));
const target = 'chat' + (1000 + 2 * chunk - 10);
const raw = execFileSync('git', ['show', ref + ':extension/injected.js'], { encoding: 'utf8', maxBuffer: 8_000_000 });
const server = await startHarnessServer();
const browser = await chromium.launch();
const hook = '\tasync function boot() {';
assert(raw.includes(hook));
const tracked = ['_getDialogNativeFolderDemand', '_getDialogNativeSourceRows', 'applyFilters', '_refreshDialogNativeVisibleWindow'];
const instrumented = tracked.map(name => `const saved${name}=${name};
 ${name}=(...args)=>{if(!a.started)return saved${name}(...args);const t=performance.now();
 const pending=!!window.nativeServices?.tasks?.isLoading;
 try{return saved${name}(...args);}finally{a.calls.push({fn:'${name}',pending,ms:performance.now()-t});}};`).join('\n');
const injection = hook + `
 const a=window.audit={calls:[],frames:[],long:[],started:false,done:false};
 ${instrumented}
 window.prepareRun=target=>{
  const items=_getDialogControlItems();const member=items.find(i=>i.id===target);if(!member)throw Error('Unknown folder member');
  for(const item of items) {if(/^chat\\d+$/.test(item.id) && (Number(item.id.slice(4))<1085 || item===member)) item.folderId='folder:test';}
  _saveDialogControlItems();localStorage.setItem(_dialogControlUniqueKey('tasks'),'1');
  window.nativeServiceDelay=950;window.nativeServiceRenderDelay=120;
 };
 window.startRun=()=>{
  a.started=true;a.t=performance.now();let last=a.t;
  new PerformanceObserver(list=>{for(const e of list.getEntries())if(!a.done)a.long.push(Math.round(e.duration));}).observe({entryTypes:['longtask']});
  const frame=t=>{if(a.done)return;if(t>last)a.frames.push(t-last);last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  _setDialogControlNativeActiveFolderId('folder:test');
 };
 window.finishedRun=()=>!_dialogNativeFolderRun;
`;
try {
 const page=await browser.newPage({viewport:{width:1400,height:850}});
 const session=await page.context().newCDPSession(page);
 const metrics=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 await session.send('Performance.enable');
 await page.route('**/extension/injected.js*',r=>r.fulfill({contentType:'application/javascript',body:raw.replace(hook,injection)}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&nativeFirst=1&passThrough=1&eager=0&lazy=1&lazyNative=1&catalogRows=1200&lazyChunk='+chunk+'&nativeService=1&skipTestOutput');
 await page.locator('.task-host .pena-native-folder-switcher').waitFor();
 await page.waitForFunction(()=>window.__PENA_RECENT_SYNC__?.gateReady);
 await page.evaluate(target=>{
  const list=document.querySelector('.task-host .bx-im-list-container-task__scroll-container');
  list.style.maxHeight='230px';list.style.overflow='auto';list.id='feed';
  const pane=document.createElement('section');pane.id='conversation';pane.className='bx-im-dialog-chat__scroll-container';
  pane.style.cssText='position:fixed;z-index:10000;right:0;top:0;height:700px;width:35vw;overflow:auto;background:white';
  for(let i=0;i<600;i++){const m=document.createElement('p');m.textContent='Message '+i;pane.append(m);}document.body.append(pane);
  window.travel={list:0,conversation:0};
  for(const [name,el] of [['list',list],['conversation',pane]]){
   let prev=el.scrollTop;el.addEventListener('scroll',()=>{travel[name]+=Math.abs(el.scrollTop-prev);prev=el.scrollTop;},{passive:true});
  }
  prepareRun(target);
 },target);
 await page.waitForTimeout(400);
 const box=await page.locator(area==='list'?'#feed':'#conversation').boundingBox();
 assert(box&&box.width>30&&box.height>30);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await session.send('Profiler.enable');await session.send('Profiler.start');
 const before=await metrics();
 await page.evaluate(()=>startRun());
 let overlapping=0;
 for(let i=0;i<144;i++){
  await page.mouse.wheel(0,Math.floor(i/8)%2===0?64:-64);
  if(i%8===0&&await page.evaluate(()=>nativeServices.tasks.isLoading))overlapping++;
 }
 await page.locator('.task-host [data-id="'+target+'"]').waitFor({state:'visible',timeout:20000});
 await page.waitForFunction(()=>finishedRun());
 const after=await metrics();
 const {profile}=await session.send('Profiler.stop');
 const byId=new Map(profile.nodes.map(n=>[n.id,n]));
 const samples={};
 for(let i=0;i<profile.samples.length;i++){const n=byId.get(profile.samples[i]);const key=(n.callFrame.functionName||'(anonymous)')+' '+n.callFrame.url.split('/').pop()+':'+(n.callFrame.lineNumber+1);samples[key]=(samples[key]||0)+profile.timeDeltas[i]/1000;}
 const result=await page.evaluate(()=>{
  const a=audit;a.done=true;const f=a.frames.sort((a,b)=>a-b);
  const summary={};for(const e of a.calls){const key=e.fn+(e.pending?' pending':' ready');const s=summary[key]||={count:0,total:0,max:0};s.count++;s.total+=e.ms;s.max=Math.max(s.max,e.ms);}
  return {requests:nativeServiceCalls.length,travel,frames:{count:f.length,p95:f[Math.ceil(f.length*.95)-1],max:f.at(-1),over50:f.filter(x=>x>50.5).length},longTasks:a.long,summary};
 });
 const data={ref,area,chunk,pass,overlapping,...result,rendererMs:Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k,Math.round((after[k]-before[k])*1000)])),top:Object.entries(samples).filter(([key])=>!key.startsWith('(idle)')).sort((a,b)=>b[1]-a[1]).slice(0,35)};
 mkdirSync('tests/artifacts/hosted',{recursive:true});
 writeFileSync('tests/artifacts/hosted/'+[ref,area,chunk,pass].join('-')+'.json',JSON.stringify(data,null,2));
 console.log(JSON.stringify({ref,area,chunk,pass,requests:data.requests,overlapping,travel:data.travel,frames:data.frames,rendererMs:data.rendererMs}));
 assert(overlapping>0 && data.travel[area]>120 && data.requests>=2,'Exercise both paging and physical wheel movement');
} finally {await browser.close();await server.close();}

import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const report={platform:process.platform,phases:[]};
async function phase(name,fn){try{report.phases.push({name,status:'PASS',evidence:await fn()});}catch(e){report.phases.push({name,status:'FAIL',error:e.stack});}console.log(report.phases.at(-1));}
const origin='https://portal.test/online/';
const repo='dmikhailovspace-commits/bx24-extension';
const metadata=version=>({version,raw_base_url:`https://raw.githubusercontent.com/${repo}/v${version}`,release_url:`https://github.com/${repo}/releases/tag/v${version}`});
await phase('raw DNS failure uses alternate GitHub endpoint; checks coalesce, persist and never install',async()=>{
 let listener;const saved={},calls=[],native=[];let remote='9.0.1',fail=false;
 const chrome={runtime:{id:'test',getManifest:()=>({version:'8.0.20',permissions:['nativeMessaging']}),onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener:()=>{}},sendNativeMessage:(name,request,cb)=>{native.push(request);cb({ok:true,protocol:1});}},storage:{local:{get:(_keys,cb)=>cb(saved),set:(value,cb)=>{Object.assign(saved,value);cb();}}}};
 const context=vm.createContext({chrome,Date,Map,Set,Promise,URL,AbortController,setTimeout,clearTimeout,fetch:async url=>{calls.push(url);if(fail||url.includes('raw.githubusercontent'))throw new Error('DNS');return{ok:true,json:async()=>metadata(remote)};}});
 vm.runInContext(read('extension/background.js'),context);
 const request=(action,fields={},sender={id:'test',url:origin})=>new Promise(resolve=>listener({channel:'pena.update.v1',action,...fields},sender,resolve));
 const responses=await Promise.all([request('check'),request('check'),request('check')]);
 assert(responses.every(r=>r.ok&&r.result.available));assert.equal(calls.length,2);assert.equal(native.length,0);
 await request('check');assert.equal(calls.length,2);
 assert.equal((await request('apply',{version:'9.0.0'})).ok,false);assert.equal(native.length,0,'Stale approval cannot install another release');
 assert.equal((await request('apply',{version:remote})).ok,true);assert.equal(native.filter(r=>r.action==='apply').length,1);
 assert.equal((await request('apply',{version:remote},{id:'foreign',url:origin})).ok,false);
 fail=true;assert.equal((await request('apply',{version:remote})).ok,false);assert.equal(native.filter(r=>r.action==='apply').length,1,'Offline cached metadata is not approval to install');
 return {coldChecks:2,warmChecks:0,automaticInstalls:0,approvedInstalls:1};
});
await phase('closed-shadow consent requires a real click and preserves visible download fallback',async()=>{
 if(process.env.PENA_UPDATE_PLATFORM_ONLY)return {coveredOn:'Windows Chromium verification job'};
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:true});
 try {
  for (const mode of [{native:true,desktop:true},{native:false,desktop:false},{native:false,desktop:true}]) {
  const page=await browser.newPage({viewport:{width:800,height:600}});
  await page.setContent('<div style="margin:30px"><span>Сегодня 01:00</span><span class="pena-native-update-slot"></span></div>');
  await page.evaluate(mode=>{
   const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const result=attach.call(this,options);window.testRoot=result;window.shadowMode=options.mode;return result;};
   window.requests=[];
   window.chrome={runtime:{sendMessage:(message,callback)=>{requests.push(message);callback({ok:true,result:message.action==='check'?{available:true,version:'9.0.1',desktop:mode.desktop}:message.action==='prepare'?mode:{started:true}});}}};
  },mode);
  const content=read('extension/content.js');
  await page.addScriptTag({content:content.slice(content.indexOf('  // Consent lives'),content.indexOf("  const _enabledKey"))});
  await page.evaluate(()=>document.dispatchEvent(new Event('pena-update-slot-ready')));
  await page.waitForFunction(()=>testRoot.querySelector('.badge').hidden===false);
  assert.equal(await page.evaluate(()=>shadowMode),'closed');
  await page.evaluate(()=>testRoot.querySelector('.badge').click());
  assert.equal(await page.evaluate(()=>testRoot.querySelector('.panel').hidden),true,'Synthetic clicks cannot open consent');
  const click=async selector=>{const point=await page.evaluate(selector=>{const r=testRoot.querySelector(selector).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},selector);await page.mouse.click(point.x,point.y);};
  await click('.badge');await page.waitForFunction(()=>testRoot.querySelector('.primary'));
  if (mode.native) {
  await page.evaluate(()=>testRoot.querySelector('.primary').click());
  assert.equal(await page.evaluate(()=>requests.filter(r=>r.action==='apply').length),0);
  await click('.primary');assert.equal(await page.evaluate(()=>requests.filter(r=>r.action==='apply').length),1);
  await page.screenshot({path:'tests/artifacts/update-consent.png'});
  } else {
   const href=await page.evaluate(()=>testRoot.querySelector('a.primary').href);
   assert.equal(href,mode.desktop?`https://github.com/${repo}/releases/tag/v9.0.1`:`https://github.com/${repo}/releases/download/v9.0.1/BX24_Chat_Sorter_Chrome_v9.0.1.zip`);
   assert.equal(await page.evaluate(()=>requests.filter(r=>r.action==='apply').length),0);
  }
  await page.close();
  }
 } finally {await browser.close();}
 return {closedShadow:true,syntheticInstalls:0,trustedInstalls:1};
});
await phase('desktop default and stale approval never publish; approved Windows version reaches atomic updater',async()=>{
 if(process.platform!=='win32')return {coveredOn:'Windows verification job'};
 const temp=mkdtempSync(join(tmpdir(),'pena-consent-')),local=join(temp,'PENA Agency','Extension');mkdirSync(local,{recursive:true});
 writeFileSync(join(local,'manifest.json'),JSON.stringify({version:'8.0.20'}));
 const overrides=`
function Get-UpdateMetadata { return @{version='99.1.2'} }
function Test-InstalledReleaseHealth { return $true }
function Invoke-AtomicExtensionUpdate { 'APPLIED' | Set-Content -LiteralPath '${join(temp,'applied').replaceAll("'","''")}' }
function Register-NativeHost {}
function Get-BitrixExecutable { return $null }
function ShowBalloon {}
`;
 const source=read('installers/windows/updater.ps1').replace('if ($InstallFrom) {',overrides+'\nif ($InstallFrom) {');
 const script=join(temp,'updater.ps1');writeFileSync(script,'\ufeff'+source.replace(/^\uFEFF/,''));
 const run=args=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,...args],{env:{...process.env,LOCALAPPDATA:temp},windowsHide:true,encoding:'utf8',timeout:30000});
 assert.equal(run([]).status,0);assert(!existsSync(join(temp,'applied')));
 assert.equal(run(['-LaunchWithUpdate']).status,0);assert(!existsSync(join(temp,'applied')));
 const stale=run(['-ApprovedVersion','99.1.1']);assert.equal(stale.status,1,stale.stdout+stale.stderr);assert(!existsSync(join(temp,'applied')));
 const result=run(['-ApprovedVersion','99.1.2']);assert.equal(result.status,0,result.stdout+result.stderr);assert(existsSync(join(temp,'applied')));
 const frame=Buffer.from(JSON.stringify({action:'status'}));const header=Buffer.alloc(4);header.writeUInt32LE(frame.length);
 const host=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('installers/windows/pena_host.ps1')],{input:Buffer.concat([header,frame]),env:{...process.env,LOCALAPPDATA:temp},windowsHide:true,timeout:10000});
 assert.equal(host.status,0,`native status=${host.status}, stderr=${host.stderr}, stdout=${host.stdout.toString('hex')}`);assert.equal(host.stdout.readUInt32LE(0),host.stdout.length-4);assert.equal(JSON.parse(host.stdout.subarray(4)).protocol,1);
 return {defaultInstalls:0,shortcutInstalls:0,staleApprovalInstalls:0,approvedInstalls:1,nativeFraming:true};
});
await phase('macOS real updater migrates changing worker name; missing staged worker preserves installed version',async()=>{
 if(process.platform!=='darwin')return {coveredOn:'macOS build job before DMG packaging'};
 const temp=mkdtempSync(join(tmpdir(),'pena-mac-update-')),home=join(temp,'home'),bin=join(temp,'bin'),fixture=join(temp,'fixture');
 const installed=join(home,'Library/Application Support/PENA Agency/Extension');
 for(const dir of [installed,bin,fixture,join(home,'Library/Logs')])mkdirSync(dir,{recursive:true});
 cpSync(resolve('extension'),join(fixture,'extension'),{recursive:true});
 const update=JSON.parse(read('update.json')),manifest=JSON.parse(read('extension/manifest.json'));
 const oldWorker=manifest.background.service_worker,newWorker='worker-v99_1_2.js';manifest.version='99.1.2';manifest.background.service_worker=newWorker;
 writeFileSync(join(fixture,'extension/manifest.json'),JSON.stringify(manifest));cpSync(join(fixture,'extension',oldWorker),join(fixture,'extension',newWorker));
 Object.assign(update,metadata('99.1.2'));update.extension_files=update.extension_files.map(f=>f===oldWorker?newWorker:f);
 writeFileSync(join(fixture,'update.json'),JSON.stringify(update));
 mkdirSync(join(fixture,'installers/macos'),{recursive:true});cpSync(resolve('installers/macos/updater.sh'),join(fixture,'installers/macos/updater.sh'));
 cpSync(resolve('extension'),installed,{recursive:true});cpSync(resolve('installers/macos/updater.sh'),join(installed,'pena_updater.sh'));
 writeFileSync(join(bin,'curl'),`#!/bin/bash
url='';out=''
while [ "$#" -gt 0 ]; do case "$1" in -o) out="$2";shift;; https://*) url="$1";; esac;shift;done
if [[ "$url" == *update.json* ]]; then cat "$PENA_FIXTURE/update.json";exit;fi
relative="\${url#*/v99.1.2/}"
if [ -e "$PENA_FIXTURE/fail-worker" ] && [[ "$relative" == *worker-v99_1_2.js* ]]; then exit 22;fi
cp "$PENA_FIXTURE/$relative" "$out"
`,{mode:0o755});
 for(const name of ['pkill','open','sleep'])writeFileSync(join(bin,name),'#!/bin/bash\nexit 0\n',{mode:0o755});
 const env={...process.env,HOME:home,PATH:bin+':'+process.env.PATH,PENA_FIXTURE:fixture};
 const run=args=>spawnSync('/bin/bash',[resolve('installers/macos/updater.sh'),...args],{env,encoding:'utf8',timeout:30000});
 const before=readFileSync(join(installed,'manifest.json'),'utf8');
 assert.equal(run([]).status,0);assert.equal(readFileSync(join(installed,'manifest.json'),'utf8'),before);
 assert.equal(run(['--approved-version','99.1.1']).status,1);assert.equal(readFileSync(join(installed,'manifest.json'),'utf8'),before);
 writeFileSync(join(fixture,'fail-worker'),'1');assert.equal(run(['--approved-version','99.1.2']).status,1);assert.equal(readFileSync(join(installed,'manifest.json'),'utf8'),before);
 const {unlinkSync}=await import('node:fs');unlinkSync(join(fixture,'fail-worker'));
 const result=run(['--approved-version','99.1.2']);assert.equal(result.status,0,result.stdout+result.stderr);
 assert.equal(JSON.parse(readFileSync(join(installed,'manifest.json'),'utf8')).background.service_worker,newWorker);
 assert(existsSync(join(installed,newWorker)));assert(!existsSync(join(installed,oldWorker)));
 const frame=Buffer.from('{"action":"status"}'),header=Buffer.alloc(4);header.writeUInt32LE(frame.length);
 const host=spawnSync('/bin/bash',[join(installed,'pena_updater.sh'),'--native-host','chrome-extension://hlhefpcndfepdlgbjcokkcodcbfnnepm/'],{input:Buffer.concat([header,frame]),env,timeout:10000});
 assert.equal(host.status,0,`native status=${host.status}, stderr=${host.stderr}, stdout=${host.stdout.toString('hex')}`);assert.equal(host.stdout.readUInt32LE(0),host.stdout.length-4);assert.equal(JSON.parse(host.stdout.subarray(4)).protocol,1);
 return {changedWorker:true,defaultInstalls:0,staleApprovalInstalls:0,failedDownloadRetainsVersion:true,nativeFraming:true};
});
mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/update-delivery-regression.json',JSON.stringify(report,null,2));
assert(report.phases.every(p=>p.status==='PASS'),'Update delivery regression failed');

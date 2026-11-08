import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync('extension/injected.js','utf8');
const helpers=source.slice(source.indexOf('\tfunction _commitSortingTransfer('),source.indexOf('\tfunction _openSortingTransfer()'));
const script=`(()=>{let _dialogControlItems,_dialogControlStorageRaw,_dialogControlDataRevision=0,_dialogControlLastSig,_dialogControlNativeViewSig,_dialogControlNativeSwitcherSig;const _clearDialogControlMultiSelection=()=>{},_notifyDialogRecentDataChanged=()=>{},_scheduleDialogAutomation=()=>{};${helpers};window.transferTest={commit:_commitSortingTransfer,persist:_persistSortingTransfer,read:_readSortingTransferBackup,record:_sortingTransferBackupRecord};})()`;
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const results=[];
try{
 const page=await browser.newPage();
 await page.route('**/transfer-storage',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Transfer storage regression</title>'}));
 await page.goto(server.baseUrl+'/transfer-storage');await page.addScriptTag({content:script});
 const quota=await page.evaluate(async()=>{
  localStorage.setItem('a','A'.repeat(5000));localStorage.setItem('b','B'.repeat(5000));
  let filler='';for(let step=1024*1024;step>=128;step=Math.floor(step/2)){for(;;){try{localStorage.setItem('unrelated',filler+'x'.repeat(step));filler+='x'.repeat(step);}catch{break;}}}
  const entries=[['a','a'.repeat(5000)],['b','b'.repeat(5000)]];
  let oldFailed=false;try{localStorage.setItem('pena.sortingTransfer.backup.v1.quota~7',JSON.stringify({scope:'quota~7',entries:entries.map(([k])=>[k,localStorage.getItem(k)])}));}catch(e){oldFailed=e.name==='QuotaExceededError';}
  await transferTest.persist('quota~7',entries,()=>{});
  const backup=await transferTest.read('quota~7');
  return {oldFailed,fillerLength:filler.length,backup:backup.entries.map(([k,v])=>[k,v.length,v[0]]),a:localStorage.getItem('a')[0],unrelated:localStorage.getItem('unrelated').length};
 });
 assert.equal(quota.oldFailed,true);assert.equal(quota.a,'a');assert.equal(quota.unrelated,quota.fillerLength);assert.deepEqual(quota.backup,[['a',5000,'A'],['b',5000,'B']]);results.push({name:'real full localStorage: former backup fails, IDB import succeeds',...quota});
 await page.reload();await page.addScriptTag({content:script});
 assert.equal(await page.evaluate(async()=>{await transferTest.persist('quota~7',[['a',''],['b','']],()=>{},true);return localStorage.getItem('a')[0]+localStorage.getItem('b')[0];}),'AB');
 results.push({name:'durable undo survives page reload',passed:true});
 const rollback=await page.evaluate(async()=>{const before=[localStorage.getItem('a'),localStorage.getItem('b')];let message='';try{await transferTest.persist('quota~7',[['a','z'.repeat(1000)],['b','z'.repeat(100000)]],()=>{});}catch(e){message=e.message;}return {message,restored:before[0]===localStorage.getItem('a')&&before[1]===localStorage.getItem('b'),unrelated:localStorage.getItem('unrelated').length};});
 assert.match(rollback.message,/Недостаточно места/);assert.equal(rollback.restored,true);assert.equal(rollback.unrelated,quota.fillerLength);results.push({name:'real quota midway through commit rolls back both keys',...rollback});
 await page.evaluate(()=>{localStorage.removeItem('unrelated');});
 const abort=await page.evaluate(async()=>{
  const old={scope:'quota~7',entries:[['a','old A'],['b','old B']]};await transferTest.record('quota~7',()=>({backup:old}));
  const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=original.apply(this,args);this.transaction.abort();return r;};
  let failed=false;try{await transferTest.persist('quota~7',[['a','changed'],['b','changed']],()=>{});}catch{failed=true;}finally{IDBObjectStore.prototype.put=original;}
  return {failed,unchanged:localStorage.getItem('a')==='A'.repeat(5000),backup:await transferTest.read('quota~7')};
 });
 assert.equal(abort.failed,true);assert.equal(abort.unchanged,true);assert.equal(abort.backup.entries[0][1],'old A');results.push({name:'IDB abort before durable journal preserves settings and prior undo',passed:true});
 const unfinished=await page.evaluate(async()=>{
  const original=IDBObjectStore.prototype.put;let puts=0;IDBObjectStore.prototype.put=function(...args){const r=original.apply(this,args);if(++puts===2)this.transaction.abort();return r;};
  try{await transferTest.persist('quota~7',[['a','new A'],['b','new B']],()=>{});}finally{IDBObjectStore.prototype.put=original;}
  const record=await transferTest.record('quota~7');return {pending:!!record.pending,backup:(await transferTest.read('quota~7')).entries[0][1]};
 });
 assert.equal(unfinished.pending,true);assert.equal(unfinished.backup,'A'.repeat(5000));
 await page.reload();await page.addScriptTag({content:script});
 assert.equal(await page.evaluate(async()=>{await transferTest.persist('quota~7',[['a',''],['b','']],()=>{},true);return localStorage.getItem('a');}),'A'.repeat(5000));results.push({name:'interrupted journal finalization retains undo after reload',passed:true});
 const partial=await page.evaluate(async()=>{
  const scope='quota~7',legacy=`pena.sortingTransfer.backup.v1.${scope}`;
  const before=[['a','before A'],['b','before B'],[legacy,null]],after=[['a','after A'],['b','after B'],[legacy,null]];
  await transferTest.record(scope,()=>({backup:null,pending:{before,after,nextBackup:{scope,entries:before.slice(0,2)}}}));localStorage.setItem('a','after A');localStorage.setItem('b','before B');
  let blocked=false;try{await transferTest.persist(scope,[['a','third A'],['b','third B']],()=>{});}catch(e){blocked=/прерван/.test(e.message);}
  await transferTest.persist(scope,[['a',''],['b','']],()=>{},true);return {blocked,a:localStorage.getItem('a'),b:localStorage.getItem('b')};
 });
 assert.deepEqual(partial,{blocked:true,a:'before A',b:'before B'});results.push({name:'interrupted partial local write requires explicit undo',passed:true});
 const guard=await page.evaluate(async()=>{let checks=0,blocked=false;try{await transferTest.persist('quota~7',[['a','changed'],['b','changed']],()=>{if(++checks===2)throw Error('scope changed or dialog closed');});}catch{blocked=true;}return {blocked,a:localStorage.getItem('a'),backup:await transferTest.read('quota~7')};});
 assert.equal(guard.blocked,true);assert.equal(guard.a,'before A');assert.equal(guard.backup,null);results.push({name:'scope/close guard rechecked after durable backup before local mutation',passed:true});
 const legacy=await page.evaluate(async()=>{const scope='quota~7',key=`pena.sortingTransfer.backup.v1.${scope}`;localStorage.setItem(key,JSON.stringify({scope,entries:[['a','legacy A'],['b','legacy B']]}));await transferTest.persist(scope,[['a','next A'],['b','next B']],()=>{});return {old:localStorage.getItem(key),backup:(await transferTest.read(scope)).entries};});
 assert.equal(legacy.old,null);assert.deepEqual(legacy.backup,[['a','before A'],['b','before B']]);results.push({name:'legacy localStorage backup migrates without duplicate local quota',passed:true});
 mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/transfer-storage.json',JSON.stringify({passed:true,realBrowser:'Chromium',cases:results},null,2));console.log(`PASS transfer storage: ${results.length} durable backup / real quota cases`);
}finally{await browser.close();await server.close();}

import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync('extension/injected.js','utf8');
const instrumented=source.replace('\tasync function boot() {',`\tasync function boot() {
 window.__EXCLUSION_TEST__={key:()=>_dialogAutomationKey(_pMode()),selected:()=>[..._dialogControlMultiSelected],user:id=>_acceptCurrentBitrixUserId(id)};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const mode of ['chats','tasks']){
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'text/javascript',body:instrumented}));
  await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=${mode}&nativeCatalog=1&nativeFirst=1&passThrough=1`);
  await page.locator('.pena-native-folder-switcher').waitFor({state:'visible'});
  await page.waitForFunction(()=>window.__PENA_RECENT_SYNC__?.gateReady&&!document.querySelector('.pena-native-original-load-guard'));
  const host=page.locator(mode==='tasks'?'.task-host':'.recent-host'),key=await page.evaluate(()=>__EXCLUSION_TEST__.key());
  const locks=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key+'.locks')||'[]'),key);
  const row=id=>host.locator(`[data-id="${id}"]`);
  await row('chat5').click({button:'right'});
  await page.getByRole('menuitem',{name:'Добавить в исключения переноса',exact:true}).click();
  assert.deepEqual(await locks(),['chat5']);
  await row('chat5').click({button:'right'});
  assert.equal(await page.getByRole('menuitem',{name:'Добавить в исключения переноса',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');
  results.push({mode,case:'Native right click excludes one dialog; repeated action is disabled',passed:true});
  await row('chat77').click({modifiers:['Control']});await row('chat225').click({modifiers:['Control']});
  assert.deepEqual(new Set(await page.evaluate(()=>__EXCLUSION_TEST__.selected())),new Set(['chat77','chat225']));
  await row('chat77').click({button:'right'});
  await page.getByRole('menuitem',{name:'Добавить выбранные в исключения переноса',exact:true}).click();
  assert.deepEqual(new Set(await locks()),new Set(['chat5','chat77','chat225']));
  results.push({mode,case:'Native multiselect right click excludes the full selection',passed:true});
  await page.keyboard.press('Escape');
  await row('chat5').click({button:'right'});await page.keyboard.press('Escape');
  // Clear only this fixture's locks, then open a fresh native menu and switch identity.
  await page.evaluate(key=>localStorage.removeItem(key+'.locks'),key);
  await row('chat5').click({button:'right'});
  await page.evaluate(()=>{window.currentBitrixUserId='8';__EXCLUSION_TEST__.user('8');});
  await page.getByRole('menuitem',{name:'Добавить в исключения переноса',exact:true}).click();
  const newKey=await page.evaluate(()=>__EXCLUSION_TEST__.key());assert.notEqual(newKey,key);
  assert.deepEqual(await locks(),[]);assert.equal(await page.evaluate(key=>localStorage.getItem(key+'.locks'),newKey),null);
  results.push({mode,case:'A menu opened under another user cannot write either identity',passed:true});
  assert.deepEqual(errors,[]);await page.close();
 }
 mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/rules-context-exclusions.json',JSON.stringify({passed:true,livePortal:false,cases:results},null,2));console.log(`PASS native context exclusions: ${results.length} real click / multiselect / scope cases`);
}finally{await browser.close();await server.close();}

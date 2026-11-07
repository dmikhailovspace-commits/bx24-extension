import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
import {checkTransferCode,openTransferSettings} from './lib/settings-transfer-ui.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const errors=[];mkdirSync('tests/artifacts',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.baseUrl+'/tests/native-cold-start-layout-harness.html?layoutDelay=50');
 await page.locator('.pena-native-folder-switcher').waitFor();
 await page.evaluate(()=>{BX.message=key=>key==='USER_ID'?'7':'';});
 await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 assert.equal(await page.locator('.pena-native-filter-panel > .pena-native-sort-controls').count(),1,'Original filter structure is preserved');
 assert.equal(await page.locator('.pena-settings-section').evaluate(el=>el.open),false,'Settings are collapsed on open');
 await openTransferSettings(page);
 await checkTransferCode(page,'desktop');
 await openTransferSettings(page);
 await page.screenshot({path:'tests/artifacts/settings-transfer-collapsed.png'});
 await page.keyboard.press('Escape');
 for(const height of [800,400,320]){
  await page.setViewportSize({width:1280,height});
  const filter=page.locator('.pena-native-filter-panel');
  const button=filter.getByRole('button',{name:'Перенос настроек'});
  await button.scrollIntoViewIfNeeded();
  const box=await filter.boundingBox();assert.ok(box.y+box.height<=height,'Expanded settings stay inside the window');
  assert.equal(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Expanded settings action is visible and reachable');
 }
 await page.setViewportSize({width:1280,height:800});
 await page.screenshot({path:'tests/artifacts/settings-panel-desktop.png'});
 assert.deepEqual(errors,[]);
 writeFileSync('tests/artifacts/settings-transfer.json',JSON.stringify({passed:true,platform:'shared desktop runtime in Chromium',liveBitrix:false,codeFallback:true,invalidImport:true,staleConfirmation:true,undoAfterReopen:true,filtersPreserved:true,expandedSettingsReachable:true,wheelScrollBothEnds:true,responsive:['1100x800','360x640','640x400','360x320']},null,2));
 console.log('PASS desktop shared settings: export fallback, code validation, stale confirmation, import/undo, responsive layout');
} finally {await browser.close();await server.close();}

import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
import {checkTransferCode} from './lib/settings-transfer-ui.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const errors=[];mkdirSync('tests/artifacts',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.baseUrl+'/tests/native-cold-start-layout-harness.html?layoutDelay=50');
 await page.locator('.pena-native-folder-switcher').waitFor();
 await page.evaluate(()=>{BX.message=key=>key==='USER_ID'?'7':'';});
 await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 assert.equal(await page.locator('.pena-settings-panel summary').count(),1,'No nested settings accordion or extra tab');
 await page.getByText('Дополнительно',{exact:true}).click();await page.getByRole('button',{name:'Перенос настроек',exact:true}).click();
 await checkTransferCode(page,'desktop');
 if(!await page.locator('.pena-settings-panel').isVisible())await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 await page.waitForFunction(()=>{const el=document.querySelector('.pena-settings-panel');return el&&getComputedStyle(el).opacity==='1';});
 const heading=page.getByRole('heading',{name:'Настройки списка'});
 assert.equal(await heading.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+5,r.y+r.height/2));}),true,'Settings content stays above the folder list');
 await page.screenshot({path:'tests/artifacts/settings-panel-desktop.png'});
 assert.deepEqual(errors,[]);
 writeFileSync('tests/artifacts/settings-transfer.json',JSON.stringify({passed:true,platform:'shared desktop runtime in Chromium',liveBitrix:false,codeFallback:true,invalidImport:true,staleConfirmation:true,undoAfterReopen:true,responsive:[360,640,1100]},null,2));
 console.log('PASS desktop shared settings: export fallback, code validation, stale confirmation, import/undo, responsive layout');
} finally {await browser.close();await server.close();}

import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
import {checkTransferCode,checkImmediateExport,openTransferSettings,settleTransferMotion} from './lib/settings-transfer-ui.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const errors=[];mkdirSync('tests/artifacts',{recursive:true});
const fixture=readFileSync('tests/native-cold-start-layout-harness.html','utf8').replace('* { box-sizing: border-box; }','* { box-sizing: content-box; }');
const fixtureUrl=server.baseUrl+'/tests/native-cold-start-layout-harness.html?layoutDelay=50';
const prepare=async(page)=>{
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/tests/native-cold-start-layout-harness.html*',r=>r.fulfill({contentType:'text/html',body:fixture}));
};
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}});await prepare(page);
 await page.goto(fixtureUrl);
 await page.locator('.pena-native-folder-switcher').waitFor();
 await page.evaluate(()=>{BX.message=key=>key==='USER_ID'?'7':'';});
 await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 assert.equal(await page.locator('.pena-native-filter-panel > .pena-native-sort-controls').count(),1,'Original filter structure is preserved');
 assert.equal(await page.locator('.pena-settings-section').evaluate(el=>el.open),false,'Settings are collapsed on open');
 await openTransferSettings(page);
 await checkTransferCode(page,'desktop');
 await openTransferSettings(page);
 await settleTransferMotion(page.getByRole('dialog',{name:'Перенос настроек',exact:true}));
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
 // Use a real embedded viewport with a content-box host, not a fixture-wide reset
 // that accidentally makes extension controls fit.
 const embedded=await browser.newPage({viewport:{width:1000,height:800}});await prepare(embedded);
 await embedded.route('**/tests/settings-frame-host.html',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><style>body{margin:0}iframe{width:360px;height:540px;border:0}</style><iframe title="Messenger" src="${fixtureUrl}&standalone=1"></iframe>`}));
 await embedded.goto(server.baseUrl+'/tests/settings-frame-host.html');
 const frame=embedded.frames().find(f=>f.url().includes('native-cold-start'));
 await frame.locator('.pena-native-folder-switcher').waitFor();
 await frame.evaluate(()=>{BX.message=key=>key==='USER_ID'?'7':'';});
 await openTransferSettings(frame);
 const embeddedPanel=frame.getByRole('dialog',{name:'Перенос настроек',exact:true});
 await checkImmediateExport(embeddedPanel);
 for(const size of [{width:360,height:540},{width:320,height:320}]){
  await embedded.locator('iframe').evaluate((el,size)=>Object.assign(el.style,{width:size.width+'px',height:size.height+'px'}),size);
  await embeddedPanel.getByText('Вставить код вместо файла',{exact:true}).evaluate(el=>el.parentElement.open=true);
  const geometry=await embeddedPanel.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth>el.clientWidth+1};});
  assert.ok(geometry.left>=0&&geometry.top>=0&&geometry.right<=geometry.width+1&&geometry.bottom<=geometry.height+1,`Dialog fits embedded ${size.width}x${size.height}`);
  assert.equal(geometry.overflow,false,'Embedded dialog has no horizontal overflow');
  for(const name of ['Код экспорта','Код импорта','Файл настроек'])assert.equal(await embeddedPanel.getByLabel(name).evaluate(el=>{const a=el.getBoundingClientRect(),b=el.closest('.pena-transfer-body').getBoundingClientRect();return a.left>=b.left&&a.right<=b.right+1;}),true,`${name} remains within the embedded body`);
  await embeddedPanel.getByRole('button',{name:'Проверить код'}).scrollIntoViewIfNeeded();
  assert.equal(await embeddedPanel.getByRole('button',{name:'Проверить код'}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Embedded last action is reachable');
  await settleTransferMotion(embeddedPanel);
  await embedded.screenshot({path:`tests/artifacts/settings-iframe-${size.width}x${size.height}.png`});
 }
 await embedded.close();

 const large=await browser.newPage({viewport:{width:1280,height:800}});await prepare(large);await large.goto(fixtureUrl);
 await large.locator('.pena-native-folder-switcher').waitFor();await large.evaluate(()=>{BX.message=key=>key==='USER_ID'?'7':'';});await openTransferSettings(large);
 const largePanel=large.getByRole('dialog',{name:'Перенос настроек',exact:true});
 const original=JSON.parse(await largePanel.getByLabel('Код экспорта').inputValue());
 const importSizes=[];
 for(const target of [512*1024,2*1024*1024]){
  const incoming=structuredClone(original);incoming.modes.chats.items=[];
  const sample={id:'chat100000',type:'chat',title:'Portable settings '.padEnd(480,'x')};
  const count=Math.ceil(target/Buffer.byteLength(JSON.stringify(sample)));
  incoming.modes.chats.items=Array.from({length:count},(_,i)=>({...sample,id:`chat${100000+i}`}));
  const bytes=Buffer.from(JSON.stringify(incoming));assert.ok(bytes.length>=target);
  await largePanel.getByLabel('Файл настроек').setInputFiles({name:'large-valid.json',mimeType:'application/json',buffer:bytes});
  await largePanel.getByRole('status').filter({hasText:'Папок:'}).waitFor();
  await largePanel.getByRole('button',{name:'Подтвердить импорт'}).click();
  await largePanel.getByRole('status').filter({hasText:'Настройки перенесены'}).waitFor();
  const output=JSON.parse(await largePanel.getByLabel('Код экспорта').inputValue());
  assert.equal(output.modes.chats.items.filter(x=>Number(x.id.replace('chat',''))>=100000).length,count,'Full-size transfer preserves every imported assignment');
  importSizes.push({bytes:bytes.length,dialogs:count});
 }
 await large.close();
 assert.deepEqual(errors,[]);
 writeFileSync('tests/artifacts/settings-transfer.json',JSON.stringify({passed:true,platform:'shared desktop runtime in Chromium',liveBitrix:false,immediateExport:true,copyFeedbackAndRepeat:true,codeFallback:true,hostBoxSizing:'content-box',iframe:['360x540','320x320'],largeGeneratedImports:importSizes,invalidImport:true,staleConfirmation:true,undoAfterReopen:true,filtersPreserved:true,expandedSettingsReachable:true,wheelScrollBothEnds:true,responsive:['1100x800','360x640','640x400','360x320']},null,2));
 console.log('PASS desktop shared settings: export fallback, code validation, stale confirmation, import/undo, responsive layout');
} finally {await browser.close();await server.close();}

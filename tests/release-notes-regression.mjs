import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync('extension/content.js','utf8'),meta=JSON.parse(readFileSync('update.json'));
const start=source.indexOf('  // Keep these installed-version notes'),end=source.indexOf('  const _enabledKey');
const shared=source.slice(start,source.indexOf('  // Consent lives'));
assert.deepEqual(JSON.parse(vm.runInNewContext(shared+'\nJSON.stringify(_releaseNotes)')),meta.release_notes);
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const platform of ['Windows','macOS']){
  const page=await browser.newPage({viewport:{width:360,height:620}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<span class="pena-native-update-slot"></span>');
  await page.evaluate(()=>{
   const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return window.root=attach.call(this,options);};
   window.available=false;window.notes=[];window.applies=0;
   window.chrome={runtime:{sendMessage:(message,callback)=>{
    if(message.action==='apply')applies++;
    callback({ok:true,result:message.action==='check'?{available,version:available?'9.0.0':'8.0.66',desktop:true,notes}:message.action==='prepare'?{native:true,desktop:true}:{}});
   }}};
  });
  await page.addScriptTag({content:"const _releaseVersion='8.0.66';\n"+source.slice(start,end)});
  await page.evaluate(()=>document.dispatchEvent(new Event('pena-update-slot-ready')));
  const click=async()=>{const r=await page.evaluate(()=>{const r=root.querySelector('.badge').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.click(r.x,r.y);};
  await click();await page.waitForFunction(()=>root.querySelector('[role=status]')?.textContent.includes('актуальная'));
  assert.deepEqual(await page.evaluate(()=>[...root.querySelectorAll('.release-notes li')].map(el=>el.textContent)),meta.release_notes);
  assert.match(await page.evaluate(()=>root.querySelector('.update-hint').textContent),/проверяются автоматически/);
  await page.keyboard.press('Escape');await page.evaluate(()=>{available=true;notes=['Перетаскивание правил','<img src=x onerror="window.bad=true">',...Array(8).fill('a'.repeat(300))];});
  await click();await page.waitForFunction(()=>root.querySelector('.primary'));
  assert.equal(await page.evaluate(()=>root.querySelector('.panel>strong').textContent),'Обновление 9.0.0');
  assert.equal(await page.evaluate(()=>root.querySelectorAll('.release-notes li').length),6);
  assert.equal(await page.evaluate(()=>root.querySelector('.release-notes img')),null);
  assert.equal(await page.evaluate(()=>[...root.querySelectorAll('.release-notes li')].every(el=>el.textContent.length<=240)),true);
  assert.equal(await page.evaluate(()=>applies),0);
  assert.equal(await page.evaluate(()=>{const r=root.querySelector('.panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}),true);
  await page.screenshot({path:`tests/artifacts/release-notes-${platform}.png`});
  await page.keyboard.press('Escape');await page.evaluate(()=>notes=undefined);await click();await page.waitForFunction(()=>root.querySelector('.release-notes')?.textContent.includes('не опубликовано'));
  assert.deepEqual(errors,[]);results.push({platform,installedNotes:true,remoteNotes:true,plainText:true,bounded:true,automaticInstalls:0});await page.close();
 }
}finally{await browser.close();mkdirSync('tests/artifacts',{recursive:true});writeFileSync('tests/artifacts/release-notes.json',JSON.stringify({results,nativeMac:false},null,2));}
console.log('PASS release notes: shared installed copy, desktop flows, remote text safety and narrow popup');

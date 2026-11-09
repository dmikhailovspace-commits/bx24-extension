import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {startHarnessServer} from './lib/harness-server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const source=readFileSync('extension/injected.js','utf8');
const injected=source.replace('\tasync function boot() {',`\tasync function boot() {
 window.rulesUI={items:_getDialogControlItemsForMode,save:_saveDialogControlItemsForMode,key:_dialogAutomationKey,open:_openDialogAutomation,navigation:[]};
 _openDialogControlRemoteRow=async(item,mode)=>{rulesUI.navigation.push({id:item.id,mode});return true;};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
const errors=[],phases=[];let accordionMotion;mkdirSync('tests/artifacts',{recursive:true});
async function sampleExceptionsMotion(page, clicks=[0]) {
 return page.evaluate(async clicks=>{
  const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  await frame();await frame();
  const content=()=>document.querySelector('.pena-automation-exclusions-content');
  const toggle=()=>document.querySelector('.pena-automation-exclusions-toggle');
  const samples=[{ms:0,height:content().getBoundingClientRect().height}];
  const started=performance.now();let action=0,completed=false;
  while(performance.now()-started<1500){
   const elapsed=performance.now()-started;
   while(action<clicks.length&&elapsed>=clicks[action]){toggle().click();action++;}
   await frame();
   const elapsedAfter=performance.now()-started;
   samples.push({ms:elapsedAfter,height:content().getBoundingClientRect().height});
   const running=content().getAnimations().some(a=>a.playState==='running'||a.pending);
   if(action===clicks.length&&elapsedAfter>=clicks.at(-1)+300&&!running){completed=true;break;}
  }
  return {samples,completed,expanded:toggle().getAttribute('aria-expanded'),inert:content().inert};
 },clicks);
}
try {
 const page=await browser.newPage({viewport:{width:1100,height:850},reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/extension/injected.js',r=>r.fulfill({contentType:'application/javascript',body:injected}));
 await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&passThrough=1');
 await page.waitForFunction(()=>window.rulesUI?.items('tasks').filter(i=>i.taskId).length>=12);
 await page.evaluate(()=>{
  const key=rulesUI.key('tasks');
  localStorage.setItem(key,JSON.stringify({version:1,rules:[{id:'rule:ui',name:'Исходное правило',enabled:true,folderId:'folder:test',match:'any',conditions:[{field:'title',op:'contains',value:'UNMATCHED_QA'}]}],excludedIds:[]}));
  localStorage.setItem(rulesUI.key('chats'),JSON.stringify({version:1,rules:[],excludedIds:[],autoAcceptTransfers:false}));
  const item=rulesUI.items('tasks').find(i=>i.taskId);window.lockedId=item.id;
  localStorage.setItem(key+'.locks',JSON.stringify([item.id,'chat:missing-ui']));
  rulesUI.open();
 });
 const panel=page.getByRole('dialog',{name:'Автосортировка',exact:true});
 const review=()=>panel.getByRole('tab',{name:'Пересортировка',exact:true}).click();
 const editor=()=>panel.getByRole('tab',{name:'Правила',exact:true}).click();
 await editor();await panel.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 const required=panel.getByRole('checkbox',{name:'Обязательное',exact:true});
 assert.equal(await required.isChecked(),false);await required.check();
 await panel.getByLabel('Название правила',{exact:true}).fill('Несохранённый черновик');
 await review();
 const auto=panel.getByRole('checkbox',{name:'Автоматически подтверждать переносы',exact:true});
 assert.equal(await auto.isChecked(),false);await auto.check();
 assert.equal(await auto.evaluate(el=>document.activeElement===el),true,'Immediate toggle keeps keyboard focus after redraw');
 assert.deepEqual(await page.evaluate(()=>{const c=JSON.parse(localStorage.getItem(rulesUI.key('tasks')));return {auto:c.autoAcceptTransfers,name:c.rules[0].name,required:c.rules[0].conditions[0].required===true,chats:JSON.parse(localStorage.getItem(rulesUI.key('chats'))).autoAcceptTransfers};}),{auto:true,name:'Исходное правило',required:false,chats:false});
 await editor();assert.equal(await panel.getByLabel('Название правила',{exact:true}).inputValue(),'Несохранённый черновик');assert.equal(await required.isChecked(),true);
 await panel.getByRole('button',{name:'Сохранить',exact:true}).click();await panel.waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>{const c=JSON.parse(localStorage.getItem(rulesUI.key('tasks')));return {auto:c.autoAcceptTransfers,name:c.rules[0].name,required:c.rules[0].conditions[0].required};}),{auto:true,name:'Несохранённый черновик',required:true});
 phases.push('Required condition persists; immediate mode toggle preserves draft and survives Save');

 await page.evaluate(()=>rulesUI.open());await review();
 const exceptions=panel.getByRole('button',{name:'Исключения',exact:true});
 assert.equal(await exceptions.getAttribute('aria-expanded'),'false');
 assert.equal(await panel.locator('.pena-automation-exclusions-content').evaluate(el=>el.inert),true);
 const opening=await sampleExceptionsMotion(page),closing=await sampleExceptionsMotion(page),rapid=await sampleExceptionsMotion(page,[0,50,100]);
 for(const [name,motion] of Object.entries({opening,closing,rapid})){
  assert.equal(motion.completed,true,`${name} transition finishes within a bounded interval`);
  assert.ok(motion.samples.every(s=>Number.isFinite(s.height)),`${name} heights remain finite`);
 }
 const expandedHeight=opening.samples.at(-1).height;
 assert.ok(opening.samples[0].height<=1&&expandedHeight>100);
 assert.ok(opening.samples.some(s=>s.height>1&&s.height<expandedHeight-1),'Opening has real intermediate layout heights sampled by requestAnimationFrame');
 assert.ok(closing.samples[0].height>100&&closing.samples.at(-1).height<=1);
 assert.ok(closing.samples.some(s=>s.height>1&&s.height<expandedHeight-1),'Closing has real intermediate layout heights sampled by requestAnimationFrame');
 assert.equal(closing.inert,true);assert.equal(closing.expanded,'false');
 assert.equal(rapid.expanded,'true');assert.equal(rapid.inert,false);
 assert.ok(Math.abs(rapid.samples.at(-1).height-expandedHeight)<=1,'Rapid reversal finishes at the requested expanded height');
 accordionMotion={opening,closing,rapid};
 await page.evaluate(()=>document.dispatchEvent(new Event('pena-automation-review-changed')));
 await page.waitForFunction(()=>document.querySelector('.pena-automation-exclusions-toggle').getAttribute('aria-expanded')==='true');
 assert.equal(await panel.locator('.pena-automation-locked').count(),2);
 assert.equal(await panel.locator('.pena-automation-locked').last().getByRole('button',{name:'К диалогу',exact:true}).isDisabled(),true);
 const locksBefore=await page.evaluate(()=>localStorage.getItem(rulesUI.key('tasks')+'.locks'));
 await panel.locator('.pena-automation-locked').first().getByRole('button',{name:'К диалогу',exact:true}).click();await panel.waitFor({state:'detached'});
 assert.deepEqual(await page.evaluate(()=>rulesUI.navigation),[{id:JSON.parse(locksBefore)[0],mode:'tasks'}]);
 assert.equal(await page.evaluate(()=>localStorage.getItem(rulesUI.key('tasks')+'.locks')),locksBefore);
 phases.push('Exceptions collapse by default, keep expansion across refresh, navigate without removing protection');

 await page.evaluate(()=>rulesUI.open());await review();assert.equal(await exceptions.getAttribute('aria-expanded'),'false');
 await page.evaluate(()=>{const key=rulesUI.key('tasks'),config=JSON.parse(localStorage.getItem(key));config.rules[0].name='Из другого окна';localStorage.setItem(key,JSON.stringify(config));});
 await auto.click();await panel.getByRole('status').filter({hasText:'Правила изменились в другом окне'}).waitFor();
 assert.equal(await auto.isChecked(),true);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(rulesUI.key('tasks'))).rules[0].name),'Из другого окна');
 await page.emulateMedia({reducedMotion:'reduce'});await exceptions.click();
 assert.equal(await panel.locator('.pena-automation-exclusions-content').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await page.screenshot({path:'tests/artifacts/rules-settings-exceptions.png'});
 await page.setViewportSize({width:360,height:640});
 await page.screenshot({path:'tests/artifacts/rules-settings-exceptions-mobile.png'});
 await page.setViewportSize({width:1100,height:850});
 await editor();await panel.getByRole('button',{name:'Развернуть правило',exact:true}).click();
 await page.screenshot({path:'tests/artifacts/rules-settings-required.png'});
 await page.setViewportSize({width:360,height:640});
 const row=panel.locator('.pena-automation-condition').first();
 assert.equal(await row.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
 await required.scrollIntoViewIfNeeded();await page.screenshot({path:'tests/artifacts/rules-settings-required-mobile.png'});
 phases.push('External changes block immediate toggle; reduced motion and narrow condition row stay usable');
 assert.deepEqual(errors,[]);
 writeFileSync('tests/artifacts/rules-settings-ui.json',JSON.stringify({passed:true,phases,accordionMotion,navigation:'UI calls the existing navigation helper; helper is stubbed in this isolated test'},null,2));
 console.log('PASS rules settings UI: '+phases.length+' phases');
}finally{await browser.close();await server.close();}

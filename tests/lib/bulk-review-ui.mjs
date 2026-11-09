import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

export async function verifyBulkReview({browser,server,source}){
 const results=[];
 const injected=source.replace('\tasync function boot() {',`\tasync function boot() {
  const realFacts=_dialogAutomationFacts;
  _dialogAutomationFacts=item=>window.bulkFacts?.[item.id]||realFacts(item);
  window.bulkUI={items:_getDialogControlItemsForMode,save:_saveDialogControlItemsForMode,key:_dialogAutomationKey,open:_openDialogAutomation,user:_acceptCurrentBitrixUserId};`);
 for(const mode of ['chats','tasks']){
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/extension/injected.js',r=>r.fulfill({contentType:'application/javascript',body:injected}));
  try{
   await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=${mode}&nativeCatalog=1&passThrough=1`);
   await page.waitForFunction(mode=>window.bulkUI?.items(mode).filter(i=>i.type!=='folder').length>=4,mode);
   await page.evaluate(mode=>{
    window.bulkMode=mode;const items=bulkUI.items(mode),chosen=items.filter(i=>i.type!=='folder').slice(0,4);
    window.bulkIds=chosen.map(i=>i.id);window.bulkFacts={};
    items.push({id:'folder:bulk-a',type:'folder',title:'Исходная'},{id:'folder:bulk-b',type:'folder',title:'Команда'},{id:'folder:bulk-c',type:'folder',title:'Команда'});
    chosen.forEach((item,index)=>{item.folderId='folder:bulk-a';bulkFacts[item.id]={title:`BULK_${index<2?'B':'C'} ${index+1}`};});
    bulkUI.save(mode,items);
    localStorage.setItem(bulkUI.key(mode),JSON.stringify({version:1,excludedIds:[],rules:['B','C'].map(letter=>({id:'bulk:'+letter,name:letter,enabled:true,folderId:'folder:bulk-'+letter.toLowerCase(),match:'all',conditions:[{field:'title',op:'contains',value:'BULK_'+letter}]}))}));
    bulkUI.open();
   },mode);
   const panel=page.getByRole('dialog',{name:'Автосортировка',exact:true});
   await panel.getByRole('tab',{name:'Пересортировка',exact:true}).click();
   const cards=panel.locator('.pena-automation-ticket:not(.pena-automation-locked)');
   await page.waitForFunction(()=>document.querySelectorAll('.pena-automation-ticket:not(.pena-automation-locked)').length===4);
   const all=panel.getByRole('checkbox',{name:'Выбрать всё',exact:true});
   await cards.first().getByRole('button',{name:'Выбрать похожие',exact:true}).click();
   assert.equal(await panel.locator('.pena-automation-ticket.--selected').count(),2,'Same labels in different folder IDs are not similar');
   assert.equal(await all.evaluate(el=>el.indeterminate),true);
   await page.screenshot({path:`tests/artifacts/bulk-review-${mode}.png`});
   // A harmless live refresh preserves the chosen proposal identities.
   await page.evaluate(()=>document.dispatchEvent(new Event('pena-automation-review-changed')));
   assert.equal(await panel.locator('.pena-automation-ticket.--selected').count(),2);
   await panel.getByRole('button',{name:'Подтвердить выбранные',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('.pena-automation-tickets[aria-busy]'));
   assert.deepEqual(await page.evaluate(()=>bulkIds.map(id=>bulkUI.items(bulkMode).find(i=>i.id===id).folderId)),['folder:bulk-b','folder:bulk-b','folder:bulk-a','folder:bulk-a']);
   assert.equal(await cards.count(),2);
   await all.check();assert.equal(await panel.getByRole('button',{name:'Подтвердить всё',exact:true}).isEnabled(),true);
   await all.uncheck();assert.equal(await panel.getByRole('button',{name:'Добавить в исключения',exact:true}).isDisabled(),true);
   await all.check();await panel.getByRole('button',{name:'Добавить в исключения',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('.pena-automation-tickets[aria-busy]'));
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem(bulkUI.key(bulkMode)+'.locks'))),await page.evaluate(()=>bulkIds.slice(2)));
   assert.deepEqual(await page.evaluate(()=>bulkIds.slice(2).map(id=>bulkUI.items(bulkMode).find(i=>i.id===id).folderId)),['folder:bulk-a','folder:bulk-a']);
   assert.equal(await cards.count(),0);
   // The rotation center stays fixed throughout a real animation, including reversal.
   const motion=await page.evaluate(async()=>{
    const toggle=document.querySelector('.pena-automation-exclusions-toggle'),svg=toggle.querySelector('svg'),samples=[];
    toggle.click();for(let i=0;i<20;i++){await new Promise(requestAnimationFrame);const r=svg.getBoundingClientRect();samples.push([r.x+r.width/2,r.y+r.height/2]);if(i===5)toggle.click();}
    return {samples,origin:getComputedStyle(svg).transformOrigin};
   });
   assert.equal(motion.origin,'10px 10px');
   for(const [x,y] of motion.samples){assert.ok(Math.abs(x-motion.samples[0][0])<.5);assert.ok(Math.abs(y-motion.samples[0][1])<.5);}
   await page.setViewportSize({width:360,height:640});
   assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   await page.screenshot({path:`tests/artifacts/bulk-review-${mode}-mobile.png`});
   await page.setViewportSize({width:1100,height:850});
   await panel.getByRole('button',{name:'Закрыть',exact:true}).click();
   // Recreate two proposals, select them, then change one target before acting.
   await page.evaluate(()=>{
    const key=bulkUI.key(bulkMode);localStorage.removeItem(key+'.locks');localStorage.removeItem(key+'.review');
    const items=bulkUI.items(bulkMode);bulkIds.forEach(id=>{items.find(i=>i.id===id).folderId='folder:bulk-a';});bulkUI.save(bulkMode,items);bulkUI.open();
   });
   await panel.getByRole('tab',{name:'Пересортировка',exact:true}).click();await all.check();
   await page.evaluate(()=>{bulkFacts[bulkIds[0]]={title:'BULK_C changed'};document.dispatchEvent(new Event('pena-automation-facts-changed'));});
   await page.waitForFunction(()=>document.querySelectorAll('.pena-automation-ticket.--selected').length===3);
   assert.equal(await all.evaluate(el=>el.indeterminate),true);
   // Select only the changed proposal and then change it again without a refresh.
   await all.check();await all.uncheck();await cards.first().locator('.pena-automation-ticket-heading input').check();
   await page.evaluate(()=>{bulkFacts[bulkIds[0]]={title:'No longer matches'};});
   await panel.getByRole('button',{name:'Подтвердить выбранные',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('.pena-automation-tickets[aria-busy]'));
   assert.equal(await page.evaluate(()=>bulkUI.items(bulkMode).find(i=>i.id===bulkIds[0]).folderId),'folder:bulk-a');
   await all.check();
   const beforeFailure=await page.evaluate(()=>bulkIds.map(id=>bulkUI.items(bulkMode).find(i=>i.id===id).folderId));
   for(const failedKey of ['review','items']){
    await page.evaluate(failedKey=>{
     window.bulkRealSet=Storage.prototype.setItem;
     Storage.prototype.setItem=function(key,value){if(failedKey==='review'?key===bulkUI.key(bulkMode)+'.review':key==='pena.dialogControl.v1.'+bulkMode)throw new DOMException('QA quota','QuotaExceededError');return bulkRealSet.call(this,key,value);};
    },failedKey);
    await panel.getByRole('button',{name:'Подтвердить всё',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.pena-automation-tickets[aria-busy]'));
    assert.deepEqual(await page.evaluate(()=>bulkIds.map(id=>bulkUI.items(bulkMode).find(i=>i.id===id).folderId)),beforeFailure,failedKey+' failure cannot move selected items');
    await page.evaluate(()=>{Storage.prototype.setItem=bulkRealSet;});
   }
   await panel.getByRole('button',{name:'Подтвердить всё',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('.pena-automation-tickets[aria-busy]'));
   assert.equal(await cards.count(),0);
   const auto=panel.getByRole('checkbox',{name:'Автоматически подтверждать переносы',exact:true});
   await auto.click();await page.getByRole('alertdialog').waitFor();
   await page.evaluate(()=>{const key=bulkUI.key(bulkMode),config=JSON.parse(localStorage.getItem(key));config.rules[0].folderId='folder:bulk-c';localStorage.setItem(key,JSON.stringify(config));});
   await page.getByRole('alertdialog').getByRole('button',{name:'Включить и перенести',exact:true}).click();
   assert.equal(await auto.isChecked(),false,'Confirmation cannot silently enable externally changed rules');
   await all.check();
   const scoped=await page.evaluate(()=>({key:bulkUI.key(bulkMode),review:localStorage.getItem(bulkUI.key(bulkMode)+'.review')}));
   await page.evaluate(()=>{
    [...document.querySelectorAll('.pena-automation-bulk button')].find(b=>b.textContent==='Подтвердить всё').click();
    window.currentBitrixUserId='8';bulkUI.user('8');
   });
   await page.waitForFunction(()=>!document.querySelector('.pena-automation-tickets[aria-busy]'));
   assert.equal(await page.evaluate(key=>localStorage.getItem(key+'.review'),scoped.key),scoped.review,'Identity change stops the queued batch before any decision');
   assert.deepEqual(errors,[]);results.push({mode,passed:true,cases:['similar folder IDs','partial confirmation','select all','bulk exclusions without moves','refresh preservation','changed proposal resets selection','stale action rejected','confirm all','fixed SVG pivot','mobile layout','journal quota','placement quota','external config confirmation','identity switch during batch']});
  }finally{await page.close();}
 }
 writeFileSync('tests/artifacts/bulk-review-ui.json',JSON.stringify({passed:true,results},null,2));
 console.log('PASS bulk review UI: both modes, 28 checks');
}

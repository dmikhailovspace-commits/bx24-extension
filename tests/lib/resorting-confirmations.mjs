import assert from 'node:assert/strict';

// Real integration and controls, isolated synthetic portal and local storage.
export async function verifyResorting(browser, server, source) {
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const probe=source.replace('\tasync function boot() {',`\tasync function boot() {
 window.resortAudit={apply:_applyDialogAutomation,open:_openDialogAutomation,key:_dialogAutomationKey,items:_getDialogControlItemsForMode,save:_saveDialogControlItemsForMode,facts:_dialogAutomationFacts};`);
 try {
  await page.route('**/extension/injected.js',route=>route.fulfill({contentType:'application/javascript',body:probe}));
  await page.route('**/tests/native-consistency-harness.html?*',async route=>{
   const response=await route.fetch();const html=(await response.text()).replace('localStorage.setItem(`pena.dialogControl.v1.${storageMode}`, JSON.stringify(items));','if(!localStorage.getItem(`pena.dialogControl.v1.${storageMode}`)) localStorage.setItem(`pena.dialogControl.v1.${storageMode}`, JSON.stringify(items));');
   await route.fulfill({response,body:html});
  });
  const url=server.baseUrl+'/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1';
  await page.goto(url);await page.locator('.recent-host .pena-native-folder-switcher').waitFor();
  await page.waitForFunction(()=>window.__PENA_RECENT_SYNC__?.gateReady);
  await page.evaluate(()=>{
   const api=resortAudit,items=api.items('chats'),item=items.find(item=>item.id==='chat5');
   items.push({id:'folder:manual',type:'folder',title:'Вручную',segmentId:'group:manual'},
    {id:'folder:rule',type:'folder',title:'По правилу',segmentId:'group:rule'});
   item.folderId='folder:manual';item.segmentId='group:manual';api.save('chats',items);
   const rules=[{id:'audit-rule',name:'Проверка ручного размещения',enabled:true,folderId:'folder:rule',match:'all',conditions:[{field:'title',op:'eq',value:api.facts(item).title}]}];
   localStorage.setItem(api.key('chats'),JSON.stringify({version:1,rules,excludedIds:['chat5']}));
   // Existing 8.0.62 baseline already knows the matching destination. It must
   // become a confirmation without editing rules or waiting for a new Pull.
   localStorage.setItem(api.key('chats')+'.review',JSON.stringify({rulesSig:JSON.stringify(rules),records:{chat5:{factsSig:JSON.stringify({title:api.facts(item).title}),target:'folder:rule',placement:'folder:manual'}}}));
   api.apply('chats',items);
  });
  const placement=()=>page.evaluate(()=>resortAudit.items('chats').find(item=>item.id==='chat5').folderId);
  const pending=()=>page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem(resortAudit.key('chats')+'.review')||'{}').records||{}).filter(record=>record.ticket).length);
  assert.equal(await placement(),'folder:manual');assert.equal(await pending(),1,'An existing manual conflict must enter review on the first scan');
  await page.evaluate(()=>resortAudit.open());
  assert.equal(await page.getByRole('tab',{name:'Пересортировка',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByText('Вручную → По правилу',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  assert.equal(await pending(),1,'Closing without a decision keeps the proposal');assert.equal(await placement(),'folder:manual');
  await page.evaluate(()=>resortAudit.open());
  await page.getByRole('button',{name:'Пропустить',exact:true}).click();
  assert.equal(await pending(),0);assert.equal(await placement(),'folder:manual');
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.reload();await page.locator('.recent-host .pena-native-folder-switcher').waitFor();
  await page.evaluate(()=>resortAudit.apply('chats',resortAudit.items('chats')));
  assert.equal(await pending(),0,'A skipped proposal stays closed after reload');assert.equal(await placement(),'folder:manual');
  // Rule changes create a new proposal; rule saves must not erase a permanent
  // exception later in this test.
  await page.evaluate(()=>resortAudit.open());
  await page.getByRole('tab',{name:'Правила',exact:true}).click();
  await page.getByLabel('Название правила').fill('Новое название тех же условий');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.locator('.pena-automation-panel').waitFor({state:'detached',timeout:15000});
  await page.evaluate(()=>resortAudit.apply('chats',resortAudit.items('chats')));
  assert.equal(await pending(),0,'Renaming or saving the same conditions must not reopen a skipped proposal');
  await page.evaluate(()=>{const key=resortAudit.key('chats'),config=JSON.parse(localStorage.getItem(key));config.rules[0].conditions[0].op='contains';localStorage.setItem(key,JSON.stringify(config));resortAudit.open();});
  await page.getByRole('button',{name:'Подтвердить перенос',exact:true}).waitFor();
  await page.getByLabel('Больше не предлагать переносы для этого диалога').check();
  assert.equal(await page.getByRole('button',{name:'Подтвердить перенос',exact:true}).isEnabled(),false);
  await page.setViewportSize({width:360,height:780});
  assert.equal(await page.locator('.pena-automation-panel').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:'tests/artifacts/resorting-confirmations-mobile.png'});
  await page.getByRole('button',{name:'Оставить и больше не предлагать',exact:true}).click();
  assert.equal(await pending(),0);assert.equal(await placement(),'folder:manual');
  await page.getByRole('button',{name:'Снова предлагать переносы',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Правила',exact:true}).click();
  await page.getByLabel('Название правила').fill('Изменённое правило после исключения');
  await page.getByLabel('Оператор',{exact:true}).selectOption('starts');
  await page.getByLabel('Распределить уже существующие диалоги').check();
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await page.locator('.pena-automation-panel').waitFor({state:'detached',timeout:15000});
  await page.reload();await page.locator('.recent-host .pena-native-folder-switcher').waitFor();
  await page.evaluate(()=>{resortAudit.apply('chats',resortAudit.items('chats'));resortAudit.open();});
  await page.getByRole('tab',{name:'Пересортировка',exact:true}).click();
  assert.equal(await pending(),0,'Permanent exception survives saving rules and reload');assert.equal(await placement(),'folder:manual');
  await page.getByRole('button',{name:'Снова предлагать переносы',exact:true}).click();
  assert.equal(await pending(),1);assert.equal(await placement(),'folder:manual','Unlocking only proposes; it cannot move');
  await page.evaluate(()=>{
   const accept=[...document.querySelectorAll('.pena-automation-ticket button')].find(button=>button.textContent==='Подтвердить перенос');
   const key=resortAudit.key('chats'),config=JSON.parse(localStorage.getItem(key));config.rules[0].conditions[0].op='contains';localStorage.setItem(key,JSON.stringify(config));accept.click();
  });
  assert.equal(await placement(),'folder:manual','A stale accept cannot approve changed rules even with the same destination');
  // A stale accept must not override a newer manual move.
  await page.evaluate(()=>{
   const accept=[...document.querySelectorAll('.pena-automation-ticket button')].find(button=>button.textContent==='Подтвердить перенос');
   const items=resortAudit.items('chats');items.find(item=>item.id==='chat5').folderId='folder:test';resortAudit.save('chats',items);accept.click();
  });
  assert.equal(await placement(),'folder:test');
  await page.getByText('Тестовая папка → По правилу',{exact:true}).waitFor();
  await page.setViewportSize({width:1100,height:800});
  await page.screenshot({path:'tests/artifacts/resorting-confirmations-desktop.png'});
  await page.getByRole('button',{name:'Подтвердить перенос',exact:true}).click();
  assert.equal(await placement(),'folder:rule');assert.equal(await pending(),0);
  assert.equal(await page.evaluate(()=>resortAudit.items('chats').find(item=>item.id==='chat5').segmentId),'group:rule');
  assert.deepEqual(errors,[]);
 } finally {await page.close();}
}

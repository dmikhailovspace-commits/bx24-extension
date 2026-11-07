import assert from 'node:assert/strict';

export async function openTransferSettings(page) {
 if(!await page.locator('.pena-native-filter-panel').isVisible())await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 const settings=page.locator('.pena-settings-section');
 if(!await settings.evaluate(el=>el.open))await settings.locator(':scope > summary').click();
 const advanced=settings.locator('details');
 if(!await advanced.evaluate(el=>el.open))await advanced.locator('summary').click();
 await settings.getByRole('button',{name:'Перенос настроек',exact:true}).click();
}

export async function checkTransferCode(page, platform) {
 const panel=page.getByRole('dialog',{name:'Перенос настроек',exact:true});
 const status=panel.getByRole('status'),confirm=panel.getByRole('button',{name:'Подтвердить импорт'});
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied');}}}));
 await panel.getByRole('button',{name:'Скопировать код'}).click();
 await status.filter({hasText:'Код выделен'}).waitFor();
 const code=await panel.getByLabel('Код экспорта').inputValue(),snapshot=JSON.parse(code);
 assert.ok(snapshot.modes.chats.items.length>0);
 assert.equal(await panel.getByLabel('Код экспорта').evaluate(el=>el.selectionEnd-el.selectionStart),code.length,'Copy fallback selects the whole code');
 await panel.getByText('Вставить код вместо файла',{exact:true}).click();
 const input=panel.getByLabel('Код импорта'),check=panel.getByRole('button',{name:'Проверить код'});
 const file=panel.getByLabel('Файл настроек');
 await file.setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.alloc(10*1024*1024+1,32)});
 await status.filter({hasText:'Файл слишком большой'}).waitFor();assert.equal(await confirm.isDisabled(),true);
 assert.equal(await file.inputValue(),'','Rejected file can be selected again after correction');
 await page.evaluate(()=>{window.originalFileText=File.prototype.text;File.prototype.text=function(){return new Promise((resolve,reject)=>{window.finishFileRead=()=>reject(Error('Late file failure'));});};});
 await file.setInputFiles({name:'slow.json',mimeType:'application/json',buffer:Buffer.from(code)});
 await page.waitForFunction(()=>typeof window.finishFileRead==='function');
 await input.fill(code);await check.click();await status.filter({hasText:'Папок:'}).waitFor();
 await page.evaluate(async()=>{File.prototype.text=originalFileText;finishFileRead();await new Promise(resolve=>requestAnimationFrame(resolve));});
 assert.equal(await confirm.isEnabled(),true,'Late failed file read cannot replace a newer validated code');
 assert.match(await status.innerText(),/Папок:/);
 await input.fill('{broken');await check.click();await status.filter({hasText:'Не удалось прочитать'}).waitFor();assert.equal(await confirm.isDisabled(),true);
 await input.fill(JSON.stringify({...snapshot,scope:'foreign.test~999'}));await check.click();await status.filter({hasText:'другого портала'}).waitFor();assert.equal(await confirm.isDisabled(),true);
 await input.fill('\uFEFF'+code);await check.click();await status.filter({hasText:'Папок:'}).waitFor();assert.equal(await confirm.isEnabled(),true,'BOM-prefixed portable code is accepted');
 await input.fill(code+' ');assert.equal(await confirm.isDisabled(),true,'Editing invalidates the pending confirmation');
 await check.click();
 await page.evaluate(()=>{const key='pena.dialogControl.v1.chats',items=JSON.parse(localStorage.getItem(key));items[0].title+=' changed';localStorage.setItem(key,JSON.stringify(items));window.dispatchEvent(new StorageEvent('storage',{key}));});
 await confirm.click();await status.filter({hasText:'Настройки изменились'}).waitFor();assert.equal(await confirm.isDisabled(),true);
 await check.click();await confirm.click();await status.filter({hasText:'Настройки перенесены'}).waitFor();
 await panel.getByRole('button',{name:'Скопировать код'}).click();await status.filter({hasText:'Код выделен'}).waitFor();
 assert.deepEqual(JSON.parse(await panel.getByLabel('Код экспорта').inputValue()).modes.chats.automation.rules,snapshot.modes.chats.automation.rules);
 // The UI must remain usable without downloads or clipboard in the desktop host.
 for (const viewport of [{width:1100,height:800},{width:360,height:640},{width:640,height:400},{width:360,height:320}]) {
  await page.setViewportSize(viewport);
  const box=await panel.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,`${platform} dialog stays in viewport`);
  assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'No horizontal overflow');
  const body=panel.locator('.pena-transfer-body');
  assert.equal(await body.evaluate(el=>el.clientHeight>=64),true,'Expanded settings retain a usable scrolling area');
  assert.equal(await body.evaluate(el=>{const sections=[...el.querySelectorAll('.pena-transfer-section')];return sections.every((s,i)=>!i||s.getBoundingClientRect().top>=sections[i-1].getBoundingClientRect().bottom);}),true,'Expanded sections never overlap');
  // Reach both ends using the wheel, rather than letting Playwright hide clipping by scrolling ancestors.
  await body.hover({position:{x:5,y:20}});await page.mouse.wheel(0,-3000);
  await page.waitForFunction(()=>document.querySelector('.pena-transfer-body').scrollTop===0);
  assert.equal(await panel.getByText('Папки, правила и распределение диалогов между приложением и Chrome. Только для того же портала и пользователя Bitrix24.',{exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+10,r.y+8));}),true,'First content is reachable');
  await page.mouse.wheel(0,3000);
  await page.waitForFunction(()=>{const el=document.querySelector('.pena-transfer-body');return el.scrollTop+el.clientHeight>=el.scrollHeight-2;});
  assert.equal(await check.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Last import control is reachable by scrolling');
  const button=panel.getByRole('button',{name:'Отменить последний импорт'});await button.scrollIntoViewIfNeeded();
  assert.equal(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Footer actions are not covered');
  await page.screenshot({path:`tests/artifacts/settings-${platform}-${viewport.width}.png`});
 }
 await page.setViewportSize({width:1280,height:800});
 await panel.getByRole('button',{name:'Закрыть',exact:true}).click();
 await openTransferSettings(page);
 await panel.getByRole('button',{name:'Отменить последний импорт'}).click();
 await page.getByRole('button',{name:'Восстановить',exact:true}).click();await status.filter({hasText:'Настройки восстановлены'}).waitFor();
 await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
}

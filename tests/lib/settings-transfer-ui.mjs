import assert from 'node:assert/strict';

export async function settleTransferMotion(panel) {
 await panel.evaluate(async el=>{
  const root=el.closest('.pena-sorting-transfer')||el;
  await Promise.all(root.getAnimations({subtree:true}).filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));
 });
}

export async function openTransferSettings(page) {
 if(!await page.locator('.pena-native-filter-panel').isVisible())await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 const settings=page.locator('.pena-settings-section');
 if(!await settings.evaluate(el=>el.open))await settings.locator(':scope > summary').click();
 assert.equal(await settings.locator('details').count(),0,'Transfer is directly inside Settings, without another accordion');
 await settings.getByRole('button',{name:'Перенос настроек',exact:true}).click();
}

export async function checkDeferredExport(panel) {
 const field=panel.getByLabel('Код экспорта');
 assert.equal(await field.inputValue(),'','Opening settings does not generate a code');
 assert.equal(await field.isVisible(),true);
 assert.equal(await panel.getByRole('button',{name:'Скопировать код',exact:true}).isDisabled(),true);
 assert.ok((await field.boundingBox()).height<=48,'Empty export begins with a compact single line');
 const download=await panel.getByRole('button',{name:'Скачать файл',exact:true}).boundingBox(),build=await panel.getByRole('button',{name:'Собрать код',exact:true}).boundingBox();
 assert.ok(download.y<build.y||download.x<build.x,'Download precedes Build code');
}

export async function buildAndCheckExport(panel) {
 const field=panel.getByLabel('Код экспорта');
 if(!await field.inputValue())await panel.getByRole('button',{name:'Собрать код',exact:true}).click();
 await panel.getByRole('button',{name:'Скопировать код',exact:true,disabled:false}).waitFor();
 assert.equal(await field.isVisible(),true,'Built export code is visible');
 assert.equal(await field.evaluate(el=>!!el.closest('details')),false,'Export code is not hidden inside an accordion');
 const preview=await field.inputValue();let code=preview;
 if(await field.getAttribute('data-preview')==='true'){
  assert.ok(preview.length<=8000,'Large codes are bounded previews rather than megabytes of DOM text');
  assert.equal(await panel.getByText('Фрагмент кода · копируется полностью',{exact:true}).isVisible(),true,'Truncation is explicitly explained');
  code=await field.evaluate(el=>{const clipboard=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:clipboard}));return clipboard.getData('text/plain');});
  assert.ok(code.length>preview.length,'Manual Ctrl+C fallback exports the whole code, not the displayed prefix');
 }
 const snapshot=JSON.parse(code);
 assert.equal(snapshot.format,'bx24-chat-sorter');
 assert.ok(snapshot.modes.chats.items.length>0,'The first displayed export contains current ordinary chats');
 const copy=panel.getByRole('button',{name:'Скопировать код',exact:true});
 const fieldBox=await field.boundingBox(),copyBox=await copy.boundingBox();
 assert.ok(copyBox.y>=fieldBox.y+fieldBox.height,'Copy action is below the code');
 return {code,snapshot};
}

async function stableRects(panel){return panel.evaluate(el=>[el,el.querySelector('.pena-transfer-header'),el.querySelector('.pena-transfer-footer'),el.querySelector('.pena-transfer-primary')].map(x=>{const r=x.getBoundingClientRect();return [r.x,r.y,r.width,r.height];}));}
function assertStable(before,after,label){before.forEach((r,i)=>r.forEach((v,j)=>assert.ok(Math.abs(v-after[i][j])<=1,`${label}: panel/header/footer/actions do not jump`)));}

export async function checkTransferCode(page, platform) {
 const panel=page.getByRole('dialog',{name:'Перенос настроек',exact:true});
 const status=panel.getByRole('status'),confirm=panel.getByRole('button',{name:'Подтвердить импорт'});
 await checkDeferredExport(panel);
 const {code,snapshot}=await buildAndCheckExport(panel);
 await settleTransferMotion(panel);
 const anchors=await stableRects(panel);
 await page.screenshot({path:`tests/artifacts/settings-${platform}-initial.png`});
 await page.evaluate(()=>{window.transferCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.transferCopied.push(text);}}});});
 await panel.getByRole('button',{name:'Скопировать код',exact:true}).click();
 await panel.getByRole('button',{name:'Скопировано',exact:true}).waitFor();
 await settleTransferMotion(panel);
 assertStable(anchors,await stableRects(panel),'Copy confirmation');
 await page.screenshot({path:`tests/artifacts/settings-${platform}-copied.png`});
 assert.equal(await page.evaluate(()=>window.transferCopied.at(-1)),code,'Copy writes the displayed code, not a newly generated surprise');
 await panel.getByRole('button',{name:'Скопировать код',exact:true}).waitFor();
 await panel.getByRole('button',{name:'Скопировать код',exact:true}).click();
 await panel.getByRole('button',{name:'Скопировано',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.transferCopied.length),2,'Copy can be repeated after feedback resets');
 await panel.getByRole('button',{name:'Скопировать код',exact:true}).waitFor();
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied');}}}));
 await panel.getByRole('button',{name:'Скопировать код'}).click();
 await status.filter({hasText:'Код выделен'}).waitFor();
 assertStable(anchors,await stableRects(panel),'Clipboard error');
 assert.equal(await panel.getByRole('button',{name:'Скопировано',exact:true}).count(),0,'Clipboard denial never reports copied');
 assert.equal(await panel.getByLabel('Код экспорта').evaluate(el=>el.selectionEnd-el.selectionStart===el.value.length),true,'Copy fallback selects the displayed preview');
 assert.equal(await panel.getByLabel('Код экспорта').evaluate(el=>{const clipboard=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:clipboard}));return clipboard.getData('text/plain');}),code,'Manual copy transfers the full code even when only a preview is displayed');
 await panel.getByText('Вставить код вместо файла',{exact:true}).click();
 assertStable(anchors,await stableRects(panel),'Expanded import');
 const input=panel.getByLabel('Код импорта'),check=panel.getByRole('button',{name:'Проверить код'});
 await input.fill('one line');const oneLine=(await input.boundingBox()).height;
 await input.fill(Array.from({length:30},(_,i)=>`line ${i}`).join('\n'));
 assert.ok((await input.boundingBox()).height>oneLine&&(await input.boundingBox()).height<=160,'Import textarea grows with lines and stops at 160px');
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
 await check.click();await status.filter({hasText:'Папок:'}).waitFor();
 await page.evaluate(()=>{const key='pena.dialogControl.v1.chats',items=JSON.parse(localStorage.getItem(key));items[0].title+=' changed';const raw=JSON.stringify(items);localStorage.setItem(key,raw);window.dispatchEvent(new StorageEvent('storage',{key,newValue:raw}));});
 await confirm.click();await status.filter({hasText:'Настройки изменились'}).waitFor();assert.equal(await confirm.isDisabled(),true);
 await check.click();await confirm.click();await status.filter({hasText:'Настройки перенесены'}).waitFor();
 assert.equal(await panel.getByLabel('Код экспорта').inputValue(),'','Import invalidates the previous export instead of rebuilding automatically');
 const rebuilt=await buildAndCheckExport(panel);
 await panel.getByRole('button',{name:'Скопировать код'}).click();await status.filter({hasText:'Код выделен'}).waitFor();
 assert.deepEqual(rebuilt.snapshot.modes.chats.automation.rules,snapshot.modes.chats.automation.rules);
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
  assert.equal(await panel.getByRole('heading',{name:'Сохранить настройки',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+10,r.y+8));}),true,'First content is reachable');
  await page.mouse.wheel(0,3000);
  await page.waitForFunction(()=>{const el=document.querySelector('.pena-transfer-body');return el.scrollTop+el.clientHeight>=el.scrollHeight-2;});
  assert.equal(await check.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Last import control is reachable by scrolling');
  const button=panel.getByRole('button',{name:'Отменить последний импорт'});await button.scrollIntoViewIfNeeded();
  assert.equal(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'Footer actions are not covered');
  await settleTransferMotion(panel);
  await page.screenshot({path:`tests/artifacts/settings-${platform}-${viewport.width}x${viewport.height}.png`});
 }
 await page.setViewportSize({width:1280,height:800});
 await panel.getByRole('button',{name:'Закрыть',exact:true}).click();
 await openTransferSettings(page);
 await checkDeferredExport(panel);
 await panel.getByRole('button',{name:'Отменить последний импорт'}).click();
 await page.getByRole('button',{name:'Восстановить',exact:true}).click();await status.filter({hasText:'Настройки восстановлены'}).waitFor();
 assert.equal(await panel.getByLabel('Код экспорта').inputValue(),'','Undo leaves export idle until explicitly rebuilt');
 await buildAndCheckExport(panel);
 await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
}

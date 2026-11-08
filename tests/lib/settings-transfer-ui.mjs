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
 assert.equal(await field.isVisible(),false,'An unbuilt code field does not reserve space');
 const copy=panel.locator('.pena-transfer-copy');
 assert.equal(await copy.isVisible(),false,'Copy appears only after a code is ready');
 assert.equal(await copy.isDisabled(),true);
 assert.equal(await panel.locator('.pena-transfer-progress').isVisible(),false,'Idle progress does not reserve space');
 assert.equal(await panel.locator('[role=status]').isVisible(),false,'Empty status does not reserve space');
 await settleTransferMotion(panel);
 const layout=await panel.evaluate(el=>{const sections=el.querySelectorAll('.pena-transfer-section'),row=sections[0].querySelector('.pena-transfer-actions'),r=el.getBoundingClientRect();return {height:r.height,desktop:innerWidth>=700&&innerHeight>=600,betweenSections:sections[1].getBoundingClientRect().top-row.getBoundingClientRect().bottom};});
 if(layout.desktop)assert.ok(layout.height<=480,'Idle dialog is compact rather than a mostly empty fixed-height panel');
 assert.ok(layout.betweenSections<=40,'No reserved code/progress gap between save and load sections');
 const download=await panel.getByRole('button',{name:'Скачать файл',exact:true}).boundingBox(),build=await panel.getByRole('button',{name:'Собрать код',exact:true}).boundingBox();
 assert.ok(download.y<build.y||download.x<build.x,'Download precedes Build code');
 const buttonStyles=await panel.evaluate(el=>['.pena-transfer-download','.pena-transfer-build'].map(selector=>{const style=getComputedStyle(el.querySelector(selector));return Object.fromEntries(['backgroundColor','color','borderColor','borderWidth','borderRadius','padding','height','minWidth','fontWeight'].map(key=>[key,style[key]]));}));
 assert.deepEqual(buttonStyles[0],buttonStyles[1],'Download and Build have the same visual treatment');
 assert.equal(await panel.locator('.pena-transfer-section').nth(1).locator(':scope > p').count(),0,'Import has no explanatory paragraph');
 assert.equal(await panel.locator('.pena-transfer-section').nth(1).evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth)),0,'Save and load sections have no middle divider');
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
 await settleTransferMotion(panel);
 const fieldBox=await field.boundingBox(),copyBox=await copy.boundingBox();
 assert.ok(copyBox.y>=fieldBox.y+fieldBox.height,'Copy action is below the code');
 return {code,snapshot};
}

async function stableRects(panel){return panel.evaluate(el=>[el,el.querySelector('.pena-transfer-header'),el.querySelector('.pena-transfer-footer'),el.querySelector('.pena-transfer-primary')].map(x=>{const r=x.getBoundingClientRect();return [r.x,r.width];}));}
function assertStable(before,after,label){before.forEach((r,i)=>r.forEach((v,j)=>assert.ok(Math.abs(v-after[i][j])<=1,`${label}: horizontal alignment and widths remain stable while height follows content`)));}


async function checkPressedButtonGeometry(page,panel) {
 // Suppress the release click only: pointer hover/down/up remain real browser
 // input, while Confirm/Undo/Close cannot mutate or dismiss this fixture.
 await panel.evaluate(el=>{window.__transferPressBlock=event=>{if(el.contains(event.target)) {event.preventDefault();event.stopImmediatePropagation();}};document.addEventListener('click',window.__transferPressBlock,true);});
 try {
  const buttons=panel.locator('button');
  for(let i=0;i<await buttons.count();i++){
   const button=buttons.nth(i);if(!await button.isVisible())continue;
   await button.scrollIntoViewIfNeeded();await button.hover();await settleTransferMotion(panel);
   const before={button:await button.boundingBox(),panel:await panel.boundingBox()};
   await page.mouse.down();await page.waitForTimeout(120);
   const held={button:await button.boundingBox(),panel:await panel.boundingBox()};
   await page.mouse.up();await settleTransferMotion(panel);
   const after={button:await button.boundingBox(),panel:await panel.boundingBox()};
   for(const [phase,positions] of [['held',held],['released',after]])for(const key of ['button','panel'])for(const axis of ['x','y','width','height']){
    assert.ok(Math.abs(before[key][axis]-positions[key][axis])<0.5,`${await button.textContent()}: ${key}.${axis} does not jump while ${phase}`);
   }
  }
 } finally {
  await page.mouse.up();await page.evaluate(()=>{document.removeEventListener('click',window.__transferPressBlock,true);delete window.__transferPressBlock;});
 }
}

export async function checkQuietCachedAction(panel,selector) {
 await settleTransferMotion(panel);
 const result=await panel.evaluate(async(el,selector)=>{
  const rect=()=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];};
  const before=rect(),frames=[];let busy=false,progress=false,animated=false;
  const sample=()=>{
   frames.push(rect());busy ||= el.dataset.exportState==='building';
   const bar=el.querySelector('.pena-transfer-progress progress');progress ||= !!bar&&getComputedStyle(bar).display!=='none'&&bar.getBoundingClientRect().height>0;
   animated ||= el.getAnimations({subtree:true}).some(a=>(a.playState==='running'||a.pending)&&a.effect.getKeyframes().some(frame=>'height' in frame||'opacity' in frame));
  };
  const observer=new MutationObserver(sample);observer.observe(el,{subtree:true,attributes:true,childList:true});
  try {
   el.querySelector(selector).click();sample();
   await new Promise(resolve=>{const started=performance.now();const next=()=>{sample();if(performance.now()-started>=260)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next);});
  } finally {observer.disconnect();}
  return {before,frames,busy,progress,animated};
 },selector);
 assert.equal(result.busy,false,'Cached action never re-enters building state');
 assert.equal(result.progress,false,'Cached action never flashes progress');
 assert.equal(result.animated,false,'Cached action never replays height/fade animations');
 result.frames.forEach(rect=>rect.forEach((value,index)=>assert.ok(Math.abs(value-result.before[index])<0.5,'Cached action preserves panel geometry throughout')));
}

async function checkPendingCopy(page,panel) {
 await page.evaluate(()=>{window.__pendingCopyCalls=0;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>{window.__pendingCopyCalls++;return new Promise(resolve=>window.__finishPendingCopy=resolve);}}});});
 const result=await panel.evaluate(async el=>{
  const button=el.querySelector('.pena-transfer-copy'),opacity=getComputedStyle(button).opacity;
  let disabled=false,flashed=false;const sample=()=>{disabled ||= button.disabled;flashed ||= getComputedStyle(button).opacity!==opacity;};
  const observer=new MutationObserver(sample);observer.observe(button,{attributes:true});
  try {
   button.click();button.click();sample();
   await new Promise(resolve=>{const started=performance.now();const next=()=>{sample();if(performance.now()-started>=150)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next);});
   window.__finishPendingCopy();await new Promise(resolve=>requestAnimationFrame(resolve));sample();
  } finally {observer.disconnect();}
  return {disabled,flashed,calls:window.__pendingCopyCalls};
 });
 assert.deepEqual(result,{disabled:false,flashed:false,calls:1},'Pending copy guards repeated clicks without disabled/opacity flashing');
 await panel.getByRole('button',{name:'Скопировано',exact:true}).waitFor();
 await panel.getByRole('button',{name:'Скопировать код',exact:true}).waitFor();
}

async function checkPanelMotion(page,panel,reduced){
 await settleTransferMotion(panel);
 const result=await panel.evaluate(async el=>{
  const heights=[el.getBoundingClientRect().height];let sawHeight=false,sawFade=false,settled=0;
  el.querySelector('.pena-transfer-build').click();
  const started=performance.now();
  await new Promise((resolve,reject)=>{
   const sample=()=>{
    heights.push(el.getBoundingClientRect().height);
    const animations=el.getAnimations({subtree:true}).filter(a=>a.playState==='running'||a.pending);
    sawHeight ||= animations.some(a=>a.effect.getKeyframes().some(frame=>'height' in frame));
    sawFade ||= animations.some(a=>a.effect.target?.matches?.('.pena-transfer-export-code')&&a.effect.getKeyframes().some(frame=>'opacity' in frame));
    settled=el.dataset.exportState==='ready'&&!animations.length?settled+1:0;
    if(settled>=2)return resolve();
    if(performance.now()-started>5000)return reject(Error('Transfer animation or export never settled'));
    requestAnimationFrame(sample);
   };requestAnimationFrame(sample);
  });
  return {heights,sawHeight,sawFade,inlineHeight:el.style.height,activeAnimations:el.getAnimations({subtree:true}).filter(a=>a.playState==='running'||a.pending).length};
 });
 assert.equal(result.activeAnimations,0,'Panel does not retain running animations after completion');
 assert.ok(['','auto'].includes(result.inlineHeight),'Completed height animation restores natural layout');
 if(reduced){assert.equal(result.sawHeight,false,'Reduced motion skips height animation');assert.equal(result.sawFade,false,'Reduced motion skips code fade');}
 else{
  assert.equal(result.sawHeight,true,'Build animates the actual panel height');
  assert.equal(result.sawFade,true,'Built code fades into view');
  const first=result.heights[0],last=result.heights.at(-1);
  assert.ok(last>first+20,'Building expands the compact panel');
  assert.ok(result.heights.some(height=>height>first+2&&height<last-2),'Animation renders intermediate heights, not just the endpoints');
 }
 return result;
}

export async function checkTransferCode(page, platform) {
 const panel=page.getByRole('dialog',{name:'Перенос настроек',exact:true});
 const status=panel.getByRole('status'),confirm=panel.getByRole('button',{name:'Подтвердить импорт'});
 await checkDeferredExport(panel);
 await page.screenshot({path:`tests/artifacts/settings-${platform}-idle.png`});
 const downloaded=page.waitForEvent('download');
 await panel.getByRole('button',{name:'Скачать файл',exact:true}).click();await downloaded;
 assert.equal(await panel.getByLabel('Код экспорта').isVisible(),false,'Download leaves the code field hidden');
 assert.equal(await panel.locator('.pena-transfer-copy').isVisible(),false,'Download does not reveal Copy');
 assert.equal(await panel.locator('.pena-transfer-progress').isVisible(),false,'Finished download removes its progress area');
 const {code,snapshot}=await buildAndCheckExport(panel);
 await settleTransferMotion(panel);
 const anchors=await stableRects(panel);
 await page.screenshot({path:`tests/artifacts/settings-${platform}-initial.png`});
 await page.evaluate(()=>{window.transferCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.transferCopied.push(text);}}});});
 const previousStatus=await panel.locator('[role=status]').textContent();
 await panel.getByRole('button',{name:'Скопировать код',exact:true}).click();
 await panel.getByRole('button',{name:'Скопировано',exact:true}).waitFor();
 await settleTransferMotion(panel);
 assertStable(anchors,await stableRects(panel),'Copy confirmation');
 assert.equal(await panel.locator('[role=status]').textContent(),previousStatus,'Copy success uses button feedback and preserves the existing footer');
 assert.equal(await panel.getByText('Код скопирован.',{exact:true}).count(),0,'No duplicate copy-success message');
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
 const validatedStatus=await status.innerText();
 await checkPressedButtonGeometry(page,panel);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}}));
 await panel.getByRole('button',{name:'Скопировать код',exact:true}).click();await panel.getByRole('button',{name:'Скопировано',exact:true}).waitFor();
 assert.equal(await status.innerText(),validatedStatus,'Copy success preserves the validated import summary');
 assert.equal(await confirm.isEnabled(),true,'Copy does not discard a staged import');
 await panel.getByRole('button',{name:'Скопировать код',exact:true}).waitFor();
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied');}}}));
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
 await page.setViewportSize({width:360,height:640});await settleTransferMotion(panel);
 await page.screenshot({path:`tests/artifacts/settings-${platform}-idle-360.png`});
 await buildAndCheckExport(panel);await settleTransferMotion(panel);
 await page.screenshot({path:`tests/artifacts/settings-${platform}-ready-360.png`});
 await page.setViewportSize({width:1280,height:800});
 await panel.getByRole('button',{name:'Отменить последний импорт'}).click();
 await page.getByRole('button',{name:'Восстановить',exact:true}).click();await status.filter({hasText:'Настройки восстановлены'}).waitFor();
 assert.equal(await panel.getByLabel('Код экспорта').inputValue(),'','Undo leaves export idle until explicitly rebuilt');
 await buildAndCheckExport(panel);
 await page.keyboard.press('Escape');assert.equal(await panel.count(),0);
 // Check real intermediate geometry independently of Playwright's action
 // stability waits, which would otherwise skip the animation under test.
 await openTransferSettings(page);await checkPanelMotion(page,panel,false);
 await page.keyboard.press('Escape');
 await page.emulateMedia({reducedMotion:'reduce'});
 await openTransferSettings(page);await checkPanelMotion(page,panel,true);
 await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'no-preference'});
 await openTransferSettings(page);
 const cleanup=await panel.evaluate(async el=>{
  el.querySelector('.pena-transfer-build').click();el.querySelector('.pena-transfer-close').click();
  await new Promise(resolve=>setTimeout(resolve,300));
  return {connected:el.isConnected,animations:el.getAnimations({subtree:true}).filter(a=>a.playState==='running'||a.pending).length};
 });
 assert.deepEqual(cleanup,{connected:false,animations:0},'Closing during rebuild cancels animations and removes the dialog');
 await openTransferSettings(page);await buildAndCheckExport(panel);await settleTransferMotion(panel);
 assert.ok(['','auto'].includes(await panel.evaluate(el=>el.style.height)),'Rapid reopen/build does not retain a frozen height');
 await checkPressedButtonGeometry(page,panel);
 await checkQuietCachedAction(panel,'.pena-transfer-build');
 const cachedDownload=page.waitForEvent('download');await checkQuietCachedAction(panel,'.pena-transfer-download');await cachedDownload;
 await checkPendingCopy(page,panel);
 await page.keyboard.press('Escape');
}

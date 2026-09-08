import assert from 'node:assert/strict';
import {createReadStream, mkdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname, join, normalize} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// CSS geometry and native checkbox semantics only. Project persistence and
// API filtering are covered by the application integration suites.
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const root=normalize(join(fileURLToPath(new URL('.',import.meta.url)),'..'));
const artifacts=join(root,'tests/artifacts');
mkdirSync(artifacts,{recursive:true});
const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/></svg>';
const option=(name,index)=>`<label class="pena-native-time-project-option"><input type="checkbox" ${index<2?'checked':''}><span class="pena-native-time-project-name">${name}</span></label>`;
const names=['Все задачи без проекта','PENA — сайт и клиентская поддержка','Разработка приложения Битрикс24','Очень длинное название проекта — сопровождение команды и работа с документацией','Сверхдлинноеназваниебезпробелов'.repeat(5)];
const markup=`<!doctype html><html lang="ru"><meta charset="utf-8"><link rel="stylesheet" href="/extension/injected.css"><body>
<dialog class="pena-native-time-modal"><div class="pena-native-time-backdrop"></div><section class="pena-native-time-panel pena-native-command-popover --project-settings" tabindex="-1">
<header class="pena-native-time-panel-head"><strong class="pena-native-time-panel-title">Учёт времени</strong><div class="pena-native-time-view-tabs"><button class="pena-native-time-view-tab">День</button><button class="pena-native-time-view-tab">7 дней</button></div><div class="pena-native-time-header-actions"><button class="pena-native-time-project-button" aria-label="Выбрать проекты" aria-expanded="true">${icon}<span>Проекты</span></button><button class="pena-native-popover-close" aria-label="Закрыть"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div></header>
<div class="pena-native-time-scroll"><section class="pena-native-time-project-settings"><h2 class="pena-native-time-project-title">Выберите проекты</h2><p class="pena-native-time-project-description">Учитывайте время только по нужным проектам. Выбор можно изменить позже.</p><input class="pena-native-time-project-search" type="search" aria-label="Поиск проектов" placeholder="Название проекта"><label class="pena-native-time-project-all"><input type="checkbox"><span class="pena-native-time-project-name">Выбрать все</span></label><p class="pena-native-time-project-status" role="status" hidden></p><div class="pena-native-time-project-list">${names.map(option).join('')}</div><footer class="pena-native-time-project-footer"><button class="pena-native-time-project-cancel">Отмена</button><button class="pena-native-time-project-save">Сохранить</button></footer></section><div class="pena-native-time-summary">Обычная сводка</div><div class="pena-native-time-body">Обычная форма</div></div></section></dialog><script>document.querySelector('dialog').showModal()</script>`;
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/fixture'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'}).end(markup);return;}
 const path=normalize(join(root,pathname));
 if(!path.startsWith(root)){res.writeHead(403).end();return;}
 const stream=createReadStream(path);stream.on('error',()=>res.writeHead(404).end());
 res.writeHead(200,{'content-type':({'.css':'text/css','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});stream.pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const report=[];
try{
 await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
 await page.evaluate(()=>document.fonts.ready);
 const panel=page.locator('.pena-native-time-panel');
 const check=page.locator('.pena-native-time-project-option input').first();
 await check.uncheck();assert.equal(await check.isChecked(),false);
 await check.focus();await check.press('Space');assert.equal(await check.isChecked(),true);
 for(const viewport of [{width:1280,height:900},{width:720,height:768},{width:360,height:760},{width:1280,height:500}]){
  await page.setViewportSize(viewport);await page.mouse.move(1,1);
  await page.waitForTimeout(180);
  const layout=await panel.evaluate(node=>{
   const box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
   const scroll=node.querySelector('.pena-native-time-scroll');
   const option=node.querySelector('.pena-native-time-project-option');
   const checkbox=option.querySelector('input');
   return{panel:box(node),scroll:box(scroll),section:box(scroll.querySelector('.pena-native-time-project-settings')),scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,
    hiddenNormal:[...scroll.children].filter(n=>!n.classList.contains('pena-native-time-project-settings')).every(n=>getComputedStyle(n).display==='none'),
    tabsHidden:getComputedStyle(node.querySelector('.pena-native-time-view-tabs')).display==='none',
    checkbox:box(checkbox),option:box(option),
    scrollOwners:[...node.querySelectorAll('*')].filter(n=>n.getClientRects().length&&/^(auto|scroll)$/.test(getComputedStyle(n).overflowY)).map(n=>n.className)};
  });
  assert.equal(layout.panel.width,viewport.width<=680?Math.min(520,viewport.width-16):Math.min(640,viewport.width-32));
  assert(layout.panel.height>0&&layout.panel.height<=(viewport.width<=680?viewport.height-16:Math.min(720,viewport.height-32)));
  if(layout.scrollHeight<=layout.clientHeight)assert(layout.panel.bottom-layout.section.bottom<=(viewport.width<=680?9:17),'Settings leave a blank lower region');
  assert.ok(layout.panel.x>=8&&layout.panel.y>=8&&layout.panel.right<=viewport.width-8&&layout.panel.bottom<=viewport.height-8);
  assert.ok(layout.scrollWidth<=layout.clientWidth+1,'Project names caused horizontal overflow');
  assert.equal(layout.hiddenNormal,true);assert.equal(layout.tabsHidden,true);
  assert.deepEqual(layout.scrollOwners,['pena-native-time-scroll'],'Project list introduced a nested scrollbar');
  assert.equal(layout.checkbox.width,16);assert.equal(layout.checkbox.height,16);
  assert.ok(Math.abs(layout.checkbox.y+8-(layout.option.y+layout.option.height/2))<1,'Checkbox is not vertically centered');
  if(viewport.width===1280&&viewport.height===900||viewport.width===360){
   await page.locator('.pena-native-time-scroll').evaluate(n=>n.scrollTop=0);
   await page.screenshot({path:join(artifacts,`time-project-layout-${viewport.width}.png`)});
  }
  await page.locator('.pena-native-time-project-save').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.pena-native-time-project-save').evaluate(n=>{const r=n.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===n;}),true,'Save button cannot be reached through the outer scroll');
  report.push({viewport,status:'PASS',layout});
 }
 await page.locator('.pena-native-time-project-list').evaluate((list,names)=>{for(let i=0;i<80;i++){const label=list.firstElementChild.cloneNode(true);label.querySelector('span').textContent=`Проект ${i} — ${names[1]}`;list.append(label);}},names);
 const large=await panel.evaluate(n=>{const r=n.getBoundingClientRect(),s=n.querySelector('.pena-native-time-scroll');return{height:r.height,scrollHeight:s.scrollHeight,clientHeight:s.clientHeight};});assert.equal(large.height,468);assert(large.scrollHeight>large.clientHeight);
 await page.locator('.pena-native-time-project-save').scrollIntoViewIfNeeded();
 assert.equal(await page.locator('.pena-native-time-project-save').isVisible(),true);
 await page.locator('.pena-native-time-project-status').evaluate(n=>{n.hidden=false;n.classList.add('--error');n.textContent='Не удалось загрузить проекты. Повторите попытку.';});
 await page.locator('.pena-native-time-project-status').scrollIntoViewIfNeeded();
 assert.match(await page.locator('.pena-native-time-project-status').innerText(),/Не удалось/);
 await panel.evaluate(n=>{n.classList.remove('--project-settings');n.querySelector('.pena-native-time-project-settings').hidden=true;});
 assert.equal(await page.locator('.pena-native-time-project-settings').isVisible(),false);
 assert.equal(await page.locator('.pena-native-time-summary').isVisible(),true);
 const main=await panel.boundingBox();assert.equal(main.width,960);assert.equal(main.height,468);
 writeFileSync(join(artifacts,'time-project-layout-report.json'),JSON.stringify({cases:report,nativeCheckboxKeyboard:true,largeListReachable:true},null,2));
 console.log(`PASS project layout: ${report.length} viewports, native checkbox keyboard, single scroll owner, large list and mode visibility`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

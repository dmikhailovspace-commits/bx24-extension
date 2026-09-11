import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer, collectPageErrors} from './lib/harness-server.mjs';

const source = readFileSync(process.env.PENA_FOLDER_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
const anchor = '\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
const probe = `
 window.folderProbe = {
  prepare: _preparePenaSearchInput, apply: applyFilters,
  select: id => _setDialogControlNativeActiveFolderId(id),
  filter: _applyDialogControlRowFilter, state: _applyDialogControlNativeRowState,
  keys: _getDialogControlNativeRowIdentityKeys, matches: _matchesDialogControlNativeFilter,
  cached: _getCachedDialogControlElementMeta,
  index: buildChatElementIndex, live: _getDialogControlItemLiveMeta,
  syncTitle: _syncDialogControlItemTitleFromElement,
  merge: _mergeDialogRecentWithDomMeta,
  items: () => _getDialogControlItems(),
  item: row => _getDialogControlItemForNativeRow(row)
 };
`;
assert.ok(source.includes(anchor));
const server = await startHarnessServer(), browser = await chromium.launch({headless:true});
const report = {phases:[]};
async function scenario(name, run) {
 const page = await browser.newPage();
 const errors = collectPageErrors(page), started = performance.now();
 try {
  await page.route('**/extension/injected.js*', route => route.fulfill({contentType:'application/javascript', body:source.replace(anchor,anchor+probe)}));
  await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&activeFolder=1&skipInitialMount=1');
  await page.waitForFunction(() => {
   const folder=document.querySelector('.recent-host .pena-native-folder-tab[title="Тестовая папка"]');
   const foreign=document.querySelector('.recent-host [data-id="chat5"]');
   return window.folderProbe && folder?.classList.contains('--active') && foreign && getComputedStyle(foreign).display==='none';
  });
  await run(page);
  assert.deepEqual(errors, []);
  report.phases.push({name,status:'PASS',ms:performance.now()-started});
 } catch(error) { report.phases.push({name,status:'FAIL',error:String(error.stack),ms:performance.now()-started}); }
 finally { await page.close(); }
}
try {
 await scenario('replacing native search while a folder is active does not permanently hide other dialogs', async page => {
  const result = await page.evaluate(() => {
   const p=folderProbe, row=document.querySelector('.recent-host [data-id="chat5"]');
   p.apply(); const hidden=getComputedStyle(row).display;
   const input=document.querySelector('.recent-host input[type="search"]'), next=input.cloneNode(true);
   input.replaceWith(next); p.prepare(next); p.select(''); p.apply();
   return {hidden,display:getComputedStyle(row).display,original:row.dataset.penaNativeOriginalDisplay};
  });
  assert.equal(result.hidden,'none');
  assert.notEqual(result.display,'none',JSON.stringify(result));
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.recent-host [data-id="chat5"]').isVisible(),true);
 });
 await scenario('recycled rows keep the new folder filter through decoration in the same frame', async page => {
  const result=await page.evaluate(() => {
   const p=folderProbe, row=document.querySelector('.recent-host [data-id="chat225"]');
   const old=p.items().find(x=>x.id==='chat225'), next=p.items().find(x=>x.id==='chat5');
   p.state(row,old); row.setAttribute('data-id','chat5');
   p.filter(row,{folderId:'isolated',ids:new Set(['chat999999']),titles:new Set()});
   const before=getComputedStyle(row).display;
   p.state(row,next);
   return {before,after:getComputedStyle(row).display,filter:row.dataset.penaNativeFilterDisplay};
  });
  assert.equal(result.before,'none'); assert.equal(result.after,'none',JSON.stringify(result));
  assert.equal(result.filter,'none');
 });
 await scenario('old decoration identity cannot put an unknown recycled task in the previous folder', async page => {
  const result=await page.evaluate(() => {
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]');
   p.state(row,p.items().find(x=>x.id==='chat225'));
   row.setAttribute('data-id','chat987654');
   row.querySelector('.bx-im-chat-title__text').textContent='New unrelated task';
   return {keys:p.keys(row),matches:p.matches(row,{id:'chat987654'}, {folderId:'test',ids:new Set(['chat225']),titles:new Set()}),item:p.item(row)?.id||null};
  });
  assert.deepEqual(result.keys,['chat987654']); assert.equal(result.matches,false); assert.equal(result.item,null);
 });
 await scenario('DOM metadata cache follows the current dialog identity instead of the recycled node', async page => {
  const result=await page.evaluate(() => {
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]');
   const before=p.cached(row); row.setAttribute('data-id','chat987655');
   const after=p.cached(row);
   return {before:before.id,after:after.id};
  });
  assert.equal(result.before,'chat225'); assert.equal(result.after,'chat987655');
 });
 await scenario('cached row index cannot rename or transfer metadata to the previous task', async page => {
  const result=await page.evaluate(() => {
   const p=folderProbe,row=document.querySelector('.recent-host [data-id="chat225"]');
   const item={...p.items().find(x=>x.id==='chat225')}, index=p.index();
   row.setAttribute('data-id','chat987656');
   row.querySelector('.bx-im-chat-title__text').textContent='Unrelated recycled title';
   const live=p.live(item,index); p.syncTitle(item,index);
   return {liveId:live?.id||null,title:item.title};
  });
  assert.notEqual(result.liveId,'chat987656'); assert.notEqual(result.title,'Unrelated recycled title');
 });
} finally {
 await browser.close(); await server.close();
 report.status=report.phases.every(p=>p.status==='PASS')?'PASS':'FAIL';
 mkdirSync('tests/artifacts',{recursive:true});
 writeFileSync(process.env.PENA_FOLDER_REPORT || 'tests/artifacts/native-folder-visibility-regression.json',JSON.stringify(report,null,2)+'\n');
 for(const phase of report.phases) console.log(phase.status+' '+phase.name+(phase.error?'\n'+phase.error:''));
}
assert.equal(report.status,'PASS');

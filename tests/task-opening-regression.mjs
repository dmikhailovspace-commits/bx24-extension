import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';

const server=await startHarnessServer(), browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:440,height:760}}), errors=collectPageErrors(page), phases=[];
const source=readFileSync(process.env.PENA_NAVIGATION_SOURCE || new URL('../extension/injected.js',import.meta.url),'utf8').replace(
 '\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;',
 `\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;
 window.navigationProbe={id:getChatIdFromElement,raw:_getRawDialogControlIdFromElement,task:_extractTaskMetaFromElement,open:_openTaskForDialogControlItem};`);
await page.route('**/extension/injected.js*',r=>r.fulfill({status:200,contentType:'application/javascript',body:source}));
await page.route('**/tests/recent-sync-harness.html*',r=>{
 const html=readFileSync(new URL('./recent-sync-harness.html',import.meta.url),'utf8').replace('row.dataset.id = entry.dialog_id;',
 `row.dataset.id = entry.dialog_id;
 if (entry.dialog_id === 'chat9001') { row.dataset.dialogId='chat9001'; row.dataset.entityId='7001'; row.dataset.entityType='TASKS'; }`);
 return r.fulfill({status:200,contentType:'text/html',body:html});
});
try {
 await page.goto(server.baseUrl+'/tests/recent-sync-harness.html?taskview=1&apicase=1');
 await page.waitForFunction(()=>window.navigationProbe);
 const ids=await page.evaluate(()=>{
  const row=document.createElement('div');row.dataset.id='chat9001';row.dataset.dialogId='chat9001';row.dataset.entityId='7001';row.dataset.entityType='TASKS';
  const mixed={id:navigationProbe.id(row),raw:navigationProbe.raw(row),task:navigationProbe.task(row)?.taskId};
  row.removeAttribute('data-dialog-id'); const fallback=navigationProbe.id(row);
  row.removeAttribute('data-id');const noChat=navigationProbe.id(row);
  row.dataset.entityType='CHAT';row.textContent='Campaign #123456';const notTask=navigationProbe.task(row);
  row.removeAttribute('data-entity-type');row.removeAttribute('data-entity-id');const captionOnly=navigationProbe.task(row);
  return {mixed,fallback,noChat,notTask,captionOnly};
 });
 assert.deepEqual(ids,{mixed:{id:'chat9001',raw:'chat9001',task:'7001'},fallback:'chat9001',noChat:'',notTask:null,captionOnly:null});
 phases.push('task 7001 and chat 9001 stay distinct; arbitrary caption numbers cannot become task IDs');
 await page.locator('.pena-native-remote-row[data-id="chat9001"]').waitFor({state:'visible',timeout:10000});
 await page.evaluate(()=>{BX.Messenger.Public.openChat=id=>{throw Error('Unsupported task openChat '+id);};});
 await page.locator('.pena-native-remote-row[data-id="chat9001"]').click();
 await page.waitForFunction(()=>__recentHarness.nativeOpens().length===1);
 assert.deepEqual(await page.evaluate(()=>({native:__recentHarness.nativeOpens(),side:__recentHarness.sidePanelOpens()})),{native:['chat9001'],side:[]});
 phases.push('real managed-row click reaches exact native task handler once, without incompatible public API');
 await page.evaluate(()=>navigationProbe.open({id:'chat9001',taskId:'123456',taskUrl:'/company/personal/user/101/tasks/task/view/123456/'}));
 const opened=await page.evaluate(()=>__recentHarness.sidePanelOpens());
 assert.equal(opened.length,1);assert.match(opened[0],/\/tasks\/task\/view\/7001\//);
 phases.push('stale saved task URL cannot override confirmed task-chat association');
 await page.evaluate(()=>{
  const link=document.createElement('a');link.href='/company/personal/user/101/tasks/task/view/7001/';link.id='native-task-link';link.textContent='Open native task';
  window.nativeLinkClicks=0;link.addEventListener('click',event=>{event.preventDefault();window.nativeLinkClicks++;});document.body.append(link);
 });
 await page.locator('#native-task-link').click();assert.equal(await page.evaluate(()=>nativeLinkClicks),1);
 phases.push('ordinary task link keeps its native click handler');
 assert.deepEqual(errors,[]);
} finally {
 writeFileSync(new URL('./artifacts/task-opening-regression.json',import.meta.url),JSON.stringify({phases,errors,liveBitrix:false},null,2));
 await browser.close();await server.close();
}
console.log('PASS task opening: distinct IDs, native routing, stale saved URL, native links');

import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer,collectPageErrors} from './lib/harness-server.mjs';
const raw=readFileSync(new URL('../extension/injected.js',import.meta.url),'utf8');
assert.ok(!raw.includes('_createDialogTodoModal')&&!raw.includes('pena-native-todo-button'));
assert.ok(!readFileSync(new URL('../extension/injected.css',import.meta.url),'utf8').includes('.pena-native-todo-'));
const anchor='\tconst _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
const source=raw.replace(anchor,`${anchor}
 window.removalProbe={sync:()=>_syncDialogTimeUi(_dialogControlNativeSwitcherNode),tracker:()=>_readDialogTimeTracker({fresh:true}),
 seed:()=>_writeDialogTimeTracker({taskId:'101',title:'Старый таймер дела',todoId:'legacy-todo',dialogId:'chat101',startedAt:Date.now()-65000,dateKey:_getDialogTimeTodayKey(),pendingSeconds:0,error:''})};`);
const server=await startHarnessServer(),browser=await chromium.launch({headless:true});
mkdirSync('tests/artifacts',{recursive:true});const phases=[];
try {
 for(const mode of ['chats','tasks']) {
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=collectPageErrors(page);
  await page.route('**/extension/injected.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
  await page.addInitScript(()=>{window.todoCalls=0;window.__PENA_DIALOG_REPOSITORY__={todoList:()=>{window.todoCalls++;throw new Error('Removed UI must not request todos');}};});
  await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode='+mode);
  await page.locator('.pena-native-rules-button').waitFor();
  await page.waitForFunction(()=>typeof removalProbe==='object');
  assert.equal(await page.locator('[data-pena-workspace-tab="todo"],.pena-native-todo-modal,.pena-native-todo-button').count(),0);
  await page.getByRole('button',{name:'Правила',exact:true}).click();
  await page.locator('.pena-automation-panel').waitFor();
  await page.screenshot({path:`tests/artifacts/todo-removed-rules-${mode}.png`});
  await page.keyboard.press('Escape');
  await page.locator('.pena-automation-panel').waitFor({state:'detached'});
  await page.evaluate(()=>removalProbe.seed());await page.reload();
  await page.locator('.pena-native-time-button').waitFor();await page.locator('.pena-native-time-button').click();
  await page.locator('.pena-native-time-panel').waitFor();
  await page.waitForFunction(()=>removalProbe.tracker()?.todoId==='legacy-todo');
  await page.getByRole('button',{name:'Остановить',exact:true}).click();
  await page.waitForFunction(()=>!removalProbe.tracker());
  assert.equal(await page.evaluate(()=>timeAddedItems.length),1,'legacy timer saves once through time panel');
  assert.equal(await page.evaluate(()=>todoCalls),0);
  assert.equal(await page.locator('.pena-native-todo-modal').count(),0);
  assert.deepEqual(errors,[]);phases.push({mode,status:'PASS',legacyTimerSaved:true,rulesAvailable:true,todoRequests:0});await page.close();
 }
 console.log('PASS removed todo panel: both lists retain Rules and time; legacy timer saves once without todo reads');
} finally {writeFileSync('tests/artifacts/todo-panel-report.json',JSON.stringify({phases},null,2));await browser.close();await server.close();}

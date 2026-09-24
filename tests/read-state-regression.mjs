import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';
import { checkNativeMultiselect } from './lib/native-multiselect.mjs';

const source = readFileSync(process.env.PENA_READ_STATE_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
const extract = name => {
  const match = new RegExp(`\\n\\t(?:async )?function ${name}\\(`).exec(source);
  assert(match, `Missing integration function ${name}`);
  const start = match.index + 1;
  const next = /\n\t(?:async )?function /.exec(source.slice(start + 2));
  assert(next, `Missing function boundary after ${name}`);
  return source.slice(start, start + 2 + next.index);
};
const report = { runtimeSha256: createHash('sha256').update(source).digest('hex'), phases: [] };
const phase = async (name, run) => {
  const start = performance.now();
  try { const evidence = await run(); report.phases.push({ name, status: 'PASS', durationMs: performance.now() - start, evidence }); }
  catch (error) { report.phases.push({ name, status: 'FAIL', durationMs: performance.now() - start, error: String(error) }); throw error; }
};
const state = { unread: 80, later: true, calls: [], fail: '', failDialog: '', delay: 2, user: '7', mode: 'chats', lastId: 80, toasts: [] };
const metadata = new Map([['chat1', { id: 'chat1', unreadCount: 80, hasUnread: true, hasLater: true, lastMessageId: 80 }]]);
const scope = () => 'portal:' + state.user;
const context = vm.createContext({
  console, Promise, Map, Date, Number, Math, Object,
  location: { host: 'portal' }, filtersHost: null, _dialogRecentRepositoryReady: false,
  _dialogControlReadActions: new Map(), _dialogRecentMeta: metadata,
  _getDialogNativeSharedAuditScopeKey: scope, normId: id => String(id || ''),
  _pMode: () => state.mode,
  _getDialogControlRestDialogId: id => String(id || ''), _getDialogControlChatNumber: () => 1,
  _isDialogControlFolder: () => false, findChatElementById: () => null,
  _getDialogRecentMeta: id => metadata.get(id), _getCachedDialogControlElementMeta: () => null,
  _setDialogControlOptimisticRead() {}, _setDialogControlOptimisticLater() {},
  _invalidateDialogControlDomReadCache() {}, _applyDialogControlItemDomState() {},
  _showDialogDockToast(text) { state.toasts.push(text); }, _refreshDialogControlLaterState() {}, _scheduleDialogRecentCacheWrite() {},
  _waitDialogControlBitrixDomState: async () => true, _isDialogControlReadMeta() {},
  _callBxRestMethod: async (method, params, options = {}) => {
    if (options.isCurrent && !options.isCurrent()) throw new Error('SUPERSEDED');
    state.calls.push({ method, params: structuredClone(params) });
    await new Promise(resolve => setTimeout(resolve, state.delay));
    if (state.fail === method && (!state.failDialog || state.failDialog === params.DIALOG_ID)) throw new Error('NETWORK_TIMEOUT');
    if (method === 'im.dialog.read') {
      assert.deepEqual(Object.keys(params), ['DIALOG_ID'], 'Read all must not be limited to the visible last message');
      state.unread = 0;
      return { dialogId: params.DIALOG_ID, lastId: state.lastId, counter: 0 };
    }
    assert.equal(method, 'im.recent.unread', 'No speculative action fallbacks or global read-all');
    state.later = params.ACTION === 'Y';
    return true; // Removing the list reminder does not read message history.
  }
});
for (const name of ['_assertDialogControlRestSuccess', '_setDialogControlLaterFlag', '_setDialogControlReadFlag']) vm.runInContext(extract(name), context);
if (source.includes('function _clearDialogControlLaterFlag(')) vm.runInContext(extract('_clearDialogControlLaterFlag'), context);
let browser, server;
try {
  await phase('Read all 80 messages including messages outside the native DOM', async () => {
    const start = performance.now();
    await context._setDialogControlReadFlag('chat1', 1, 'chat1');
    assert.equal(state.unread, 0);
    assert.equal(state.later, false);
    assert.deepEqual(state.calls.map(call => call.method), ['im.dialog.read', 'im.recent.unread']);
    assert(performance.now() - start < 500, 'Acknowledged API success must not wait 3.2 seconds for DOM polling');
    return { unreadMessages: state.unread, requests: state.calls.length };
  });
  for (const name of ['_runDialogControlReadStateAction', '_markDialogControlItemRead', '_markDialogControlItemLater', '_clearDialogControlItemLater']) vm.runInContext(extract(name), context);
  const item = { id: 'chat1', title: 'Task chat' };
  await phase('Remove reminder preserves unread messages and counters', async () => {
    state.calls = []; state.unread = 9; state.later = true;
    Object.assign(metadata.get('chat1'), { unreadCount: 9, hasUnread: true, hasMention: true, hasLater: true });
    assert.equal(await context._clearDialogControlItemLater(item), true);
    assert.equal(state.unread, 9);
    assert.equal(metadata.get('chat1').unreadCount, 9);
    assert.equal(metadata.get('chat1').hasMention, true);
    assert.equal(metadata.get('chat1').hasLater, false);
    assert.ok(metadata.get('chat1').counterConfirmedAt > 0, 'Reminder acknowledgement must fence pending counter reads');
    assert.deepEqual(state.calls.map(call => call.method), ['im.recent.unread']);
  });
  await phase('Read executes even when the cached list already looks read', async () => {
    state.calls = []; state.unread = 75;
    Object.assign(metadata.get('chat1'), { unreadCount: 0, hasUnread: false, hasMention: false, hasLater: false });
    assert.equal(await context._markDialogControlItemRead(item), true);
    assert.equal(state.unread, 0);
    assert.equal(state.calls[0].method, 'im.dialog.read');
  });
  await phase('Double click coalesces; opposite reminder actions retain user order', async () => {
    state.calls = []; state.delay = 15;
    const first = context._markDialogControlItemLater(item);
    const duplicate = context._markDialogControlItemLater(item);
    assert.equal(first, duplicate);
    const second = context._clearDialogControlItemLater(item);
    const third = context._markDialogControlItemLater(item);
    await Promise.all([first, duplicate, second, third]);
    assert.deepEqual(state.calls.map(call => call.params.ACTION), ['Y', 'N', 'Y']);
    assert.equal(state.later, true);
    assert.equal(context._dialogControlReadActions.size, 0);
  });
  await phase('Failure does not clear messages, publish success or amplify requests', async () => {
    state.calls = []; state.unread = 7; state.fail = 'im.dialog.read';
    Object.assign(metadata.get('chat1'), { unreadCount: 7, hasUnread: true });
    assert.equal(await context._markDialogControlItemRead(item), false);
    assert.equal(state.unread, 7);
    assert.equal(metadata.get('chat1').unreadCount, 7);
    assert.equal(state.calls.length, 1);
    state.fail = '';
  });
  await phase('Incoming message after read boundary survives acknowledgement', async () => {
    state.calls = []; state.lastId = 80;
    const pending = context._markDialogControlItemRead(item);
    await new Promise(resolve => setTimeout(resolve, 5));
    Object.assign(metadata.get('chat1'), { lastMessageId: 81, unreadCount: 1, hasUnread: true, counterFetchedAt: Date.now() });
    await pending;
    assert.equal(metadata.get('chat1').unreadCount, 1);
    assert.equal(metadata.get('chat1').hasUnread, true);
  });
  await phase('Reminder failure preserves confirmed reading and reports partial success', async () => {
    state.calls = []; state.unread = 7; state.later = true; state.fail = 'im.recent.unread';
    Object.assign(metadata.get('chat1'), { lastMessageId: 80, unreadCount: 7, hasUnread: true, hasLater: true });
    assert.equal(await context._markDialogControlItemRead(item), true);
    assert.equal(state.unread, 0); assert.equal(state.later, true);
    assert.equal(metadata.get('chat1').unreadCount, 0); assert.equal(metadata.get('chat1').hasLater, true);
    assert.match(state.toasts.at(-1), /Сообщения прочитаны.*Не удалось снять/);
    assert.equal(state.calls.length, 2); state.fail = '';
    Object.assign(metadata.get('chat1'), { unreadCount: 1, hasUnread: true });
  });
  await phase('User switch fences the second request and local acknowledgement', async () => {
    state.calls = []; state.lastId = 81;
    const pending = context._markDialogControlItemRead(item);
    await new Promise(resolve => setTimeout(resolve, 5));
    state.user = '8';
    assert.equal(await pending, false);
    assert.equal(state.calls.length, 1);
    assert.equal(metadata.get('chat1').hasUnread, true);
  });
  await phase('REST queue treats message read and reminder changes as writes', async () => {
    const calls = [];
    context._dialogRestQueue = { run(method, key, run, options) { calls.push({ method, key }); assert.equal(options.isCurrent(), true); return run(); } };
    vm.runInContext(extract('_scheduleBxRest'), context);
    for (const method of ['im.dialog.read', 'im.dialog.unread', 'im.recent.unread', 'im.dialog.get']) {
      await context._scheduleBxRest(method, { DIALOG_ID: 'chat1' }, async () => true);
    }
    assert.deepEqual(calls.slice(0, 3).map(call => call.key), ['', '', '']);
    assert(calls[3].key.includes('im.dialog.get'), 'Only safe reads may coalesce');
  });
  vm.runInContext(extract('_runDialogControlSelectedReadStateAction'), context);
  const batchItems = ['chat1', 'chat2', 'chat3'].map(id => ({ id, title: id }));
  for (const id of ['chat2', 'chat3', 'chat4']) metadata.set(id, { id, unreadCount: 5, hasUnread: true, hasLater: true, lastMessageId: 80 });
  await phase('Bulk read targets every selected dialog once and preserves unselected dialogs', async () => {
    state.calls = []; state.toasts = []; state.user = '7'; state.lastId = 100;
    const result = await context._runDialogControlSelectedReadStateAction([...batchItems, batchItems[0]], null, 'read');
    assert.equal(result.completed, 3); assert.equal(result.total, 3);
    assert.deepEqual(state.calls.filter(call => call.method === 'im.dialog.read').map(call => call.params.DIALOG_ID), ['chat1','chat2','chat3']);
    assert.equal(metadata.get('chat4').unreadCount, 5);
    assert.equal(state.toasts.length, 1);
    assert.match(state.toasts[0], /3 из 3/);
  });
  await phase('Bulk reminder failure does not stop the remaining selected dialogs', async () => {
    state.calls = []; state.toasts = []; state.fail = 'im.recent.unread'; state.failDialog = 'chat2';
    const result = await context._runDialogControlSelectedReadStateAction(batchItems, null, 'later');
    assert.equal(result.completed, 2); assert.equal(result.total, 3);
    assert.deepEqual(state.calls.map(call => call.params.DIALOG_ID), ['chat1','chat2','chat3']);
    assert.equal(metadata.get('chat1').hasLater, true); assert.equal(metadata.get('chat2').hasLater, false); assert.equal(metadata.get('chat3').hasLater, true);
    assert.equal(state.toasts.length, 1); assert.match(state.toasts[0], /2 из 3/);
    state.fail = ''; state.failDialog = '';
  });
  await phase('Bulk read reports reminder failures without losing confirmed reads', async () => {
    state.calls = []; state.toasts = []; state.fail = 'im.recent.unread'; state.failDialog = 'chat1';
    const result = await context._runDialogControlSelectedReadStateAction(batchItems, null, 'read');
    assert.equal(result.completed, 3); assert.equal(result.partial, 1);
    assert.equal(metadata.get('chat1').unreadCount, 0); assert.equal(metadata.get('chat1').hasLater, true);
    assert.equal(state.toasts.length, 1); assert.match(state.toasts[0], /Не удалось снять отметку: 1/);
    state.fail = ''; state.failDialog = '';
  });
  for (const change of ['user', 'mode']) await phase(`Bulk action stops on ${change} change`, async () => {
    state.calls = []; state.toasts = []; state.delay = 20; state.user = '7'; state.mode = 'chats';
    const pending = context._runDialogControlSelectedReadStateAction(batchItems, null, 'read');
    await new Promise(resolve => setTimeout(resolve, 5));
    if (change === 'user') state.user = '8'; else state.mode = 'tasks';
    await pending;
    assert.equal(state.calls.length, 1, 'Queued dialogs must not cross the captured scope');
    assert.equal(state.toasts.length, 0);
    state.user = '7'; state.mode = 'chats'; state.delay = 2;
  });
  for (const mode of ['chats', 'tasks']) await phase(`Real ${mode} context menu applies read and reminder actions to Ctrl-selected dialogs`, async () => {
    server ||= await startHarnessServer(); browser ||= await chromium.launch({ headless: true });
    const page = await browser.newPage(); const errors = collectPageErrors(page);
    const anchor = '\tasync function boot() {';
    const exposed = source.replace(anchor, `${anchor}\nwindow.__READ_STATE_TEST__ = { pending: () => _dialogControlReadActions.size, meta: () => _getDialogRecentMeta('chat1'), setLater(value) { const meta = _getDialogRecentMeta('chat1'); Object.assign(meta, {hasLater:value,hasUnread:false,hasMention:false,unreadCount:0,counterFetchedAt:Date.now()}); _invalidateDialogControlDomReadCache(); } };`);
    await page.route('**/extension/injected.js', route => route.fulfill({ contentType: 'application/javascript', body: exposed }));
    await page.goto(`${server.baseUrl}/tests/native-preservation-harness.html?mode=${mode}`);
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.gateReady && document.querySelector('.pena-native-managed-row'));
    await page.evaluate(() => {
      window.__readWrites = [];
      const original = BX.rest.callMethod;
      BX.rest.callMethod = function(method, params, callback) {
        if (!['im.dialog.read', 'im.recent.unread'].includes(method)) return original.apply(this, arguments);
        window.__readWrites.push({ method, params });
        setTimeout(() => callback({ error: () => null, data: () => method === 'im.dialog.read' ? { lastId: 5000, counter: 0 } : true }), 1);
      };
    });
    const row = page.locator('.pena-native-managed-row[data-id="chat1"]');
    await page.evaluate(() => window.__READ_STATE_TEST__.setLater(true));
    await row.click({ button: 'right' });
    const menu = page.locator('.dialog-control-context-menu');
    await menu.waitFor({ state: 'visible' });
    assert.equal(await menu.getByRole('menuitem', { name: 'Оригинальное меню Bitrix24', exact: true }).count(), 1);
    assert.equal(await menu.getByRole('menuitem', { name: 'Снять отметку «прочитать позже»', exact: true }).count(), 1);
    assert.equal(await menu.getByRole('menuitem', { name: 'Прочитать позже', exact: true }).count(), 0);
    assert.equal(await menu.getByRole('menuitem', { name: 'Прочитано', exact: true }).count(), 1);
    await menu.getByRole('menuitem', { name: 'Снять отметку «прочитать позже»', exact: true }).click();
    await page.waitForFunction(() => !window.__READ_STATE_TEST__.pending() && window.__READ_STATE_TEST__.meta().hasLater === false);
    await row.click({ button: 'right' });
    assert.equal(await menu.getByRole('menuitem', { name: 'Прочитать позже', exact: true }).count(), 1);
    await menu.getByRole('menuitem', { name: 'Прочитать позже', exact: true }).click();
    await page.waitForFunction(() => !window.__READ_STATE_TEST__.pending() && window.__READ_STATE_TEST__.meta().hasLater === true);
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Прочитано', exact: true }).click();
    await page.waitForFunction(() => !window.__READ_STATE_TEST__.pending() && window.__readWrites.length === 4);
    assert.deepEqual(await page.evaluate(() => window.__readWrites), [
      { method: 'im.recent.unread', params: { DIALOG_ID: 'chat1', ACTION: 'N' } },
      { method: 'im.recent.unread', params: { DIALOG_ID: 'chat1', ACTION: 'Y' } },
      { method: 'im.dialog.read', params: { DIALOG_ID: 'chat1' } },
      { method: 'im.recent.unread', params: { DIALOG_ID: 'chat1', ACTION: 'N' } }
    ]);
    // Exercise actual Ctrl-click and context-menu dispatch, not just the batch helper.
    await row.click({ modifiers: ['Control'] });
    const second = page.locator('.pena-native-managed-row[data-id="chat2"]');
    await second.click({ modifiers: ['Control'] });
    await page.evaluate(() => { window.__readWrites = []; window.__READ_STATE_TEST__.setLater(true); });
    await row.click({ button: 'right' });
    assert.equal(await menu.getByRole('menuitem', { name: 'Оригинальное меню Bitrix24', exact: true }).count(), 0, 'Single-dialog native actions must not escape the multi-selection');
    await menu.getByRole('menuitem', { name: 'Прочитать позже', exact: true }).click();
    await page.waitForFunction(() => window.__readWrites.length === 2 && !window.__READ_STATE_TEST__.pending());
    assert.deepEqual(await page.evaluate(() => window.__readWrites.map(call => call.params)), [
      { DIALOG_ID: 'chat1', ACTION: 'Y' }, { DIALOG_ID: 'chat2', ACTION: 'Y' }
    ]);
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Снять отметку «прочитать позже»', exact: true }).click();
    await page.waitForFunction(() => window.__readWrites.length === 4 && !window.__READ_STATE_TEST__.pending());
    assert.deepEqual(await page.evaluate(() => window.__readWrites.slice(2).map(call => call.params)), [
      { DIALOG_ID: 'chat1', ACTION: 'N' }, { DIALOG_ID: 'chat2', ACTION: 'N' }
    ]);
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Прочитано', exact: true }).click();
    await page.waitForFunction(() => window.__readWrites.length === 8 && !window.__READ_STATE_TEST__.pending());
    assert.deepEqual(await page.evaluate(() => window.__readWrites.slice(4).filter(call => call.method === 'im.dialog.read').map(call => call.params.DIALOG_ID)), ['chat1','chat2']);
    const items = () => page.evaluate(mode => JSON.parse(localStorage.getItem(`pena.dialogControl.v1.${mode}`) || '[]'), mode);
    const selectedItems = async () => (await items()).filter(item => ['chat1','chat2'].includes(item.id));
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Marker', exact: true }).click();
    assert.ok((await selectedItems()).every(item => item.folderId === 'folder:marker'));
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Цветовой маркер', exact: true }).click();
    await page.locator('.dialog-control-palette.--open .dialog-control-palette-tool.--random').click();
    const colored = await selectedItems();
    assert.match(colored[0].color, /^#[a-f0-9]{6}$/); assert.equal(colored[0].color, colored[1].color);
    assert.equal((await items()).find(item => item.id === 'chat3').color || '', '');
    await page.keyboard.press('Escape');
    await row.click({ modifiers: ['Control'] }); await second.click({ modifiers: ['Control'] });
    await page.evaluate(mode => localStorage.setItem(`pena.dialogControlSegments.v1.${mode}`, JSON.stringify([{ id: 'segment:bulk', title: 'Bulk group' }])), mode);
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Bulk group', exact: true }).click();
    assert.ok((await selectedItems()).every(item => item.segmentId === 'segment:bulk'));
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Убрать из группы', exact: true }).click();
    assert.ok((await selectedItems()).every(item => !item.segmentId));
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Добавить в новую папку', exact: true }).click();
    await page.locator('.pena-native-confirm-input').fill('Bulk folder');
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    const folder = (await items()).find(item => item.title === 'Bulk folder');
    assert.ok(folder); assert.ok((await selectedItems()).every(item => item.folderId === folder.id));
    await row.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Без папки', exact: true }).click();
    assert.ok((await selectedItems()).every(item => !item.folderId));
    assert.deepEqual(errors, []);
    await page.close();
  });
  await phase('Pinned read tasks: one selection per physical gesture', () => checkNativeMultiselect(browser, server.baseUrl, source));
  console.log(`PASS read state: ${report.phases.length} functional phases`);
} finally {
  await browser?.close(); await server?.close();
  mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./artifacts/read-state-report.json', import.meta.url), JSON.stringify(report, null, 2));
}

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';

const raw = readFileSync(new URL('../extension/injected.js', import.meta.url), 'utf8');
const source = raw.replace('\tasync function boot() {', `\tasync function boot() {
  window.lazyAudit = {
    lazy: _isDialogNativeLazyMode, prefs: _getDialogControlViewPrefs,
    active: () => !!_dialogNativeFolderRun,
    folderId: _getDialogControlNativeActiveFolderId,
    assign: (id, folderId = 'folder:test') => { let item = _getDialogControlItems().find(item => item.id === id); if (!item) { item = {id, title:id}; _getDialogControlItems().push(item); } item.folderId = folderId; _saveDialogControlItems(); },
    addFolder: id => { _getDialogControlItems().push({id, type:'folder', title:id}); _saveDialogControlItems(); },
    items: _getDialogControlItems, meta: _getDialogRecentMeta,
    folder: id => _setDialogControlNativeActiveFolderId(id),
    apply: applyFilters, selected: () => [..._dialogControlMultiSelected],
    wake: () => _runDialogWakeReconcile('online-recovery', {tailProbe:true}),
    refresh: () => _refreshDialogRecentCatalog({full:true,force:true,reason:'manual'})
  };`);
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const report = { phases: [] };
try {
  for (const mode of ['chats', 'tasks']) {
    const page = await browser.newPage();
    const errors = collectPageErrors(page);
    try {
      await page.route('**/extension/injected.js', route => route.fulfill({ contentType: 'application/javascript', body: source }));
      await page.addInitScript(() => {
        for (const mode of ['chats', 'tasks']) localStorage.setItem(`pena.dialogControlView.${mode}`, JSON.stringify({ sortMode:'date',sortDirection:'asc',unreadOnly:false }));
      });
      await page.goto(`${server.baseUrl}/tests/native-consistency-harness.html?mode=${mode}&lazyNative=1&nativeCatalog=1&nativeFirst=1&passThrough=1&eager=0&lazy=1&lazyChunk=20&catalogRows=1000&pendingControl=0&nativeService=1`);
      const host = page.locator(mode === 'tasks' ? '.task-host' : '.recent-host');
      await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
      await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.gateReady);
      assert.equal(await page.evaluate(() => lazyAudit.lazy()), true, 'Exercise production, not compatibility loading');
      assert.equal(await page.evaluate(() => lazyAudit.prefs().sortDirection), 'desc', 'Migrate saved oldest-first preference');
      const scrollBefore = await page.evaluate(() => nativeScrollAudit.length);
      const idsBefore = await host.locator('.bx-im-list-recent-item__wrap').evaluateAll(rows => rows.map(row => row.dataset.id));
      assert(idsBefore.length < 100, 'Startup must retain a small native window');
      assert(!idsBefore.includes('chat9000'));
      assert.equal(await page.locator('.pena-native-original-load-guard,.pena-native-load-guard').count(), 0);
      assert.equal(await page.evaluate(() => nativeRestCalls.filter(call => call.method === 'im.recent.list').length), 0);

      await page.evaluate(() => { lazyAudit.assign('chat1025'); window.folderMembershipBefore = Object.fromEntries(lazyAudit.items().filter(item=>item.folderId).map(item=>[item.id,item.folderId])); window.original225 = document.querySelector('.test-host:not([hidden]) [data-id="chat225"]'); });
      await page.evaluate(() => { window.nativeServiceFailNext = true; });
      await page.evaluate(() => {
        window.folderPaintAudit = { frames: 0, leaks: [], running: true };
        const inspect = () => {
          const audit = window.folderPaintAudit;
          if (!audit.running) return;
          const folderId = lazyAudit.folderId();
          if (folderId) {
            audit.frames++;
            const members = new Set(lazyAudit.items().filter(item => item.folderId === folderId).map(item => item.id));
            const leaked = [...document.querySelectorAll('.test-host:not([hidden]) .bx-im-list-recent-item__wrap')]
              .filter(row => !members.has(row.dataset.id) && getComputedStyle(row).display !== 'none')
              .map(row => row.dataset.id);
            if (leaked.length && audit.leaks.length < 5) audit.leaks.push(leaked);
          }
          requestAnimationFrame(inspect);
        };
        requestAnimationFrame(inspect);
      });
      await page.locator('.pena-native-folder-tab[data-native-folder-id="folder:test"]').click();
      await page.locator('.pena-native-folder-status button').waitFor({state:'visible'});
      const failedCalls = await page.evaluate(() => nativeServiceCalls.length);
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => nativeServiceCalls.length), failedCalls, 'A failed request must not loop');
      await page.locator('.pena-native-folder-status button').click();
      const old = host.locator('.bx-im-list-recent-item__wrap[data-id="chat1025"]');
      await old.waitFor({ state:'visible' });
      await page.waitForFunction(() => !lazyAudit.active());
      const paintAudit = await page.evaluate(() => folderPaintAudit);
      assert(paintAudit.frames > 0, 'Observe actual frames during folder opening and pagination');
      assert.deepEqual(paintAudit.leaks, [], 'Foreign native rows must never be painted while a folder is active');
      assert.equal(await page.locator('.pena-native-managed-row,.pena-native-remote-row').count(), 0, 'Never substitute Bitrix rows');
      assert.equal(await page.evaluate(() => original225 === document.querySelector('.test-host:not([hidden]) [data-id="chat225"]')), true, 'Keep the original node and avatar');
      assert((await host.locator('.bx-im-list-recent-item__wrap').count()) < 100, 'Stop when requested rows are found');
      assert.equal(await host.locator('[class*="scroll-container"]').first().evaluate(el => el.scrollTop), 0, 'Restore scroll position');
      assert.equal(await page.locator('.pena-native-folder-tab[data-native-folder-id="folder:test"] .pena-native-tab-count').textContent(), '3', 'Folder view must not erase the unread count of its hidden native source');
      const details = await page.evaluate(() => nativeRestCalls.filter(call => call.method === 'im.dialog.get').map(call => call.dialogId));
      assert.deepEqual(details, [], 'Bitrix loads its own row data; no parallel detail fan-out');
      const recycled = await page.evaluate(async () => {
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const row = document.querySelector('.test-host:not([hidden]) [data-id="chat1025"]');
        const title = row.querySelector('.bx-im-chat-title__text');
        const savedTitle = title.textContent;
        row.dataset.id = 'chat800001';
        title.textContent = 'Recycled foreign dialog';
        await frame();
        const foreignHidden = getComputedStyle(row).display === 'none';
        row.dataset.id = 'chat1025';
        title.textContent = savedTitle;
        await frame();
        const memberVisible = getComputedStyle(row).display !== 'none';
        const foreign = document.querySelector('.test-host:not([hidden]) [data-id="chat1007"]');
        foreign.className = 'bx-im-list-recent-item__wrap'; // Vue replaces the native class binding.
        await frame();
        return { foreignHidden, memberVisible, reboundHidden: getComputedStyle(foreign).display === 'none' };
      });
      assert.deepEqual(recycled, { foreignHidden:true, memberVisible:true, reboundHidden:true });

      await page.evaluate(() => {
        lazyAudit.addFolder('folder:other');
        lazyAudit.assign('chat1007', 'folder:other');
        lazyAudit.assign('chat1100');
        window.nativeServiceDelay = 250;
        window.callsBeforeSwitch = nativeServiceCalls.length;
        lazyAudit.apply();
      });
      await page.waitForFunction(() => nativeServiceCalls.length > callsBeforeSwitch);
      await page.locator('.pena-native-folder-tab[data-native-folder-id="folder:other"]').click();
      await page.waitForFunction(() => !lazyAudit.active());
      await page.waitForTimeout(350); // The previous folder's in-flight page has arrived.
      await host.locator('[data-id="chat1007"]').waitFor({state:'visible'});
      const switchedAudit = await page.evaluate(() => {
        folderPaintAudit.running = false;
        window.nativeServiceDelay = 70;
        window.folderMembershipBefore = Object.fromEntries(lazyAudit.items().filter(item=>item.folderId).map(item=>[item.id,item.folderId]));
        return folderPaintAudit;
      });
      assert.deepEqual(switchedAudit.leaks, [], 'Recycling, class rebinding and late pages must respect the current folder before paint');
      await page.evaluate(() => lazyAudit.folder('folder:test'));
      await old.click({ modifiers:['Control'], delay:800 });
      assert.deepEqual(await page.evaluate(() => lazyAudit.selected()), ['chat1025']);
      await page.keyboard.press('Escape');
      await page.evaluate(() => lazyAudit.folder(''));
      await page.waitForFunction(() => !document.querySelector('.pena-native-managed-viewport'));
      assert.deepEqual(await host.locator('.bx-im-list-recent-item__wrap').evaluateAll((rows, count) => rows.slice(0,count).map(row => row.dataset.id), idsBefore.length), idsBefore, 'Return preserves native nodes and order');
      // Go beyond both old limits through the native service, without blocking UI.
      await page.evaluate(() => { lazyAudit.assign('chat1900'); lazyAudit.folder('folder:test'); });
      await page.waitForFunction(() => lazyAudit.active());
      assert.equal(await page.locator('.pena-native-original-load-guard,.pena-native-folder-more,.pena-native-managed-row').count(), 0);
      assert.equal(await host.locator('input[type="search"]').isEnabled(), true);
      await host.locator('[data-id="chat1900"]').waitFor({state:'visible'});
      await page.waitForFunction(() => !lazyAudit.active());
      assert((await host.locator('.bx-im-list-recent-item__wrap').count()) > 900, 'Old folder members load without a 200-row cutoff');
      assert.deepEqual(await page.evaluate(()=>Object.fromEntries(lazyAudit.items().filter(item=>item.folderId).map(item=>[item.id,item.folderId]))), await page.evaluate(()=>({...folderMembershipBefore,chat1900:'folder:test'})), 'Native paging preserves every saved folder assignment');
      const stoppedCalls = await page.evaluate(() => nativeServiceCalls.length);
      await page.evaluate(() => { lazyAudit.apply(); window.dispatchEvent(new Event('focus')); });
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => nativeServiceCalls.length), stoppedCalls, 'Stop as soon as all folder members are present');
      assert.equal(await page.evaluate(() => nativeScrollAudit.filter(event => event.top > 0).length), 0, 'Native pagination never scrolls the viewport');
      await page.evaluate(() => lazyAudit.folder(''));
      await page.waitForTimeout(150);
      let loadedCount = await host.locator('.bx-im-list-recent-item__wrap').count();
      let scrollAfterFolder = await page.evaluate(() => nativeScrollAudit.length);

      // Stand in for Bitrix's server search, with an old result whose title does
      // not match the query (e.g. a message match). PENA must not refilter it.
      await page.evaluate(mode => {
        const host = document.querySelector(mode === 'tasks' ? '.task-host' : '.recent-host');
        const input = host.querySelector('input[type="search"]');
        const list = host.querySelector('.bx-im-list-container-recent__elements,.bx-im-list-container-task__elements');
        input.addEventListener('input', () => {
          host.querySelectorAll('.test-remote-search').forEach(row => row.remove());
          if (!input.value.trim()) return;
          const result = document.createElement('div');
          result.className = 'bx-im-search-result-item test-remote-search';
          result.dataset.dialogId = mode === 'tasks' ? 'chat99991' : 'user99991';
          result.innerHTML = '<span class="bx-im-chat-title__text">Remote result outside saved catalog</span>';
          result.addEventListener('click', () => { window.remoteSearchOpened = result.dataset.dialogId; });
          list.prepend(result);
        });
      }, mode);
      const input = host.locator('input[type="search"]');
      await page.evaluate(() => { window.nativeServiceDelay = 250; lazyAudit.assign('chat1980'); lazyAudit.folder('folder:test'); });
      await page.waitForFunction(() => lazyAudit.active());
      await input.fill('Давно');
      await page.waitForFunction(() => !lazyAudit.active());
      assert.equal(await page.locator('.pena-native-original-load-guard').count(), 0, 'Search cancels folder loading and removes its guard');
      await page.evaluate(() => lazyAudit.folder(''));
      await page.waitForTimeout(300);
      loadedCount = await host.locator('.bx-im-list-recent-item__wrap').count();
      await host.locator('.test-remote-search').waitFor({ state:'visible' });
      await page.waitForTimeout(350); // Include the extension's delayed reconciliation.
      assert.equal(await host.locator('.test-remote-search').isVisible(), true);
      assert((await page.evaluate(() => nativeSearchRuns)) > 0, 'Native search must receive input');
      assert.equal(await host.locator('.bx-im-list-recent-item__wrap:visible').count(), 0, 'Do not unhide rows excluded by native search');
      await host.locator('.test-remote-search').click();
      assert.equal(await page.evaluate(() => remoteSearchOpened), mode === 'tasks' ? 'chat99991' : 'user99991');
      assert.equal(await page.evaluate(() => lazyAudit.items().some(item => /99991/.test(item.id))), false, 'Search results are not a full-feed catalog');
      await input.fill('');
      await page.waitForTimeout(300);
      assert.equal(await host.locator('.bx-im-list-recent-item__wrap:visible').count(), loadedCount);
      scrollAfterFolder = await page.evaluate(() => nativeScrollAudit.length);
      await page.evaluate(async () => { await lazyAudit.wake(); await lazyAudit.refresh(); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('focus')); });
      await page.waitForTimeout(1500); // Include delayed mode/wake retries.
      assert.equal(await page.evaluate(() => nativeScrollAudit.length), scrollAfterFolder, 'Search, refresh and wake must not restart folder traversal');
      assert.equal(await page.evaluate(() => nativeRestCalls.filter(call => call.method === 'im.recent.list').length), 0);
      assert.equal(await page.locator('.pena-native-original-load-guard,.pena-native-load-guard').count(), 0);
      assert.deepEqual(errors, []);
      // Only a user-driven scroll asks Bitrix for its next page.
      await host.locator('.bx-im-list-container-recent__scroll-container,.bx-im-list-container-task__scroll-container').evaluate(viewport => {
        viewport.scrollTop = viewport.scrollHeight;
        viewport.dispatchEvent(new Event('scroll'));
      });
      await page.waitForFunction(({ mode, count }) => document.querySelectorAll(`${mode === 'tasks' ? '.task-host' : '.recent-host'} .bx-im-list-recent-item__wrap`).length > count, { mode, count:loadedCount });
      await page.waitForTimeout(350);
      assert((await host.locator('.bx-im-list-recent-item__wrap:visible').count()) > loadedCount);
      assert.equal(await page.evaluate(() => nativeRestCalls.filter(call => call.method === 'im.recent.list').length), 0);
      await page.evaluate(() => { window.nativeServiceDelay = 30; window.nativeServiceStall = true; lazyAudit.assign('chat9000'); lazyAudit.folder('folder:test'); });
      await page.locator('.pena-native-folder-status button').waitFor({state:'visible'});
      const stalledCalls = await page.evaluate(() => nativeServiceCalls.length);
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => nativeServiceCalls.length), stalledCalls, 'Stop a broken cursor without an endless request loop');
      await page.evaluate(() => { window.nativeServiceStall = false; });
      await page.locator('.pena-native-folder-status button').click();
      await page.waitForFunction(() => !lazyAudit.active() && document.querySelector('.pena-native-folder-status')?.textContent.includes('не найдена'));
      assert.equal(await page.evaluate(() => lazyAudit.items().some(item => item.id === 'chat9000' && item.folderId === 'folder:test')), true, 'A native tail is not a tombstone for missing saved dialogs');
      assert.equal(await page.locator('.pena-native-original-load-guard,.pena-native-managed-row').count(), 0);
      assert.deepEqual(errors, [], 'No page errors during native folder/search interactions');
      report.phases.push({ mode, status:'PASS', nativeRows:idsBefore.length, detailIds:details, nativeSearch:true, nativeServicePagination:true, folderPaintFrames:switchedAudit.frames, foreignFrames:switchedAudit.leaks.length, recycledRows:true, latePageSwitch:true });
    } catch (error) {
      console.error(await page.evaluate(() => ({ query:document.querySelector('.test-host:not([hidden]) input')?.value, searchRuns:window.nativeSearchRuns, remote:document.querySelector('.test-remote-search')?.outerHTML, errors:window.__PENA_MANAGED_DEBUG__ })));
      console.error(errors);
      throw error;
    } finally { await page.close(); }
  }
  console.log('PASS native lazy list: chats/tasks, native rows, native service pagination without scroll or blocking, remote search, counters and multi-select');
} finally {
  await browser.close(); await server.close();
  mkdirSync(new URL('./artifacts/', import.meta.url), { recursive:true });
  writeFileSync(new URL('./artifacts/native-lazy-list-report.json', import.meta.url), JSON.stringify(report,null,2));
}

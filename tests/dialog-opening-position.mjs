import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';

const server = await startHarnessServer();
const browser = await chromium.launch();
const results = [];
const artifacts = new URL('./artifacts/', import.meta.url);
mkdirSync(artifacts, { recursive: true });

async function measure(source, version) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const errors = collectPageErrors(page);
  const marker = 'const _PENA_TIME_CONTROL = window.__PENA_TIME_CONTROL__ || null;';
  assert.ok(source.includes(marker));
  await page.route('**/extension/injected.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: source.replace(marker, marker + '\nwindow.positionProbe = { mount: _resolveDialogControlNativeMount, owner: findInternalScrollContainer, move: _scrollDialogControlNativeListBy };')
  }));
  try {
    await page.goto(server.baseUrl + '/tests/recent-sync-harness.html?leadershipcase=1&apicase=1');
    await page.waitForFunction(() => {
      const sync = window.__PENA_RECENT_SYNC__;
      return sync && !sync.inFlight && sync.windowCount === 401 && sync.lastFullAt > 0;
    });
    const folder = page.locator('.pena-native-folder-tab[title="Руководители"]');
    await folder.click();
    const first = page.locator('.pena-native-remote-row[data-id="user42"]');
    const second = page.locator('.pena-native-remote-row[data-id="user43"]');
    await first.waitFor();
    await second.waitFor();
    await page.evaluate(() => {
      const pane = document.createElement('div');
      pane.id = 'position-chat';
      pane.className = 'bx-im-dialog-chat__scroll-container';
      pane.style.cssText = 'position:fixed;right:0;top:0;height:320px;width:250px;overflow:auto';
      pane.innerHTML = '<div style="height:1800px"></div>';
      document.body.append(pane);
      const trace = window.openTrace = [];
      const layout = { name: 'chat', entityId: 'chat99' };
      BX.Messenger.v2 = { Application: { Core: { getStore: () => ({ getters: { 'application/getLayout': layout } }) } } };
      BX.Messenger.Public.openChat = id => {
        trace.push('public-' + id);
        layout.entityId = id;
        pane.scrollTop = id === '42' ? 120 : 700;
        if (id === '42') return new Promise(resolve => { window.finishFirst = () => resolve(false); });
        return Promise.resolve(true);
      };
      window.BX24 = { im: { openMessenger(id) {
        trace.push('fallback-' + id);
        layout.entityId = id;
        pane.scrollTop = id === '42' ? 120 : 700;
        return true;
      } } };
    });
    await first.click();
    await second.press('Enter');
    await page.waitForFunction(() => openTrace.includes('public-43'));
    await page.evaluate(() => { document.querySelector('#position-chat').scrollTop = 812; finishFirst(); });
    await page.waitForTimeout(1150);
    const navigation = await page.evaluate(() => ({ trace: openTrace, readingTop: document.querySelector('#position-chat').scrollTop }));

    // Build the intermediate two-column layout synchronously. Bitrix has removed
    // its list scroller and the common application shell temporarily overflows.
    const geometry = await page.evaluate(() => {
      const shell = document.createElement('section');
      shell.style.cssText = 'position:fixed;inset:0 auto auto 0;width:650px;height:380px;overflow:auto;display:flex;background:white';
      const list = document.createElement('div');
      list.className = 'bx-im-list-container-recent__elements';
      list.style.cssText = 'width:240px;flex:none;align-self:flex-start';
      for (let i = 1; i <= 1600; i++) {
        const row = document.createElement('div');
        row.className = 'bx-im-list-recent-item__wrap';
        row.dataset.id = 'chat' + i;
        row.style.height = '12px';
        list.append(row);
      }
      const column = document.createElement('article');
      column.innerHTML = '<div class="bx-im-dialog-chat__scroll-container" style="height:300px;overflow:auto"><p style="height:600px"></p><p>Message</p><p style="height:600px"></p></div><textarea></textarea>';
      shell.append(list, column);
      document.body.append(shell);
      const prev = window.__PENA_ACTIVE_LIST_CONTEXT__;
      window.__PENA_ACTIVE_LIST_CONTEXT__ = { mode: 'chats', list };
      const message = column.querySelector('p:nth-child(2)');
      const composer = column.querySelector('textarea');
      const pane = column.firstElementChild;
      const distinct = new Set();
      const originalMatches = Element.prototype.matches;
      Element.prototype.matches = function(...args) {
        if (this.parentElement === list) distinct.add(this);
        return originalMatches.apply(this, args);
      };
      try {
        const start = performance.now();
        const owner = positionProbe.owner(list);
        const resolveMs = performance.now() - start;
        const visitedRows = distinct.size;
        shell.scrollTop = 90;
        pane.scrollTop = 440;
        const coords = () => [message.getBoundingClientRect().top, composer.getBoundingClientRect().top];
        const before = coords();
        positionProbe.move(64);
        const afterDown = coords();
        positionProbe.move(-100);
        const afterUp = coords();
        // The newly mounted list must accept scrolling again.
        const viewport = document.createElement('div');
        viewport.className = 'bx-im-list-recent__scroll-container';
        viewport.style.cssText = 'height:250px;width:240px;overflow:auto';
        list.replaceWith(viewport);
        viewport.append(list);
        positionProbe.move(64);
        const restoredListTop = viewport.scrollTop;
        shell.className = 'bx-im-list-container-recent__container';
        const sharedMount = positionProbe.mount(list, { requireStable: false });
        return { choseShell: owner === shell, before, afterDown, afterUp, restoredListTop, sharedMount: sharedMount.reason, visitedRows, resolveMs };
      } finally {
        Element.prototype.matches = originalMatches;
        window.__PENA_ACTIVE_LIST_CONTEXT__ = prev;
        shell.remove();
      }
    });
    assert.deepEqual(errors, []);
    return { version, navigation, geometry };
  } finally { await page.close(); }
}

try {
  if (process.argv[2]) {
    const tag = process.argv[2];
    const old = execFileSync('git', ['show', tag + ':extension/injected.js'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    results.push(await measure(old, tag));
  }
  const result = await measure(readFileSync(new URL('../extension/injected.js', import.meta.url), 'utf8'), 'candidate');
  results.push(result);
  console.log(JSON.stringify(results, null, 2));
  const { navigation, geometry } = result;
  assert.deepEqual(navigation, { trace: ['public-42', 'public-43'], readingTop: 812 });
  assert.equal(geometry.choseShell, false);
  assert.deepEqual(geometry.afterDown, geometry.before);
  assert.deepEqual(geometry.afterUp, geometry.before);
  assert.equal(geometry.restoredListTop, 64);
  assert.equal(geometry.sharedMount, 'shared-conversation-host');
  assert.equal(geometry.visitedRows, 4);
  if (results.length === 2) {
    const baseline = results[0];
    assert.ok(baseline.navigation.trace.includes('fallback-42'));
    assert.notDeepEqual(baseline.geometry.before, baseline.geometry.afterDown);
    assert.notDeepEqual(baseline.geometry.before, baseline.geometry.afterUp);
    assert.equal(baseline.geometry.visitedRows, 1600);
  }
} finally {
  writeFileSync(new URL('dialog-opening-position.json', artifacts), JSON.stringify(results, null, 2));
  await browser.close();
  await server.close();
}

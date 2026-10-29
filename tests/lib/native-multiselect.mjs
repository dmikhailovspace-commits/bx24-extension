import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { nativeCounterCss, counterMarkup, counterAppearance, checkCounterVariants } from './native-counter-fixture.mjs';
import { checkAuthorAvatars } from './author-avatar-fixture.mjs';

export async function checkOpenDialogMultiselect(browser, baseUrl, source) {
  for (const mode of ['chats', 'tasks']) {
    const page = await browser.newPage({ viewport: { width: 440, height: 760 } });
    const instrumented = source.replace('\tasync function boot() {', `\tasync function boot() {
      window.__OPEN_MULTI__ = { selected: () => [..._dialogControlMultiSelected],
        forget: id => { const items = _getDialogControlItems(); const i = items.findIndex(x => x.id === id); if (i >= 0) items.splice(i, 1); },
        item: id => _getDialogControlItems().find(x => x.id === id),
        targets: id => _getDialogControlMoveGroupIds(id),
        repaint: () => _syncDialogControlNativeMultiSelection() };`);
    try {
      await page.route('**/extension/injected.js', route => route.fulfill({ contentType: 'text/javascript', body: instrumented }));
      await page.goto(`${baseUrl}/tests/native-consistency-harness.html?mode=${mode}&nativeCatalog=1&nativeFirst=1&passThrough=1`);
      await page.locator('.pena-native-folder-switcher').waitFor({state:'visible'});
      await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.gateReady && !document.querySelector('.pena-native-original-load-guard'));
      const host = page.locator(mode === 'tasks' ? '.task-host' : '.recent-host');
      const active = host.locator('[data-id="chat225"]');
      const other = host.locator('[data-id="chat5"]');
      // A cold inbox has titles, but no open dialog. Its first title is not
      // evidence of an active conversation and must never seed the selection.
      for (const modifiers of [['Control'], ['Meta'], ['Shift']]) {
        await other.click({modifiers});
        assert.deepEqual(await page.evaluate(()=>__OPEN_MULTI__.selected()),['chat5'],`${mode}/${modifiers.join()}: empty open state selects only the clicked row`);
        await page.keyboard.press('Escape');
      }
      await page.locator('.test-host[hidden] [data-id="chat77"]').evaluate(el => el.classList.add('--selected'));
      await other.click({modifiers:['Control']});
      assert.deepEqual(await page.evaluate(()=>__OPEN_MULTI__.selected()),['chat5'],'A hidden list selection is not the open dialog');
      await page.keyboard.press('Escape');
      // Sanitized structure observed on the portal; no messages/user data are
      // captured. Preserve the header/message nesting rather than a bare title.
      await host.locator('[data-id="chat225"],[data-id="chat5"]').evaluateAll(rows => rows.forEach(el => {
        const title = el.querySelector('.bx-im-chat-title__text').textContent;
        el.innerHTML = `<div class="bx-im-list-recent-item__container"><div class="bx-im-list-recent-item__avatar_container"><div class="test-avatar"></div></div><div class="bx-im-list-recent-item__content_container"><div class="bx-im-list-recent-item__content_header"><span class="bx-im-chat-title__text"></span><span class="bx-im-list-recent-item__date">13:17</span></div><div class="bx-im-list-recent-item__content_bottom"><div class="bx-im-list-recent-item__message_container"><span class="bx-im-list-recent-item__message_text">Пример сообщения</span></div></div></div></div>`;
        el.querySelector('.bx-im-chat-title__text').textContent = title;
      }));
      await page.addStyleTag({ content: `.test-host {font:14px/20px Arial,sans-serif;color:#1f2937}
        .bx-im-list-recent-item__wrap {height:70px;border-radius:8px;margin:2px 0}
        .bx-im-list-recent-item__container {display:flex;align-items:center;padding:8px;box-sizing:border-box}
        .bx-im-list-recent-item__content_container {flex:1;min-width:0}
        .bx-im-list-recent-item__content_header {display:flex;justify-content:space-between}
        .bx-im-list-recent-item__date {font-size:11px;color:#a4adba}
        .bx-im-list-recent-item__message_container {color:#98a2b1}
        .bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__message_container {color:white}` });
      await page.addStyleTag({ content: nativeCounterCss });
      await checkAuthorAvatars(page, host, active, other);
      await host.locator('[data-id="chat225"],[data-id="chat5"]').evaluateAll((rows,html) => rows.forEach(el => {
        el.querySelector('.bx-im-list-recent-item__content_bottom').insertAdjacentHTML('beforeend',html);
      }), counterMarkup);
      // Exercise the native selected paint, nested under a wrapper, and a dialog
      // that has never been saved in PENA's assignments (the common inbox case).
      await active.evaluate(el => {
        el.classList.add('--selected');
        const shell = document.createElement('div');
        shell.className = 'test-selection-shell';
        el.firstElementChild.before(shell);
        shell.append(el.children[1]);
        const style = document.createElement('style');
        style.textContent = `.bx-im-list-recent-item__wrap.--selected { background-color:rgb(0,172,227); }
          .bx-im-list-recent-item__wrap.--selected .test-selection-shell > div { background:#00acd5; }
          .bx-im-list-recent-item__wrap.--selected .bx-im-chat-title__text { color:white; }
          .bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__date { color:white; }
          .test-selection-shell { width:100%;height:100%; }`;
        document.head.append(style);
        window.__OPEN_MULTI__.forget('chat225');
      });
      assert.equal(await active.locator('.test-selection-shell > div').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 172, 213)');
      await other.click({ modifiers: ['Control'] });
      assert.deepEqual(new Set(await page.evaluate(() => __OPEN_MULTI__.selected())), new Set(['chat225', 'chat5']), `${mode}: the open unsaved dialog must join the first selection`);
      assert.deepEqual(new Set(await page.evaluate(() => __OPEN_MULTI__.targets('chat5'))), new Set(['chat225', 'chat5']), 'Bulk operations must include the open dialog');
      const appearance = async row => row.evaluate(el => ({
        fill: getComputedStyle(el).backgroundColor, outline: getComputedStyle(el).boxShadow,
        content: getComputedStyle(el.querySelector('.bx-im-list-item__container,.bx-im-list-recent-item__container')).backgroundColor,
        title: getComputedStyle(el.querySelector('.bx-im-chat-title__text')).color,
        date: getComputedStyle(el.querySelector('.bx-im-list-recent-item__date')).color
      }));
      assert.deepEqual(await appearance(active), await appearance(other), `${mode}: native selected paint must match the other selected row`);
      // Observed on bx24.id-pr.ru: --selected and aria-current belong to the
      // wrapper. Vue owns its class binding and can replace the whole attribute
      // on a read/message/focus update, without replacing the node or its ID.
      await active.evaluate(el => {
        el.className = '--selected bx-im-list-recent-item__wrap --focus-visible';
        el.setAttribute('aria-current', 'true');
        el.querySelectorAll('.pena-native-chat-row-paint').forEach(n => n.classList.remove('pena-native-chat-row-paint'));
      });
      await page.waitForTimeout(250);
      assert.deepEqual(await appearance(active), await appearance(other), `${mode}: a native class repaint must not restore the open-row fill`);
      await checkCounterVariants(page, host, active, other, mode);
      assert.deepEqual(await counterAppearance(active), await counterAppearance(other));
      assert.equal(await page.evaluate(() => __OPEN_MULTI__.item('chat225').folderId || ''), '', 'Selection must not assign a folder');
      mkdirSync('tests/artifacts', { recursive: true });
      await page.screenshot({ path: `tests/artifacts/open-dialog-multiselect-${mode}.png` });
      const recycledPaint = await other.evaluate(async el => {
        el.dataset.id = 'chat777777'; // Native identity can change before the title.
        await new Promise(requestAnimationFrame);
        const marked = el.hasAttribute('data-pena-native-multi-selected');
        el.dataset.id = 'chat5';
        await new Promise(requestAnimationFrame);
        return { marked, restored: el.getAttribute('data-pena-native-multi-selected') };
      });
      assert.deepEqual(recycledPaint, { marked: false, restored: '1' }, 'A recycled row uses its new ID before the next paint, never the stale title');
      await page.keyboard.press('Escape');
      assert.deepEqual(await page.evaluate(() => __OPEN_MULTI__.selected()), []);
      assert.equal(await host.locator('[data-pena-native-multi-selected]').count(), 0, 'Escape clears paint even if Vue removed the PENA classes');
      assert.equal(await active.locator('.test-selection-shell > div').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 172, 213)', 'Escape restores native active paint');
      assert.equal(await active.locator('.bx-im-list-recent-item__counter_number').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)','Escape restores the native white counter');
      for (const target of ['other-row','selected-row','empty-space']) {
        await other.click({modifiers:['Control']});
        assert.equal((await page.evaluate(()=>__OPEN_MULTI__.selected())).length,2);
        await page.evaluate(()=>window.nativeRowClicks=[]);
        if(target==='empty-space') await page.locator('body').click({position:{x:439,y:759}});
        else await host.locator(target==='other-row'?'[data-id="chat77"]':'[data-id="chat5"]').click();
        assert.deepEqual(await page.evaluate(()=>__OPEN_MULTI__.selected()),[],`${target}: ordinary click clears multi-selection`);
        assert.equal(await host.locator('[data-pena-native-multi-selected]').count(),0);
        if(target!=='empty-space') assert.equal((await page.evaluate(()=>window.nativeRowClicks)).length,1,'Plain click still reaches Bitrix');
      }
      // Messenger's generic `id` can be a numeric chat entity, not the dialog
      // identity. A stale/malformed API answer must not hide a selected DOM row.
      for (const apiCase of ['chat-entity-id', 'stale-dialog', 'async-result']) {
        await page.evaluate(kind => {
          const api = kind === 'chat-entity-id' ? { getCurrentDialog: () => ({ id: 225 }) }
            : { getCurrentDialogId: () => kind === 'async-result' ? Promise.resolve('chat225') : 'chat999999' };
          window.BX.Messenger = { ...window.BX.Messenger, Application: api };
        }, apiCase);
        await other.click({ modifiers: ['Control'] });
        assert.deepEqual(new Set(await page.evaluate(() => __OPEN_MULTI__.selected())), new Set(['chat225', 'chat5']), `${mode}/${apiCase}: visible native selection must join the set`);
        assert.deepEqual(await appearance(active), await appearance(other), `${mode}/${apiCase}: open row uses the same paint`);
        await page.keyboard.press('Escape');
      }
      await page.evaluate(() => { window.BX.Messenger.Application = {}; });
      await active.evaluate(el => el.classList.remove('--selected'));
      await active.evaluate(el => el.removeAttribute('aria-current'));
      await other.evaluate(el => el.setAttribute('aria-selected', 'true'));
      await active.click({ modifiers: ['Meta'] });
      assert.deepEqual(new Set(await page.evaluate(() => __OPEN_MULTI__.selected())), new Set(['chat225', 'chat5']), 'Native aria-selected on the row is sufficient');
      await active.click({ modifiers: ['Control'] });
      assert.deepEqual(await page.evaluate(() => __OPEN_MULTI__.selected()), ['chat5']);
      await other.click({ modifiers: ['Control'] });
      assert.deepEqual(await page.evaluate(() => __OPEN_MULTI__.selected()), [], 'The current row can be explicitly removed from the set');
      await other.evaluate(el => {
        el.removeAttribute('aria-selected');
        window.BX.Messenger = { ...window.BX.Messenger, Application: { getCurrentDialogId: () => 'chat5' } };
      });
      await active.click({ modifiers: ['Control'] });
      assert.deepEqual(new Set(await page.evaluate(() => __OPEN_MULTI__.selected())), new Set(['chat225', 'chat5']), 'Messenger current dialog wins over unrelated visible titles');
      await page.keyboard.press('Escape');
      await other.click({ modifiers: ['Shift'] });
      assert.deepEqual(await page.evaluate(() => __OPEN_MULTI__.selected()), ['chat5'], 'Shift on the open dialog selects it once');
    } finally { await page.close(); }
  }
}

// Bitrix TaskList/RecentItem: pinned rows share the normal row wrapper; when
// read, ItemCounters replaces the number with __pinned-icon (also when muted).
export async function checkNativeMultiselect(browser, baseUrl, source) {
  await checkOpenDialogMultiselect(browser, baseUrl, source);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const instrumented = source.replace('\tasync function boot() {', `\tasync function boot() {
    window.__MULTI_TEST__ = { selected: () => [..._dialogControlMultiSelected],
      repaint: () => _syncDialogControlNativeMultiSelection() };`);
  try {
    await page.addInitScript(() => {
      window.__PENA_TEST_EAGER_MATERIALIZATION__ = true;
      window.__PENA_TEST_NATIVE_EXPECTED_AUDIT__ = true;
      window.__PENA_TEST_NATIVE_TASK_AUDIT__ = true;
    });
    await page.route('**/extension/injected.js', route => route.fulfill({ contentType: 'text/javascript', body: instrumented }));
    await page.goto(`${baseUrl}/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&nativeFirst=1&passThrough=1`);
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.gateReady && !document.querySelector('.pena-native-original-load-guard'));
    await page.evaluate(() => {
      const list = document.querySelector('.bx-im-list-container-task__elements');
      const pinned = document.createElement('div');
      pinned.className = 'bx-im-list-task__pinned_container';
      list.prepend(pinned);
      for (const id of ['chat225', 'chat5']) {
        const row = list.querySelector(`[data-id="${id}"]`);
        row.classList.add('--pinned');
        row.querySelectorAll('[class*="counter_number"]').forEach(node => node.remove());
        const counters = document.createElement('div');
        counters.className = 'bx-im-list-recent-item__counters_wrap --muted';
        counters.innerHTML = '<div class="bx-im-list-recent-item__counters_container"><div class="bx-im-list-recent-item__pinned-icon" style="width:20px;height:20px">●</div></div>';
        row.firstElementChild.append(counters);
        pinned.append(row);
      }
      window.nativeRowClicks = [];
    });
    const row = id => page.locator(`.task-host .bx-im-list-recent-item__wrap[data-id="${id}"]`);
    const selected = () => page.evaluate(() => window.__MULTI_TEST__.selected());
    // The old 650 ms suppression expired while the mouse was still down:
    // pointerdown selected, click deselected, and Bitrix never opened the row.
    await row('chat225').click({ modifiers: ['Control'], delay: 850 });
    assert.deepEqual(await selected(), ['chat225'], 'A held Ctrl-click must select a pinned read task exactly once');
    await row('chat5').locator('.bx-im-list-recent-item__pinned-icon').click({ modifiers: ['Control'] });
    assert.deepEqual(await selected(), ['chat225', 'chat5'], 'Pin icon participates in multi-selection');
    assert.equal(await page.locator('.--native-multi-selected').count(), 2);
    // Two separate fast gestures are not a duplicate pointer/mouse pair.
    await row('chat5').click({ modifiers: ['Control'] });
    assert.deepEqual(await selected(), ['chat225']);
    await row('chat5').click({ modifiers: ['Control'] });
    assert.deepEqual(await selected(), ['chat225', 'chat5']);
    await page.keyboard.press('Escape');
    // A Vue update can replace the row between press and compatibility click.
    await page.evaluate(() => {
      const old = document.querySelector('.task-host [data-id="chat225"]');
      old.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 }));
      const replacement = old.cloneNode(true);
      old.replaceWith(replacement);
      replacement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ctrlKey: true }));
      replacement.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 }));
      replacement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ctrlKey: true }));
      replacement.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ctrlKey: true }));
      window.__MULTI_TEST__.repaint();
    });
    assert.deepEqual(await selected(), ['chat225'], 'Replacing the same dialog row must not toggle the gesture twice');
    assert.equal(await row('chat225').evaluate(node => node.classList.contains('--native-multi-selected')), true);
    await row('chat5').click({ modifiers: ['Meta'] });
    assert.deepEqual(await selected(), ['chat225', 'chat5']);
    assert.deepEqual(await page.evaluate(() => window.nativeRowClicks), [], 'Selection must not open native tasks');
    await page.keyboard.press('Escape');
    await row('chat225').click({ modifiers: ['Control'] });
    await row('chat5').click({ modifiers: ['Shift'], delay: 850 });
    assert.ok((await selected()).includes('chat225') && (await selected()).includes('chat5'), 'Held Shift-click retains both range endpoints');
    await page.keyboard.press('Escape');
    // Cancellation ends suppression; the following ordinary click is native.
    await page.evaluate(() => {
      const target = document.querySelector('.task-host [data-id="chat5"]');
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: true, pointerId: 1 }));
      target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });
    assert.equal((await page.evaluate(() => window.nativeRowClicks)).length, 1);
    await page.evaluate(() => { window.nativeRowClicks = []; });
    await page.keyboard.press('Escape');
    await row('chat5').click();
    assert.equal((await page.evaluate(() => window.nativeRowClicks)).length, 1, 'The next plain click opens normally');
    assert.deepEqual(await selected(), []);
    await row('chat225').evaluate(el=>el.classList.add('is-selected'));
    await row('chat5').click({modifiers:['Control']});
    assert.deepEqual(new Set(await selected()),new Set(['chat225','chat5']),'The open task seeds the first additive selection');
    const paints=await page.locator('.task-host .--native-multi-selected').evaluateAll(rows=>rows.map(el=>({
      fill:getComputedStyle(el).backgroundColor,outline:getComputedStyle(el).boxShadow,
      content:getComputedStyle(el.firstElementChild).backgroundColor
    })));
    assert.equal(paints.length,2);assert.deepEqual(paints[0],paints[1],'The open task has the same multi-selection appearance');
    await page.keyboard.press('Escape');
    assert.equal(await row('chat225').evaluate(el=>el.classList.contains('is-selected')),true,'Leaving multi-select preserves native active state');
    await row('chat5').click({modifiers:['Shift']});
    assert.ok((await selected()).includes('chat225')&&(await selected()).includes('chat5'),'Shift starts its range at the open task');
    await page.keyboard.press('Escape');
    assert.deepEqual(errors, []);
    return { pinnedRead: true, muted: true, pinIcon: true, heldClick: true, rapidClicks: true, rowReplacement: true, meta: true, shift: true, cancel: true, plainClick: true };
  } finally {
    await page.close();
  }
}

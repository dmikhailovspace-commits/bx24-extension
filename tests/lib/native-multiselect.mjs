import assert from 'node:assert/strict';

// Bitrix TaskList/RecentItem: pinned rows share the normal row wrapper; when
// read, ItemCounters replaces the number with __pinned-icon (also when muted).
export async function checkNativeMultiselect(browser, baseUrl, source) {
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
    assert.deepEqual(errors, []);
    return { pinnedRead: true, muted: true, pinIcon: true, heldClick: true, rapidClicks: true, rowReplacement: true, meta: true, shift: true, cancel: true, plainClick: true };
  } finally {
    await page.close();
  }
}

import assert from 'node:assert/strict';

export async function checkCompactRail(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${baseUrl}/tests/native-cold-start-layout-harness.html`);
    await page.waitForFunction(() => window.__coldStartHarness?.phase === 'settled');
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      window.savedNativeList = document.getElementById('native-list');
      window.savedNativeRows = [...savedNativeList.children];
      window.savedView = localStorage.getItem('pena.dialogControlView.chats');
      const collab = document.createElement('section');
      collab.id = 'collab';
      collab.style.cssText = 'position:relative;flex:0 0 280px;background:white';
      collab.innerHTML = '<button id="collab-action">Открыть проект</button>';
      collab.querySelector('button').onclick = () => { window.collabClicks = (window.collabClicks || 0) + 1; };
      document.getElementById('chat-column').after(collab);
      collab.hidden = true;
    });
    // Both a genuinely narrow host and a wide inner host in a narrow native
    // ancestor must stop owning the panel. Reuse the same DOM through returns.
    for (const innerWidth of ['', '380px', '']) {
      await page.evaluate(width => {
        document.getElementById('native-host').style.width = width;
        document.getElementById('native-host').style.flex = width ? '0 0 380px' : '';
        document.getElementById('chat-column').style.cssText = 'width:40px;flex-basis:40px;transition:width .12s,flex-basis .12s';
        document.getElementById('collab').hidden = false;
      }, innerWidth);
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.pena-native-folder-switcher').count(), 0, 'Compact Collab rail retained the full folder panel');
      assert.equal(await page.locator('.pena-native-managed-viewport').count(), 0, 'Compact rail retained a replacement list');
      assert.equal(await page.locator('#native-viewport').evaluate(el => el.classList.contains('pena-native-source-viewport-hidden')), false);
      await page.locator('#collab-action').click();
      await page.waitForTimeout(1400);
      assert.equal(await page.locator('.pena-native-folder-switcher').count(), 0, 'A pending retry remounted the panel over Collab');
      const preserved = await page.evaluate(() => ({
        sameList: savedNativeList === document.getElementById('native-list'),
        sameRows: savedNativeRows.every(row => row.parentElement === savedNativeList),
        view: localStorage.getItem('pena.dialogControlView.chats') === savedView,
        visibleRows: savedNativeRows.filter(row => getComputedStyle(row).display !== 'none').length
      }));
      assert.deepEqual(preserved, { sameList: true, sameRows: true, view: true, visibleRows: 48 });
      await page.evaluate(() => {
        document.getElementById('chat-column').style.cssText = 'transition:width .12s,flex-basis .12s';
        document.getElementById('native-host').style.cssText = '';
        document.getElementById('collab').hidden = true;
      });
      await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 6000 });
      assert.equal(await page.locator('.pena-native-folder-switcher').count(), 1);
      assert.equal(await page.evaluate(() => localStorage.getItem('pena.dialogControlView.chats') === savedView), true);
    }
    assert.equal(await page.evaluate(() => collabClicks), 3, 'Native Collab actions were blocked');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

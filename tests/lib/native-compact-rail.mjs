import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export async function checkCompactRail(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    // Layering must be correct before any JS cleanup runs, including in the
    // exposed avatar rail occupied by the native project's back button.
    await page.setContent(`<style>
      body{margin:0}.bx-im-messenger__list_container{position:relative;width:400px;height:600px}
      .bx-im-list-container-recent__scope{height:100%}
      .bx-im-list-container-recent__header_container{height:80px}
      .bx-im-list-navigator-nested-list__container{position:absolute;left:68px;right:0;top:0;bottom:0;background:white;z-index:10}
      #project-back{position:absolute;left:-42px;top:14px;width:42px;height:36px;border-radius:18px 0 0 18px}
      #project-search{height:80px;background:white}
      #project-content{height:520px;background:white}
    </style><main class="bx-im-messenger__list_container">
      <div class="bx-im-list-container-recent__scope">
        <header class="bx-im-list-container-recent__header_container pena-bitrix-list-system-toolbar-sticky">
          <div class="pena-extension-toolbar-controls --full-header"><span>PENA v8</span></div>
        </header>
        <div class="pena-native-folder-switcher" style="visibility:visible!important;pointer-events:auto!important;height:200px">Папки</div>
      </div>
      <section class="bx-im-list-navigator-nested-list__container --compact-mode">
        <button id="project-back">Назад</button><div id="project-search">Поиск проекта</div><button id="project-content">Открыть проект</button>
      </section>
    </main>`);
    await page.addStyleTag({ content:readFileSync(new URL('../../extension/injected.css',import.meta.url),'utf8') });
    const topLayers = await page.evaluate(() => [[45,30],[80,15],[100,130]].map(([x,y])=>document.elementFromPoint(x,y)?.closest('[id]')?.id));
    assert.deepEqual(topLayers,['project-back','project-search','project-content'],'Native project must cover all PENA layers without waiting for JS');
    for (const [width,rail] of [[340,40],[400,68],[480,96]]) {
      await page.locator('main').evaluate((el,width)=>{el.style.width=`${width}px`;},width);
      await page.locator('.bx-im-list-navigator-nested-list__container').evaluate((el,rail)=>{el.style.left=`${rail}px`;},rail);
      assert.equal(await page.evaluate(()=>{
        const project=document.querySelector('.bx-im-list-navigator-nested-list__container');
        return [[10,10],[20,40],[5,75]].every(([x,y])=>project.contains(document.elementFromPoint(x,y)));
      }),true,'Opaque project header must cover gaps around its rounded back button at every list width');
    }
    await page.goto(`${baseUrl}/tests/native-cold-start-layout-harness.html`);
    await page.waitForFunction(() => window.__coldStartHarness?.phase === 'settled');
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
    await page.locator('.pena-extension-toolbar-version').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      window.savedVersionBadge = document.querySelector('.pena-extension-toolbar-controls');
      window.savedNativeList = document.getElementById('native-list');
      window.savedNativeRows = [...savedNativeList.children];
      window.savedView = localStorage.getItem('pena.dialogControlView.chats');
      document.getElementById('workspace').classList.add('bx-im-messenger__list_container');
      document.getElementById('native-host').classList.add('bx-im-list-container-recent__scope');
      const collab = document.createElement('section');
      collab.id = 'collab';
      collab.className = 'bx-im-list-navigator-nested-list__container';
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
    // Live Messenger keeps all original widths unchanged. A sibling nested
    // slider covers the recent list, leaving a 68px avatar rail underneath.
    await page.evaluate(() => {
      const shell = document.getElementById('chat-column');
      document.getElementById('native-host').classList.add('bx-im-list-container-recent__scope');
      shell.classList.add('bx-im-messenger__list_container');
      shell.style.position = 'relative';
      const layer = document.createElement('div');
      layer.id = 'native-collab-slider';
      layer.className = 'bx-im-list-navigator-nested-list__container --compact-mode';
      layer.style.cssText = 'position:absolute;left:68px;right:0;top:0;bottom:0;background:white;transform:translateX(100%);transition:transform .15s';
      layer.innerHTML = '<div class="bx-im-list-container-slider --compact-mode" style="height:100%"><button id="nested-action" style="position:absolute;left:-68px;top:0;width:68px;height:50px">Назад</button><div style="height:100%;background:white">Проект</div></div>';
      layer.querySelector('button').onclick = () => { window.nestedClicks = (window.nestedClicks || 0) + 1; };
      shell.append(layer);
    });
    await page.waitForTimeout(50);
    for (let i=0; i<2; i++) {
      await page.evaluate(() => {
        const staleHeader = document.createElement('div');
        staleHeader.id = 'previous-native-header';
        staleHeader.className = 'bx-im-list-container-recent__header_container';
        staleHeader.innerHTML = '<div class="pena-extension-toolbar-controls">PENA</div>';
        document.body.append(staleHeader);
        const status = document.createElement('div');
        status.className = 'pena-native-folder-status';
        status.textContent = 'Часть диалогов не найдена в списке Bitrix';
        document.getElementById('native-host').append(status);
        document.getElementById('native-collab-slider').style.transform = 'translateX(0)';
      });
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.pena-native-folder-switcher').count(), 0, 'Nested native slider retained the full-width panel');
      assert.equal(await page.locator('.pena-native-folder-status').count(), 0, 'Folder loading status overlapped the native project');
      assert.equal(await page.locator('#previous-native-header .pena-extension-toolbar-controls').count(), 0, 'Retired header retained duplicate controls');
      assert.equal(await page.evaluate(() => savedVersionBadge === document.querySelector('#native-host .pena-extension-toolbar-controls')), true, 'Opening a project removed or replaced the version badge');
      assert.equal(await page.locator('.pena-extension-toolbar-controls').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return document.getElementById('native-collab-slider').contains(document.elementFromPoint(rect.x+5,rect.y+5));
      }), true, 'Native project must cover the retained badge');
      assert.equal(await page.locator('#native-list').evaluate(el => el.getBoundingClientRect().width), 380, 'Fixture must retain the original wide list');
      await page.locator('#nested-action').click();
      await page.evaluate(() => { document.getElementById('native-collab-slider').style.transform = 'translateX(100%)'; });
      await page.locator('#previous-native-header').evaluate(el => el.remove());
      await page.locator('.pena-native-folder-switcher').waitFor({ state:'visible', timeout:6000 });
      assert.equal(await page.locator('.pena-native-folder-switcher').count(), 1);
      assert.equal(await page.locator('.pena-extension-toolbar-controls').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(rect.x+5,rect.y+5));
      }), true, 'Closing the project must uncover the version badge');
    }
    assert.equal(await page.evaluate(() => nestedClicks), 2);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

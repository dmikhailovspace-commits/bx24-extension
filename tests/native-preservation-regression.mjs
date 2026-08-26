import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const failures = [];

const nextFrames = (page, count = 2) => page.evaluate(frames => new Promise(resolve => {
  const advance = remaining => requestAnimationFrame(() => remaining <= 1 ? resolve() : advance(remaining - 1));
  advance(frames);
}), count);

const waitManaged = page => page.waitForFunction(() => {
  const sync = window.__PENA_RECENT_SYNC__;
  const viewport = document.querySelector('.pena-native-managed-viewport');
  return sync?.gateReady && viewport && getComputedStyle(viewport).visibility === 'visible' && document.querySelector('.pena-native-managed-row');
}, null, { timeout: 7000 });

const presentation = page => page.evaluate(() => {
  const contract = window.__nativeContract.snapshot();
  const panel = document.querySelector('.pena-native-folder-switcher');
  const source = document.querySelector('#native-viewport');
  const managed = document.querySelector('.pena-native-managed-viewport');
  const panelRect = panel?.getBoundingClientRect();
  const managedRect = managed?.getBoundingClientRect();
  return {
    contract,
    panelParentIsManagedParent: !!panel && !!managed && panel.parentElement === managed.parentElement,
    panelImmediatelyBeforeManaged: panel?.nextElementSibling === managed,
    panelInsideManaged: !!panel && !!managed && managed.contains(panel),
    panelTop: panelRect?.top ?? null,
    panelBottom: panelRect?.bottom ?? null,
    managedTop: managedRect?.top ?? null,
    managedScrollTop: managed?.scrollTop || 0,
    managedScrollHeight: managed?.scrollHeight || 0,
    managedClientHeight: managed?.clientHeight || 0,
    sourceInert: !!source?.inert,
    managedInert: !!document.querySelector('.pena-native-managed-list')?.inert
  };
});

const rowGeometry = (page, id = 'chat1') => page.locator(`.pena-native-managed-row[data-id="${id}"]`).evaluate(row => {
  const marker = row.querySelector('.pena-native-avatar-ring');
  const avatar = row.querySelector('.pena-native-remote-avatar');
  const title = row.querySelector('.pena-native-remote-title');
  const rowRect = row.getBoundingClientRect();
  const markerRect = marker?.getBoundingClientRect();
  const avatarRect = avatar?.getBoundingClientRect();
  const titleRect = title?.getBoundingClientRect();
  return {
    rowLeft: rowRect.left,
    rowTop: rowRect.top,
    rowWidth: rowRect.width,
    rowHeight: rowRect.height,
    markerLeft: markerRect?.left ?? 0,
    markerTop: markerRect?.top ?? 0,
    markerWidth: markerRect?.width ?? 0,
    markerHeight: markerRect?.height ?? 0,
    avatarLeft: avatarRect?.left ?? 0,
    avatarTop: avatarRect?.top ?? 0,
    avatarWidth: avatarRect?.width ?? 0,
    avatarHeight: avatarRect?.height ?? 0,
    titleLeft: titleRect?.left ?? 0,
    titleTop: titleRect?.top ?? 0,
    ringMatchesAvatar: !!(avatarRect && markerRect && Math.abs(markerRect.left - avatarRect.left) < .1 && Math.abs(markerRect.right - avatarRect.right) < .1),
	markerBorderWidth: Number.parseFloat(marker ? getComputedStyle(marker).borderTopWidth : '0') || 0,
    avatarTitleGap: titleRect && avatarRect ? titleRect.left - avatarRect.right : 0
  };
});

const assertGeometry = (actual, expected, label) => {
  const differences = Object.keys(expected)
	.filter(key => Number.isFinite(expected[key]))
    .filter(key => !Number.isFinite(actual[key]) || Math.abs(actual[key] - expected[key]) > 0.5)
    .map(key => `${key}: ${expected[key]} -> ${actual[key]}`);
  assert.deepEqual(differences, [], `${label}: ${differences.join(', ')}`);
};

const wheelManaged = async (page, deltaY) => {
  const viewport = page.locator('.pena-native-managed-viewport');
  const box = await viewport.boundingBox();
  assert.ok(box && box.height > 10, 'managed viewport has no geometry');
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height - 20, Math.max(80, box.height / 2)));
  await page.mouse.wheel(0, deltaY);
  await nextFrames(page, 2);
};

const runCase = async (mode, name, body) => {
  const context = await browser.newContext({ viewport: { width: 440, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
    await body(page);
    assert.deepEqual(pageErrors, [], `${mode}/${name}: page errors`);
    console.log(`PASS ${mode}: ${name}`);
  } catch (error) {
    const message = `${mode}: ${name}: ${error?.message || error}`;
    failures.push(message);
    console.error(`FAIL ${message}`);
  } finally {
    await context.close();
  }
};

try {
  for (const mode of ['chats', 'tasks']) {
    await runCase(mode, 'managed catalog keeps Bitrix ownership and scrolls below the panel', async page => {
      await page.goto(`${server.baseUrl}/tests/native-preservation-harness.html?mode=${mode}&transform=1`);
      await waitManaged(page);
      await nextFrames(page, 3);
      const before = await presentation(page);
      const source = before.contract.source;
      assert.equal(source.sameViewportReference, true);
      assert.equal(source.sameListReference, true);
      assert.equal(source.sameParent, true);
      assert.equal(source.sameChildren, true);
      assert.equal(source.sameOrder, true);
      assert.equal(source.managedViewports, 1);
      assert.equal(source.managedRoots, 1);
      assert.equal(source.managedVisible, true);
      assert.equal(source.sourceViewportHiddenClass, true);
      assert.equal(before.panelParentIsManagedParent, true);
      assert.equal(before.panelImmediatelyBeforeManaged, true);
      assert.equal(before.panelInsideManaged, false);
      assert.ok(before.panelBottom <= before.managedTop + 0.5, 'panel overlaps the visible dialog viewport');
      const atBottom = before.managedScrollTop >= before.managedScrollHeight - before.managedClientHeight - 1;
      await wheelManaged(page, atBottom ? -420 : 420);
      const after = await presentation(page);
      assert.ok(
        atBottom ? after.managedScrollTop < before.managedScrollTop : after.managedScrollTop > before.managedScrollTop,
        `managed dialog list did not scroll (${before.managedScrollTop} -> ${after.managedScrollTop}; ${after.managedScrollHeight}/${after.managedClientHeight})`
      );
      assert.ok(Math.abs(after.panelTop - before.panelTop) <= 0.5, 'panel moved with dialogs');
      assert.equal(after.contract.mutations.removedRows, 0);
      assert.equal(after.contract.mutations.movedRows, 0);
    });

    await runCase(mode, 'cold gate is inert and the presentation swaps without a blank frame', async page => {
      await page.goto(`${server.baseUrl}/tests/native-preservation-harness.html?mode=${mode}&restDelay=500`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__nativeContract?.firstFrame, null, { timeout: 3000 });
      const first = await page.evaluate(() => window.__nativeContract.firstFrame);
      assert.equal(first.source.sameViewportReference, true);
      assert.equal(first.source.sameListReference, true);
      assert.equal(first.source.sameChildren, true);
      await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.gateLocked);
      const locked = await presentation(page);
      assert.equal(locked.sourceInert || locked.managedInert, true, 'dialogs accept keyboard input while catalog is locked');
      await waitManaged(page);
      await nextFrames(page, 3);
      const ready = await presentation(page);
      assert.equal(ready.managedInert, false);
      assert.equal(ready.contract.timeline.blankPresentationFrames, 0);
      assert.equal(ready.contract.source.sameChildren, true);
    });

    await runCase(mode, 'managed view is fully torn down after leaving chats', async page => {
      await page.goto(`${server.baseUrl}/tests/native-preservation-harness.html?mode=${mode}&transform=1`);
      await waitManaged(page);
      await page.evaluate(() => { window.__nativeContract.sourceRows.at(-1).style.display = 'none'; });
      await page.evaluate(() => window.__nativeContract.setRouteVisible(false));
      await page.waitForFunction(() => {
        const state = window.__nativeContract.snapshot();
        return state.source.managedViewports === 0 && !state.source.sourceViewportHiddenClass && !state.nativeModeClass;
      }, null, { timeout: 4000 });
      const state = await page.evaluate(() => window.__nativeContract.snapshot());
      assert.equal(state.source.managedRoots, 0);
      assert.equal(state.source.sameChildren, true);
      assert.equal(await page.evaluate(() => window.__nativeContract.sourceRows.at(-1).style.display), 'none');
    });

    await runCase(mode, 'temporary geometry loss keeps the same mounted nodes', async page => {
      await page.goto(`${server.baseUrl}/tests/native-preservation-harness.html?mode=${mode}&transform=1`);
      await waitManaged(page);
      assert.equal(await page.evaluate(() => window.__nativeContract.startGeometryDip(180)), true);
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(() => window.__nativeContract.geometryDipIdentity()), {
        panelStable: true, viewportStable: true, panels: 1, managedViewports: 1
      });
      await page.waitForTimeout(220);
      assert.deepEqual(await page.evaluate(() => window.__nativeContract.geometryDipIdentity()), {
        panelStable: true, viewportStable: true, panels: 1, managedViewports: 1
      });
    });

    await runCase(mode, 'marker avatar and text never shift on hover or selection', async page => {
      await page.goto(`${server.baseUrl}/tests/native-preservation-harness.html?mode=${mode}`);
      await waitManaged(page);
      const row = page.locator('.pena-native-managed-row[data-id="chat1"]');
      await row.waitFor({ state: 'visible' });
      const baseline = await rowGeometry(page);
	  assert.ok(Math.abs(baseline.markerWidth - baseline.avatarWidth) < .1, `avatar ring does not match avatar width: ${baseline.markerWidth}px`);
	  assert.equal(baseline.ringMatchesAvatar, true, 'avatar ring does not follow the avatar contour');
	  assert.equal(baseline.markerBorderWidth, 4, 'avatar ring is not 4px thick');
      assert.ok(baseline.avatarTitleGap >= 8, `avatar/title gap is ${baseline.avatarTitleGap}px`);
      await row.hover();
      await nextFrames(page);
      assertGeometry(await rowGeometry(page), baseline, 'hover geometry');
      await row.click();
      await page.waitForFunction(expected => (
        window.__nativeContract.snapshot().events.apiOpens.includes(expected) &&
        document.querySelector(`.pena-native-managed-row[data-id="${expected}"]`)?.getAttribute('aria-current') === 'true'
      ), 'chat1');
      await nextFrames(page);
      assert.equal(await row.getAttribute('aria-current'), 'true');
      assertGeometry(await rowGeometry(page), baseline, 'selected geometry');
      await page.waitForTimeout(350);
      assertGeometry(await rowGeometry(page), baseline, 'settled selected geometry');
      await page.locator('.pena-native-managed-row[data-id="chat2"]').click();
      await nextFrames(page);
      assertGeometry(await rowGeometry(page), baseline, 'deselected geometry');
    });

    await runCase(mode, 'recycled source row cannot leak its marker to another dialog', async page => {
      await page.goto(`${server.baseUrl}/tests/native-preservation-harness.html?mode=${mode}`);
      await waitManaged(page);
      await page.waitForFunction(() => document.querySelector('.pena-native-managed-row[data-id="chat1"]')?.classList.contains('--native-colored'));
      await page.evaluate(() => window.__nativeContract.recycleFirstRow('chat2', 'Chat 02'));
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.pena-native-managed-row[data-id="chat1"]').evaluate(row => row.classList.contains('--native-colored')), true);
      assert.equal(await page.locator('.pena-native-managed-row[data-id="chat2"]').evaluate(row => row.classList.contains('--native-colored')), false);
      assert.equal((await page.evaluate(() => window.__nativeContract.snapshot())).source.sameChildren, true);
    });

    await runCase(mode, 'managed right click opens one functional menu without switching the dialog', async page => {
      await page.goto(`${server.baseUrl}/tests/native-preservation-harness.html?mode=${mode}`);
      await waitManaged(page);
      const row = page.locator('.pena-native-managed-row[data-id="chat1"]');
      await row.click({ button: 'right' });
      const menu = page.locator('.dialog-control-context-menu');
      await menu.waitFor({ state: 'visible', timeout: 2000 });
      assert.equal(await page.locator('.dialog-control-context-menu').count(), 1);
      const labels = await menu.locator('button').allTextContents();
      assert.ok(labels.some(label => /Посмотреть позже/.test(label)));
      assert.ok(labels.some(label => /Добавить в новую папку/.test(label)));
	  assert.ok(labels.some(label => /Оригинальное меню Bitrix24/.test(label)));
      const events = (await page.evaluate(() => window.__nativeContract.snapshot())).events;
      assert.deepEqual(events.apiOpens, []);
      assert.equal(events.nativeClicks, 0);
    });
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  throw new AggregateError(failures.map(message => new Error(message)), `${failures.length} native preservation regression(s) failed`);
}

console.log('PASS native preservation: managed projection, original ownership, scrolling, geometry, click and context menu');

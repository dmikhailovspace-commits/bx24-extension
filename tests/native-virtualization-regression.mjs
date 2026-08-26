import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 760 } });
const pageErrors = collectPageErrors(page);
const state = () => page.evaluate(() => window.__virtualHarness.state());

const wheel = async deltaY => {
  const viewport = page.locator('.pena-native-managed-viewport');
  const box = await viewport.boundingBox();
  assert.ok(box && box.height > 10, 'Managed viewport has no geometry');
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height - 20, Math.max(80, box.height / 2)));
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(140);
};

const assertPanelStable = (actual, baseline, label) => {
  assert.ok(Math.abs(actual.panelTop - baseline.panelTop) < 0.5, `${label}: panel moved by ${actual.panelTop - baseline.panelTop}px`);
  assert.equal(actual.panelInsideViewport, false, `${label}: panel entered the scrolling viewport`);
  assert.ok(actual.panelBottom <= actual.viewportTop + 0.5, `${label}: panel overlaps the dialog viewport`);
};

try {
  await page.goto(`${server.baseUrl}/tests/native-virtualization-harness.html?swallowFirstWheel=1`);
  await page.locator('.pena-native-managed-viewport').waitFor({ state: 'visible' });
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().active === true);
	const loading = await state();
	assert.equal(loading.loaderVisible, true, 'Loader disappeared before native traversal completed');
	assert.ok(loading.loaderTopOffset >= 18 && loading.loaderTopOffset <= 30, `Loader is not near the top of the dialog feed: ${JSON.stringify(loading)}`);
	await page.locator('.pena-native-managed-viewport').evaluate(node => {
		node.scrollTop = 640;
		node.dispatchEvent(new Event('scroll'));
	});
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.gateReady &&
		window.__virtualHarness.state().managedViewCount === 500 &&
		window.__PENA_NATIVE_PREFETCH__?.status?.().active === false, null, { timeout: 8000 });
	const interactiveLoad = await state();
	assert.ok(Math.abs(interactiveLoad.scrollTop - 640) < 1, `Native prefetch reset a user scroll: ${JSON.stringify(interactiveLoad)}`);
	assert.equal(interactiveLoad.pageScrollTop, 0, 'Using the managed list during prefetch moved the page');
	await page.locator('.pena-native-managed-viewport').evaluate(node => {
		node.scrollTop = 0;
		node.dispatchEvent(new Event('scroll'));
	});
  await page.waitForTimeout(120);
  const baseline = await state();
  assert.equal(baseline.total, 500);
  assert.equal(baseline.poolSize, 24);
  assert.equal(baseline.connectedPool, 24);
  assert.equal(baseline.uniquePoolSlots, 24);
  assert.equal(baseline.sourceViewportHidden, true);
	assert.ok(baseline.reusePasses > 0, 'Hidden Bitrix viewport was not traversed during native prefetch');
	assert.equal(baseline.sourceScrollTop, 0, 'Native prefetch did not restore the hidden source position');
	assert.equal(baseline.pageScrollTop, 0, 'Native prefetch moved the visible page');
	assert.equal(baseline.restRecentCalls, 0, 'Native prefetch fell back to the heavy recent-list REST catalog');
  assert.equal(baseline.managedViewCount, 500);
  assert.ok(baseline.managedRows > 0 && baseline.managedRows <= 40, `Initial virtual window is unbounded: ${JSON.stringify(baseline)}`);
	assert.equal(baseline.managedFirstIndex, 0, `Silent prefetch shifted the visible managed viewport: ${JSON.stringify(baseline)}`);
  assert.equal(baseline.managedFirstId, 'chat1');
  assert.equal(baseline.legacyRemoteRows, 0);
  assertPanelStable(baseline, baseline, 'initial');
	await page.waitForTimeout(1200);
	const idle = await state();
	assert.equal(idle.reusePasses, baseline.reusePasses, 'Hidden source kept scrolling after catalog completion');
	assert.equal(idle.renderPasses, baseline.renderPasses, 'Bitrix source kept rendering after catalog completion');

  await wheel(3200);
  const down = await state();
  assert.equal(down.swallowedWheels, 1, 'Harness did not suppress the first managed wheel event');
  assert.ok(Math.abs(down.scrollTop - 3200) < 1, `Cancelled wheel fallback was lost or duplicated: ${down.scrollTop}`);
  assert.ok(down.managedFirstIndex > 0, `Managed rows were not recycled: ${JSON.stringify(down)}`);
  assert.ok(down.managedRows > 0 && down.managedRows <= 40, `Scrolled virtual window is unbounded: ${down.managedRows}`);
  assert.equal(down.connectedPool, 24, 'Bitrix source pool was changed');
	assert.equal(down.reusePasses, baseline.reusePasses, 'Visible managed scrolling leaked into the hidden Bitrix viewport');
	assert.equal(down.sourceScrollTop, 0, 'Visible managed scrolling changed the hidden Bitrix position');
  assert.equal(down.legacyRemoteRows, 0);
  assertPanelStable(down, baseline, 'scroll down');

  await wheel(100000);
  const bottom = await state();
  assert.ok(bottom.scrollTop >= bottom.scrollHeight - bottom.clientHeight - 1, `Managed list did not reach the bottom: ${JSON.stringify(bottom)}`);
  assert.equal(bottom.managedLastIndex, 499);
  assert.equal(bottom.managedLastId, 'chat500');
  assert.equal(bottom.connectedPool, 24);
  assertPanelStable(bottom, baseline, 'scroll bottom');

  await wheel(-6400);
  const upward = await state();
  assert.ok(upward.scrollTop < bottom.scrollTop, 'Wheel up did not move the managed list');
  assertPanelStable(upward, baseline, 'scroll up');

  await wheel(-100000);
  const top = await state();
  assert.ok(top.scrollTop <= 1, `Managed list did not return to the top: ${top.scrollTop}`);
  assert.equal(top.managedFirstIndex, 0);
  assert.equal(top.managedFirstId, 'chat1');
  assert.equal(top.connectedPool, 24);
  assert.equal(top.uniquePoolSlots, 24);
  assert.equal(top.legacyRemoteRows, 0);
  assertPanelStable(top, baseline, 'scroll top');
  assert.deepEqual(pageErrors, []);
  console.log('PASS native virtualization: 500 managed dialogs, bounded rows, bidirectional wheel, fixed panel, untouched Bitrix pool');
} finally {
  await browser.close();
  await server.close();
}

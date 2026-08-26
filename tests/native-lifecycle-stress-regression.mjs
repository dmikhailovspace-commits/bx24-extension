import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 760 } });
const pageErrors = collectPageErrors(page);

try {
  await page.goto(`${server.baseUrl}/tests/native-lifecycle-stress-harness.html`);
  await page.locator('.recent-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
  const stats = await page.evaluate(() => window.__lifecycleHarness.run(20));
  assert.equal(stats.iterations, 20);
  assert.ok(stats.frameSamples >= 40, `Too few lifecycle frame samples: ${stats.frameSamples}`);
  assert.ok(stats.mutationFrames >= 20, `MutationObserver missed lifecycle churn: ${stats.mutationFrames}`);
  assert.equal(stats.maxVisible, 1, `More than one native panel was visible in a frame: ${JSON.stringify(stats)}`);
  assert.equal(stats.duplicateFrames, 0, `Duplicate panels appeared: ${JSON.stringify(stats)}`);
  assert.equal(stats.invalidMountFrames, 0, `A panel flashed in an invalid root: ${JSON.stringify(stats)}`);
  assert.equal(stats.settledMissing, 0, `A recreated list settled without exactly one panel: ${JSON.stringify(stats)}`);
  assert.equal(stats.settledWrongHost, 0, `A panel stayed attached to the inactive list: ${JSON.stringify(stats)}`);
  assert.equal(stats.finalVisible, 1);
  const offsetSpread = Math.max(...stats.settledOffsets) - Math.min(...stats.settledOffsets);
  assert.ok(offsetSpread <= 1, `Panel vertical position changed across modes by ${offsetSpread}px`);
  assert.deepEqual(pageErrors, []);
  console.log('PASS native lifecycle stress: 20 container rebuilds, one visible stable panel per frame');
} finally {
  await browser.close();
  await server.close();
}

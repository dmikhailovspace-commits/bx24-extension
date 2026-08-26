import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });

const runScenario = async ({ query = '', expectedFaults = 0, expectActive = true } = {}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = collectPageErrors(page);
  await page.goto(`${server.baseUrl}/tests/native-cold-start-layout-harness.html${query}`);
  await page.waitForFunction(() => window.__coldStartHarness?.phase === 'settled', null, { timeout: 5000 });
  await page.waitForTimeout(80);
  const report = await page.evaluate(() => window.__coldStartHarness.report());
  const diagnostic = JSON.stringify(report);
  const violations = [];

  assert.ok(report.provisionalSamples >= 8, `Cold-start window was not sampled reliably: ${diagnostic}`);
  if (report.provisionalManagedFrames) violations.push(`managed list visible before layout ready: ${report.provisionalManagedFrames} frames`);
  if (report.provisionalPanelFrames) violations.push(`native controls visible before layout ready: ${report.provisionalPanelFrames} frames`);
  if (report.provisionalSourceHiddenFrames) violations.push(`Bitrix source list hidden before layout ready: ${report.provisionalSourceHiddenFrames} frames`);
  if (report.nativeModeWithoutReadyFrames) violations.push(`native mode committed without one coherent ready composition: ${report.nativeModeWithoutReadyFrames} frames`);
  if (report.invalidDirectMountFrames) violations.push(`PENA mounted directly into body/html: ${report.invalidDirectMountFrames} frames`);
  if (report.brokenCompositionFrames) violations.push(`Bitrix source hidden without a complete replacement: ${report.brokenCompositionFrames} frames`);
  if (report.blankListFrames) violations.push(`both source and managed lists were blank: ${report.blankListFrames} frames`);
  if (report.hiddenHeaderFrames) violations.push(`Bitrix search/header disappeared: ${report.hiddenHeaderFrames} frames`);
  if (report.fullWidthManagedFrames) violations.push(`managed list used page width: ${report.fullWidthManagedFrames} frames, max ${report.maxManagedWidth}px`);
  if (report.fullWidthPanelFrames) violations.push(`native controls used page width: ${report.fullWidthPanelFrames} frames, max ${report.maxPanelWidth}px`);
  assert.ok(report.final, `No final layout sample: ${diagnostic}`);
  assert.equal(report.final.chat.width, report.constants.FINAL_CHAT_WIDTH, `Final chat column width is wrong: ${diagnostic}`);
  if (expectActive) {
    assert.equal(report.maxManagedCount, 1, `Managed viewport was duplicated: ${diagnostic}`);
    assert.equal(report.maxPanelCount, 1, `Native controls were duplicated: ${diagnostic}`);
    assert.equal(report.final.managed.visible, true, `Managed chats did not become visible after final layout: ${diagnostic}`);
    assert.equal(report.final.panel.visible, true, `Native controls did not become visible after final layout: ${diagnostic}`);
    assert.ok(report.final.managed.width <= report.constants.FINAL_CHAT_WIDTH + 1, `Managed chats exceed the final column: ${diagnostic}`);
    assert.ok(report.final.panel.width <= report.constants.FINAL_CHAT_WIDTH + 1, `Native controls exceed the final column: ${diagnostic}`);
    assert.equal(report.final.managed.left, report.final.chat.left, `Managed chats are horizontally displaced: ${diagnostic}`);
    assert.equal(report.final.panel.left, report.final.chat.left, `Native controls are horizontally displaced: ${diagnostic}`);
    assert.equal(report.activeContext?.listIsSource, true, `Lifecycle selected a stale list: ${diagnostic}`);
    assert.equal(report.activeContext?.viewportIsSource, true, `Lifecycle selected a viewport from another list: ${diagnostic}`);
  } else {
    assert.equal(report.maxManagedCount, 0, `Managed viewport mounted into an unknown host: ${diagnostic}`);
    assert.equal(report.maxPanelCount, 0, `Native controls mounted into an unknown host: ${diagnostic}`);
    assert.equal(report.final.nativeMode, false, `Native mode committed for an unknown host: ${diagnostic}`);
    assert.equal(report.final.source.visible, true, `Bitrix source list was lost for an unknown host: ${diagnostic}`);
  }
  assert.equal(report.panelFaults, expectedFaults, `Render-fault scenario did not execute as expected: ${diagnostic}`);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(violations, [], `Cold-start layout takeover reproduced:\n- ${violations.join('\n- ')}\n${diagnostic}`);
  await page.close();
};

try {
  await runScenario();
  await runScenario({ query: '?panelFault=1', expectedFaults: 1 });
  await runScenario({ query: '?compatibleHost=1' });
  await runScenario({ query: '?compatibleViewport=1' });
  await runScenario({ query: '?liveViewport=1' });
  await runScenario({ query: '?deepList=1' });
  await runScenario({ query: '?unsafeHost=1', expectActive: false });
  await runScenario({ query: '?standalone=1' });
  console.log('PASS native cold start: extension waits for final Bitrix layout and stays inside the chat column');
} finally {
  await browser.close();
  await server.close();
}

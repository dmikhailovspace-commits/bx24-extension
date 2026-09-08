import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });

const verifyPanelGeometry = async () => {
  const page = await browser.newPage();
  const source = readFileSync(new URL('../extension/injected.js', import.meta.url), 'utf8');
  const at = source.indexOf('\tfunction _syncDialogControlNativePanelGeometry(');
  assert(at >= 0);
  await page.setContent('<style>.host{width:240px}.panel{height:40px;padding:4px;border:2px solid;box-sizing:content-box}.viewport{height:100px;overflow:auto;scrollbar-gutter:stable}</style><div id="a" class="host"><div id="panel" class="panel"></div><div class="viewport pena-native-list-scroll-viewport"><div style="height:500px"></div></div></div><div id="b" class="host"></div>');
  await page.addScriptTag({ content:source.slice(at, source.indexOf('\n\t}', at) + 4) });
  await page.evaluate(() => {
    const nativeObserver = ResizeObserver;
    window.geometryObservers = [];
    window.ResizeObserver = class extends nativeObserver {
      constructor(callback) { super(callback); this.deliver = callback; geometryObservers.push(this); }
    };
    const panel = document.getElementById('panel');
    Object.defineProperty(window, 'panel', { value:panel, configurable:true });
    window.geometryReads = 0;
    const rect = panel.getBoundingClientRect.bind(panel);
    panel.getBoundingClientRect = () => { geometryReads++; return rect(); };
    _syncDialogControlNativePanelGeometry(panel);
    for (let i = 0; i < 100; i++) { panel.dataset.tick = String(i); _syncDialogControlNativePanelGeometry(panel); }
  });
  const height = value => page.waitForFunction(expected => document.getElementById('panel').parentElement.style.getPropertyValue('--pena-native-panel-height') === `${expected}px`, value);
  await height(52);
  assert.equal(await page.evaluate(() => geometryReads), 1, 'Stable geometry repeatedly forced a layout measurement');
  await page.evaluate(() => { panel.style.height = '64.25px'; _syncDialogControlNativePanelGeometry(panel); });
  await height(77);
  await page.evaluate(() => { panel.style.borderWidth = '3px'; });
  await height(79);
  await page.evaluate(() => { panel.style.padding = '8px'; });
  await height(87);
  const gutter = await page.locator('.viewport').evaluate(node => ({ width:node.clientWidth, scroll:node.scrollHeight }));
  await page.evaluate(() => { panel.style.transform = 'scale(.5)'; _syncDialogControlNativePanelGeometry(panel); });
  await page.waitForTimeout(35);
  await height(87);
  assert.equal(await page.evaluate(() => geometryReads), 1, 'ResizeObserver border-box updates must not read layout');
  assert.deepEqual(await page.locator('.viewport').evaluate(node => ({ width:node.clientWidth, scroll:node.scrollHeight })), gutter);
  await page.evaluate(() => { panel.style.display = 'none'; });
  await height(0);
  await page.evaluate(() => { panel.style.display = ''; });
  await height(87);
  assert.equal(await page.evaluate(() => geometryReads), 1, 'Hide/show must restore the actual border box without synchronous layout reads');
  const replacementHeight = await page.evaluate(() => {
    panel.style.transform = '';
    const oldViewport = document.querySelector('.viewport');
    const replacement = oldViewport.cloneNode(true);
    const oldObserver = geometryObservers.at(-1);
    oldViewport.replaceWith(replacement);
    _syncDialogControlNativePanelGeometry(panel, replacement);
    oldObserver.deliver([{ target:panel, borderBoxSize:[{blockSize:999}] }]);
    for (let i = 0; i < 25; i++) _syncDialogControlNativePanelGeometry(panel, replacement);
    return panel.parentElement.style.getPropertyValue('--pena-native-panel-height');
  });
  assert.equal(replacementHeight, '87px', 'Replaced-viewport observer changed the host before the current observer could run');
  await height(87);
  assert.equal(await page.evaluate(() => geometryReads), 2, 'Same-host viewport replacement must remeasure once, then reuse the new cache');
  assert.equal(await page.evaluate(() => geometryObservers.length), 2, 'Viewport replacement did not install exactly one new observer');
  assert.deepEqual(await page.locator('.viewport').evaluate(node => ({ width:node.clientWidth, scroll:node.scrollHeight })), gutter);
  const relocatedHeight = await page.evaluate(() => {
    panel.style.transform = '';
    const viewport = document.querySelector('.viewport');
    const oldObserver = geometryObservers.at(-1);
    b.append(panel, viewport); _syncDialogControlNativePanelGeometry(panel);
    oldObserver.deliver([{ target:panel, borderBoxSize:[{blockSize:999}] }]);
    return panel.parentElement.style.getPropertyValue('--pena-native-panel-height');
  });
  assert.equal(relocatedHeight, '87px', 'Previous-host observer changed the new host before the current observer could run');
  await height(87);
  assert.equal(await page.evaluate(() => geometryReads), 3, 'Relocation must remeasure exactly once');
  const detached = await page.evaluate(() => { panel.remove(); geometryObservers.at(-1).deliver([{target:panel,borderBoxSize:[{blockSize:777}]}]); return b.style.getPropertyValue('--pena-native-panel-height'); });
  assert.equal(detached, '87px', 'A detached observer changed the former host');
  await page.evaluate(() => {
    b.prepend(panel); panel._penaNativeResizeObserver.disconnect(); panel._penaNativeResizeObserver = null;
    window.ResizeObserver = undefined; _syncDialogControlNativePanelGeometry(panel);
    panel.style.height = '70px'; _syncDialogControlNativePanelGeometry(panel);
  });
  await height(92);
  assert.equal(await page.evaluate(() => geometryReads), 5, 'No-observer compatibility fallback lost live geometry');
  const report = { stableCalls:101, stableLayoutReads:1, resizeLayoutReads:0, relocationLayoutReads:1, borderAndPaddingResize:true, transformedLayoutBoxPreserved:true, hideShowRestored:true, hideShowLayoutReads:0, viewportReplacementLayoutReads:1, replacementStableCalls:25, replacementObserverCount:2, replacedViewportStaleObserverIgnored:true, staleObserverIgnored:true, gutterPreserved:true, noObserverFallback:true };
  writeFileSync(new URL('./artifacts/native-panel-geometry-report.json', import.meta.url), JSON.stringify(report,null,2));
  await page.close();
};

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
    assert.equal(
      report.activeContext?.viewportIsSource || report.activeContext?.viewportIsManaged,
      true,
      `Lifecycle selected a viewport from another list: ${diagnostic}`
    );
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
  await verifyPanelGeometry();
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

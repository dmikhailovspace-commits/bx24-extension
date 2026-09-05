import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
const server = await startHarnessServer(), browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 780 } });
const errors = collectPageErrors(page), phases = [];
const ready = mode => page.waitForFunction(mode => {
  const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
  return window.__resumeHarness?.ready(mode) && !status.originalActive && !status.modeLoadPending;
}, mode, { timeout: 35000 });
const verify = async mode => {
  await ready(mode);
  const state = await page.evaluate(() => window.__resumeHarness.state());
  const source = state.modes[mode], materialization = state.status.modeStates[mode].materialization;
  assert.deepEqual(source.catalogIds.slice().sort(), source.expectedIds.slice().sort());
  assert.deepEqual(materialization.tailIds.slice().sort(), source.expectedIds.slice(-5).sort());
  assert.equal(source.connectedPool, 24, 'must use recycled Bitrix rows');
  assert.equal(state.guardVisible, false);
  assert.equal(source.scrollTop, mode === 'chats' ? 3377 : 2453, 'restore exact initial anchor');
  return state;
};
try {
  const at = Date.now();
  await page.goto(server.baseUrl + '/tests/native-resume-recovery-harness.html?autoBootstrap=1&coldRangeDelayMs=1300&coldRangeRows=72');
  assert.equal(await page.evaluate(() => window.__PENA_TEST_EAGER_MATERIALIZATION__), undefined);
  assert.equal(await page.evaluate(() => window.__PENA_TEST_NATIVE_EXPECTED_AUDIT__), undefined);
  const chats = await verify('chats');
  phases.push({ name: 'fresh install automatically discovers delayed older chats', ms: Date.now() - at, count: chats.modes.chats.catalogIds.length });
  assert.equal(chats.status.modeStates.tasks?.materialization?.count || 0, 0, 'hidden task list must not be traversed');
  const taskAt = Date.now();
  await page.evaluate(() => window.__resumeHarness.switchMode('tasks'));
  const tasks = await verify('tasks');
  phases.push({ name: 'first task-list opening automatically hydrates its source', ms: Date.now() - taskAt, count: tasks.modes.tasks.catalogIds.length });
  const before = tasks.status.modeStates;
  const callsBefore = tasks.restCalls.filter(call => call.method === 'im.recent.list').length;
  for (const mode of ['chats', 'tasks', 'chats']) {
    await page.evaluate(mode => window.__resumeHarness.switchMode(mode), mode);
    await verify(mode);
    await page.waitForTimeout(500);
  }
  const after = await page.evaluate(() => window.__resumeHarness.state());
  for (const mode of ['chats', 'tasks']) assert.equal(after.status.modeStates[mode].materialization.revision, before[mode].materialization.revision, 'warm switches must not rematerialize');
  assert.equal(after.restCalls.filter(call => call.method === 'im.recent.list').length, callsBefore, 'warm switches must not repeat full metadata audit');
  phases.push({ name: 'three warm switches preserve physical revision and REST audit', status: 'PASS' });
  assert.deepEqual(errors, []);
  console.log('PASS automatic first-open:', JSON.stringify(phases));
} finally {
  mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./artifacts/first-open-report.json', import.meta.url), JSON.stringify({ phases, errors, state: await page.evaluate(() => window.__resumeHarness?.state()).catch(() => null) }, null, 2));
  await browser.close(); await server.close();
}

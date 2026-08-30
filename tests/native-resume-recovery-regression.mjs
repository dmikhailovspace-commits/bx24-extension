import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 780 } });
const pageErrors = collectPageErrors(page);
const state = () => page.evaluate(() => window.__resumeHarness.state());

const compact = value => JSON.stringify(value, (key, item) => {
  if (['expectedIds', 'observedIds', 'catalogIds', 'positions', 'restCalls'].includes(key) && Array.isArray(item)) {
    return { count: item.length, first: item.slice(0, 3), last: item.slice(-3) };
  }
  return item;
});

const waitReady = async (mode, timeout = 30000) => {
  try {
    await page.waitForFunction(targetMode => window.__resumeHarness?.ready(targetMode) === true, mode, { timeout });
  } catch (error) {
    throw new Error(`${mode} did not reach catalog/materialization/attempt ready: ${compact(await state())}`, { cause: error });
  }
};

const waitActiveMode = async (mode, timeout = 6000) => {
  await page.waitForFunction(targetMode =>
    window.__resumeHarness?.state().activeMode === targetMode &&
    window.__PENA_ACTIVE_LIST_CONTEXT__?.mode === targetMode,
  mode, { timeout });
};

const waitReconcileAfter = async (count, timeout = 8000) => {
  await page.waitForFunction(previous =>
    Number(window.__PENA_NATIVE_PREFETCH__?.status?.()?.reconcile?.count) >= previous + 1,
  count, { timeout });
};

const waitAttemptMatches = async (mode, pattern, timeout = 8000) => {
  await page.waitForFunction(({ targetMode, source }) => {
    const value = String(window.__PENA_NATIVE_PREFETCH__?.status?.()?.modeStates?.[targetMode]?.attempt?.state || '');
    return new RegExp(source, 'i').test(value);
  }, { targetMode: mode, source: pattern.source }, { timeout });
};

const assertModeDiagnostics = (snapshot, mode, label) => {
  const diagnostic = snapshot.status?.modeStates?.[mode];
  assert.ok(diagnostic?.catalog, `${label}: catalog diagnostics are missing: ${compact(snapshot.status)}`);
  assert.ok(diagnostic?.materialization, `${label}: materialization diagnostics are missing: ${compact(snapshot.status)}`);
  assert.ok(diagnostic?.attempt, `${label}: attempt diagnostics are missing: ${compact(snapshot.status)}`);
  assert.equal(typeof diagnostic.catalog.fresh, 'boolean', `${label}: catalog freshness is not explicit`);
  assert.ok(Number(diagnostic.catalog.lastSuccessAt) > 0, `${label}: catalog success timestamp is missing`);
  assert.match(String(diagnostic.materialization.state || ''), /ready|complete|valid/i, `${label}: materialization is not ready`);
  assert.ok(Number(diagnostic.materialization.validatedAt) > 0, `${label}: materialization validation timestamp is missing`);
  assert.doesNotMatch(String(diagnostic.attempt.state || ''), /running|loading|probing|scrolling|verifying|paused|retry|failed|timeout/i,
    `${label}: recovery attempt did not settle cleanly: ${compact(diagnostic)}`);
  assert.ok(diagnostic.materialization.sourceGeneration !== undefined && diagnostic.materialization.sourceGeneration !== null,
    `${label}: source generation is missing`);
};

const assertUiState = (actual, mode, label) => {
  assert.equal(actual.ui.query, 'needle', `${label}: ${mode} search query was reset`);
  assert.equal(actual.ui.inputValue, 'needle', `${label}: ${mode} native search field lost its value`);
  assert.equal(actual.ui.folderId, `folder:resume-${mode}`, `${label}: ${mode} folder was reset`);
  assert.equal(actual.ui.sortMode, 'color', `${label}: ${mode} sort mode was reset`);
  assert.equal(actual.ui.sortDirection, 'asc', `${label}: ${mode} sort direction was reset`);
};

const assertAnchor = (actual, expected, label) => {
  assert.equal(actual.id, expected.id, `${label}: ID anchor changed: ${compact({ actual, expected })}`);
  assert.ok(Math.abs(actual.offset - expected.offset) < 0.6, `${label}: anchor pixel offset changed: ${compact({ actual, expected })}`);
  assert.ok(Math.abs(actual.scrollTop - expected.scrollTop) < 0.6, `${label}: scrollTop changed: ${compact({ actual, expected })}`);
};

const assertStableNativeSource = (snapshot, mode, label, options = {}) => {
  const actual = snapshot.modes[mode];
  assert.equal(actual.poolSize, 24, `${label}: harness pool is not production-sized`);
  assert.equal(actual.connectedPool, 24, `${label}: Bitrix row pool was detached`);
  assert.equal(actual.uniquePoolSlots, 24, `${label}: Bitrix row pool was duplicated`);
  assert.equal(actual.nativeRows, 24, `${label}: native row count changed`);
  assert.equal(actual.replacementRows, 0, `${label}: extension created replacement rows`);
  assert.equal(actual.scrollHeight, actual.expectedScrollHeight, `${label}: virtual scrollHeight is inconsistent`);
  const expectedHeightValues = actual.coldRange?.configuredMs > 0
    ? [actual.coldRange.initialCount * 58, actual.expectedScrollHeight]
    : [actual.expectedScrollHeight];
  assert.deepEqual(actual.heightValues, expectedHeightValues, `${label}: scrollHeight changed outside the declared physical range release`);
  assert.match(actual.overflowY, /auto|scroll/, `${label}: native scrollbar was disabled`);
  assert.equal(actual.sourceComplete, true, `${label}: traversal missed source IDs: ${compact(actual)}`);
  assert.equal(actual.catalogComplete, true, `${label}: catalog does not contain the full source ID set: ${compact(actual)}`);
  assert.equal(snapshot.visibleSwitchers, 1, `${label}: active native panel count changed`);
  assert.equal(snapshot.switchers, 1, `${label}: duplicate native panels remain`);
  if (options.ui !== false) assertUiState(actual, mode, label);
  assertModeDiagnostics(snapshot, mode, label);
  assert.equal(Number(snapshot.status.modeStates[mode].materialization.count), actual.expectedIds.length,
    `${label}: materialization count belongs to a different source generation`);
};

const assertNoForeignIds = (snapshot, label) => {
  const chatIds = new Set(snapshot.modes.chats.observedIds);
  const taskIds = new Set(snapshot.modes.tasks.observedIds);
  const overlap = [...chatIds].filter(id => taskIds.has(id));
  assert.deepEqual(overlap, [], `${label}: chats/tasks native sources leaked into each other`);
};

try {
  await page.goto(`${server.baseUrl}/tests/native-resume-recovery-harness.html?coldStallMs=760&coldRangeDelayMs=1300&coldRangeRows=72&coldBottomFreezeMs=900`);
  await page.locator('.recent-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForFunction(() => window.__resumeHarness?.state().modes.chats.coldRange.scheduledAt > 0, null, { timeout: 10000 });
  await page.waitForTimeout(850);
  const delayedRangeInterim = await state();
  assert.equal(delayedRangeInterim.modes.chats.coldRange.releasedAt, 0,
    `Cold range was released before its 1300ms delay: ${compact(delayedRangeInterim.modes.chats.coldRange)}`);
  assert.equal(delayedRangeInterim.guardVisible, true,
    `Cold delayed range lost the visual guard: ${compact(delayedRangeInterim.status)}`);
  assert.equal(delayedRangeInterim.status.originalActive, true,
    `Cold delayed range stopped its native traversal early: ${compact(delayedRangeInterim.status)}`);
  assert.doesNotMatch(String(delayedRangeInterim.status.modeStates?.chats?.materialization?.state || ''), /ready|complete|valid/i,
    `Cold partial range was certified ready before release: ${compact(delayedRangeInterim.status.modeStates?.chats)}`);
  await waitReady('chats', 35000);
  await page.waitForTimeout(520);

  let snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'initial chats');
  assert.equal(snapshot.modes.chats.coldStall.supported, true, 'Cold-stall fixture could not intercept scrollTop');
  assert.equal(snapshot.modes.chats.coldStall.consumed, true, 'Cold traversal never encountered the temporary Bitrix stall');
  assert.ok(snapshot.modes.chats.coldStall.rejectedWrites >= 3,
    `Cold traversal did not retry the stalled physical viewport: ${compact(snapshot.modes.chats.coldStall)}`);
  assert.ok(snapshot.modes.chats.coldStall.elapsedMs >= 620,
    `Cold traversal escaped the >620ms stall too early: ${compact(snapshot.modes.chats.coldStall)}`);
  assert.ok(snapshot.modes.chats.coldRange.releasedAt > 0 && snapshot.modes.chats.coldRange.elapsedMs >= 1200,
    `Cold physical range did not retain its delayed page: ${compact(snapshot.modes.chats.coldRange)}`);
  assert.ok(snapshot.modes.chats.coldRange.freezeElapsedMs >= 800,
    `Cold bottom proof did not cross the frozen interval: ${compact(snapshot.modes.chats.coldRange)}`);
  assert.ok(snapshot.modes.chats.coldRange.initialCount < snapshot.modes.chats.expectedIds.length &&
    snapshot.modes.chats.physicalCount === snapshot.modes.chats.expectedIds.length,
    `Cold physical range did not expand to the exact source: ${compact(snapshot.modes.chats)}`);
  assert.equal(snapshot.nativeScrollDebug.atBottom, true,
    `Cold traversal did not stop at the physical bottom: ${compact(snapshot.nativeScrollDebug)}`);
  assert.ok(Math.abs(Number(snapshot.nativeScrollDebug.scrollTop) -
    Math.max(0, Number(snapshot.nativeScrollDebug.scrollHeight) - Number(snapshot.nativeScrollDebug.clientHeight))) < 2,
    `Cold traversal certified a non-bottom scroll position: ${compact(snapshot.nativeScrollDebug)}`);
	assert.ok(snapshot.nativeBottomDebug.cold && snapshot.nativeBottomDebug.stable &&
		snapshot.nativeBottomDebug.requiredQuietMs === 0 && snapshot.nativeBottomDebug.quietMs === 0 &&
		snapshot.nativeBottomDebug.samples >= 2 && snapshot.nativeBottomDebug.seenCount === 108 &&
		snapshot.nativeBottomDebug.expectedCount === 108 && snapshot.nativeBottomDebug.missingExpectedCount === 0,
		`Cold traversal lacked conservative bottom proof: ${compact(snapshot.nativeBottomDebug)}`);
  assert.ok(snapshot.nativeBottomDebug.wallMs - snapshot.nativeBottomDebug.activeMs >= 800,
    `Cold bottom quiet charged frozen wall time: ${compact(snapshot.nativeBottomDebug)}`);
  assert.equal(snapshot.modes.chats.reusePasses > 0, true, 'Initial materialization did not recycle the fixed native pool');
  assert.equal(snapshot.modes.chats.anchor.index, 58, `Initial chat anchor index changed: ${compact(snapshot.modes.chats.anchor)}`);
  assert.ok(Math.abs(snapshot.modes.chats.anchor.offset - 13) < 0.6, `Initial chat anchor offset changed: ${compact(snapshot.modes.chats.anchor)}`);
  const initialTrace = await page.evaluate(() => window.__resumeHarness.delta('chats', {
    audit: 0, renders: 0, guardActivations: 0, restCalls: 0, reconcileCount: 0
  }));
  assert.equal(initialTrace.materialization.fullWalks, 1, `Direct first-open did not traverse the fixed native source once: ${compact(initialTrace)}`);
  assert.equal(initialTrace.movement.unguarded, 0, `Direct first-open exposed mechanical scrolling: ${compact(initialTrace)}`);
  assert.ok(initialTrace.tail.confirmedRenders >= 1, `Direct first-open missed the five oldest IDs: ${compact(initialTrace)}`);
  const chatAnchor = snapshot.modes.chats.anchor;

  // Focus, resize and a short hidden interval may reconcile metadata, but may not move the feed.
  let mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  await page.evaluate(() => window.__resumeHarness.ordinaryEventBurst());
  await page.waitForTimeout(650);
  let delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.movement.movements, 0, `Ordinary lifecycle events moved the viewport: ${compact(delta)}`);
  assert.equal(delta.movement.fullWalks, 0, `Ordinary lifecycle events started a native traversal: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'ordinary lifecycle events');
  snapshot = await state();
  assertUiState(snapshot.modes.chats, 'chats', 'ordinary lifecycle events');

  // A burst representing one healthy long resume must deduplicate to one reconcile and one short tail probe.
  mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  await page.evaluate(() => window.__resumeHarness.longPauseBurst());
  await waitReconcileAfter(mark.reconcileCount);
  await waitReady('chats');
  await page.waitForTimeout(420);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.reconcileCount, 1, `Lifecycle burst created more than one reconcile: ${compact(delta)}`);
  assert.equal(delta.materialization.fullWalks, 0, `Healthy resume triggered a full native traversal: ${compact(delta)}`);
  assert.equal(delta.movement.bottomVisits, 1, `Healthy resume did not use exactly one tail probe: ${compact(delta)}`);
  assert.ok(delta.movement.events <= 4, `Healthy tail probe scrolled too many times: ${compact(delta)}`);
  assert.ok(delta.tail.confirmedRenders >= 1, `Healthy tail probe did not render all five saved tail IDs: ${compact(delta)}`);
  assert.equal(delta.tail.missingRenders, 0, `Healthy tail probe lost a saved tail ID: ${compact(delta)}`);
  assert.equal(delta.movement.unguarded, 0, `Healthy tail probe was visually exposed: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'healthy resume');
  snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'healthy resume');

  // Losing even one saved tail anchor is not a healthy 3/5 quorum. Every missing
  // ID is checked for availability; because these fixtures remain available, the
  // source must perform one guarded full walk and recover the exact physical set.
  for (const lossCount of [1, 2]) {
    const partial = await page.evaluate(count => {
      const saved = window.__resumeHarness.mark('chats');
      const fixture = window.__resumeHarness.partialTailLoss('chats', count);
      window.__resumeHarness.longPauseBurst();
      return { saved, fixture };
    }, lossCount);
    mark = partial.saved;
    await waitReconcileAfter(mark.reconcileCount);
    await waitReady('chats', 30000);
    await page.waitForTimeout(420);
    delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
    assert.equal(delta.reconcileCount, 1, `Partial ${lossCount}/5 tail loss escaped reconcile deduplication: ${compact(delta)}`);
    assert.equal(delta.materialization.fullWalks, 1,
      `Partial ${lossCount}/5 tail loss was accepted without one full traversal: ${compact(delta)}`);
    assert.equal(delta.recoveries, 1, `Partial ${lossCount}/5 source recovered more than once: ${compact(delta)}`);
    assert.ok(delta.tail.missingRenders >= 1,
      `Partial ${lossCount}/5 fixture did not expose its missing tail: ${compact(delta)}`);
    assert.ok(delta.tail.confirmedRenders >= 1,
      `Partial ${lossCount}/5 recovery did not restore all five tail IDs: ${compact(delta)}`);
    partial.fixture.missingIds.forEach(id => {
      assert.equal(delta.tail.verificationIds.includes(id), true,
        `Missing tail ID ${id} was not checked for availability: ${compact(delta.tail)}`);
    });
    assert.equal(delta.movement.unguarded, 0,
      `Partial ${lossCount}/5 recovery exposed mechanical scrolling: ${compact(delta)}`);
    assertAnchor(delta.anchor, chatAnchor, `partial ${lossCount}/5 tail recovery`);
    snapshot = await state();
    assert.equal(snapshot.modes.chats.partialTailLossCount, 0, `Partial ${lossCount}/5 loss remained active`);
    assertStableNativeSource(snapshot, 'chats', `partial ${lossCount}/5 tail recovery`);
  }

  // A source remount while the tail probe awaits availability must fence the old
  // probe. It may neither validate the detached generation nor restore its anchor
  // into the replacement source, and recovery must not wait for the hard timeout.
  const tailFenceRace = await page.evaluate(() => {
    const before = window.__resumeHarness.state();
    window.__resumeHarness.setDialogDetailDelay(1600);
    const saved = window.__resumeHarness.mark('chats');
    window.__resumeHarness.partialTailLoss('chats', 1);
    window.__resumeHarness.longPauseBurst();
    return {
      saved,
      detailRequestsStarted: before.dialogDetailRequestsStarted,
      materializationGeneration: before.status.modeStates.chats.materialization.sourceGeneration
    };
  });
  await page.waitForFunction(started =>
    window.__resumeHarness.state().dialogDetailRequestsStarted > started,
  tailFenceRace.detailRequestsStarted, { timeout: 8000 });
  const tailFenceRemountAt = Date.now();
  await page.evaluate(({ index, offset }) => {
    window.__resumeHarness.replaceSource('chats', { scrollTop: index * 58 + offset });
    window.__resumeHarness.setDialogDetailDelay(0);
  }, chatAnchor);
  await waitReady('chats', 12000);
  await page.waitForTimeout(420);
  snapshot = await state();
  assert.ok(Date.now() - tailFenceRemountAt < 8000,
    `Replacement source waited for the stale probe/hard timeout: ${compact(snapshot.status)}`);
  assert.notEqual(snapshot.status.modeStates.chats.materialization.sourceGeneration,
    tailFenceRace.materializationGeneration,
    `Stale tail probe certified its detached source: ${compact(snapshot.status.modeStates.chats)}`);
  assertAnchor(snapshot.modes.chats.anchor, chatAnchor, 'tail verify source fence');
  assertStableNativeSource(snapshot, 'chats', 'tail verify source fence');

  // Same-node collapse loses the saved tail. Freeze in the middle of the ensuing full pass;
  // timeout and scrolling must both pause, then continue the same fenced attempt.
  mark = await page.evaluate(() => {
    const saved = window.__resumeHarness.mark('chats');
    window.__resumeHarness.setTraversalTimeout(5000);
    window.__resumeHarness.collapseSameNode('chats', { autoFreeze: true });
    window.__resumeHarness.longPauseBurst();
    return saved;
  });
  await page.waitForFunction(() => {
    const current = window.__resumeHarness.state();
    return current.frozen && current.modes.chats.fullWalkStarted && current.modes.chats.autoFreezeTriggered;
  }, null, { timeout: 15000 });
  await waitAttemptMatches('chats', /paused/, 5000);
  await page.waitForTimeout(180);
  const frozenAuditLength = (await state()).modes.chats.scrollAuditLength;
  await page.waitForTimeout(5300);
  snapshot = await state();
  assert.equal(snapshot.modes.chats.scrollAuditLength, frozenAuditLength, `Frozen traversal kept scrolling: ${compact(snapshot.modes.chats)}`);
  assert.match(String(snapshot.status.modeStates.chats.attempt.state || ''), /paused/i, 'Frozen attempt consumed its timeout instead of pausing');
  assert.equal(snapshot.modes.chats.catalogComplete, true, 'Freeze discarded the last confirmed catalog');
  assertUiState(snapshot.modes.chats, 'chats', 'frozen traversal');

  await page.evaluate(() => {
    window.__resumeHarness.thaw();
    window.__resumeHarness.setTraversalTimeout(10000);
  });
  await waitReady('chats', 30000);
  await page.waitForTimeout(420);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.materialization.fullWalks, 1, `Collapsed source did not complete exactly one full traversal: ${compact(delta)}`);
  assert.ok(delta.tail.missingRenders >= 1, `Collapsed source did not expose a missing saved tail: ${compact(delta)}`);
  assert.ok(delta.tail.confirmedRenders >= 1, `Full recovery did not restore all five saved tail IDs: ${compact(delta)}`);
  assert.equal(delta.movement.unguarded, 0, `Collapse recovery exposed mechanical scrolling: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'freeze resume');
  snapshot = await state();
  assert.equal(snapshot.modes.chats.collapsed, false, 'Same-node source remained collapsed');
  assert.equal(delta.recoveries, 1, `Same-node source was materialized more than once: ${compact(delta)}`);
  assertStableNativeSource(snapshot, 'chats', 'same-node freeze recovery');

  // Offline failure keeps the valid catalog and schedules retry. Online bypasses the delay.
  mark = await page.evaluate(() => {
    const saved = window.__resumeHarness.mark('chats');
    window.__resumeHarness.goOffline();
    window.__resumeHarness.longPauseBurst();
    return saved;
  });
  await page.waitForFunction(restStart =>
    window.__resumeHarness.state().restCalls.slice(restStart).some(call => call.online === false),
  mark.restCalls, { timeout: 8000 });
  await waitAttemptMatches('chats', /offline|retry|waiting|scheduled/, 8000);
  snapshot = await state();
  assert.equal(snapshot.modes.chats.catalogComplete, true, 'Offline reconcile erased the valid catalog');
  assert.equal(snapshot.modes.chats.sourceComplete, true, 'Offline reconcile invalidated the confirmed native source');
  assertUiState(snapshot.modes.chats, 'chats', 'offline retry');
  assertAnchor(snapshot.modes.chats.anchor, chatAnchor, 'offline retry');
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.materialization.fullWalks, 0, `Offline metadata failure triggered native traversal: ${compact(delta)}`);

  const onlineRestStart = snapshot.restCalls.length;
  await page.evaluate(() => window.__resumeHarness.goOnline());
  await page.waitForFunction(restStart =>
    window.__resumeHarness.state().restCalls.slice(restStart).some(call => call.online === true),
  onlineRestStart, { timeout: 5000 });
  await waitReady('chats', 15000);
  snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'online recovery');
  assertAnchor(snapshot.modes.chats.anchor, chatAnchor, 'online recovery');

  // An active timeout preserves the last catalog, enters bounded retry, and then
  // rematerializes automatically without another user lifecycle event.
  mark = await page.evaluate(() => {
    const saved = window.__resumeHarness.mark('chats');
    window.__resumeHarness.collapseSameNode('chats');
    window.__resumeHarness.blockMaterialization('chats', true);
    window.__resumeHarness.setTraversalTimeout(650);
    window.__resumeHarness.longPauseBurst();
    return saved;
  });
  await waitAttemptMatches('chats', /retry|waiting|scheduled/, 12000);
  await page.waitForTimeout(260);
  snapshot = await state();
  assert.equal(snapshot.modes.chats.catalogComplete, true, 'Timed-out traversal erased the last confirmed catalog');
  assert.equal(snapshot.modes.chats.sourceComplete, false, 'Blocked timeout fixture unexpectedly materialized the source');
  assert.ok(Number(snapshot.status.modeStates.chats.attempt.retryAttempt) >= 1, 'Timeout did not increment the retry attempt');
  assert.ok(Number(snapshot.status.modeStates.chats.attempt.retryAt) > snapshot.now, 'Timeout did not schedule a future retry');
  assertUiState(snapshot.modes.chats, 'chats', 'timeout retry');
  assertAnchor(snapshot.modes.chats.anchor, chatAnchor, 'timeout retry');

  await page.evaluate(() => {
    window.__resumeHarness.blockMaterialization('chats', false);
    window.__resumeHarness.setTraversalTimeout(10000);
  });
  await waitReady('chats', 30000);
  await page.waitForTimeout(420);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.ok(delta.materialization.fullWalks >= 2, `Timeout did not produce a bounded retry traversal: ${compact(delta)}`);
  assert.ok(delta.tail.missingRenders >= 1, `Timed-out attempt did not prove the tail was missing: ${compact(delta)}`);
  assert.ok(delta.tail.confirmedRenders >= 1, `Retry did not restore all saved tail IDs: ${compact(delta)}`);
  assert.equal(delta.movement.unguarded, 0, `Timeout/retry exposed mechanical scrolling: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'timeout automatic retry');
  snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'timeout automatic retry');

  // Replace the source while its old generation is traversing. The old fenced attempt
  // may not publish ready; the replacement itself requires one complete pass.
  const oldDiagnosticGeneration = snapshot.status.modeStates.chats.materialization.sourceGeneration;
  await page.evaluate(() => {
    window.__resumeHarness.collapseSameNode('chats');
    window.__resumeHarness.longPauseBurst();
  });
  await page.waitForFunction(() => {
    const current = window.__resumeHarness.state();
    return current.modes.chats.fullWalkStarted && current.modes.chats.fullWalkSteps >= 2;
  }, null, { timeout: 15000 });
  mark = await page.evaluate(() => {
    const reconcileCount = Number(window.__PENA_NATIVE_PREFETCH__?.status?.()?.reconcile?.count) || 0;
    window.__resumeHarness.replaceSource('chats', { scrollTop: 0 });
    const next = window.__resumeHarness.mark('chats');
    next.audit = 0;
    next.renders = 0;
    next.reconcileCount = reconcileCount;
    return next;
  });
  await waitActiveMode('chats');
  await waitReady('chats', 30000);
  await page.waitForTimeout(420);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.materialization.fullWalks, 1, `Replacement source was certified without one full traversal: ${compact(delta)}`);
  assert.ok(delta.tail.confirmedRenders >= 1, `Replacement traversal missed saved tail IDs: ${compact(delta)}`);
  assert.equal(delta.movement.unguarded, 0, `Replacement-source traversal was visually exposed: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'source replacement');
  snapshot = await state();
  assert.notEqual(snapshot.status.modeStates.chats.materialization.sourceGeneration, oldDiagnosticGeneration,
    'Replacement source kept the previous materialization generation');
  assertStableNativeSource(snapshot, 'chats', 'source replacement');

  // A quick chats -> tasks -> chats transition cancels stale work. Each mode remains isolated;
  // a later real task entry performs its own one-time materialization.
  mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  await page.evaluate(() => window.__resumeHarness.switchMode('tasks'));
  await page.waitForTimeout(55);
  await page.evaluate(() => window.__resumeHarness.switchMode('chats'));
  await waitActiveMode('chats');
  await waitReady('chats', 12000);
  await page.waitForTimeout(320);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.materialization.fullWalks, 0, `Rapid mode bounce rematerialized stable chats: ${compact(delta)}`);
  snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'rapid mode bounce');

  mark = await page.evaluate(() => window.__resumeHarness.mark('tasks'));
  await page.evaluate(() => window.__resumeHarness.switchMode('tasks'));
  await waitActiveMode('tasks');
  await waitReady('tasks', 35000);
  await page.waitForTimeout(420);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('tasks', saved), mark);
  assert.equal(delta.materialization.fullWalks, 1, `Task source did not receive exactly one native traversal: ${compact(delta)}`);
  assert.ok(delta.tail.confirmedRenders >= 1, `Task traversal missed the five oldest IDs: ${compact(delta)}`);
  assert.equal(delta.movement.unguarded, 0, `Task traversal was visually exposed: ${compact(delta)}`);
  snapshot = await state();
  assert.equal(snapshot.modes.tasks.anchor.index, 42,
    `Task anchor index changed: ${compact({ task: snapshot.modes.tasks, diagnostic: snapshot.status.modeStates?.tasks })}`);
  assert.ok(Math.abs(snapshot.modes.tasks.anchor.offset - 17) < 0.6,
    `Task anchor offset changed: ${compact({ task: snapshot.modes.tasks, diagnostic: snapshot.status.modeStates?.tasks })}`);
  const taskAnchor = snapshot.modes.tasks.anchor;
  assertStableNativeSource(snapshot, 'tasks', 'task materialization');
  assertNoForeignIds(snapshot, 'task materialization');

  mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  await page.evaluate(() => window.__resumeHarness.switchMode('chats'));
  await waitActiveMode('chats');
  await waitReady('chats', 12000);
  await page.waitForTimeout(320);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.materialization.fullWalks, 0, `Returning to a stable chat source triggered a traversal: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'return from tasks');
  snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'return from tasks');
  assertNoForeignIds(snapshot, 'final mode isolation');

  // Chromium may clamp scrollTop to zero while an ancestor is display:none. The
  // observable invariant is that the saved per-mode anchor returns on entry,
  // without rematerializing either already-confirmed native source.
  mark = await page.evaluate(() => window.__resumeHarness.mark('tasks'));
  await page.evaluate(() => window.__resumeHarness.switchMode('tasks'));
  await waitActiveMode('tasks');
  await waitReady('tasks', 12000);
  await page.waitForTimeout(320);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('tasks', saved), mark);
  assert.equal(delta.materialization.fullWalks, 0, `Re-entering stable tasks triggered a traversal: ${compact(delta)}`);
  assertAnchor(delta.anchor, taskAnchor, 'restored task anchor');
  snapshot = await state();
  assertStableNativeSource(snapshot, 'tasks', 'restored task anchor');
  assertNoForeignIds(snapshot, 'restored task isolation');

  mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  await page.evaluate(() => window.__resumeHarness.switchMode('chats'));
  await waitActiveMode('chats');
  await waitReady('chats', 12000);
  await page.waitForTimeout(320);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.materialization.fullWalks, 0, `Second chat return triggered a traversal: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'second chat return');
  snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'second chat return');
  assertNoForeignIds(snapshot, 'second chat isolation');

  const marker = await page.evaluate(() => window.__resumeHarness.markerGeometry('chats'));
  assert.equal(marker.rowFound, true, `Colored anchor row is missing: ${compact(marker)}`);
  assert.equal(marker.markerFound, true, `Color marker disappeared after recovery: ${compact(marker)}`);
  assert.equal(marker.aligned, true, `Color marker shifted away from the native avatar: ${compact(marker)}`);

  // Completeness is finally proven from the oldest real record, not flags or 24 DOM nodes.
  const oldest = await page.evaluate(() => window.__resumeHarness.oldest('chats'));
  const searchInput = page.locator('.recent-host input[type="search"]');
  await searchInput.click();
  await searchInput.press('Control+A');
  await page.keyboard.type(oldest.title);
  const oldestId = await page.evaluate(() => window.__resumeHarness.revealOldest('chats'));
  await page.waitForTimeout(260);
  await page.waitForFunction(() => window.__resumeHarness.oldestVisible('chats') === true, null, { timeout: 5000 });
  snapshot = await state();
  assert.equal(snapshot.modes.chats.observedIds.includes(oldestId), true, 'Oldest native dialog was not observed');
  assert.equal(snapshot.modes.chats.catalogIds.includes(oldestId), true, 'Oldest native dialog was not searchable from the catalog');
  assert.equal(snapshot.modes.chats.ui.folderId, 'folder:resume-chats', 'Oldest-dialog search reset the active folder');
  assert.match(snapshot.modes.chats.ui.query, /Самый старый needle chats/i, 'Oldest-dialog query was not retained by PENA search');
  assert.equal(snapshot.modes.chats.ui.inputValue, snapshot.modes.chats.ui.query, 'Native search field diverged from the retained query');
  assert.equal(snapshot.modes.chats.ui.sortMode, 'color', 'Oldest-dialog search reset sorting');
  assert.equal(snapshot.modes.chats.ui.sortDirection, 'asc', 'Oldest-dialog search reset sort direction');
  assert.equal(snapshot.modes.chats.replacementRows, 0, 'Oldest-dialog search created replacement rows');

  // Remount a truly cold source while it is waiting at a temporary physical
  // bottom for the delayed range. The detached pass must release promptly; the
  // replacement generation proves the exact set itself without a 120s stall.
  await page.goto(`${server.baseUrl}/tests/native-resume-recovery-harness.html?coldRangeDelayMs=3500&coldRangeRows=72`);
  await page.locator('.recent-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForFunction(() => {
    const current = window.__resumeHarness?.state?.();
    return current?.status?.originalActive === true && current.modes.chats.coldRange.scheduledAt > 0 &&
      current.modes.chats.coldRange.releasedAt === 0;
  }, null, { timeout: 12000 });
  const coldBottomRace = await page.evaluate(expectedAnchor => {
    const before = window.__resumeHarness.state();
    window.__resumeHarness.replaceSource('chats', { scrollTop: expectedAnchor.scrollTop });
    return {
      replacedAt: Date.now(),
      oldGeneration: before.status.modeStates.chats.materialization.sourceGeneration
    };
  }, chatAnchor);
  await waitReady('chats', 12000);
  await page.waitForTimeout(420);
  snapshot = await state();
  assert.ok(snapshot.now - coldBottomRace.replacedAt < 8000,
    `Cold bottom remount stayed blocked by the detached traversal: ${compact(snapshot.status)}`);
  assert.notEqual(snapshot.status.modeStates.chats.materialization.sourceGeneration, coldBottomRace.oldGeneration,
    `Detached cold pass published its old generation: ${compact(snapshot.status.modeStates.chats)}`);
  assertAnchor(snapshot.modes.chats.anchor, chatAnchor, 'cold bottom source fence');
  assertStableNativeSource(snapshot, 'chats', 'cold bottom source fence');

  assert.deepEqual(pageErrors, []);
  console.log('PASS native resume recovery: fixed 24-row pools, deduplicated lifecycle, tail probe, collapse/freeze/offline/source/mode recovery');
} finally {
  await browser.close();
  await server.close();
}

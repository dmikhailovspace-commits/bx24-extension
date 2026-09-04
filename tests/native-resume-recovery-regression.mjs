import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
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
    await page.waitForFunction(targetMode => {
      const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
      return window.__resumeHarness?.ready(targetMode) === true &&
        status?.originalActive !== true && status?.modeLoadPending !== true &&
        status?.reconcile?.active !== true;
    }, mode, { timeout });
  } catch (error) {
    const snapshot = await state();
    const actual = snapshot.modes?.[mode];
    const missing = actual?.expectedIds?.filter(id => !actual.catalogIds?.includes(id)) || [];
    throw new Error(`${mode} did not reach catalog/materialization/attempt ready; missingCatalogIds=${JSON.stringify(missing)}: ${compact(snapshot)}`, { cause: error });
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

const waitAttemptSettled = async (mode, timeout = 8000) => {
	await page.waitForFunction(targetMode => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const value = String(status?.modeStates?.[targetMode]?.attempt?.state || '');
		return !status?.originalActive && !/running|loading|probing|scrolling|verifying|paused|retry|failed|timeout/i.test(value);
	}, mode, { timeout });
};

const waitMetadataRetry = async (mode, timeout = 8000) => {
  try {
    await page.waitForFunction(targetMode => {
      const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
      const retry = status?.metadataRetryModes?.[targetMode];
      return !!retry?.reason && Number(retry.retryAttempt) >= 1 &&
        status?.backgroundModes?.includes?.(targetMode) === true;
    }, mode, { timeout });
  } catch (error) {
    const snapshot = await state();
    throw new Error(`${mode} did not enter metadata-only retry: ${compact(snapshot.status)}`, { cause: error });
  }
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
  const missingCatalogIds = actual.expectedIds.filter(id => !actual.catalogIds.includes(id));
  assert.equal(actual.catalogComplete, true,
    `${label}: catalog does not contain the full source ID set; missing=${JSON.stringify(missingCatalogIds)}: ${compact(actual)}`);
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
	assert.ok(snapshot.nativeBottomDebug.cold === true && snapshot.nativeBottomDebug.stable &&
		snapshot.nativeBottomDebug.requiredQuietMs === 0 && snapshot.nativeBottomDebug.quietMs === 0 &&
		snapshot.nativeBottomDebug.samples >= 6 && snapshot.nativeBottomDebug.seenCount === 108 &&
		snapshot.nativeBottomDebug.exactPhysicalCatalogProof === true && snapshot.nativeBottomDebug.headFenceChecked === true,
		`Fast cold pass lacked exact head-fenced physical proof: ${compact(snapshot.nativeBottomDebug)}`);
	assert.ok(snapshot.status.modeStates?.chats?.materialization?.nativePassCount === 1 &&
		snapshot.status.modeStates?.chats?.materialization?.exactPhysicalCatalogProof === true &&
		snapshot.status.modeStates?.chats?.materialization?.confirmationKind === 'api-exact-head-fenced' &&
		snapshot.status.modeStates?.chats?.materialization?.needsColdConfirmation === false &&
		Number(snapshot.status.materializationRevisions?.chats || 0) === 1,
		`Cold source did not use its exact one-pass proof: ${compact(snapshot.status.modeStates?.chats)}`);
  assert.equal(snapshot.modes.chats.reusePasses > 0, true, 'Initial materialization did not recycle the fixed native pool');
  assert.equal(snapshot.modes.chats.anchor.index, 58, `Initial chat anchor index changed: ${compact(snapshot.modes.chats.anchor)}`);
  assert.ok(Math.abs(snapshot.modes.chats.anchor.offset - 13) < 0.6, `Initial chat anchor offset changed: ${compact(snapshot.modes.chats.anchor)}`);
  const initialTrace = await page.evaluate(() => window.__resumeHarness.delta('chats', {
    audit: 0, renders: 0, guardActivations: 0, restCalls: 0, reconcileCount: 0
  }));
	assert.equal(initialTrace.materialization.fullWalks, 1, `Direct first-open repeated an already exact cold materialization: ${compact({ trace: initialTrace, failure: snapshot.nativeFailureDebug, step: snapshot.nativeStepDebug })}`);
  assert.equal(initialTrace.movement.unguarded, 0, `Direct first-open exposed mechanical scrolling: ${compact(initialTrace)}`);
  assert.ok(initialTrace.tail.confirmedRenders >= 1, `Direct first-open missed the five oldest IDs: ${compact(initialTrace)}`);
  const chatAnchor = snapshot.modes.chats.anchor;

  // Any initial-mount/source-ready work left behind by the cold pass must become
  // inert once that exact source generation has been confirmed.
  let mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  const confirmedInitialRevision = snapshot.status.materializationRevisions.chats;
  await page.waitForTimeout(850);
  let delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  snapshot = await state();
  assert.equal(delta.guardActivationTotal, 0, `A trailing source-ready timer reopened the loader: ${compact(delta)}`);
  assert.equal(delta.movement.bottomVisits, 0, `A trailing source-ready timer probed the confirmed tail: ${compact(delta)}`);
  assert.equal(delta.materialization.fullWalks, 0, `A trailing source-ready timer rematerialized the confirmed source: ${compact(delta)}`);
  assert.equal(snapshot.status.materializationRevisions.chats, confirmedInitialRevision,
    `A trailing source-ready timer changed the confirmed revision: ${compact(snapshot.status)}`);
  assert.equal(snapshot.guardVisible, false, `The loader remained visible after cold confirmation: ${compact(snapshot.status)}`);

  // Focus, resize and a short hidden interval may reconcile metadata, but may not move the feed.
  mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  const ordinaryRevision = snapshot.status.materializationRevisions.chats;
  await page.evaluate(() => window.__resumeHarness.ordinaryEventBurst());
  await page.waitForTimeout(650);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.movement.movements, 0, `Ordinary lifecycle events moved the viewport: ${compact(delta)}`);
  assert.equal(delta.movement.fullWalks, 0, `Ordinary lifecycle events started a native traversal: ${compact(delta)}`);
  assert.equal(delta.movement.bottomVisits, 0, `Ordinary lifecycle events probed the native tail: ${compact(delta)}`);
  assert.equal(delta.guardActivationTotal, 0, `Ordinary lifecycle events flashed the loading guard: ${compact(delta)}`);
  assert.equal(delta.loadingStatusActivations, 0, `Ordinary lifecycle events exposed a loading status: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'ordinary lifecycle events');
  snapshot = await state();
  assert.equal(snapshot.status.materializationRevisions.chats, ordinaryRevision,
    `Ordinary lifecycle events changed the materialization revision: ${compact(snapshot.status)}`);
  assertUiState(snapshot.modes.chats, 'chats', 'ordinary lifecycle events');

	// Bitrix may keep the same list, viewport and scrollHeight while recycling away
	// one of the saved tail rows. Opening the controls is not allowed to discover
	// that invisible condition by moving the viewport; long-pause recovery owns it.
	await page.waitForTimeout(80);
	mark = await page.evaluate(() => {
		const saved = window.__resumeHarness.mark('chats');
		window.__resumeHarness.partialTailLoss('chats', 1);
		return saved;
	});
	await page.getByRole('button', { name: /Фильтры/ }).click();
	await page.waitForTimeout(420);
	delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
	assert.equal(delta.materialization.fullWalks, 0, `Panel-open recovered an invisible tail loss by traversing the list: ${compact(delta)}`);
	assert.equal(delta.movement.bottomVisits, 0, `Panel-open probed an invisible tail loss: ${compact(delta)}`);
	assert.equal(delta.guardActivationTotal, 0, `Panel-open flashed the guard for an invisible tail loss: ${compact(delta)}`);
	assertAnchor(delta.anchor, chatAnchor, 'panel-open physical no-op');
	await page.locator('.pena-native-filter-panel .pena-native-popover-close').click();

	mark = await page.evaluate(() => {
		const saved = window.__resumeHarness.mark('chats');
		window.__resumeHarness.longPauseBurst();
		return saved;
	});
	await waitReconcileAfter(mark.reconcileCount);
	await waitReady('chats', 20000);
	await page.waitForTimeout(420);
	delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
	assert.equal(delta.materialization.fullWalks, 1, `Long-pause recovery did not restore the same-node tail loss: ${compact(delta)}`);
	assert.ok(delta.tail.missingRenders >= 1 && delta.tail.confirmedRenders >= 1,
		`Long-pause recovery did not verify and restore the saved tail: ${compact(delta)}`);
	assert.equal(delta.movement.unguarded, 0, `Long-pause recovery exposed mechanical scrolling: ${compact(delta)}`);
	assertAnchor(delta.anchor, chatAnchor, 'long-pause same-node recovery');
	snapshot = await state();
	assertStableNativeSource(snapshot, 'chats', 'long-pause same-node recovery');

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
  await waitReady('chats', 16000);
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
  const offlineMaterializationRevision = Number(snapshot.status.materializationRevisions.chats || 0);
  mark = await page.evaluate(() => {
    const saved = window.__resumeHarness.mark('chats');
    window.__resumeHarness.goOffline();
    window.__resumeHarness.longPauseBurst();
    return saved;
  });
  await page.waitForFunction(restStart =>
    window.__resumeHarness.state().restCalls.slice(restStart).some(call => call.online === false),
  mark.restCalls, { timeout: 8000 });
  await waitMetadataRetry('chats', 8000);
  await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.()?.reconcile?.active !== true,
    null, { timeout: 8000 });
  await waitAttemptSettled('chats', 8000);
  snapshot = await state();
  const offlineMetadataRetry = snapshot.status.metadataRetryModes.chats;
  assert.match(String(offlineMetadataRetry.reason || ''), /head-refresh-incomplete|metadata-audit-incomplete|offline|network|failed|error/i,
    `Offline metadata retry lost its failure reason: ${compact(snapshot.status)}`);
  assert.ok(Number(offlineMetadataRetry.retryAttempt) >= 1,
    `Offline metadata retry did not increment independently: ${compact(snapshot.status)}`);
  assert.ok(Number(offlineMetadataRetry.retryAt) > snapshot.now,
    `Offline metadata retry did not schedule a future checkpoint: ${compact(snapshot.status)}`);
  assert.doesNotMatch(String(snapshot.status.modeStates.chats.attempt.state || ''), /retry|waiting|scheduled|loading|probing|scrolling/i,
    `Offline metadata deferral polluted the native recovery attempt: ${compact(snapshot.status.modeStates.chats)}`);
  assert.equal(snapshot.modes.chats.catalogComplete, true, 'Offline reconcile erased the valid catalog');
  assert.equal(snapshot.modes.chats.sourceComplete, true, 'Offline reconcile invalidated the confirmed native source');
  assert.equal(Number(snapshot.status.materializationRevisions.chats || 0), offlineMaterializationRevision,
    'Offline metadata retry changed the confirmed native materialization revision');
  assertUiState(snapshot.modes.chats, 'chats', 'offline retry');
  assertAnchor(snapshot.modes.chats.anchor, chatAnchor, 'offline retry');
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.materialization.fullWalks, 0, `Offline metadata failure triggered native traversal: ${compact(delta)}`);
  assert.equal(delta.movement.bottomVisits, 1, `Long-pause offline recovery did not keep its single native tail proof: ${compact(delta)}`);
  assert.equal(delta.guardActivationTotal, 1, `Long-pause offline tail proof was not protected by exactly one guard: ${compact(delta)}`);
  assert.ok(delta.tail.confirmedRenders >= 1, `Long-pause offline tail proof did not confirm the saved tail IDs: ${compact(delta)}`);

  const offlineRetryMark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  await page.waitForTimeout(1250);
  snapshot = await state();
  assert.ok(snapshot.status.metadataRetryModes.chats,
    `Offline metadata retry was discarded before reconnect: ${compact(snapshot.status)}`);
  assert.doesNotMatch(String(snapshot.status.modeStates.chats.attempt.state || ''), /retry|waiting|scheduled|loading|probing|scrolling/i,
    `Offline metadata retry woke native recovery: ${compact(snapshot.status.modeStates.chats)}`);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), offlineRetryMark);
  assert.equal(delta.materialization.fullWalks, 0, `Offline metadata retry triggered native traversal: ${compact(delta)}`);
  assert.equal(delta.movement.bottomVisits, 0, `Offline metadata retry probed the native tail: ${compact(delta)}`);
  assert.equal(delta.guardActivationTotal, 0, `Offline metadata retry displayed the blocking guard: ${compact(delta)}`);

  const onlineRestStart = snapshot.restCalls.length;
  const onlineMark = await page.evaluate(() => {
    const saved = window.__resumeHarness.mark('chats');
    window.__resumeHarness.goOnline();
    return saved;
  });
  await page.waitForFunction(restStart =>
    window.__resumeHarness.state().restCalls.slice(restStart).some(call => call.online === true),
  onlineRestStart, { timeout: 5000 });
  await page.waitForFunction(targetMode => {
    const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
    return !status?.metadataRetryModes?.[targetMode] &&
      status?.backgroundModes?.includes?.(targetMode) !== true;
  }, 'chats', { timeout: 15000 });
  await waitReady('chats', 15000);
  snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'online recovery');
  assertAnchor(snapshot.modes.chats.anchor, chatAnchor, 'online recovery');
  assert.equal(Number(snapshot.status.materializationRevisions.chats || 0), offlineMaterializationRevision,
    'Online metadata recovery rematerialized an already healthy native source');
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), onlineMark);
  assert.equal(delta.materialization.fullWalks, 0, `Online metadata recovery triggered native traversal: ${compact(delta)}`);
  assert.equal(delta.movement.bottomVisits, 0, `Online metadata recovery probed the native tail: ${compact(delta)}`);
  assert.equal(delta.guardActivationTotal, 0, `Online metadata recovery displayed the blocking guard: ${compact(delta)}`);

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
  // may not publish ready; the replacement is a new source generation and requires
  // its own mandatory two-pass cold materialization.
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
  assert.equal(delta.materialization.fullWalks, 2, `Replacement source was certified without two cold materialization passes: ${compact(delta)}`);
  assert.ok(delta.tail.confirmedRenders >= 1, `Replacement traversal missed saved tail IDs: ${compact(delta)}`);
  assert.equal(delta.movement.unguarded, 0, `Replacement-source traversal was visually exposed: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'source replacement');
  snapshot = await state();
  assert.notEqual(snapshot.status.modeStates.chats.materialization.sourceGeneration, oldDiagnosticGeneration,
    'Replacement source kept the previous materialization generation');
  assertStableNativeSource(snapshot, 'chats', 'source replacement');

  // A quick chats -> tasks -> chats transition cancels stale work. Each mode remains isolated;
  // a later real task entry performs its own two-pass cold materialization.
  mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  await page.evaluate(() => window.__resumeHarness.switchMode('tasks'));
  await page.waitForTimeout(55);
  await page.evaluate(() => window.__resumeHarness.switchMode('chats'));
  await waitActiveMode('chats');
  await waitReady('chats', 12000);
	await page.waitForTimeout(180);
	await waitAttemptSettled('chats');
	await page.waitForTimeout(120);
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
	assert.equal(delta.materialization.fullWalks, 1, `Task source repeated an already exact cold materialization: ${compact(delta)}`);
	assert.ok(delta.tail.confirmedRenders >= 1, `Task traversal missed the five oldest IDs: ${compact(delta)}`);
	assert.equal(delta.movement.unguarded, 0, `Task traversal was visually exposed: ${compact(delta)}`);
	snapshot = await state();
	assert.ok(snapshot.status.modeStates?.tasks?.materialization?.exactPhysicalCatalogProof === true &&
		snapshot.status.modeStates?.tasks?.materialization?.confirmationKind === 'api-exact-head-fenced' &&
		snapshot.status.modeStates?.tasks?.materialization?.nativePassCount === 1,
		`Task source lacked exact one-pass proof: ${compact(snapshot.status.modeStates?.tasks)}`);
  assert.equal(snapshot.modes.tasks.anchor.index, 42,
    `Task anchor index changed: ${compact({ task: snapshot.modes.tasks, diagnostic: snapshot.status.modeStates?.tasks })}`);
  assert.ok(Math.abs(snapshot.modes.tasks.anchor.offset - 17) < 0.6,
    `Task anchor offset changed: ${compact({ task: snapshot.modes.tasks, diagnostic: snapshot.status.modeStates?.tasks })}`);
  const taskAnchor = snapshot.modes.tasks.anchor;
  const taskAssociation = await page.evaluate(dialogId =>
    window.__PENA_NATIVE_PREFETCH__?.inspectMeta?.(dialogId) || null,
  taskAnchor.id);
  assert.deepEqual(taskAssociation, {
    isTask: true,
    taskId: '90042',
    taskUrl: '/company/personal/user/7/tasks/task/view/90042/?ta_sec=chat_tasks&ta_el=view_button'
  }, `Generic dialog detail erased the confirmed task association: ${compact(taskAssociation)}`);
  assertStableNativeSource(snapshot, 'tasks', 'task materialization');
  assertNoForeignIds(snapshot, 'task materialization');

  mark = await page.evaluate(() => window.__resumeHarness.mark('chats'));
  await page.evaluate(() => window.__resumeHarness.switchMode('chats'));
  await waitActiveMode('chats');
  await waitReady('chats', 12000);
	await page.waitForTimeout(180);
	await waitAttemptSettled('chats');
	await page.waitForTimeout(120);
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
	await page.waitForTimeout(180);
	await waitAttemptSettled('tasks');
	await page.waitForTimeout(120);
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
	await page.waitForTimeout(180);
	await waitAttemptSettled('chats');
	await page.waitForTimeout(120);
  delta = await page.evaluate(saved => window.__resumeHarness.delta('chats', saved), mark);
  assert.equal(delta.materialization.fullWalks, 0, `Second chat return triggered a traversal: ${compact(delta)}`);
  assertAnchor(delta.anchor, chatAnchor, 'second chat return');
  snapshot = await state();
  assertStableNativeSource(snapshot, 'chats', 'second chat return');
  assertNoForeignIds(snapshot, 'second chat isolation');

  // Re-entering two already confirmed Bitrix sources is presentation-only. The
  // source identity/range has not changed, so ordinary switching must remain a
  // physical no-op even after a long wall-clock interval.
  const healthySwitchBaseline = await page.evaluate(() => ({
    chats: window.__resumeHarness.mark('chats'),
    tasks: window.__resumeHarness.mark('tasks'),
    revisions: { ...window.__PENA_NATIVE_PREFETCH__.status().materializationRevisions }
  }));
  for (let index = 0; index < 20; index += 1) {
    const targetMode = index % 2 === 0 ? 'tasks' : 'chats';
    await page.evaluate(mode => {
      window.__resumeHarness.advanceClock(15 * 1000);
      window.__resumeHarness.switchMode(mode);
    }, targetMode);
    await waitActiveMode(targetMode);
    await page.waitForTimeout(95);
  }
  await page.evaluate(() => {
    window.__resumeHarness.advanceClock(16 * 60 * 1000);
    window.__resumeHarness.switchMode('tasks');
  });
  await waitActiveMode('tasks');
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__resumeHarness.switchMode('chats'));
  await waitActiveMode('chats');
  await waitReady('chats', 12000);
  await page.waitForTimeout(520);
  const healthySwitches = await page.evaluate(saved => ({
    chats: window.__resumeHarness.delta('chats', saved.chats),
    tasks: window.__resumeHarness.delta('tasks', saved.tasks),
    revisions: { ...window.__PENA_NATIVE_PREFETCH__.status().materializationRevisions },
    status: window.__PENA_NATIVE_PREFETCH__.status(),
    guardVisible: window.__resumeHarness.state().guardVisible
  }), healthySwitchBaseline);
  assert.equal(healthySwitches.chats.guardActivationTotal, 0,
    `Healthy chats/tasks switching flashed the loading guard: ${compact(healthySwitches)}`);
  assert.equal(healthySwitches.chats.movement.bottomVisits, 0,
    `Healthy chats source was tail-probed on tab return: ${compact(healthySwitches)}`);
  assert.equal(healthySwitches.tasks.movement.bottomVisits, 0,
    `Healthy task source was tail-probed on tab return: ${compact(healthySwitches)}`);
  assert.equal(healthySwitches.chats.materialization.fullWalks + healthySwitches.tasks.materialization.fullWalks, 0,
    `Healthy chats/tasks switching started a full traversal: ${compact(healthySwitches)}`);
  assert.deepEqual(healthySwitches.revisions, healthySwitchBaseline.revisions,
    `Healthy chats/tasks switching changed a materialization revision: ${compact(healthySwitches)}`);
  assert.equal(healthySwitches.status.originalActive, false, `Healthy mode switching left native loading active: ${compact(healthySwitches)}`);
  assert.equal(healthySwitches.status.modeLoadPending, false, `Healthy mode switching left a delayed mode load: ${compact(healthySwitches)}`);
  assert.equal(healthySwitches.guardVisible, false, `Healthy mode switching left the guard visible: ${compact(healthySwitches)}`);

  // Opening controls is not a source-health signal. Repeated open/close actions
  // inside the safety-probe TTL must remain a strict physical no-op.
  await page.evaluate(() => window.__resumeHarness.advanceClock(100));
  const panelBaseline = await page.evaluate(() => ({
    mark: window.__resumeHarness.mark('chats'),
    revision: window.__PENA_NATIVE_PREFETCH__.status().materializationRevisions.chats
  }));
  for (let index = 0; index < 10; index += 1) {
    await page.getByRole('button', { name: /Фильтры/ }).click();
    await page.locator('.pena-native-filter-panel').waitFor({ state: 'visible' });
    await page.waitForTimeout(35);
    await page.locator('.pena-native-filter-panel .pena-native-popover-close').click();
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(650);
  const panelBurst = await page.evaluate(saved => ({
    delta: window.__resumeHarness.delta('chats', saved.mark),
    revision: window.__PENA_NATIVE_PREFETCH__.status().materializationRevisions.chats,
    status: window.__PENA_NATIVE_PREFETCH__.status(),
    guardVisible: window.__resumeHarness.state().guardVisible
  }), panelBaseline);
  assert.equal(panelBurst.delta.guardActivationTotal, 0, `Repeated panel opening flashed the loading guard: ${compact(panelBurst)}`);
  assert.equal(panelBurst.delta.movement.bottomVisits, 0, `Repeated panel opening probed the native tail: ${compact(panelBurst)}`);
  assert.equal(panelBurst.delta.materialization.fullWalks, 0, `Repeated panel opening started a full traversal: ${compact(panelBurst)}`);
  assert.equal(panelBurst.revision, panelBaseline.revision, `Repeated panel opening changed materialization: ${compact(panelBurst)}`);
  assert.equal(panelBurst.status.originalActive, false, `Repeated panel opening left native loading active: ${compact(panelBurst)}`);
  assert.equal(panelBurst.status.modeLoadPending, false, `Repeated panel opening left a delayed mode load: ${compact(panelBurst)}`);
  assert.equal(panelBurst.guardVisible, false, `Repeated panel opening left the guard visible: ${compact(panelBurst)}`);

  // Focus and the one-minute safety timer may refresh head metadata, but that
  // background work is never a user-visible list load and never touches the tail.
  await page.getByRole('button', { name: /Фильтры/ }).click();
  await page.locator('.pena-native-filter-panel').waitFor({ state: 'visible' });
  await page.waitForTimeout(180);
  // Earlier recovery cases intentionally jump the fake wall clock by hours. Let
  // one heartbeat absorb that historical drift before marking this ordinary
  // one-minute checkpoint, and wait for all mode-entry metadata to settle.
  assert.equal(await page.evaluate(() => window.__resumeHarness.fireDialogPeriodic(1)), 1,
    'Dialog heartbeat callback was not captured by the lifecycle harness');
  // A real interval may already have absorbed the fake-clock drift. This warm
  // heartbeat may legitimately deduplicate; wait for its scheduled work to settle.
  await page.waitForFunction(() => {
    const status = window.__PENA_NATIVE_PREFETCH__.status();
    return status.reconcile.active !== true && status.apiActive !== true &&
      window.__PENA_RECENT_SYNC__?.inFlight !== true;
  }, null, { timeout: 8000 });
  await waitAttemptSettled('chats', 8000);
  await page.evaluate(() => {
    window.__resumeHarness.setRecentDelay(220);
    window.__resumeHarness.advanceClock(60 * 1000 + 100);
  });
  const metadataBaseline = await page.evaluate(() => ({
    mark: window.__resumeHarness.mark('chats'),
    revision: window.__PENA_NATIVE_PREFETCH__.status().materializationRevisions.chats,
    recentCalls: window.__resumeHarness.state().restCalls.filter(call => call.method === 'im.recent.get').length
  }));
  const periodicCallbacks = await page.evaluate(() => window.__resumeHarness.fireDialogPeriodic(4));
  assert.equal(periodicCallbacks, 4, 'Dialog periodic callback was not captured by the lifecycle harness');
  for (let index = 0; index < 10; index += 1) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(12);
  }
  await page.waitForFunction(previous =>
    window.__resumeHarness.state().restCalls.filter(call => call.method === 'im.recent.get').length > previous,
  metadataBaseline.recentCalls, { timeout: 5000 });
  await page.waitForFunction(() => {
    const status = window.__PENA_NATIVE_PREFETCH__.status();
    return status.reconcile.active !== true && window.__PENA_RECENT_SYNC__?.inFlight !== true;
  }, null, { timeout: 5000 });
  await page.waitForTimeout(420);
  const metadataOnly = await page.evaluate(saved => ({
    delta: window.__resumeHarness.delta('chats', saved.mark),
    revision: window.__PENA_NATIVE_PREFETCH__.status().materializationRevisions.chats,
    status: window.__PENA_NATIVE_PREFETCH__.status(),
    ui: window.__resumeHarness.state()
  }), metadataBaseline);
  assert.equal(metadataOnly.delta.guardActivationTotal, 0, `Periodic/focus metadata refresh flashed the loading guard: ${compact(metadataOnly)}`);
  assert.equal(metadataOnly.delta.loadingStatusActivations, 0, `Periodic/focus metadata refresh exposed a loading status: ${compact(metadataOnly)}`);
  assert.equal(metadataOnly.delta.movement.bottomVisits, 0, `Periodic/focus metadata refresh probed the native tail: ${compact(metadataOnly)}`);
  assert.equal(metadataOnly.delta.materialization.fullWalks, 0, `Periodic/focus metadata refresh started a full traversal: ${compact(metadataOnly)}`);
  assert.equal(metadataOnly.revision, metadataBaseline.revision, `Periodic/focus metadata refresh changed materialization: ${compact(metadataOnly)}`);
  assert.equal(metadataOnly.status.originalActive, false, `Periodic/focus metadata refresh remained blocking: ${compact(metadataOnly)}`);
  assert.equal(metadataOnly.ui.guardVisible, false, `Periodic/focus metadata refresh left the guard visible: ${compact(metadataOnly)}`);
  assert.equal(metadataOnly.ui.loadingStatusVisible, false, `Periodic/focus metadata refresh left a loading status visible: ${compact(metadataOnly)}`);
  await page.evaluate(() => window.__resumeHarness.setRecentDelay(18));
  await page.locator('.pena-native-filter-panel .pena-native-popover-close').click();

  // Closing the panel restores the native viewport before its recycled row
  // pool paints on the next animation frame. Assert the physical anchor too.
  await page.waitForFunction(() => window.__resumeHarness.markerGeometry('chats').rowFound, null, { timeout: 2000 });
  assertAnchor((await state()).modes.chats.anchor, chatAnchor, 'metadata refresh and panel close');
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
  await waitReady('chats', 16000);
  await page.waitForTimeout(420);
  snapshot = await state();
  assert.ok(snapshot.now - coldBottomRace.replacedAt < 12000,
    `Cold bottom remount stayed blocked by the detached traversal: ${compact(snapshot.status)}`);
  assert.notEqual(snapshot.status.modeStates.chats.materialization.sourceGeneration, coldBottomRace.oldGeneration,
    `Detached cold pass published its old generation: ${compact(snapshot.status.modeStates.chats)}`);
  assertAnchor(snapshot.modes.chats.anchor, chatAnchor, 'cold bottom source fence');
  assertStableNativeSource(snapshot, 'chats', 'cold bottom source fence');

  assert.deepEqual(pageErrors, []);
  console.log('PASS native resume recovery: fixed 24-row pools, deduplicated lifecycle, tail probe, collapse/freeze/offline/source/mode recovery');
} catch (error) {
  await mkdir(new URL('./artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('./artifacts/resume-failure.json', import.meta.url), JSON.stringify({
    error: String(error.stack || error), snapshot: await state(), pageErrors
  }, null, 2));
  throw error;
} finally {
  await browser.close();
  await server.close();
}

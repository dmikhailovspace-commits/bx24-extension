import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const failures = [];
const onlyScenario = String(process.env.PENA_RECENT_ONLY || '').trim().toLowerCase();

const managedIds = page => page.evaluate(() => window.__recentHarness.managedItems().map(item => String(item.id)).sort());
const managedViewIds = page => page.evaluate(() => Array.from(
	document.querySelector('.pena-native-managed-list')?._penaManagedState?.view || [],
	item => String(item.id)
));
const syncState = page => page.evaluate(() => ({ ...(window.__PENA_RECENT_SYNC__ || {}) }));
const avatarState = locator => locator.evaluate(element => ({
  src: element.querySelector('.pena-native-remote-avatar-image')?.getAttribute('src') || '',
  imageHidden: element.querySelector('.pena-native-remote-avatar-image')?.hidden ?? true,
  initialsHidden: element.querySelector('.pena-native-remote-avatar-initials')?.hidden ?? true,
  initials: element.querySelector('.pena-native-remote-avatar-initials')?.textContent || '',
  loading: element.classList.contains('--loading')
}));
const expectedIds = (start, count) => Array.from({ length: count }, (_, index) => `chat${start + index}`).sort();
const assertExactIds = (actual, expected, label) => {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const stale = actual.filter(id => !expectedSet.has(id));
  const missing = expected.filter(id => !actualSet.has(id));
  if (actual.length !== expected.length || stale.length || missing.length) {
    throw new Error(`${label}; actual=${actual.length}, expected=${expected.length}, stale=${JSON.stringify(stale.slice(0, 10))}, missing=${JSON.stringify(missing.slice(0, 10))}`);
  }
};
const waitForInitialSync = async (page, expectedWindowCount = 401) => {
  try {
    await page.waitForFunction(expected => {
      const sync = window.__PENA_RECENT_SYNC__;
	  return sync && !sync.inFlight && sync.windowCount === expected && sync.lastFullAt > 0;
	}, expectedWindowCount, { timeout: 10000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      sync: window.__PENA_RECENT_SYNC__ || null,
      calls: window.__recentHarness?.calls?.() || [],
      managed: window.__recentHarness?.managedItems?.().length ?? null,
      panel: document.querySelectorAll('.pena-native-folder-switcher').length
    }));
    throw new Error(`Initial sync did not settle: ${JSON.stringify(diagnostic)}; ${error.message}`);
  }
};
const openFilters = async page => {
  const panel = page.locator('.pena-native-filter-panel');
  if (!await panel.isVisible().catch(() => false)) await page.getByRole('button', { name: /Фильтры/ }).click();
  await panel.waitFor({ state: 'visible' });
  return panel;
};
const closeFilters = async page => {
  const panel = page.locator('.pena-native-filter-panel');
  if (await panel.isVisible().catch(() => false)) {
	await page.getByRole('button', { name: /Фильтры/ }).click();
	await panel.waitFor({ state: 'hidden' });
  }
};
const startRefresh = async page => {
  const panel = await openFilters(page);
  const button = panel.getByRole('button', { name: 'Обновить список чатов' });
  const before = await syncState(page);
  await button.click();
  await page.waitForFunction(previous => {
	const sync = window.__PENA_RECENT_SYNC__;
	return !!sync && (
		sync.inFlight ||
		Number(sync.startedAt) > Number(previous.startedAt || 0) ||
		Number(sync.completedAt) > Number(previous.completedAt || 0)
	);
  }, before);
};
const activateAscending = async page => {
  const panel = await openFilters(page);
  await panel.getByRole('button', { name: 'По возрастанию' }).click();
  await page.waitForFunction(() => window.__PENA_MANAGED_DEBUG__?.status === 'ready');
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await page.evaluate(() => {
	  const viewport = document.querySelector('.pena-native-managed-viewport');
	  if (!viewport) return;
	  viewport.scrollTop = 0;
	  viewport.dispatchEvent(new Event('scroll'));
	});
	await page.waitForFunction(() => document.querySelector('.pena-native-remote-row[data-id="chat1"]'));
};
const runScenario = async (name, test, query = '', expectedWindowCount = 401) => {
  if (onlyScenario && !name.toLowerCase().includes(onlyScenario)) return;
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
    await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html${query}`);
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	await waitForInitialSync(page, expectedWindowCount);
    await test(page);
    assert.deepEqual(pageErrors, [], `${name}: uncaught browser errors`);
    console.log(`PASS recent sync: ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error?.message || error}`);
    console.error(`FAIL recent sync: ${name}\n  ${error?.stack || error}`);
  } finally {
    await context.close();
  }
	if (onlyScenario) process.exit(failures.length ? 1 : 0);
};

const runInitialProgressScenario = async () => {
  if (onlyScenario && !'progressive first-open catalog'.includes(onlyScenario)) return;
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
    await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?initialgate=1`);
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForFunction(() => window.__recentHarness.calls().some(call => call.name === 'initial-three-pages' && call.pageIndex === 1));
    const loading = await syncState(page);
    assert.equal(loading.phase, 'full-sync');
    assert.equal(loading.ready, false);
	assert.equal(loading.partial, false);
    assert.equal(loading.loadedCount, 200);
    assert.equal(loading.percent, 50);
	assert.equal(loading.gateLocked, true);
	assert.ok(Number(loading.gatePercent) > 0 && Number(loading.gatePercent) < 100);
    assert.equal((await managedIds(page)).length, 0, 'Cold catalog was exposed before its atomic commit');
	assert.match(await page.locator('.pena-native-sync-chip').innerText(), /^\d+%$/);
	assert.equal(await page.locator('.pena-native-load-guard').isHidden(), false, 'Cold-start guard disappeared before the full snapshot');
	assert.equal(await page.evaluate(() => !!document.querySelector('.pena-native-managed-list')?.inert), true, 'Cold catalog accepted interaction before commit');
	assert.deepEqual(await page.evaluate(() => window.__recentHarness.nativeOpens()), []);
    await page.evaluate(() => window.__recentHarness.releaseGate());
    await waitForInitialSync(page);
	assert.equal((await syncState(page)).gateLocked, false);
	assert.equal(await page.locator('.pena-native-load-guard').isHidden(), true, 'Loading guard remained after verification');
	await page.evaluate(() => {
		const viewport = document.querySelector('.pena-native-managed-viewport');
		if (!viewport) return;
		viewport.scrollTop = viewport.scrollHeight;
		viewport.dispatchEvent(new Event('scroll'));
	});
	await page.waitForFunction(() => document.querySelector('.pena-native-remote-row[data-id="chat1"]'));
	await page.evaluate(() => document.querySelector('.pena-native-remote-row[data-id="chat1"]')?.click());
	await page.waitForFunction(() => window.__recentHarness.nativeOpens().includes('chat1'));
    assert.deepEqual(pageErrors, [], 'initial progressive load: uncaught browser errors');
    console.log('PASS recent sync: progressive first-open catalog');
  } catch (error) {
    failures.push(`progressive first-open catalog: ${error?.message || error}`);
    console.error(`FAIL recent sync: progressive first-open catalog\n  ${error?.stack || error}`);
  } finally {
    await context.close();
  }
};

const runCacheFallbackScenario = async () => {
  if (onlyScenario && !'persistent cache fallback'.includes(onlyScenario)) return;
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
    await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html`);
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
    await waitForInitialSync(page);
	await page.waitForFunction(() => (window.__recentHarness.repositoryCache()?.records?.length || 0) === 401);
    await page.evaluate(() => {
	  const cache = window.__recentHarness.repositoryCache();
	  cache.manifest.savedAt = Date.now();
	  cache.records.forEach(record => {
		record.unread = { count: 99, marked: true, mention: true, fetchedAt: Date.now() - 3600000 };
		record.state = { ...(record.state || {}), unreadCount: 99, hasUnread: true, hasLater: true, hasMention: true, counterFetchedAt: Date.now() - 3600000 };
      });
	  window.__recentHarness.setRepositoryCache(cache);
    });
    await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?initialerror=1&countererror=1`);
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForFunction(() => {
      const sync = window.__PENA_RECENT_SYNC__;
      return sync && !sync.inFlight && !!sync.error && sync.count === 401 && sync.ready;
    }, null, { timeout: 10000 });
    assertExactIds(await managedIds(page), expectedIds(1, 401), 'Cached catalog was not restored after REST failure');
    await activateAscending(page);
    const avatar = page.locator('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-avatar');
    try {
      await avatar.waitFor({ state: 'visible', timeout: 5000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        sync: window.__PENA_RECENT_SYNC__ || null,
        debug: window.__PENA_MANAGED_DEBUG__ || null,
        remoteIds: Array.from(document.querySelectorAll('.pena-native-remote-row')).map(row => row.dataset.id),
        managedRows: document.querySelectorAll('.pena-native-managed-row').length,
        viewport: document.querySelector('.pena-native-managed-viewport')?.getBoundingClientRect().toJSON?.() || null
      }));
      throw new Error(`Cached avatar row not rendered: ${JSON.stringify(diagnostic)}; ${error.message}`);
    }
	const cachedAvatar = await avatarState(avatar);
	assert.match(cachedAvatar.src, /avatar-9\.png/);
	assert.equal(cachedAvatar.imageHidden && cachedAvatar.initialsHidden && !cachedAvatar.loading, false, 'Broken cached avatar left an empty circle');
	await page.waitForFunction(() => {
		const counter = document.querySelector('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-counter');
		return counter?.textContent === '99' && !counter.hidden;
	});
    assert.deepEqual(pageErrors, [], 'cache fallback: uncaught browser errors');
    console.log('PASS recent sync: persistent cache fallback');
  } catch (error) {
    failures.push(`persistent cache fallback: ${error?.message || error}`);
    console.error(`FAIL recent sync: persistent cache fallback\n  ${error?.stack || error}`);
  } finally {
    await context.close();
  }
};

const runColdFailureScenario = async () => {
  if (onlyScenario && !'cold failure restores native Bitrix'.toLowerCase().includes(onlyScenario)) return;
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
    await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?alwaysrecenterror=1`);
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.gateReady && window.__PENA_RECENT_SYNC__?.error && !window.__PENA_RECENT_SYNC__?.inFlight);
    const state = await page.evaluate(() => ({
      managed: document.querySelectorAll('.pena-native-managed-viewport').length,
      sourceHidden: document.querySelector('.bx-im-list-container-recent__scroll-container')?.classList.contains('pena-native-source-viewport-hidden'),
      sourceInert: !!document.querySelector('.bx-im-list-container-recent__scroll-container')?.inert,
      visibleNative: Array.from(document.querySelectorAll('#recent-list > .bx-im-list-recent-item__wrap')).filter(row => getComputedStyle(row).display !== 'none').length
    }));
    assert.deepEqual(state, { managed: 0, sourceHidden: false, sourceInert: false, visibleNative: 8 });
    const retry = page.locator('.pena-native-sync-chip.--error');
    try {
      await retry.waitFor({ state: 'visible', timeout: 3000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        panels: document.querySelectorAll('.pena-native-folder-switcher').length,
        hostClass: document.querySelector('.pena-native-folder-switcher')?.parentElement?.className || '',
        chip: document.querySelector('.pena-native-sync-chip')?.outerHTML || '',
        sync: window.__PENA_RECENT_SYNC__ || null
      }));
      throw new Error(`Compact retry is unavailable: ${JSON.stringify(diagnostic)}; ${error.message}`);
    }
    await page.evaluate(() => {
      window.__recentHarness.setPersistentRecentError(false);
      const entries = window.__recentHarness.makeDataset(1, 401, 'После повтора');
      window.__recentHarness.enqueuePlan({ name: 'cold-retry', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
    });
    await retry.click();
    await waitForInitialSync(page);
    assert.equal((await managedIds(page)).length, 401, 'Retry did not restore the managed catalog');
    assert.deepEqual(pageErrors, [], 'cold failure fallback: uncaught browser errors');
    console.log('PASS recent sync: cold failure restores native Bitrix and retry works');
  } catch (error) {
    failures.push(`cold failure restores native Bitrix: ${error?.message || error}`);
    console.error(`FAIL recent sync: cold failure restores native Bitrix\n  ${error?.stack || error}`);
  } finally {
    await context.close();
  }
};

const runLegacyCacheMigrationScenario = async () => {
  if (onlyScenario && !'schema 5 cache migration'.includes(onlyScenario)) return;
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
    await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?legacycache=1&alwaysrecenterror=1&countererror=1`);
    await page.waitForFunction(() => window.__recentHarness.repositoryCache()?.records?.length === 2 && localStorage.getItem('pena.dialogRecentCache.v2') === null);
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.ready && window.__PENA_RECENT_SYNC__?.error && !window.__PENA_RECENT_SYNC__?.inFlight);
    const repository = await page.evaluate(() => window.__recentHarness.repositoryCache());
    assert.deepEqual(repository.records.map(record => record.id).sort(), ['chat1', 'chat2']);
    assert.equal(repository.manifest.count, 2);
    assert.deepEqual(pageErrors, [], 'schema 5 migration: uncaught browser errors');
    console.log('PASS recent sync: schema 5 cache migration');
  } catch (error) {
    failures.push(`schema 5 cache migration: ${error?.message || error}`);
    console.error(`FAIL recent sync: schema 5 cache migration\n  ${error?.stack || error}`);
  } finally {
    await context.close();
  }
};

const runMandatoryPageTailScenario = async () => {
  if (onlyScenario && !'controlled page-tail dialog'.includes(onlyScenario)) return;
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
	await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?limitmandatory=1`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	await page.waitForFunction(() => {
	  const sync = window.__PENA_RECENT_SYNC__;
	  return sync && !sync.inFlight && sync.phase === 'ready' && sync.windowCount === 100;
	}, null, { timeout: 10000 });
	const ids = await managedIds(page);
	assert.equal(ids.length, 101);
	assert.ok(ids.includes('chat150'), 'Controlled dialog in the unselected half of an already fetched REST page was dropped');
	const calls = await page.evaluate(() => window.__recentHarness.calls());
	assert.equal(calls.filter(call => call.method === 'im.recent.list').length, 1, JSON.stringify(calls.filter(call => call.method === 'im.recent.list')));
	assert.equal(calls.filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat150').length, 1, 'Controlled dialog from im.recent.list was not validated through im.dialog.get');
	assert.deepEqual(pageErrors, []);
	console.log('PASS recent sync: controlled page-tail dialog is retained and access-checked');
  } catch (error) {
	failures.push(`controlled page-tail dialog: ${error?.message || error}`);
	console.error(`FAIL recent sync: controlled page-tail dialog\n  ${error?.stack || error}`);
  } finally {
	await context.close();
  }
};

const runCacheFirstFolderScenario = async () => {
  if (onlyScenario && !'cache-first folder render'.includes(onlyScenario)) return;
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
	await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?custom=1`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	await waitForInitialSync(page);
	await page.waitForFunction(() => {
	  const cache = window.__recentHarness.repositoryCache();
	  return cache?.manifest?.schema === 1 && cache.manifest.lastFullAt > 0 && cache.records?.length === 401;
	});
	await page.locator('.pena-native-folder-tab[title="Сохранить"]').click();
	await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.length === 1);

	await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?custom=1&initialdelay=1500`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	await page.waitForFunction(() => {
	  const state = document.querySelector('.pena-native-managed-list')?._penaManagedState;
	  return state?.view?.length === 1 && state.view[0]?.id === 'chat1';
	}, null, { timeout: 1000 });
	const cachedSync = await syncState(page);
	assert.ok(cachedSync.lastFullAt > 0, 'Cached full-sync timestamp was not restored');
	assert.equal(cachedSync.full, false, 'Fresh cache triggered another full pagination pass');
	assert.deepEqual(await managedViewIds(page), ['chat1'], 'Cached folder did not render its assigned dialog immediately');
	assert.match((await avatarState(page.locator('.pena-native-remote-row[data-id="chat1"] .pena-native-remote-avatar'))).src, /avatar-1\.png/);
	assert.equal(await page.locator('.pena-native-remote-row[data-id="chat1"] .pena-native-remote-counter').innerText(), '1');
	await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.inFlight, null, { timeout: 5000 });
	const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.recent.list'));
	assert.deepEqual(calls.map(call => call.offset), [0], 'Fresh cache repeated the complete catalog download');
	assert.deepEqual(pageErrors, [], 'cache-first folder: uncaught browser errors');
	console.log('PASS recent sync: cache-first folder render');
  } catch (error) {
	failures.push(`cache-first folder render: ${error?.message || error}`);
	console.error(`FAIL recent sync: cache-first folder render\n  ${error?.stack || error}`);
  } finally {
	await context.close();
  }
};

const runUserScopedCacheScenario = async () => {
  if (onlyScenario && !'user-scoped catalog cache'.includes(onlyScenario)) return;
  const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
  const page = await context.newPage();
  const pageErrors = collectPageErrors(page);
  try {
	await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?userid=101`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	await waitForInitialSync(page);
	await page.waitForFunction(() => window.__recentHarness.repositoryCache('101')?.manifest?.count === 401);

	await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?userid=202&alwaysrecenterror=1&countererror=1`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__ && !window.__PENA_RECENT_SYNC__.inFlight && !!window.__PENA_RECENT_SYNC__.error);
	const sync = await syncState(page);
	assert.equal(sync.count, 0, 'Catalog cache from another Bitrix user was restored');
	assert.equal(sync.ready, false, 'Foreign user cache marked the catalog ready');
	assert.deepEqual(pageErrors, [], 'user-scoped cache: uncaught browser errors');
	console.log('PASS recent sync: user-scoped catalog cache');
  } catch (error) {
	failures.push(`user-scoped catalog cache: ${error?.message || error}`);
	console.error(`FAIL recent sync: user-scoped catalog cache\n  ${error?.stack || error}`);
  } finally {
	await context.close();
  }
};

try {
  await runInitialProgressScenario();
  await runCacheFallbackScenario();
	await runColdFailureScenario();
	await runLegacyCacheMigrationScenario();
	await runMandatoryPageTailScenario();
	await runCacheFirstFolderScenario();
	await runUserScopedCacheScenario();
	await runScenario('inaccessible controlled page-tail dialog is quarantined', async page => {
	  await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.unavailableCount === 1 && !window.__PENA_RECENT_SYNC__?.detailsInFlight);
	  const calls = await page.evaluate(() => window.__recentHarness.calls());
	  assert.equal(calls.filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat150').length, 1);
	  assert.ok(!(await managedViewIds(page)).includes('chat150'), 'Inaccessible controlled chat remained clickable in the managed view');
	}, '?limitmandatory=1&tailaccess=1', 100);
	await runScenario('quarantined recent dialog stays disabled until revalidation succeeds', async page => {
	  await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.unavailableCount === 1 && !window.__PENA_RECENT_SYNC__?.detailsInFlight);
	  await page.evaluate(() => {
		window.__recentHarness.setDialogDetailError('chat150', null);
		const entries = window.__recentHarness.latestComplete();
		window.__recentHarness.enqueuePlan({ name: 'quarantine-recent-refresh', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
	  });
	  await startRefresh(page);
	  await page.waitForFunction(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat150').length === 2);
	  await closeFilters(page);
	  await page.locator('.pena-native-folder-tab[title="Хвост страницы"]').click();
	  await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.some(item => item.id === 'chat150'));
	  const pending = page.locator('.pena-native-remote-row[data-id="chat150"]');
	  await pending.waitFor({ state: 'visible' });
	  assert.equal(await pending.getAttribute('aria-disabled'), 'true', 'Pending quarantine row became clickable before detail validation');
	  await page.evaluate(() => window.__recentHarness.releaseDetailGate());
	  await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight && window.__PENA_RECENT_SYNC__?.unavailableCount === 0);
	  await page.waitForFunction(() => !document.querySelector('.pena-native-remote-row[data-id="chat150"]')?.hasAttribute('aria-disabled'));
	}, '?limitmandatory=1&tailaccess=1&detailgate=1', 100);
  await runScenario('three-page initial load', async page => {
    await page.waitForTimeout(250);
    const calls = await page.evaluate(() => window.__recentHarness.calls());
    assert.deepEqual(calls.filter(call => call.name === 'initial-three-pages').map(call => call.offset), [0, 200, 400]);
    assert.ok(calls.filter(call => call.name === 'initial-three-pages').every(call => call.skipOpenlines === 'N'), 'Open Line dialogs were excluded from the complete catalog request');
    assert.equal(calls.filter(call => call.method === 'im.recent.list').length, 3, 'Duplicate startup sync repeated the REST catalog request');
    assertExactIds(await managedIds(page), expectedIds(1, 401), 'Initial managed index mismatch');
    const sync = await syncState(page);
    assert.equal(sync.count, 401);
    assert.equal(sync.managedCount, 401);
	assert.equal(sync.loadLimit, 0, 'The first launch did not default to every available dialog');
    assert.equal(sync.phase, 'ready');
    assert.equal(sync.ready, true);
    assert.equal(sync.percent, 100);
    assert.equal(sync.error, '');
	assert.equal(await page.locator('.pena-native-sync-chip').isHidden(), true, 'Ready catalog kept a redundant status chip visible');
	await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.length === 401);
	assert.equal((await page.evaluate(() => window.__recentHarness.nativeState())).managedViewports, 1, 'Complete REST catalog was not mounted in the default view');
	assertExactIds((await managedViewIds(page)).sort(), expectedIds(1, 401), 'Default visible view dropped script-loaded dialogs');
  });

	await runScenario('bogus zero total cannot cut off old dialogs', async page => {
		await page.evaluate(() => {
			window.__recentHarness.resetPlans();
			const entries = window.__recentHarness.makeDataset(41001, 364, 'Ложный total');
			window.__recentHarness.enqueuePlan({
				name: 'bogus-zero-total-164',
				pages: [entries.slice(0, 164), entries.slice(164)],
				offsets: [0, 164],
				pageSize: 164,
				reportedTotal: 0,
				delayMs: 2
			});
			window.__recentHarness.setCounters({ CHAT: {}, DIALOG: {}, CHAT_UNREAD: [], DIALOG_UNREAD: [] });
		});
		await startRefresh(page);
		await page.waitForFunction(() => {
			const sync = window.__PENA_RECENT_SYNC__;
			return sync?.phase === 'ready' && !sync.inFlight && sync.windowCount === 364;
		}, null, { timeout: 10000 });
		const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'bogus-zero-total-164'));
		assert.deepEqual(calls.map(call => call.offset), [0, 164], 'A false total=0 stopped pagination after the first 164 dialogs');
		assertExactIds(await managedIds(page), expectedIds(41001, 364), 'Dialogs behind the false total=0 were lost');
		const sync = await syncState(page);
		assert.equal(sync.expectedTotal, 364, `Progress kept the impossible 164/0 total: ${JSON.stringify(sync)}`);
		assert.equal(sync.loadedCount, 364, `Progress counter diverged from the loaded catalog: ${JSON.stringify(sync)}`);
	});

	await runScenario('legacy finite setting migrates once to all available', async page => {
	const sync = await syncState(page);
	assert.equal(sync.loadLimit, 0);
	assert.equal(sync.windowCount, 401);
	assert.equal(await page.evaluate(() => localStorage.getItem('pena.dialogRecentLoadLimit.defaultAll.v1')), '1');
	assert.equal(await page.evaluate(() => localStorage.getItem('pena.dialogRecentLoadLimit.default500.v2')), '1');
	assert.equal(await page.evaluate(() => localStorage.getItem('pena.dialogRecentLoadLimit.defaultAll.v3')), '1');
  }, '?savedlimit=300');

  await runScenario('explicit finite setting survives after the default migration', async page => {
	const sync = await syncState(page);
	assert.equal(sync.loadLimit, 300);
	assert.equal(sync.windowCount, 300);
	assert.equal((await managedIds(page)).length, 300);
  }, '?savedlimit=300&limitmigrated=1', 300);

	await runScenario('finite limit refreshes only the recent head', async page => {
		await page.evaluate(() => {
			window.__recentHarness.resetPlans();
			const entries = window.__recentHarness.makeDataset(1, 401, 'Head');
			window.__recentHarness.enqueuePlan({
				name: 'finite-head-refresh',
				pages: window.__recentHarness.splitThree(entries),
				delayMs: 2
			});
		});
		await page.waitForTimeout(5100);
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await page.waitForFunction(() => window.__recentHarness.calls().some(call => call.name === 'finite-head-refresh'));
		await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.inFlight);
		const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'finite-head-refresh'));
		assert.equal(calls.length, 1, `Finite limit restarted a full backfill: ${JSON.stringify(calls)}`);
		assert.equal(calls[0].pageIndex, 0);
		assert.equal(calls[0].method, 'im.recent.get');
		assert.match(calls[0].lastSyncDate, /^\d{4}-\d{2}-\d{2}T/);
	}, '?savedlimit=300&limitmigrated=1', 300);

  await runScenario('object avatars render in script-loaded rows', async page => {
    await activateAscending(page);
    const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
    await row.waitFor({ state: 'visible' });
    const avatar = row.locator('.pena-native-remote-avatar');
	const state = await avatarState(avatar);
	assert.match(state.src, /avatar-9\.png/);
	assert.equal(state.imageHidden && state.initialsHidden && !state.loading, false, 'Avatar has neither an image, fallback nor loading placeholder');
  });

	await runScenario('script-loaded rows preserve the native last-message preview', async page => {
		const recentCalls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.recent.list'));
		assert.ok(recentCalls.length > 0);
		assert.ok(recentCalls.every(call => call.parseText === 'Y'), `Last-message parsing is disabled: ${JSON.stringify(recentCalls)}`);
		assert.ok(recentCalls.every(call => call.getOriginalText === 'N'));
		await activateAscending(page);
		const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
		await row.waitFor({ state: 'visible' });
		assert.equal(await row.locator('.pena-native-remote-message-copy').innerText(), 'Точная последняя реплика спикера');
		await page.waitForFunction(() => document.querySelector('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-author-avatar')?.getAttribute('src')?.includes('author-preview-77.png'));
		assert.match(await row.locator('.pena-native-remote-author-avatar').getAttribute('src'), /author-preview-77\.png/);
		const authorCalls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.user.list.get'));
		assert.equal(authorCalls.length, 1, `Author profile was not loaded as one batch: ${JSON.stringify(authorCalls)}`);
		const attachment = page.locator('.pena-native-remote-row[data-id="chat10"]');
		await attachment.waitFor({ state: 'visible' });
		assert.equal(await attachment.locator('.pena-native-remote-message-copy').innerText(), '[Файл]');
	}, '?messagepreviewcase=1');

	await runScenario('overlapping pages cannot erase a newer message preview', async page => {
		await activateAscending(page);
		const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
		await row.waitFor({ state: 'visible' });
		const overlap = await row.evaluate(element => ({ text: element.querySelector('.pena-native-remote-message-copy')?.textContent || '', meta: element._penaRemoteMeta || null }));
		assert.equal(overlap.text, 'Сообщение Начальный 09', JSON.stringify(overlap));
	}, '?duplicatepreview=1');

	await runScenario('partial duplicate keeps known author fields independently', async page => {
		await activateAscending(page);
		const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
		await row.waitFor({ state: 'visible' });
		assert.match(await row.locator('.pena-native-remote-author-avatar').getAttribute('src'), /full-author-77\.png/);
		assert.equal(await row.locator('.pena-native-remote-author-avatar').getAttribute('title'), 'Полный автор');
	}, '?authormergecase=1');

	await runScenario('outgoing preview uses the native self-author state', async page => {
		await activateAscending(page);
		const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
		await row.waitFor({ state: 'visible' });
		assert.equal(await row.locator('.pena-native-remote-message-copy').innerText(), 'Моё последнее сообщение');
		assert.equal(await row.locator('.pena-native-remote-self-author').isHidden(), false);
		assert.equal(await row.locator('.pena-native-remote-author-avatar').isHidden(), true);
		assert.equal(await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.user.list.get').length), 0);
	}, '?ownmessagecase=1&userid=99');

  await runScenario('group avatar never falls back to the last message author', async page => {
	await activateAscending(page);
	const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
	await row.waitFor({ state: 'visible' });
	const state = await avatarState(row.locator('.pena-native-remote-avatar'));
	assert.match(state.src, /group-chat-9\.png/);
	assert.doesNotMatch(state.src, /last-author-77\.png/);
  }, '?groupauthoravatar=1');

  await runScenario('group without its own avatar uses initials instead of the author', async page => {
	await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight);
	await activateAscending(page);
	const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
	await row.waitFor({ state: 'visible' });
	const state = await avatarState(row.locator('.pena-native-remote-avatar'));
	assert.equal(state.src, '');
	assert.equal(state.initialsHidden, false);
	assert.doesNotMatch(state.initials, /\d/);
	assert.doesNotMatch(state.src, /last-author-77\.png/);
  }, '?groupnoavatar=1');

	await runScenario('short group payload resolves the chat avatar instead of the last author', async page => {
		await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight);
		await activateAscending(page);
		const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
		await row.waitFor({ state: 'visible' });
		const state = await avatarState(row.locator('.pena-native-remote-avatar'));
		assert.match(state.src, /short-group-chat-9\.png/);
		assert.doesNotMatch(state.src, /short-author-77\.png/);
	}, '?groupauthoravatarshort=1');

  await runScenario('native chat avatar wins over an embedded author avatar', async page => {
	await activateAscending(page);
	const row = page.locator('.pena-native-remote-row[data-id="chat3"]');
	await row.waitFor({ state: 'visible' });
	const state = await avatarState(row.locator('.pena-native-remote-avatar'));
	assert.match(state.src, /native-chat-3\.png/);
	assert.doesNotMatch(state.src, /native-author-77\.png/);
  }, '?nativeavatarcase=1');

  await runScenario('missing recent avatar is enriched once through dialog details', async page => {
	await activateAscending(page);
	await page.waitForFunction(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9').length === 1);
	await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight);
	const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9').length);
	assert.equal(calls, 1, 'A visible dialog without an avatar was not enriched exactly once');
	const image = page.locator('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-avatar-image');
	await image.waitFor({ state: 'attached' });
	await page.waitForFunction(() => {
	  const avatar = document.querySelector('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-avatar-image');
	  return avatar && avatar.complete && avatar.naturalWidth > 0 && !avatar.hidden;
	});
  }, '?recentnoavatar=1');

  await runScenario('failed avatar keeps its cached URL and stable initials', async page => {
	await activateAscending(page);
	const image = page.locator('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-avatar-image');
	await image.waitFor({ state: 'attached' });
	await image.evaluate(element => {
	  window.__avatarRetrySource = element.dataset.penaSrc || element.getAttribute('src') || '';
	  element.dataset.penaSrc = window.__avatarRetrySource;
	  element.dataset.penaFailedAt = String(Date.now() - 60000);
	  element.hidden = true;
	  element.removeAttribute('src');
	});
	await page.locator('#bitrix-search').fill('Начальный');
	await page.waitForTimeout(150);
	const stable = await page.evaluate(() => {
	  const row = document.querySelector('.pena-native-remote-row[data-id="chat9"]');
	  const element = row?.querySelector('.pena-native-remote-avatar-image');
	  const initials = row?.querySelector('.pena-native-remote-avatar-initials');
	  return { cached: element?.dataset?.penaSrc || '', src: element?.getAttribute('src') || '', initialsVisible: initials ? !initials.hidden : false };
	});
	assert.equal(stable.cached, await page.evaluate(() => window.__avatarRetrySource), 'Transient image failure erased the cached avatar URL');
	assert.equal(stable.src, '', 'A failed avatar was retried on an unrelated UI render');
	assert.equal(stable.initialsVisible, true, 'Failed avatar did not keep stable initials visible');
  });

  await runScenario('authoritative counters and manual unread state', async page => {
    const sync = await syncState(page);
    assert.ok(sync.countersAt > 0, 'im.counters.get was not applied');
    assert.equal(sync.countersError, '');
    assert.equal(await page.locator('.pena-native-folder-tab[title="Сохранить"] .pena-native-tab-count').innerText(), '7');
    await page.locator('#bitrix-search').fill('нет такого диалога');
    await page.waitForFunction(() => document.querySelector('.pena-native-folder-tab[title="Сохранить"] .pena-native-tab-count')?.textContent === '0');
    await page.locator('#bitrix-search').fill('Начальный 01');
    await page.waitForFunction(() => document.querySelector('.pena-native-folder-tab[title="Сохранить"] .pena-native-tab-count')?.textContent === '7');
    await page.locator('#bitrix-search').fill('');
    await activateAscending(page);
    const unread = page.locator('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-counter');
    const manual = page.locator('.pena-native-remote-row[data-id="chat10"] .pena-native-remote-counter');
    const muted = page.locator('.pena-native-remote-row[data-id="chat11"] .pena-native-remote-counter');
    const openLine = page.locator('.pena-native-remote-row[data-id="chat12"] .pena-native-remote-counter');
    const read = page.locator('.pena-native-remote-row[data-id="chat13"] .pena-native-remote-counter');
    assert.equal(await unread.innerText(), '7');
    assert.equal(await manual.innerText(), '•');
    assert.equal(await muted.innerText(), '5');
    assert.equal(await openLine.innerText(), '6');
    assert.equal(await read.isHidden(), true, 'Read dialog was rendered as unread');
  }, '?custom=1&countercase=1');

  await runScenario('personal dialog avatar and counter normalization', async page => {
    await activateAscending(page);
    const row = page.locator('.pena-native-remote-row[data-id="user42"]');
    await row.waitFor({ state: 'visible' });
	assert.match((await avatarState(row.locator('.pena-native-remote-avatar'))).src, /user-42\.png/);
    assert.equal(await row.locator('.pena-native-remote-counter').innerText(), '3');
  }, '?usercase=1');

	await runScenario('long titles reserve a fixed lane for unread notifications', async page => {
		await activateAscending(page);
		const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
		await row.waitFor({ state: 'visible' });
		const geometry = await row.evaluate(element => {
			const container = element.querySelector('.bx-im-list-recent-item__container').getBoundingClientRect();
			const body = element.querySelector('.pena-native-remote-body').getBoundingClientRect();
			const tail = element.querySelector('.pena-native-remote-tail').getBoundingClientRect();
			const counter = element.querySelector('.pena-native-remote-counter');
			const counterRect = counter.getBoundingClientRect();
			const title = element.querySelector('.pena-native-remote-title');
			return {
				containerRight: container.right,
				bodyRight: body.right,
				tailLeft: tail.left,
				counterRight: counterRect.right,
				counterPosition: getComputedStyle(counter).position,
				truncated: title.scrollWidth > title.clientWidth
			};
		});
		const counterText = await row.locator('.pena-native-remote-counter').innerText();
		assert.equal(counterText, '99+', JSON.stringify(await row.evaluate(element => element._penaRemoteMeta || null)));
		assert.match(await row.locator('.pena-native-remote-counter').getAttribute('title'), /^142 /);
		assert.ok(geometry.bodyRight <= geometry.tailLeft + 0.5, `Title lane overlaps the notification lane: ${JSON.stringify(geometry)}`);
		assert.ok(geometry.counterRight <= geometry.containerRight + 0.5, `Notification escapes the row: ${JSON.stringify(geometry)}`);
		assert.equal(geometry.counterPosition, 'static');
		assert.equal(geometry.truncated, true);
	}, '?longtitlecounter=1');

	await runScenario('invalid avatar tokens are never rendered as image URLs', async page => {
		await activateAscending(page);
		const avatar = page.locator('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-avatar');
		await avatar.waitFor({ state: 'visible' });
		await page.waitForFunction(() => window.__recentHarness.calls().some(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9'));
		await page.waitForFunction(() => document.querySelector('.pena-native-remote-row[data-id="chat9"] .pena-native-remote-avatar-image')?.getAttribute('src')?.includes('recovered-avatar-9.png'));
		assert.doesNotMatch((await avatarState(avatar)).src, /%D0%9C%D0%92|\/МВ$/);
	}, '?invalidavatar=1');

	await runScenario('legacy folder identities migrate to real personal dialogs and open natively', async page => {
		const items = await page.evaluate(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]'));
		const leaders = items.filter(item => item.folderId === 'folder:leaders');
		assert.deepEqual(leaders.map(item => item.id).sort(), ['user42', 'user43']);
		assert.deepEqual(leaders.map(item => item.dialogId).sort(), ['42', '43']);
		const sameNumberGroups = items.filter(item => item.id === 'chat42' || item.id === 'chat43');
		assert.deepEqual(sameNumberGroups.map(item => item.title).sort(), ['Начальный 42', 'Начальный 43']);
		assert.equal(sameNumberGroups.some(item => item.folderId === 'folder:leaders'), false, 'Real group chats inherited the personal folder');
		await page.locator('.pena-native-folder-tab[title="Руководители"]').click();
		await page.waitForFunction(() => {
			const ids = Array.from(document.querySelector('.pena-native-managed-list')?._penaManagedState?.view || [], item => item.id).sort();
			return ids.join(',') === 'user42,user43';
		});
		for (const id of ['user42', 'user43']) {
			const row = page.locator(`.pena-native-remote-row[data-id="${id}"]`);
			await row.waitFor({ state: 'visible' });
			await row.evaluate(element => element.click());
		}
		await page.waitForFunction(() => window.__recentHarness.nativeOpens().includes('42') && window.__recentHarness.nativeOpens().includes('43'));
		assert.deepEqual((await page.evaluate(() => window.__recentHarness.nativeOpens())).sort(), ['42', '43']);
	}, '?leadershipcase=1');

	await runScenario('missing avatars hydrate only for the virtualized window', async page => {
		const sync = await syncState(page);
		assert.equal(sync.gateReady, true);
		assert.equal(sync.gateLocked, false);
		await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.detailsInFlight && window.__PENA_RECENT_SYNC__?.detailsTotal > 0);
		const detailState = await syncState(page);
		assert.ok(detailState.detailsTotal < 80, `Avatar hydration escaped the visible window: ${detailState.detailsTotal}`);
		const detailCalls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' || call.method === 'im.user.get').length);
		assert.ok(detailCalls > 0 && detailCalls < 80, `Unexpected avatar request burst: ${detailCalls}`);
		assert.equal(await page.locator('.pena-native-load-guard').isHidden(), true);
		assert.equal(await page.evaluate(() => !!document.querySelector('.pena-native-managed-list')?.inert), false);
		await page.evaluate(() => window.__recentHarness.releaseDetailGate());
	}, '?allnoavatar=1&detailgateall=1');

	await runScenario('counter failure keeps the catalog usable and retry recovers it', async page => {
		await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.inFlight && !!window.__PENA_RECENT_SYNC__?.countersError);
		const failed = await syncState(page);
		assert.notEqual(failed.countersError, '');
		assert.equal(await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.counters.get').length), 3);
		assert.equal(failed.gateLocked, false);
		assert.equal(await page.evaluate(() => !!document.querySelector('.pena-native-managed-list')?.inert), false);
		assert.equal(await page.locator('.pena-native-load-guard').isHidden(), true);
		await page.evaluate(() => window.__recentHarness.setCounterError(false));
		await startRefresh(page);
		await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.gateReady && window.__PENA_RECENT_SYNC__?.phase === 'ready' && !window.__PENA_RECENT_SYNC__?.countersError);
		const recovered = await syncState(page);
		assert.equal(recovered.countersError, '');
		assert.equal(recovered.gateError, '');
	}, '?countererror=1');

	await runScenario('cross-frame storage cannot turn a personal dialog back into a chat', async page => {
		await page.evaluate(() => {
			const key = 'pena.dialogControl.v1.chats';
			const items = JSON.parse(localStorage.getItem(key) || '[]');
			const marina = items.find(item => item.id === 'user42');
			marina.dialogId = 'chat42';
			const next = JSON.stringify(items);
			window.dispatchEvent(new StorageEvent('storage', { key, newValue: next }));
		});
		await page.waitForFunction(() => {
			const marina = JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'user42');
			return marina?.dialogId === '42' && marina?.folderId === 'folder:leaders';
		});
	}, '?leadershipcase=1');

	await runScenario('opening ignores a recycled native row and uses the canonical dialog id', async page => {
		await page.locator('.pena-native-folder-tab[title="Руководители"]').click();
		await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.length === 2);
		await page.evaluate(() => {
			const source = document.querySelector('#recent-list > [data-id="42"]');
			if (!source) return;
			source.dataset.id = 'chat999';
			source.querySelector('.bx-im-chat-title__text').textContent = 'Переиспользованная строка';
		});
		await page.locator('.pena-native-remote-row[data-id="user42"]').click();
		await page.waitForFunction(() => window.__recentHarness.apiOpens().includes('42'));
		assert.deepEqual(await page.evaluate(() => window.__recentHarness.apiOpens()), ['42']);
		assert.deepEqual(await page.evaluate(() => window.__recentHarness.nativeOpens()), []);
	}, '?leadershipcase=1&apicase=1');

  await runScenario('configured load limit caps only ordinary recent chats', async page => {
    await page.evaluate(() => {
      const entries = window.__recentHarness.makeDataset(10001, 800, 'Лимит');
      window.__recentHarness.enqueuePlan({
        name: 'limit-300',
        pages: [entries.slice(0, 200), entries.slice(200, 400), entries.slice(400, 600), entries.slice(600)],
        delayMs: 5
      });
      window.__recentHarness.setCounters({ CHAT: {}, DIALOG: {}, CHAT_UNREAD: [], DIALOG_UNREAD: [] });
    });
    const panel = await openFilters(page);
    await page.evaluate(() => { window.__recentHarnessLimitPanel = document.querySelector('.pena-native-filter-panel'); });
    await panel.locator('.pena-native-load-limit-select').selectOption('300');
    await page.waitForFunction(() => {
      const sync = window.__PENA_RECENT_SYNC__;
      return sync && !sync.inFlight && sync.windowCount === 300 && sync.loadLimit === 300 && !sync.error;
    }, null, { timeout: 10000 });
    const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'limit-300'));
    assert.deepEqual(calls.map(call => call.offset), [0, 200], 'Limit did not stop pagination after the configured window');
    const sync = await syncState(page);
    assert.equal(sync.count, 300);
    assert.equal(sync.truncated, true);
    assert.equal(await page.evaluate(() => window.__recentHarnessLimitPanel === document.querySelector('.pena-native-filter-panel')), true, 'Changing the load limit replaced and flashed the filter panel');
    assertExactIds(await managedIds(page), expectedIds(10001, 300), 'Configured recent window mismatch');
  });

  await runScenario('all available option loads beyond the old maximum', async page => {
	await page.evaluate(() => {
	  const entries = window.__recentHarness.makeDataset(11001, 1201, 'Все доступные');
	  const pages = [];
	  for (let offset = 0; offset < entries.length; offset += 200) pages.push(entries.slice(offset, offset + 200));
	  window.__recentHarness.enqueuePlan({ name: 'all-available', pages, delayMs: 2 });
	  window.__recentHarness.setCounters({ CHAT: {}, DIALOG: {}, CHAT_UNREAD: [], DIALOG_UNREAD: [] });
	});
	const panel = await openFilters(page);
	await panel.locator('.pena-native-load-limit-select').selectOption('0');
	await page.waitForFunction(() => {
	  const sync = window.__PENA_RECENT_SYNC__;
	  return sync && !sync.inFlight && sync.windowCount === 1201 && sync.loadLimit === 0 && !sync.error;
	}, null, { timeout: 15000 });
	const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'all-available'));
	assert.deepEqual(calls.map(call => call.offset), [0, 200, 400, 600, 800, 1000, 1200]);
	assert.equal((await syncState(page)).truncated, false);
	assertExactIds(await managedIds(page), expectedIds(11001, 1201), 'All-available catalog stopped at the old limit');
	assert.equal((await managedViewIds(page)).length, 1201);
  });

  await runScenario('all available caches the complete catalog when storage allows it', async page => {
	await page.evaluate(() => {
	  const entries = window.__recentHarness.makeDataset(21001, 5201, 'Большой каталог');
	  const pages = [];
	  for (let offset = 0; offset < entries.length; offset += 200) pages.push(entries.slice(offset, offset + 200));
	  window.__recentHarness.enqueuePlan({ name: 'all-cache-bound', pages, delayMs: 1 });
	  window.__recentHarness.setCounters({ CHAT: {}, DIALOG: {}, CHAT_UNREAD: [], DIALOG_UNREAD: [] });
	});
	const panel = await openFilters(page);
	await panel.locator('.pena-native-load-limit-select').selectOption('0');
	await page.waitForFunction(() => {
	  const sync = window.__PENA_RECENT_SYNC__;
	  return sync && !sync.inFlight && sync.windowCount === 5201 && sync.loadLimit === 0 && !sync.error;
	}, null, { timeout: 20000 });
	await page.waitForFunction(() => (window.__recentHarness.repositoryCache()?.records?.length || 0) === 5201, null, { timeout: 20000 });
	const state = await page.evaluate(() => ({ sync: window.__PENA_RECENT_SYNC__, cache: window.__recentHarness.repositoryCache() }));
	assert.equal(state.sync.truncated, false, 'Complete live catalog was reported as truncated');
	assert.equal(state.cache.records.length, 5201, 'Unlimited repository did not persist the complete catalog');
	assert.equal(state.cache.manifest.truncated, false, 'Complete repository snapshot was reported as truncated');
	assert.equal((await managedViewIds(page)).length, 5201);
  });

  await runScenario('unchanged refresh preserves managed row DOM', async page => {
    await activateAscending(page);
    await page.locator('.pena-native-remote-row[data-id="chat9"]').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      window.__unchangedManagedRow = document.querySelector('.pena-native-remote-row[data-id="chat9"]');
	  window.__unchangedManagedRoot = document.querySelector('.pena-native-managed-list');
	  window.__unchangedManagedViewport = document.querySelector('.pena-native-managed-viewport');
      const entries = window.__recentHarness.latestComplete();
      window.__recentHarness.enqueuePlan({ name: 'unchanged-refresh', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
    });
    await startRefresh(page);
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.phase === 'ready' && !window.__PENA_RECENT_SYNC__?.inFlight);
	const identity = await page.evaluate(() => {
	  const root = document.querySelector('.pena-native-managed-list');
	  const viewport = document.querySelector('.pena-native-managed-viewport');
	  return {
		row: window.__unchangedManagedRow === document.querySelector('.pena-native-remote-row[data-id="chat9"]'),
		root: window.__unchangedManagedRoot === root,
		viewport: window.__unchangedManagedViewport === viewport,
		oldRootConnected: !!window.__unchangedManagedRoot?.isConnected,
		oldViewportConnected: !!window.__unchangedManagedViewport?.isConnected,
		stateSignature: root?._penaManagedState?.signature || '',
		renderSignature: root?._penaManagedState?.renderSignature || '',
		debug: window.__PENA_MANAGED_DEBUG__ || null,
		sync: window.__PENA_RECENT_SYNC__ || null
	  };
	});
	assert.equal(identity.row, true, `Unchanged background data rebuilt the managed row DOM: ${JSON.stringify(identity)}`);
  });

	{
		const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
		const page = await context.newPage();
		const pageErrors = collectPageErrors(page);
		try {
			await page.goto(`${server.baseUrl}/tests/recent-sync-harness.html?oldcontrol=1&detailgate=1`);
			await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
			try {
				await page.waitForFunction(() => window.__recentHarness.calls().some(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9000'));
			} catch (error) {
				const diagnostic = await page.evaluate(() => ({ sync: window.__PENA_RECENT_SYNC__ || null, calls: window.__recentHarness.calls(), managed: window.__recentHarness.managedItems(), repository: window.__recentHarness.repositoryCache() }));
				throw new Error(`Mandatory detail gate did not start: ${JSON.stringify(diagnostic)}; ${error.message}`);
			}
			const verifying = await syncState(page);
			assert.equal(verifying.gateLocked, false);
			assert.equal(verifying.controlledPendingCount, 1);
			assert.equal(await page.locator('.pena-native-load-guard').isHidden(), true);
			await page.locator('.pena-native-folder-tab[title="Старый контроль"]').click();
			const pending = page.locator('.pena-native-remote-row[data-id="chat9000"]');
			await pending.waitFor({ state: 'visible' });
			assert.equal(await pending.getAttribute('aria-disabled'), 'true');
			await page.evaluate(() => window.__recentHarness.releaseDetailGate());
			await waitForInitialSync(page);
			const ready = await syncState(page);
			assert.equal(ready.phase, 'ready');
			assert.equal(ready.gateLocked, false);
			assert.equal(ready.controlledReadyCount, 1);
			await page.locator('.pena-native-folder-tab[title="Старый контроль"]').click();
			await page.waitForFunction(() => document.querySelector('.pena-native-remote-row[data-id="chat9000"]'));
			const avatar = page.locator('.pena-native-remote-row[data-id="chat9000"] .pena-native-remote-avatar');
			const avatarSnapshot = await avatarState(avatar);
			const avatarDiagnostic = await page.evaluate(() => {
				const row = document.querySelector('.pena-native-remote-row[data-id="chat9000"]');
				const image = row?.querySelector('.pena-native-remote-avatar-image');
				return {
					meta: row?._penaRemoteMeta || null,
					image: image ? { src: image.getAttribute('src'), penaSrc: image.dataset.penaSrc, retries: image.dataset.penaRetryCount } : null,
					calls: window.__recentHarness.calls().filter(call => call.dialogId === 'chat9000'),
					sync: window.__PENA_RECENT_SYNC__ || null
				};
			});
			assert.match(avatarSnapshot.src, /avatar-9000\.png/, JSON.stringify(avatarDiagnostic));
			assert.deepEqual(pageErrors, []);
			console.log('PASS recent sync: pending folder dialog alone stays blocked until verification');
		} catch (error) {
			failures.push(`mandatory folder row barrier: ${error?.message || error}`);
			console.error(`FAIL recent sync: mandatory folder row barrier\n  ${error?.stack || error}`);
		} finally {
			await context.close();
		}
	}

  await runScenario('old controlled dialog stays cached and current outside limit', async page => {
	await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight);
    const ids = await managedIds(page);
    assert.ok(ids.includes('chat9000'), 'Controlled dialog outside the recent window was dropped');
    const sync = await syncState(page);
    assert.equal(sync.windowCount, 401);
    assert.equal(sync.controlledOutsideCount, 1);
    assert.ok((await page.evaluate(() => window.__recentHarness.calls())).some(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9000'));
    assert.equal(await page.locator('.pena-native-folder-tab[title="Старый контроль"] .pena-native-tab-count').innerText(), '4');
    await page.waitForTimeout(5100);
    await page.evaluate(() => {
      window.__recentHarness.setCounters({ CHAT: { 9000: 9 }, DIALOG: {}, CHAT_UNREAD: [], DIALOG_UNREAD: [] });
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(() => document.querySelector('.pena-native-folder-tab[title="Старый контроль"] .pena-native-tab-count')?.textContent === '9', null, { timeout: 5000 });
    await page.locator('.pena-native-folder-tab[title="Старый контроль"]').click();
    await page.waitForFunction(() => window.__PENA_MANAGED_DEBUG__?.status === 'ready');
    const avatar = page.locator('.pena-native-remote-row[data-id="chat9000"] .pena-native-remote-avatar');
    await avatar.waitFor({ state: 'visible' });
	assert.match((await avatarState(avatar)).src, /avatar-9000\.png/);
  }, '?oldcontrol=1');

	await runScenario('controlled dialog outside recent loads its actual last message once', async page => {
		try {
			await page.waitForFunction(() => window.__recentHarness.calls().some(call => call.method === 'im.dialog.messages.get' && call.dialogId === 'chat9000'));
		} catch (error) {
			const diagnostic = await page.evaluate(() => ({
				sync: window.__PENA_RECENT_SYNC__ || null,
				calls: window.__recentHarness.calls().filter(call => call.dialogId === 'chat9000' || call.method === 'im.dialog.messages.get'),
				item: window.__recentHarness.managedItems().find(item => String(item.id) === 'chat9000') || null
			}));
			throw new Error(`Controlled preview request did not run: ${JSON.stringify(diagnostic)}; ${error.message}`);
		}
		await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight);
		const messageCalls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.messages.get' && call.dialogId === 'chat9000'));
		assert.equal(messageCalls.length, 1, `Controlled preview caused repeated history calls: ${JSON.stringify(messageCalls)}`);
		assert.equal(messageCalls[0].limit, 1);
		await page.locator('.pena-native-folder-tab[title="Старый контроль"]').click();
		const row = page.locator('.pena-native-remote-row[data-id="chat9000"]');
		await row.waitFor({ state: 'visible' });
		assert.equal(await row.locator('.pena-native-remote-message-copy').innerText(), 'Последняя реплика контролируемого диалога');
	}, '?oldcontrol=1&oldcontrolmessage=1&detailgenerationrace=1');

	await runScenario('empty message response remains retryable', async page => {
		await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight);
		const before = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.messages.get' && call.dialogId === 'chat9000').length);
		assert.equal(before, 1);
		await page.evaluate(() => {
			const entries = window.__recentHarness.latestComplete();
			window.__recentHarness.enqueuePlan({ name: 'empty-preview-retry', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
		});
		await startRefresh(page);
		await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.inFlight && !window.__PENA_RECENT_SYNC__?.detailsInFlight);
		const result = await page.evaluate(() => ({
			calls: window.__recentHarness.calls().filter(call => call.method === 'im.dialog.messages.get' && call.dialogId === 'chat9000').length,
			record: window.__recentHarness.repositoryCache()?.records?.find(record => record.id === 'chat9000') || null
		}));
		assert.equal(result.calls, 2, 'Empty history response disabled further preview enrichment');
		assert.equal(result.record?.lastMessage?.resolved, false);
	}, '?oldcontrol=1');

  await runScenario('controlled dialog without avatar respects detail TTL', async page => {
	await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight);
    assert.equal((await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9000').length)), 1);
    await page.evaluate(() => {
      const entries = window.__recentHarness.latestComplete();
      window.__recentHarness.enqueuePlan({ name: 'no-avatar-refresh', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
    });
    await startRefresh(page);
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.phase === 'ready' && !window.__PENA_RECENT_SYNC__?.inFlight);
	const ttlDiagnostic = await page.evaluate(() => ({
	  calls: window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9000'),
	  record: window.__recentHarness.repositoryCache()?.records?.find(record => record.id === 'chat9000') || null,
	  rowMeta: document.querySelector('.pena-native-remote-row[data-id="chat9000"]')?._penaRemoteMeta || null,
	  sync: window.__PENA_RECENT_SYNC__ || null
	}));
    assert.equal(ttlDiagnostic.calls.length, 1, `Missing avatar retriggered im.dialog.get before the detail TTL: ${JSON.stringify(ttlDiagnostic)}`);
  }, '?oldcontrol=1&noavatar=1');

  await runScenario('inaccessible controlled dialog is quarantined and can recover', async page => {
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.unavailableCount === 1 && !window.__PENA_RECENT_SYNC__?.detailsInFlight);
	const failedSync = await syncState(page);
	assert.equal(failedSync.detailsFailed, 1);
	assert.equal(failedSync.managedCount, 401, 'Inaccessible dialog was counted as active');
	assert.equal((await page.evaluate(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9000').length)), 1);
	assert.ok((await managedIds(page)).includes('chat9000'), 'Folder configuration was destroyed after ACCESS_ERROR');
	await page.waitForFunction(() => window.__recentHarness.repositoryCache()?.records?.some(record => record.id === 'chat9000' && record.state?.availability === 'unavailable'));
	const folder = page.locator('.pena-native-folder-tab[title="Старый контроль"]');
	assert.equal(await folder.locator('.pena-native-tab-count').innerText(), '0');
	await folder.click();
	await page.waitForFunction(() => document.querySelector('.pena-native-folder-tab[title="Старый контроль"]')?.classList.contains('--active'));
	await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.length === 0);
	assert.deepEqual(await managedViewIds(page), [], 'Inaccessible dialog remained in the active folder view');
	assert.equal(await page.locator('.pena-native-remote-row[data-id="chat9000"]').count(), 0, 'Inaccessible dialog could still be clicked');
	assert.match(await page.locator('.pena-native-sync-chip').getAttribute('title'), /недоступно или удалено: 1/);

	await page.evaluate(() => window.__recentHarness.setDialogDetailError('chat9000', null));
	await startRefresh(page);
	await page.waitForFunction(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9000').length === 2);
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.unavailableCount === 0 && !window.__PENA_RECENT_SYNC__?.detailsInFlight);
	assert.equal(await folder.getAttribute('class').then(value => /--active/.test(value || '')), true, 'Manual access recovery changed the active folder');
	await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.some(item => item.id === 'chat9000'));
	const recovered = page.locator('.pena-native-remote-row[data-id="chat9000"]');
	await recovered.waitFor({ state: 'visible' });
	assert.match((await avatarState(recovered.locator('.pena-native-remote-avatar'))).src, /avatar-9000\.png/);
	assert.equal(await folder.locator('.pena-native-tab-count').innerText(), '4');
  }, '?oldcontrol=1&detailaccess=1');

  await runScenario('transient detail failure keeps an unverified controlled dialog disabled', async page => {
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.detailsFailed === 1 && !window.__PENA_RECENT_SYNC__?.detailsInFlight && !window.__PENA_RECENT_SYNC__?.inFlight);
	assert.equal((await syncState(page)).unavailableCount, 0);
	const syncChip = page.locator('.pena-native-sync-chip');
	await page.waitForFunction(() => document.querySelector('.pena-native-sync-chip')?.textContent?.includes('Проверить 1'));
	assert.match(await syncChip.innerText(), /Проверить 1/);
	assert.match(await syncChip.getAttribute('class'), /--(?:warning|error)/);
	assert.doesNotMatch(await syncChip.getAttribute('class'), /--ready/);
	await page.locator('.pena-native-folder-tab[title="Старый контроль"]').click();
	await page.waitForFunction(() => document.querySelector('.pena-native-folder-tab[title="Старый контроль"]')?.classList.contains('--active'));
	await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.some(item => item.id === 'chat9000'));
	const pending = page.locator('.pena-native-remote-row[data-id="chat9000"]');
	await pending.waitFor({ state: 'visible' });
	assert.equal(await pending.getAttribute('aria-disabled'), 'true');
	await page.evaluate(() => window.__recentHarness.setDialogDetailError('chat9000', null));
	await startRefresh(page);
	await page.waitForFunction(() => window.__recentHarness.calls().filter(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9000').length === 2);
	await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.detailsInFlight && window.__PENA_RECENT_SYNC__?.controlledReadyCount === 1);
	await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.some(item => item.id === 'chat9000'));
  }, '?oldcontrol=1&detailtransient=1');

  await runScenario('empty successful detail response never creates a phantom dialog', async page => {
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.detailsFailed === 1 && !window.__PENA_RECENT_SYNC__?.detailsInFlight);
	const sync = await syncState(page);
	assert.equal(sync.controlledPendingCount, 1);
	assert.equal(sync.controlledReadyCount, 0);
	await page.locator('.pena-native-folder-tab[title="Старый контроль"]').click();
	await page.waitForFunction(() => document.querySelector('.pena-native-folder-tab[title="Старый контроль"]')?.classList.contains('--active'));
	await page.waitForFunction(() => document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.some(item => item.id === 'chat9000'));
	const pending = page.locator('.pena-native-remote-row[data-id="chat9000"]');
	await pending.waitFor({ state: 'visible' });
	assert.equal(await pending.getAttribute('aria-disabled'), 'true');
  }, '?oldcontrol=1&detailinvalid=1');

  await runScenario('live progress is visible between pages', async page => {
    await page.evaluate(() => {
      const entries = window.__recentHarness.makeDataset(8001, 401, 'Прогресс');
      window.__recentHarness.enqueuePlan({
        name: 'gated-progress',
        pages: window.__recentHarness.splitThree(entries),
        gateAtPage: 1,
        delayMs: 5
      });
    });
    await startRefresh(page);
    await page.waitForFunction(() => window.__recentHarness.calls().some(call => call.name === 'gated-progress' && call.pageIndex === 1));
    const loading = await syncState(page);
    assert.equal(loading.phase, 'full-sync');
    assert.equal(loading.inFlight, true);
    assert.equal(loading.loadedCount, 200);
    assert.equal(loading.expectedTotal, 401);
    assert.equal(loading.pagesLoaded, 1);
    assert.equal(loading.percent, 50);
	assert.equal(loading.gatePercent, 100);
	assert.equal(await page.locator('.pena-native-sync-chip').innerText(), '50%');
    assert.match(await page.locator('.pena-native-sync-status-text').innerText(), /200 из 401/);
    await page.evaluate(() => window.__recentHarness.releaseGate());
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.phase === 'ready' && !window.__PENA_RECENT_SYNC__?.inFlight);
  });

  await runScenario('stored task hint cannot override an ordinary API chat', async page => {
    const ownership = await page.evaluate(() => ({
      tasks: window.__recentHarness.managedItems('tasks').map(item => String(item.id)),
      chats: window.__recentHarness.managedItems('chats').map(item => String(item.id))
    }));
    assert.equal(ownership.tasks.includes('chat9001'), false, 'Stored task membership overrode the API chat type');
    assert.ok(ownership.chats.includes('chat9001'), 'Ordinary API chat did not return to the ordinary list');
  }, '?taskseed=1');

  await runScenario('official task chat opens messenger without task side panel', async page => {
	await page.waitForFunction(() => document.querySelector('.pena-native-remote-row[data-id="chat9001"]'));
	const ownership = await page.evaluate(() => ({
	  tasks: window.__recentHarness.managedItems('tasks').map(item => String(item.id)),
	  chats: window.__recentHarness.managedItems('chats').map(item => String(item.id))
	}));
	assert.ok(ownership.tasks.includes('chat9001'), 'Official tasksTask payload was not classified as a task chat');
	assert.ok(!ownership.tasks.includes('chat9002'), 'Ordinary chat was classified as a task only because its entity link contained a task URL');
	await page.locator('.pena-native-remote-row[data-id="chat9001"]').click();
	await page.waitForFunction(() => window.__recentHarness.apiOpens().includes('chat9001'));
	await page.waitForFunction(() => window.__recentHarness.nativeOpens().includes('chat9001'));
	assert.deepEqual(await page.evaluate(() => window.__recentHarness.sidePanelOpens()), [], 'Task row opened SidePanel instead of the messenger');
  }, '?taskview=1&apicase=1');

  await runScenario('system message never borrows a user avatar', async page => {
	await activateAscending(page);
	const row = page.locator('.pena-native-remote-row[data-id="chat9"]');
	await row.waitFor({ state: 'visible' });
	const systemState = await row.evaluate(element => ({ text: element.querySelector('.pena-native-remote-message-copy')?.textContent || '', meta: element._penaRemoteMeta || null }));
	assert.match(systemState.text, /Системное изменение чата/, JSON.stringify(systemState));
	assert.equal(await row.locator('.pena-native-remote-author-avatar').isHidden(), true);
	assert.equal(await row.locator('.pena-native-remote-self-author').isHidden(), true);
  }, '?systemauthor=1');

  await runScenario('transient empty catalog preserves the last complete list', async page => {
    await page.waitForTimeout(250);
    await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.inFlight && !document.querySelector('.pena-native-sync-refresh')?.disabled);
    const beforeIds = await managedIds(page);
    await page.evaluate(() => window.__recentHarness.enqueuePlan({ name: 'empty-catalog', pages: [[]], delayMs: 200 }));
    await startRefresh(page);
    try {
      await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.ready && !!window.__PENA_RECENT_SYNC__?.error && !window.__PENA_RECENT_SYNC__?.inFlight, null, { timeout: 5000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        sync: window.__PENA_RECENT_SYNC__ || null,
        calls: window.__recentHarness.calls(),
        managed: window.__recentHarness.managedItems().length,
        debug: window.__PENA_MANAGED_DEBUG__ || null
      }));
      throw new Error(`Transient empty catalog did not settle safely: ${JSON.stringify(diagnostic)}; ${error.message}`);
    }
    const sync = await syncState(page);
    assert.equal(sync.count, 401);
    assert.equal(sync.phase, 'error');
    assert.equal(sync.empty, false);
    assertExactIds(await managedIds(page), beforeIds, 'Transient empty response erased the catalog');
    await page.evaluate(() => window.__recentHarness.enqueuePlan({ name: 'confirmed-empty-catalog', pages: [[]], delayMs: 5 }));
    await startRefresh(page);
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.ready && window.__PENA_RECENT_SYNC__?.empty && !window.__PENA_RECENT_SYNC__?.inFlight, null, { timeout: 5000 });
    assert.equal((await managedIds(page)).length, 0, 'A repeated authoritative empty catalog was never accepted');
  });

  await runScenario('short pages follow explicit next offsets', async page => {
    const expected = await page.evaluate(() => {
      const entries = window.__recentHarness.makeDataset(6001, 120, 'Короткая страница');
      window.__recentHarness.enqueuePlan({
        name: 'explicit-next-50-50-20',
        pages: [entries.slice(0, 50), entries.slice(50, 100), entries.slice(100)],
        offsets: [0, 50, 100],
        pageSize: 50,
        delayMs: 5
      });
      return entries.map(entry => entry.dialog_id).sort();
    });
    await startRefresh(page);
    await page.waitForFunction(() => {
      const sync = window.__PENA_RECENT_SYNC__;
      return sync && !sync.inFlight && sync.count === 120 && !sync.error;
    }, null, { timeout: 10000 });
    const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'explicit-next-50-50-20'));
    assert.deepEqual(calls.map(call => call.offset), [0, 50, 100], 'REST next offsets were not followed exactly');
    assert.deepEqual(calls.map(call => call.limit), [200, 200, 200], 'extension changed its requested REST page limit');
    assertExactIds(await managedIds(page), expected, 'Explicit next pagination did not commit all 120 dialogs');
  });

  await runScenario('short overlapping pages work without pagination metadata', async page => {
	await page.evaluate(() => {
	  const entries = window.__recentHarness.makeDataset(13001, 451, 'Без metadata');
	  window.__recentHarness.enqueuePlan({
		name: 'metadata-free-overlap',
		pages: [
		  entries.slice(0, 120),
		  entries.slice(100, 230),
		  entries.slice(210, 340),
		  entries.slice(320),
		  []
		],
		paginationMetadata: false,
		delayMs: 5
	  });
	  window.__recentHarness.setCounters({ CHAT: {}, DIALOG: {}, CHAT_UNREAD: [], DIALOG_UNREAD: [] });
	});
	await startRefresh(page);
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.phase === 'ready' && !window.__PENA_RECENT_SYNC__?.inFlight && window.__PENA_RECENT_SYNC__?.windowCount === 451);
	const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'metadata-free-overlap'));
	assert.deepEqual(calls.map(call => call.offset), [0, 200, 400, 600, 800]);
	assertExactIds(await managedIds(page), expectedIds(13001, 451), 'Metadata-free overlap catalog lost dialogs');
	const sync = await syncState(page);
	assert.equal(sync.truncated, false, JSON.stringify(sync));
	assert.equal(sync.managedCount, 451);
  });

  await runScenario('metadata-free duplicates do not stop before older dialogs', async page => {
	await page.evaluate(() => {
	  const entries = window.__recentHarness.makeDataset(31001, 300, 'Повторные страницы');
	  const head = entries.slice(0, 200);
	  window.__recentHarness.enqueuePlan({
		name: 'metadata-free-stagnation-recovery',
		pages: [head, head, head, head, entries.slice(200), []],
		paginationMetadata: false,
		delayMs: 2
	  });
	  window.__recentHarness.setCounters({ CHAT: {}, DIALOG: {}, CHAT_UNREAD: [], DIALOG_UNREAD: [] });
	});
	await startRefresh(page);
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.phase === 'ready' && !window.__PENA_RECENT_SYNC__?.inFlight && window.__PENA_RECENT_SYNC__?.windowCount === 300);
	const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'metadata-free-stagnation-recovery'));
	assert.deepEqual(calls.map(call => call.offset), [0, 200, 400, 600, 800, 1000]);
	assertExactIds(await managedIds(page), expectedIds(31001, 300), 'Older dialogs after duplicate pages were lost');
	const sync = await syncState(page);
	assert.equal(sync.truncated, false, JSON.stringify(sync));
  });

  await runScenario('transactional full refresh', async page => {
    const expected = await page.evaluate(() => {
      const entries = window.__recentHarness.makeDataset(2001, 403, 'Обновленный', 5);
      window.__recentHarness.enqueuePlan({ name: 'full-refresh', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
      return entries.map(entry => entry.dialog_id).sort();
    });
    await startRefresh(page);
    await page.waitForFunction(() => {
      const sync = window.__PENA_RECENT_SYNC__;
      return sync && !sync.inFlight && sync.count === 403 && !sync.error;
    }, null, { timeout: 10000 });
    assertExactIds(await managedIds(page), expected, 'A successful full refresh did not replace the managed dialog index');
    const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'full-refresh'));
    assert.deepEqual(calls.map(call => call.offset), [0, 200, 400]);
  });

  for (const failureType of ['error', 'timeout']) {
    await runScenario(`${failureType} preserves last complete list`, async page => {
      const beforeIds = await managedIds(page);
      const beforeSync = await syncState(page);
      await page.evaluate(type => {
        const entries = window.__recentHarness.makeDataset(type === 'error' ? 3001 : 4001, 401, `Незавершенный ${type}`);
        window.__recentHarness.enqueuePlan({
          name: `failed-${type}`,
          pages: window.__recentHarness.splitThree(entries),
          errorAtPage: type === 'error' ? 1 : -1,
          timeoutAtPage: type === 'timeout' ? 1 : -1,
          errorMessage: 'planned refresh failure',
          delayMs: 5
        });
      }, failureType);
      await startRefresh(page);
      await page.waitForFunction(() => {
        const sync = window.__PENA_RECENT_SYNC__;
        return sync && !sync.inFlight && !!sync.error;
      }, null, { timeout: 5000 });
      const afterSync = await syncState(page);
      assert.equal(afterSync.count, beforeSync.count, 'A failed full refresh changed the published complete count');
      assert.equal(afterSync.lastFullAt, beforeSync.lastFullAt, 'A failed full refresh advanced lastFullAt');
      assertExactIds(await managedIds(page), beforeIds, 'A partial failed refresh leaked into the managed list');
    });
  }

  await runScenario('custom folders and colors survive catalog absence', async page => {
    await page.evaluate(() => {
      const entries = window.__recentHarness.makeDataset(7001, 401, 'Без сохраненного');
      window.__recentHarness.enqueuePlan({ name: 'missing-customized', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
    });
    await startRefresh(page);
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__ && !window.__PENA_RECENT_SYNC__.inFlight && !window.__PENA_RECENT_SYNC__.error);
    let customized = await page.evaluate(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'chat1'));
    assert.equal(customized?.folderId, 'folder:keep');
    assert.equal(customized?.color, '#a855f7');
    assert.equal(customized?.recentMissing, undefined, 'Controlled dialog lost its hydrated record outside the recent window');

    await page.evaluate(() => {
      const entries = window.__recentHarness.makeDataset(1, 401, 'Вернувшийся');
      window.__recentHarness.enqueuePlan({ name: 'customized-returned', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
    });
    await startRefresh(page);
    await page.waitForFunction(() => window.__PENA_RECENT_SYNC__ && !window.__PENA_RECENT_SYNC__.inFlight && !window.__PENA_RECENT_SYNC__.error);
    customized = await page.evaluate(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'chat1'));
    assert.equal(customized?.folderId, 'folder:keep');
    assert.equal(customized?.color, '#a855f7');
    assert.equal(customized?.recentMissing, undefined);
  }, '?custom=1');

  await runScenario('background hydration preserves a newer folder assignment', async page => {
	await page.evaluate(() => {
	  const key = 'pena.dialogControl.v1.chats';
	  const remote = JSON.parse(localStorage.getItem(key) || '[]');
	  remote.push({ id: 'folder:remote', type: 'folder', title: 'Из другой вкладки' });
	  const dialog = remote.find(item => item.id === 'chat1');
	  dialog.folderId = 'folder:remote';
	  localStorage.setItem(key, JSON.stringify(remote));
	  const entries = window.__recentHarness.makeDataset(1, 401, 'Обновлено в фоне');
	  window.__recentHarness.enqueuePlan({ name: 'cross-tab-folder', pages: window.__recentHarness.splitThree(entries), delayMs: 5 });
	});
	await startRefresh(page);
	await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.inFlight && window.__PENA_RECENT_SYNC__?.phase === 'ready');
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]'));
	const dialog = saved.find(item => item.id === 'chat1');
	assert.equal(dialog?.folderId, 'folder:remote', 'Stale hydration overwrote the newer folder assignment');
	assert.match(dialog?.title || '', /Обновлено в фоне/);
	assert.ok(saved.some(item => item.id === 'folder:remote'), 'Folder created in another tab was lost');
  }, '?custom=1');

  await runScenario('manual refresh works with an active folder', async page => {
    await page.waitForTimeout(250);
    await page.waitForFunction(() => !window.__PENA_RECENT_SYNC__?.inFlight);
    await page.getByRole('button', { name: /Сохранить/ }).click();
    await page.waitForFunction(() => document.querySelector('.pena-native-folder-tab.--active .pena-native-folder-tab-label')?.textContent === 'Сохранить');
    await page.evaluate(() => {
      const entries = window.__recentHarness.makeDataset(1, 401, 'После папки');
      window.__recentHarness.enqueuePlan({ name: 'with-folder-active', pages: window.__recentHarness.splitThree(entries), delayMs: 8 });
    });
    await startRefresh(page);
    await page.waitForFunction(() => {
      const sync = window.__PENA_RECENT_SYNC__;
      return sync?.phase === 'ready' && !sync.inFlight && !sync.error;
    });
    const calls = await page.evaluate(() => window.__recentHarness.calls().filter(call => call.name === 'with-folder-active'));
    assert.deepEqual(calls.map(call => call.offset), [0, 200, 400], 'Active folder swallowed the manual refresh click');
    assert.equal(await page.locator('.pena-native-folder-tab.--active .pena-native-folder-tab-label').innerText(), 'Сохранить');
  }, '?custom=1');

  await runScenario('isolated search during refresh and clear', async page => {
    const baseline = new Set(await managedIds(page));
    const nativeBefore = await page.evaluate(() => window.__recentHarness.nativeState());
    assert.equal(nativeBefore.sameReferences, true, 'Native fixture was already replaced before search');
	assert.equal(nativeBefore.managedViewports, 1, 'Default mode did not expose the complete managed catalog');
    const refreshedIds = await page.evaluate(() => {
      const entries = window.__recentHarness.makeDataset(5001, 401, 'Свежий', 5);
      window.__recentHarness.enqueuePlan({
        name: 'gated-search-refresh',
        pages: window.__recentHarness.splitThree(entries),
        gateAtPage: 1,
        delayMs: 5
      });
      return entries.map(entry => entry.dialog_id).sort();
    });
    await startRefresh(page);
    await page.waitForFunction(() => window.__recentHarness.calls().some(call => call.name === 'gated-search-refresh' && call.pageIndex === 1));
    await page.locator('#bitrix-search').fill('Искомый');
    await page.waitForTimeout(180);
    const searchedNative = await page.evaluate(() => window.__recentHarness.nativeState());
	assert.deepEqual(searchedNative.visibleIds, nativeBefore.ids, `PENA query reached the native Bitrix search: ${JSON.stringify(searchedNative.visibleIds)}`);
    assert.equal(searchedNative.sameReferences, true, 'Search replaced or reordered Bitrix rows');
	assert.equal(searchedNative.managedViewports, 1, 'Plain search dropped the complete managed catalog');
	assert.deepEqual(await managedViewIds(page), ['chat8'], 'Search did not filter the script-loaded catalog');
    assertExactIds(await managedIds(page), [...baseline].sort(), 'In-flight refresh changed the last complete catalog during search');

    await page.locator('#bitrix-search').fill('');
    await page.waitForTimeout(180);
    const clearedNative = await page.evaluate(() => window.__recentHarness.nativeState());
    assert.deepEqual(clearedNative.ids, nativeBefore.ids, 'Clearing search lost or reordered native dialogs');
    assert.deepEqual(clearedNative.visibleIds, nativeBefore.ids, 'Clearing search did not restore every native dialog');
    assert.equal(clearedNative.sameReferences, true, 'Clearing search replaced Bitrix row nodes');
	assert.equal(clearedNative.managedViewports, 1, 'Clearing search removed the complete managed catalog');
	assert.equal((await managedViewIds(page)).length, 401, 'Clearing search did not restore every script-loaded dialog');
    assertExactIds(await managedIds(page), [...baseline].sort(), 'Clearing search changed the last complete catalog');

    await page.evaluate(() => window.__recentHarness.releaseGate());
    try {
      await page.waitForFunction(() => {
        const sync = window.__PENA_RECENT_SYNC__;
        return sync && !sync.inFlight && sync.count === 401 && !sync.error;
      }, null, { timeout: 10000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        sync: window.__PENA_RECENT_SYNC__ || null,
        calls: window.__recentHarness.calls(),
        managed: window.__recentHarness.managedItems().length,
        view: document.querySelector('.pena-native-managed-list')?._penaManagedState?.view?.length || 0
      }));
      throw new Error(`Refresh did not settle after search: ${JSON.stringify(diagnostic)}; ${error.message}`);
    }
    assertExactIds(await managedIds(page), refreshedIds, 'Search activity left stale dialogs after the completed refresh');
    const nativeAfterRefresh = await page.evaluate(() => window.__recentHarness.nativeState());
    assert.deepEqual(nativeAfterRefresh.ids, nativeBefore.ids, 'Catalog refresh mutated Bitrix-owned rows');
    assert.deepEqual(nativeAfterRefresh.visibleIds, nativeBefore.ids, 'Catalog refresh hid native rows after search was cleared');
    assert.equal(nativeAfterRefresh.sameReferences, true, 'Catalog refresh replaced Bitrix-owned row nodes');
  });
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  throw new AggregateError(failures.map(message => new Error(message)), `${failures.length} recent sync regression(s) failed`);
}
console.log('PASS recent sync regressions: pagination, transactional refresh, recovery, customization safety, isolated search');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const injectedPath = fileURLToPath(new URL('../extension/injected.js', import.meta.url));
const manifestPath = fileURLToPath(new URL('../extension/manifest.json', import.meta.url));
const expectedVersion = JSON.parse(readFileSync(manifestPath, 'utf8')).version;

const addOptionalEntryHook = (source, signature, metric) => {
	const matches = source.split(signature).length - 1;
	assert.ok(matches <= 1, `Instrumentation anchor is ambiguous for ${metric}: ${signature}`);
	return matches ? source.replace(
		signature,
		`${signature}\n\t\twindow.__PENA_COLD_TASK_METRICS__?.hit?.('${metric}');`
	) : source;
};

const instrumentInjected = rawSource => {
	let source = rawSource;
	for (const [signature, metric] of [
		['\tfunction findContainer() {', 'findContainer'],
		['\tfunction isInternalChatsDOM() {', 'isInternalChatsDOM'],
		['\tfunction isTasksChatsModeNow() {', 'isTasksChatsModeNow'],
		['\tfunction getItemMetaInternal(el) {', 'getItemMetaInternal'],
		['\tfunction loadCustomCats() {', 'loadCustomCats'],
		['\tfunction _getDialogControlItemsForMode(mode = getCurrentChatsMode()) {', 'getControlItems'],
		['\tfunction _isDialogTimeFrameActive() {', 'timeFrameActive'],
		['\tfunction _readDialogTimeVisits(dateKey = _getDialogTimeTodayKey()) {', 'readTimeVisits'],
		['\tfunction _writeDialogTimeVisits(visits, dateKey = _getDialogTimeTodayKey()) {', 'writeTimeVisits'],
		['\tfunction _claimDialogTimeActivityLease(activityId, options = {}) {', 'claimTimeLease'],
		['\tfunction _persistDialogTimeActivity(activity = {}, options = {}) {', 'persistTimeActivity'],
		['\tasync function _refreshDialogRecentCatalog(options = {}) {', 'refreshRecentCatalog'],
		['\tfunction _captureDialogNativeWindow(mode = getCurrentChatsMode(), container = findContainer(), options = {}) {', 'captureNativeWindow'],
		['\tfunction _syncDialogNativeTraversalRows(container, rows = []) {', 'syncTraversalRows'],
		['\tfunction _publishDialogTimeTaskIndexRows(rows = []) {', 'publishTaskIndexRows'],
		['\tfunction _commitDialogTaskCatalogResult(result = {}, options = {}) {', 'commitTaskCatalog'],
		['\tfunction _hydrateAllDialogControlModesFromRecent() {', 'hydrateAllControlModes'],
		['\tasync function _writeDialogRecentCache() {', 'writeRecentCache'],
		['\tfunction _scheduleDialogNativePresentationRefresh(container = findContainer(), rows = [], delay = 500) {', 'presentationRefreshSchedule'],
		['\tfunction _scheduleDialogNativePresentationRefresh(container = findContainer(), delay = 500) {', 'presentationRefreshSchedule']
	]) source = addOptionalEntryHook(source, signature, metric);
	for (const [signature, hook] of [
		[
			'\tasync function _runDialogNativeOriginalScrollLoad(options = {}) {',
			"window.__PENA_COLD_TASK_METRICS__?.recordTraversal?.(options?.reason || '');"
		],
		[
			"\tfunction _scheduleDialogNativeModeLoad(reason = 'mode-enter', delay = 80) {",
			'window.__PENA_COLD_TASK_METRICS__?.recordModeLoad?.(reason, delay);'
		]
	]) {
		const matches = source.split(signature).length - 1;
		assert.equal(matches, 1, `Reason instrumentation anchor changed: ${signature}`);
		source = source.replace(signature, `${signature}\n\t\t${hook}`);
	}
	return source;
};

const percentile = (values, quantile) => {
	if (!values.length) return 0;
	const sorted = values.slice().sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
};

const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 780 } });
const pageErrors = collectPageErrors(page);
const instrumentedInjected = instrumentInjected(readFileSync(injectedPath, 'utf8'));

try {
	await page.route(/\/tests\/native-resume-recovery-harness\.html(?:\?.*)?$/, async route => {
		const response = await route.fetch();
		let body = await response.text();
		const chatAnchor = '<section class="test-host recent-host" data-mode="chats">';
		const taskAnchor = '<section class="test-host task-host" data-mode="tasks" hidden>';
		assert.ok(body.includes(chatAnchor) && body.includes(taskAnchor), 'Initial task-mode HTML anchors changed');
		body = body
			.replace(chatAnchor, '<section class="test-host recent-host" data-mode="chats" hidden>')
			.replace(taskAnchor, '<section class="test-host task-host" data-mode="tasks">')
			.replace('window.__PENA_TEST_EAGER_MATERIALIZATION__ = true;', 'window.__PENA_TEST_EAGER_MATERIALIZATION__ = false;')
			.replace('window.__PENA_TEST_NATIVE_EXPECTED_AUDIT__ = true;', 'window.__PENA_TEST_NATIVE_EXPECTED_AUDIT__ = false;')
			.replace('window.__PENA_TEST_NATIVE_TASK_AUDIT__ = true;', 'window.__PENA_TEST_NATIVE_TASK_AUDIT__ = false;')
			.replace(
				"localStorage.setItem(`pena.dialogControlView.${mode}`, JSON.stringify({ sortMode: 'color', sortDirection: 'asc', unreadOnly: false }));",
				"localStorage.setItem(`pena.dialogControlView.${mode}`, JSON.stringify({ sortMode: 'date', sortDirection: 'desc', unreadOnly: false }));"
			)
			.replace(
				"localStorage.setItem(`pena.dialogControlNativeFolder.v1.${mode}`, folderId);",
				"localStorage.removeItem(`pena.dialogControlNativeFolder.v1.${mode}`);"
			)
			.replace(
				"localStorage.setItem(`pena.nativeSearchQuery.v1.${mode}`, 'needle');",
				"localStorage.removeItem(`pena.nativeSearchQuery.v1.${mode}`);"
			);
		for (const expected of [
			'window.__PENA_TEST_EAGER_MATERIALIZATION__ = false;',
			'window.__PENA_TEST_NATIVE_EXPECTED_AUDIT__ = false;',
			'window.__PENA_TEST_NATIVE_TASK_AUDIT__ = false;',
			"sortMode: 'date', sortDirection: 'desc'",
			'localStorage.removeItem(`pena.dialogControlNativeFolder.v1.${mode}`)',
			'localStorage.removeItem(`pena.nativeSearchQuery.v1.${mode}`)'
		]) assert.ok(body.includes(expected), `Interaction-priority fixture patch is missing: ${expected}`);
		await route.fulfill({ response, body });
	});
	await page.route(/\/extension\/injected\.js(?:\?.*)?$/, route => route.fulfill({
		status: 200,
		contentType: 'application/javascript; charset=utf-8',
		body: instrumentedInjected
	}));
	await page.addInitScript(() => {
		const NativeMutationObserver = window.MutationObserver;
		const nativeStorageGetItem = Storage.prototype.getItem;
		const nativeStorageSetItem = Storage.prototype.setItem;
		const nativeStorageRemoveItem = Storage.prototype.removeItem;
		const freshCounts = () => Object.create(null);
		const metrics = {
			enabled: false,
			counts: freshCounts(),
			lifetimeCounts: freshCounts(),
			modeLoadReasons: [],
			traversalReasons: [],
			localStorageGets: Object.create(null),
			localStorageSets: Object.create(null),
			localStorageRemoves: Object.create(null),
			keydownMs: [],
			clickMs: [],
			pullHandlers: [],
			observerCallbacks: [],
			frameGaps: [],
			longTasks: [],
			trustedKeydowns: 0,
			trustedClicks: 0,
			scrollEvents: 0,
			startedAt: 0,
			lastFrameAt: 0,
			frameHandle: 0,
			hit(name) {
				this.lifetimeCounts[name] = (this.lifetimeCounts[name] || 0) + 1;
				if (this.enabled) this.counts[name] = (this.counts[name] || 0) + 1;
			},
			recordModeLoad(reason, delay) {
				this.modeLoadReasons.push({ reason: String(reason || ''), delay: Number(delay) || 0, at: performance.now() });
			},
			recordTraversal(reason) {
				this.traversalReasons.push({ reason: String(reason || ''), at: performance.now() });
			},
			reset() {
				this.enabled = true;
				this.counts = freshCounts();
				this.localStorageGets = Object.create(null);
				this.localStorageSets = Object.create(null);
				this.localStorageRemoves = Object.create(null);
				this.keydownMs = [];
				this.clickMs = [];
				this.pullHandlers = [];
				this.observerCallbacks = [];
				this.frameGaps = [];
				this.longTasks = [];
				this.trustedKeydowns = 0;
				this.trustedClicks = 0;
				this.scrollEvents = 0;
				this.startedAt = performance.now();
				this.lastFrameAt = 0;
				if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
				const frame = now => {
					if (!this.enabled) return;
					if (this.lastFrameAt) this.frameGaps.push(now - this.lastFrameAt);
					this.lastFrameAt = now;
					this.frameHandle = requestAnimationFrame(frame);
				};
				this.frameHandle = requestAnimationFrame(frame);
			},
			snapshot() {
				return {
					counts: { ...this.counts },
					lifetimeCounts: { ...this.lifetimeCounts },
					modeLoadReasons: this.modeLoadReasons.slice(),
					traversalReasons: this.traversalReasons.slice(),
					localStorageGets: { ...this.localStorageGets },
					localStorageSets: { ...this.localStorageSets },
					localStorageRemoves: { ...this.localStorageRemoves },
					keydownMs: this.keydownMs.slice(),
					clickMs: this.clickMs.slice(),
					pullHandlers: this.pullHandlers.slice(),
					observerCallbacks: this.observerCallbacks.slice(),
					frameGaps: this.frameGaps.slice(),
					longTasks: this.longTasks.slice(),
					trustedKeydowns: this.trustedKeydowns,
					trustedClicks: this.trustedClicks,
					scrollEvents: this.scrollEvents,
					elapsed: performance.now() - this.startedAt
				};
			},
			stop() {
				const value = this.snapshot();
				this.enabled = false;
				if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
				this.frameHandle = 0;
				return value;
			}
		};
		window.__PENA_COLD_TASK_METRICS__ = metrics;

		let keyStartedAt = 0;
		document.addEventListener('keydown', event => {
			if (!metrics.enabled || event.target?.id !== 'pena-cold-task-composer') return;
			keyStartedAt = performance.now();
			if (event.isTrusted) metrics.trustedKeydowns += 1;
		}, true);
		document.addEventListener('keydown', event => {
			if (!metrics.enabled || event.target?.id !== 'pena-cold-task-composer' || !keyStartedAt) return;
			metrics.keydownMs.push(performance.now() - keyStartedAt);
			keyStartedAt = 0;
		}, false);

		let clickStartedAt = 0;
		document.addEventListener('click', event => {
			if (!metrics.enabled || !event.target?.closest?.('#pena-cold-task-row')) return;
			clickStartedAt = performance.now();
			if (event.isTrusted) metrics.trustedClicks += 1;
		}, true);
		document.addEventListener('click', event => {
			if (!metrics.enabled || !event.target?.closest?.('#pena-cold-task-row') || !clickStartedAt) return;
			metrics.clickMs.push(performance.now() - clickStartedAt);
			clickStartedAt = 0;
		}, false);

		const observerLabel = target => {
			if (target?.matches?.('.bx-im-list-container-task__elements')) return 'taskSourceObserver';
			if (target === document.body) return 'bodyObserver';
			if (target === document.documentElement) return 'documentObserver';
			return 'otherObserver';
		};
		window.MutationObserver = class InstrumentedMutationObserver {
			constructor(callback) {
				this.labels = new Set();
				this.native = new NativeMutationObserver(records => {
					const startedAt = performance.now();
					if (metrics.enabled) this.labels.forEach(label => metrics.hit(label));
					try { return callback(records, this); }
					finally {
						if (metrics.enabled) metrics.observerCallbacks.push(performance.now() - startedAt);
					}
				});
			}
			observe(target, options) {
				this.labels.add(observerLabel(target));
				return this.native.observe(target, options);
			}
			disconnect() { return this.native.disconnect(); }
			takeRecords() { return this.native.takeRecords(); }
		};

		const bumpKey = (bucket, key) => {
			const normalized = String(key || '');
			bucket[normalized] = (bucket[normalized] || 0) + 1;
		};
		Storage.prototype.getItem = function instrumentedGetItem(key) {
			if (metrics.enabled && this === window.localStorage) {
				metrics.hit('localStorageGet');
				bumpKey(metrics.localStorageGets, key);
			}
			return nativeStorageGetItem.call(this, key);
		};
		Storage.prototype.setItem = function instrumentedSetItem(key, value) {
			if (metrics.enabled && this === window.localStorage) {
				metrics.hit('localStorageSet');
				bumpKey(metrics.localStorageSets, key);
			}
			return nativeStorageSetItem.call(this, key, value);
		};
		Storage.prototype.removeItem = function instrumentedRemoveItem(key) {
			if (metrics.enabled && this === window.localStorage) {
				metrics.hit('localStorageRemove');
				bumpKey(metrics.localStorageRemoves, key);
			}
			return nativeStorageRemoveItem.call(this, key);
		};

		document.addEventListener('scroll', event => {
			if (metrics.enabled && event.target?.matches?.('.bx-im-list-container-task__scroll-container')) {
				metrics.scrollEvents += 1;
			}
		}, true);

		if (Array.isArray(PerformanceObserver?.supportedEntryTypes) && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
			new PerformanceObserver(list => {
				if (!metrics.enabled) return;
				for (const entry of list.getEntries()) {
					if (entry.startTime >= metrics.startedAt) metrics.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
				}
			}).observe({ entryTypes: ['longtask'] });
		}

		const nativeEventHandlers = new Map();
		let bxValue;
		Object.defineProperty(window, 'BX', {
			configurable: true,
			get: () => bxValue,
			set(value) {
				if (value && typeof value === 'object' && typeof value.addCustomEvent !== 'function') {
					value.addCustomEvent = (name, handler) => {
						if (typeof handler !== 'function') return;
						const handlers = nativeEventHandlers.get(name) || [];
						handlers.push((...args) => {
							const startedAt = performance.now();
							try { return handler(...args); }
							finally {
								if (metrics.enabled) metrics.pullHandlers.push({ name, duration: performance.now() - startedAt });
							}
						});
						nativeEventHandlers.set(name, handlers);
					};
				}
				bxValue = value;
			}
		});
		window.__PENA_COLD_TASK_EVENT_STATE__ = () => Object.fromEntries(
			Array.from(nativeEventHandlers, ([name, handlers]) => [name, handlers.length])
		);
		window.__PENA_DISPATCH_COLD_TASK_PULL__ = payload => {
			for (const name of ['onPullEvent-im', 'onPullEvent-im-v2']) {
				for (const handler of nativeEventHandlers.get(name) || []) handler(payload);
			}
		};
	});

	const url = new URL('/tests/native-resume-recovery-harness.html', server.baseUrl);
	url.search = new URLSearchParams({ taskCount: '5000', chatCount: '108', recentDelayMs: '25' });
	const navigationStartedAt = Date.now();
	await page.goto(url.href);
	await page.waitForFunction(version => {
		const harness = window.__resumeHarness?.state?.();
		return window.__PENA_RECENT_SYNC__?.version === version && harness?.activeMode === 'tasks';
	}, expectedVersion, { timeout: 15000 });
	const remainingColdWindow = Math.max(0, 900 - (Date.now() - navigationStartedAt));
	if (remainingColdWindow) await page.waitForTimeout(remainingColdWindow);

	const coldAt900ms = await page.evaluate(() => {
		const state = window.__resumeHarness.state();
		const status = state.status || {};
		const taskAttempt = status.modeStates?.tasks?.attempt || {};
		const overlays = Array.from(document.querySelectorAll('.pena-native-original-load-guard,.pena-native-load-guard'));
		const overlayVisible = overlays.some(node => {
			const style = getComputedStyle(node);
			const rect = node.getBoundingClientRect();
			return !node.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
				Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
		});
		const metrics = window.__PENA_COLD_TASK_METRICS__.snapshot();
		return {
			originalActive: !!status.originalActive,
			apiActive: !!status.apiActive,
			modeLoadPending: !!status.modeLoadPending,
			modeLoadReason: String(status.modeLoadReason || ''),
			attemptState: String(taskAttempt.state || ''),
			attemptReason: String(taskAttempt.reason || status.attemptReason || ''),
			overlayCount: overlays.length,
			overlayVisible,
			guardVisible: !!state.guardVisible,
			loadingStatusVisible: !!state.loadingStatusVisible,
			observed: state.modes.tasks.observedIds.length,
			catalog: state.modes.tasks.catalogIds.length,
			ui: state.modes.tasks.ui,
			restCalls: state.restCalls,
			fullRestCalls: state.restCalls.filter(call => call.method === 'im.recent.list' || call.method === 'tasks.task.list'),
			lifetimeCounts: metrics.lifetimeCounts,
			modeLoadReasons: metrics.modeLoadReasons,
			traversalReasons: metrics.traversalReasons
		};
	});

	await page.waitForFunction(() => {
		const handlers = window.__PENA_COLD_TASK_EVENT_STATE__?.() || {};
		return (handlers['onPullEvent-im'] || 0) > 0 && (handlers['onPullEvent-im-v2'] || 0) > 0;
	}, { timeout: 5000 });
	await page.evaluate(() => {
		const visibleRows = Array.from(document.querySelectorAll('.task-host [data-id]')).filter(row => {
			const rect = row.getBoundingClientRect();
			const style = getComputedStyle(row);
			return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
				style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 &&
				style.pointerEvents !== 'none';
		});
		const targetableRows = visibleRows.filter(row => {
			const rect = row.getBoundingClientRect();
			const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
			return hit === row || row.contains(hit);
		});
		const row = (targetableRows.length ? targetableRows : visibleRows)
			.sort((left, right) => Number(left.dataset.taskId || Infinity) - Number(right.dataset.taskId || Infinity))[0];
		if (!row) throw new Error('No rendered task row is available after interaction-priority startup');
		row.id = 'pena-cold-task-row';
		row.dataset.nativeOpenCount = '0';
		row.addEventListener('click', () => {
			row.dataset.nativeOpenCount = String(Number(row.dataset.nativeOpenCount || 0) + 1);
		});
		const composer = document.createElement('div');
		composer.id = 'pena-cold-task-composer';
		composer.className = 'bx-im-textarea__content';
		composer.contentEditable = 'true';
		composer.setAttribute('role', 'textbox');
		composer.setAttribute('aria-label', 'Введите сообщение');
		composer.style.cssText = 'position:fixed;left:440px;top:80px;width:360px;min-height:44px;padding:8px;z-index:1000;background:#fff;border:1px solid #ccd4df';
		document.body.appendChild(composer);
	});

	const rowHit = await page.evaluate(() => {
		const row = document.querySelector('#pena-cold-task-row');
		const rect = row.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		const style = getComputedStyle(row);
		return {
			rowTargetable: hit === row || row.contains(hit),
			rowClass: String(row.className || ''),
			hitTag: String(hit?.tagName || ''),
			hitId: String(hit?.id || ''),
			hitClass: String(hit?.className || ''),
			rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
			style: { display: style.display, visibility: style.visibility, opacity: style.opacity, pointerEvents: style.pointerEvents }
		};
	});
	await page.evaluate(() => window.__PENA_COLD_TASK_METRICS__.reset());
	const rowBox = await page.locator('#pena-cold-task-row').boundingBox();
	assert.ok(rowBox, 'Task row has no box after interaction-priority startup');
	await page.mouse.click(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
	await page.waitForTimeout(75);
	const realClick = await page.evaluate(() => ({
		metrics: window.__PENA_COLD_TASK_METRICS__.stop(),
		openCount: Number(document.querySelector('#pena-cold-task-row')?.dataset.nativeOpenCount || 0)
	}));

	const sendBefore = await page.evaluate(() => {
		const state = window.__resumeHarness.state();
		return { restCalls: state.restCalls.length, scrollTop: state.modes.tasks.scrollTop };
	});
	await page.evaluate(() => window.__PENA_COLD_TASK_METRICS__.reset());
	const composer = page.locator('#pena-cold-task-composer');
	await composer.click();
	await composer.pressSequentially('production interaction priority');
	await composer.press('Enter');
	await page.evaluate(() => {
		const row = document.querySelector('#pena-cold-task-row');
		const dialogId = String(row?.dataset.id || '');
		window.__PENA_DISPATCH_COLD_TASK_PULL__?.({
			command: 'messageAdd',
			params: { message: { author_id: '7', dialog_id: dialogId, chat_id: dialogId.replace(/^chat/, ''), is_own: true } }
		});
		const preview = row?.querySelector('.test-preview');
		if (preview) {
			preview.textContent = 'production interaction priority';
			preview.setAttribute('aria-label', 'Отправляется');
			preview.setAttribute('aria-label', 'Доставлено');
		}
	});
	await page.waitForTimeout(300);
	const sendAfter = await page.evaluate(restStart => {
		const state = window.__resumeHarness.state();
		const status = state.status || {};
		return {
			metrics: window.__PENA_COLD_TASK_METRICS__.stop(),
			restCalls: state.restCalls.slice(restStart),
			allFullRestCalls: state.restCalls.filter(call => call.method === 'im.recent.list' || call.method === 'tasks.task.list'),
			scrollTop: state.modes.tasks.scrollTop,
			originalActive: !!status.originalActive,
			modeLoadReason: String(status.modeLoadReason || ''),
			attemptReason: String(status.modeStates?.tasks?.attempt?.reason || status.attemptReason || ''),
			overlays: document.querySelectorAll('.pena-native-original-load-guard,.pena-native-load-guard').length
		};
	}, sendBefore.restCalls);

	const diagnostic = {
		coldAt900ms,
		rowHit,
		realClick: {
			openCount: realClick.openCount,
			trustedClicks: realClick.metrics.trustedClicks,
			clickP95: percentile(realClick.metrics.clickMs, 0.95),
			counts: realClick.metrics.counts,
			localStorageGets: realClick.metrics.localStorageGets
		},
		send: {
			keydownSamples: sendAfter.metrics.keydownMs.length,
			trustedKeydowns: sendAfter.metrics.trustedKeydowns,
			keydownP95: percentile(sendAfter.metrics.keydownMs, 0.95),
			keydownMax: Math.max(0, ...sendAfter.metrics.keydownMs),
			pullHandlers: sendAfter.metrics.pullHandlers,
			pullHandlerMax: Math.max(0, ...sendAfter.metrics.pullHandlers.map(sample => sample.duration)),
			frameGapMax: Math.max(0, ...sendAfter.metrics.frameGaps),
			observerCallbackMax: Math.max(0, ...sendAfter.metrics.observerCallbacks),
			longTasks: sendAfter.metrics.longTasks,
			scrollEvents: sendAfter.metrics.scrollEvents,
			counts: sendAfter.metrics.counts,
			localStorageGets: sendAfter.metrics.localStorageGets,
			restCalls: sendAfter.restCalls,
			allFullRestCalls: sendAfter.allFullRestCalls,
			originalActive: sendAfter.originalActive,
			modeLoadReason: sendAfter.modeLoadReason,
			attemptReason: sendAfter.attemptReason,
			overlays: sendAfter.overlays,
			scrollTop: [sendBefore.scrollTop, sendAfter.scrollTop]
		}
	};
	console.log(`DIAGNOSTIC native cold task interaction ${JSON.stringify(diagnostic)}`);

	assert.equal(coldAt900ms.originalActive, false, `Cold tasks started native traversal: ${JSON.stringify(diagnostic)}`);
	assert.equal(coldAt900ms.apiActive, false, `Cold tasks started blocking API load: ${JSON.stringify(diagnostic)}`);
	assert.equal(coldAt900ms.overlayVisible, false, `Cold tasks exposed a loading overlay: ${JSON.stringify(diagnostic)}`);
	assert.equal(coldAt900ms.overlayCount, 0, `Cold tasks retained an overlay node: ${JSON.stringify(diagnostic)}`);
	assert.deepEqual(coldAt900ms.fullRestCalls, [], `Cold tasks started a full REST crawl: ${JSON.stringify(diagnostic)}`);
	assert.deepEqual(coldAt900ms.traversalReasons, [], `Cold tasks entered full native traversal: ${JSON.stringify(diagnostic)}`);
	assert.equal(rowHit.rowTargetable, true, `Task row was not pointer-targetable: ${JSON.stringify(diagnostic)}`);
	assert.equal(realClick.openCount, 1, `A real task-row click was lost: ${JSON.stringify(diagnostic)}`);
	assert.equal(realClick.metrics.trustedClicks, 1, `Task-row click was not trusted: ${JSON.stringify(diagnostic)}`);
	assert.ok(percentile(realClick.metrics.clickMs, 0.95) <= 8, `Task-row click handler exceeded 8 ms: ${JSON.stringify(diagnostic)}`);
	assert.ok(percentile(sendAfter.metrics.keydownMs, 0.95) <= 8, `Task composer keydown p95 exceeded 8 ms: ${JSON.stringify(diagnostic)}`);
	assert.ok(Math.max(0, ...sendAfter.metrics.pullHandlers.map(sample => sample.duration)) <= 8, `Outgoing Pull handler exceeded 8 ms: ${JSON.stringify(diagnostic)}`);
	assert.equal(realClick.metrics.counts.localStorageSet || 0, 0, `Task-row click wrote localStorage synchronously: ${JSON.stringify(diagnostic)}`);
	assert.equal(realClick.metrics.counts.localStorageGet || 0, 0, `Task-row click read localStorage synchronously: ${JSON.stringify(diagnostic)}`);
	assert.equal(sendAfter.metrics.counts.localStorageSet || 0, 0, `Outgoing message wrote localStorage synchronously: ${JSON.stringify(diagnostic)}`);
	assert.ok((sendAfter.metrics.counts.localStorageGet || 0) <= 12, `Outgoing interaction repeated broad localStorage reads: ${JSON.stringify(diagnostic)}`);
	assert.equal(sendAfter.restCalls.some(call => call.method === 'tasks.task.get'), false, `Outgoing message started tasks.task.get in the hot path: ${JSON.stringify(diagnostic)}`);
	assert.equal(sendAfter.metrics.scrollEvents, 0, `Interaction-priority path scrolled the task list: ${JSON.stringify(diagnostic)}`);
	assert.ok(Math.abs(sendAfter.scrollTop - sendBefore.scrollTop) < 0.5, `Interaction changed task-list scrollTop: ${JSON.stringify(diagnostic)}`);
	assert.deepEqual(sendAfter.allFullRestCalls, [], `Interaction started a full REST crawl: ${JSON.stringify(diagnostic)}`);
	assert.equal(sendAfter.originalActive, false, `Interaction started native traversal: ${JSON.stringify(diagnostic)}`);
	assert.equal(sendAfter.overlays, 0, `Interaction left a loading overlay: ${JSON.stringify(diagnostic)}`);
	assert.ok(Math.max(0, ...sendAfter.metrics.frameGaps) <= 50, `Interaction created a frame gap above 50 ms: ${JSON.stringify(diagnostic)}`);
	assert.equal(sendAfter.metrics.longTasks.length, 0, `Cold task interaction produced a long task: ${JSON.stringify(diagnostic)}`);
	assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`);

	console.log(
		`PASS native cold task interaction-priority: real click, zero full REST/scroll, ` +
		`keydown p95 ${percentile(sendAfter.metrics.keydownMs, 0.95).toFixed(1)} ms`
	);
} finally {
	await browser.close();
	await server.close();
}

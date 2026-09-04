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
const messageCount = 12;
const catalogSize = 1000;

const addEntryHook = (source, signature, metric) => {
	const matches = source.split(signature).length - 1;
	assert.equal(matches, 1, `Instrumentation anchor changed for ${metric}: ${signature}`);
	return source.replace(
		signature,
		`${signature}\n\t\twindow.__PENA_TEST_PERF_METRICS__?.hit?.('${metric}');`
	);
};

const addOptionalEntryHook = (source, signature, metric) => {
	const matches = source.split(signature).length - 1;
	assert.ok(matches <= 1, `Instrumentation anchor is ambiguous for ${metric}: ${signature}`);
	return matches ? source.replace(
		signature,
		`${signature}\n\t\twindow.__PENA_TEST_PERF_METRICS__?.hit?.('${metric}');`
	) : source;
};

const emulateLegacyBroadClassifier = source => {
	const classifierPattern = /\t\tconst mutationTouchesBitrixRowIdentity = mutation => \{[\s\S]*?\n\t\t\};/;
	const classifier = source.match(classifierPattern)?.[0] || '';
	assert.ok(classifier, 'Legacy-classifier negative-control anchor changed');
	const broad = classifier
		.replace('\t\t\tif (mutationTouchesBitrixCounterState(mutation)) return false;', '')
		.replace("\t\t\tif (mutation.type === 'characterData') return false;", "\t\t\tif (mutation.type === 'characterData') return !!ownerRow;")
		.replace('\t\t\tif (ownerRow) return false;', '\t\t\tif (ownerRow) return true;');
	assert.notEqual(broad, classifier, 'Legacy-classifier negative control made no change');
	return source.replace(classifier, broad);
};

const instrumentInjected = rawSource => {
	let source = process.env.PENA_TEST_EMULATE_BROAD_CLASSIFIER === '1'
		? emulateLegacyBroadClassifier(rawSource)
		: rawSource;
	for (const [signature, metric] of [
		['\tfunction applyFilters() {', 'applyFilters'],
		['\tfunction _refreshDialogNativeVisibleWindow() {', 'visibleWindowRefresh'],
		['\tfunction _commitDialogNativeCatalog(target, state, options = {}) {', 'catalogCommit'],
		['\tasync function _runDialogNativeOriginalScrollLoad(options = {}) {', 'fullNativeMaterialization'],
		['\tasync function _probeDialogNativeTail(mode, container = findContainer()) {', 'tailProbe'],
		['\tfunction _renderDialogControlNativeSwitcher(container, items) {', 'toolbarRender'],
		['\tfunction _renderDialogControlPanel(h = filtersHost) {', 'panelRender'],
		['\tfunction _applyDialogControlNativeView(container = findContainer(), options = {}) {', 'nativeViewApply'],
		['\tfunction _scheduleDialogNativePassThroughRefresh(delay = 120) {', 'passThroughRefreshSchedule'],
		['\tasync function _writeDialogRecentCache() {', 'cacheWrite']
	]) source = addEntryHook(source, signature, metric);
	for (const [signature, metric] of [
		['\tfunction _scheduleDialogNativeStatusRefresh(container = findContainer(), dialogIds = [], delay = 70) {', 'statusRefreshSchedule'],
		['\tfunction _scheduleDialogNativePresentationRefresh(container = findContainer(), delay = 500) {', 'presentationRefreshSchedule'],
		['\tfunction _scheduleDialogNativePresentationRefresh(container = findContainer(), rows = [], delay = 500) {', 'presentationRefreshSchedule']
	]) source = addOptionalEntryHook(source, signature, metric);

	for (const [flushAnchor, metric, required] of [
		['\t\t_dialogNativeStatusRefreshTimer = setTimeout(() => {', 'statusRefreshFlush', false],
		['\t\t_dialogNativePresentationRefreshTimer = setTimeout(() => {', 'presentationRefreshFlush', false],
		['\t\t_dialogNativePassThroughRefreshTimer = setTimeout(() => {', 'passThroughRefreshFlush', true]
	]) {
		const matches = source.split(flushAnchor).length - 1;
		if (required) assert.equal(matches, 1, `${metric} instrumentation anchor changed`);
		else assert.ok(matches <= 1, `${metric} instrumentation anchor is ambiguous`);
		if (!matches) continue;
		source = source.replace(
			flushAnchor,
			`${flushAnchor}\n\t\t\twindow.__PENA_TEST_PERF_METRICS__?.hit?.('${metric}');`
		);
	}

	const toolbarRebuildAnchor = '\t\tconst switcherContent = document.createDocumentFragment();';
	assert.equal(source.split(toolbarRebuildAnchor).length - 1, 1, 'Toolbar rebuild instrumentation anchor changed');
	source = source.replace(
		toolbarRebuildAnchor,
		`\t\twindow.__PENA_TEST_PERF_METRICS__?.hit?.('toolbarRebuild');\n${toolbarRebuildAnchor}`
	);
	return source;
};

const percentile = (values, quantile) => {
	if (!values.length) return 0;
	const sorted = values.slice().sort((left, right) => left - right);
	return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
};

const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 780 } });
const pageErrors = collectPageErrors(page);
const rawInjected = readFileSync(injectedPath, 'utf8');
const instrumentedInjected = instrumentInjected(rawInjected);

try {
	await page.route(/\/extension\/injected\.js(?:\?.*)?$/, route => route.fulfill({
		status: 200,
		contentType: 'application/javascript; charset=utf-8',
		body: instrumentedInjected
	}));
	await page.addInitScript(() => {
		const NativeMutationObserver = window.MutationObserver;
		const nativeStorageSetItem = Storage.prototype.setItem;
		const nativeStorageRemoveItem = Storage.prototype.removeItem;
		const counts = () => Object.create(null);
		const metrics = {
			enabled: false,
			counts: counts(),
			localStorageKeys: Object.create(null),
			longTasks: [],
			frameGaps: [],
			mutationToFrameMs: [],
			counterToFrameMs: [],
			pullDispatchMs: [],
			observerCallbackMs: [],
			composerKeydownMs: [],
			composerKeydownStarted: 0,
			composerKeydownCompleted: 0,
			composerTrustedKeydowns: 0,
			composerEnterPrevented: null,
			repositoryWrites: [],
			scrollEvents: 0,
			overlayVisibleFrames: 0,
			startedAt: 0,
			lastFrameAt: 0,
			frameHandle: 0,
			longTaskSupported: Array.isArray(PerformanceObserver?.supportedEntryTypes)
				? PerformanceObserver.supportedEntryTypes.includes('longtask')
				: false,
			hit(name) {
				if (!this.enabled) return;
				this.counts[name] = (this.counts[name] || 0) + 1;
			},
			reset() {
				this.enabled = true;
				this.counts = counts();
				this.localStorageKeys = Object.create(null);
				this.longTasks = [];
				this.frameGaps = [];
				this.mutationToFrameMs = [];
				this.counterToFrameMs = [];
				this.pullDispatchMs = [];
				this.observerCallbackMs = [];
				this.composerKeydownMs = [];
				this.composerKeydownStarted = 0;
				this.composerKeydownCompleted = 0;
				this.composerTrustedKeydowns = 0;
				this.composerEnterPrevented = null;
				this.repositoryWrites = [];
				this.scrollEvents = 0;
				this.overlayVisibleFrames = 0;
				this.startedAt = performance.now();
				this.lastFrameAt = 0;
				if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
				const sampleFrame = now => {
					if (!this.enabled) return;
					if (this.lastFrameAt) this.frameGaps.push(now - this.lastFrameAt);
					this.lastFrameAt = now;
					const overlayVisible = Array.from(document.querySelectorAll('.pena-native-original-load-guard,.pena-native-load-guard'))
						.some(node => {
							const style = getComputedStyle(node);
							const rect = node.getBoundingClientRect();
							return !node.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
								Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
						});
					if (overlayVisible) this.overlayVisibleFrames += 1;
					this.frameHandle = requestAnimationFrame(sampleFrame);
				};
				this.frameHandle = requestAnimationFrame(sampleFrame);
			},
			snapshot() {
				return {
					counts: { ...this.counts },
					localStorageKeys: { ...this.localStorageKeys },
					longTasks: this.longTasks.slice(),
					frameGaps: this.frameGaps.slice(),
					mutationToFrameMs: this.mutationToFrameMs.slice(),
					counterToFrameMs: this.counterToFrameMs.slice(),
					pullDispatchMs: this.pullDispatchMs.slice(),
					observerCallbackMs: this.observerCallbackMs.slice(),
					composerKeydownMs: this.composerKeydownMs.slice(),
					composerKeydownStarted: this.composerKeydownStarted,
					composerKeydownCompleted: this.composerKeydownCompleted,
					composerTrustedKeydowns: this.composerTrustedKeydowns,
					composerEnterPrevented: this.composerEnterPrevented,
					repositoryWrites: this.repositoryWrites.map(write => ({
						method: write.method,
						recordIds: write.recordIds.slice(),
						deletedIds: write.deletedIds.slice()
					})),
					scrollEvents: this.scrollEvents,
					overlayVisibleFrames: this.overlayVisibleFrames,
					longTaskSupported: this.longTaskSupported,
					elapsed: performance.now() - this.startedAt
				};
			},
			stop() {
				const result = this.snapshot();
				this.enabled = false;
				if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
				this.frameHandle = 0;
				return result;
			}
		};
		window.__PENA_TEST_PERF_METRICS__ = metrics;
		let composerKeyStartedAt = 0;
		window.addEventListener('keydown', event => {
			if (event.target?.id !== 'pena-test-bitrix-composer' || !metrics.enabled) return;
			composerKeyStartedAt = performance.now();
			metrics.composerKeydownStarted += 1;
			if (event.isTrusted) metrics.composerTrustedKeydowns += 1;
		}, true);
		window.addEventListener('keydown', event => {
			if (event.target?.id !== 'pena-test-bitrix-composer' || !metrics.enabled || !composerKeyStartedAt) return;
			metrics.composerKeydownCompleted += 1;
			metrics.composerKeydownMs.push(performance.now() - composerKeyStartedAt);
			if (event.key === 'Enter') metrics.composerEnterPrevented = event.defaultPrevented;
			composerKeyStartedAt = 0;
		}, false);

		const observerLabel = target => {
			if (target?.matches?.('.bx-im-list-container-recent__elements,.bx-im-list-container-task__elements')) return 'sourceMutationObserver';
			if (target === document.body) return 'bodyMutationObserver';
			if (target === document.documentElement) return 'documentMutationObserver';
			return 'otherMutationObserver';
		};
		window.MutationObserver = class InstrumentedMutationObserver {
			constructor(callback) {
				this.labels = new Set();
				this.native = new NativeMutationObserver(records => {
					const startedAt = performance.now();
					if (metrics.enabled) this.labels.forEach(label => metrics.hit(label));
					try {
						return callback(records, this);
					} finally {
						if (metrics.enabled) metrics.observerCallbackMs.push(performance.now() - startedAt);
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

		Storage.prototype.setItem = function instrumentedSetItem(key, value) {
			if (metrics.enabled && this === window.localStorage) {
				metrics.hit('localStorageSet');
				const normalized = String(key || '');
				metrics.localStorageKeys[normalized] = (metrics.localStorageKeys[normalized] || 0) + 1;
			}
			return nativeStorageSetItem.call(this, key, value);
		};
		Storage.prototype.removeItem = function instrumentedRemoveItem(key) {
			if (metrics.enabled && this === window.localStorage) {
				metrics.hit('localStorageRemove');
				const normalized = String(key || '');
				metrics.localStorageKeys[normalized] = (metrics.localStorageKeys[normalized] || 0) + 1;
			}
			return nativeStorageRemoveItem.call(this, key);
		};

		let repositoryValue;
		Object.defineProperty(window, '__PENA_DIALOG_REPOSITORY__', {
			configurable: true,
			get: () => repositoryValue,
			set(value) {
				if (!value || typeof value !== 'object') {
					repositoryValue = value;
					return;
				}
				const wrapped = { ...value };
				for (const name of ['get', 'commit', 'patch', 'acquire']) {
					if (typeof value[name] !== 'function') continue;
					wrapped[name] = (...args) => {
						metrics.hit(`repository.${name}`);
						if (metrics.enabled && (name === 'commit' || name === 'patch')) {
							metrics.repositoryWrites.push({
								method: name,
								recordIds: Array.isArray(args[1]) ? args[1].map(record => String(record?.id || '')) : [],
								deletedIds: Array.isArray(args[2]) ? args[2].map(String) : []
							});
						}
						return value[name](...args);
					};
				}
				repositoryValue = Object.freeze(wrapped);
			}
		});

		document.addEventListener('scroll', event => {
			if (!metrics.enabled) return;
			if (event.target?.matches?.('.bx-im-list-container-recent__scroll-container,.bx-im-list-container-task__scroll-container')) {
				metrics.scrollEvents += 1;
			}
		}, true);

		if (metrics.longTaskSupported) {
			new PerformanceObserver(list => {
				if (!metrics.enabled) return;
				for (const entry of list.getEntries()) {
					if (entry.startTime < metrics.startedAt) continue;
					metrics.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
				}
			}).observe({ entryTypes: ['longtask'] });
		}
	});

	const url = new URL('/tests/native-consistency-harness.html', server.baseUrl);
	url.search = new URLSearchParams({
		mode: 'chats',
		nativeCatalog: '1',
		nativeFirst: '1',
		passThrough: '1',
		repositoryCache: '1',
		repositoryFullProof: '1',
		repositoryProofCount: String(catalogSize),
		catalogRows: String(catalogSize - 3),
		lazy: '1',
		lazyChunk: String(catalogSize - 3),
		startupBudget: '12000',
		headTtl: '60000',
		taskTtl: '900000',
		auditTtl: '86400000'
	});
	await page.goto(url.href);
	await page.waitForFunction(version => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return window.__PENA_RECENT_SYNC__?.version === version &&
			window.__PENA_RECENT_SYNC__?.nativeUsable === true &&
			!status.originalActive && !status.apiActive && !status.modeLoadPending &&
			!status.reconcile?.active;
	}, expectedVersion, { timeout: 20000 });

	// Install a stable Bitrix-like preview and delivery-status subtree before the mark.
	// Its setup mutations and the initial repository flush are deliberately excluded.
	await page.evaluate(() => {
		const row = document.querySelector('.recent-host [data-id="chat5"]');
		const content = row?.querySelector('.bx-im-list-recent-item__container') || row;
		if (!row || !content) throw new Error('Message performance row is missing');
		let preview = row.querySelector('.bx-im-list-recent-item__message_text');
		if (!preview) {
			preview = document.createElement('span');
			preview.className = 'bx-im-list-recent-item__message_text';
			content.appendChild(preview);
		}
		preview.textContent = 'Готово к отправке';
		let delivery = row.querySelector('.bx-im-list-recent-item__message_status');
		if (!delivery) {
			delivery = document.createElement('span');
			delivery.className = 'bx-im-list-recent-item__message_status';
			content.appendChild(delivery);
		}
		delivery.setAttribute('aria-label', 'Доставлено');
		delivery.replaceChildren(Object.assign(document.createElement('i'), { className: 'test-delivery-icon' }));
		const composer = document.createElement('div');
		composer.id = 'pena-test-bitrix-composer';
		composer.className = 'bx-im-textarea__content';
		composer.contentEditable = 'true';
		composer.setAttribute('role', 'textbox');
		composer.setAttribute('aria-label', 'Введите сообщение');
		composer.style.cssText = 'position:fixed;left:12px;bottom:12px;width:240px;min-height:32px;z-index:1';
		document.body.appendChild(composer);
	});
	await page.waitForTimeout(2300);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return !status?.originalActive && !status?.apiActive && !status?.modeLoadPending && !status?.reconcile?.active;
	});

	const before = await page.evaluate(() => {
		const status = window.__PENA_NATIVE_PREFETCH__.status();
		const viewport = document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container');
		return {
			restCalls: window.nativeRestCalls.length,
			batchCalls: window.nativeBatchCalls,
			revision: Number(status.materializationRevisions?.chats || 0),
			passCount: Number(status.modeStates?.chats?.materialization?.nativePassCount || 0),
			reconcileCount: Number(status.reconcile?.count || 0),
			scrollTop: Number(viewport?.scrollTop || 0)
		};
	});

	await page.evaluate(() => window.__PENA_TEST_PERF_METRICS__.reset());
	const composer = page.locator('#pena-test-bitrix-composer');
	await composer.click();
	await composer.pressSequentially('message');
	await composer.press('Enter');

	await page.evaluate(async ({ messageCount }) => {
		const metrics = window.__PENA_TEST_PERF_METRICS__;
		const row = document.querySelector('.recent-host [data-id="chat5"]');
		const preview = row?.querySelector('.bx-im-list-recent-item__message_text');
		const delivery = row?.querySelector('.bx-im-list-recent-item__message_status');
		if (!row || !preview || !delivery) throw new Error('Message performance fixture is incomplete');
		if (!preview.firstChild) preview.append(document.createTextNode(''));
		for (let index = 0; index < messageCount; index += 1) {
			const pullStartedAt = performance.now();
			window.dispatchNativeTaskMessage?.('chat5', '7');
			metrics.pullDispatchMs.push(performance.now() - pullStartedAt);
			const startedAt = performance.now();
			preview.firstChild.data = `Исходящее сообщение ${index + 1}`;
			delivery.setAttribute('aria-label', index % 2 ? 'Доставлено' : 'Отправляется');
			delivery.classList.toggle('--delivered', index % 2 === 1);
			const icon = document.createElement('i');
			icon.className = index % 2 ? 'test-delivery-icon --double' : 'test-delivery-icon --single';
			delivery.replaceChildren(icon);
			await new Promise(resolve => requestAnimationFrame(() => {
				metrics.mutationToFrameMs.push(performance.now() - startedAt);
				resolve();
			}));
		}
		// An incoming unread update is a separate Bitrix event from the outgoing
		// preview/delivery burst, but it must use the same lightweight observer path.
		const counterStartedAt = performance.now();
		window.setNativeDomCounter?.('chat225', messageCount);
		await new Promise(resolve => requestAnimationFrame(() => {
			metrics.counterToFrameMs.push(performance.now() - counterStartedAt);
			resolve();
		}));
	}, { messageCount });

	// Cache writes use requestIdleCallback with a production 1800 ms timeout.
	await page.waitForTimeout(2300);
	const after = await page.evaluate(restStart => {
		const status = window.__PENA_NATIVE_PREFETCH__.status();
		const viewport = document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container');
		const repository = window.getNativeRepositorySnapshot?.();
		const counterRecord = repository?.records?.find(record => record.id === 'chat225');
		return {
			metrics: window.__PENA_TEST_PERF_METRICS__.stop(),
			restCalls: window.nativeRestCalls.slice(restStart),
			batchCalls: window.nativeBatchCalls,
			revision: Number(status.materializationRevisions?.chats || 0),
			passCount: Number(status.modeStates?.chats?.materialization?.nativePassCount || 0),
			reconcileCount: Number(status.reconcile?.count || 0),
			scrollTop: Number(viewport?.scrollTop || 0),
			overlays: document.querySelectorAll('.pena-native-original-load-guard,.pena-native-load-guard').length,
			counterText: document.querySelector('.recent-host [data-id="chat225"] .bx-im-list-recent-item__counter_number')?.textContent || '',
			repositoryUnreadCount: Number(counterRecord?.unread?.count ?? counterRecord?.state?.unreadCount ?? -1)
		};
	}, before.restCalls);

	const countsAfter = after.metrics.counts;
	const diagnostic = JSON.stringify({
		counts: countsAfter,
		localStorageKeys: after.metrics.localStorageKeys,
		restCalls: after.restCalls,
		batchCalls: [before.batchCalls, after.batchCalls],
		materializationRevision: [before.revision, after.revision],
		nativePassCount: [before.passCount, after.passCount],
		reconcileCount: [before.reconcileCount, after.reconcileCount],
		scrollTop: [before.scrollTop, after.scrollTop],
		overlays: after.overlays,
		longTasks: after.metrics.longTasks,
		repositoryWrites: after.metrics.repositoryWrites,
		counterText: after.counterText,
		repositoryUnreadCount: after.repositoryUnreadCount,
		composerKeydownP95: percentile(after.metrics.composerKeydownMs, 0.95),
		mutationToFrameP95: percentile(after.metrics.mutationToFrameMs, 0.95),
		mutationToFrameMax: Math.max(0, ...after.metrics.mutationToFrameMs),
		counterToFrameMax: Math.max(0, ...after.metrics.counterToFrameMs),
		frameGapMax: Math.max(0, ...after.metrics.frameGaps),
		observerCallbackMax: Math.max(0, ...after.metrics.observerCallbackMs)
	});
	assert.equal(after.revision, before.revision, `Message mutations changed materialization revision: ${diagnostic}`);
	assert.equal(after.passCount, before.passCount, `Message mutations started a native materialization pass: ${diagnostic}`);
	assert.equal(after.reconcileCount, before.reconcileCount, `Message mutations started lifecycle reconcile: ${diagnostic}`);
	assert.equal(countsAfter.fullNativeMaterialization || 0, 0, `Message mutations started full native traversal: ${diagnostic}`);
	assert.equal(countsAfter.tailProbe || 0, 0, `Message mutations started a tail probe: ${diagnostic}`);
	assert.equal(countsAfter.passThroughRefreshSchedule || 0, 0, `Message mutations scheduled a broad pass-through refresh: ${diagnostic}`);
	assert.equal(countsAfter.passThroughRefreshFlush || 0, 0, `Message mutations flushed a broad pass-through refresh: ${diagnostic}`);
	assert.equal(countsAfter.visibleWindowRefresh || 0, 0, `Message preview/status mutation entered full visible-window refresh: ${diagnostic}`);
	assert.equal(countsAfter.catalogCommit || 0, 0, `Message preview/status mutation committed the full in-memory catalog: ${diagnostic}`);
	assert.equal(countsAfter['repository.commit'] || 0, 0, `Message burst caused a full repository commit: ${diagnostic}`);
	assert.equal(countsAfter['repository.patch'] || 0, 1, `Counter update was not persisted as one repository patch: ${diagnostic}`);
	assert.deepEqual(after.metrics.repositoryWrites, [{ method: 'patch', recordIds: ['chat225'], deletedIds: [] }],
		`Counter update persisted more than its one dirty record: ${diagnostic}`);
	assert.equal(after.counterText, String(messageCount), `Bitrix counter fixture did not reach its final value: ${diagnostic}`);
	assert.equal(after.repositoryUnreadCount, messageCount, `Repository missed the targeted counter update: ${diagnostic}`);
	assert.equal(countsAfter.cacheWrite || 0, 1, `Counter update was not coalesced into one cache write: ${diagnostic}`);
	assert.equal(countsAfter.applyFilters || 0, 0, `Message burst reapplied all filters: ${diagnostic}`);
	assert.equal(countsAfter.toolbarRebuild || 0, 0, `Message burst structurally rebuilt the toolbar: ${diagnostic}`);
	assert.ok((countsAfter.toolbarRender || 0) <= 2, `Message burst repeatedly rendered the toolbar: ${diagnostic}`);
	assert.equal(countsAfter.panelRender || 0, 0, `Message burst rebuilt the hidden control panel: ${diagnostic}`);
	assert.ok((countsAfter.nativeViewApply || 0) <= 2, `Message burst repeatedly reapplied the native view: ${diagnostic}`);
	assert.equal(countsAfter.statusRefreshSchedule || 0, 1, `Counter update did not use one targeted status refresh: ${diagnostic}`);
	assert.equal(countsAfter.statusRefreshFlush || 0, 1, `Counter update did not flush one targeted status refresh: ${diagnostic}`);
	assert.ok((countsAfter.presentationRefreshSchedule || 0) <= messageCount, `Message burst scheduled redundant presentation refreshes: ${diagnostic}`);
	assert.ok((countsAfter.presentationRefreshFlush || 0) <= 1, `Message burst did not coalesce presentation refreshes: ${diagnostic}`);
	assert.equal(after.restCalls.length, 0, `Message burst caused Bitrix REST calls: ${diagnostic}`);
	assert.equal(after.batchCalls, before.batchCalls, `Message burst caused Bitrix batch calls: ${diagnostic}`);
	assert.equal(after.metrics.scrollEvents, 0, `Message burst moved the native viewport: ${diagnostic}`);
	assert.ok(Math.abs(after.scrollTop - before.scrollTop) < 0.5, `Message burst changed scrollTop: ${diagnostic}`);
	assert.equal(after.metrics.overlayVisibleFrames, 0, `Message burst exposed a loading overlay: ${diagnostic}`);
	assert.equal(after.overlays, 0, `Message burst left a loading overlay in DOM: ${diagnostic}`);

	const expectedSourceCallbacks = messageCount + 1;
	assert.equal(countsAfter.sourceMutationObserver || 0, expectedSourceCallbacks,
		`Message burst did not stay at one source observer callback per logical DOM event: ${diagnostic}`);
	assert.equal(after.metrics.longTaskSupported, true, 'Chromium long-task observer is unavailable');
	assert.equal(after.metrics.longTasks.length, 0, `Message burst produced a long task: ${diagnostic}`);
	assert.equal(countsAfter.localStorageSet || 0, 0, `Message burst wrote unrelated localStorage state: ${diagnostic}`);
	assert.equal(countsAfter.localStorageRemove || 0, 0, `Ordinary outgoing messages removed localStorage state: ${diagnostic}`);
	assert.deepEqual(after.metrics.localStorageKeys, {}, `Message burst touched localStorage keys: ${diagnostic}`);
	assert.equal(after.metrics.composerKeydownStarted, 8, `Trusted composer key sequence was not captured: ${diagnostic}`);
	assert.equal(after.metrics.composerKeydownCompleted, 8, `Extension interrupted a composer key event: ${diagnostic}`);
	assert.equal(after.metrics.composerTrustedKeydowns, 8, `Composer test did not use trusted keyboard events: ${diagnostic}`);
	assert.equal(after.metrics.composerEnterPrevented, false, `Extension prevented the Bitrix composer Enter key: ${diagnostic}`);
	assert.ok(percentile(after.metrics.composerKeydownMs, 0.95) <= 8,
		`Extension capture handlers delayed composer keydown above 8 ms p95: ${diagnostic}`);
	assert.equal(after.metrics.pullDispatchMs.length, messageCount, `Outgoing Pull sample count changed: ${diagnostic}`);
	assert.ok(
		percentile(after.metrics.pullDispatchMs, 0.95) <= 8,
		`Outgoing Pull handler p95 exceeded 8 ms: ${diagnostic}`
	);
	assert.equal(after.metrics.mutationToFrameMs.length, messageCount, `Outgoing frame sample count changed: ${diagnostic}`);
	assert.ok(
		percentile(after.metrics.mutationToFrameMs, 0.95) <= 34,
		`Message mutation-to-frame p95 exceeded 34 ms: ${diagnostic}`
	);
	assert.ok(
		Math.max(0, ...after.metrics.mutationToFrameMs) <= 50,
		`Message mutation blocked the next frame for more than 50 ms: ${diagnostic}`
	);
	assert.equal(after.metrics.counterToFrameMs.length, 1, `Counter frame sample count changed: ${diagnostic}`);
	assert.ok(after.metrics.counterToFrameMs[0] <= 34, `Counter mutation-to-frame exceeded 34 ms: ${diagnostic}`);
	assert.ok(
		Math.max(0, ...after.metrics.frameGaps) <= 50,
		`Message processing created a frame gap above 50 ms: ${diagnostic}`
	);
	assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`);

	console.log(
		`PASS native message performance: ${messageCount} messages, ` +
		`${countsAfter.sourceMutationObserver || 0} source observer callbacks, ` +
		`p95 ${percentile(after.metrics.mutationToFrameMs, 0.95).toFixed(1)} ms`
	);
} finally {
	await browser.close();
	await server.close();
}

import assert from 'node:assert/strict';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((request, response) => {
	const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
	const path = normalize(join(root, pathname));
	if (!path.startsWith(root)) return response.writeHead(403).end();
	const stream = createReadStream(path);
	stream.on('error', () => response.writeHead(404).end());
	response.writeHead(200, { 'content-type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8` });
	stream.pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const onlyScenario = String(process.env.PENA_LOADING_RACE_SCENARIO || '').trim().toLowerCase();

const baseQuery = new URLSearchParams({
	mode: 'chats',
	nativeCatalog: '1',
	nativeFirst: '1',
	passThrough: '1',
	lazy: '1',
	catalogRows: '24',
	lazyChunk: '50',
	lazyDelay: '0',
	startupBudget: '10000',
	eager: '1',
	expectedAudit: '1',
	taskAudit: '1'
});

const statusSnapshot = page => page.evaluate(() => ({
	status: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
	sync: window.__PENA_RECENT_SYNC__ || null,
	meta225: window.__PENA_NATIVE_PREFETCH__?.inspectMeta?.('chat225') || null,
	calls: (window.nativeRestCalls || []).map(call => ({
		method: call.method,
		userId: String(call.userId || ''),
		offset: call.offset,
		start: call.start
	}))
}));

const waitForSettledMode = async (page, mode = 'chats', timeout = 30000) => {
	try {
		await page.waitForFunction(targetMode => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const state = status?.modeStates?.[targetMode];
			return status?.loadedModes?.includes(targetMode) &&
				state?.materialization?.state === 'ready' &&
				status.originalActive === false && !status.modeLoadPending;
		}, mode, { timeout });
	} catch (error) {
		throw new Error(`${mode} did not settle: ${JSON.stringify(await statusSnapshot(page))}; ${error.message}`);
	}
};

const installRaceHooks = async page => {
	await page.addInitScript(() => {
		window.__PENA_TEST_DIALOG_META_INSPECT__ = true;
		const retryBase = Math.max(50, Number(new URLSearchParams(location.search).get('raceRetryMs')) || 250);
		window.__PENA_TEST_RECOVERY_RETRY_MS__ = [retryBase, retryBase * 2, retryBase * 3];
		window.__raceUiSamples = [];
		window.__raceUnhandledErrors = [];
		window.addEventListener('error', event => {
			window.__raceUnhandledErrors.push(`error:${String(event?.message || event?.error || '')}`);
		});
		window.addEventListener('unhandledrejection', event => {
			window.__raceUnhandledErrors.push(`unhandledrejection:${String(event?.reason?.message || event?.reason || '')}`);
		});
		const sampleUi = () => {
			const sync = window.__PENA_RECENT_SYNC__ || {};
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.() || {};
			const taskHost = document.querySelector?.('.task-host');
			const activeMode = taskHost && !taskHost.hidden ? 'tasks' : 'chats';
			const chip = document.querySelector?.(`${activeMode === 'tasks' ? '.task-host' : '.recent-host'} .pena-native-sync-chip`);
			const rect = chip?.getBoundingClientRect?.();
			const painted = !!chip && !chip.hidden && getComputedStyle(chip).display !== 'none' &&
				Number(rect?.width || 0) > 0 && Number(rect?.height || 0) > 0;
			window.__raceUiSamples.push({
				at: performance.now(),
				phase: String(sync.phase || ''),
				ready: sync.ready === true,
				materializationReady: sync.materializationReady === true,
				metadataPending: sync.metadataPending === true,
				attemptState: String(sync.attemptState || ''),
				error: String(sync.error || sync.gateError || ''),
				recoveryActionRequired: sync.recoveryActionRequired === true,
				chipPainted: painted,
				chipText: painted ? String(chip.textContent || '') : '',
				chipError: painted && chip.classList.contains('--error'),
				activeMode,
				physicalReady: status?.modeStates?.chats?.materialization?.state === 'ready',
				chatAttemptState: String(status?.modeStates?.chats?.attempt?.state || ''),
				chatAttemptReason: String(status?.modeStates?.chats?.attempt?.reason || ''),
				chatAttemptStartedAt: Number(status?.modeStates?.chats?.attempt?.startedAt || 0),
				chatMaterializationRevision: Number(status?.materializationRevisions?.chats || 0),
				reconcileCount: Number(status?.reconcile?.count || 0),
				reconcileReason: String(status?.reconcile?.lastReason || '')
			});
			if (window.__raceUiSamples.length > 4000) window.__raceUiSamples.splice(0, 1000);
			window.__raceUiSampleFrame = requestAnimationFrame(sampleUi);
		};
		window.__raceUiSampleFrame = requestAnimationFrame(sampleUi);

		let bxValue;
		Object.defineProperty(window, 'BX', {
			configurable: true,
			get: () => bxValue,
			set(value) {
				bxValue = value;
				const rest = value?.rest;
				if (!rest?.callMethod || rest.callMethod.__penaRaceWrapped) return;
				const original = rest.callMethod;
				let failedTaskRequest = false;
				let hungTaskRequest = false;
				const wrapped = function (method, params, callback) {
					const requestUser = String(window.currentBitrixUserId || '');
					const search = new URLSearchParams(location.search);
					const shouldFail = method === 'tasks.task.list' && search.get('raceFailFirstTask') === '1' && !failedTaskRequest;
					const shouldHang = method === 'tasks.task.list' && search.get('raceHangFirstTask') === '1' && !hungTaskRequest;
					if (shouldFail) failedTaskRequest = true;
					if (shouldHang) {
						hungTaskRequest = true;
						window.__raceHungTaskAt = performance.now();
					}
					return original.call(this, method, params, result => {
						if (shouldHang) return;
						if (shouldFail) {
							callback({
								error: () => 'TEMPORARY_ERROR',
								error_description: () => 'first task-index request failed'
							});
							return;
						}

						const deliver = () => {
							const stripRecentClassification = method === 'im.recent.list' && search.get('raceUnclassified') === '1';
							const injectTask225 = method === 'tasks.task.list' && Number(params?.start || 0) === 0 && (
								window.__raceInjectTask225 === true ||
								(search.get('raceOldTask225') === '1' && requestUser === '7')
							);
							if (!injectTask225 && !stripRecentClassification) {
								callback(result);
								return;
							}
							const data = typeof result?.data === 'function' ? result.data() : result;
							const payload = data?.result || data || {};
							const tasks = Array.isArray(payload.tasks) ? payload.tasks.slice() : null;
							if (injectTask225 && !tasks.some(task => String(task?.ID ?? task?.id ?? '') === '225')) {
								tasks.unshift({
									ID: '225', TITLE: requestUser === '7' ? 'Old user task 225' : 'Fresh task 225',
									CHAT_ID: '225', ALLOW_TIME_TRACKING: 'Y', ACTIVITY_DATE: new Date().toISOString()
								});
							}
							const items = stripRecentClassification && Array.isArray(payload.items)
								? payload.items.map(item => {
									const next = { ...item };
									delete next.type;
									delete next.entity_type;
									delete next.entityType;
									delete next.entity_link;
									delete next.entityLink;
									if (next.chat) {
										next.chat = { ...next.chat };
										delete next.chat.type;
										delete next.chat.entity_type;
										delete next.chat.entityType;
									}
									return next;
								})
								: null;
							const nextPayload = {
								...payload,
								...(tasks ? { tasks } : {}),
								...(items ? { items } : {})
							};
							const nextData = data?.result ? { ...data, result: nextPayload } : nextPayload;
							callback({
								error: () => typeof result?.error === 'function' ? result.error() : null,
								error_description: () => typeof result?.error_description === 'function' ? result.error_description() : '',
								data: () => nextData,
								total: () => {
									const total = typeof result?.total === 'function' ? Number(result.total()) : Number(result?.total);
									return Number.isFinite(total) ? total + (injectTask225 ? 1 : 0) : (tasks?.length || items?.length || 0);
								},
								next: () => typeof result?.next === 'function' ? result.next() : result?.next
							});
						};
						const oldDelay = Math.max(0, Number(search.get('raceOldDelay')) || 0);
						if (oldDelay > 0 && requestUser === '7' && (method === 'tasks.task.list' || method === 'im.recent.list')) {
							setTimeout(deliver, oldDelay);
						} else {
							deliver();
						}
					});
				};
				wrapped.__penaRaceWrapped = true;
				rest.callMethod = wrapped;
			}
		});
	});
};

const withPage = async (name, query, run) => {
	if (onlyScenario && !name.toLowerCase().includes(onlyScenario)) return;
	const context = await browser.newContext({ viewport: { width: 420, height: 760 } });
	const page = await context.newPage();
	const pageErrors = [];
	page.on('pageerror', error => pageErrors.push(String(error?.message || error)));
	await installRaceHooks(page);
	const params = new URLSearchParams(baseQuery);
	Object.entries(query || {}).forEach(([key, value]) => params.set(key, String(value)));
	try {
		await page.goto(`${base}/tests/native-consistency-harness.html?${params}`);
		await run(page);
		const falseUiFrames = await page.evaluate(() => (window.__raceUiSamples || []).filter(sample =>
			sample.error || sample.recoveryActionRequired || sample.chipError || /ошибка|повторить/i.test(sample.chipText)
		));
		assert.deepEqual(falseUiFrames, [], `${name}: false error frame escaped before or during the scenario`);
		assert.deepEqual(pageErrors, [], `${name}: uncaught browser errors`);
		assert.deepEqual(await page.evaluate(() => window.__raceUnhandledErrors || []), [],
			`${name}: window error or unhandled rejection`);
		console.log(`PASS native loading race: ${name}`);
	} catch (error) {
		const artifacts = join(root, 'tests', 'artifacts');
		mkdirSync(artifacts, { recursive: true });
		const snapshot = await statusSnapshot(page).catch(() => null);
		const rest = await page.evaluate(() => window.__PENA_REST_DIAGNOSTICS__?.snapshot()).catch(() => null);
		writeFileSync(join(artifacts, 'loading-race-failure.json'), JSON.stringify({ name, error: error.message, snapshot, rest, pageErrors }, null, 2));
		throw new Error(`${name}: ${error.message}`, { cause: error });
	} finally {
		await context.close();
	}
};

try {
	await withPage('forced refresh renews the task index and classification', {
		taskRecentGeneric: 1
	}, async page => {
		await waitForSettledMode(page);
		const before = await statusSnapshot(page);
		const taskCallsBefore = before.calls.filter(call => call.method === 'tasks.task.list').length;
		assert.equal(before.meta225?.isTask, false, `Baseline dialog classification is not chat: ${JSON.stringify(before)}`);

		await page.evaluate(() => { window.__raceInjectTask225 = true; });
		await page.locator('.pena-native-command-btn', { hasText: 'Фильтры' }).click();
		await page.locator('.pena-native-sync-refresh').click();
		await page.waitForFunction(({ previousCalls, previousFetchedAt }) => {
			const calls = (window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length;
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const meta = window.__PENA_NATIVE_PREFETCH__?.inspectMeta?.('chat225');
			return calls > previousCalls && meta?.isTask === true &&
				Number(status?.taskCatalogFetchedAt || 0) > Number(previousFetchedAt || 0);
		}, {
			previousCalls: taskCallsBefore,
			previousFetchedAt: before.status?.taskCatalogFetchedAt || 0
		}, { timeout: 15000 });

		const after = await statusSnapshot(page);
		assert.ok(after.calls.filter(call => call.method === 'tasks.task.list').length > taskCallsBefore,
			`Force did not issue a fresh task-index request: ${JSON.stringify({ before, after })}`);
		assert.equal(after.meta225?.taskId, '225', `Forced classification did not publish its task ID: ${JSON.stringify(after)}`);
	});

	await withPage('row-local busy state never invalidates a complete native feed', {
		busyRowDescendant: 1,
		catalogRows: 40,
		initialTop: 20
	}, async page => {
		await page.evaluate(() => {
			window.__raceFalseErrorSamples = [];
			const sample = () => {
				const sync = window.__PENA_RECENT_SYNC__ || {};
				const chip = document.querySelector('.recent-host .pena-native-sync-chip');
				const rect = chip?.getBoundingClientRect?.();
				const painted = !!chip && !chip.hidden && getComputedStyle(chip).display !== 'none' &&
					Number(rect?.width || 0) > 0 && Number(rect?.height || 0) > 0;
				window.__raceFalseErrorSamples.push({
					error: String(sync.error || sync.gateError || ''),
					recoveryActionRequired: !!sync.recoveryActionRequired,
					chipText: painted ? String(chip.textContent || '') : '',
					chipError: painted && chip.classList.contains('--error'),
					contradictoryClasses: painted && chip.classList.contains('--loading') && chip.classList.contains('--error')
				});
				window.__raceFalseErrorFrame = requestAnimationFrame(sample);
			};
			window.__raceFalseErrorFrame = requestAnimationFrame(sample);
		});
		await waitForSettledMode(page, 'chats', 30000);
		const result = await page.evaluate(() => {
			cancelAnimationFrame(window.__raceFalseErrorFrame);
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const sync = window.__PENA_RECENT_SYNC__ || {};
			const viewport = document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container');
			return {
				status,
				sync,
				ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements [data-id]'), row => row.dataset.id),
				busyDescendantPresent: !!document.querySelector('.recent-host .test-row-local-busy[aria-busy="true"]'),
				scrollTop: Number(viewport?.scrollTop) || 0,
				replacementRows: document.querySelectorAll('.recent-host .pena-native-managed-row').length,
				visibleOverlayCount: Array.from(document.querySelectorAll('.recent-host .pena-native-original-load-guard'))
					.filter(node => !node.hidden && getComputedStyle(node).display !== 'none').length,
				samples: window.__raceFalseErrorSamples || []
			};
		});
		const falseErrors = result.samples.filter(sample => sample.error || sample.recoveryActionRequired ||
			sample.chipError || sample.contradictoryClasses || /ошибка|повторить/i.test(sample.chipText));
		assert.deepEqual(falseErrors, [], `Row-local busy state produced a false error frame: ${JSON.stringify(falseErrors.slice(0, 5))}`);
		assert.equal(result.busyDescendantPresent, true, 'Busy descendant fixture disappeared before acceptance');
		assert.equal(result.ids.length, 43, `Not every native dialog remained materialized: ${JSON.stringify(result)}`);
		assert.equal(new Set(result.ids).size, 43, `Native dialog IDs are not unique: ${JSON.stringify(result.ids)}`);
		assert.equal(result.status?.modeCounts?.chats, 43, `Committed mode count is not exact: ${JSON.stringify(result)}`);
		assert.equal(result.sync.ready, true, `Native materialization did not publish ready=true: ${JSON.stringify(result.sync)}`);
		assert.equal(result.sync.error, '');
		assert.equal(result.sync.recoveryActionRequired, false);
		assert.equal(result.scrollTop, 20, `Native scroll anchor moved: ${JSON.stringify(result)}`);
		assert.equal(result.replacementRows, 0);
		assert.equal(result.visibleOverlayCount, 0);
	});

	await withPage('a real list loader waits automatically without a red retry state', {
		listLoaderMs: 60000,
		catalogRows: 24
	}, async page => {
		await page.evaluate(() => {
			window.__raceLoaderSamples = [];
			const sample = () => {
				const sync = window.__PENA_RECENT_SYNC__ || {};
				const chip = document.querySelector('.recent-host .pena-native-sync-chip');
				const rect = chip?.getBoundingClientRect?.();
				const painted = !!chip && !chip.hidden && getComputedStyle(chip).display !== 'none' &&
					Number(rect?.width || 0) > 0 && Number(rect?.height || 0) > 0;
				window.__raceLoaderSamples.push({
					error: String(sync.error || sync.gateError || ''),
					recoveryActionRequired: !!sync.recoveryActionRequired,
					chipText: painted ? String(chip.textContent || '') : '',
					chipError: painted && chip.classList.contains('--error')
				});
				window.__raceLoaderFrame = requestAnimationFrame(sample);
			};
			window.__raceLoaderFrame = requestAnimationFrame(sample);
		});
		await page.waitForFunction(() => window.__PENA_NATIVE_FAILURE_DEBUG__?.bitrixBusy === true, null, { timeout: 20000 });
		const waiting = await statusSnapshot(page);
		assert.equal(waiting.sync?.error, '', `Automatic loader wait exposed a hard error: ${JSON.stringify(waiting)}`);
		assert.equal(waiting.sync?.recoveryActionRequired, false, `Automatic loader wait exposed a manual action: ${JSON.stringify(waiting)}`);
		assert.equal(waiting.sync?.automaticRecoveryPending, true, `Automatic loader wait was not classified as background recovery: ${JSON.stringify(waiting)}`);
		const loaderRemovedAt = await page.evaluate(() => {
			document.querySelector('.recent-host .test-list-loader')?.remove();
			document.querySelector('.recent-host .bx-im-list-container-recent__elements')?.removeAttribute('data-loading');
			window.testListLoaderRemovedAt = Date.now();
			return window.testListLoaderRemovedAt;
		});
		await waitForSettledMode(page, 'chats', 30000);
		const result = await page.evaluate(() => {
			cancelAnimationFrame(window.__raceLoaderFrame);
			return {
				status: window.__PENA_NATIVE_PREFETCH__?.status?.(),
				sync: window.__PENA_RECENT_SYNC__ || {},
				samples: window.__raceLoaderSamples || []
			};
		});
		const falseErrors = result.samples.filter(sample => sample.error || sample.recoveryActionRequired ||
			sample.chipError || /ошибка|повторить/i.test(sample.chipText));
		assert.deepEqual(falseErrors, [], `Real loader produced a premature error action: ${JSON.stringify(falseErrors.slice(0, 5))}`);
		assert.ok(Number(result.status?.modeLoadedAt?.chats || 0) >= loaderRemovedAt,
			`Native materialization committed before the real loader disappeared: ${JSON.stringify(result)}`);
		assert.equal(result.sync.ready, true);
		assert.equal(result.sync.error, '');
		assert.equal(result.sync.recoveryActionRequired, false);
	});

	await withPage('inactive mode keeps one dormant retry and resumes once on return', {
		listLoaderMs: 60000,
		catalogRows: 24,
		raceRetryMs: 800
	}, async page => {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const attempt = status?.modeStates?.chats?.attempt;
			return attempt?.state === 'retry' && Number(attempt.retryAt || 0) > Date.now() && !status.originalActive;
		}, null, { timeout: 12000 });
		const beforeSwitch = await page.evaluate(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return {
				attempt: status?.modeStates?.chats?.attempt,
				reconcileCount: Number(status?.reconcile?.count || 0),
				materializationRevision: Number(status?.materializationRevisions?.chats || 0),
				sampleIndex: (window.__raceUiSamples || []).length
			};
		});
		await page.locator('#switch-mode').evaluate(button => button.click());
		await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.mode === 'tasks');
		await waitForSettledMode(page, 'tasks', 30000);
		const awayBaseline = await page.evaluate(baseline => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return {
				attempt: status?.modeStates?.chats?.attempt,
				reconcileCount: Number(status?.reconcile?.count || 0),
				materializationRevision: Number(status?.materializationRevisions?.chats || 0),
				lastAttemptStartedAt: Number(status?.modeStates?.chats?.attempt?.startedAt || 0),
				inactiveChatWork: (window.__raceUiSamples || []).slice(baseline.sampleIndex).filter(sample =>
					sample.activeMode === 'tasks' && ['loading', 'probing'].includes(sample.chatAttemptState)),
				inactiveRetryReconciles: (window.__raceUiSamples || []).slice(baseline.sampleIndex).filter(sample =>
					sample.activeMode === 'tasks' && /^retry:/.test(sample.reconcileReason))
			};
		}, beforeSwitch);
		assert.deepEqual(awayBaseline.attempt, beforeSwitch.attempt,
			`Switching away mutated the dormant Chats attempt: ${JSON.stringify({ beforeSwitch, awayBaseline })}`);
		assert.equal(awayBaseline.materializationRevision, beforeSwitch.materializationRevision,
			`Chats materialization changed while Task Chats became active: ${JSON.stringify({ beforeSwitch, awayBaseline })}`);
		assert.deepEqual(awayBaseline.inactiveChatWork, [],
			`Dormant Chats retry ran during the mode transition: ${JSON.stringify(awayBaseline.inactiveChatWork)}`);
		assert.deepEqual(awayBaseline.inactiveRetryReconciles, [],
			`A retry reconcile fired while Task Chats was active: ${JSON.stringify(awayBaseline.inactiveRetryReconciles)}`);
		await page.waitForTimeout(2700);
		const whileAway = await page.evaluate(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const chip = document.querySelector('.task-host .pena-native-sync-chip');
			return {
				attempt: status?.modeStates?.chats?.attempt,
				reconcileCount: Number(status?.reconcile?.count || 0),
				sync: window.__PENA_RECENT_SYNC__ || {},
				chipHidden: !chip || chip.hidden
			};
		});
		assert.deepEqual(whileAway.attempt, awayBaseline.attempt,
			`Inactive Chats retry timer kept mutating: ${JSON.stringify({ awayBaseline, whileAway })}`);
		assert.equal(whileAway.reconcileCount, awayBaseline.reconcileCount,
			`Inactive Chats launched background reconcile work: ${JSON.stringify({ awayBaseline, whileAway })}`);
		assert.equal(whileAway.sync.mode, 'tasks');
		assert.equal(whileAway.sync.error, '');
		assert.equal(whileAway.sync.recoveryActionRequired, false);
		assert.equal(whileAway.chipHidden, true, 'Inactive Chats retry leaked an action into Task Chats');

		await page.evaluate(() => {
			document.querySelector('.recent-host .test-list-loader')?.remove();
			document.querySelector('.recent-host .bx-im-list-container-recent__elements')?.removeAttribute('data-loading');
		});
		await page.locator('#switch-mode').evaluate(button => button.click());
		await waitForSettledMode(page, 'chats', 30000);
		const recovered = await statusSnapshot(page);
		assert.equal(recovered.sync?.mode, 'chats');
		assert.equal(recovered.sync?.ready, true);
		assert.equal(recovered.sync?.error, '');
		assert.equal(recovered.status?.modeStates?.chats?.attempt?.state, 'idle');
		const returnWork = await page.evaluate(baseline => {
			const startedIds = Array.from(new Set((window.__raceUiSamples || [])
				.filter(sample => sample.activeMode === 'chats' && sample.chatAttemptState === 'loading' &&
					Number(sample.chatAttemptStartedAt || 0) > Number(baseline.lastAttemptStartedAt || 0))
				.map(sample => Number(sample.chatAttemptStartedAt))));
			const started = startedIds.map(startedAt => {
				const sample = (window.__raceUiSamples || []).find(candidate =>
					Number(candidate.chatAttemptStartedAt || 0) === startedAt && candidate.chatAttemptState === 'loading');
				return { startedAt, reason: String(sample?.chatAttemptReason || '') };
			});
			return {
				started,
				finalRevision: Number(window.__PENA_NATIVE_PREFETCH__?.status?.().materializationRevisions?.chats || 0)
			};
		}, awayBaseline);
		assert.deepEqual(returnWork.started.map(item => item.reason), ['mode-switch', 'cold-confirmation'],
			`Returning to Chats did not run exactly the one required cold two-pass flow: ${JSON.stringify({ awayBaseline, returnWork })}`);
		assert.equal(returnWork.finalRevision, awayBaseline.materializationRevision + 2,
			`Cold recovery did not commit exactly its two sequential materializations: ${JSON.stringify({ awayBaseline, returnWork })}`);
	});

	await withPage('unclassified audit retries after the first task-index failure', {
		raceUnclassified: 1,
		raceFailFirstTask: 1
	}, async page => {
		await page.waitForFunction(() => {
			const retry = window.__PENA_NATIVE_PREFETCH__?.status?.().metadataRetryModes?.chats;
			const materialization = window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.materialization;
			return /audit-mode-unclassified/.test(String(retry?.reason || '')) && materialization?.state === 'ready';
		}, null, { timeout: 15000 });
		const retrySeen = await statusSnapshot(page);
		assert.match(String(retrySeen.status?.metadataRetryModes?.chats?.reason || ''), /audit-mode-unclassified/);
		assert.equal(retrySeen.sync?.phase, 'ready');
		assert.equal(retrySeen.sync?.ready, true, `Physical readiness was hidden by a metadata retry: ${JSON.stringify(retrySeen)}`);
		assert.equal(retrySeen.sync?.materializationReady, true);
		assert.equal(retrySeen.sync?.error, '');
		assert.equal(retrySeen.sync?.recoveryActionRequired, false);

		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return !status?.metadataRetryModes?.chats && status?.expectedCatalogs?.chats?.complete === true &&
				(window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length >= 2;
		}, null, { timeout: 20000 });
		const recovered = await statusSnapshot(page);
		assert.equal(recovered.status?.metadataRetryModes?.chats, undefined,
			`Recovered classification kept a stale retry: ${JSON.stringify(recovered)}`);
		assert.equal(recovered.status?.expectedCatalogs?.chats?.complete, true,
			`Retry did not publish a complete classified catalog: ${JSON.stringify(recovered)}`);
		const falseFrames = await page.evaluate(() => (window.__raceUiSamples || []).filter(sample =>
			sample.error || sample.recoveryActionRequired || sample.chipError || /ошибка|повторить/i.test(sample.chipText)
		));
		assert.deepEqual(falseFrames, [],
			`Metadata retry flashed a false error action: ${JSON.stringify(falseFrames.slice(0, 8))}`);
	});

	await withPage('native feed remains ready through a natural task-index timeout', {
		raceUnclassified: 1,
		raceHangFirstTask: 1,
		raceRetryMs: 1200
	}, async page => {
		try {
			await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.()
				.modeStates?.chats?.materialization?.state === 'ready', null, { timeout: 20000 });
		} catch (error) {
			throw new Error(`Physical feed did not become ready: ${JSON.stringify(await statusSnapshot(page))}; ${error.message}`);
		}
		await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.()
			.metadataRetryModes?.chats, null, { timeout: 18000 });
		const duringRetry = await statusSnapshot(page);
		assert.match(String(duringRetry.status?.metadataRetryModes?.chats?.reason || ''), /audit-mode-unclassified/,
			`Observed retry was not caused by the hung task-index audit: ${JSON.stringify(duringRetry)}`);
		assert.equal(duringRetry.sync?.phase, 'ready');
		assert.equal(duringRetry.sync?.ready, true,
			`Late metadata timeout hid a valid native feed: ${JSON.stringify(duringRetry)}`);
		assert.equal(duringRetry.sync?.materializationReady, true);
		assert.equal(duringRetry.sync?.metadataPending, true);
		assert.equal(duringRetry.sync?.attemptState, 'idle');
		assert.equal(duringRetry.sync?.error, '');
		assert.equal(duringRetry.sync?.recoveryActionRequired, false);
		const retryChipHidden = await page.locator('.recent-host .pena-native-sync-chip').evaluate(chip => chip.hidden);
		assert.equal(retryChipHidden, true, 'Background metadata timeout exposed a toolbar action');

		const ordering = await page.evaluate(() => {
			const samples = window.__raceUiSamples || [];
			return {
				hungAt: Number(window.__raceHungTaskAt || 0),
				physicalReadyAt: samples.find(sample => sample.physicalReady)?.at ?? null,
				metadataRetryAt: samples.find(sample => sample.metadataPending)?.at ?? null,
				falseFrames: samples.filter(sample => sample.error || sample.recoveryActionRequired ||
					sample.chipError || /ошибка|повторить/i.test(sample.chipText))
			};
		});
		assert.ok(Number.isFinite(ordering.physicalReadyAt) && Number.isFinite(ordering.metadataRetryAt) &&
			ordering.physicalReadyAt < ordering.metadataRetryAt,
			`Physical readiness did not precede the metadata timeout: ${JSON.stringify(ordering)}`);
		const timeoutInterval = Number(ordering.metadataRetryAt) - Number(ordering.hungAt);
		assert.ok(Number(ordering.hungAt) > 0 && timeoutInterval >= 11000 && timeoutInterval <= 20000,
			`Task-index retry did not follow the natural ~12 s timeout: ${JSON.stringify({ timeoutInterval, ordering })}`);
		assert.deepEqual(ordering.falseFrames, [],
			`Late metadata timeout flashed an error action: ${JSON.stringify(ordering.falseFrames.slice(0, 8))}`);

		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return !status?.metadataRetryModes?.chats && status?.expectedCatalogs?.chats?.complete === true &&
				(window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length >= 2;
		}, null, { timeout: 20000 });
		const final = await page.evaluate(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const sync = window.__PENA_RECENT_SYNC__ || {};
			return {
				status,
				sync,
				ids: Array.from(document.querySelectorAll(
					'.recent-host .bx-im-list-container-recent__elements [data-id]'
				), row => row.dataset.id)
			};
		});
		const expectedIds = ['chat225', 'chat5', 'chat77', ...Array.from({ length: 24 }, (_, index) => `chat${1000 + index}`)];
		assert.deepEqual(final.ids, expectedIds, `Final native order/set is not exact: ${JSON.stringify(final.ids)}`);
		assert.equal(final.status?.metadataRetryModes?.chats, undefined);
		assert.equal(final.status?.modeStates?.chats?.attempt?.state, 'idle');
		assert.equal(final.sync.ready, true);
		assert.equal(final.sync.error, '');
	});

	await withPage('source and user fence discards delayed old classification', {
		taskRecentGeneric: 1,
		raceOldTask225: 1,
		raceOldDelay: 900
	}, async page => {
		await page.waitForFunction(() => {
			const calls = window.nativeRestCalls || [];
			return calls.some(call => call.method === 'im.recent.list' && String(call.userId) === '7') &&
				calls.some(call => call.method === 'tasks.task.list' && String(call.userId) === '7');
		}, null, { timeout: 10000 });
		const fenceIndex = await page.evaluate(() => (window.nativeRestCalls || []).length);
		await page.evaluate(() => window.replaceNativeAuditSource('8'));

		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const calls = window.nativeRestCalls || [];
			return status?.modeStates?.chats?.materialization?.state === 'ready' &&
				status?.expectedCatalogs?.chats?.complete === true &&
				calls.some(call => call.method === 'im.recent.list' && String(call.userId) === '8') &&
				calls.some(call => call.method === 'tasks.task.list' && String(call.userId) === '8');
		}, null, { timeout: 30000 });
		const fresh = await statusSnapshot(page);
		const freshTaskFetchedAt = Number(fresh.status?.taskCatalogFetchedAt || 0);
		await page.waitForTimeout(1200);
		const afterOldResult = await statusSnapshot(page);
		const callsAfterFence = afterOldResult.calls.slice(fenceIndex)
			.filter(call => call.method === 'im.recent.list' || call.method === 'tasks.task.list');

		assert.ok(callsAfterFence.length > 0 && callsAfterFence.every(call => call.userId === '8'),
			`Old user leaked into the replacement audit: ${JSON.stringify(callsAfterFence)}`);
		assert.ok(Number(afterOldResult.status?.expectedAuditDiscards || 0) >= 1,
			`Detached audit was not discarded: ${JSON.stringify(afterOldResult)}`);
		assert.ok(Number(afterOldResult.status?.taskCatalogFetchedAt || 0) >= freshTaskFetchedAt,
			`Delayed task result rolled back taskCatalogFetchedAt: ${JSON.stringify({ fresh, afterOldResult })}`);
		assert.equal(afterOldResult.meta225?.isTask, false,
			`Delayed user-7 task classification overwrote user 8: ${JSON.stringify(afterOldResult)}`);
	});

	await withPage('replacement source is a cold generation with a fresh recent audit', {}, async page => {
		await waitForSettledMode(page);
		const before = await statusSnapshot(page);
		const beforeState = before.status?.modeStates?.chats;
		const recentCallsBefore = before.calls.filter(call => call.method === 'im.recent.list').length;
		await page.evaluate(() => window.replaceNativeAuditSource('7'));

		await page.waitForFunction(({ generation, revision, recentCalls }) => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const state = status?.modeStates?.chats;
			const calls = (window.nativeRestCalls || []).filter(call => call.method === 'im.recent.list').length;
			return state?.materialization?.state === 'ready' &&
				Number(state.materialization.sourceGeneration || 0) > Number(generation || 0) &&
				Number(status?.materializationRevisions?.chats || 0) > Number(revision || 0) &&
				Number(state.expectedCatalog?.sourceGeneration || 0) === Number(state.materialization.sourceGeneration || 0) &&
				calls > recentCalls;
		}, {
			generation: beforeState?.materialization?.sourceGeneration || 0,
			revision: before.status?.materializationRevisions?.chats || 0,
			recentCalls: recentCallsBefore
		}, { timeout: 30000 });

		const after = await statusSnapshot(page);
		assert.ok(Number(after.status?.modeStates?.chats?.materialization?.nativePassCount || 0) >= 1,
			`Replacement generation reused a warm materialization: ${JSON.stringify({ before, after })}`);
	});

	await withPage('task-mode progress and errors stay isolated during a fast switch', {
		lazyChunk: 2,
		lazyDelay: 70,
		catalogRows: 90,
		taskDelay: 700
	}, async page => {
		await page.waitForFunction(() => {
			const sync = window.__PENA_RECENT_SYNC__;
			return sync?.mode === 'chats' && sync?.percent != null && sync.percent < 100;
		}, null, { timeout: 10000 });
		await page.evaluate(() => {
			window.__raceModeSamples = [];
			const sampleFrame = () => {
				const activeMode = document.querySelector('.task-host')?.hidden ? 'chats' : 'tasks';
				const sync = window.__PENA_RECENT_SYNC__ || {};
				const chatsGuard = document.querySelector('.recent-host .pena-native-original-load-guard:not([hidden])');
				const chatsGuardRect = chatsGuard?.getBoundingClientRect?.();
				const taskSurface = document.querySelector('.task-host .pena-native-folder-switcher');
				const taskSurfaceRect = taskSurface?.getBoundingClientRect?.();
				window.__raceModeSamples.push({
					activeMode,
					syncMode: String(sync.mode || ''),
					phase: String(sync.phase || ''),
					percent: sync.percent,
					error: String(sync.error || sync.gateError || ''),
					taskSurfacePainted: !!taskSurface && getComputedStyle(taskSurface).display !== 'none' &&
						getComputedStyle(taskSurface).visibility !== 'hidden' && Number(taskSurfaceRect?.width || 0) > 0 &&
						Number(taskSurfaceRect?.height || 0) > 0,
					chatGuardVisible: !!chatsGuard && getComputedStyle(chatsGuard).visibility !== 'hidden' &&
						Number(chatsGuardRect?.width || 0) > 0 && Number(chatsGuardRect?.height || 0) > 0
				});
				window.__raceModeSampleFrame = requestAnimationFrame(sampleFrame);
			};
			window.__raceModeSampleFrame = requestAnimationFrame(sampleFrame);
		});
		await page.locator('#switch-mode').evaluate(button => button.click());
		await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.mode === 'tasks', null, { timeout: 10000 });
		await waitForSettledMode(page, 'tasks', 30000);
		const result = await page.evaluate(() => {
			cancelAnimationFrame(window.__raceModeSampleFrame);
			return {
				status: window.__PENA_NATIVE_PREFETCH__?.status?.(),
				statusMode: window.__PENA_NATIVE_PREFETCH__?.status?.().mode,
				syncMode: window.__PENA_RECENT_SYNC__?.mode,
				samples: window.__raceModeSamples || []
			};
		});
		const taskFrames = result.samples.filter(sample => sample.activeMode === 'tasks');
		assert.equal(result.statusMode, 'tasks', `Prefetch status stayed on Chats: ${JSON.stringify(result)}`);
		assert.equal(result.syncMode, 'tasks', `Published sync stayed on Chats: ${JSON.stringify(result)}`);
		assert.notEqual(result.status?.modeStates?.chats?.attempt?.state, 'retry',
			`Superseded Chats traversal kept an automatic retry loop: ${JSON.stringify(result.status?.modeStates?.chats)}`);
		assert.equal(Number(result.status?.modeStates?.chats?.attempt?.retryAttempt || 0), 0,
			`Superseded Chats traversal retained retry debt: ${JSON.stringify(result.status?.modeStates?.chats)}`);
		assert.ok(taskFrames.length > 0, 'No Task Chats transition frames were captured');
		const leakingFrames = taskFrames.filter(sample => sample.chatGuardVisible || sample.error || (
			sample.taskSurfacePainted && sample.syncMode !== 'tasks' &&
			(sample.percent != null || /^(?:native-scroll|verifying|materializing|error)$/.test(sample.phase))
		));
		assert.deepEqual(leakingFrames, [], `Chats progress/error leaked into Task Chats: ${JSON.stringify(leakingFrames)}`);
	});

	console.log('native loading race regression: all checks passed');
} finally {
	await browser.close();
	await new Promise(resolve => server.close(resolve));
}

import assert from 'node:assert/strict';
import { createReadStream, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const extensionRoot = normalize(join(root, 'extension'));
const expectedVersion = JSON.parse(readFileSync(join(extensionRoot, 'manifest.json'), 'utf8')).version;
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((request, response) => {
	const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
	const path = pathname.startsWith('/extension/')
		? normalize(join(extensionRoot, pathname.slice('/extension/'.length)))
		: normalize(join(root, pathname));
	const allowedRoot = pathname.startsWith('/extension/') ? extensionRoot : root;
	if (!path.startsWith(allowedRoot)) return response.writeHead(403).end();
	const stream = createReadStream(path);
	stream.on('error', () => response.writeHead(404).end());
	response.writeHead(200, { 'content-type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8` });
	stream.pipe(response);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 760 } });
try {
	const base = `http://127.0.0.1:${address.port}`;
	const startedAt = Date.now();
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=160&lazyChunk=10&lazyDelay=20&initialTop=31&eager=1&expectedAudit=1`);
	await page.waitForFunction(version => window.__PENA_RECENT_SYNC__?.version === version, expectedVersion);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true, null, { timeout: 3000 });
	await page.evaluate(() => {
		window.nativeProgressSamples = [];
		window.nativeProgressSampleTimer = setInterval(() => {
			const sync = window.__PENA_RECENT_SYNC__ || {};
			const percent = Number(sync.percent);
			if (!Number.isFinite(percent)) return;
			const next = {
				percent,
				stage: String(sync.workStage || ''),
				active: window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true
			};
			const previous = window.nativeProgressSamples.at(-1);
			if (!previous || previous.percent !== next.percent || previous.stage !== next.stage || previous.active !== next.active) {
				window.nativeProgressSamples.push(next);
			}
		}, 40);
	});
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive &&
			window.__PENA_RECENT_SYNC__?.percent === 100 && window.__PENA_RECENT_SYNC__?.inFlight === false;
	}, null, { timeout: 10000 });
	const result = await page.evaluate(start => ({
		elapsed: Date.now() - start,
		rows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		percent: window.__PENA_RECENT_SYNC__?.percent,
		stage: window.__PENA_RECENT_SYNC__?.workStage || '',
		inFlight: window.__PENA_RECENT_SYNC__?.inFlight,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		overlays: document.querySelectorAll('.recent-host .pena-native-original-load-guard').length,
		samples: (clearInterval(window.nativeProgressSampleTimer), window.nativeProgressSamples || [])
	}), startedAt);
	const active = result.samples.filter(sample => sample.active);
	const values = active.map(sample => sample.percent);
	// The harness keeps its three fixed typed-ID rows beside the generated 160.
	assert.equal(result.rows, 163, JSON.stringify(result));
	assert.equal(result.modeCount, 163, JSON.stringify(result));
	assert.equal(result.sourceTop, 31, JSON.stringify(result));
	assert.ok(result.elapsed < 6000, `Cold native load exceeded 6 s: ${JSON.stringify(result)}`);
	assert.ok(values.length >= 3 && new Set(values).size >= 3, `Progress did not advance: ${JSON.stringify(result)}`);
	assert.ok(values.every((value, index) => value >= 0 && value < 100 && (index === 0 || value >= values[index - 1])),
		`Progress reached 100 early or moved backwards: ${JSON.stringify(result)}`);
	assert.ok(active.some(sample => sample.stage === 'traversal'), `Traversal stage is missing: ${JSON.stringify(result)}`);
	assert.ok(active.some(sample => sample.stage === 'tail-verification'), `Tail stage is missing: ${JSON.stringify(result)}`);
	assert.equal(result.percent, 100, JSON.stringify(result));
	assert.equal(result.inFlight, false, JSON.stringify(result));
	assert.equal(result.overlays, 0, JSON.stringify(result));
	console.log(`PASS native progress performance: 163 physical rows in ${result.elapsed} ms, ${new Set(values).size} measured progress values`);
	const warmStartedAt = Date.now();
	await page.evaluate(() => {
		window.nativeWarmSamples = [];
		window.nativeWarmTimer = setInterval(() => {
			const sync = window.__PENA_RECENT_SYNC__ || {};
			const percent = Number(sync.percent);
			if (!Number.isFinite(percent)) return;
			const next = {
				percent,
				stage: String(sync.workStage || ''),
				active: window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true
			};
			const previous = window.nativeWarmSamples.at(-1);
			if (!previous || previous.percent !== next.percent || previous.stage !== next.stage || previous.active !== next.active) {
				window.nativeWarmSamples.push(next);
			}
		}, 40);
		window.__PENA_NATIVE_PREFETCH__.runOriginal({ reason: 'manual' });
	});
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true, null, { timeout: 2000 });
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return Number(status?.materializationRevisions?.chats || 0) >= 2 && !status.originalActive &&
			window.__PENA_RECENT_SYNC__?.percent === 100 && window.__PENA_RECENT_SYNC__?.inFlight === false;
	}, null, { timeout: 5000 });
	const warm = await page.evaluate(start => ({
		elapsed: Date.now() - start,
		percent: Number(window.__PENA_RECENT_SYNC__?.percent),
		rows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		samples: (clearInterval(window.nativeWarmTimer), window.nativeWarmSamples || [])
	}), warmStartedAt);
	const warmValues = warm.samples.map(sample => sample.percent);
	assert.equal(warm.rows, 163, JSON.stringify(warm));
	assert.equal(warm.sourceTop, 31, JSON.stringify(warm));
	assert.ok(warm.elapsed < 4000, `Warm manual load exceeded 4 s: ${JSON.stringify(warm)}`);
	assert.ok(warmValues.some(value => value >= 50 && value < 99),
		`Warm progress retained the cold 0..50 scale: ${JSON.stringify(warm)}`);
	assert.ok(warmValues.every((value, index) => value >= 0 && value <= 100 && (index === 0 || value >= warmValues[index - 1])),
		`Warm progress moved backwards: ${JSON.stringify(warm)}`);
	assert.ok(warm.samples.filter(sample => sample.active).every(sample => sample.percent < 100),
		`Warm progress reached 100 while work was active: ${JSON.stringify(warm)}`);
	assert.equal(warm.percent, 100, JSON.stringify(warm));
	console.log(`PASS native warm progress: manual verification completed in ${warm.elapsed} ms without a 48→99 jump`);

	await page.evaluate(() => localStorage.clear());
	const secondPassStartedAt = Date.now();
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&lazyAfterFirstPass=1&lazyChunk=250&catalogRows=177&apiRecentCap=10&restNoNext=1&initialTop=28&startupBudget=10000&eager=1`);
	await page.waitForFunction(version => window.__PENA_RECENT_SYNC__?.version === version, expectedVersion);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true, null, { timeout: 3000 });
	await page.evaluate(() => {
		window.nativeSecondPassSamples = [];
		window.nativeSecondPassTimer = setInterval(() => {
			const sync = window.__PENA_RECENT_SYNC__ || {};
			const percent = Number(sync.percent);
			if (!Number.isFinite(percent)) return;
			const next = {
				percent,
				stage: String(sync.workStage || ''),
				active: window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true
			};
			const previous = window.nativeSecondPassSamples.at(-1);
			if (!previous || previous.percent !== next.percent || previous.stage !== next.stage || previous.active !== next.active) {
				window.nativeSecondPassSamples.push(next);
			}
		}, 40);
	});
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive &&
			Number(status.materializationRevisions?.chats || 0) === 2 && status.modeCounts?.chats === 180 &&
			window.__PENA_RECENT_SYNC__?.percent === 100 && window.__PENA_RECENT_SYNC__?.inFlight === false;
	}, null, { timeout: 12000 });
	const secondPass = await page.evaluate(start => ({
		elapsed: Date.now() - start,
		percent: Number(window.__PENA_RECENT_SYNC__?.percent),
		rows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
		revision: window.__PENA_NATIVE_PREFETCH__?.status?.().materializationRevisions?.chats || 0,
		passCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.materialization?.nativePassCount || 0,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		overlays: document.querySelectorAll('.recent-host .pena-native-original-load-guard').length,
		samples: (clearInterval(window.nativeSecondPassTimer), window.nativeSecondPassSamples || [])
	}), secondPassStartedAt);
	const secondValues = secondPass.samples.map(sample => sample.percent);
	assert.equal(secondPass.rows, 180, JSON.stringify(secondPass));
	assert.equal(secondPass.revision, 2, JSON.stringify(secondPass));
	assert.equal(secondPass.passCount, 2, JSON.stringify(secondPass));
	assert.equal(secondPass.sourceTop, 28, JSON.stringify(secondPass));
	assert.ok(secondPass.elapsed < 10000, `Two-pass native load exceeded 10 s: ${JSON.stringify(secondPass)}`);
	assert.ok(secondValues.some(value => value > 0 && value < 50) && secondValues.some(value => value >= 50 && value < 100),
		`Two-pass progress did not represent both passes: ${JSON.stringify(secondPass)}`);
	assert.ok(secondValues.every((value, index) => value >= 0 && value <= 100 && (index === 0 || value >= secondValues[index - 1])),
		`Two-pass progress moved backwards: ${JSON.stringify(secondPass)}`);
	assert.ok(secondPass.samples.filter(sample => sample.active).every(sample => sample.percent < 100),
		`Two-pass progress reached 100 while work was active: ${JSON.stringify(secondPass)}`);
	assert.ok(secondPass.samples.some(sample => sample.stage === 'second-pass-pending'),
		`Pending second pass was not represented in progress: ${JSON.stringify(secondPass)}`);
	assert.equal(secondPass.percent, 100, JSON.stringify(secondPass));
	assert.equal(secondPass.overlays, 0, JSON.stringify(secondPass));
	console.log(`PASS native progress second pass: 180 rows in ${secondPass.elapsed} ms without a 50/99/100 stall`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=60&lazyChunk=10&lazyDelay=300&startupBudget=1200&eager=1`);
	await page.waitForFunction(version => window.__PENA_RECENT_SYNC__?.version === version, expectedVersion);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.modeStates?.chats?.attempt?.state === 'retry' && !status.originalActive;
	}, null, { timeout: 6000 });
	const interrupted = await page.evaluate(() => ({
		phase: String(window.__PENA_RECENT_SYNC__?.phase || ''),
		percent: window.__PENA_RECENT_SYNC__?.percent,
		inFlight: window.__PENA_RECENT_SYNC__?.inFlight,
		attempt: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.attempt || null,
		overlays: document.querySelectorAll('.recent-host .pena-native-original-load-guard').length
	}));
	assert.equal(interrupted.attempt?.state, 'retry', JSON.stringify(interrupted));
	assert.equal(interrupted.inFlight, false, JSON.stringify(interrupted));
	assert.notEqual(interrupted.percent, 100, `Interrupted work was displayed as complete: ${JSON.stringify(interrupted)}`);
	assert.equal(interrupted.overlays, 0, `Interrupted loader remained stuck on screen: ${JSON.stringify(interrupted)}`);
	console.log('PASS native progress interruption: retry closes the loader without a false 100%');
} finally {
	await browser.close();
	await new Promise(resolve => server.close(resolve));
}

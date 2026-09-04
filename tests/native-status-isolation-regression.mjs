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
	await page.addInitScript(() => { window.__PENA_TEST_EAGER_MATERIALIZATION__ = true; });
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=60&lazyChunk=10&lazyDelay=300&startupBudget=1200`);
	await page.waitForFunction(version => window.__PENA_RECENT_SYNC__?.version === version, expectedVersion);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.modeStates?.chats?.attempt?.state === 'retry' &&
			window.__PENA_RECENT_SYNC__?.recoveryPending === true && !status.originalActive;
	}, null, { timeout: 6000 });
	await page.evaluate(() => {
		window.__PENA_TEST_NATIVE_SCROLL_MAX_MS__ = 10000;
		window.crossModeErrorLeaks = [];
		const sample = () => {
			const host = document.querySelector('.test-host:not([hidden])');
			if (!host?.classList.contains('task-host')) return;
			const chip = host.querySelector('.pena-native-sync-chip');
			const panel = chip?.closest('.pena-native-folder-switcher');
			const chipStyle = chip ? getComputedStyle(chip) : null;
			const panelStyle = panel ? getComputedStyle(panel) : null;
			const painted = !!chip && !chip.hidden && chipStyle?.display !== 'none' &&
				chipStyle?.visibility !== 'hidden' && panelStyle?.display !== 'none' &&
				panelStyle?.visibility !== 'hidden' && chip.getClientRects().length > 0;
			if (painted && (chip.classList.contains('--error') || chip.classList.contains('--warning'))) {
				window.crossModeErrorLeaks.push({
					text: String(chip.textContent || '').trim(),
					syncMode: String(window.__PENA_RECENT_SYNC__?.mode || ''),
					error: String(window.__PENA_RECENT_SYNC__?.error || ''),
					backgroundError: String(window.__PENA_RECENT_SYNC__?.backgroundError || '')
				});
			}
		};
		new MutationObserver(sample).observe(document.body, {
			attributes: true,
			attributeFilter: ['class', 'hidden'],
			childList: true,
			characterData: true,
			subtree: true
		});
		sample();
		document.querySelector('#switch-mode')?.click();
	});
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('tasks') && status?.modeStates?.tasks?.attempt?.state === 'idle' &&
			!status.originalActive;
	}, null, { timeout: 12000 });
	const result = await page.evaluate(() => ({
		leaks: window.crossModeErrorLeaks || [],
		syncMode: String(window.__PENA_RECENT_SYNC__?.mode || ''),
		error: String(window.__PENA_RECENT_SYNC__?.error || ''),
		backgroundError: String(window.__PENA_RECENT_SYNC__?.backgroundError || ''),
		chipVisible: Array.from(document.querySelectorAll('.task-host .pena-native-sync-chip')).some(chip => {
			const panel = chip.closest('.pena-native-folder-switcher');
			return !chip.hidden && getComputedStyle(chip).display !== 'none' &&
				panel && getComputedStyle(panel).display !== 'none';
		}),
		chatAttempt: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.attempt || null,
		taskAttempt: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.tasks?.attempt || null
	}));
	assert.deepEqual(result.leaks, [], JSON.stringify(result));
	assert.equal(result.syncMode, 'tasks', JSON.stringify(result));
	assert.equal(result.error, '', JSON.stringify(result));
	assert.equal(result.backgroundError, '', JSON.stringify(result));
	assert.equal(result.chipVisible, false, JSON.stringify(result));
	assert.equal(result.chatAttempt?.state, 'retry', JSON.stringify(result));
	assert.equal(result.taskAttempt?.state, 'idle', JSON.stringify(result));
	console.log('PASS native status isolation: stale chats retry never paints in Task Chats');
} finally {
	await browser.close();
	await new Promise(resolve => server.close(resolve));
}

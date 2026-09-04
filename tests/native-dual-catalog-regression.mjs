import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
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
const page = await browser.newPage({ viewport: { width: 420, height: 760 } });

await page.addInitScript(() => {
	window.__PENA_TEST_EAGER_MATERIALIZATION__ = true;
	window.__PENA_TEST_NATIVE_EXPECTED_AUDIT__ = true;
	window.__PENA_TEST_NATIVE_TASK_AUDIT__ = true;
});

const snapshot = () => page.evaluate(() => ({
	status: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
	sync: window.__PENA_RECENT_SYNC__ || null,
	recentCalls: (window.nativeRestCalls || []).filter(call => call.method === 'im.recent.list').length,
	taskCalls: (window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length,
	restCalls: window.nativeRestCalls || [],
	batches: window.nativeBatchSizes || []
}));

try {
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=80&lazyChunk=12&lazyDelay=20&initialTop=24&startupBudget=10000`);
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.loadedModes?.includes('chats') && status?.sharedCatalog?.auditedAt > 0 &&
				status.originalActive === false && !status.apiActive;
		}, null, { timeout: 25000 });
	} catch (error) {
		throw new Error(`Shared cold catalog did not settle: ${JSON.stringify(await snapshot())}; ${error.message}`);
	}
	const beforeSwitch = await snapshot();
	await page.locator('#switch-mode').evaluate(button => button.click());
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.loadedModes?.includes('tasks') && status.originalActive === false;
		}, null, { timeout: 25000 });
	} catch (error) {
		throw new Error(`Task source did not settle from the shared catalog: ${JSON.stringify(await snapshot())}; ${error.message}`);
	}
	const afterSwitch = await snapshot();
	assert.equal(afterSwitch.recentCalls, beforeSwitch.recentCalls,
		`Task Chats downloaded the shared recent catalog again: ${JSON.stringify({ beforeSwitch, afterSwitch })}`);
	assert.equal(afterSwitch.taskCalls, beforeSwitch.taskCalls,
		`Task Chats downloaded the fresh task index again: ${JSON.stringify({ beforeSwitch, afterSwitch })}`);
	assert.equal(afterSwitch.status?.expectedCatalogs?.tasks?.complete, true,
		`Task Chats did not bind the shared catalog: ${JSON.stringify(afterSwitch)}`);
	console.log('native dual catalog regression: all checks passed');
} finally {
	await browser.close();
	await new Promise(resolve => server.close(resolve));
}

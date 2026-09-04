import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const extensionDir = fileURLToPath(new URL('../extension/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(extensionDir, 'manifest.json'), 'utf8'));
const runtimeFiles = [
	'native-catalog.js',
	'native-interaction-state.js',
	'native-time-control.js',
	'native-lifecycle.js',
	'dialog-repository.js',
	'injected.js'
];
const runtimeBytes = runtimeFiles.reduce((sum, name) => sum + statSync(join(extensionDir, name)).size, 0);
const stylesheetBytes = statSync(join(extensionDir, 'injected.css')).size;
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });

try {
	const page = await browser.newPage();
	const chromeMock = `<script>
		window.chrome = {
			runtime: {
				getURL(path) { return location.origin + '/extension/' + path; },
				getManifest() { return ${JSON.stringify(manifest)}; },
				sendMessage(_payload, callback) { queueMicrotask(() => callback?.({ ok: true })); },
				lastError: null
			},
			storage: {
				local: {
					get(_keys, callback) { queueMicrotask(() => callback?.({})); },
					set(_values, callback) { queueMicrotask(() => callback?.()); }
				},
				onChanged: { addListener() {} }
			}
		};
	</script>`;
	const runtimeLoader = `${chromeMock}<script src="/extension/content.js"></script>`;
	await page.route(/\/online\/.*$/, route => route.fulfill({
		status: 200,
		contentType: 'text/html; charset=utf-8',
		body: `<!doctype html><html><head><title>Messenger shell</title>${runtimeLoader}</head><body><main>Bitrix messenger shell</main><iframe id="task-slider" src="/company/personal/user/7/tasks/task/view/90000/"></iframe><iframe id="ol-frame" src="/desktop_app/?IM_LINES=Y"></iframe></body></html>`
	}));
	await page.route(/\/company\/personal\/user\/7\/tasks\/task\/view\/90000\/$/, route => route.fulfill({
		status: 200,
		contentType: 'text/html; charset=utf-8',
		body: `<!doctype html><html><head><title>Task side panel</title>${runtimeLoader}</head><body><main>Task details without a Messenger list</main></body></html>`
	}));
	await page.route(/\/desktop_app\/\?IM_LINES=Y$/, route => route.fulfill({
		status: 200,
		contentType: 'text/html; charset=utf-8',
		body: `<!doctype html><html><head><title>Open Lines</title>${runtimeLoader}</head><body><main class="bx-messenger-recent-wrap bx-messenger-recent-lines-wrap">Open Lines</main></body></html>`
	}));

	await page.goto(`${server.baseUrl}/online/?IM_DIALOG=chat5000`);
	await page.waitForFunction(version => window.__ANITREC_RUNNING__ === version, manifest.version, { timeout: 10000 });
	const taskFrame = page.frames().find(frame => /\/tasks\/task\/view\/90000\/$/.test(frame.url()));
	assert.ok(taskFrame, 'Task SidePanel iframe did not load');
	const olFrame = page.frames().find(frame => /\/desktop_app\/\?IM_LINES=Y$/.test(frame.url()));
	assert.ok(olFrame, 'Supported Open Lines iframe did not load');
	await olFrame.waitForFunction(version => window.__ANITREC_RUNNING__ === version, manifest.version, { timeout: 10000 });
	await page.waitForTimeout(100);

	const state = {
		version: manifest.version,
		contentMatches: manifest.content_scripts?.[0]?.matches || [],
		allFrames: manifest.content_scripts?.[0]?.all_frames === true,
		matchAboutBlank: manifest.content_scripts?.[0]?.match_about_blank === true,
		runtimeBytes,
		stylesheetBytes,
		topRuntime: await page.evaluate(() => window.__ANITREC_RUNNING__ || ''),
		taskFrameRuntime: await taskFrame.evaluate(() => window.__ANITREC_RUNNING__ || ''),
		olFrameRuntime: await olFrame.evaluate(() => window.__ANITREC_RUNNING__ || ''),
		taskFrameHasMessengerList: await taskFrame.evaluate(() => !!document.querySelector('.bx-im-list-container-recent__elements,.bx-im-list-container-task__elements')),
		taskFrameObserversArmed: await taskFrame.evaluate(() => !!window.__PENA_NATIVE_LIFECYCLE__ || document.documentElement?.dataset?.penaDialogRepositoryBridge === '1'),
		topStylesheets: await page.locator('link[data-pena-runtime-style]').count(),
		taskFrameStylesheets: await taskFrame.locator('link[data-pena-runtime-style]').count(),
		olFrameStylesheets: await olFrame.locator('link[data-pena-runtime-style]').count()
	};
	console.log(`DIAGNOSTIC content frame scope ${JSON.stringify(state)}`);

	assert.equal(state.taskFrameHasMessengerList, false, 'Fixture unexpectedly contains a Messenger list');
	assert.equal(state.taskFrameRuntime, '', `Heavy runtime loaded in an unrelated task SidePanel iframe: ${JSON.stringify(state)}`);
	assert.equal(state.taskFrameObserversArmed, false, `Task SidePanel armed extension observers: ${JSON.stringify(state)}`);
	assert.equal(state.taskFrameStylesheets, 0, `Task SidePanel loaded Messenger CSS: ${JSON.stringify(state)}`);
	assert.equal(state.topRuntime, manifest.version, `Top Messenger did not load runtime: ${JSON.stringify(state)}`);
	assert.equal(state.olFrameRuntime, manifest.version, `Supported OL iframe did not load runtime: ${JSON.stringify(state)}`);
	assert.equal(state.topStylesheets, 1, `Top Messenger stylesheet count changed: ${JSON.stringify(state)}`);
	assert.equal(state.olFrameStylesheets, 1, `OL stylesheet count changed: ${JSON.stringify(state)}`);

	await page.route(/\/stream\/$/, route => route.fulfill({
		status: 200,
		contentType: 'text/html; charset=utf-8',
		body: `<!doctype html><html><head><title>Bitrix stream</title>${runtimeLoader}</head><body><main id="stream">Activity stream</main></body></html>`
	}));
	await page.goto(`${server.baseUrl}/stream/`);
	await page.waitForTimeout(120);
	const beforeMessengerMount = await page.evaluate(() => ({
		runtime: window.__ANITREC_RUNNING__ || '',
		stylesheets: document.querySelectorAll('link[data-pena-runtime-style]').length
	}));
	assert.deepEqual(beforeMessengerMount, { runtime: '', stylesheets: 0 }, 'Non-Messenger top page eagerly loaded full runtime');
	await page.evaluate(() => {
		const list = document.createElement('div');
		list.className = 'bx-im-list-container-recent__elements';
		document.body.appendChild(list);
	});
	await page.waitForFunction(version => window.__ANITREC_RUNNING__ === version, manifest.version, { timeout: 10000 });
	assert.equal(await page.locator('link[data-pena-runtime-style]').count(), 1, 'SPA Messenger mount did not load stylesheet once');
	console.log('PASS content frame scope: task SidePanel skipped; top Messenger, OL and SPA mount preserved');
} finally {
	await browser.close();
	await server.close();
}

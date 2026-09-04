import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = collectPageErrors(page);
const url = `${server.baseUrl}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&activeFolder=1&skipInitialMount=1&initialTop=24`;

try {
	await page.goto(url);
	await page.locator('.recent-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	await page.waitForFunction(() => {
		const folder = document.querySelector('.recent-host .pena-native-folder-tab[title="Тестовая папка"]');
		const foreign = document.querySelector('.recent-host [data-id="chat5"]');
		return folder?.classList.contains('--active') && foreign && getComputedStyle(foreign).display === 'none';
	});

	const failedPass = await page.evaluate(async () => {
		const viewport = document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container');
		const container = document.querySelector('.recent-host .bx-im-list-container-recent__elements');
		const foreign = document.querySelector('.recent-host [data-id="chat5"]');
		if (!viewport || !container || !foreign) throw new Error('Native prefetch fixture is incomplete');
		const baselineTop = Number(viewport.scrollTop) || 0;
		let interceptedTop = baselineTop;
		let writes = 0;
		Object.defineProperty(viewport, 'scrollTop', {
			configurable: true,
			get: () => interceptedTop,
			set: value => {
				writes += 1;
				if (writes === 1) throw new Error('forced native prefetch failure');
				interceptedTop = Number(value) || 0;
			}
		});
		let error = '';
		try {
			await window.__PENA_NATIVE_PREFETCH__.run({ reason: 'manual' });
		} catch (caught) {
			error = String(caught?.message || caught || '');
		}
		const status = window.__PENA_NATIVE_PREFETCH__.status();
		const result = {
			error,
			writes,
			baselineTop,
			interceptedTop,
			active: status.active,
			traversalActive: container.classList.contains('pena-native-traversal-active'),
			foreignDisplay: getComputedStyle(foreign).display,
			foreignVisibility: getComputedStyle(foreign).visibility
		};
		result.deleteResult = delete viewport.scrollTop;
		result.ownScrollTopAfterDelete = Object.hasOwn(viewport, 'scrollTop');
		viewport.scrollTop = baselineTop;
		return result;
	});

	assert.match(failedPass.error, /forced native prefetch failure/, `The fixture did not reject inside traversal: ${JSON.stringify(failedPass)}`);
	assert.ok(failedPass.writes >= 2, `The rejected pass did not restore its scroll anchor: ${JSON.stringify(failedPass)}`);
	assert.equal(failedPass.interceptedTop, failedPass.baselineTop, `The rejected pass changed the source anchor: ${JSON.stringify(failedPass)}`);
	assert.equal(failedPass.active, false, `Rejected prefetch remained active: ${JSON.stringify(failedPass)}`);
	assert.equal(failedPass.traversalActive, false, `Rejected prefetch leaked traversal state: ${JSON.stringify(failedPass)}`);
	assert.equal(failedPass.foreignDisplay, 'none', `Rejected prefetch exposed a dialog from another folder: ${JSON.stringify(failedPass)}`);
	assert.equal(failedPass.foreignVisibility, 'visible', `Rejected prefetch left traversal visibility on a filtered row: ${JSON.stringify(failedPass)}`);
	assert.equal(failedPass.deleteResult, true, `The test fixture could not remove its failing scroll hook: ${JSON.stringify(failedPass)}`);
	assert.equal(failedPass.ownScrollTopAfterDelete, false, `The failing scroll hook survived cleanup: ${JSON.stringify(failedPass)}`);

	const retry = await page.evaluate(() => window.__PENA_NATIVE_PREFETCH__.run({ reason: 'manual' }));
	assert.equal(retry?.native, true, `Prefetch could not restart after cleanup: ${JSON.stringify(retry)}`);
	const recovered = await page.evaluate(() => {
		const viewport = document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container');
		const container = document.querySelector('.recent-host .bx-im-list-container-recent__elements');
		const foreign = document.querySelector('.recent-host [data-id="chat5"]');
		return {
			active: window.__PENA_NATIVE_PREFETCH__.status().active,
			top: Number(viewport?.scrollTop) || 0,
			traversalActive: container?.classList.contains('pena-native-traversal-active') || false,
			foreignDisplay: foreign ? getComputedStyle(foreign).display : ''
		};
	});
	assert.deepEqual(recovered, { active: false, top: failedPass.baselineTop, traversalActive: false, foreignDisplay: 'none' },
		`Retry after rejected prefetch did not restore the filtered native list: ${JSON.stringify(recovered)}`);
	assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`);
	console.log('PASS native prefetch failure cleanup: filters, anchor and retry recover after rejection');
} finally {
	await browser.close();
	await server.close();
}

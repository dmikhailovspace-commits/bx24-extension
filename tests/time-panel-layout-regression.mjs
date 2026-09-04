import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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

const closeEnough = (left, right, tolerance = 1) => Math.abs(left - right) <= tolerance;
const onEightGrid = value => closeEnough(value / 8, Math.round(value / 8), 0.01);
const measure = page => page.locator('.pena-native-time-panel').evaluate(panel => {
	const box = element => {
		const rect = element?.getBoundingClientRect?.();
		return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
	};
	const styleMetrics = element => {
		if (!element) return null;
		const style = getComputedStyle(element);
		const numeric = property => parseFloat(style[property]) || 0;
		return {
			paddingTop: numeric('paddingTop'),
			paddingRight: numeric('paddingRight'),
			paddingBottom: numeric('paddingBottom'),
			paddingLeft: numeric('paddingLeft'),
			rowGap: numeric('rowGap'),
			columnGap: numeric('columnGap'),
			borderTopRadius: numeric('borderTopLeftRadius'),
			borderBottomRadius: numeric('borderBottomLeftRadius'),
			overflowX: style.overflowX,
			overflowY: style.overflowY
		};
	};
	const activity = panel.querySelector('.pena-native-time-column-activity');
	const records = panel.querySelector('.pena-native-time-column-records');
	const body = panel.querySelector('.pena-native-time-body');
	const scroll = panel.querySelector('.pena-native-time-scroll');
	const summary = panel.querySelector('.pena-native-time-summary');
	const header = panel.querySelector('.pena-native-time-panel-head');
	const tracker = panel.querySelector('.pena-native-time-tracker');
	const manual = panel.querySelector('.pena-native-time-manual');
	const manualToggle = panel.querySelector('.pena-native-time-manual-toggle');
	const manualResults = panel.querySelector('.pena-native-time-manual-results');
	const controls = selector => Array.from(panel.querySelectorAll(selector), box);
	const scrollOwners = Array.from(panel.querySelectorAll('*')).filter(element => {
		if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
		return /^(auto|scroll)$/.test(getComputedStyle(element).overflowY);
	}).map(element => element.className || element.tagName);
	const visibleOverflow = Array.from(panel.querySelectorAll('*')).filter(element => {
		if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
		const rect = element.getBoundingClientRect();
		const panelRect = panel.getBoundingClientRect();
		return rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1;
	}).map(element => element.className || element.tagName);
	return {
		panel: box(panel),
		viewport: { width: innerWidth, height: innerHeight },
		activity: box(activity),
		records: box(records),
		body: box(body),
		scroll: box(scroll),
		summary: box(summary),
		header: box(header),
		tracker: box(tracker),
		manual: box(manual),
		columns: getComputedStyle(body).gridTemplateColumns,
		overflowX: getComputedStyle(panel).overflowX,
		scrollbarGutter: getComputedStyle(scroll).scrollbarGutter,
		scrollOwners,
		styles: {
			header: styleMetrics(header),
			scroll: styleMetrics(scroll),
			summary: styleMetrics(summary),
			body: styleMetrics(body),
			activity: styleMetrics(activity),
			records: styleMetrics(records),
			tracker: styleMetrics(tracker),
			manual: styleMetrics(manual),
			manualToggle: styleMetrics(manualToggle),
			manualResults: styleMetrics(manualResults)
		},
		manualControls: controls('.pena-native-time-duration-field,.pena-native-time-manual-submit'),
		trackerControls: controls('.pena-native-time-task-select:not([hidden]),.pena-native-time-start:not([hidden])'),
		headerControls: controls('.pena-native-time-refresh,.pena-native-time-report,.pena-native-time-header-actions>.pena-native-popover-close'),
		dateControls: controls('.pena-native-time-date-prev,.pena-native-time-date-input,.pena-native-time-date-next,.pena-native-time-date-today:not([hidden])'),
		visibleOverflow
	};
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=tasks&longTimeTitle=1`);
	await page.locator('.task-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	const open = async () => {
		await page.locator('.task-host .pena-native-time-button').click();
		const panel = page.locator('.pena-native-time-panel');
		await panel.waitFor({ state: 'visible' });
		await page.waitForTimeout(180);
		return panel;
	};
	const close = async panel => {
		await panel.press('Escape');
		await panel.waitFor({ state: 'detached' });
		await page.waitForFunction(() => document.activeElement?.classList?.contains('pena-native-time-button'));
	};
	let panel = await open();
	await page.waitForFunction(() => document.querySelectorAll('.pena-native-time-task-select option').length >= 2);
	await page.waitForFunction(() => Array.from(document.querySelectorAll('.pena-native-time-task-select option'))
		.some(option => option.value === '101' && option.textContent.length > 180));

	const focusedClass = await page.evaluate(() => document.activeElement?.className || '');
	assert.match(focusedClass, /pena-native-time-panel/, `Focus did not enter the dialog shell: ${focusedClass}`);
	const wide = await measure(page);
	assert.ok(closeEnough((wide.panel.left + wide.panel.right) / 2, wide.viewport.width / 2), `Wide window is not horizontally centered: ${JSON.stringify(wide)}`);
	assert.ok(closeEnough((wide.panel.top + wide.panel.bottom) / 2, wide.viewport.height / 2), `Wide window is not vertically centered: ${JSON.stringify(wide)}`);
	assert.ok(closeEnough(wide.panel.width, 720), `Wide window is not 720px: ${JSON.stringify(wide)}`);
	assert.ok(closeEnough(wide.panel.height, 520), `Wide window is not 520px: ${JSON.stringify(wide)}`);
	assert.ok(closeEnough(wide.header.height, 48), `Header left the 8px grid: ${JSON.stringify(wide.header)}`);
	assert.equal(await panel.locator('.pena-native-time-footer').count(), 0, 'Legacy footer still occupies panel height');
	assert.equal(await panel.locator('.pena-native-time-header-actions .pena-native-time-report').count(), 1,
		'The report action is not part of the compact header');
	assert.ok(wide.summary.height >= 79 && wide.summary.height <= 81, `Summary is not the compact 80px strip: ${JSON.stringify(wide.summary)}`);
	assert.ok(closeEnough(wide.activity.top, wide.records.top), `Wide columns do not share a baseline: ${JSON.stringify(wide)}`);
	assert.ok(closeEnough(wide.activity.width, wide.records.width), `Wide columns have different widths: ${JSON.stringify(wide)}`);
	assert.ok(wide.activity.right < wide.records.left, `Wide columns overlap: ${JSON.stringify(wide)}`);
	assert.ok(closeEnough(wide.summary.left, wide.body.left) && closeEnough(wide.summary.right, wide.body.right),
		`Summary and cards do not share the same horizontal edges: ${JSON.stringify(wide)}`);
	assert.equal(wide.overflowX, 'hidden');
	assert.match(wide.scrollbarGutter, /stable/);
	assert.deepEqual(wide.scrollOwners, ['pena-native-time-scroll'], `The time window has nested scroll owners: ${JSON.stringify(wide.scrollOwners)}`);
	assert.deepEqual(wide.visibleOverflow, []);
	for (const side of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) {
		assert.ok(closeEnough(wide.styles.scroll[side], 16), `Desktop scroll ${side} is off-grid: ${JSON.stringify(wide.styles.scroll)}`);
		assert.ok(closeEnough(wide.styles.summary[side], 16), `Summary ${side} is off-grid: ${JSON.stringify(wide.styles.summary)}`);
		assert.ok(closeEnough(wide.styles.tracker[side], 16), `Tracker ${side} is off-grid: ${JSON.stringify(wide.styles.tracker)}`);
		assert.ok(closeEnough(wide.styles.manual[side], 16), `Manual card ${side} is off-grid: ${JSON.stringify(wide.styles.manual)}`);
	}
	for (const [name, value] of [
		['scroll gap', wide.styles.scroll.rowGap],
		['column gap', wide.styles.body.columnGap],
		['activity rhythm', wide.styles.activity.rowGap],
		['records rhythm', wide.styles.records.rowGap]
	]) {
		assert.ok(closeEnough(value, 16) && onEightGrid(value), `${name} is not 16px on the 8px grid: ${value}`);
	}
	assert.ok(closeEnough(wide.styles.tracker.rowGap, 8) && closeEnough(wide.styles.manual.rowGap, 8),
		`Card inner rhythm is inconsistent: ${JSON.stringify({ tracker: wide.styles.tracker, manual: wide.styles.manual })}`);
	assert.ok(closeEnough(wide.styles.tracker.borderTopRadius, 8) && closeEnough(wide.styles.tracker.borderBottomRadius, 8) &&
		closeEnough(wide.styles.manualToggle.borderTopRadius, 8) && closeEnough(wide.styles.manual.borderBottomRadius, 8),
		`Cards do not share the same outer radius: ${JSON.stringify({ tracker: wide.styles.tracker, manualToggle: wide.styles.manualToggle, manual: wide.styles.manual })}`);
	assert.equal(wide.dateControls.length, 3, `Selected-date navigation is incomplete: ${JSON.stringify(wide.dateControls)}`);
	assert.ok(wide.dateControls.every(control => closeEnough(control.height, 32)),
		`Selected-date controls have inconsistent heights: ${JSON.stringify(wide.dateControls)}`);
	for (const [name, controls, target] of [
		['manual', wide.manualControls, 32], ['tracker', wide.trackerControls, 32], ['header', wide.headerControls, 32]
	]) {
		assert.ok(controls.length >= 2 && controls.every(control => closeEnough(control.height, target)),
			`${name} controls have inconsistent heights: ${JSON.stringify(controls)}`);
	}

	const taskSelect = page.locator('.pena-native-time-task-select');
	await taskSelect.selectOption('101');
	const longTitle = await taskSelect.locator('option:checked').textContent();
	assert.ok(longTitle.length > 180, 'Long task fixture was not selected');
	assert.equal(await taskSelect.getAttribute('data-pena-full-task-title'), longTitle);
	assert.equal(await taskSelect.getAttribute('title'), null, 'Native title would duplicate the custom tooltip');
	assert.equal(await taskSelect.getAttribute('aria-label'), `Задача для трекинга: ${longTitle}`);
	await taskSelect.focus();
	const tooltip = page.locator('.pena-native-time-title-tooltip');
	await tooltip.waitFor({ state: 'visible' });
	assert.equal(await tooltip.textContent(), longTitle, 'Select tooltip does not expose the exact task title');
	await page.locator('.pena-native-time-start').focus();
	await tooltip.waitFor({ state: 'hidden' });

	const topBefore = wide.panel.top;
	const trackedToggleWide = page.locator('.pena-native-time-tracked-toggle');
	if (await trackedToggleWide.getAttribute('aria-expanded') !== 'true') await trackedToggleWide.click();
	const longTaskRow = page.locator('.pena-native-time-task-main', { hasText: 'Задача 101' }).first();
	await longTaskRow.waitFor({ state: 'visible' });
	const longRowTitle = longTaskRow.locator('.pena-native-time-task-title');
	const rowTitleGeometry = await longRowTitle.evaluate(node => ({
		height: node.getBoundingClientRect().height,
		lineHeight: parseFloat(getComputedStyle(node).lineHeight),
		scrollWidth: node.scrollWidth,
		clientWidth: node.clientWidth
	}));
	assert.ok(rowTitleGeometry.height <= rowTitleGeometry.lineHeight * 2 + 1,
		`Long title exceeds two lines: ${JSON.stringify(rowTitleGeometry)}`);
	assert.ok(rowTitleGeometry.scrollWidth <= rowTitleGeometry.clientWidth + 1,
		`Long unbroken title created horizontal overflow: ${JSON.stringify(rowTitleGeometry)}`);
	assert.equal(await longTaskRow.getAttribute('data-pena-full-task-title'), longTitle);
	assert.equal(await longTaskRow.getAttribute('title'), null, 'Task row exposes two competing tooltips');
	await longTaskRow.hover();
	await tooltip.waitFor({ state: 'visible' });
	assert.equal(await tooltip.textContent(), longTitle, 'Task row tooltip does not expose the exact task title');
	const longEntryRow = page.locator('.pena-native-time-entry-row', { hasText: 'Задача 101' }).first();
	await longEntryRow.locator('.pena-native-time-row-delete').click();
	const cancelDelete = longEntryRow.locator('.pena-native-time-row-delete-cancel');
	await cancelDelete.waitFor({ state: 'visible' });
	const deleteGeometry = await longEntryRow.evaluate(row => {
		const rowRect = row.getBoundingClientRect();
		const panelRect = row.closest('.pena-native-time-panel').getBoundingClientRect();
		return {
			rowRight: rowRect.right,
			panelRight: panelRect.right,
			scrollWidth: row.scrollWidth,
			clientWidth: row.clientWidth,
			buttonHeights: Array.from(row.querySelectorAll('.pena-native-time-row-delete,.pena-native-time-row-delete-cancel'),
				button => button.getBoundingClientRect().height)
		};
	});
	assert.ok(deleteGeometry.rowRight <= deleteGeometry.panelRight && deleteGeometry.scrollWidth <= deleteGeometry.clientWidth + 1,
		`Delete confirmation overflows its card: ${JSON.stringify(deleteGeometry)}`);
	assert.ok(deleteGeometry.buttonHeights.every(height => closeEnough(height, 32)),
		`Delete confirmation left the 32px control rhythm: ${JSON.stringify(deleteGeometry)}`);
	await cancelDelete.click();
	const manualSearch = page.locator('.pena-native-time-manual-search');
	await manualSearch.fill('очень длинное');
	const longSearchResult = page.locator('.pena-native-time-manual-result', { hasText: 'Задача 101' }).first();
	await longSearchResult.waitFor({ state: 'visible' });
	const searchOpen = await measure(page);
	assert.deepEqual(searchOpen.scrollOwners, ['pena-native-time-scroll'],
		`Visible search results introduced a nested scroll owner: ${JSON.stringify(searchOpen.scrollOwners)}`);
	assert.equal(searchOpen.styles.manualResults.overflowY, 'visible',
		`Visible search results should grow inside the main scroll owner: ${JSON.stringify(searchOpen.styles.manualResults)}`);
	assert.equal(await longSearchResult.getAttribute('data-pena-full-task-title'), longTitle);
	assert.equal(await longSearchResult.getAttribute('title'), null, 'Search result exposes two competing tooltips');
	assert.equal(await longSearchResult.getAttribute('aria-label'), `Выбрать задачу: ${longTitle}`);
	await longSearchResult.hover();
	await tooltip.waitFor({ state: 'visible' });
	assert.equal(await tooltip.textContent(), longTitle, 'Search result tooltip does not expose the exact task title');
	await longSearchResult.click();
	const manualSelected = page.locator('.pena-native-time-manual-selected');
	await manualSelected.waitFor({ state: 'visible' });
	assert.equal(await manualSelected.getAttribute('data-pena-full-task-title'), longTitle);
	assert.equal(await manualSelected.getAttribute('title'), null, 'Selected task exposes two competing tooltips');
	assert.equal(await manualSelected.getAttribute('aria-label'), `Сменить задачу: ${longTitle}`);
	await manualSelected.focus();
	await tooltip.waitFor({ state: 'visible' });
	assert.equal(await tooltip.textContent(), longTitle, 'Selected-task tooltip does not expose the exact task title');
	await page.waitForTimeout(80);
	const afterSearch = await measure(page);
	const topAfter = afterSearch.panel.top;
	assert.ok(closeEnough(topBefore, topAfter), `Dialog top jumped after dynamic content: ${topBefore} -> ${topAfter}`);
	assert.deepEqual(afterSearch.scrollOwners, ['pena-native-time-scroll'],
		`Search results introduced a nested scroll owner: ${JSON.stringify(afterSearch.scrollOwners)}`);
	assert.equal(afterSearch.styles.manualResults.overflowY, 'visible',
		`Search results should grow inside the main scroll owner: ${JSON.stringify(afterSearch.styles.manualResults)}`);

	const focusables = panel.locator('button:not([disabled]):not([hidden]),a[href],input:not([disabled]):not([hidden]),select:not([disabled]):not([hidden])');
	await focusables.last().focus();
	await page.keyboard.press('Tab');
	assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.pena-native-time-panel button:not([disabled]):not([hidden])')), true, 'Tab escaped the dialog');
	await close(panel);

	panel = await open();
	const backdropCancelled = await page.locator('.pena-native-time-backdrop').evaluate(backdrop => {
		const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
		return backdrop.dispatchEvent(event) === false;
	});
	assert.equal(backdropCancelled, true, 'Backdrop pointer event was not consumed');
	await panel.waitFor({ state: 'detached' });
	await page.waitForFunction(() => document.activeElement?.classList?.contains('pena-native-time-button'));

	const screenshotPath = join(tmpdir(), 'pena-time-panel-layout.png');
	for (const viewport of [{ width: 768, height: 720 }, { width: 681, height: 720 }, { width: 680, height: 720 }, { width: 420, height: 760 }, { width: 360, height: 640 }]) {
		await page.setViewportSize(viewport);
		panel = await open();
		const current = await measure(page);
		const expectedWidth = viewport.width <= 680 ? Math.min(520, viewport.width - 16) : Math.min(720, viewport.width - 32);
		const expectedHeight = viewport.width <= 680 ? viewport.height - 16 : Math.min(520, viewport.height - 32);
		assert.ok(closeEnough(current.panel.width, expectedWidth),
			`Window width is unstable at ${viewport.width}px: ${JSON.stringify(current.panel)}`);
		assert.ok(closeEnough(current.panel.height, expectedHeight),
			`Window height is unstable at ${viewport.width}px: ${JSON.stringify(current.panel)}`);
		assert.ok(closeEnough(current.header.height, 48),
			`Header rhythm changed at ${viewport.width}px: ${JSON.stringify(current.header)}`);
		assert.ok(current.panel.left >= 7 && current.panel.right <= current.viewport.width - 7,
			`Window leaves ${viewport.width}px viewport: ${JSON.stringify(current)}`);
		assert.deepEqual(current.visibleOverflow, [], `Horizontal overflow at ${viewport.width}px: ${JSON.stringify(current.visibleOverflow)}`);
		assert.ok(closeEnough(current.summary.left, current.body.left) && closeEnough(current.summary.right, current.body.right),
			`Summary/card edges diverged at ${viewport.width}px: ${JSON.stringify(current)}`);
		assert.deepEqual(current.scrollOwners, ['pena-native-time-scroll'],
			`Nested scroll owner at ${viewport.width}px: ${JSON.stringify(current.scrollOwners)}`);
		assert.ok(closeEnough(current.styles.scroll.paddingLeft, viewport.width <= 680 ? 8 : 16) &&
			closeEnough(current.styles.scroll.paddingRight, viewport.width <= 680 ? 8 : 16),
			`Responsive padding is off-grid at ${viewport.width}px: ${JSON.stringify(current.styles.scroll)}`);
		assert.ok(closeEnough(current.styles.body.columnGap, 16) && closeEnough(current.styles.body.rowGap, 16),
			`Responsive body gap is off-grid at ${viewport.width}px: ${JSON.stringify(current.styles.body)}`);
		if (viewport.width <= 680) {
			assert.ok(current.activity.bottom < current.records.top, `Columns did not stack at ${viewport.width}px: ${JSON.stringify(current)}`);
			assert.ok(current.summary.height >= 103 && current.summary.height <= 105,
				`Narrow summary is not 104px at ${viewport.width}px: ${JSON.stringify(current.summary)}`);
		} else {
			assert.ok(closeEnough(current.activity.top, current.records.top), `Columns are not aligned at ${viewport.width}px: ${JSON.stringify(current)}`);
			assert.ok(closeEnough(current.activity.width, current.records.width), `Columns differ at ${viewport.width}px: ${JSON.stringify(current)}`);
			assert.ok(current.summary.height >= 79 && current.summary.height <= 81,
				`Desktop summary changed height at ${viewport.width}px: ${JSON.stringify(current.summary)}`);
		}
		if (viewport.width === 420) await page.screenshot({ path: screenshotPath });
		if (viewport.width === 360) {
			const trackedToggle = page.locator('.pena-native-time-tracked-toggle');
			if (await trackedToggle.getAttribute('aria-expanded') !== 'true') await trackedToggle.click();
			await longTaskRow.waitFor({ state: 'visible' });
			// Keep the pointer at the toggle's screen position. Whether the shorter
			// current layout needs to scroll or not, keyboard focus must own the tooltip.
			await trackedToggle.click();
			await trackedToggle.click();
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const beforeKeyboardScroll = await page.locator('.pena-native-time-scroll').evaluate(node => {
					node.scrollTop = 0;
					return node.scrollTop;
				});
				assert.equal(beforeKeyboardScroll, 0);
				await longTaskRow.focus();
				await page.waitForFunction(expected => {
					const tip = document.querySelector('.pena-native-time-title-tooltip');
					return document.activeElement?.classList?.contains('pena-native-time-task-main') &&
						!tip?.hidden && tip?.textContent === expected;
				}, longTitle);
				await page.waitForTimeout(100);
				assert.equal(await tooltip.textContent(), longTitle,
					`Keyboard auto-scroll hid the full title on repetition ${attempt + 1}`);
				assert.equal(await tooltip.isVisible(), true,
					`Keyboard tooltip disappeared after settling on repetition ${attempt + 1}`);
			}
		}
		await close(panel);
	}
	console.log(`time panel layout regression: all checks passed; screenshot ${screenshotPath}`);
} finally {
	await browser.close();
	await new Promise(resolve => server.close(resolve));
}

import assert from 'node:assert/strict';
import { createReadStream, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const extensionRoot = normalize(process.env.PENA_EXTENSION_DIR || join(root, 'extension'));
const expectedVersion = JSON.parse(readFileSync(join(extensionRoot, 'manifest.json'), 'utf8')).version;
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
	const path = pathname.startsWith('/extension/')
	  ? normalize(join(extensionRoot, pathname.slice('/extension/'.length)))
	  : normalize(join(root, pathname));
	const allowedRoot = pathname.startsWith('/extension/') ? extensionRoot : root;
	if (!path.startsWith(allowedRoot)) {
    response.writeHead(403).end();
    return;
  }
  const stream = createReadStream(path);
  stream.on('error', () => response.writeHead(404).end());
  response.writeHead(200, { 'content-type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8` });
  stream.pipe(response);
});

const listen = () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const closeServer = () => new Promise(resolve => server.close(resolve));
const readOutput = async page => {
  await page.waitForTimeout(100);
  return page.locator('#test-output').evaluate(element => JSON.parse(element.textContent || '{}'));
};
const visibleIds = page => page.evaluate(() => {
  const state = document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState;
  if (state?.view) return state.view.map(row => String(row.id || row.dialogId || ''));
  return Array.from(document.querySelectorAll('.test-host:not([hidden]) .pena-native-chat-row'))
    .filter(row => getComputedStyle(row).display !== 'none')
    .map(row => String(row.dataset.id || row.dataset.penaNativeDialogId || ''));
});
const switchMode = page => page.locator('#switch-mode').evaluate(button => button.click());
const openMarkerPalette = async row => {
	await row.click({ button: 'right' });
	const menu = page.locator('.dialog-control-context-menu');
	await menu.waitFor({ state: 'visible', timeout: 2000 });
	await menu.locator('.dialog-control-context-color-marker').click();
	const palette = page.locator('.dialog-control-palette.--open');
	await palette.waitFor({ state: 'visible', timeout: 2000 });
	return palette;
};

await listen();
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 420, height: 760 } });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

try {
	await page.goto(`${base}/tests/native-color-regression-harness.html`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
  const target = page.locator('.pena-native-managed-row[data-id="chat225"]');
  const source = page.locator('.pena-native-managed-row[data-id="chat5"]');
	const plainTarget = page.locator('.pena-native-managed-row[data-id="chat300"]');
	const plainAvatarBefore = await plainTarget.locator('.pena-native-remote-avatar').evaluate(element => element.getBoundingClientRect().left);
	let markerPalette = await openMarkerPalette(plainTarget);
	await markerPalette.locator('.dialog-control-swatch[data-color="#4d9dff"]').click();
	await page.waitForTimeout(150);
	const plainAvatarAfter = await plainTarget.locator('.pena-native-remote-avatar').evaluate(element => element.getBoundingClientRect().left);
	assert.ok(Math.abs(plainAvatarAfter - plainAvatarBefore) < 0.5, `Applying the first marker shifted an uncolored row: ${JSON.stringify({ plainAvatarBefore, plainAvatarAfter })}`);
  	const avatarLeftBefore = await target.locator('.pena-native-remote-avatar').evaluate(element => element.getBoundingClientRect().left);

  markerPalette = await openMarkerPalette(target);
	await markerPalette.locator('.dialog-control-swatch[data-color="#4d9dff"]').click();
	await page.evaluate(() => { window.nativeRowClicks = []; window.nativeRowGestures = []; });
  await page.waitForTimeout(150);
	const avatarAfterCopy = await target.evaluate(element => {
	  const avatar = element.querySelector('.pena-native-remote-avatar')?.getBoundingClientRect();
	  const row = element.getBoundingClientRect();
	  const marker = element.querySelector('.pena-native-avatar-ring');
	  const markerRect = marker?.getBoundingClientRect();
	  return {
		avatarLeft: avatar?.left || 0,
		markerWidth: markerRect?.width || 0,
		ringMatchesAvatar: !!(avatar && markerRect && Math.abs(markerRect.left - avatar.left) < .1 && Math.abs(markerRect.right - avatar.right) < .1),
		ringBorderWidth: marker ? Number.parseFloat(getComputedStyle(marker).borderTopWidth) : 0,
		markerVisible: !!marker && getComputedStyle(marker).visibility !== 'hidden' && Number(getComputedStyle(marker).opacity) > 0,
		className: element.className,
		datasetColor: element.dataset.penaNativeColor || '',
		storedColor: JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'chat225')?.color || ''
	  };
	});
	assert.ok(Math.abs(avatarAfterCopy.avatarLeft - avatarLeftBefore) < 0.5, `Avatar moved when the color marker appeared: ${JSON.stringify({ avatarLeftBefore, avatarAfterCopy })}`);
	assert.ok(avatarAfterCopy.markerWidth >= 5 && avatarAfterCopy.markerVisible, `Color marker is missing: ${JSON.stringify(avatarAfterCopy)}`);
	assert.equal(avatarAfterCopy.ringMatchesAvatar, true, `Avatar ring does not follow the avatar contour: ${JSON.stringify(avatarAfterCopy)}`);
	assert.equal(avatarAfterCopy.ringBorderWidth, 4, `Avatar ring is not contrast-weighted: ${JSON.stringify(avatarAfterCopy)}`);
  let colorState = await page.evaluate(() => ({
    items: JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]'),
    nativeClicks: [...window.nativeRowClicks],
	nativeGestures: [...window.nativeRowGestures],
    active: document.documentElement.classList.contains('pena-dialog-color-eyedropper')
  }));
  assert.equal(colorState.items.find(item => item.id === 'chat225').color, '#4d9dff');
  assert.deepEqual(colorState.nativeClicks, []);
	assert.deepEqual(colorState.nativeGestures, []);
  assert.equal(colorState.active, false);

  markerPalette = await openMarkerPalette(target);
  await markerPalette.locator('.dialog-control-swatch.--clear').click();
  await page.waitForTimeout(150);
  colorState = await page.evaluate(() => ({
	item: JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(entry => entry.id === 'chat225'),
	rowColor: document.querySelector('.pena-native-managed-row[data-id="chat225"]')?.dataset.penaNativeColor || '',
	labels: document.querySelector('.pena-native-managed-row[data-id="chat225"]')?.querySelectorAll('.pena-native-avatar-ring').length || 0
  }));
  assert.equal(colorState.item.colorMode, 'none');
	assert.equal(colorState.rowColor, '');
	assert.equal(colorState.labels, 0);

  markerPalette = await openMarkerPalette(target);
  let selection = await markerPalette.locator('.dialog-control-swatch.--active').evaluateAll(buttons => buttons.map(button => ({
    clear: button.classList.contains('--clear'),
    pressed: button.getAttribute('aria-pressed'),
    after: getComputedStyle(button, '::after').content
  })));
  assert.deepEqual(selection, [{ clear: true, pressed: 'true', after: 'none' }]);
	const dialogMarkerTools = await markerPalette.evaluate(palette => ({
		picker: !!palette.querySelector('.dialog-control-mini-picker'),
		hue: !!palette.querySelector('.dialog-control-hue-strip'),
		addIcon: palette.querySelector('.dialog-control-swatch.--add svg')?.innerHTML || '',
		clearIcon: palette.querySelector('.dialog-control-swatch.--clear .dialog-control-transparent-icon')?.outerHTML || '',
		rect: (() => { const rect = palette.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; })()
	}));
	assert.equal(dialogMarkerTools.picker, true);
	assert.equal(dialogMarkerTools.hue, true);
	assert.ok(dialogMarkerTools.addIcon && dialogMarkerTools.clearIcon);
	assert.ok(dialogMarkerTools.rect.left >= 8 && dialogMarkerTools.rect.top >= 8, `Dialog palette escaped the viewport: ${JSON.stringify(dialogMarkerTools.rect)}`);
	await page.keyboard.press('Escape');

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=tasks&legacyNativeOff=1`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
	assert.equal(
		await page.evaluate(() => localStorage.getItem('pena.dialogControlNative.v1.tasks')),
		'1',
		'Legacy native-mode=0 disabled the only remaining task control panel'
	);

  for (const mode of ['chats', 'tasks']) {
    await page.goto(`${base}/tests/native-consistency-harness.html?mode=${mode}`);
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('.test-host:not([hidden]) .pena-native-managed-viewport').length === 1);
    assert.equal(await page.locator('.test-host:not([hidden]) .pena-native-managed-viewport').count(), 1, `Default ${mode} mode did not expose the complete REST catalog`);
    let output = await readOutput(page);
    assert.equal(output.switcherCount, 1);
	assert.equal(output.version, expectedVersion);
	assert.equal(output.controlButtonCount, 0);
	assert.equal(output.filterButtonCount, 1);
	assert.equal(output.timeButtonCount, 1);
	assert.equal(output.tabCursors.group, 'pointer');
	assert.equal(output.tabCursors.folder, 'pointer');
	assert.equal(output.invalidSwitcherMounts, 0);
	assert.equal(output.avatarGeometry?.ringMatchesAvatar, true, `Avatar ring does not follow the avatar contour in ${mode}`);
	assert.equal(output.avatarGeometry?.ringBorderWidth, 4, `Avatar ring is not 4px thick in ${mode}`);
    assert.equal(output.geometry.panelOverlapsList, false);
    assert.equal(output.geometry.firstRowStartsInsideList, true);
    assert.equal(output.geometry.switcherInsideScrollViewport, false);
	await page.getByRole('button', { name: /Фильтры/ }).click();
	const filterPanel = page.locator('.pena-native-filter-panel');
	await filterPanel.waitFor({ state: 'visible' });
	const unread = filterPanel.locator('input[type="checkbox"]');
	await filterPanel.locator('.pena-native-unread-filter').click();
	assert.equal(await unread.isChecked(), true);
	const expectedUnreadIds = ['chat225', 'chat1003', 'chat1009', 'chat1015'];
	await page.waitForFunction(expected => {
		const view = document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState?.view || [];
		const ids = view.map(row => String(row.id || row.dialogId || ''));
		return ids.length === expected.length && ids.every((id, index) => id === expected[index]);
	}, expectedUnreadIds);
	assert.equal(await page.locator('.test-host:not([hidden]) .pena-native-managed-viewport').count(), 1, `Unread filter did not create one managed viewport in ${mode}`);
	assert.deepEqual(await visibleIds(page), expectedUnreadIds);
	await page.evaluate(() => {
		document.documentElement.style.minHeight = '1800px';
		document.body.style.minHeight = '1800px';
		document.body.style.overflowY = 'auto';
		window.scrollTo(0, 0);
	});
	const shortListBefore = await page.evaluate(() => ({
		pageTop: window.scrollY,
		panelTop: document.querySelector('.pena-native-folder-switcher')?.getBoundingClientRect().top || 0
	}));
	const shortListPoint = await page.locator('.test-host:not([hidden]) .pena-native-managed-row').first().evaluate(row => {
		const rect = row.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	});
	await page.mouse.move(shortListPoint.x, shortListPoint.y);
	await page.mouse.wheel(0, 900);
	await page.waitForTimeout(150);
	const shortListAfter = await page.evaluate(() => ({
		pageTop: window.scrollY,
		panelTop: document.querySelector('.pena-native-folder-switcher')?.getBoundingClientRect().top || 0,
		panels: document.querySelectorAll('.pena-native-folder-switcher').length
	}));
	assert.equal(shortListAfter.pageTop, shortListBefore.pageTop, `Wheel escaped a short managed list into the Bitrix page in ${mode}`);
	assert.ok(Math.abs(shortListAfter.panelTop - shortListBefore.panelTop) < 0.5, `Panel moved when a short list reached its boundary in ${mode}`);
	assert.equal(shortListAfter.panels, 1, `Panel disappeared after wheel on a short list in ${mode}`);
	await page.evaluate(() => {
		document.documentElement.style.removeProperty('min-height');
		document.body.style.removeProperty('min-height');
		document.body.style.removeProperty('overflow-y');
	});
	await filterPanel.locator('.pena-native-unread-filter').click();
	assert.equal(await unread.isChecked(), false);
	await page.waitForFunction(() => (document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState?.view?.length || 0) > 4);
	assert.equal(await page.locator('.test-host:not([hidden]) .pena-native-managed-viewport').count(), 1, `Clearing unread filter dropped the complete ${mode} catalog`);
	assert.ok((await visibleIds(page)).length > 2);
	const nativeDateBaseline = await visibleIds(page);
	await filterPanel.getByRole('button', { name: 'Дата', exact: true }).click();
	await filterPanel.getByRole('button', { name: 'По возрастанию', exact: true }).click();
	await page.waitForTimeout(150);
	assert.deepEqual(await visibleIds(page), [...nativeDateBaseline].reverse(), `Date ascending did not reverse the native order in ${mode}`);
	await page.locator(mode === 'tasks' ? '.task-host .pena-native-container' : '.recent-host .pena-native-container').evaluate(list => {
		list.replaceChildren(...Array.from(list.children, row => row.cloneNode(true)));
	});
	await page.waitForTimeout(500);
	await filterPanel.getByRole('button', { name: 'По убыванию', exact: true }).click();
	await page.waitForTimeout(150);
	assert.deepEqual(await visibleIds(page), nativeDateBaseline, `Date descending did not survive a Bitrix row rebuild in ${mode}`);
	await filterPanel.getByRole('button', { name: 'Цвет', exact: true }).click();
	await filterPanel.getByRole('button', { name: 'По убыванию', exact: true }).click();
	await page.waitForTimeout(150);
	const sortViewport = page.locator(mode === 'tasks' ? '.task-host .pena-native-managed-viewport' : '.recent-host .pena-native-managed-viewport');
	await sortViewport.waitFor({ state: 'visible' });
	const descColors = await page.evaluate(() => (document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState?.view || []).map(row => row.color).filter(Boolean));
	assert.deepEqual(descColors, [...descColors].sort((a, b) => b.localeCompare(a)), `Color descending did not reorder ${mode}`);
	const anchorBeforeSort = await sortViewport.evaluate(viewport => {
		const rows = Array.from(viewport.querySelectorAll('.pena-native-managed-row'));
		const target = rows[Math.max(0, Math.floor((rows.length - 1) / 2) - 1)];
		viewport.scrollTop = Math.max(0, target.offsetTop + 8);
		const viewportRect = viewport.getBoundingClientRect();
		const anchor = rows.find(row => {
			const rect = row.getBoundingClientRect();
			return rect.bottom > viewportRect.top + 1 && rect.top < viewportRect.bottom - 1;
		});
		return { id: anchor.dataset.id, offset: anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top, scrollTop: viewport.scrollTop };
	});
	await filterPanel.getByRole('button', { name: 'По возрастанию', exact: true }).click();
	await page.waitForTimeout(150);
	const anchorAfterSort = await sortViewport.evaluate((viewport, id) => {
		const anchor = viewport.querySelector(`.pena-native-managed-row[data-id="${id}"]`);
		return { id: anchor?.dataset.id || '', offset: anchor ? anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top : Number.NaN, scrollTop: viewport.scrollTop };
	}, anchorBeforeSort.id);
	assert.equal(anchorAfterSort.id, anchorBeforeSort.id, `Visible color-sort anchor disappeared in ${mode}`);
	assert.ok(
		Math.abs(anchorAfterSort.offset - anchorBeforeSort.offset) < 1 || Math.abs(anchorAfterSort.scrollTop - anchorBeforeSort.scrollTop) < 1,
		`Color direction changed both the anchor and physical scroll position in ${mode}: ${JSON.stringify({ anchorBeforeSort, anchorAfterSort })}`
	);
	const ascColors = await page.evaluate(() => (document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState?.view || []).map(row => row.color).filter(Boolean));
	assert.deepEqual(ascColors, [...ascColors].sort((a, b) => a.localeCompare(b)), `Color ascending did not reorder ${mode}`);
	await filterPanel.getByRole('button', { name: 'По убыванию', exact: true }).click();
	const prefs = await page.evaluate(currentMode => JSON.parse(localStorage.getItem(`pena.dialogControlView.${currentMode}`) || '{}'), mode);
	assert.equal(prefs.sortMode, 'color');
	assert.equal(prefs.sortDirection, 'desc');
	await page.mouse.click(410, 20);
	await filterPanel.waitFor({ state: 'detached' });
	assert.equal(await page.getByRole('button', { name: /Фильтры/ }).getAttribute('aria-expanded'), 'false');
	const beforeTimePanel = await readOutput(page);
	await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('pena.time')).forEach(key => localStorage.removeItem(key)));
	await page.locator('.pena-native-time-button').click();
	const timePanel = page.locator('.pena-native-time-panel');
	await timePanel.waitFor({ state: 'visible' });
	await page.waitForFunction(() => document.querySelector('.pena-native-time-total-value')?.textContent === '1 ч 30 мин');
	await page.waitForFunction(() => document.querySelectorAll('.pena-native-time-task-select option').length >= 2);
	await page.evaluate(() => { window.__penaTimePanelReference = document.querySelector('.pena-native-time-panel'); });
	assert.match(await timePanel.locator('.pena-native-time-meta').textContent(), /2 задачи · 2 записи/);
	assert.equal(await timePanel.locator('.pena-native-time-panel-head > .pena-native-popover-close').count(), 1, `Time panel close is not attached to the window header in ${mode}`);
	assert.equal(await timePanel.locator('.pena-native-time-summary .pena-native-popover-close').count(), 0, `Time panel close still sits under refresh in ${mode}`);
	assert.equal(await timePanel.locator('.pena-native-time-panel-title').textContent(), 'Учёт времени');
	assert.equal(await timePanel.evaluate(panel => {
		const tracker = panel.querySelector('.pena-native-time-tracker');
		const activity = panel.querySelector('.pena-native-time-suggestions');
		return !!(tracker && activity && (tracker.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING));
	}), true, `Primary tracker is not placed before secondary activity in ${mode}`);
	const trackerOptions = await timePanel.locator('.pena-native-time-task-select option').evaluateAll(options => options.map(option => ({ value: option.value, title: option.textContent?.trim() || '' })));
	assert.ok(trackerOptions.every(option => /^\d+$/.test(option.value) && option.title && !/^(Выберите задачу|Сначала откройте задачу|Задача #\d+)$/.test(option.title)), `Tracker contains a placeholder instead of real tasks in ${mode}: ${JSON.stringify(trackerOptions)}`);
	assert.equal(await timePanel.locator('input[type="date"]').count(), 0);
	assert.equal(await timePanel.getByText('Трекинг сейчас', { exact: true }).count(), 0);
	assert.equal(await timePanel.getByText('Без запуска таймера', { exact: true }).count(), 0);
	assert.equal(await timePanel.locator('.pena-native-time-manual-hours').getAttribute('type'), 'text');
	assert.equal(await timePanel.locator('.pena-native-time-manual-minutes').getAttribute('type'), 'text');
	const durationFieldColors = await timePanel.evaluate(panel => {
		const hours = panel.querySelector('.pena-native-time-manual-hours');
		const minutes = panel.querySelector('.pena-native-time-manual-minutes');
		return {
			hours: getComputedStyle(hours).color,
			hoursPlaceholder: getComputedStyle(hours, '::placeholder').color,
			minutes: getComputedStyle(minutes).color,
			minutesPlaceholder: getComputedStyle(minutes, '::placeholder').color
		};
	});
	assert.equal(durationFieldColors.hours, durationFieldColors.minutes, `Hour and minute values use different colors in ${mode}`);
	assert.equal(durationFieldColors.hoursPlaceholder, durationFieldColors.hours, `Empty hour field looks different from an entered value in ${mode}`);
	assert.equal(durationFieldColors.minutesPlaceholder, durationFieldColors.minutes, `Empty minute field looks different from an entered value in ${mode}`);
	const compactTimePanel = await timePanel.evaluate(panel => ({
		width: panel.getBoundingClientRect().width,
		gap: getComputedStyle(panel).gap,
		overflowY: getComputedStyle(panel).overflowY,
		scrollbarGutter: getComputedStyle(panel).scrollbarGutter,
		refreshPaths: panel.querySelectorAll('.pena-native-time-refresh svg path').length,
		refreshBorder: getComputedStyle(panel.querySelector('.pena-native-time-refresh')).borderTopWidth
	}));
	assert.ok(compactTimePanel.width <= 340, `Time panel stayed oversized in ${mode}: ${JSON.stringify(compactTimePanel)}`);
	assert.equal(compactTimePanel.gap, '6px');
	assert.equal(compactTimePanel.overflowY, 'auto');
	assert.match(compactTimePanel.scrollbarGutter, /stable/);
	assert.equal(compactTimePanel.refreshPaths, 2, `Refresh icon was not replaced in ${mode}`);
	assert.equal(compactTimePanel.refreshBorder, '0px', `Refresh control kept the old boxed appearance in ${mode}`);
	const callsBeforeTimeoutRetry = await page.evaluate(() => window.timeRestCalls.length);
	await page.evaluate(() => {
		window.timeListTimeoutFailures = 1;
		document.querySelector('.pena-native-time-refresh')?.click();
	});
	await page.waitForFunction(previous => window.timeRestCalls.length >= previous + 2 && !document.querySelector('.pena-native-time-panel')?.classList.contains('--loading'), callsBeforeTimeoutRetry);
	assert.equal(await timePanel.locator('.pena-native-time-error').isHidden(), true, `A recovered Bitrix timeout remained visible in ${mode}`);
	assert.equal(await timePanel.locator('.pena-native-time-total-value').textContent(), '1 ч 30 мин', `A recovered Bitrix timeout broke the time summary in ${mode}`);
	await page.waitForFunction(() => document.querySelector('.pena-native-toast.--show')?.textContent?.includes('Обновлено · 1 ч 30 мин · 2 задачи'));
	const timeFonts = await timePanel.evaluate(panel => ({
		ui: getComputedStyle(panel).fontFamily,
		accent: getComputedStyle(panel.querySelector('.pena-native-time-total-value')).fontFamily,
		tech: getComputedStyle(panel.querySelector('.pena-native-time-tracker-duration')).fontFamily
	}));
	assert.match(timeFonts.ui, /Onest Variable/);
	assert.match(timeFonts.accent, /Unbounded Variable/);
	assert.match(timeFonts.tech, /Consolas/);
	const trackedToggle = timePanel.locator('.pena-native-time-tracked-toggle');
	assert.match(await trackedToggle.textContent(), /Учтено · 2/);
	await trackedToggle.click();
	await page.waitForFunction(() => document.querySelectorAll('.pena-native-time-tracked-list .pena-native-time-task-row').length === 2);
	assert.deepEqual(await timePanel.locator('.pena-native-time-tracked-list .pena-native-time-task-title').allTextContents(), ['Задача 101', 'Задача 102']);
	const manualToggle = timePanel.locator('.pena-native-time-manual-toggle');
	assert.equal(await timePanel.locator('.pena-native-time-manual').isHidden(), true, `Manual controls were expanded by default in ${mode}`);
	await manualToggle.click();
	assert.equal(await manualToggle.getAttribute('aria-expanded'), 'true');
	const manualSearch = timePanel.locator('.pena-native-time-manual-search');
	assert.equal(await timePanel.locator('.pena-native-time-manual-results .pena-native-time-manual-result').count(), 0, 'Manual entry exposed recommendations before search');
	await page.evaluate(() => { window.timeTaskSearchFailures = 2; });
	await manualSearch.fill('Задача без совпадений');
	await timePanel.locator('.pena-native-time-manual-search-status').getByText('Поиск недоступен. Повторите', { exact: true }).waitFor({ state: 'visible', timeout: 3000 });
	assert.equal(await timePanel.locator('.pena-native-time-manual-error').isHidden(), true, `Task search error is duplicated below the form in ${mode}`);
	await manualSearch.fill('Задача 405');
	await page.waitForTimeout(400);
	assert.equal(await timePanel.locator('.pena-native-time-manual-result').filter({ hasText: 'Задача 405' }).count(), 0, 'Manual search exposed a task with disabled time tracking');
	await page.evaluate(() => { window.timeTaskSearchFailures = 2; });
	await manualSearch.fill('Задача 101');
	const manualTaskResult = timePanel.locator('.pena-native-time-manual-result').filter({ hasText: 'Задача 101' });
	await manualTaskResult.waitFor({ state: 'visible', timeout: 3000 });
	const searchLayout = await timePanel.evaluate(panel => {
		const results = panel.querySelector('.pena-native-time-manual-results');
		const fields = panel.querySelector('.pena-native-time-manual-fields');
		return { position: getComputedStyle(results).position, resultsBottom: results.getBoundingClientRect().bottom, fieldsTop: fields.getBoundingClientRect().top };
	});
	assert.equal(searchLayout.position, 'static', `Task search results still float over the form in ${mode}`);
	assert.ok(searchLayout.resultsBottom <= searchLayout.fieldsTop + 0.5, `Task search results overlap duration fields in ${mode}: ${JSON.stringify(searchLayout)}`);
	await manualTaskResult.click();
	assert.match(await timePanel.locator('.pena-native-time-manual-selected').textContent(), /Задача 101/);
	await timePanel.locator('.pena-native-time-manual-hours').fill('1');
	await timePanel.locator('.pena-native-time-manual-minutes').fill('15');
	await timePanel.locator('.pena-native-time-manual-submit').click();
	await page.waitForFunction(() => document.querySelector('.pena-native-time-total-value')?.textContent === '2 ч 45 мин');
	assert.equal(await page.evaluate(() => Number(window.timeAddCalls[0]?.ARFIELDS?.SECONDS || 0)), 4500, `Manual duration was not saved in ${mode}`);
	await manualToggle.click();
	assert.equal(await timePanel.locator('.pena-native-time-manual').isHidden(), true, `Manual entry could not return to its collapsed state in ${mode}`);
	await page.evaluate(() => window.dispatchNativeSidePanelTask('404'));
	await page.waitForTimeout(250);
	const sidePanelTouch = await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeVisitedTasks.v1.'));
		return JSON.parse(localStorage.getItem(key) || '[]').find(item => item.taskId === '404') || null;
	});
	assert.equal(sidePanelTouch?.visits, 0, `Opening a SidePanel task counted as work in ${mode}: ${JSON.stringify(sidePanelTouch)}`);
	assert.equal(await timePanel.locator('.pena-native-time-suggestions-list .pena-native-time-task-row').filter({ hasText: 'Задача 404' }).count(), 0, 'A quick task open entered suggestions');
	await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeVisitedTasks.v1.'));
		const activities = JSON.parse(localStorage.getItem(key) || '[]');
		const task = activities.find(item => item.taskId === '404');
		task.activeSeconds = 61;
		task.visits = 1;
		task.sessionQualified = true;
		task.lastQualifiedAt = Date.now();
		task.lastQualificationReason = 'duration';
		localStorage.setItem(key, JSON.stringify(activities));
		document.querySelector('.pena-native-time-refresh')?.click();
	});
	await page.waitForFunction(() => Array.from(document.querySelectorAll('.pena-native-time-suggestions-list .pena-native-time-task-title')).some(node => node.textContent === 'Задача 404'), null, { timeout: 7000 });
	const qualifiedSidePanelTouch = await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeVisitedTasks.v1.'));
		return JSON.parse(localStorage.getItem(key) || '[]').find(item => item.taskId === '404') || null;
	});
	assert.equal(qualifiedSidePanelTouch?.visits, 1, `One active minute did not qualify exactly one touch in ${mode}: ${JSON.stringify(qualifiedSidePanelTouch)}`);
	await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeVisitedTasks.v1.'));
		const activities = JSON.parse(localStorage.getItem(key) || '[]');
		const task = activities.find(item => item.taskId === '404');
		task.visits = 4;
		task.activeSeconds = 540;
		task.lastQualifiedAt = Date.now();
		task.lastQualificationReason = 'duration';
		localStorage.setItem(key, JSON.stringify(activities));
		window.timeListFailures = 1;
		window.dispatchNativeSidePanelTask('404');
	});
	const estimated = timePanel.locator('.pena-native-time-suggestions-list .pena-native-time-task-row').filter({ hasText: 'Задача 404' });
	await page.waitForFunction(() => document.querySelector('.pena-native-time-suggestions-list .pena-native-time-task-detail')?.textContent.includes('4 касания'));
	assert.match(await estimated.locator('.pena-native-time-task-detail').textContent(), /4 касания · ≈ 10 мин/);
	await estimated.locator('.pena-native-time-estimate-edit').click();
	await estimated.locator('.pena-native-time-estimate-minutes').fill('99');
	await estimated.locator('.pena-native-time-estimate-cancel').click();
	await page.waitForFunction(() => !document.querySelector('.pena-native-time-estimate-minutes'));
	assert.equal(await page.evaluate(() => window.timeAddCalls.length), 1, `Cancelling estimate correction wrote time in ${mode}`);
	await estimated.locator('.pena-native-time-estimate-edit').click();
	await estimated.locator('.pena-native-time-estimate-minutes').fill('17');
	await estimated.locator('.pena-native-time-estimate-save').click();
	await page.waitForFunction(() => !Array.from(document.querySelectorAll('.pena-native-time-suggestions-list .pena-native-time-task-title')).some(node => node.textContent === 'Задача 404'));
	assert.equal(await page.evaluate(() => Number(window.timeAddCalls.at(-1)?.ARFIELDS?.SECONDS || 0)), 1020, `Corrected automatic estimate was not recorded in ${mode}`);
	await page.evaluate(() => window.dispatchNativeSidePanelTask('405'));
	await page.waitForTimeout(200);
	assert.equal(await timePanel.locator('.pena-native-time-suggestions-list .pena-native-time-task-row').filter({ hasText: 'Задача 405' }).count(), 0, 'Task with disabled time tracking entered suggestions');
	assert.equal(await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeVisitedTasks.v1.'));
		return JSON.parse(localStorage.getItem(key) || '[]').some(item => item.taskId === '405');
	}), false, 'Task with disabled time tracking was persisted as work');
	await page.evaluate(() => document.querySelector('.test-host:not([hidden]) [data-id="chat5"]')?.click());
	if (mode === 'tasks') {
		await page.waitForTimeout(200);
		assert.equal(await timePanel.locator('.pena-native-time-suggestions-list .pena-native-time-task-row').filter({ hasText: 'Чат 5' }).count(), 0, 'Opening a task chat counted as work');
		await page.evaluate(() => window.dispatchNativeTaskMessage('chat5'));
		try {
			await page.waitForFunction(() => Array.from(document.querySelectorAll('.pena-native-time-suggestions-list .pena-native-time-task-title')).some(node => node.textContent === 'Чат 5'), null, { timeout: 5000 });
		} catch (error) {
			const diagnostic = await page.evaluate(() => ({
				events: Object.fromEntries(Array.from(window.nativeCustomEventHandlers || [], ([name, handlers]) => [name, handlers.length])),
				storage: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('pena.time'))),
				suggestions: Array.from(document.querySelectorAll('.pena-native-time-suggestions-list .pena-native-time-task-title'), node => node.textContent),
				mode: window.__PENA_NATIVE_PREFETCH__?.status?.().mode,
				restCalls: window.nativeRestCalls
			}));
			throw new Error(`Outgoing task message was not qualified: ${JSON.stringify(diagnostic)}; ${error.message}`);
		}
		const taskChatActivity = timePanel.locator('.pena-native-time-suggestions-list .pena-native-time-task-row').filter({ hasText: 'Чат 5' });
		assert.equal(await taskChatActivity.locator('.pena-native-time-estimate-add').count(), 1, 'A task chat did not expose one-click time accounting');
		assert.match(await taskChatActivity.locator('.pena-native-time-task-detail').textContent(), /касание · ≈ 5 мин/);
	} else {
		await page.evaluate(() => window.dispatchNativeTaskMessage('chat5'));
		await page.waitForTimeout(250);
		assert.equal(await timePanel.locator('.pena-native-time-suggestions-list .pena-native-time-task-row').filter({ hasText: 'Чат 5' }).count(), 0, 'An ordinary chat entered time activity');
		assert.equal(await page.evaluate(() => {
			const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeVisitedTasks.v1.'));
			return JSON.parse(localStorage.getItem(key) || '[]').some(item => item.dialogId === 'chat5' || !item.taskId);
		}), false, 'An ordinary chat was persisted as time activity');
	}
	const touchesBeforeMultiSelect = await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeVisitedTasks.v1.'));
		return JSON.parse(localStorage.getItem(key) || '[]').find(item => item.dialogId === 'chat5' && item.taskId)?.visits || 0;
	});
	await page.locator('.test-host:not([hidden]) .pena-native-managed-row[data-id="chat5"]').dispatchEvent('click', { ctrlKey: true, button: 0 });
	await page.waitForTimeout(100);
	assert.equal(await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeVisitedTasks.v1.'));
		return JSON.parse(localStorage.getItem(key) || '[]').find(item => item.dialogId === 'chat5' && item.taskId)?.visits || 0;
	}), touchesBeforeMultiSelect, `Multi-select click was counted as work in ${mode}`);
	await page.evaluate(() => document.querySelector('.pena-native-group-tab')?.click());
	await page.waitForTimeout(100);
	assert.equal(await timePanel.isVisible(), true, `Time panel closed during a native switcher refresh in ${mode}`);
	assert.equal(await page.evaluate(() => window.__penaTimePanelReference === document.querySelector('.pena-native-time-panel')), true, `Time panel DOM was replaced and could flicker in ${mode}`);
	await page.evaluate(() => {
		const link = document.createElement('a');
		link.href = '/company/personal/user/7/tasks/task/view/303/';
		link.textContent = 'Задача 303';
		link.addEventListener('click', event => event.preventDefault());
		document.body.appendChild(link);
		link.click();
		link.remove();
	});
	await page.waitForFunction(() => Array.from(document.querySelectorAll('.pena-native-time-task-select option')).some(option => option.value === '303'));
	assert.equal(await timePanel.locator('.pena-native-time-suggestions-list .pena-native-time-task-row').filter({ hasText: 'Задача 303' }).count(), 0, 'Opening a task link counted as work');
	await timePanel.locator('.pena-native-time-task-select').first().selectOption('303');
	await timePanel.locator('.pena-native-time-start').click();
	await page.waitForFunction(() => document.querySelector('.pena-native-time-tracker')?.classList.contains('--active'));
	await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeActiveTracker.v1.'));
		const tracker = JSON.parse(localStorage.getItem(key) || 'null');
		tracker.startedAt = Date.now() - 61000;
		localStorage.setItem(key, JSON.stringify(tracker));
		window.timeAddFailures = 1;
	});
	await page.waitForTimeout(1100);
	await timePanel.locator('.pena-native-time-stop').click();
	await page.waitForFunction(() => document.querySelector('.pena-native-time-stop')?.textContent === 'Повторить');
	assert.equal(await page.evaluate(() => window.timeAddCalls.length), 3, `Failed elapsed-item write was not attempted in ${mode}`);
	assert.ok(await page.evaluate(() => !!Object.keys(localStorage).find(key => key.startsWith('pena.timeActiveTracker.v1.'))), `Failed timer was lost in ${mode}`);
	const cancelTracker = timePanel.locator('.pena-native-time-cancel');
	await cancelTracker.click();
	await page.waitForFunction(() => document.querySelector('.pena-native-time-cancel')?.textContent === 'Сбросить?');
	assert.equal(await cancelTracker.textContent(), 'Сбросить?', `Timer cancellation has no confirmation in ${mode}`);
	assert.ok(await page.evaluate(() => !!Object.keys(localStorage).find(key => key.startsWith('pena.timeActiveTracker.v1.'))), `First cancel click discarded unsaved time in ${mode}`);
	await cancelTracker.click();
	await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('pena.timeActiveTracker.v1.')) && !document.querySelector('.pena-native-time-start')?.hidden);
	assert.equal(await page.evaluate(() => window.timeAddCalls.length), 3, `Cancelling retry performed another write in ${mode}`);
	await timePanel.locator('.pena-native-time-task-select').first().selectOption('303');
	await timePanel.locator('.pena-native-time-start').click();
	await page.evaluate(() => {
		const key = Object.keys(localStorage).find(candidate => candidate.startsWith('pena.timeActiveTracker.v1.'));
		const tracker = JSON.parse(localStorage.getItem(key) || 'null');
		tracker.startedAt = Date.now() - 61000;
		localStorage.setItem(key, JSON.stringify(tracker));
		window.timeAddFailures = 1;
	});
	await timePanel.locator('.pena-native-time-stop').click();
	await page.waitForFunction(() => document.querySelector('.pena-native-time-stop')?.textContent === 'Повторить');
	await timePanel.locator('.pena-native-time-stop').click();
	await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('pena.timeActiveTracker.v1.')) && document.querySelector('.pena-native-time-tracked-label')?.textContent.includes('3'));
	const addState = await page.evaluate(() => ({ calls: window.timeAddCalls.length, seconds: Number(window.timeAddCalls.at(-1)?.ARFIELDS?.SECONDS || 0) }));
	assert.equal(addState.calls, 5, `Elapsed-item retry did not complete in ${mode}`);
	assert.ok(addState.seconds >= 60, `Elapsed-item duration was truncated in ${mode}: ${JSON.stringify(addState)}`);
	await trackedToggle.click();
	if (await timePanel.locator('.pena-native-time-tracked-list').isHidden()) await trackedToggle.click();
	const firstTrackedDelete = timePanel.locator('.pena-native-time-tracked-list .pena-native-time-task-row').filter({ hasText: 'Задача 101' }).locator('.pena-native-time-row-delete');
	await firstTrackedDelete.click();
	await page.waitForFunction(() => Array.from(document.querySelectorAll('.pena-native-time-row-delete')).some(button => button.textContent?.includes('Точно')));
	assert.match(await firstTrackedDelete.textContent(), /Точно/);
	await firstTrackedDelete.click();
	await page.waitForFunction(() => window.timeDeletedItems.length > 0);
	assert.equal(await page.evaluate(() => String(window.timeDeletedItems[0]?.ITEMID || '')), 'time-1', 'Unified panel did not delete the elapsed record');
	const duringTimePanel = await readOutput(page);
	assert.ok(Math.abs(duringTimePanel.avatarGeometry.avatarLeft - beforeTimePanel.avatarGeometry.avatarLeft) < 0.5, `Time popover shifted avatars in ${mode}`);
	await timePanel.locator('.pena-native-popover-close').click();
	await timePanel.waitFor({ state: 'detached' });
	const markerBaseline = await readOutput(page);
	const rerenderStartedAt = Date.now();
	for (let rerender = 0; rerender < 8; rerender += 1) {
	  await page.locator('.pena-native-group-tab').first().click();
	}
	try {
	  await page.waitForFunction(() => document.querySelectorAll('.test-host:not([hidden]) .pena-native-managed-row').length > 0, undefined, { timeout: 5000 });
	} catch (error) {
	  const diagnostic = await page.evaluate(() => ({
		mode: new URLSearchParams(location.search).get('mode'),
		prefs: JSON.parse(localStorage.getItem(`pena.dialogControlView.${new URLSearchParams(location.search).get('mode')}`) || '{}'),
		recent: window.__PENA_RECENT_SYNC__ || null,
		managed: window.__PENA_MANAGED_DEBUG__ || null,
		viewports: document.querySelectorAll('.test-host:not([hidden]) .pena-native-managed-viewport').length,
		rows: document.querySelectorAll('.test-host:not([hidden]) .pena-native-managed-row').length,
		panels: document.querySelectorAll('.pena-native-folder-switcher').length
	  }));
	  throw new Error(`Managed list did not recover after rerenders: ${JSON.stringify(diagnostic)}; ${error.message}`);
	}
	assert.ok(Date.now() - rerenderStartedAt < 1000, `Managed list recovered too slowly after rerenders in ${mode}`);
	const markerStable = await readOutput(page);
	assert.ok(Math.abs(markerStable.avatarGeometry.avatarLeft - markerBaseline.avatarGeometry.avatarLeft) < 0.5, `Avatar shifted after rerenders in ${mode}`);
	assert.ok(Math.abs(markerStable.avatarGeometry.ringLeft - markerBaseline.avatarGeometry.ringLeft) < 0.5, `Avatar ring shifted after rerenders in ${mode}`);
	const managedSelectionState = await page.evaluate(() => ({
		rows: document.querySelectorAll('.test-host:not([hidden]) .pena-native-managed-row').length,
		viewports: document.querySelectorAll('.test-host:not([hidden]) .pena-native-managed-viewport').length,
		nativeRows: document.querySelectorAll('.test-host:not([hidden]) .pena-native-chat-row').length,
		activeGroup: document.querySelector('.test-host:not([hidden]) .pena-native-group-tab.--active')?.textContent || '',
		activeFolder: document.querySelector('.test-host:not([hidden]) .pena-native-folder-tab.--active')?.textContent || '',
		prefs: JSON.parse(localStorage.getItem(`pena.dialogControlView.${new URLSearchParams(location.search).get('mode')}`) || '{}'),
		recentSync: window.__PENA_RECENT_SYNC__ || null,
		managedDebug: window.__PENA_MANAGED_DEBUG__ || null
	}));
	assert.ok(managedSelectionState.rows > 0, `Managed rows disappeared before selection in ${mode}: ${JSON.stringify(managedSelectionState)}`);
	const selectedRowSelector = mode === 'tasks' ? '.task-host .pena-native-managed-row' : '.recent-host .pena-native-managed-row';
	const selectedProbe = await page.evaluate(selector => {
		const row = document.querySelector(selector);
		const avatar = row?.querySelector('.test-avatar,.pena-native-remote-avatar');
		window.__PENA_TEST_SELECTED_ROW__ = row || null;
		return {
			avatarLeft: avatar ? avatar.getBoundingClientRect().left : Number.NaN,
			rowHtml: row?.outerHTML?.slice(0, 1200) || '',
			managedDebug: window.__PENA_MANAGED_DEBUG__ || null
		};
	}, selectedRowSelector);
	const selectedAvatarBefore = selectedProbe.avatarLeft;
	assert.ok(Number.isFinite(selectedAvatarBefore), `Managed row has no avatar before selection in ${mode}: ${JSON.stringify(selectedProbe)}`);
	await page.evaluate(selector => document.querySelector(selector)?.classList.add('is-selected'), selectedRowSelector);
	await page.waitForTimeout(80);
	const selectedState = await page.evaluate(selector => {
		const row = document.querySelector(selector);
		const avatar = row?.querySelector('.test-avatar,.pena-native-remote-avatar');
		return {
			avatarLeft: avatar ? avatar.getBoundingClientRect().left : Number.NaN,
			stableRow: row === window.__PENA_TEST_SELECTED_ROW__,
			selected: !!row?.classList.contains('is-selected')
		};
	}, selectedRowSelector);
	assert.equal(selectedState.stableRow, true, `Managed row was remounted without a data or viewport change in ${mode}`);
	assert.equal(selectedState.selected, true, `Managed row lost its selected state in ${mode}`);
	const selectedAvatarAfter = selectedState.avatarLeft;
	assert.ok(Math.abs(selectedAvatarAfter - selectedAvatarBefore) < 0.5, `Avatar shifted when the dialog became active in ${mode}`);
	await page.evaluate(selector => document.querySelector(selector)?.classList.remove('is-selected'), selectedRowSelector);
	await page.waitForTimeout(80);
	const selectedAvatarRestored = await page.evaluate(selector => document.querySelector(selector)?.querySelector('.test-avatar,.pena-native-remote-avatar')?.getBoundingClientRect().left ?? Number.NaN, selectedRowSelector);
	assert.ok(Math.abs(selectedAvatarRestored - selectedAvatarBefore) < 0.5, `Avatar stayed shifted after leaving the dialog in ${mode}`);
	const viewport = page.locator(mode === 'tasks' ? '.task-host .pena-native-managed-viewport' : '.recent-host .pena-native-managed-viewport');
	const panel = page.locator(mode === 'tasks' ? '.task-host .pena-native-folder-switcher' : '.recent-host .pena-native-folder-switcher');
	const panelTopBeforeScroll = await panel.evaluate(node => node.getBoundingClientRect().top);
	await viewport.evaluate(node => { node.scrollTop = 0; });
	await page.locator(mode === 'tasks' ? '.task-host .pena-native-managed-row' : '.recent-host .pena-native-managed-row').first().hover();
	await page.mouse.wheel(0, 320);
	await page.waitForTimeout(100);
	const managedWheelState = await viewport.evaluate(node => ({
		scrollTop: node.scrollTop,
		scrollHeight: node.scrollHeight,
		clientHeight: node.clientHeight
	}));
	assert.ok(Math.abs(managedWheelState.scrollTop - 320) < 1, `A wheel gesture was lost or applied more than once in ${mode}: ${JSON.stringify(managedWheelState)}`);
	const panelTopAfterScroll = await panel.evaluate(node => node.getBoundingClientRect().top);
	assert.ok(Math.abs(panelTopAfterScroll - panelTopBeforeScroll) < 0.5, `Folder panel moved with chat scroll in ${mode}`);
	const wheelCanceled = await page.locator(mode === 'tasks' ? '.task-host .pena-native-managed-row' : '.recent-host .pena-native-managed-row').first().evaluate(row => !row.dispatchEvent(new WheelEvent('wheel', {
	  bubbles: true,
	  cancelable: true,
	  deltaY: 120
	})));
	assert.equal(wheelCanceled, false, `Wheel was blocked before the managed chat viewport could scroll in ${mode}`);
  }

  await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats`);
  await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
  await page.locator('.recent-host input[type="search"]').fill('Чат 225');
  await page.waitForTimeout(250);
  assert.deepEqual(await visibleIds(page), ['chat225']);
	await switchMode(page);
  await page.locator('.task-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 3000 });
  await page.locator('.task-host input[type="search"]').fill('Чат 5');
  await page.waitForTimeout(250);
  assert.deepEqual(await visibleIds(page), ['chat5']);
  await page.locator('.task-host input[type="search"]').fill('');
	await page.waitForTimeout(900);
	const clearedIds = await visibleIds(page);
	assert.ok(clearedIds.length > 2, `Clearing task search left only: ${clearedIds.join(', ')}`);

  for (let index = 0; index < 12; index += 1) {
	await switchMode(page);
    await page.waitForTimeout(80);
  }
	await page.waitForFunction(() => {
		try {
			const state = JSON.parse(document.getElementById('test-output')?.textContent || '{}');
			return state.switcherCount === 1 && state.visibleSwitcherCount === 1 && state.switcherInActiveHost === true;
		} catch { return false; }
	}, null, { timeout: 3000 });
  const switched = await readOutput(page);
  assert.equal(switched.switcherCount, 1);
  assert.equal(switched.visibleSwitcherCount, 1);
  assert.equal(switched.switcherMaxCount, 1);
  assert.equal(switched.filterPanelReplacements, 0);
	assert.equal(switched.invalidSwitcherMounts, 0);
	assert.equal(switched.switcherMounting, false);
	assert.equal(switched.switcherInActiveHost, true);

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&transition=1`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
	for (let index = 0; index < 6; index += 1) {
	  await switchMode(page);
	  await page.waitForTimeout(350);
	}
	const transitioned = await readOutput(page);
	assert.equal(transitioned.switcherCount, 1);
	assert.equal(transitioned.visibleSwitcherCount, 1);
	assert.equal(transitioned.switcherMaxCount, 1);
	assert.equal(transitioned.invalidSwitcherMounts, 0);
	assert.equal(transitioned.mountingLayoutFrames, 0);
	assert.equal(transitioned.panelShiftFrames, 0, 'Folder panel changed its top position during mode switches');
	assert.equal(transitioned.switcherMounting, false);
	assert.equal(transitioned.switcherInActiveHost, true);

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&wide=1&transform=1`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
	const wideHost = await readOutput(page);
	assert.equal(wideHost.invalidSwitcherMounts, 0);
	assert.equal(wideHost.geometry.switcherInsideScrollViewport, false);
	assert.equal(wideHost.geometry.panelOverlapsList, false);
	const wideRows = await page.locator('.recent-host').evaluate(host => {
	  const viewport = host.querySelector('.pena-native-managed-viewport');
	  const root = host.querySelector('.pena-native-managed-list');
	  const viewportRect = viewport.getBoundingClientRect();
	  const rows = Array.from(root?.querySelectorAll('.pena-native-managed-row') || []);
	  return {
		rootInsideViewport: root?.parentElement === viewport,
		widest: Math.max(0, ...rows.map(row => row.getBoundingClientRect().width)),
		listWidth: viewportRect.width,
		legacyRemoteHost: host.querySelectorAll('.pena-native-remote-list').length
	  };
	});
	assert.equal(wideRows.rootInsideViewport, true, 'Managed chat list escaped the Bitrix scroll viewport');
	assert.equal(wideRows.legacyRemoteHost, 0, 'Detached full-width chat layer returned');
	assert.ok(wideRows.widest <= wideRows.listWidth + 0.5, `A chat row exceeded the native list width: ${JSON.stringify(wideRows)}`);

  await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&short=1&transform=1`);
  await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
  const shortWheel = await page.locator('.recent-host .pena-native-managed-row').first().evaluate(row => {
	const viewport = row.closest('.pena-native-managed-viewport');
	const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
	const dispatched = row.dispatchEvent(event);
	return {
	  canceled: !dispatched,
	  defaultPrevented: event.defaultPrevented,
	  viewportConnected: !!viewport?.isConnected,
	  clientHeight: viewport?.clientHeight || 0,
	  scrollHeight: viewport?.scrollHeight || 0,
	  scrollTop: viewport?.scrollTop || 0,
	  rowCount: viewport?.querySelectorAll('.pena-native-managed-row').length || 0,
	  debug: window.__PENA_MANAGED_DEBUG__ || null
	};
  });
  assert.equal(shortWheel.canceled, true, `Wheel escaped a short managed chat list: ${JSON.stringify(shortWheel)}`);

  await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&clone=1`);
  await page.waitForTimeout(700);
  assert.equal((await readOutput(page)).switcherCount, 1);

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&relocate=1`);
	await page.waitForTimeout(1200);
	const relocated = await readOutput(page);
	assert.equal(relocated.switcherCount, 1);
	assert.equal(relocated.switcherMounting, false, `Relocated panel did not recover: ${JSON.stringify(relocated)}`);
	assert.equal(relocated.switcherInActiveHost, true);

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&duplicate=1`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
	const duplicateLists = await readOutput(page);
	assert.equal(duplicateLists.switcherCount, 1);
	assert.equal(duplicateLists.switcherInActiveHost, true, `Panel stayed in a stale duplicate host: ${JSON.stringify(duplicateLists)}`);
	assert.equal(duplicateLists.activeMode, 'chats');

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&nativeFirst=1&repositoryCache=1&restDelay=300`);
	await page.locator('.recent-host .pena-native-chat-row[data-id="chat225"]').waitFor({ state: 'visible', timeout: 5000 });
	await page.waitForTimeout(450);
	const warmCacheMaterialization = await page.evaluate(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.() || {};
		return {
			loadedModes: status.loadedModes || [],
			originalActive: !!status.originalActive,
			overlays: document.querySelectorAll('.pena-native-original-load-guard,.pena-native-load-guard:not([hidden])').length,
			recentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length
		};
	});
	assert.equal(warmCacheMaterialization.loadedModes.includes('chats'), false, `Persisted completeness was mistaken for current-document materialization: ${JSON.stringify(warmCacheMaterialization)}`);
	assert.equal(warmCacheMaterialization.originalActive, true, `Fresh metadata cache skipped the required one-time native materialization: ${JSON.stringify(warmCacheMaterialization)}`);
	assert.equal(warmCacheMaterialization.overlays, 1, `One-time native materialization has no visible progress state: ${JSON.stringify(warmCacheMaterialization)}`);
	assert.equal(warmCacheMaterialization.recentCalls, 1, `Cold document did not run exactly one complete metadata audit: ${JSON.stringify(warmCacheMaterialization)}`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive;
	}, null, { timeout: 20000 });
	const materializedOnce = await page.evaluate(() => ({
		count: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		loadedAt: window.__PENA_NATIVE_PREFETCH__?.status?.().modeLoadedAt?.chats || 0,
		seededAt: window.__repositorySeedLoadedAt || 0,
		recentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length,
		loops: window.__PENA_NATIVE_SCROLL_DEBUG__?.loops || 0
	}));
	assert.ok(materializedOnce.count > 2 && materializedOnce.loadedAt >= materializedOnce.seededAt, `Native session catalog did not replace the small persisted window: ${JSON.stringify(materializedOnce)}`);
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await page.waitForTimeout(500);
	const afterWarmFocus = await page.evaluate(() => ({
		active: window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive || false,
		count: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		loops: window.__PENA_NATIVE_SCROLL_DEBUG__?.loops || 0
	}));
	assert.deepEqual(afterWarmFocus, { active: false, count: materializedOnce.count, loops: materializedOnce.loops }, `Focus restarted a fresh session traversal: ${JSON.stringify({ materializedOnce, afterWarmFocus })}`);

	await page.evaluate(() => {
		localStorage.removeItem('pena.nativeSearchQuery.v1.chats');
		localStorage.removeItem('pena.nativeSearchQuery.v1.tasks');
	});
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&lazy=1&initialTop=32&restDelay=2500&autofocus=1&nativeQuery=${encodeURIComponent('Старый запрос Bitrix')}`);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true, null, { timeout: 12000 });
	assert.equal(
		await page.locator('.recent-host input[type="search"]').evaluate(input => document.activeElement === input),
		false,
		'Bitrix search kept startup autofocus after PENA mounted'
	);
	assert.equal(await page.evaluate(() => window.nativeSearchRuns), 0, 'PENA dispatched into native Bitrix search during startup');
	assert.equal(await page.locator('.recent-host input[type="search"]').inputValue(), '', 'PENA adopted a stale native Bitrix query on startup');
	assert.equal(
		await page.locator('.recent-host').evaluate(host => host.classList.contains('native-search-active')),
		false,
		'Bitrix stayed in visual search mode after PENA removed startup autofocus'
	);
	const originalLoader = await page.locator('.recent-host .pena-native-original-load-guard').evaluate(guard => {
		const card = guard.querySelector('.pena-native-load-card');
		const outer = guard.getBoundingClientRect();
		const inner = card.getBoundingClientRect();
		const host = guard.parentElement?.getBoundingClientRect();
		return {
			heading: guard.querySelector('.pena-native-load-heading')?.textContent || '',
			copyCount: guard.querySelectorAll('.pena-native-load-copy').length,
			value: guard.querySelector('.pena-native-load-value')?.textContent || '',
			animationName: getComputedStyle(guard.querySelector('.pena-native-load-progress>span')).animationName,
			ariaNow: guard.querySelector('.pena-native-load-progress')?.getAttribute('aria-valuenow') || '',
			progressRatio: (() => {
				const track = guard.querySelector('.pena-native-load-progress');
				const bar = track?.querySelector('span');
				return track && bar && track.clientWidth ? bar.getBoundingClientRect().width / track.clientWidth : -1;
			})(),
			topOffset: inner.top - outer.top,
			coverageDelta: host ? Math.max(
				Math.abs(outer.left - host.left), Math.abs(outer.right - host.right),
				Math.abs(outer.top - host.top), Math.abs(outer.bottom - host.bottom)
			) : Infinity
		};
	});
	assert.equal(originalLoader.heading, 'Прогрузка диалогов');
	assert.equal(originalLoader.copyCount, 0, `Loader still contains descriptive copy: ${JSON.stringify(originalLoader)}`);
	assert.ok(originalLoader.value === '…' || /^\d+%$/.test(originalLoader.value), `Loader has an invalid value: ${JSON.stringify(originalLoader)}`);
	if (originalLoader.value === '…') {
		assert.match(originalLoader.animationName, /pena-native-load-indeterminate/, `Unknown catalog size has no moving line: ${JSON.stringify(originalLoader)}`);
		assert.equal(originalLoader.ariaNow, '', `Unknown catalog size exposed a false numeric ARIA value: ${JSON.stringify(originalLoader)}`);
	} else {
		assert.equal(originalLoader.animationName, 'none', `Known catalog size kept an indeterminate animation: ${JSON.stringify(originalLoader)}`);
		assert.equal(originalLoader.ariaNow, originalLoader.value.replace('%', ''), `Loader ARIA progress diverges from its label: ${JSON.stringify(originalLoader)}`);
		assert.ok(originalLoader.progressRatio >= 0 && originalLoader.progressRatio <= 1, `Loader line is not determinate: ${JSON.stringify(originalLoader)}`);
	}
	assert.ok(originalLoader.topOffset >= 60 && originalLoader.topOffset <= 90, `Original-list loader is not near the top: ${JSON.stringify(originalLoader)}`);
	assert.ok(originalLoader.coverageDelta < 1, `Original-list blur does not cover its panel: ${JSON.stringify(originalLoader)}`);
	const resizedLoader = await page.locator('.recent-host .pena-native-original-load-guard').evaluate(async guard => {
		const host = guard.parentElement;
		const previous = { width: host.style.width, height: host.style.height, flex: host.style.flex };
		host.style.width = '340px';
		host.style.height = '520px';
		host.style.flex = '0 0 520px';
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const outer = guard.getBoundingClientRect();
		const hostRect = host.getBoundingClientRect();
		const coverageDelta = Math.max(
			Math.abs(outer.left - hostRect.left), Math.abs(outer.right - hostRect.right),
			Math.abs(outer.top - hostRect.top), Math.abs(outer.bottom - hostRect.bottom)
		);
		host.style.width = previous.width;
		host.style.height = previous.height;
		host.style.flex = previous.flex;
		return { coverageDelta, outerWidth: outer.width, outerHeight: outer.height, hostWidth: hostRect.width, hostHeight: hostRect.height };
	});
	assert.ok(resizedLoader.coverageDelta < 1, `Original-list blur did not follow live resize: ${JSON.stringify(resizedLoader)}`);
	await page.evaluate(() => localStorage.setItem('pena.dialogControlView.chats', JSON.stringify({ sortMode: 'date', sortDirection: 'asc', unreadOnly: false })));
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.loadedModes?.includes('chats') && status.originalActive === false;
		}, null, { timeout: 8000 });
	} catch (error) {
		const diagnostic = await page.evaluate(() => ({
			prefetch: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			sync: window.__PENA_RECENT_SYNC__ || null,
			scroll: window.__PENA_NATIVE_SCROLL_DEBUG__ || null
		}));
		throw new Error(`Initial original-list loading did not finish: ${JSON.stringify(diagnostic)}; ${error.message}`);
	}
	await page.locator('.recent-host .pena-native-chat-row[data-id="chat225"]').waitFor({ state: 'visible', timeout: 5000 });
	const originalOrder = await page.evaluate(() => {
		const dates = new Map(JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]')
			.filter(item => item.type !== 'folder')
			.map(item => [item.id, Number(item.addedAt) || 0]));
		return Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row'))
			.map(row => row.dataset.id)
			.sort((a, b) => (dates.get(b) || 0) - (dates.get(a) || 0));
	});
	const passThrough = await page.locator('.recent-host').evaluate(host => {
		const sourceViewport = host.querySelector('.bx-im-list-container-recent__scroll-container');
		const row = host.querySelector('.pena-native-chat-row[data-id="chat225"]');
		const content = row?.querySelector('.bx-im-list-recent-item__container');
		return {
			managed: host.querySelectorAll('.pena-native-managed-viewport').length,
			sourceHidden: sourceViewport?.classList.contains('pena-native-source-viewport-hidden'),
			sourceTop: sourceViewport?.scrollTop || 0,
			sourceHeight: sourceViewport?.scrollHeight || 0,
			sourceClientHeight: sourceViewport?.clientHeight || 0,
			visibleRows: Array.from(host.querySelectorAll('.pena-native-chat-row')).filter(row => getComputedStyle(row).display !== 'none').length,
			visibleIds: Array.from(host.querySelectorAll('.pena-native-chat-row')).filter(row => getComputedStyle(row).display !== 'none').map(row => row.dataset.id),
			searchValue: host.querySelector('input[type="search"]')?.value || '',
			storedSearch: localStorage.getItem('pena.nativeSearchQuery.v1.chats') || '',
			overflowY: sourceViewport ? getComputedStyle(sourceViewport).overflowY : '',
			scrollbarWidth: sourceViewport ? (getComputedStyle(sourceViewport).scrollbarWidth || 'auto') : '',
			baseline: window.nativeScrollbarBaseline?.chats || null,
			scrollAudit: (window.nativeScrollAudit || []).filter(entry => entry.key === 'chats'),
			originalAvatars: host.querySelectorAll('.test-avatar').length,
			generatedAvatars: host.querySelectorAll('.pena-native-remote-avatar').length,
			marker: !!row?.querySelector('.pena-native-avatar-ring'),
			ringGeometry: (() => {
				const avatar = row?.querySelector('.test-avatar')?.getBoundingClientRect();
				const ring = row?.querySelector('.pena-native-avatar-ring')?.getBoundingClientRect();
				return avatar && ring ? {
					matches: Math.max(
						Math.abs(ring.left - avatar.left), Math.abs(ring.right - avatar.right),
						Math.abs(ring.top - avatar.top), Math.abs(ring.bottom - avatar.bottom)
					) < 0.1,
					squareDelta: Math.abs(ring.width - ring.height),
					centerDelta: Math.max(
						Math.abs((ring.left + ring.width / 2) - (avatar.left + avatar.width / 2)),
						Math.abs((ring.top + ring.height / 2) - (avatar.top + avatar.height / 2))
					)
				} : null;
			})(),
			contentPaddingLeft: content ? getComputedStyle(content).paddingLeft : ''
		};
	});
	assert.equal(passThrough.managed, 0, `Native mode created a replacement list: ${JSON.stringify(passThrough)}`);
	assert.equal(passThrough.sourceHidden, false, `Native Bitrix viewport was hidden: ${JSON.stringify(passThrough)}`);
	assert.equal(passThrough.sourceTop, passThrough.baseline.top, `Catalog loading changed the native Bitrix scroll position: ${JSON.stringify(passThrough)}`);
	assert.equal(passThrough.overflowY, passThrough.baseline.overflowY, `Native scrollbar overflow mode was overwritten: ${JSON.stringify(passThrough)}`);
	assert.notEqual(passThrough.scrollbarWidth, 'none', `Native scrollbar was hidden: ${JSON.stringify(passThrough)}`);
	assert.ok(passThrough.scrollAudit.filter(entry => entry.top !== passThrough.baseline.top).every(entry => entry.loader), `A mechanical scroll position was exposed without the loader: ${JSON.stringify(passThrough.scrollAudit)}`);
	assert.ok(passThrough.originalAvatars > 0, `Original Bitrix avatars disappeared: ${JSON.stringify(passThrough)}`);
	assert.equal(passThrough.generatedAvatars, 0, `Extension generated avatar placeholders: ${JSON.stringify(passThrough)}`);
	assert.equal(passThrough.marker, true, `Color marker was not overlaid on the original row: ${JSON.stringify(passThrough)}`);
	assert.equal(passThrough.ringGeometry?.matches, true, `Color ring does not follow the original avatar contour: ${JSON.stringify(passThrough)}`);
	assert.ok(passThrough.ringGeometry?.squareDelta < 0.1, `Color marker is oval instead of circular: ${JSON.stringify(passThrough)}`);
	assert.ok(passThrough.ringGeometry?.centerDelta < 0.1, `Color ring is not centered on the original avatar: ${JSON.stringify(passThrough)}`);
	assert.equal(passThrough.contentPaddingLeft, '2px', `Color marker changed Bitrix row layout: ${JSON.stringify(passThrough)}`);
	const nativeSearch = page.locator('.recent-host input[type="search"]');
	const nativeSearchRunsBefore = await page.evaluate(() => window.nativeSearchRuns);
	await nativeSearch.fill('Чат 225');
	await page.waitForFunction(() => {
		const visible = Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row')).filter(row => getComputedStyle(row).display !== 'none');
		return visible.length === 1 && visible[0].dataset.id === 'chat225';
	}, null, { timeout: 3000 });
	const searchedMarker = await page.locator('.recent-host .pena-native-chat-row[data-id="chat225"]').evaluate(row => {
		const avatar = row.querySelector('.test-avatar')?.getBoundingClientRect();
		const ring = row.querySelector('.pena-native-avatar-ring')?.getBoundingClientRect();
		return {
			originalAvatar: !!row.querySelector('.test-avatar'),
			marker: !!ring,
			nativeFormatting: row.classList.contains('pena-native-chat-row') && !!row.querySelector('.bx-im-list-recent-item__container'),
			geometryDelta: avatar && ring ? Math.max(
				Math.abs(ring.left - avatar.left), Math.abs(ring.right - avatar.right),
				Math.abs(ring.top - avatar.top), Math.abs(ring.bottom - avatar.bottom)
			) : Infinity
		};
	});
	assert.deepEqual(searchedMarker, {
		originalAvatar: true,
		marker: true,
		nativeFormatting: true,
		geometryDelta: 0
	}, `Search stripped the native row or its color marker: ${JSON.stringify(searchedMarker)}`);
	await nativeSearch.fill('Чат 5');
	await page.waitForFunction(() => {
		const visible = Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row')).filter(row => getComputedStyle(row).display !== 'none');
		return visible.length === 1 && visible[0].dataset.id === 'chat5';
	}, null, { timeout: 3000 });
	assert.equal(await page.evaluate(() => window.nativeSearchRuns), nativeSearchRunsBefore, 'Bitrix search received the PENA query');
	await page.locator('#dispatch-wheel').click();
	await page.waitForFunction(() => {
		const input = document.querySelector('.recent-host input[type="search"]');
		const visible = Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row')).filter(row => getComputedStyle(row).display !== 'none');
		return input?.value === 'Чат 5' && visible.length === 1 && visible[0].dataset.id === 'chat5';
	}, null, { timeout: 1000 });
	assert.deepEqual(await visibleIds(page), ['chat5'], 'Clicking outside cleared the isolated PENA search');
	await page.locator('.recent-host .pena-native-chat-row[data-id="chat5"]').click();
	await page.waitForFunction(() => document.querySelector('.recent-host input[type="search"]')?.value === 'Чат 5', null, { timeout: 1000 });
	assert.deepEqual(await visibleIds(page), ['chat5'], 'Opening a dialog cleared the isolated PENA search filter');
	await page.reload();
	await page.waitForFunction(() => {
		const input = document.querySelector('.recent-host input[type="search"]');
		const visible = Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row')).filter(row => getComputedStyle(row).display !== 'none');
		return input?.value === 'Чат 5' && visible.length === 1 && visible[0].dataset.id === 'chat5';
	}, null, { timeout: 8000 });
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === false, null, { timeout: 8000 });
	await page.evaluate(() => localStorage.setItem('pena.dialogControlView.chats', JSON.stringify({ sortMode: 'date', sortDirection: 'asc', unreadOnly: false })));
	await page.locator('#dispatch-wheel').click();
	await page.waitForFunction(() => {
		const input = document.querySelector('.recent-host input[type="search"]');
		const visible = Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row')).filter(row => getComputedStyle(row).display !== 'none');
		return input?.value === 'Чат 5' && visible.length === 1 && visible[0].dataset.id === 'chat5' && localStorage.getItem('pena.nativeSearchQuery.v1.chats') === 'Чат 5';
	}, null, { timeout: 3000 });
	const nativeRunsAfterReload = await page.evaluate(() => window.nativeSearchRuns);
	await nativeSearch.click();
	await nativeSearch.press('Control+A');
	await nativeSearch.press('Backspace');
	await page.waitForFunction(() => (localStorage.getItem('pena.nativeSearchQuery.v1.chats') || '') === '', null, { timeout: 3000 });
	await page.waitForFunction(() => Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row')).filter(row => getComputedStyle(row).display !== 'none').length > 2, null, { timeout: 3000 });
	assert.equal(await page.evaluate(() => window.nativeSearchRuns), nativeRunsAfterReload, 'Bitrix search received the PENA clear event');
	await page.locator('.recent-host .pena-native-chat-row[data-id="chat5"]').click({ modifiers: ['Control'] });
	await page.locator('.recent-host .pena-native-chat-row[data-id="chat77"]').click({ modifiers: ['Control'] });
	const multiSelectAppearance = await page.locator('.recent-host .pena-native-chat-row.--native-multi-selected').evaluateAll(rows => rows.map(row => {
		const rowStyle = getComputedStyle(row);
		const content = row.querySelector('.bx-im-list-recent-item__container,.bx-im-list-item__container,.bx-messenger-cl-item-wrap');
		const contentStyle = content ? getComputedStyle(content) : null;
		return {
			rowBackground: rowStyle.backgroundImage,
			rowBackgroundColor: rowStyle.backgroundColor,
			contentBackground: contentStyle?.backgroundImage || '',
			contentBackgroundColor: contentStyle?.backgroundColor || '',
			boxShadow: rowStyle.boxShadow
		};
	}));
	assert.equal(multiSelectAppearance.length, 2, `Native multiselect did not retain two rows: ${JSON.stringify(multiSelectAppearance)}`);
	assert.ok(multiSelectAppearance.every(state => state.rowBackground === 'none' && (!state.contentBackground || state.contentBackground === 'none')), `Native multiselect still paints a gradient: ${JSON.stringify(multiSelectAppearance)}`);
	assert.ok(multiSelectAppearance.every(state => state.rowBackgroundColor === 'rgba(0, 0, 0, 0)' && (!state.contentBackgroundColor || state.contentBackgroundColor === 'rgba(0, 0, 0, 0)')), `Native multiselect still paints a fill: ${JSON.stringify(multiSelectAppearance)}`);
	assert.ok(multiSelectAppearance.every(state => state.boxShadow !== 'none'), `Native multiselect lost its outline: ${JSON.stringify(multiSelectAppearance)}`);
	await page.keyboard.press('Escape');
	await page.waitForFunction(() => !document.querySelector('.recent-host .pena-native-chat-row.--native-multi-selected'));
	const ascendingOrder = await page.locator('.recent-host .pena-native-chat-row').evaluateAll(rows => rows.map(row => row.dataset.id));
	const ascendingDates = await page.evaluate(ids => {
		const dates = new Map(JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]')
			.filter(item => item.type !== 'folder')
			.map(item => [item.id, Number(item.addedAt) || 0]));
		return ids.map(id => dates.get(id) || 0);
	}, ascendingOrder);
	assert.ok(ascendingDates.every((date, index) => index === 0 || ascendingDates[index - 1] <= date), `Saved ascending sort is not chronological after lazy rows appeared: ${JSON.stringify({ originalOrder, ascendingOrder, ascendingDates })}`);
	await page.getByRole('button', { name: /Фильтры/ }).click();
	await page.locator('.recent-host [data-pena-sort-direction="desc"]').click();
	await page.waitForFunction(() => {
		const dates = new Map(JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]')
			.filter(item => item.type !== 'folder')
			.map(item => [item.id, Number(item.addedAt) || 0]));
		const values = Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row')).map(row => dates.get(row.dataset.id) || 0);
		return values.length > 2 && values.every((date, index) => index === 0 || values[index - 1] >= date);
	}, null, { timeout: 3000 });
	const sortStress = await page.evaluate(async () => {
		const viewport = document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container');
		const list = document.querySelector('.recent-host .bx-im-list-container-recent__elements');
		const initialTop = viewport.scrollTop;
		const expectedIds = Array.from(list.querySelectorAll('.pena-native-chat-row')).map(row => row.dataset.id).sort();
		const snapshots = [];
		for (let index = 0; index < 24; index += 1) {
			const mode = index % 2 ? 'date' : 'color';
			const direction = index % 3 ? 'asc' : 'desc';
			document.querySelector(`.recent-host [data-pena-sort-mode="${mode}"]`)?.click();
			document.querySelector(`.recent-host [data-pena-sort-direction="${direction}"]`)?.click();
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			const ids = Array.from(list.querySelectorAll('.pena-native-chat-row')).map(row => row.dataset.id);
			snapshots.push({ top: viewport.scrollTop, ids: ids.slice().sort(), unique: new Set(ids).size });
		}
		return { initialTop, expectedIds, snapshots };
	});
	assert.ok(sortStress.snapshots.every(snapshot => snapshot.top === sortStress.initialTop), `Sort stress moved native scrollTop: ${JSON.stringify(sortStress)}`);
	assert.ok(sortStress.snapshots.every(snapshot => snapshot.unique === sortStress.expectedIds.length && JSON.stringify(snapshot.ids) === JSON.stringify(sortStress.expectedIds)), `Sort stress lost or duplicated rows: ${JSON.stringify(sortStress)}`);
	await page.locator('.recent-host [data-pena-sort-mode="color"]').click();
	await page.locator('.recent-host [data-pena-sort-direction="asc"]').click();
	await page.evaluate(() => window.__PENA_NATIVE_PREFETCH__.runOriginal());
	await page.locator('.recent-host [data-pena-sort-mode="date"]').click();
	await page.locator('.recent-host [data-pena-sort-direction="desc"]').click();
	await page.waitForFunction(() => {
		const dates = new Map(JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]')
			.filter(item => item.type !== 'folder')
			.map(item => [item.id, Number(item.addedAt) || 0]));
		const values = Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row')).map(row => dates.get(row.dataset.id) || 0);
		return values.length > 2 && values.every((date, index) => index === 0 || values[index - 1] >= date);
	}, null, { timeout: 3000 });
	const reloadedDateOrder = await page.locator('.recent-host .pena-native-chat-row').evaluateAll(rows => rows.map(row => row.dataset.id));
	assert.equal(new Set(reloadedDateOrder).size, reloadedDateOrder.length, `Repeated loading duplicated rows: ${JSON.stringify({ originalOrder, reloadedDateOrder })}`);
	await page.getByRole('button', { name: /Фильтры/ }).click();
	await page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Тестовая папка' }).click();
	await page.waitForFunction(() => {
		const rows = Array.from(document.querySelectorAll('.recent-host .pena-native-chat-row'));
		const visible = rows.filter(row => getComputedStyle(row).display !== 'none').map(row => row.dataset.id);
		return visible.length === 1 && visible[0] === 'chat225';
	}, null, { timeout: 3000 });
	assert.equal(await page.locator('.recent-host .pena-native-chat-row[data-id="chat225"] .pena-native-avatar-ring').count(), 1, 'Folder-colored dialog lost its avatar ring');
	const originalRow = page.locator('.recent-host .pena-native-chat-row[data-id="chat225"]');
	await originalRow.click({ button: 'right' });
	const penaContextMenu = page.locator('.dialog-control-context-menu');
	await penaContextMenu.waitFor({ state: 'visible', timeout: 2000 });
	assert.equal(await page.evaluate(() => window.nativeContextMenus), 0, 'Default right click leaked into the Bitrix menu');
	await penaContextMenu.locator('.dialog-control-context-original').click();
	await page.locator('#bitrix-native-menu').waitFor({ state: 'visible', timeout: 2000 });
	assert.equal(await page.evaluate(() => window.nativeContextMenus), 1, 'Embedded original-menu action did not open Bitrix context menu');

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && status.originalActive === false;
	}, null, { timeout: 8000 });
	const rootColorRow = page.locator('.recent-host .pena-native-chat-row[data-id="chat5"]');
	await rootColorRow.click({ button: 'right' });
	assert.equal(await page.locator('.dialog-control-context-menu .dialog-control-context-colors').count(), 0, 'Root dialog still exposes color controls');
	await page.locator('.dialog-control-context-menu .dialog-control-context-folder').filter({ hasText: 'Тестовая папка' }).click();
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'chat5')?.folderId === 'folder:test');
	const dialogColorPalette = await openMarkerPalette(rootColorRow);
	const currentDialogTools = await dialogColorPalette.evaluate(palette => ({
		picker: !!palette.querySelector('.dialog-control-mini-picker'),
		hue: !!palette.querySelector('.dialog-control-hue-strip'),
		addIcon: palette.querySelector('.dialog-control-swatch.--add svg')?.innerHTML || '',
		clearIcon: palette.querySelector('.dialog-control-swatch.--clear .dialog-control-transparent-icon')?.outerHTML || ''
	}));
	assert.deepEqual(currentDialogTools, {
		picker: dialogMarkerTools.picker,
		hue: dialogMarkerTools.hue,
		addIcon: dialogMarkerTools.addIcon,
		clearIcon: dialogMarkerTools.clearIcon
	}, 'Dialog marker controls changed between managed and original Bitrix rows');
	await dialogColorPalette.locator('.dialog-control-swatch[data-color="#4d9dff"]').click();
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'chat5')?.color === '#4d9dff');
	await rootColorRow.click({ button: 'right' });
	await page.locator('.dialog-control-context-menu .dialog-control-context-folder').filter({ hasText: 'Без папки' }).click();
	await page.waitForFunction(() => {
		const item = JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(candidate => candidate.id === 'chat5');
		return item && !item.folderId && item.color === undefined && item.colorMode === undefined;
	});
	await page.waitForFunction(() => !document.querySelector('.recent-host .pena-native-chat-row[data-id="chat5"] .pena-native-avatar-ring'));
	assert.equal(await rootColorRow.locator('.pena-native-avatar-ring').count(), 0, 'Dialog marker stayed after removing the folder');
	await rootColorRow.click({ button: 'right' });
	assert.equal(await page.locator('.dialog-control-context-menu .dialog-control-context-colors').count(), 0, 'Color controls stayed after removing the folder');
	await page.keyboard.press('Escape');
	const folderTab = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Тестовая папка' });
	await folderTab.click({ button: 'right' });
	await page.locator('.dialog-control-context-folder-color').click();
	const folderColorGrid = page.locator('.dialog-control-palette.--open');
	await folderColorGrid.waitFor({ state: 'visible', timeout: 2000 });
	const folderMarkerTools = await folderColorGrid.evaluate(palette => ({
		picker: !!palette.querySelector('.dialog-control-mini-picker'),
		hue: !!palette.querySelector('.dialog-control-hue-strip'),
		addIcon: palette.querySelector('.dialog-control-swatch.--add svg')?.innerHTML || '',
		clearIcon: palette.querySelector('.dialog-control-swatch.--clear .dialog-control-transparent-icon')?.outerHTML || ''
	}));
	assert.deepEqual(currentDialogTools, folderMarkerTools, 'Dialog and folder marker panels use different controls or icons');
	await folderColorGrid.locator('.dialog-control-swatch[data-color="#5dc87e"]').click();
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'folder:test')?.color === '#5dc87e');

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&segments=1`);
	await page.locator('.recent-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 3000 });
	const commonFolderTab = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Все папки' });
	const movableFolderTab = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Тестовая папка' });
	const targetGroupTab = page.locator('.recent-host .pena-native-group-tab').filter({ hasText: 'Целевая группа' });
	assert.equal(await commonFolderTab.getAttribute('draggable'), 'false', 'The common All folders tab became draggable');
	assert.equal(await movableFolderTab.getAttribute('draggable'), 'true', 'A user folder cannot be dragged from All');
	await movableFolderTab.dragTo(targetGroupTab);
	await page.waitForFunction(() => {
		const items = JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]');
		return items.find(item => item.id === 'folder:test')?.segmentId === 'segment:target' &&
			items.find(item => item.id === 'chat225')?.segmentId === 'segment:target';
	});
	await targetGroupTab.click();
	const movedFolderTab = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Тестовая папка' });
	await movedFolderTab.waitFor({ state: 'visible', timeout: 2000 });
	await movedFolderTab.dragTo(page.locator('.recent-host .pena-native-group-tab').filter({ hasText: /^Все/ }));
	await page.waitForFunction(() => {
		const items = JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]');
		return !items.find(item => item.id === 'folder:test')?.segmentId &&
			!items.find(item => item.id === 'chat225')?.segmentId;
	});

	const openStripContextMenu = async selector => {
		await page.locator(selector).evaluate(element => {
			const rect = element.getBoundingClientRect();
			element.dispatchEvent(new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: Math.max(rect.left + 2, rect.right - 2),
				clientY: rect.top + Math.max(2, rect.height / 2)
			}));
		});
		await page.locator('.dialog-control-context-menu').waitFor({ state: 'visible', timeout: 2000 });
	};
	const submitNativePrompt = async (value, actionLabel) => {
		const prompt = page.locator('.pena-native-confirm-overlay');
		await prompt.waitFor({ state: 'visible', timeout: 2000 });
		await prompt.locator('.pena-native-confirm-input').fill(value);
		await prompt.getByRole('button', { name: actionLabel, exact: true }).click();
	};

	await openStripContextMenu('.recent-host .pena-native-group-tabs');
	await page.locator('.dialog-control-context-menu').getByRole('menuitem', { name: 'Создать группу', exact: true }).click();
	await submitNativePrompt('Проверочная группа', 'Создать');
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('pena.dialogControlSegments.v1.chats') || '[]')
		.some(segment => segment.title === 'Проверочная группа'));
	let createdGroupTab = page.locator('.recent-host .pena-native-group-tab').filter({ hasText: 'Проверочная группа' });
	await createdGroupTab.click({ button: 'right' });
	await page.locator('.dialog-control-context-menu').getByRole('menuitem', { name: 'Переименовать', exact: true }).click();
	await submitNativePrompt('Группа после проверки', 'Сохранить');
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('pena.dialogControlSegments.v1.chats') || '[]')
		.some(segment => segment.title === 'Группа после проверки'));
	createdGroupTab = page.locator('.recent-host .pena-native-group-tab').filter({ hasText: 'Группа после проверки' });
	await createdGroupTab.click({ button: 'right' });
	await page.locator('.dialog-control-context-menu').getByRole('menuitem', { name: 'Удалить группу', exact: true }).click();
	await page.locator('.pena-native-confirm-overlay').getByRole('button', { name: 'Удалить', exact: true }).click();
	await page.waitForFunction(() => !JSON.parse(localStorage.getItem('pena.dialogControlSegments.v1.chats') || '[]')
		.some(segment => segment.title === 'Группа после проверки'));

	await openStripContextMenu('.recent-host .pena-native-folder-tabs');
	await page.locator('.dialog-control-context-menu').getByRole('menuitem', { name: 'Создать папку', exact: true }).click();
	await submitNativePrompt('Проверочная папка', 'Создать');
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]')
		.some(item => item.type === 'folder' && item.title === 'Проверочная папка'));
	let createdFolderTab = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Проверочная папка' });
	await createdFolderTab.click({ button: 'right' });
	await page.locator('.dialog-control-context-menu').getByRole('menuitem', { name: 'Переименовать', exact: true }).click();
	await submitNativePrompt('Папка после проверки', 'Сохранить');
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]')
		.some(item => item.type === 'folder' && item.title === 'Папка после проверки'));
	createdFolderTab = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Папка после проверки' });
	await createdFolderTab.click({ button: 'right' });
	await page.locator('.dialog-control-context-menu').getByRole('menuitem', { name: 'Удалить папку', exact: true }).click();
	await page.locator('.pena-native-confirm-overlay').getByRole('button', { name: 'Удалить', exact: true }).click();
	await page.waitForFunction(() => !JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]')
		.some(item => item.type === 'folder' && item.title === 'Папка после проверки'));

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&passThrough=1&pendingControl=1`);
	await page.waitForFunction(() => window.nativeRestCalls?.some(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9000'), null, { timeout: 8000 });
	await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.controlledPendingCount === 0 && !window.__PENA_RECENT_SYNC__?.detailsInFlight, null, { timeout: 8000 });
	const resolvedNativeStatus = await page.locator('.recent-host .pena-native-sync-chip').evaluate(chip => ({ text: chip.textContent, className: chip.className }));
	assert.doesNotMatch(resolvedNativeStatus.className, /--warning/, `Native mandatory-dialog loading stayed unresolved: ${JSON.stringify(resolvedNativeStatus)}`);
	assert.match(resolvedNativeStatus.className, /--ready/, `Resolved native list was not marked ready: ${JSON.stringify(resolvedNativeStatus)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=120&lazyChunk=8&lazyDelay=20&initialTop=32`);
	await page.locator('.recent-host .pena-native-original-load-guard').waitFor({ state: 'visible', timeout: 3000 });
	const nativeFirstProgressSamples = [];
	for (let index = 0; index < 3; index += 1) {
		nativeFirstProgressSamples.push(String(await page.locator('.recent-host .pena-native-original-load-guard .pena-native-load-value').textContent()).trim());
		await page.waitForTimeout(60);
	}
	assert.ok(nativeFirstProgressSamples.every(value => /^\d+%$/.test(value)),
		`Native loader lost numeric progress: ${JSON.stringify(nativeFirstProgressSamples)}`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive;
	}, null, { timeout: 8000 });
	const nativeFirstChats = await page.evaluate(() => ({
		rows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
		modeCount: window.__PENA_NATIVE_PREFETCH__.status().modeCounts.chats || 0,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		imRecentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length,
		taskCalls: window.nativeRestCalls.filter(call => call.method === 'tasks.task.list').length,
		progress: window.__PENA_RECENT_SYNC__?.percent,
		duration: Math.max(0, Number(window.__PENA_RECENT_SYNC__?.completedAt) - Number(window.__PENA_RECENT_SYNC__?.startedAt))
	}));
	assert.ok(nativeFirstChats.rows >= 120 && nativeFirstChats.modeCount >= 120,
		`Native-first loading did not materialize old chat rows: ${JSON.stringify(nativeFirstChats)}`);
	assert.equal(nativeFirstChats.sourceTop, 32, `Native-first loading moved the user's chat scroll position: ${JSON.stringify(nativeFirstChats)}`);
	assert.ok(nativeFirstChats.imRecentCalls > 0, `Cold native source did not obtain its complete metadata baseline: ${JSON.stringify(nativeFirstChats)}`);
	assert.ok(nativeFirstChats.taskCalls > 0 && nativeFirstChats.duration < 6000,
		`Native-first loading missed the fast startup path: ${JSON.stringify(nativeFirstChats)}`);
	const nativeFirstDateBaseline = await visibleIds(page);
	assert.ok(nativeFirstDateBaseline.length >= 120, `Date sort baseline omitted old native dialogs: ${nativeFirstDateBaseline.length}`);
	await page.getByRole('button', { name: /Фильтры/ }).click();
	const nativeFirstFilterPanel = page.locator('.recent-host .pena-native-filter-panel');
	await nativeFirstFilterPanel.getByRole('button', { name: 'Дата', exact: true }).click();
	await nativeFirstFilterPanel.getByRole('button', { name: 'По возрастанию', exact: true }).click();
	await page.waitForTimeout(180);
	assert.deepEqual(await visibleIds(page), [...nativeFirstDateBaseline].reverse(), 'Production native date sort did not include the full materialized list');
	await nativeFirstFilterPanel.getByRole('button', { name: 'По убыванию', exact: true }).click();
	await page.waitForTimeout(180);
	assert.deepEqual(await visibleIds(page), nativeFirstDateBaseline, 'Production native date sort did not restore descending order');
	assert.equal(await page.locator('.recent-host .bx-im-list-container-recent__scroll-container').evaluate(viewport => viewport.scrollTop), 32,
		'Production date sorting moved the native viewport');
	await page.mouse.click(410, 20);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=80&lazyChunk=100&lazyDelay=3500&initialTop=28&startupBudget=10000`);
	await page.locator('.recent-host .pena-native-original-load-guard').waitFor({ state: 'visible', timeout: 3000 });
	await page.waitForTimeout(2400);
	const delayedColdInterim = await page.evaluate(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.() || {};
		return {
			rows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
			modeCount: status.modeCounts?.chats || 0,
			loaded: status.loadedModes?.includes('chats') === true,
			active: status.originalActive === true
		};
	});
	assert.equal(delayedColdInterim.loaded, false,
		`Cold delayed page was certified before it arrived: ${JSON.stringify(delayedColdInterim)}`);
	assert.equal(delayedColdInterim.active, true,
		`Cold delayed page lost its guarded traversal: ${JSON.stringify(delayedColdInterim)}`);
	assert.ok(delayedColdInterim.rows < 83 && delayedColdInterim.modeCount < 83,
		`Cold delayed fixture completed before its 3500ms page: ${JSON.stringify(delayedColdInterim)}`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const rows = document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length;
		return status?.loadedModes?.includes('chats') && !status.originalActive && rows === 83 && status.modeCounts?.chats === 83;
	}, null, { timeout: 10000 });
	const delayedColdFinal = await page.evaluate(() => ({
		rows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
		ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort(),
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		expectedCatalog: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.expectedCatalog || null,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		duration: Math.max(0, Number(window.__PENA_RECENT_SYNC__?.completedAt) - Number(window.__PENA_RECENT_SYNC__?.startedAt)),
		bottom: window.__PENA_NATIVE_BOTTOM_DEBUG__ || null
	}));
	assert.equal(delayedColdFinal.rows, 83, `Cold delayed page lost native IDs: ${JSON.stringify(delayedColdFinal)}`);
	assert.deepEqual(delayedColdFinal.ids, ['chat225', 'chat5', 'chat77', ...Array.from({ length: 80 }, (_, index) => `chat${1000 + index}`)].sort(),
		`Cold delayed page did not materialize the exact native ID set: ${JSON.stringify(delayedColdFinal)}`);
	assert.equal(delayedColdFinal.modeCount, 83, `Cold delayed page published a partial generation: ${JSON.stringify(delayedColdFinal)}`);
	assert.ok(delayedColdFinal.expectedCatalog?.complete && delayedColdFinal.expectedCatalog?.count === 83 &&
		Number(delayedColdFinal.expectedCatalog?.auditedAt) > 0 && Number(delayedColdFinal.expectedCatalog?.sourceGeneration) > 0,
		`Cold delayed page lacked a scoped complete baseline: ${JSON.stringify(delayedColdFinal)}`);
	assert.equal(delayedColdFinal.sourceTop, 28, `Cold delayed page moved the user anchor: ${JSON.stringify(delayedColdFinal)}`);
	assert.ok(delayedColdFinal.duration < 10000, `Cold delayed page exceeded the startup target: ${JSON.stringify(delayedColdFinal)}`);
	assert.ok(delayedColdFinal.bottom?.cold && delayedColdFinal.bottom?.stable && delayedColdFinal.bottom?.expectedProof &&
		delayedColdFinal.bottom?.expectedCount === 83 && delayedColdFinal.bottom?.missingExpectedCount === 0 &&
		delayedColdFinal.bottom?.seenCount === 83,
	`Cold delayed page lacked conservative bottom proof: ${JSON.stringify(delayedColdFinal)}`);
	const delayedColdSearch = page.locator('.recent-host input[type="search"]');
	await delayedColdSearch.fill('Заполнитель 80');
	await page.waitForFunction(() => {
		const row = document.querySelector('.recent-host [data-id="chat1079"]');
		return row && getComputedStyle(row).display !== 'none';
	});
	await delayedColdSearch.fill('');
	await page.getByRole('button', { name: /Фильтры/ }).click();
	const delayedColdFilterPanel = page.locator('.recent-host .pena-native-filter-panel');
	await delayedColdFilterPanel.getByRole('button', { name: 'Дата', exact: true }).click();
	await delayedColdFilterPanel.getByRole('button', { name: 'По возрастанию', exact: true }).click();
	await page.waitForTimeout(180);
	assert.equal((await visibleIds(page))[0], 'chat1079', 'Oldest delayed dialog is not reachable through chronological sorting');
	await page.mouse.click(410, 20);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=80&lazyChunk=100&lazyDelay=3500&restDelay=1200&counterFailAfterLive=1&repositoryCache=1&repositorySchema2NoProof=1&repositoryEmpty=1&initialTop=28&startupBudget=10000`);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true);
	await page.waitForTimeout(1550);
	assert.equal(await page.evaluate(() => window.applyNativeLiveRecentUpdate('chat1079')), true,
		'Delayed-audit fixture could not publish its live head update');
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.loadedModes?.includes('chats') && !status.originalActive && status.modeCounts?.chats === 83;
		}, null, { timeout: 10000 });
	} catch (error) {
		const diagnostic = await page.evaluate(() => ({
			status: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			sync: window.__PENA_RECENT_SYNC__ || null,
			bottom: window.__PENA_NATIVE_BOTTOM_DEBUG__ || null,
			failure: window.__PENA_NATIVE_FAILURE_DEBUG__ || null,
			counterFailures: window.nativeCounterFailures || 0,
			rest: window.nativeRestCalls || []
		}));
		throw new Error(`Live union recovery did not finish: ${JSON.stringify(diagnostic)}`, { cause: error });
	}
	const liveAuditSearch = page.locator('.recent-host input[type="search"]');
	await liveAuditSearch.fill('Живое сообщение после старта аудита');
	await page.waitForTimeout(120);
	assert.deepEqual(await visibleIds(page), ['chat1079'],
		'Delayed full audit rolled back the newer live message preview');
	await liveAuditSearch.fill('');
	await page.getByRole('button', { name: /Фильтры/ }).click();
	const liveAuditFilterPanel = page.locator('.recent-host .pena-native-filter-panel');
	await liveAuditFilterPanel.getByRole('button', { name: 'Дата', exact: true }).click();
	await liveAuditFilterPanel.getByRole('button', { name: 'По убыванию', exact: true }).click();
	await page.waitForTimeout(150);
	assert.equal((await visibleIds(page))[0], 'chat1079',
		'Delayed full audit rolled back the live message date sort order');
	await liveAuditFilterPanel.locator('.pena-native-unread-filter').click();
	await page.waitForTimeout(120);
	const liveUnreadState = await page.evaluate(() => {
		const snapshot = window.getNativeRepositorySnapshot?.() || null;
		const byId = new Map((snapshot?.records || []).map(record => [record.id, record]));
		return {
			checked: document.querySelector('.recent-host .pena-native-unread-filter input')?.checked === true,
			counterFailures: window.nativeCounterFailures || 0,
			visible: Array.from(document.querySelectorAll('.recent-host [data-id]')).filter(row => getComputedStyle(row).display !== 'none').map(row => row.dataset.id),
			row: (() => {
				const row = document.querySelector('.recent-host [data-id="chat1079"]');
				return row ? { className: row.className, hidden: row.hidden, display: getComputedStyle(row).display } : null;
			})(),
			newLiveStored: byId.has('chat8800'),
			tombstoneAvailability: byId.get('chat8801')?.state?.availability || '',
			confirmedIds: snapshot?.manifest?.catalogModes?.chats?.confirmedIds || [],
			catalogCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
			materializedCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.materialization?.count || 0,
			replacementRows: document.querySelectorAll('.pena-native-managed-row,.pena-native-remote-row').length
		};
	});
	assert.ok(liveUnreadState.counterFailures > 0 && liveUnreadState.visible.includes('chat1079'),
		`Delayed full audit rolled back the live unread counter: ${JSON.stringify(liveUnreadState)}`);
	const exactLiveRacePhysicalIds = ['chat225', 'chat5', 'chat77', ...Array.from({ length: 80 }, (_, index) => `chat${1000 + index}`)].sort();
	assert.ok(liveUnreadState.newLiveStored && liveUnreadState.tombstoneAvailability === 'unavailable',
		`Atomic native commit dropped a mid-pass identity or tombstone: ${JSON.stringify(liveUnreadState)}`);
	assert.deepEqual(liveUnreadState.confirmedIds.slice().sort(), exactLiveRacePhysicalIds,
		`Metadata union contaminated physical confirmedIds: ${JSON.stringify(liveUnreadState)}`);
	assert.equal(liveUnreadState.materializedCount, 83,
		`Metadata union changed the physical materialization count: ${JSON.stringify(liveUnreadState)}`);
	assert.equal(liveUnreadState.replacementRows, 0, `Metadata union created replacement rows: ${JSON.stringify(liveUnreadState)}`);
	await page.mouse.click(410, 20);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&repositoryCache=1&repositoryFullProof=1&restFailCount=20&catalogRows=80&initialTop=28&headTtl=120`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const manifest = window.getNativeRepositorySnapshot?.()?.manifest;
		return status?.modeStates?.chats?.attempt?.state === 'retry' && !status.originalActive &&
			manifest?.apiWatermarkVersion === 1 && manifest.apiCursorAt === 0 && manifest.apiFullAt === 0;
	}, null, { timeout: 12000 });
	const nativeOnlyWatermark = await page.evaluate(() => ({
		manifest: window.getNativeRepositorySnapshot().manifest,
		sync: window.__PENA_RECENT_SYNC__,
		recentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get').length
	}));
	assert.deepEqual(
		{
			version: nativeOnlyWatermark.manifest.apiWatermarkVersion,
			cursor: nativeOnlyWatermark.manifest.apiCursorAt,
			full: nativeOnlyWatermark.manifest.apiFullAt,
			syncCursor: nativeOnlyWatermark.sync.lastSuccessAt,
			syncFull: nativeOnlyWatermark.sync.lastFullAt
		},
		{ version: 1, cursor: 0, full: 0, syncCursor: 0, syncFull: 0 },
		`Native/repository materialization invented API freshness: ${JSON.stringify(nativeOnlyWatermark)}`
	);
	assert.ok(nativeOnlyWatermark.recentCalls > 0,
		`Cold repository bootstrap did not attempt its mandatory fresh API proof: ${JSON.stringify(nativeOnlyWatermark)}`);
	await page.evaluate(() => {
		window.setNativeRecentFailures(0);
		window.dispatchEvent(new Event('focus'));
	});
	try {
		await page.waitForFunction(previousCalls => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const manifest = window.getNativeRepositorySnapshot?.()?.manifest;
			const recentCalls = window.nativeRestCalls.filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get');
			return status?.loadedModes?.includes('chats') && !status.originalActive &&
				status.modeStates?.chats?.materialization?.state === 'ready' && recentCalls.length > previousCalls &&
				Number(manifest?.apiCursorAt) > 0 && Number(manifest?.apiFullAt) > 0;
		}, nativeOnlyWatermark.recentCalls, { timeout: 12000 });
	} catch (error) {
		const diagnostic = await page.evaluate(() => ({
			status: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			manifest: window.getNativeRepositorySnapshot?.()?.manifest || null,
			calls: window.nativeRestCalls,
			bottom: window.__PENA_NATIVE_BOTTOM_DEBUG__ || null,
			failure: window.__PENA_NATIVE_FAILURE_DEBUG__ || null
		}));
		throw new Error(`Offline cold recovery did not obtain a fresh API proof: ${JSON.stringify(diagnostic)}`, { cause: error });
	}
	const initialApiRecovery = await page.evaluate(previousCalls => {
		const snapshot = window.getNativeRepositorySnapshot();
		return {
			calls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get').slice(previousCalls),
			manifest: snapshot.manifest
		};
	}, nativeOnlyWatermark.recentCalls);
	assert.equal(initialApiRecovery.calls[0]?.method, 'im.recent.list',
		`Legacy/native-only cache used a fabricated delta cursor: ${JSON.stringify(initialApiRecovery)}`);
	assert.equal(initialApiRecovery.calls.some(call => call.method === 'im.recent.get'), false,
		`Legacy/native-only cache attempted incremental sync without a proven cursor: ${JSON.stringify(initialApiRecovery)}`);
	assert.ok(initialApiRecovery.manifest.apiCursorAt <= initialApiRecovery.calls[0].at &&
		initialApiRecovery.manifest.apiFullAt >= initialApiRecovery.manifest.apiCursorAt,
		`Complete API recovery persisted an unsafe cursor watermark: ${JSON.stringify(initialApiRecovery)}`);

	await page.waitForTimeout(220);
	const staleWakeMark = await page.evaluate(() => {
		const recentCalls = window.nativeRestCalls.filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get').length;
		const reconcileCount = window.__PENA_NATIVE_PREFETCH__?.status?.().reconcile?.count || 0;
		const before = window.getNativeRepositorySnapshot().manifest;
		window.addNativeOffscreenDelta('chat9900');
		window.mutateNativeVisibleRow();
		return { recentCalls, reconcileCount, before };
	});
	await page.waitForTimeout(180);
	const afterVisibleMutationWatermark = await page.evaluate(() => window.getNativeRepositorySnapshot().manifest);
	assert.deepEqual(
		{
			cursor: afterVisibleMutationWatermark.apiCursorAt,
			full: afterVisibleMutationWatermark.apiFullAt
		},
		{ cursor: staleWakeMark.before.apiCursorAt, full: staleWakeMark.before.apiFullAt },
		`Visible native merge advanced the API watermark: ${JSON.stringify(afterVisibleMutationWatermark)}`
	);
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await page.waitForFunction(mark => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const snapshot = window.getNativeRepositorySnapshot?.();
		const recentCalls = (window.nativeRestCalls || []).filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get');
		return Number(status?.reconcile?.count) > mark.reconcileCount && !status.apiActive &&
			recentCalls.length > mark.recentCalls && snapshot?.records?.some(record => record.id === 'chat9900') &&
			Number(snapshot?.manifest?.apiCursorAt) > 0 && Number(snapshot?.manifest?.apiFullAt) > 0;
	}, staleWakeMark, { timeout: 12000 });
	const recoveredApiWatermark = await page.evaluate(mark => {
		const recentCalls = window.nativeRestCalls.filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get').slice(mark.recentCalls);
		const snapshot = window.getNativeRepositorySnapshot();
		return {
			recentCalls,
			manifest: snapshot.manifest,
			confirmedIds: snapshot.manifest.catalogModes?.chats?.confirmedIds || [],
			materializedCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.materialization?.count || 0,
			replacementRows: document.querySelectorAll('.pena-native-managed-row,.pena-native-remote-row').length
		};
	}, staleWakeMark);
	assert.ok(recoveredApiWatermark.recentCalls.some(call => call.method === 'im.recent.get'),
		`Stale API head did not refresh after visible native mutation: ${JSON.stringify(recoveredApiWatermark)}`);
	assert.ok(recoveredApiWatermark.manifest.apiCursorAt >= staleWakeMark.before.apiCursorAt &&
		recoveredApiWatermark.manifest.apiFullAt >= staleWakeMark.before.apiFullAt &&
		recoveredApiWatermark.manifest.apiFullAt <= recoveredApiWatermark.manifest.apiCursorAt,
		`Lifecycle API refresh regressed its proven watermark: ${JSON.stringify(recoveredApiWatermark)}`);
	assert.deepEqual(recoveredApiWatermark.confirmedIds.slice().sort(), exactLiveRacePhysicalIds,
		`Offscreen API delta contaminated the exact native baseline: ${JSON.stringify(recoveredApiWatermark)}`);
	assert.equal(recoveredApiWatermark.materializedCount, 83,
		`Offscreen API delta changed physical materialization: ${JSON.stringify(recoveredApiWatermark)}`);
	assert.equal(recoveredApiWatermark.replacementRows, 0,
		`Watermark recovery created replacement rows: ${JSON.stringify(recoveredApiWatermark)}`);

	await page.evaluate(() => localStorage.clear());
	const staleSubsetStartedAt = Date.now();
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&repositoryCache=1&repositoryFullProof=1&repositoryProofCount=10&lazy=1&catalogRows=80&lazyChunk=100&lazyDelay=3500&initialTop=28&startupBudget=10000`);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true);
	await page.waitForTimeout(900);
	const staleSubsetInterim = await page.evaluate(() => ({
		loaded: window.__PENA_NATIVE_PREFETCH__?.status?.().loadedModes?.includes('chats') === true,
		materialization: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.materialization || null,
		physicalRows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
		recentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').map(call => call.offset)
	}));
	assert.equal(staleSubsetInterim.loaded, false,
		`Stale repository subset certified a cold source before its delayed range opened: ${JSON.stringify(staleSubsetInterim)}`);
	assert.equal(staleSubsetInterim.physicalRows, 10,
		`Delayed-range fixture did not retain its temporary 10-row physical maximum: ${JSON.stringify(staleSubsetInterim)}`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const rows = document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length;
		return status?.loadedModes?.includes('chats') && !status.originalActive && rows === 83 && status.modeCounts?.chats === 83;
	}, null, { timeout: 10000 });
	const staleSubsetFinal = await page.evaluate(startedAt => ({
		elapsed: Date.now() - startedAt,
		ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort(),
		top: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		proof: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		revision: window.__PENA_NATIVE_PREFETCH__?.status?.().materializationRevisions?.chats || 0,
		recentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').map(call => call.offset),
		unguardedScrolls: window.nativeScrollAudit.filter(entry =>
			!entry.loader && Math.abs(Number(entry.top) - Number(window.nativeScrollbarBaseline?.chats?.top)) > .5
		).length,
		replacementRows: document.querySelectorAll('.pena-native-managed-row,.pena-native-remote-row').length
	}), staleSubsetStartedAt);
	const exactColdPhysicalIds = ['chat225', 'chat5', 'chat77', ...Array.from({ length: 80 }, (_, index) => `chat${1000 + index}`)].sort();
	assert.deepEqual(staleSubsetFinal.ids, exactColdPhysicalIds,
		`Fresh API proof did not drive the delayed cold source to its exact full set: ${JSON.stringify(staleSubsetFinal)}`);
	assert.ok(staleSubsetFinal.proof?.complete && staleSubsetFinal.proof?.kind === 'api' && staleSubsetFinal.proof?.count === 83,
		`Cold source was not certified by a fresh fenced API audit: ${JSON.stringify(staleSubsetFinal)}`);
	assert.deepEqual(staleSubsetFinal.recentCalls, [0],
		`Complete cold API proof was fetched more than once while physical rows were delayed: ${JSON.stringify(staleSubsetFinal)}`);
	assert.ok(staleSubsetFinal.elapsed < 10000 && staleSubsetFinal.revision === 1,
		`Delayed cold materialization missed its startup budget or ran more than one pass: ${JSON.stringify(staleSubsetFinal)}`);
	assert.equal(staleSubsetFinal.top, 28, `Delayed cold recovery moved the scroll anchor: ${JSON.stringify(staleSubsetFinal)}`);
	assert.equal(staleSubsetFinal.unguardedScrolls, 0, `Delayed cold recovery leaked viewport scroll outside its guard: ${JSON.stringify(staleSubsetFinal)}`);
	assert.equal(staleSubsetFinal.replacementRows, 0, `Delayed cold recovery created replacement rows: ${JSON.stringify(staleSubsetFinal)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&repositoryCache=1&repositoryFullProof=1&repositoryControlledExtra=1&restFailCount=20&lazy=1&catalogRows=80&lazyChunk=100&lazyDelay=2200&initialTop=28&startupBudget=10000`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.modeStates?.chats?.attempt?.state === 'retry' &&
			Number(status.modeStates.chats.attempt.retryAt) > Date.now() && !status.originalActive;
	}, null, { timeout: 10000 });
	const repositoryCold = await page.evaluate(() => ({
		loaded: window.__PENA_NATIVE_PREFETCH__?.status?.().loadedModes?.includes('chats') === true,
		materialization: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.materialization || null,
		attempt: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.attempt || null,
		ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort(),
		top: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		baseline: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		imRecentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length,
		cachedConfirmedIds: window.getNativeRepositorySnapshot?.().manifest?.catalogModes?.chats?.confirmedIds || [],
		replacementRows: document.querySelectorAll('.pena-native-managed-row,.pena-native-remote-row').length
	}));
	assert.deepEqual(repositoryCold.ids, ['chat225', 'chat5', 'chat77', ...Array.from({ length: 80 }, (_, index) => `chat${1000 + index}`)].sort(),
		`Repository cold recovery lost the exact physical source: ${JSON.stringify(repositoryCold)}`);
	assert.equal(repositoryCold.loaded, false,
		`Repository baseline incorrectly certified the current cold DOM while API was unavailable: ${JSON.stringify(repositoryCold)}`);
	assert.notEqual(repositoryCold.materialization?.state, 'ready',
		`Offline repository bootstrap wrote a current materialization: ${JSON.stringify(repositoryCold)}`);
	assert.ok(repositoryCold.baseline?.complete && repositoryCold.baseline?.kind === 'repository' &&
		repositoryCold.baseline?.count === 83 && repositoryCold.baseline?.reason === 'repository-complete' &&
		String(repositoryCold.attempt?.reason || '').startsWith('api-proof-unavailable:'),
		`Schema-v2 repository lower bound was not retained with an API retry: ${JSON.stringify(repositoryCold)}`);
	assert.deepEqual(repositoryCold.cachedConfirmedIds.slice().sort(), exactColdPhysicalIds,
		`Failed cold API audit destroyed the last confirmed repository catalog: ${JSON.stringify(repositoryCold)}`);
	assert.equal(repositoryCold.top, 28, `Repository cold recovery moved the scroll anchor: ${JSON.stringify(repositoryCold)}`);
	assert.equal(repositoryCold.replacementRows, 0, `Repository controlled extra leaked a replacement row: ${JSON.stringify(repositoryCold)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&catalogRows=80&restShortCap=17&startupBudget=10000`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.modeCounts?.chats === 83;
	}, null, { timeout: 10000 });
	const explicitNextAudit = await page.evaluate(() => ({
		baseline: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		offsets: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').map(call => call.offset),
		ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort()
	}));
	assert.ok(explicitNextAudit.baseline?.complete && explicitNextAudit.baseline?.count === 83,
		`Valid short explicit-next pages produced an incomplete proof: ${JSON.stringify(explicitNextAudit)}`);
	assert.deepEqual(explicitNextAudit.offsets, [0, 17, 34, 51, 68],
		`Valid recent.next offsets were not followed exactly: ${JSON.stringify(explicitNextAudit)}`);
	assert.deepEqual(explicitNextAudit.ids,
		['chat225', 'chat5', 'chat77', ...Array.from({ length: 80 }, (_, index) => `chat${1000 + index}`)].sort(),
		`Explicit-next REST proof did not preserve the exact native source: ${JSON.stringify(explicitNextAudit)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&catalogRows=430&restCollapsedPages=1&restNoNext=1&startupBudget=10000`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.modeCounts?.chats === 433;
	}, null, { timeout: 10000 });
	const collapsedAudit = await page.evaluate(() => ({
		baseline: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		offsets: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').map(call => call.offset),
		ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort()
	}));
	assert.ok(collapsedAudit.baseline?.complete && collapsedAudit.baseline?.count === 433,
		`Collapsed REST pages produced an incomplete proof: ${JSON.stringify(collapsedAudit)}`);
	assert.deepEqual(collapsedAudit.offsets, [0, 200, 400],
		`Collapsed no-next recent pages did not follow canonical LIMIT offsets: ${JSON.stringify(collapsedAudit)}`);
	assert.deepEqual(collapsedAudit.ids, ['chat225', 'chat5', 'chat77', ...Array.from({ length: 430 }, (_, index) => `chat${1000 + index}`)].sort(),
		`Collapsed REST proof did not preserve the exact native source: ${JSON.stringify(collapsedAudit)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&catalogRows=430&restNoNext=1&startupBudget=10000`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.modeCounts?.chats === 433;
	}, null, { timeout: 10000 });
	const canonicalRecentOffsets = await page.evaluate(() => ({
		baseline: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		offsets: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').map(call => call.offset),
		ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort()
	}));
	assert.deepEqual(canonicalRecentOffsets.offsets, [0, 200, 400],
		`im.recent.list did not advance OFFSET by the requested LIMIT: ${JSON.stringify(canonicalRecentOffsets.offsets)}`);
	assert.ok(canonicalRecentOffsets.baseline?.complete && canonicalRecentOffsets.baseline?.count === 433,
		`Canonical no-next recent audit did not prove all pages: ${JSON.stringify(canonicalRecentOffsets)}`);
	assert.deepEqual(canonicalRecentOffsets.ids,
		['chat225', 'chat5', 'chat77', ...Array.from({ length: 430 }, (_, index) => `chat${1000 + index}`)].sort(),
		`Canonical no-next recent audit lost the exact native IDs: ${JSON.stringify(canonicalRecentOffsets)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&catalogRows=30&taskCatalogRows=85&taskBogusTotal=1`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.taskCatalogComplete === true;
	}, null, { timeout: 10000 });
	const explicitTaskPages = await page.evaluate(() => window.nativeRestCalls
		.filter(call => call.method === 'tasks.task.list').map(call => call.start));
	assert.deepEqual(explicitTaskPages, [0, 50],
		`Task audit trusted bogus total or skipped an explicit next page: ${JSON.stringify(explicitTaskPages)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&catalogRows=30&taskCatalogRows=85&taskNoNext=1&taskBogusTotal=1&taskNoEndMarker=1`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.taskCatalogComplete === true;
	}, null, { timeout: 10000 });
	const metadataFreeTaskPages = await page.evaluate(() => window.nativeRestCalls
		.filter(call => call.method === 'tasks.task.list').map(call => call.start));
	assert.deepEqual(metadataFreeTaskPages, [0, 50],
		`Metadata-free task pagination did not use 50-row START windows and the documented short tail: ${JSON.stringify(metadataFreeTaskPages)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&catalogRows=80&restTransientEmptyMs=180&startupBudget=10000`);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true);
	await page.waitForTimeout(320);
	const transientEmptyInterim = await page.evaluate(() => ({
		loaded: window.__PENA_NATIVE_PREFETCH__?.status?.().loadedModes?.includes('chats') === true,
		proof: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		calls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length
	}));
	assert.equal(transientEmptyInterim.loaded, false,
		`Transient empty recent page certified a non-empty native source: ${JSON.stringify(transientEmptyInterim)}`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.modeCounts?.chats === 83;
	}, null, { timeout: 10000 });
	const transientEmptyFinal = await page.evaluate(() => ({
		proof: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		calls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').map(call => call.offset),
		ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort()
	}));
	assert.ok(transientEmptyFinal.proof?.complete && transientEmptyFinal.proof?.count === 83 && transientEmptyFinal.calls.length >= 3,
		`Transient empty recent audit did not recover with a fresh proof: ${JSON.stringify(transientEmptyFinal)}`);
	assert.deepEqual(transientEmptyFinal.ids,
		['chat225', 'chat5', 'chat77', ...Array.from({ length: 80 }, (_, index) => `chat${1000 + index}`)].sort(),
		`Transient empty recovery lost the exact native IDs: ${JSON.stringify(transientEmptyFinal)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&nativeFirst=1&passThrough=1&catalogRows=30&taskCatalogRows=85&taskFirstEmpty=1&startupBudget=10000`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('tasks') && !status.originalActive && status.taskCatalogComplete === true;
	}, null, { timeout: 10000 });
	const transientTaskCatalog = await page.evaluate(() => ({
		starts: window.nativeRestCalls.filter(call => call.method === 'tasks.task.list').map(call => call.start),
		proof: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.tasks || null,
		ids: Array.from(document.querySelectorAll('.task-host .bx-im-list-container-task__elements > [data-id]'), row => row.dataset.id).sort()
	}));
	assert.deepEqual(transientTaskCatalog.starts, [0, 0, 50],
		`Task catalog accepted its first transient empty page: ${JSON.stringify(transientTaskCatalog)}`);
	assert.ok(transientTaskCatalog.proof?.complete && transientTaskCatalog.proof?.count === 33,
		`Task first-empty recovery did not produce a complete fenced proof: ${JSON.stringify(transientTaskCatalog)}`);
	assert.deepEqual(transientTaskCatalog.ids,
		['chat225', 'chat5', 'chat77', ...Array.from({ length: 30 }, (_, index) => `chat${1000 + index}`)].sort(),
		`Task first-empty recovery lost physical IDs: ${JSON.stringify(transientTaskCatalog)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&repositoryCache=1&repositorySchema2NoProof=1&repositoryControlledExtra=1&catalogRows=30`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.modeCounts?.chats === 33;
	}, null, { timeout: 10000 });
	const legacyV2Proof = await page.evaluate(() => ({
		baseline: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		recentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length,
		replacementRows: document.querySelectorAll('.pena-native-managed-row,.pena-native-remote-row').length
	}));
	assert.ok(legacyV2Proof.baseline?.reason === 'complete' && legacyV2Proof.baseline?.count === 33 && legacyV2Proof.recentCalls > 0,
		`Schema-v2 records without confirmedIds were incorrectly trusted: ${JSON.stringify(legacyV2Proof)}`);
	assert.equal(legacyV2Proof.replacementRows, 0, `Legacy repository extra leaked into native DOM: ${JSON.stringify(legacyV2Proof)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&catalogRows=30&restDelay=1200&startupBudget=10000`);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true);
	await page.waitForTimeout(180);
	await page.evaluate(() => window.replaceNativeAuditSource('8'));
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.modeCounts?.chats === 33 && status.expectedAuditDiscards >= 1;
	}, null, { timeout: 10000 });
	const fencedAudit = await page.evaluate(() => ({
		discards: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedAuditDiscards || 0,
		baseline: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
		users: Array.from(new Set(window.nativeRestCalls.filter(call => call.method === 'im.recent.list').map(call => call.userId)))
	}));
	assert.ok(fencedAudit.discards >= 1 && fencedAudit.baseline?.complete && fencedAudit.baseline?.sourceGeneration >= 2,
		`Late audit crossed its user/source fence: ${JSON.stringify(fencedAudit)}`);
	assert.deepEqual(fencedAudit.users.sort(), ['7', '8'], `Replacement source did not issue a fresh user-scoped audit: ${JSON.stringify(fencedAudit)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&repositoryCache=1&repositoryFullProof=1&repositoryDeletedId=chat9999&restFailCount=20&catalogRows=80&startupBudget=10000`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.modeStates?.chats?.attempt?.state === 'retry' && !status.originalActive;
	}, null, { timeout: 10000 });
	await page.waitForTimeout(260);
	const tombstoneRecovery = await page.evaluate(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return {
			loaded: status?.loadedModes?.includes('chats') === true,
			materialization: status?.modeStates?.chats?.materialization || null,
			attempt: status?.modeStates?.chats?.attempt || null,
			baseline: status?.expectedCatalogs?.chats || null,
			verified: window.nativeRestCalls.some(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9999'),
			confirmedIds: window.getNativeRepositorySnapshot?.().manifest?.catalogModes?.chats?.confirmedIds || [],
			ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort()
		};
	});
	assert.ok(!tombstoneRecovery.loaded && tombstoneRecovery.materialization?.state !== 'ready' &&
		tombstoneRecovery.baseline?.kind === 'repository' &&
		tombstoneRecovery.baseline?.reason === 'repository-tombstones-reconciled' &&
		tombstoneRecovery.baseline?.count === 83 && tombstoneRecovery.verified &&
		String(tombstoneRecovery.attempt?.reason || '').startsWith('api-proof-unavailable:'),
		`Repository tombstone reconciliation incorrectly certified an offline cold source: ${JSON.stringify(tombstoneRecovery)}`);
	assert.deepEqual(tombstoneRecovery.confirmedIds.slice().sort(), exactColdPhysicalIds,
		`Repository tombstone was not persisted while API proof remained pending: ${JSON.stringify(tombstoneRecovery)}`);
	assert.equal(tombstoneRecovery.ids.includes('chat9999'), false, `Deleted confirmed ID leaked into native rows: ${JSON.stringify(tombstoneRecovery)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&repositoryCache=1&repositorySchema2NoProof=1&apiDeletedId=chat9999&catalogRows=80&startupBudget=10000`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && status.modeCounts?.chats === 83;
	}, null, { timeout: 10000 });
	await page.waitForTimeout(260);
	const apiTombstoneRecovery = await page.evaluate(() => {
		const snapshot = window.getNativeRepositorySnapshot?.() || null;
		const deletedRecord = snapshot?.records?.find(record => record.id === 'chat9999') || null;
		return {
			baseline: window.__PENA_NATIVE_PREFETCH__?.status?.().expectedCatalogs?.chats || null,
			verified: window.nativeRestCalls.some(call => call.method === 'im.dialog.get' && call.dialogId === 'chat9999'),
			unavailableCount: window.__PENA_RECENT_SYNC__?.unavailableCount || 0,
			confirmedIds: snapshot?.manifest?.catalogModes?.chats?.confirmedIds || [],
			deletedAvailability: deletedRecord?.state?.availability || '',
			ids: Array.from(document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]'), row => row.dataset.id).sort()
		};
	});
	const exactApiTombstoneIds = ['chat225', 'chat5', 'chat77', ...Array.from({ length: 80 }, (_, index) => `chat${1000 + index}`)].sort();
	assert.ok(apiTombstoneRecovery.baseline?.reason === 'api-tombstones-reconciled' &&
		apiTombstoneRecovery.baseline?.count === 83 && apiTombstoneRecovery.verified,
		`Deleted ID in a cached API proof kept the cold generation blocked: ${JSON.stringify(apiTombstoneRecovery)}`);
	assert.deepEqual(apiTombstoneRecovery.ids, exactApiTombstoneIds,
		`API-proof tombstone changed the exact physical IDs: ${JSON.stringify(apiTombstoneRecovery)}`);
	assert.ok(apiTombstoneRecovery.unavailableCount >= 1 && apiTombstoneRecovery.deletedAvailability === 'unavailable',
		`Late audit metadata resurrected the deleted dialog globally: ${JSON.stringify(apiTombstoneRecovery)}`);
	assert.deepEqual(apiTombstoneRecovery.confirmedIds.slice().sort(), exactApiTombstoneIds,
		`Repository confirmedIds retained the deleted API-proof dialog: ${JSON.stringify(apiTombstoneRecovery)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=80&lazyChunk=8&lazyDelay=20&initialTop=28&skipRuntime=1&sourceUnavailable=1`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const rows = document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length;
		return status?.loadedModes?.includes('chats') && !status.originalActive &&
			(status.materializationRevisions?.chats || 0) === 1 && rows >= 80;
	}, null, { timeout: 10000 });
	const initialMountRecovery = await page.evaluate(() => ({
		rows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
		revision: window.__PENA_NATIVE_PREFETCH__?.status?.().materializationRevisions?.chats || 0,
		unavailableLeft: window.__PENA_TEST_NATIVE_SOURCE_UNAVAILABLE_COUNT__,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		baselineTop: window.nativeScrollbarBaseline?.chats?.top || 0,
		managed: document.querySelectorAll('.pena-native-managed-viewport,.pena-native-managed-row,.pena-native-remote-row').length,
		imRecentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length
	}));
	assert.ok(initialMountRecovery.rows === 83 && initialMountRecovery.revision === 1 &&
		initialMountRecovery.unavailableLeft === 0 && initialMountRecovery.sourceTop === initialMountRecovery.baselineTop &&
		initialMountRecovery.managed === 0 && initialMountRecovery.imRecentCalls > 0,
		`First messenger mount did not recover the native list: ${JSON.stringify(initialMountRecovery)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=120&lazyChunk=8&lazyDelay=20&initialTop=32&activeFolder=1`);
	await page.locator('.recent-host .pena-native-original-load-guard').waitFor({ state: 'visible', timeout: 3000 });
	await page.waitForFunction(() => document.querySelector('.recent-host .pena-native-folder-tab[title="Тестовая папка"]')?.classList.contains('--active'));
	const loadingFolderIsolation = await page.evaluate(() => {
		const assigned = document.querySelector('.recent-host [data-id="chat225"]');
		const foreign = document.querySelector('.recent-host [data-id="chat5"]');
		const state = row => row ? ({ display: getComputedStyle(row).display, visibility: getComputedStyle(row).visibility }) : null;
		return {
			assigned: state(assigned),
			foreign: state(foreign),
			active: document.querySelector('.recent-host .bx-im-list-container-recent__elements')?.classList.contains('pena-native-traversal-active') || false,
			folderId: JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'chat225')?.folderId || ''
		};
	});
	assert.equal(loadingFolderIsolation.active, true, `Native traversal did not enter its isolated state: ${JSON.stringify(loadingFolderIsolation)}`);
	assert.equal(loadingFolderIsolation.assigned?.visibility, 'visible', `Assigned dialog disappeared during loading: ${JSON.stringify(loadingFolderIsolation)}`);
	assert.equal(loadingFolderIsolation.foreign?.visibility, 'hidden', `Foreign dialog leaked into the active folder during loading: ${JSON.stringify(loadingFolderIsolation)}`);
	assert.notEqual(loadingFolderIsolation.foreign?.display, 'none', `Folder isolation collapsed the native catalog geometry: ${JSON.stringify(loadingFolderIsolation)}`);
	assert.equal(loadingFolderIsolation.folderId, 'folder:test', `Loading changed the persisted folder assignment: ${JSON.stringify(loadingFolderIsolation)}`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && (status.modeCounts?.chats || 0) >= 120;
	}, null, { timeout: 8000 });
	const loadedFolderIsolation = await page.evaluate(() => {
		const assigned = document.querySelector('.recent-host [data-id="chat225"]');
		const foreign = document.querySelector('.recent-host [data-id="chat5"]');
		const items = JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]');
		return {
			assignedDisplay: assigned ? getComputedStyle(assigned).display : '',
			foreignDisplay: foreign ? getComputedStyle(foreign).display : '',
			traversalActive: document.querySelector('.recent-host .bx-im-list-container-recent__elements')?.classList.contains('pena-native-traversal-active') || false,
			assignedFolder: items.find(item => item.id === 'chat225')?.folderId || '',
			foreignFolder: items.find(item => item.id === 'chat5')?.folderId || ''
		};
	});
	assert.equal(loadedFolderIsolation.traversalActive, false, `Traversal isolation was not cleaned up: ${JSON.stringify(loadedFolderIsolation)}`);
	assert.notEqual(loadedFolderIsolation.assignedDisplay, 'none', `Assigned dialog vanished after loading: ${JSON.stringify(loadedFolderIsolation)}`);
	assert.equal(loadedFolderIsolation.foreignDisplay, 'none', `Foreign dialog remained in the folder after loading: ${JSON.stringify(loadedFolderIsolation)}`);
	assert.equal(loadedFolderIsolation.assignedFolder, 'folder:test', `Final catalog lost the assigned dialog: ${JSON.stringify(loadedFolderIsolation)}`);
	assert.equal(loadedFolderIsolation.foreignFolder, '', `Final catalog assigned a foreign dialog to the folder: ${JSON.stringify(loadedFolderIsolation)}`);
	await switchMode(page);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const rows = document.querySelectorAll('.task-host .bx-im-list-container-task__elements > [data-id]').length;
		return status?.loadedModes?.includes('tasks') && !status.originalActive && rows >= 120;
	}, null, { timeout: 8000 });
	const nativeFirstTasks = await page.evaluate(() => ({
		rows: document.querySelectorAll('.task-host .bx-im-list-container-task__elements > [data-id]').length,
		sourceTop: document.querySelector('.task-host .bx-im-list-container-task__scroll-container')?.scrollTop || 0,
		baselineTop: window.nativeScrollbarBaseline?.tasks?.top || 0,
		imRecentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length
	}));
	assert.ok(nativeFirstTasks.rows >= 120 && nativeFirstTasks.sourceTop === nativeFirstTasks.baselineTop && nativeFirstTasks.imRecentCalls > 0,
		`Task-mode switch did not complete the native list without a scroll jump: ${JSON.stringify(nativeFirstTasks)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=120&lazyChunk=8&lazyDelay=20&initialTop=32&rematerializeOnReturn=1`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && (status.materializationRevisions?.chats || 0) === 1;
	}, null, { timeout: 10000 });
	await switchMode(page);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('tasks') && !status.originalActive;
	}, null, { timeout: 10000 });
	await switchMode(page);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const rows = document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length;
		return (status?.materializationRevisions?.chats || 0) >= 2 && !status.originalActive && rows >= 120;
	}, null, { timeout: 10000 });
	const rematerializedChats = await page.evaluate(() => ({
		revision: window.__PENA_NATIVE_PREFETCH__?.status?.().materializationRevisions?.chats || 0,
		resets: window.nativeMaterializationResets || 0,
		rows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements > [data-id]').length,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		baselineTop: window.nativeScrollbarBaseline?.chats?.top || 0,
		managedRows: document.querySelectorAll('.pena-native-managed-row,.pena-native-remote-row').length,
		managedViewports: document.querySelectorAll('.pena-native-managed-viewport').length
	}));
	assert.deepEqual(rematerializedChats, {
		revision: 2,
		resets: 1,
		rows: 123,
		sourceTop: rematerializedChats.baselineTop,
		baselineTop: rematerializedChats.baselineTop,
		managedRows: 0,
		managedViewports: 0
	}, `Native rematerialization changed Bitrix markup or lost dialogs: ${JSON.stringify(rematerializedChats)}`);
	await page.evaluate(() => {
		window.dispatchEvent(new Event('focus'));
		window.dispatchEvent(new Event('resize'));
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await page.waitForTimeout(700);
	const stableRematerialization = await page.evaluate(() => ({
		revision: window.__PENA_NATIVE_PREFETCH__?.status?.().materializationRevisions?.chats || 0,
		active: window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive || false,
		managed: document.querySelectorAll('.pena-native-managed-viewport,.pena-native-managed-row,.pena-native-remote-row').length
	}));
	assert.deepEqual(stableRematerialization, { revision: 2, active: false, managed: 0 },
		`Stable focus/resize restarted native loading or created replacement markup: ${JSON.stringify(stableRematerialization)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=tasks&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&nestedViewport=1&catalogRows=160&lazyChunk=10&lazyDelay=20&initialTop=24`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('tasks') && !status.originalActive && (status.modeCounts?.tasks || 0) >= 160;
	}, null, { timeout: 10000 });
	const nestedTaskViewport = await page.evaluate(() => ({
		count: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.tasks || 0,
		top: document.querySelector('.task-host .bx-im-list-container-task__scroll-container')?.scrollTop || 0,
		baselineTop: window.nativeScrollbarBaseline?.tasks?.top || 0,
		wrapperTop: document.querySelector('.task-host .bx-im-list-container-task__elements_container')?.scrollTop || 0,
		loaderText: document.querySelector('.pena-native-load-value')?.textContent || ''
	}));
	assert.ok(nestedTaskViewport.count >= 160, `Nested task viewport did not materialize the complete native list: ${JSON.stringify(nestedTaskViewport)}`);
	assert.equal(nestedTaskViewport.top, nestedTaskViewport.baselineTop, `Nested task loading moved the real native scrollbar: ${JSON.stringify(nestedTaskViewport)}`);
	assert.equal(nestedTaskViewport.wrapperTop, 0, `Loader scrolled the elements wrapper instead of the native viewport: ${JSON.stringify(nestedTaskViewport)}`);
	assert.doesNotMatch(nestedTaskViewport.loaderText, /\u2026|\.\.\./, `Native loader exposed an indeterminate dots state: ${JSON.stringify(nestedTaskViewport)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&descendantViewport=1&catalogRows=120&lazyChunk=12&lazyDelay=20&initialTop=20`);
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.loadedModes?.includes('chats') && !status.originalActive && (status.modeCounts?.chats || 0) >= 120;
		}, null, { timeout: 12000 });
	} catch (error) {
		const state = await page.evaluate(() => ({
			status: window.__PENA_NATIVE_PREFETCH__?.status?.(),
			scrollDebug: window.__PENA_NATIVE_SCROLL_DEBUG__,
			managedDebug: window.__PENA_MANAGED_DEBUG__,
			rows: document.querySelectorAll('.recent-host .bx-im-list-recent__scroll-container > [data-id]').length,
			top: document.querySelector('.recent-host .bx-im-list-recent__scroll-container')?.scrollTop || 0,
			height: document.querySelector('.recent-host .bx-im-list-recent__scroll-container')?.scrollHeight || 0,
			client: document.querySelector('.recent-host .bx-im-list-recent__scroll-container')?.clientHeight || 0
		}));
		throw new Error(`Descendant scroll viewport stalled: ${JSON.stringify(state)}`, { cause: error });
	}
	const descendantScrollViewport = await page.evaluate(() => {
		const panel = document.querySelector('.recent-host .pena-native-folder-switcher');
		const sourceRegion = document.querySelector('.recent-host .bx-im-list-container-recent__elements_container');
		return ({
		count: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		top: document.querySelector('.recent-host .bx-im-list-recent__scroll-container')?.scrollTop || 0,
		panelVisible: Array.from(document.querySelectorAll('.recent-host .pena-native-folder-switcher')).some(panel => {
			const rect = panel.getBoundingClientRect();
			const style = getComputedStyle(panel);
			return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
		}),
		filterButtons: document.querySelectorAll('.recent-host .pena-native-command-btn').length,
		panelIsOuterSibling: !!panel && panel.parentElement === sourceRegion?.parentElement && panel.nextElementSibling === sourceRegion,
		loaderText: document.querySelector('.pena-native-load-value')?.textContent || ''
		});
	});
	assert.ok(descendantScrollViewport.count >= 120, `Descendant viewport did not materialize the complete native list: ${JSON.stringify(descendantScrollViewport)}`);
	assert.equal(descendantScrollViewport.top, 20, `Descendant viewport did not restore the native position: ${JSON.stringify(descendantScrollViewport)}`);
	assert.equal(descendantScrollViewport.panelVisible, true, `Descendant viewport rejected the native PENA panel: ${JSON.stringify(descendantScrollViewport)}`);
	assert.ok(descendantScrollViewport.filterButtons >= 2, `Descendant viewport did not expose PENA controls: ${JSON.stringify(descendantScrollViewport)}`);
	assert.equal(descendantScrollViewport.panelIsOuterSibling, true, `PENA panel was mounted inside the native scroll branch: ${JSON.stringify(descendantScrollViewport)}`);
	assert.doesNotMatch(descendantScrollViewport.loaderText, /\u2026|\.\.\./, `Descendant viewport exposed an indeterminate dots state: ${JSON.stringify(descendantScrollViewport)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&repositoryCache=1&lazy=1&catalogRows=160&lazyChunk=10&lazyDelay=300&startupBudget=1200`);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true, null, { timeout: 3000 });
	const timedOutBaseline = await page.evaluate(() => ({
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		syncCount: window.__PENA_RECENT_SYNC__?.count || 0
	}));
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.originalActive === false && window.__PENA_RECENT_SYNC__?.phase === 'error';
	}, null, { timeout: 6000 });
	await page.waitForTimeout(250);
	const timedOutNativeTraversal = await page.evaluate(() => ({
		detailCalls: (window.nativeRestCalls || []).filter(call => call.method === 'im.dialog.get').length,
		background: window.__PENA_NATIVE_PREFETCH__?.status?.().backgroundModes?.includes('chats') || false,
		loaded: window.__PENA_NATIVE_PREFETCH__?.status?.().loadedModes?.includes('chats') || false,
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		syncCount: window.__PENA_RECENT_SYNC__?.count || 0,
		attempt: window.__PENA_NATIVE_PREFETCH__?.status?.().modeStates?.chats?.attempt || null,
		error: window.__PENA_RECENT_SYNC__?.error || ''
	}));
	assert.ok(timedOutNativeTraversal.detailCalls < 10, `Timed-out native loading started a per-dialog REST storm: ${JSON.stringify(timedOutNativeTraversal)}`);
	assert.equal(timedOutNativeTraversal.background, true, `Timed-out traversal did not retain a bounded recovery attempt: ${JSON.stringify(timedOutNativeTraversal)}`);
	assert.equal(timedOutNativeTraversal.loaded, false, `Timed-out traversal was marked complete: ${JSON.stringify(timedOutNativeTraversal)}`);
	assert.equal(timedOutNativeTraversal.modeCount, timedOutBaseline.modeCount, `Timed-out traversal published a partial mode count: ${JSON.stringify({ timedOutBaseline, timedOutNativeTraversal })}`);
	assert.ok(timedOutNativeTraversal.syncCount >= timedOutBaseline.syncCount,
		`Timed-out traversal deleted last-known-good metadata: ${JSON.stringify({ timedOutBaseline, timedOutNativeTraversal })}`);
	assert.match(timedOutNativeTraversal.error, /конец списка/i, `Timed-out traversal has no recoverable error state: ${JSON.stringify(timedOutNativeTraversal)}`);
	assert.match(String(timedOutNativeTraversal.attempt?.state || ''), /retry/i, `Timed-out traversal did not enter retry state: ${JSON.stringify(timedOutNativeTraversal)}`);
	assert.ok(Number(timedOutNativeTraversal.attempt?.retryAt) > Date.now(), `Timed-out traversal has no bounded retry deadline: ${JSON.stringify(timedOutNativeTraversal)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=30&lazyChunk=10&lazyDelay=10&initialTop=16&catalogTtl=120&deepIdle=50`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && Number(status.modeLoadedAt?.chats) > 0;
	}, null, { timeout: 6000 });
	const nativeFirstBeforeTtl = await page.evaluate(() => ({
		loadedAt: window.__PENA_NATIVE_PREFETCH__.status().modeLoadedAt.chats,
		top: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		imRecentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length
	}));
	await page.waitForTimeout(180);
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await page.waitForTimeout(420);
	const nativeFirstAfterTtl = await page.evaluate(() => ({
		loadedAt: window.__PENA_NATIVE_PREFETCH__.status().modeLoadedAt.chats,
		top: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		imRecentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length
	}));
	assert.equal(nativeFirstAfterTtl.loadedAt, nativeFirstBeforeTtl.loadedAt, 'Focus incorrectly expired a proven native materialization');
	assert.equal(nativeFirstAfterTtl.top, nativeFirstBeforeTtl.top, 'TTL refresh moved the native chat viewport');
	assert.equal(nativeFirstAfterTtl.imRecentCalls, nativeFirstBeforeTtl.imRecentCalls, 'Idle TTL refresh repeated the full metadata baseline');
	assert.equal(await page.locator('.recent-host .pena-native-original-load-guard').count(), 0, 'Idle TTL refresh showed a blocking loader');

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&lazy=1&catalogRows=35&lazyChunk=10&lazyDelay=10&headTtl=1000&headTimeout=80&deltaTimeout=1`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && !status.originalActive && window.__PENA_RECENT_SYNC__?.phase === 'ready';
	}, null, { timeout: 6000 });
	const readyBeforeHeadTimeout = await page.evaluate(() => ({
		count: window.__PENA_RECENT_SYNC__?.count || 0,
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		recentListCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length
	}));
	const headRefreshResult = await page.evaluate(() => window.__PENA_NATIVE_PREFETCH__.refreshHead());
	await page.waitForFunction(() => window.nativeRestCalls.some(call => call.method === 'im.recent.get'), null, { timeout: 3000 });
	assert.equal(headRefreshResult?.backgroundFailed, true, `Timed-out head refresh did not settle as a soft failure: ${JSON.stringify(headRefreshResult)}`);
	const afterHeadTimeout = await page.evaluate(() => ({
		sync: window.__PENA_RECENT_SYNC__ || null,
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		recentListCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list').length,
		chipVisible: Array.from(document.querySelectorAll('.pena-native-sync-chip')).some(chip => !chip.hidden)
	}));
	assert.equal(afterHeadTimeout.sync.phase, 'ready', `Background head timeout replaced ready catalog state: ${JSON.stringify(afterHeadTimeout)}`);
	assert.equal(afterHeadTimeout.sync.error, '', `Background head timeout became a blocking error: ${JSON.stringify(afterHeadTimeout)}`);
	assert.equal(afterHeadTimeout.sync.count, readyBeforeHeadTimeout.count, `Background head timeout replaced the atomic catalog: ${JSON.stringify(afterHeadTimeout)}`);
	assert.equal(afterHeadTimeout.modeCount, readyBeforeHeadTimeout.modeCount, `Background head timeout changed the complete mode count: ${JSON.stringify(afterHeadTimeout)}`);
	assert.equal(afterHeadTimeout.recentListCalls, readyBeforeHeadTimeout.recentListCalls, `Timed-out delta started a second slow recent-list request: ${JSON.stringify(afterHeadTimeout)}`);
	assert.equal(afterHeadTimeout.chipVisible, false, `Background head timeout exposed a misleading retry chip: ${JSON.stringify(afterHeadTimeout)}`);

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&lazy=1&catalogRows=1820&restDelay=80&restUnknownTotal=1`);
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.loadedModes?.includes('chats') && status.originalActive === false;
		}, null, { timeout: 12000 });
	} catch (error) {
		const diagnostic = await page.evaluate(() => ({
			prefetch: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			sync: window.__PENA_RECENT_SYNC__ || null,
			scroll: window.__PENA_NATIVE_SCROLL_DEBUG__ || null,
			rows: document.querySelectorAll('.recent-host [data-id]').length,
			pendingRows: document.querySelectorAll('.recent-host .bx-im-list-container-recent__elements [data-id]').length
		}));
		throw new Error(`Large lazy native catalog did not finish: ${JSON.stringify(diagnostic)}; ${error.message}`);
	}
	const nativeLoadPerformance = await page.evaluate(() => {
		const sync = window.__PENA_RECENT_SYNC__ || {};
		return {
			duration: Math.max(0, Number(sync.completedAt) - Number(sync.startedAt)),
			count: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
			pages: Number(sync.pagesLoaded) || 0,
			batchCalls: window.nativeBatchCalls || 0,
			batchSizes: window.nativeBatchSizes || [],
			truncated: !!sync.truncated,
			sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0
		};
	});
	assert.ok(nativeLoadPerformance.count >= 1820, `Startup did not load the complete dynamic catalog: ${JSON.stringify(nativeLoadPerformance)}`);
	assert.ok(nativeLoadPerformance.pages >= 10 && nativeLoadPerformance.batchCalls >= 2, `Unknown-total startup did not continue adaptive REST batch pagination: ${JSON.stringify(nativeLoadPerformance)}`);
	assert.ok(nativeLoadPerformance.batchSizes.every(size => size > 0 && size <= 8), `Adaptive batches exceeded the safe wave size: ${JSON.stringify(nativeLoadPerformance)}`);
	assert.equal(nativeLoadPerformance.truncated, false, `Complete REST catalog was reported as partial: ${JSON.stringify(nativeLoadPerformance)}`);
	assert.equal(nativeLoadPerformance.sourceTop, 0, `REST catalog loading moved the native viewport: ${JSON.stringify(nativeLoadPerformance)}`);
	assert.ok(nativeLoadPerformance.duration >= 0 && nativeLoadPerformance.duration < 10000, `Complete catalog missed the startup performance target: ${JSON.stringify(nativeLoadPerformance)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&lazy=1&catalogRows=620&lazyChunk=25&lazyDelay=20&restDelay=20&restIncompleteZero=1`);
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return status?.lastApiResult?.totalMetadataInconsistent === true &&
				(status.modeCounts?.chats || 0) >= 620 &&
				status.originalActive === false &&
				!status.backgroundModes?.includes('chats');
		}, null, { timeout: 15000 });
	} catch (error) {
		const diagnostic = await page.evaluate(() => ({
			prefetch: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			sync: window.__PENA_RECENT_SYNC__ || null,
			restCalls: window.nativeRestCalls || [],
			sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0
		}));
		throw new Error(`False REST total=0 did not trigger complete native backfill: ${JSON.stringify(diagnostic)}; ${error.message}`);
	}
	const zeroTotalRecovery = await page.evaluate(() => ({
		prefetch: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
		sync: window.__PENA_RECENT_SYNC__ || null,
		overlays: document.querySelectorAll('.pena-native-original-load-guard,.pena-native-load-guard:not([hidden])').length,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0
	}));
	assert.equal(zeroTotalRecovery.prefetch.lastApiResult.received, 164, `Regression did not reproduce the 164-dialog API window: ${JSON.stringify(zeroTotalRecovery)}`);
	assert.notEqual(zeroTotalRecovery.prefetch.lastApiResult.expectedTotal, 0, `Invalid API total leaked into the progress state: ${JSON.stringify(zeroTotalRecovery)}`);
	assert.ok(zeroTotalRecovery.sync.windowCount >= 620, `Old dialogs were not recovered after 164/0: ${JSON.stringify(zeroTotalRecovery)}`);
	assert.notEqual(zeroTotalRecovery.sync.expectedTotal, 0, `Status regressed to a zero denominator: ${JSON.stringify(zeroTotalRecovery)}`);
	assert.equal(zeroTotalRecovery.overlays, 0, `Loader stayed over the list after native backfill: ${JSON.stringify(zeroTotalRecovery)}`);
	assert.equal(zeroTotalRecovery.sourceTop, 0, `Native backfill moved the visible scroll position: ${JSON.stringify(zeroTotalRecovery)}`);

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&lazy=1&catalogRows=620&lazyChunk=25&lazyDelay=100&restDelay=80`);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true, null, { timeout: 3000 });
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.loadedModes?.includes('chats') && status.originalActive === false;
	}, null, { timeout: 30000 });
	const completeNativeLoad = await page.evaluate(() => ({
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		windowCount: window.__PENA_RECENT_SYNC__?.windowCount || 0,
		loadLimit: window.__PENA_RECENT_SYNC__?.loadLimit || 0,
		truncated: !!window.__PENA_RECENT_SYNC__?.truncated,
		background: window.__PENA_NATIVE_PREFETCH__?.status?.().backgroundModes?.includes('chats') || false,
		duration: Math.max(0, Number(window.__PENA_RECENT_SYNC__?.completedAt) - Number(window.__PENA_RECENT_SYNC__?.startedAt)),
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
		batchCalls: window.nativeBatchCalls || 0
	}));
	assert.ok(completeNativeLoad.modeCount >= 620, `Dynamic startup did not reach the API total: ${JSON.stringify(completeNativeLoad)}`);
	assert.equal(completeNativeLoad.windowCount, completeNativeLoad.modeCount, `Startup count diverged from the actual catalog: ${JSON.stringify(completeNativeLoad)}`);
	assert.equal(completeNativeLoad.truncated, false, `Dynamic startup was reported as partial: ${JSON.stringify(completeNativeLoad)}`);
	assert.equal(completeNativeLoad.background, false, `Complete startup incorrectly stayed pending: ${JSON.stringify(completeNativeLoad)}`);
	assert.ok(completeNativeLoad.batchCalls >= 1, `Dynamic startup skipped REST batching: ${JSON.stringify(completeNativeLoad)}`);
	assert.ok(completeNativeLoad.duration >= 0 && completeNativeLoad.duration < 10000, `Dynamic startup exceeded the performance target: ${JSON.stringify(completeNativeLoad)}`);
	assert.equal(completeNativeLoad.sourceTop, 0, `Dynamic startup changed the visible scroll position: ${JSON.stringify(completeNativeLoad)}`);
	await page.waitForTimeout(1500);
	const passiveComplete = await page.evaluate(() => ({
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		windowCount: window.__PENA_RECENT_SYNC__?.windowCount || 0,
		background: window.__PENA_NATIVE_PREFETCH__?.status?.().backgroundModes?.includes('chats') || false,
		overlays: document.querySelectorAll('.pena-native-original-load-guard,.pena-native-load-guard:not([hidden])').length,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0
	}));
	assert.ok(passiveComplete.modeCount >= 620, `Passive state lost part of the complete catalog: ${JSON.stringify(passiveComplete)}`);
	assert.equal(passiveComplete.windowCount, passiveComplete.modeCount, `Actual dialog counter diverged in passive state: ${JSON.stringify(passiveComplete)}`);
	assert.equal(passiveComplete.background, false, `Passive loading stayed pending after full completion: ${JSON.stringify(passiveComplete)}`);
	assert.equal(passiveComplete.overlays, 0, `Passive loading reopened the loader: ${JSON.stringify(passiveComplete)}`);
	assert.equal(passiveComplete.sourceTop, 0, `Passive completion moved the visible native viewport: ${JSON.stringify(passiveComplete)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&nativeFirst=1&lazy=1&catalogRows=620&lazyChunk=20&lazyDelay=200&generatedManaged=1&restDelay=80`);
	await page.waitForFunction(() => window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === true, null, { timeout: 3000 });
	await page.waitForFunction(() => {
		const value = document.querySelector('.recent-host .pena-native-original-load-guard .pena-native-load-value')?.textContent || '';
		const percent = Number.parseInt(value, 10);
		return Number.isFinite(percent) && percent > 0 && percent < 100;
	}, null, { timeout: 5000 });
	const midTraversalState = await page.evaluate(() => ({
		count: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		progress: document.querySelector('.recent-host .pena-native-original-load-guard .pena-native-load-value')?.textContent || '',
		phase: window.__PENA_RECENT_SYNC__?.phase || '',
		ready: window.__PENA_NATIVE_PREFETCH__?.status?.().loadedModes?.includes('chats') || false,
		background: window.__PENA_NATIVE_PREFETCH__?.status?.().backgroundModes?.includes('chats') || false,
		overlay: document.querySelectorAll('.pena-native-original-load-guard').length
	}));
	assert.match(midTraversalState.progress, /^(?:[1-9]|[1-9]\d)%$/, `Slow native traversal did not expose measurable progress: ${JSON.stringify(midTraversalState)}`);
	assert.equal(midTraversalState.ready, false, `A partial native window was published as complete: ${JSON.stringify(midTraversalState)}`);
	assert.equal(midTraversalState.phase, 'native-scroll', `Loader left the traversal phase before the real end: ${JSON.stringify(midTraversalState)}`);
	assert.equal(midTraversalState.background, false, `Foreground traversal was converted into an invisible background load: ${JSON.stringify(midTraversalState)}`);
	assert.equal(midTraversalState.overlay, 1, `Loader disappeared while old dialogs were still missing: ${JSON.stringify(midTraversalState)}`);
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			return (status?.modeCounts?.chats || 0) >= 620 && status?.loadedModes?.includes('chats') && !status?.originalActive;
		}, null, { timeout: 30000 });
	} catch (error) {
		const diagnostic = await page.evaluate(() => ({
			prefetch: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			sync: window.__PENA_RECENT_SYNC__ || null,
			restCalls: window.nativeRestCalls || [],
			batchCalls: window.nativeBatchCalls || 0,
			rows: document.querySelectorAll('.recent-host .pena-native-chat-row').length,
			sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0,
			sourceHeight: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollHeight || 0
		}));
		throw new Error(`Foreground native traversal did not reach the actual end: ${JSON.stringify(diagnostic)}; ${error.message}`);
	}
	const foregroundCompleteState = await page.evaluate(() => ({
		count: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		background: window.__PENA_NATIVE_PREFETCH__?.status?.().backgroundModes?.includes('chats') || false,
		overlay: document.querySelectorAll('.pena-native-original-load-guard,.pena-native-load-guard:not([hidden])').length,
		sourceTop: document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container')?.scrollTop || 0
	}));
	assert.ok(foregroundCompleteState.count >= 620, `Full native traversal lost old dialogs: ${JSON.stringify({ midTraversalState, foregroundCompleteState })}`);
	assert.equal(foregroundCompleteState.background, false, `Completed traversal left a passive completion job: ${JSON.stringify(foregroundCompleteState)}`);
	assert.equal(foregroundCompleteState.overlay, 0, `Loader stayed after the confirmed end: ${JSON.stringify(foregroundCompleteState)}`);
	assert.equal(foregroundCompleteState.sourceTop, 0, `Full traversal moved the visible source viewport: ${JSON.stringify(foregroundCompleteState)}`);
	await page.waitForTimeout(1200);
	const stableRecovery = await page.evaluate(() => ({
		count: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.chats || 0,
		background: window.__PENA_NATIVE_PREFETCH__?.status?.().backgroundModes?.includes('chats') || false,
		active: window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive || false
	}));
	assert.deepEqual(stableRecovery, { count: foregroundCompleteState.count, background: false, active: false }, `Catalog changed after foreground completion: ${JSON.stringify({ foregroundCompleteState, stableRecovery })}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&pendingControl=1&detailDelay=800`);
	try {
		await page.waitForFunction(() => window.__PENA_RECENT_SYNC__?.detailsInFlight === true && window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive === false, null, { timeout: 12000 });
	} catch (error) {
		const diagnostic = await page.evaluate(() => ({
			prefetch: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			sync: window.__PENA_RECENT_SYNC__ || null,
			restCalls: window.nativeRestCalls || [],
			stored: JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'chat9000') || null
		}));
		throw new Error(`Silent mandatory verification was not observed: ${JSON.stringify(diagnostic)}; ${error.message}`);
	}
	const integratedVerification = await page.evaluate(() => ({
		originalActive: window.__PENA_NATIVE_PREFETCH__?.status?.().originalActive,
		overlayVisible: !!document.querySelector('.recent-host .pena-native-original-load-guard'),
		phase: window.__PENA_RECENT_SYNC__?.phase,
		detailsSilent: window.__PENA_RECENT_SYNC__?.detailsSilent
	}));
	assert.deepEqual(integratedVerification, {
		originalActive: false,
		overlayVisible: false,
		phase: 'verifying',
		detailsSilent: true
	}, `Mandatory-dialog verification reopened a second loading state: ${JSON.stringify(integratedVerification)}`);
	await page.waitForFunction(() => {
		const prefetch = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const sync = window.__PENA_RECENT_SYNC__;
		return prefetch?.loadedModes?.includes('chats') && prefetch.originalActive === false && !sync?.detailsInFlight && !sync?.inFlight;
	}, null, { timeout: 12000 });
	assert.equal(await page.locator('.recent-host .pena-native-original-load-guard').count(), 0, 'Loader remained after the unified catalog and folder verification cycle');

	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&managedApi=1&restDelay=250`);
	await page.locator('.recent-host .pena-native-load-guard:not([hidden])').waitFor({ state: 'visible', timeout: 3000 });
	const startupLoader = await page.locator('.recent-host .pena-native-load-guard:not([hidden])').evaluate(guard => {
		const card = guard.querySelector('.pena-native-load-card');
		const outer = guard.getBoundingClientRect();
		const inner = card.getBoundingClientRect();
		return inner.top - outer.top;
	});
	assert.ok(startupLoader >= 18 && startupLoader <= 30, `Catalog loader is not near the top: ${startupLoader}`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const taskCalls = (window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length;
		return status?.loadedModes?.includes('chats') && status?.loadedModes?.includes('tasks') &&
			status.active === false && status.apiActive === false && status.taskCatalogComplete === true &&
			window.__PENA_RECENT_SYNC__?.gateReady && taskCalls > 0;
	}, null, { timeout: 8000 });
	const taskCallsBeforeSwitch = await page.evaluate(() => (window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length);
	await switchMode(page);
	await page.waitForTimeout(500);
	assert.equal(await page.locator('.task-host .pena-native-load-guard:not([hidden])').count(), 0,
		'Switching to an eagerly loaded task catalog restarted the blocking loader');
	assert.equal(await page.evaluate(() => (window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length), taskCallsBeforeSwitch,
		'Switching to a fresh task catalog restarted tasks.task.list');
	const loadedModes = await page.evaluate(() => window.__PENA_NATIVE_PREFETCH__.status().loadedModes.slice().sort());
	assert.deepEqual(loadedModes, ['chats', 'tasks'], 'Startup did not build both page-lifetime catalogs');
	await switchMode(page);
	await page.waitForTimeout(500);
	assert.equal(await page.evaluate(() => window.__PENA_NATIVE_PREFETCH__.status().active), false, 'Returning to an already loaded mode restarted traversal');

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&restDelay=350`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.apiActive && status?.apiMode === 'all';
	}, null, { timeout: 3000 });
	const initialLoaderValue = await page.locator('.recent-host .pena-native-original-load-guard .pena-native-load-value').textContent();
	assert.notEqual(initialLoaderValue, '0%', 'Loader displayed a false zero-percent state before Bitrix returned the total');
	await switchMode(page);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const taskCalls = (window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length;
		return status?.loadedModes?.includes('tasks') && !status.apiActive && taskCalls > 0;
	}, null, { timeout: 12000 });
	const switchedWhileLoading = await page.evaluate(() => ({
		loadedModes: window.__PENA_NATIVE_PREFETCH__.status().loadedModes,
		taskListCalls: window.nativeRestCalls.filter(call => call.method === 'tasks.task.list').length,
		taskCount: window.__PENA_NATIVE_PREFETCH__.status().modeCounts.tasks || 0
	}));
	assert.ok(switchedWhileLoading.taskListCalls > 0 && switchedWhileLoading.taskCount >= 21,
		`Switching during the initial chat load skipped task catalog synchronization: ${JSON.stringify(switchedWhileLoading)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=tasks&taskRecentGeneric=1&nativeCatalog=1&passThrough=1`);
	try {
		await page.waitForFunction(() => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const stored = JSON.parse(localStorage.getItem('pena.dialogControl.v1.tasks') || '[]');
			return status?.loadedModes?.includes('tasks') && stored.filter(item => item.type !== 'folder').length >= 21;
		}, null, { timeout: 12000 });
	} catch (error) {
		const diagnostic = await page.evaluate(() => ({
			prefetch: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			sync: window.__PENA_RECENT_SYNC__ || null,
			stored: JSON.parse(localStorage.getItem('pena.dialogControl.v1.tasks') || '[]'),
			restCalls: window.nativeRestCalls || [],
			batchSizes: window.nativeBatchSizes || []
		}));
		throw new Error(`Task catalog did not complete: ${JSON.stringify(diagnostic)}; ${error.message}`);
	}
	const taskCatalogState = await page.evaluate(() => ({
		modeCount: window.__PENA_NATIVE_PREFETCH__?.status?.().modeCounts?.tasks || 0,
		stored: JSON.parse(localStorage.getItem('pena.dialogControl.v1.tasks') || '[]').filter(item => item.type !== 'folder').length,
		taskListCalls: (window.nativeRestCalls || []).filter(call => call.method === 'tasks.task.list').length
	}));
	assert.ok(taskCatalogState.modeCount >= 21 && taskCatalogState.stored >= 21 && taskCatalogState.taskListCalls > 0,
		`Task chats stayed limited to the native viewport: ${JSON.stringify(taskCatalogState)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&taskRecentGeneric=1&nativeCatalog=1&passThrough=1&catalogRows=260&taskCatalogRows=260`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		const stored = JSON.parse(localStorage.getItem('pena.dialogControl.v1.tasks') || '[]');
		return status?.loadedModes?.includes('tasks') && status.taskCatalogComplete === true &&
			stored.filter(item => item.type !== 'folder').length >= 265 && !status.apiActive;
	}, null, { timeout: 12000 });
	const deepTaskCatalog = await page.evaluate(() => {
		const tasks = JSON.parse(localStorage.getItem('pena.dialogControl.v1.tasks') || '[]').filter(item => item.type !== 'folder');
		return {
			stored: tasks.length,
			ids: tasks.map(item => item.id).sort(),
			oldTask: tasks.find(item => item.id === 'chat404') || null,
			taskListCalls: window.nativeRestCalls.filter(call => call.method === 'tasks.task.list').length,
			taskStarts: window.nativeRestCalls.filter(call => call.method === 'tasks.task.list').map(call => call.start)
		};
	});
	const exactDeepTaskIds = [
		'chat225', 'chat5', 'chat77',
		...Array.from({ length: 260 }, (_, index) => `chat${1000 + index}`),
		...Array.from({ length: 260 }, (_, index) => `chat${50000 + index}`),
		'chat101', 'chat102', 'chat303', 'chat404', 'chat405'
	].sort();
	assert.equal(deepTaskCatalog.stored, exactDeepTaskIds.length,
		`Multi-page task catalog stopped before all available tasks: ${JSON.stringify(deepTaskCatalog)}`);
	assert.deepEqual(deepTaskCatalog.taskStarts, [0, 50, 100, 150, 200, 250],
		`Task catalog did not follow canonical 50-row START windows: ${JSON.stringify(deepTaskCatalog)}`);
	assert.deepEqual(deepTaskCatalog.ids, exactDeepTaskIds,
		`Multi-page task catalog lost or invented task identities: ${JSON.stringify(deepTaskCatalog)}`);
	assert.equal(deepTaskCatalog.oldTask?.addedAt, Date.parse('2024-01-15T09:00:00.000Z'),
		`Old task lost its real activity date and cannot be sorted chronologically: ${JSON.stringify(deepTaskCatalog.oldTask)}`);

	await page.evaluate(() => localStorage.clear());
	await page.goto(`${base}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&nativeFirst=1&passThrough=1&headTtl=120&taskTtl=120&deepIdle=50`);
	await page.waitForFunction(() => {
		const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
		return status?.freshModes?.includes('chats') && status.taskCatalogComplete === true && !status.apiActive;
	}, null, { timeout: 8000 });
	const beforeTtlRefresh = await page.evaluate(() => ({
		taskCalls: window.nativeRestCalls.filter(call => call.method === 'tasks.task.list').length,
		recentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get').length,
		taskFetchedAt: window.__PENA_NATIVE_PREFETCH__.status().taskCatalogFetchedAt
	}));
	await page.waitForTimeout(180);
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	try {
		await page.waitForFunction(before => {
			const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
			const taskCalls = window.nativeRestCalls.filter(call => call.method === 'tasks.task.list').length;
			const recentCalls = window.nativeRestCalls.filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get').length;
			return !status.apiActive && status.freshModes.includes('chats') && status.taskCatalogFetchedAt > before.taskFetchedAt &&
				taskCalls > before.taskCalls && recentCalls > before.recentCalls;
		}, beforeTtlRefresh, { timeout: 8000 });
	} catch (error) {
		const diagnostic = await page.evaluate(before => ({
			before,
			status: window.__PENA_NATIVE_PREFETCH__?.status?.() || null,
			taskCalls: window.nativeRestCalls.filter(call => call.method === 'tasks.task.list').length,
			recentCalls: window.nativeRestCalls.filter(call => call.method === 'im.recent.list' || call.method === 'im.recent.get').length,
			restCalls: window.nativeRestCalls
		}), beforeTtlRefresh);
		throw new Error(`Metadata TTL reconcile did not refresh head/task indexes without rematerializing: ${JSON.stringify(diagnostic)}`, { cause: error });
	}

  await page.goto(`${base}/tests/native-route-harness.html`);
	await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 3000 });
  assert.equal((await readOutput(page)).switchers, 1);

  assert.deepEqual(pageErrors, []);
	console.log('PASS native regressions: complete native traversal, atomic timeout recovery, sorting, search, folders, markers and time tracking');
} finally {
  await browser.close();
  await closeServer();
}

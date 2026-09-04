import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { collectPageErrors, startHarnessServer } from './lib/harness-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = collectPageErrors(page);
const url = `${server.baseUrl}/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&passThrough=1&segments=1`;

const folderOrder = () => page.locator('.recent-host .pena-native-folder-tab').evaluateAll(tabs =>
	tabs.map(tab => tab.dataset.nativeFolderSortId));
const storedItems = () => page.evaluate(() => JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]'));

try {
	await page.goto(url);
	await page.locator('.recent-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	const aggregate = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Все папки' });
	const folder = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Тестовая папка' });
	const targetGroup = page.locator('.recent-host .pena-native-group-tab').filter({ hasText: 'Целевая группа' });

	assert.equal(await aggregate.getAttribute('draggable'), 'true', 'All folders must be reorderable');
	assert.equal(await aggregate.getAttribute('data-native-folder-id'), '', 'All folders must remain synthetic');
	await page.evaluate(() => { window.nativeScrollAudit = []; });
	await aggregate.dragTo(targetGroup);
	assert.equal((await storedItems()).some(item => item.id === '__all_folders__'), false,
		'All folders was persisted as a real folder');
	assert.equal((await storedItems()).some(item => item.segmentId === 'segment:target'), false,
		'All folders was assigned to a group');
	assert.deepEqual(await folderOrder(), ['__all_folders__', 'folder:test'],
		'Rejected group drop changed the visual order');

	const folderStrip = page.locator('.recent-host .pena-native-folder-tabs');
	const folderStripBox = await folderStrip.boundingBox();
	assert.ok(folderStripBox, 'Folder strip has no geometry');
	await aggregate.dragTo(folderStrip, {
		targetPosition: { x: Math.max(1, folderStripBox.width - 2), y: Math.max(1, folderStripBox.height / 2) }
	});
	await page.waitForFunction(() => Array.from(document.querySelectorAll('.recent-host .pena-native-folder-tab'))
		.map(tab => tab.dataset.nativeFolderSortId).join('|') === 'folder:test|__all_folders__');
	assert.deepEqual(await folderOrder(), ['folder:test', '__all_folders__'], 'All folders was not reordered');
	assert.deepEqual(await page.evaluate(() => window.nativeScrollAudit || []), [], 'Folder-tab reorder moved the native viewport');

	await page.reload();
	await page.locator('.recent-host .pena-native-folder-switcher').waitFor({ state: 'visible', timeout: 5000 });
	assert.deepEqual(await folderOrder(), ['folder:test', '__all_folders__'], 'Folder-tab order did not survive reload');
	const reloadedAggregate = page.locator('.recent-host .pena-native-folder-tab').filter({ hasText: 'Все папки' });
	const assignedRow = page.locator('.recent-host .pena-native-chat-row[data-id="chat225"]');
	await assignedRow.waitFor({ state: 'visible', timeout: 5000 });
	await page.waitForFunction(() => document.querySelector('.recent-host .pena-native-chat-row[data-id="chat225"]')?.getAttribute('draggable') === 'true');
	await page.evaluate(() => {
		window.nativeScrollAudit = [];
		window.folderDndEvents = [];
		document.addEventListener('pointercancel', event => window.folderDndEvents.push({
			type: event.type,
			types: Array.from(event.dataTransfer?.types || [])
		}), { once: true });
		const row = document.querySelector('.recent-host .pena-native-chat-row[data-id="chat225"]');
		const target = Array.from(document.querySelectorAll('.recent-host .pena-native-folder-tab'))
			.find(tab => !tab.dataset.nativeFolderId);
		row?.addEventListener('dragstart', event => window.folderDndEvents.push({ type: event.type, types: Array.from(event.dataTransfer?.types || []) }));
		row?.addEventListener('dragend', event => window.folderDndEvents.push({ type: event.type, types: Array.from(event.dataTransfer?.types || []) }));
		['dragenter', 'dragover', 'drop'].forEach(type => target?.addEventListener(type, event => {
			window.folderDndEvents.push({ type, types: Array.from(event.dataTransfer?.types || []) });
		}));
	});
	await assignedRow.dragTo(reloadedAggregate);
	await page.waitForTimeout(250);
	const unassigned = await page.evaluate(() => ({
		item: JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats') || '[]').find(item => item.id === 'chat225') || null,
		events: window.folderDndEvents || [],
		scrollEvents: window.nativeScrollAudit || []
	}));
	assert.ok(unassigned.item && !unassigned.item.folderId && !unassigned.item.color,
		`Dropping a dialog on All folders did not unassign it: ${JSON.stringify(unassigned)}`);
	assert.equal(unassigned.events.some(event => event.type === 'pointercancel'), true,
		'The harness did not reproduce Chromium pointercancel during HTML5 drag');
	assert.equal(unassigned.events.some(event => event.type === 'drop'), true,
		'The All folders target never accepted the native dialog drop');
	assert.deepEqual(unassigned.scrollEvents, [], 'Dialog unassign moved the native viewport');
	assert.deepEqual(await assignedRow.evaluate(row => ({
		folderId: row.dataset.penaNativeFolderId || '',
		colored: row.classList.contains('--native-colored')
	})), { folderId: '', colored: false }, 'Dialog marker survived folder removal');
	assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join(' | ')}`);
	console.log('PASS native folder DnD: aggregate reorder, no group binding, reload persistence and dialog unassign');
} finally {
	await browser.close();
	await server.close();
}

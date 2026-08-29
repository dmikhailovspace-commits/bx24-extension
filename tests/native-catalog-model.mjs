import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const catalog = require('../extension/native-catalog.js');

const {
	buildIndex,
	mergeRecentItems,
	selectRows,
	getVirtualWindow,
	captureAnchor,
	restoreAnchor
} = catalog;

function ids(rows) {
	return rows.map(row => String(row.id));
}

function testBrowserPublication() {
	const source = readFileSync(new URL('../extension/native-catalog.js', import.meta.url), 'utf8');
	const sandbox = { window: {} };
	vm.runInNewContext(source, sandbox, { filename: 'native-catalog.js' });
	assert.equal(typeof sandbox.window.__PENA_NATIVE_CATALOG__?.selectRows, 'function');
}

function testBuildIndex() {
	const first = { id: ' 42 ', title: '  Alpha   Chat ' };
	const second = { id: 'CHAT7', dialogId: 'chat8', title: 'alpha chat' };
	const index = buildIndex([first, second]);

	assert.equal(index.byId.get('user42'), first);
	assert.equal(index.byId.get('chat7'), second);
	assert.equal(index.byId.get('chat8'), second);
	assert.deepEqual(index.byTitle.get('alpha chat'), [first, second]);
}

function testMergeRecentItems() {
	const existing = [
		{ id: 'folder:team', type: 'folder', title: 'Team', color: '#eeeeee', icon: 'folder', segmentId: 'work' },
		{ id: 'chat1', title: 'Old title', folderId: 'folder:team', segmentId: 'work', color: '#123456', colorMode: 'none', icon: 'star', recentManaged: true },
		{ id: 'CHAT1', title: 'Duplicate title' },
		{ id: 'user2', title: 'User two', folderId: 'folder:team', color: '#654321' }
	];
	const chatOne = {
		id: 'chat1',
		restDialogId: 'chat1',
		displayTitle: 'Fresh title',
		displayLastText: 'Fresh message',
		lastMessageTs: 300,
		unreadCount: 4,
		hasUnread: true,
		avatarUrl: 'https://cdn.example.test/avatar-1.png',
		avatarColor: '#dbeafe',
		lastReadMessageId: 12,
		isTask: false,
		color: '#ffffff'
	};
	const recent = new Map([
		['chat1', chatOne],
		['CHAT1', chatOne],
		['2', { id: 'user2', displayTitle: 'Updated user', lastMessageTs: 200, unreadCount: 0, hasUnread: false, isTask: false }],
		['chat3', { id: 'chat3', displayTitle: 'Task only', lastMessageTs: 400, isTask: true }],
		['chat4', { id: 'chat4', displayTitle: 'New chat', lastMessageTs: 100, isTask: false }]
	]);
	const snapshot = JSON.stringify(existing);
	const merged = mergeRecentItems(existing, recent, 'chats');

	assert.equal(JSON.stringify(existing), snapshot, 'merge must not mutate existing items');
	assert.equal(merged.filter(item => item.type !== 'folder').length, 3, 'duplicates and task metadata must not leak into chats');
	const updated = merged.find(item => item.id === 'chat1');
	assert.equal(updated.title, 'Fresh title');
	assert.equal(updated.lastMessageTs, 300);
	assert.equal(updated.unreadCount, 4);
	assert.equal(updated.recentManaged, true);
	assert.equal(updated.folderId, 'folder:team');
	assert.equal(updated.segmentId, 'work');
	assert.equal(updated.color, '#123456');
	assert.equal(updated.colorMode, 'none');
	assert.equal(updated.icon, 'star');
	assert.equal(updated.avatarUrl, 'https://cdn.example.test/avatar-1.png');
	assert.equal(updated.avatarColor, '#dbeafe');
	assert.equal(updated.lastReadMessageId, 12);
	assert.equal(merged.find(item => item.id === 'user2').color, '#654321');
	assert.ok(merged.some(item => item.id === 'chat4'));
	assert.ok(!merged.some(item => item.id === 'chat3'));

	const tasks = mergeRecentItems([], recent, 'tasks');
	assert.deepEqual(ids(tasks), ['chat3']);
}

function makeSelectionFixture() {
	return [
		{ id: 'folder:one', type: 'folder', title: 'Folder', segmentId: 'segment:a' },
		{ id: 'a', title: 'Alpha', lastText: 'ordinary text', lastMessageTs: 100, color: '#300000', unreadCount: 1, folderId: 'folder:one', recentManaged: true },
		{ id: 'b', title: 'Beta', lastText: 'needle in message', lastMessageTs: 300, color: '', unreadCount: 0, recentManaged: true },
		{ id: 'c', title: 'Gamma', lastText: 'ordinary text', lastMessageTs: 0, color: '#100000', hasLater: true, recentManaged: true },
		{ id: 'd', title: 'Delta Needle', lastText: '', lastMessageTs: 200, color: '#200000', segmentId: 'segment:b', recentManaged: true },
		{ id: 'e', title: 'Epsilon', lastText: '', lastMessageTs: 0, color: '', recentManaged: true },
		{ id: 'task6', title: 'Task', lastMessageTs: 500, isTask: true, recentManaged: true }
	];
}

function testSelectRows() {
	const items = makeSelectionFixture();
	const base = { items, recentById: new Map(), mode: 'chats', segmentId: '', folderId: '', unreadOnly: false };

	assert.deepEqual(ids(selectRows({ ...base, sortMode: 'date', sortDirection: 'asc' })), ['a', 'd', 'b', 'c', 'e']);
	assert.deepEqual(ids(selectRows({ ...base, sortMode: 'date', sortDirection: 'desc' })), ['b', 'd', 'a', 'c', 'e']);
	assert.deepEqual(ids(selectRows({ ...base, sortMode: 'color', sortDirection: 'asc' })), ['c', 'd', 'a', 'b', 'e']);
	assert.deepEqual(ids(selectRows({ ...base, sortMode: 'color', sortDirection: 'desc' })), ['a', 'd', 'c', 'b', 'e']);
	assert.deepEqual(ids(selectRows({ ...base, query: 'NEEDLE', sortMode: 'date', sortDirection: 'desc' })), ['b', 'd']);
	assert.deepEqual(ids(selectRows({ ...base, unreadOnly: true, sortMode: 'date', sortDirection: 'desc' })), ['a', 'c']);
	assert.deepEqual(ids(selectRows({ ...base, segmentId: 'segment:a', sortMode: 'date', sortDirection: 'desc' })), ['a']);
	assert.deepEqual(ids(selectRows({ ...base, folderId: 'folder:one', sortMode: 'date', sortDirection: 'desc' })), ['a']);

	const placedModeConflict = selectRows({
		...base,
		items: [
			{ id: 'folder:saved', type: 'folder', title: 'Saved' },
			{ id: 'chat77', title: 'Saved chat', folderId: 'folder:saved', recentManaged: true }
		],
		recentById: new Map([['chat77', { id: 'chat77', displayTitle: 'Saved chat', isTask: true }]]),
		folderId: 'folder:saved'
	});
	assert.deepEqual(ids(placedModeConflict), ['chat77'], 'REST mode metadata hid a dialog from its saved folder');

	const explicitMissingDate = selectRows({
		...base,
		items: [
			{ id: 'stale', title: 'Stale', addedAt: 999, recentManaged: true },
			{ id: 'fresh', title: 'Fresh', lastMessageTs: 10, recentManaged: true }
		],
		recentById: new Map([['stale', { id: 'stale', lastMessageTs: 0, isTask: false }]]),
		sortMode: 'date',
		sortDirection: 'desc'
	});
	assert.deepEqual(ids(explicitMissingDate), ['fresh', 'stale']);

	const tieRows = selectRows({
		...base,
		items: [
			{ id: 'first', title: 'First', lastMessageTs: 100, recentManaged: true },
			{ id: 'second', title: 'Second', lastMessageTs: 100, recentManaged: true }
		],
		sortMode: 'date',
		sortDirection: 'desc'
	});
	assert.deepEqual(ids(tieRows), ['first', 'second'], 'equal values must retain input order');
}

function testVirtualWindowAndAnchor() {
	assert.deepEqual(getVirtualWindow({ count: 5000, rowHeight: 48, scrollTop: 4800, viewportHeight: 480, overscan: 3 }), {
		start: 97,
		end: 113,
		topSpacer: 4656,
		bottomSpacer: 234576,
		totalHeight: 240000
	});
	assert.deepEqual(getVirtualWindow({ count: 0, rowHeight: 48, scrollTop: 100, viewportHeight: 480, overscan: 3 }), {
		start: 0,
		end: 0,
		topSpacer: 0,
		bottomSpacer: 0,
		totalHeight: 0
	});

	const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
	const anchor = captureAnchor({ rows, rowHeight: 48, scrollTop: 107 });
	assert.deepEqual(anchor, { id: 'c', offset: 11, index: 2 });
	assert.equal(restoreAnchor({ rows: [rows[2], rows[0], rows[1], rows[3]], anchor, rowHeight: 48 }), 11);
	assert.equal(restoreAnchor({ rows: [rows[0], rows[1], rows[3]], anchor, rowHeight: 48 }), 107);
	assert.equal(restoreAnchor({ rows: [], anchor, rowHeight: 48, fallbackScrollTop: 33 }), 33);
}

function testTenThousandItems() {
	const existing = [];
	const recent = new Map();
	for (let index = 0; index < 10000; index += 1) {
		const id = `chat${index + 1}`;
		existing.push({
			id,
			title: `Old ${index}`,
			folderId: index % 500 === 0 ? 'folder:important' : '',
			segmentId: index % 700 === 0 ? 'segment:priority' : '',
			color: index % 9 === 0 ? '#abcdef' : '',
			icon: index % 11 === 0 ? 'star' : '',
			recentManaged: true
		});
		const meta = {
			id,
			displayTitle: `Dialog ${index}`,
			displayLastText: index % 113 === 0 ? `special needle ${index}` : `message ${index}`,
			lastMessageTs: index % 17 === 0 ? 0 : index + 1,
			unreadCount: index % 13 === 0 ? 2 : 0,
			hasUnread: index % 13 === 0,
			isTask: false
		};
		recent.set(id, meta);
		if (index % 10 === 0) recent.set(id.toUpperCase(), meta);
	}

	const startedAt = performance.now();
	const merged = mergeRecentItems(existing, recent, 'chats');
	const mergeDuration = performance.now() - startedAt;
	assert.equal(merged.length, 10000, 'aliases must not create duplicate catalog rows');
	assert.equal(merged[0].folderId, 'folder:important');
	assert.equal(merged[0].segmentId, 'segment:priority');
	assert.equal(merged[0].color, '#abcdef');
	assert.equal(merged[0].icon, 'star');

	const selectionStartedAt = performance.now();
	const selected = selectRows({
		items: merged,
		recentById: recent,
		mode: 'chats',
		query: '',
		segmentId: '',
		folderId: '',
		unreadOnly: false,
		sortMode: 'date',
		sortDirection: 'desc'
	});
	const selectionDuration = performance.now() - selectionStartedAt;
	assert.equal(selected.length, 10000);
	assert.equal(selected[0].id, 'chat10000');
	assert.equal(selected.at(-1).lastMessageTs, 0, 'missing dates must remain at the end');

	const searchResults = selectRows({
		items: merged,
		recentById: recent,
		mode: 'chats',
		query: 'special needle',
		sortMode: 'date',
		sortDirection: 'desc'
	});
	assert.ok(searchResults.length > 80 && searchResults.length < 100);
	assert.ok(searchResults.every(row => row.displayLastText.includes('special needle')));

	assert.ok(mergeDuration < 2000, `10000-item merge took ${mergeDuration.toFixed(1)} ms`);
	assert.ok(selectionDuration < 2000, `10000-item selection took ${selectionDuration.toFixed(1)} ms`);
	return { mergeDuration, selectionDuration };
}

const tests = [
	['browser publication', testBrowserPublication],
	['buildIndex', testBuildIndex],
	['mergeRecentItems', testMergeRecentItems],
	['selectRows', testSelectRows],
	['virtual window and anchors', testVirtualWindowAndAnchor]
];

for (const [name, test] of tests) {
	test();
	console.log(`ok - ${name}`);
}

const performanceResult = testTenThousandItems();
console.log(`ok - 10000 items (${performanceResult.mergeDuration.toFixed(1)} ms merge, ${performanceResult.selectionDuration.toFixed(1)} ms select)`);
console.log('native catalog model: all checks passed');

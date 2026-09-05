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

function extractInjectedFunction(source, name, nextName) {
	const start = source.indexOf(`function ${name}(`);
	const end = source.indexOf(`\n\tfunction ${nextName}(`, start);
	assert.ok(start >= 0 && end > start, `Cannot extract ${name} from injected.js`);
	return source.slice(start, end);
}

function testDialogIdentityReconcile() {
	const injectedSource = readFileSync(new URL('../extension/injected.js', import.meta.url), 'utf8');
	const functionSource = extractInjectedFunction(
		injectedSource,
		'_reconcileDialogControlRecentIdentities',
		'_hydrateDialogControlItemsFromRecent'
	);
	const normalizeId = value => String(value || '').trim().toLowerCase();
	const normalizeTitle = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
	const apiRecords = new Map();
	const reconcile = Function(
		'normId',
		'_normalizeDialogControlTitle',
		'_isDialogControlFallbackTitle',
		'_normalizeDialogControlRestDialogId',
		'_isDialogControlFolder',
		'_getDialogRecentMeta',
		`"use strict";\n${functionSource}\nreturn _reconcileDialogControlRecentIdentities;`
	)(
		normalizeId,
		normalizeTitle,
		() => false,
		normalizeId,
		item => item?.type === 'folder',
		id => apiRecords.get(id)
	);

	const candidates = new Map([
		['chat5042', { id: 'chat5042', restDialogId: 'chat5042', displayTitle: 'Canonical anchor' }],
		['chat5041', { id: 'chat5041', restDialogId: 'chat5041', displayTitle: 'Transient recycled title' }]
	]);
	const canonicalItems = [
		{ id: 'chat5042', dialogId: 'chat5042', title: 'Transient recycled title', folderId: 'folder:tasks', color: '#22c55e' },
		{ id: 'chat5041', dialogId: 'chat5041', title: 'Canonical anchor', recentManaged: true }
	];
	const canonicalSnapshot = JSON.parse(JSON.stringify(canonicalItems));
	assert.equal(reconcile(canonicalItems, candidates), 0, 'valid typed IDs must not be remapped by a stale unique title');
	assert.deepEqual(canonicalItems, canonicalSnapshot, 'valid typed ID reconciliation mutated the catalog');

	const restBackedItem = [{
		id: 'legacy-anchor',
		dialogId: 'chat5042',
		title: 'Transient recycled title',
		folderId: 'folder:tasks'
	}];
	assert.equal(reconcile(restBackedItem, candidates), 1, 'legacy identity was not reconciled');
	assert.equal(restBackedItem[0].id, 'chat5042', 'title overrode the canonical REST/dialog ID');
	assert.equal(restBackedItem[0].folderId, 'folder:tasks', 'identity migration lost user customization');

	const personalCollisionCandidates = new Map([
		['chat42', { id: 'chat42', entityKind: 'chat', restDialogId: 'chat42', displayTitle: 'Начальный 42' }],
		['user42', { id: 'user42', entityKind: 'user', restDialogId: '42', displayTitle: 'Марина Ваймер' }]
	]);
	const legacyPersonalItem = [{
		id: 'chat42',
		dialogId: 'chat42',
		title: 'Марина Ваймер',
		folderId: 'folder:leaders',
		color: '#22c55e'
	}];
	assert.equal(reconcile(legacyPersonalItem, personalCollisionCandidates), 1, 'proven legacy personal collision was not migrated');
	assert.deepEqual(legacyPersonalItem, [{
		id: 'user42',
		dialogId: '42',
		title: 'Марина Ваймер',
		folderId: 'folder:leaders',
		color: '#22c55e'
	}], 'chatN legacy personal identity did not migrate narrowly to userN');
	apiRecords.set('chat42', personalCollisionCandidates.get('chat42'));
	apiRecords.set('user42', personalCollisionCandidates.get('user42'));
	const recycledCandidates = new Map(personalCollisionCandidates);
	recycledCandidates.set('chat42', { ...recycledCandidates.get('chat42'), displayTitle: 'Марина Ваймер' });
	const recycledPersonal = [{ id: 'chat42', dialogId: 'chat42', title: 'Марина Ваймер', folderId: 'folder:leaders' }];
	assert.equal(reconcile(recycledPersonal, recycledCandidates), 1, 'recycled DOM title hid the proven personal collision');
	assert.equal(recycledPersonal[0].id, 'user42');
	assert.equal(recycledPersonal[0].folderId, 'folder:leaders');
	apiRecords.clear();

	const unrelatedPersonalCandidates = new Map([
		['chat42', { id: 'chat42', entityKind: 'chat', restDialogId: 'chat42', displayTitle: 'Начальный 42' }],
		['user43', { id: 'user43', entityKind: 'user', restDialogId: '43', displayTitle: 'Марина Ваймер' }]
	]);
	const unrelatedPersonalItem = [{ id: 'chat42', dialogId: 'chat42', title: 'Марина Ваймер' }];
	assert.equal(reconcile(unrelatedPersonalItem, unrelatedPersonalCandidates), 0, 'different numeric IDs triggered legacy collision migration');
	assert.equal(unrelatedPersonalItem[0].id, 'chat42', 'unrelated personal title overrode a valid chat ID');

	const additiveItems = [
		{ id: 'chat5042', dialogId: 'chat5042', title: 'Canonical anchor', recentManaged: true },
		{ id: 'legacy-anchor', dialogId: 'chat5042', title: 'Canonical anchor', folderId: 'folder:tasks', color: '#22c55e' }
	];
	const additiveSnapshot = JSON.parse(JSON.stringify(additiveItems));
	assert.equal(
		reconcile(additiveItems, candidates, { allowDestructive: false }),
		0,
		'additive hydration attempted destructive identity reconciliation'
	);
	assert.deepEqual(additiveItems, additiveSnapshot, 'pruneMissing:false removed or remapped a dialog');

	const hydrateSource = extractInjectedFunction(
		injectedSource,
		'_hydrateDialogControlItemsFromRecent',
		'_hydrateAllDialogControlModesFromRecent'
	);
	assert.match(
		hydrateSource,
		/allowDestructive:\s*pruneMissing/,
		'hydration does not fence identity reconciliation with pruneMissing'
	);
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

	const nativeDatePolicy = [
		{ id: 'synthetic-new', title: 'Synthetic new', recentManaged: true },
		{ id: 'synthetic-old', title: 'Synthetic old', recentManaged: true },
		{ id: 'real-new', title: 'Real new', recentManaged: true },
		{ id: 'real-old', title: 'Real old', recentManaged: true },
		{ id: 'unknown', title: 'Unknown', recentManaged: true }
	];
	const nativeDateMeta = new Map([
		['synthetic-new', { id: 'synthetic-new', lastMessageTs: 999999, lastMessageTsSource: 'native-order', nativeRecentRank: 0, isTask: false }],
		['synthetic-old', { id: 'synthetic-old', lastMessageTs: 999998, lastMessageTsSource: 'native-order', nativeRecentRank: 1, isTask: false }],
		['real-new', { id: 'real-new', lastMessageTs: 200, lastMessageTsSource: 'bitrix', nativeRecentRank: 3, isTask: false }],
		['real-old', { id: 'real-old', lastMessageTs: 100, lastMessageTsSource: 'bitrix', nativeRecentRank: 2, isTask: false }],
		['unknown', { id: 'unknown', lastMessageTs: 0, nativeRecentRank: 4, isTask: false }]
	]);
	const mergedDatePolicy = mergeRecentItems(nativeDatePolicy, nativeDateMeta, 'chats');
	assert.deepEqual(
		mergedDatePolicy.map(row => [row.id, row.lastMessageTsSource || '', row.nativeRecentRank]),
		[
			['synthetic-new', 'native-order', 0],
			['synthetic-old', 'native-order', 1],
			['real-new', 'bitrix', 3],
			['real-old', 'bitrix', 2],
			['unknown', '', 4]
		],
		'managed catalog dropped date-source or native-rank metadata'
	);
	assert.deepEqual(
		ids(selectRows({ ...base, items: nativeDatePolicy.slice(2, 4), recentById: nativeDateMeta, sortMode: 'date', sortDirection: 'desc' })),
		['real-new', 'real-old'],
		'two real Bitrix timestamps must sort by time rather than stale native rank'
	);
	assert.deepEqual(
		ids(selectRows({ ...base, items: nativeDatePolicy.slice(0, 2).reverse(), recentById: nativeDateMeta, sortMode: 'date', sortDirection: 'desc' })),
		['synthetic-new', 'synthetic-old'],
		'two synthetic timestamps must preserve the proven native rank'
	);
	assert.deepEqual(
		ids(selectRows({ ...base, items: [nativeDatePolicy[0], nativeDatePolicy[3]], recentById: nativeDateMeta, sortMode: 'date', sortDirection: 'desc' })),
		['synthetic-new', 'real-old'],
		'a synthetic rank surrogate must not be compared to real wall-clock time'
	);
	assert.deepEqual(
		ids(selectRows({ ...base, items: [nativeDatePolicy[4], nativeDatePolicy[2]], recentById: nativeDateMeta, sortMode: 'date', sortDirection: 'asc' })),
		['real-new', 'unknown'],
		'rows without a date must stay at the end for ascending sort too'
	);
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
	['dialog identity reconcile', testDialogIdentityReconcile],
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

// A stale alias from a recycled DOM row must not redirect a mandatory tail
// access check to another dialog, even when the cached metadata looks valid.
const accessSource = readFileSync(new URL('../extension/injected.js', import.meta.url), 'utf8');
const accessStart = accessSource.indexOf('async function _verifyDialogNativeMissingIds(');
const accessEnd = accessSource.indexOf('\n\tasync function _probeDialogNativeTail(', accessStart);
assert.ok(accessStart >= 0 && accessEnd > accessStart);
const accessMeta = new Map([
  ['chat1106', { restDialogId: 'chat1058', displayTitle: 'Recycled alias' }],
  ['chat1107', { restDialogId: 'chat1107' }]
]);
let checkedDialogIds;
const verifyMissing = Function('normId', '_DIALOG_NATIVE_MISSING_VERIFY_LIMIT',
  '_isDialogNetworkAvailable', '_getDialogRecentMeta', '_normalizeDialogControlRestDialogId',
  '_refreshDialogRecentMandatoryDetails', '_dialogRecentMeta', '_isDialogRecentUnavailable',
  `${accessSource.slice(accessStart, accessEnd)}; return _verifyDialogNativeMissingIds;`
)(value => String(value), 12, () => true, id => accessMeta.get(id), value => String(value),
  async (_target, _visible, mandatory, options) => {
    assert.equal(options.forceAvailabilityCheck, true);
    checkedDialogIds = [...mandatory.values()].map(record => record.item.dialogId);
  }, accessMeta, () => false);
const verifiedMissing = await verifyMissing('chats', ['chat1106', 'chat1107']);
assert.deepEqual(checkedDialogIds, ['chat1106', 'chat1107']);
assert.deepEqual(verifiedMissing.available, ['chat1106', 'chat1107']);
console.log('ok - tail access checks ignore stale recycled REST aliases');

const tailRows = [1107, 1098, 1101, 1106, 1099, 1103, 1100, 1104, 1102, 1105]
  .map(id => ({ id: `chat${id}`, style: { transform: String((id - 1098) * 58) }, getBoundingClientRect: () => ({ top: 0 }) }));
const physicalTail = Function('_getDialogNativeSourceRows', 'normId', 'getChatIdFromElement', 'getComputedStyle', 'DOMMatrixReadOnly',
  '_DIALOG_NATIVE_TAIL_ANCHOR_COUNT',
  `${extractInjectedFunction(accessSource, '_getDialogNativePhysicalTailIds', '_recordDialogNativeMaterialization')}; return _getDialogNativePhysicalTailIds;`
)(() => tailRows, value => String(value), row => row.id,
  () => ({ position: 'absolute', top: '0px', transform: 'none' }),
  class { constructor(value) { this.m42 = Number(value); } }, 5);
assert.deepEqual(physicalTail({}), ['chat1103', 'chat1104', 'chat1105', 'chat1106', 'chat1107']);
tailRows.reverse();
assert.deepEqual(physicalTail({}), ['chat1103', 'chat1104', 'chat1105', 'chat1106', 'chat1107']);
console.log('ok - physical tail anchors survive DOM presentation reordering');

const mergeKeys = Function(`${extractInjectedFunction(accessSource, '_mergeDialogControlNativeSortKeys', '_applyDialogControlNativeSort')}; return _mergeDialogControlNativeSortKeys;`)();
// Independent specification: insert each new key before the next known key,
// or after the previous one; never reorder the saved native sequence.
const referenceMerge = (saved, current) => {
  const output = saved.slice();
  current.forEach((key, index) => {
    if (output.includes(key)) return;
    const next = current.slice(index + 1).find(candidate => output.includes(candidate));
    const previous = current.slice(0, index).reverse().find(candidate => output.includes(candidate));
    output.splice(next !== undefined ? output.indexOf(next) : previous !== undefined ? output.indexOf(previous) + 1 : output.length, 0, key);
  });
  return output;
};
let seed = 7391;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);
for (let run = 0; run < 1000; run += 1) {
  const saved = Array.from({length: 30}, (_, i) => `chat${i}`).filter(() => random() > .4);
  const current = Array.from({length: 45}, (_, i) => `chat${i}`).filter(() => random() > .3);
  for (let i = current.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [current[i], current[j]] = [current[j], current[i]]; }
  if (run % 10 === 0) current.push(current[0]);
  assert.deepEqual(mergeKeys(saved, current), referenceMerge(saved, current));
}
const savedKeys = Array.from({length: 5000}, (_, i) => `chat${i}`);
const recycledKeys = Array.from({length: 5024}, (_, i) => `chat${4976 + i}`);
const mergeAt = performance.now();
const fullKeys = mergeKeys(savedKeys, recycledKeys);
const keyMergeMs = performance.now() - mergeAt;
assert.deepEqual(fullKeys, Array.from({length: 10000}, (_, i) => `chat${i}`));
assert.ok(keyMergeMs < 100, `Native key merge took ${keyMergeMs.toFixed(1)} ms`);
console.log(`ok - native key merge: 1000 randomized windows and 10000 keys in ${keyMergeMs.toFixed(1)} ms`);

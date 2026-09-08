import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(process.env.PENA_SWITCHER_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`\tfunction ${name}(`);
  assert.ok(start >= 0, `Missing production function ${name}`);
  const next = /\n\t(?:async )?function /.exec(source.slice(start + 1));
  return source.slice(start, next ? start + 1 + next.index : undefined);
}
const renderSource = extract('_renderDialogControlNativeSwitcher');
const boundary = renderSource.indexOf('\t\tconst switcherSig = [');
assert.ok(boundary > 0);
// Execute the actual render preparation and actual filters. Stop before DOM tab
// construction; browser/native suites separately cover those event handlers.
const renderProbe = renderSource.slice(0, boundary) + `
return { groups: Object.fromEntries(groupStatuses), segment: segmentStatus,
  folders: Object.fromEntries(folderStatuses), ids: filteredSegmentDialogItems.map(item => item.id) };
}`;
const phases = [];
function phase(name, run) {
  const start = performance.now();
  try { phases.push({ name, status: 'PASS', ...run(), ms: performance.now() - start }); }
  catch (error) { phases.push({ name, status: 'FAIL', error: error.stack, ms: performance.now() - start }); }
}
function fixture() {
  const state = { calls: new Map(), active: 'g1' };
  const rows = [
    { id: 'f1', type: 'folder', segmentId: 'g1', color: '#ff0000' },
    { id: 'f2', type: 'folder', segmentId: 'g2', color: '#0000ff' },
    { id: 'a', title: 'Alpha', folderId: 'f1', hasUnread: true, unreadCount: 2, projectIndex: 1 },
    { id: 'b', title: 'Beta', folderId: 'f1', segmentId: 'g2', projectIndex: 2 },
    { id: 'c', title: 'Gamma', folderId: 'f2', hasMention: true, projectIndex: 1 },
    { id: 'd', title: 'Delta', segmentId: 'g1', hasLater: true, projectIndex: 2 },
    { id: 'gone', title: 'Gone', unavailable: true, folderId: 'f1' }
  ];
  const noop = () => {};
  const sandbox = {
    window: {}, IS_OL_FRAME: false, _currentPanelMode: 'tasks', filters: {},
    _dialogControlNativeWorkspaceTab: '',
    _isDialogControlNativeMode: () => true, _clearDialogControlNativeSwitcher: noop,
    _ensureDialogControlNativeSwitcher: () => ({ classList: { toggle: noop, remove: noop }, style: { removeProperty: noop } }),
    _markDialogControlNativeMutation: noop,
    _getDialogControlSegments: () => [],
    _getDialogControlSegmentTabs: () => [{ id: '', isAll: true }, { id: 'g1' }, { id: 'g2' }],
    _getDialogControlActiveSegmentId: () => state.active,
    _getDialogControlViewPrefs: () => ({}),
    _getDialogControlNativeActiveFolderId: () => '',
    _setDialogControlNativeActiveFolderId: noop,
    buildChatElementIndex: () => new Map(),
    _isDialogControlFolder: item => item.type === 'folder',
    _isDialogControlItemUnavailable: item => item.unavailable === true,
    _getDialogControlItemLiveMeta: item => ({ ...item }),
    _getDialogRecentMeta: () => null,
    normId: id => String(id || '')
  };
  vm.createContext(sandbox);
  for (const name of ['_getDialogControlNativeDialogItemsForSegment', '_getDialogControlNativeFoldersForSegment',
    '_getDialogControlNotificationStatus', '_getDialogControlItemFilterMeta', '_matchesDialogControlGlobalFilters', 'matchByFilters']) {
    vm.runInContext(extract(name), sandbox);
  }
  const actualFilter = sandbox._matchesDialogControlGlobalFilters;
  sandbox._matchesDialogControlGlobalFilters = (item, index) => {
    state.calls.set(item, (state.calls.get(item) || 0) + 1);
    return actualFilter(item, index);
  };
  vm.runInContext(renderProbe, sandbox);
  return { rows, state, sandbox, render() {
    state.calls.clear();
    const result = JSON.parse(JSON.stringify(sandbox._renderDialogControlNativeSwitcher({}, rows)));
    assert.equal(state.calls.size, rows.filter(item => item.type !== 'folder').length);
    assert.ok([...state.calls.values()].every(count => count === 1), `filter calls per item: ${JSON.stringify([...state.calls].map(([item, count]) => [item.id, count]))}`);
    return result;
  } };
}
phase('one actual filter pass preserves all/group/colored-folder membership and unread counts', () => {
  const f = fixture(); const result = f.render();
  assert.deepEqual(result.ids, ['a', 'b', 'd']);
  assert.equal(result.groups[''].childCount, 4);
  assert.equal(result.groups.g1.childCount, 3);
  assert.equal(result.groups.g2.childCount, 2);
  assert.equal(result.groups[''].unreadCount, 4);
  assert.equal(result.segment.unreadCount, 3);
  assert.equal(result.folders.f1.childCount, 2);
  assert.equal(result.folders.f1.unreadCount, 2);
  return { filterCalls: f.state.calls.size, groups: result.groups };
});
phase('unread, project, search and reset are fresh on each subsequent render', () => {
  const f = fixture();
  f.render();
  f.sandbox.filters = { unreadOnly: true };
  assert.deepEqual(f.render().ids, ['a', 'd']);
  f.rows.find(item => item.id === 'b').hasUnread = true;
  assert.deepEqual(f.render().ids, ['a', 'b', 'd']);
  f.sandbox.filters = { projectIndexes: [2] };
  assert.deepEqual(f.render().ids, ['b', 'd']);
  f.sandbox.filters = { query: 'alpha' };
  assert.deepEqual(f.render().ids, ['a']);
  f.rows.find(item => item.id === 'a').title = 'Renamed';
  assert.deepEqual(f.render().ids, []);
  f.sandbox.filters = {};
  assert.deepEqual(f.render().ids, ['a', 'b', 'd']);
  return { renders: 7, staleFilterResults: 0 };
});
phase('folder color changes and source moves do not retain previous segment membership', () => {
  const f = fixture(); f.render();
  f.rows[0].color = '#00ff00';
  assert.deepEqual(f.render().ids, ['a', 'b', 'd']);
  f.rows[0].segmentId = 'g2';
  assert.deepEqual(f.render().ids, ['d']);
  f.state.active = 'g2';
  const result = f.render();
  assert.deepEqual(result.ids, ['a', 'b', 'c']);
  assert.equal(result.folders.f1.childCount, 2);
  assert.equal(result.groups.g2.childCount, 3);
  return { freshColorAndMembership: true };
});
phase('2000 dialogs shared by folder/group are each filtered once per render', () => {
  const f = fixture();
  f.rows.splice(2, f.rows.length - 2, ...Array.from({ length: 2000 }, (_, index) => ({
    id: `task${index}`, title: `Task ${index}`, folderId: 'f1', segmentId: 'g2', projectIndex: index % 2
  })));
  const result = f.render();
  assert.equal(result.ids.length, 2000);
  assert.equal(result.groups.g1.childCount, 2000);
  assert.equal(result.groups.g2.childCount, 2000);
  return { dialogs: 2000, filterCalls: f.state.calls.size };
});
mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
const report = { sourceSha256: createHash('sha256').update(source).digest('hex'), phases };
writeFileSync(new URL('./artifacts/native-switcher-filter-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (phases.some(item => item.status !== 'PASS')) process.exitCode = 1;

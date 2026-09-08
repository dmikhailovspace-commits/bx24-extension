import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(process.env.PENA_TIME_CANDIDATE_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
const extract = name => {
  const start = source.indexOf(`\tfunction ${name}(`);
  assert.ok(start >= 0, `Missing production function: ${name}`);
  const next = /\n\t(?:async )?function /.exec(source.slice(start + 1));
  return source.slice(start, next ? start + 1 + next.index : undefined);
};
function fixture(count, canonical = true) {
  const state = { itemReads: 0, metaReads: 0, meta: [], items: { tasks: [], chats: [] } };
  const titles = new Map();
  const ids = Array.from({ length: count }, (_, index) => String(index + 1));
  // This rendering benchmark starts after the project catalog has been validated.
  state.projectTaskIds = new Set(ids);
  for (const id of ids) {
    state.items.tasks.push({ taskId: id, title: `Task ${id}` });
    if (canonical) titles.set(id, `Canonical ${id}`);
    state.meta.push({ id: `chat${10000 + Number(id)}`, taskId: String(10000 + Number(id)), isTask: true });
  }
  const sandbox = {
    _dialogTimeTaskTitles: titles, _dialogTimeTaskChatDialogIds: new Map(), _dialogTimeTaskIdsByChatDialogId: new Map(),
    _dialogTimeManualSelectedTask: null, normId: value => String(value || '').trim(),
    // Candidate rendering cost starts after project membership is confirmed.
    // The scope suite separately rejects foreign native/cache candidates.
    _isDialogTimeWritableTask: id => state.projectTaskIds.has(String(id)),
    _getDialogTimeWritableTaskIds: () => new Set(state.projectTaskIds),
    _getDialogTimeSelectedRange: () => ({ from: '2026-09-08', to: '2026-09-08' }),
    _isDialogControlFolder: item => item?.type === 'folder',
    _isDialogTimeProjectTask: id => state.projectTaskIds.has(String(id)),
    _extractTaskIdFromTaskUrl: value => /task\/(\d+)/.exec(value)?.[1] || '',
    _getDialogControlItemsForMode: mode => { state.itemReads += 1; return state.items[mode]; },
    _getDialogRecentUniqueMeta: () => { state.metaReads += 1; return state.meta; },
    _getDialogTimeEligibleTaskIds: () => ids, _getDialogTimeTaskEligibilityForDisplay: () => true
  };
  vm.createContext(sandbox);
  for (const name of ['_findDialogTimeTaskItem', '_isDialogTimePlaceholderTaskTitle', '_getDialogTimeTaskTitle', '_getDialogTimeTaskChatDialogId', '_getDialogTimeTaskCandidates']) vm.runInContext(extract(name), sandbox);
  return { state, sandbox, ids, get: (data = null, visits = []) => JSON.parse(JSON.stringify(sandbox._getDialogTimeTaskCandidates(data, visits))) };
}
const phases = [];
function phase(name, run) {
  const start = performance.now();
  try { phases.push({ name, status: 'PASS', ...run(), ms: performance.now() - start }); }
  catch (error) { phases.push({ name, status: 'FAIL', error: error.message, ms: performance.now() - start }); }
}
phase('2000 canonical tasks without CHAT_ID require no item scans and one metadata scan', () => {
  const f = fixture(2000);
  const result = f.get();
  assert.deepEqual(result, f.ids.map(id => ({ taskId: id, title: `Canonical ${id}`, dialogId: '' })));
  const evidence = { tasks: result.length, itemReads: f.state.itemReads, metaReads: f.state.metaReads };
  assert.equal(f.state.itemReads, 0, JSON.stringify(evidence));
  assert.equal(f.state.metaReads, 1, JSON.stringify(evidence));
  return evidence;
});
phase('uncached titles preserve first task/URL match with one pass through each mode', () => {
  const f = fixture(800, false);
  f.state.items.tasks.unshift({ type: 'folder', taskId: '1', title: 'Never use folder title' });
  f.state.items.tasks[2] = { taskUrl: '/task/2/', title: 'Task 2' };
  f.state.items.chats.push({ taskId: '1', title: 'Later duplicate must not win' });
  const result = f.get();
  assert.deepEqual(result, f.ids.map(id => ({ taskId: id, title: `Task ${id}`, dialogId: '' })));
  const evidence = { tasks: result.length, itemReads: f.state.itemReads, metaReads: f.state.metaReads };
  assert.equal(f.state.itemReads, 2, JSON.stringify(evidence));
  assert.equal(f.state.metaReads, 1, JSON.stringify(evidence));
  return evidence;
});
phase('missing title and chat are retried from new metadata on the very next render', () => {
  const f = fixture(2, false);
  f.state.items.tasks = [];
  assert.equal(f.get()[0].title, 'Задача #1');
  f.state.items.tasks.push({ taskId: '1', title: 'New task' });
  f.state.meta.push({ id: 'chat42', taskId: '1', isTask: true }, { id: 'chat99', taskId: '1', isTask: true });
  const next = f.get();
  assert.deepEqual(next[0], { taskId: '1', title: 'New task', dialogId: 'chat42' });
  f.sandbox._dialogTimeTaskTitles.set('1', 'Fresh canonical title');
  const selected = f.get({ tasks: [{ taskId: '1', seconds: 30 }] }, [{ taskId: '1', title: 'Old fallback', visits: 1, lastQualifiedAt: 1, visitedAt: 5, dialogId: 'chat42' }]);
  assert.deepEqual(selected[0], { taskId: '1', title: 'Fresh canonical title', dialogId: 'chat42', visitedAt: 5, trackedSeconds: 30 });
  return { updatedOnNextRender: true, firstMatchingChatPreserved: true };
});
phase('candidate rendering excludes a task outside the confirmed project membership', () => {
  const f = fixture(2);
  f.state.projectTaskIds.delete('2');
  assert.deepEqual(f.get().map(row => row.taskId), ['1']);
  return { eligibleTasks: 2, confirmedProjectTasks: 1 };
});
mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
const report = { sourceSha256: createHash('sha256').update(source).digest('hex'), phases };
writeFileSync(process.env.PENA_TIME_CANDIDATE_REPORT || new URL('./artifacts/time-candidate-performance.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (phases.some(result => result.status !== 'PASS')) process.exitCode = 1;

import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

// Independent server oracle: positional legacy API, a hard 50-row page, no
// synthetic next/total metadata, and entries belonging to several users/dates.
// Baseline mode reads the immutable release tag; it never changes runtime.
const baseline = process.env.PENA_TIME_ACCEPTANCE_BASELINE === '1';
const readRuntime = file => baseline
  ? execFileSync('git', ['-C', 'E:/Codex/ReleaseStaging/bx24-v7.5.85', 'show', `v7.5.93:extension/${file}`], { encoding: 'utf8', maxBuffer: 8000000 })
  : readFileSync(new URL(`../extension/${file}`, import.meta.url), 'utf8');
const injected = readRuntime('injected.js');
const core = vm.createContext({ module: { exports: {} }, Date, setTimeout, clearTimeout });
vm.runInContext(readRuntime('native-time-control.js'), core);
const time = core.module.exports;
const phases = [];
const section = (a, b) => {
  const start = injected.indexOf(a), end = injected.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `Runtime boundary unavailable: ${a}`);
  return injected.slice(start, end);
};
const run = async (name, fn) => {
  const start = performance.now();
  try { phases.push({ name, status: 'PASS', evidence: await fn(), ms: performance.now() - start }); }
  catch (error) { phases.push({ name, status: 'FAIL', error: error.message, ms: performance.now() - start }); }
};
const raw = (id, taskId, seconds = 60, date = '2026-09-07', userId = '7') => ({
  ID: String(id), TASK_ID: String(taskId), USER_ID: userId, SECONDS: seconds,
  CREATED_DATE: `${date}T12:00:00+03:00`, COMMENT_TEXT: ''
});

function loadFixture() {
  const state = { now: 1000000, scope: 'portal:7', rows: [raw(1, '40', 600), raw(2, '41', 1200)], calls: [], denied: new Set(), missing: false, hold: null };
  class Clock extends Date { static now() { return state.now; } }
  const range = { from: '2026-09-07', to: '2026-09-07' };
  const eligibility = new Map(Array.from({ length: 41 }, (_, i) => [String(i + 1), i !== 40]));
  const context = vm.createContext({ Date: Clock, document: { visibilityState: 'visible' }, navigator: { onLine: true },
    _PENA_TIME_CONTROL: time, _dialogTimeRange: range, _dialogTimeView: 'day', _dialogControlNativeWorkspaceTab: 'time',
    _dialogTimeCache: new Map(), _dialogTimeInFlight: new Map(), _dialogTimeRangeRevisions: new Map(), _dialogTimeTaskRevisions: new Map(),
    _dialogTimeForcedRefreshes: new Map(), _dialogTimeRangeRechecks: new Map(), _dialogTimePanelRefreshes: new Map(),
    _dialogTimeCatalogCursor: 0, _dialogTimeCatalogScope: 'portal:7',
    _DIALOG_TIME_LOGGED_TTL_MS: 10000, _DIALOG_TIME_EMPTY_TTL_MS: 120000, _DIALOG_TIME_FIRST_WAVE_SIZE: 16, _DIALOG_TIME_WAVE_SIZE: 50,
    _PENA_TIME_CACHE_TTL_MS: 120000, _getCurrentBitrixUserId: () => '7', _getDialogNativeSharedAuditScopeKey: () => state.scope,
    _dialogTimeTaskEligibility: eligibility, _dialogTimeTaskTitles: new Map([...eligibility.keys()].map(id => [id, `Task ${id}`])),
    _getDialogTimeTaskEligibilityForDisplay: id => eligibility.get(id) === true,
    _readDialogTimeVisits: () => [], _dialogTimeManualSelectedTask: null, _readDialogTimeTracker: () => null, _getActiveDialogTimeActivity: () => null,
    _getDialogRecentUniqueMeta: () => [], _queueDialogTimeUiSync: () => {}, _loadDialogTimeTaskTitles: async () => {},
    _getDialogTimeFriendlyError: e => e.message, _isBxRestBatchPressureError: e => /TIMEOUT|LIMIT|NETWORK/.test(e.code || ''),
    _sleepDialogControl: async () => {},
    _buildDialogTimeWriteFields: (seconds, date) => ({ SECONDS: seconds, CREATED_DATE: `${date}T12:00:00+03:00` }),
    _callDialogTimeElapsedPages: async paramsList => {
      state.calls.push(paramsList.map(p => String(p[0])));
      const pages = paramsList.map(p => {
        assert.ok(Array.isArray(p));
        const rows = state.rows.filter(r => String(r.TASK_ID) === String(p[0]) && r.CREATED_DATE >= p[2]['>=CREATED_DATE'] && r.CREATED_DATE < p[2]['<CREATED_DATE'] && Number(r.USER_ID) === p[2].USER_ID);
        return { data: structuredClone(rows.slice((p[4].NAV_PARAMS.iNumPage - 1) * 50, p[4].NAV_PARAMS.iNumPage * 50)) };
      });
      if (state.hold) { const hold = state.hold; state.hold = null; await hold; }
      if (state.missing) return pages.map((page, i) => i === 0 ? undefined : page);
      if (paramsList.some(p => state.denied.has(String(p[0])))) throw Object.assign(new Error('Denied'), {
        code: 'ACCESS_DENIED', partialPages: pages.map((p, i) => state.denied.has(String(paramsList[i][0])) ? undefined : p),
        partialErrors: paramsList.map(p => state.denied.has(String(p[0])) ? Object.assign(new Error('Denied'), { code: 'ACCESS_DENIED' }) : null)
      });
      return pages;
    }
  });
  const names = ['_getDialogTimeEligibleTaskIds', '_getDialogTimeWorkingTaskIds', '_getDialogTimeCacheKey', '_setDialogTimeCacheRecord', '_hasDialogTimeVerifiedData', '_loadDialogTimeRange', '_invalidateDialogTimeCachesForDates', '_applyDialogTimeOptimisticEntry'];
  for (const name of names) {
    const marker = new RegExp(`\\t(?:async )?function ${name}\\(`).exec(injected);
    assert.ok(marker, `Missing function ${name}`);
    const next = /\n\t(?:async )?function /.exec(injected.slice(marker.index + 1));
    vm.runInContext(injected.slice(marker.index, marker.index + 1 + next.index), context);
  }
  return { state, context, range, record: () => context._dialogTimeCache.get('7:2026-09-07:2026-09-07') };
}

await run('legacy getlist accepts positional payload and reaches all 127 own entries without pagination hints', async () => {
  const database = Array.from({ length: 127 }, (_, i) => raw(i + 1, '400', 60));
  database.push(raw(800, '400', 9000, '2026-09-07', '8'), raw(801, '400', 9000, '2026-09-06'));
  const calls = [];
  const data = await time.loadElapsedItems({ from: '2026-09-07', to: '2026-09-07', userId: '7', taskIds: ['400'], callPages: async jobs => jobs.map(params => {
    assert.ok(Array.isArray(params), 'Bitrix legacy getlist parameters must be positional, not named');
    assert.equal(params.length, 5); assert.equal(params[0], 400);
    const filter = params[2], nav = params[4]?.NAV_PARAMS;
    assert.equal(filter.USER_ID, 7); assert.equal(nav.nPageSize, 50);
    assert.equal(filter['>=CREATED_DATE'], '2026-09-07T00:00:00');
    assert.equal(filter['<CREATED_DATE'], '2026-09-08T00:00:00');
    assert.ok(Number.isInteger(nav.iNumPage) && nav.iNumPage >= 1);
    assert.ok(params[3].includes('USER_ID'));
    calls.push(nav.iNumPage);
    const rows = database.filter(r => Number(r.USER_ID) === filter.USER_ID && r.CREATED_DATE >= filter['>=CREATED_DATE'] && r.CREATED_DATE < filter['<CREATED_DATE']);
    return { data: rows.slice((nav.iNumPage - 1) * 50, nav.iNumPage * 50) };
  }) });
  assert.equal(data.entryCount, 127); assert.equal(data.totalSeconds, 127 * 60);
  assert.deepEqual(calls, [1, 2, 3]);
  return { entries: data.entryCount, totalSeconds: data.totalSeconds, pageRequests: calls };
});

await run('defensive author/date filtering does not count foreign or out-of-range elapsed records', async () => {
  const data = await time.loadElapsedItems({ from: '2026-09-07', to: '2026-09-07', userId: '7', taskIds: ['400'], callPages: async () => [{ data: [raw(1, '400'), raw(2, '400', 900, '2026-09-07', '8'), raw(3, '400', 900, '2026-09-06'), raw(4, '999', 900)] }] });
  assert.equal(data.entryCount, 1); assert.equal(data.totalSeconds, 60);
  return { acceptedOwnEntries: 1, rejectedForeignDateOrTaskEntries: 3 };
});

await run('confirmed historical elapsed remains visible when task time tracking is now disabled', async () => {
  const context = vm.createContext({ _PENA_TIME_CONTROL: time, _getDialogTimeTaskEligibilityForDisplay: id => id !== '401' });
  vm.runInContext(section('\tfunction _filterDialogTimeDataByEligibility(', '\n\tfunction _readDialogTimeManualDraft('), context);
  const actual = context._filterDialogTimeDataByEligibility(time.aggregateElapsedItems([raw(1, '400', 600), raw(2, '401', 1200)]));
  assert.equal(actual.entryCount, 2, 'Changing ALLOW_TIME_TRACKING to N must not erase existing own time');
  assert.equal(actual.totalSeconds, 1800);
  return { enabledTaskSeconds: 600, historicalDisabledTaskSeconds: 1200, totalSeconds: actual.totalSeconds };
});

if (!baseline) {
  await run('repeating full page fails after two requests instead of consuming 100 pages', async () => {
    let calls = 0;
    await assert.rejects(time.loadElapsedItems({ from: '2026-09-07', to: '2026-09-07', userId: '7', taskIds: ['400'], callPages: async jobs => jobs.map(() => { calls++; return { data: Array.from({ length: 50 }, (_, i) => raw(i + 1, '400')) }; }) }));
    assert.equal(calls, 2); return { requestsBeforeFailure: calls, baselineRequests: 100 };
  });
  await run('public range load covers all 41 accessible tasks including unseen contributor and historical N', async () => {
    const f = loadFixture();
    const data = await f.context._loadDialogTimeRange(f.range);
    assert.equal(data.totalSeconds, 1800); assert.equal(data.entryCount, 2);
    assert.equal(data.coverage.complete, true); assert.equal(data.coverage.checkedTasks, 41);
    assert.deepEqual([...new Set(f.state.calls.flat())].map(Number).sort((a,b) => a-b), Array.from({ length: 41 }, (_, i) => i + 1));
    const calls = f.state.calls.length; await f.context._loadDialogTimeRange(f.range);
    assert.equal(f.state.calls.length, calls, 'Fresh reopening must not repeat empty-task reads');
    return { expectedSeconds: 1800, actualSeconds: data.totalSeconds, tasksRead: 41, coldBatches: calls, freshReopenRequests: 0 };
  });
  await run('external edits refresh logged tasks at 10 seconds and discover new empty-task entries at 120 seconds', async () => {
    const f = loadFixture(); await f.context._loadDialogTimeRange(f.range);
    f.state.rows[0].SECONDS = 900; f.state.rows.push(raw(3, '30', 300));
    f.state.now += 10000; const hot = await f.context._loadDialogTimeRange(f.range);
    assert.equal(hot.totalSeconds, 2100); assert.deepEqual(new Set(f.state.calls.at(-1)), new Set(['40','41']));
    f.state.now += 110000; const cold = await f.context._loadDialogTimeRange(f.range);
    assert.equal(cold.totalSeconds, 2400); assert.equal(cold.entryCount, 3);
    return { loggedFreshnessSeconds: 10, previouslyEmptyFreshnessSeconds: 120, expectedFinalSeconds: 2400, actualFinalSeconds: cold.totalSeconds };
  });
  await run('access-denied task does not erase other available records or claim complete coverage', async () => {
    const f = loadFixture(); f.state.denied.add('1');
    await assert.rejects(f.context._loadDialogTimeRange(f.range));
    assert.equal(f.record().data.totalSeconds, 1800); assert.equal(f.record().data.coverage.complete, false);
    assert.equal(f.record().status, 'error'); assert.equal(f.record().data.coverage.checkedTasks, 40);
    return { availableSeconds: 1800, checkedTasks: 40, deniedTasks: 1, status: f.record().status };
  });
  await run('missing batch response is an error rather than an empty successful task', async () => {
    const f = loadFixture(); f.state.missing = true;
    await assert.rejects(f.context._loadDialogTimeRange(f.range), 'Undefined response must not advance coverage');
    assert.notEqual(f.record()?.data?.coverage?.complete, true);
    return { rejectedMissingResponse: true };
  });
  await run('late pre-write snapshot cannot erase a confirmed entry or overwritten total', async () => {
    const f = loadFixture(); await f.context._loadDialogTimeRange(f.range);
    let release; f.state.hold = new Promise(resolve => { release = resolve; });
    const oldRead = f.context._loadDialogTimeRange(f.range, { force: true });
    await Promise.resolve();
    f.context._invalidateDialogTimeCachesForDates(f.range.from, { taskId: '40' });
    f.context._applyDialogTimeOptimisticEntry('40', 900, f.range.from, '1');
    release(); await oldRead;
    assert.equal(f.record().data.totalSeconds, 2100); assert.equal(f.record().data.entryCount, 2);
    return { expectedConfirmedSeconds: 2100, actualConfirmedSeconds: f.record().data.totalSeconds };
  });
  await run('identity switch during a read discards the old response', async () => {
    const f = loadFixture(); await f.context._loadDialogTimeRange(f.range);
    f.state.rows[0].SECONDS = 900;
    let release; f.state.hold = new Promise(resolve => { release = resolve; });
    const oldRead = f.context._loadDialogTimeRange(f.range, { force: true });
    await Promise.resolve(); f.state.scope = 'portal:8'; release(); await oldRead;
    assert.equal(f.record().data.totalSeconds, 1800);
    return { previousConfirmedSeconds: 1800, lateDataPublished: false };
  });
}

// This diagnostic records the old discovery hole without demanding that a fast
// first-paint working set itself become a full scan. Full-load acceptance belongs
// at _loadDialogTimeRange, which is allowed to resolve a bounded background scan.
if (baseline) await run('baseline coverage observation: unseen task 40 and historical task 41', async () => {
  const eligibility = new Map(Array.from({ length: 41 }, (_, i) => [String(i + 1), i !== 40]));
  const context = vm.createContext({ _PENA_TIME_CONTROL: time, _dialogTimeCache: new Map(), _dialogTimeRange: { from: '2026-09-07', to: '2026-09-07' },
    _getDialogTimeTaskEligibilityForDisplay: id => eligibility.get(id) === true,
    _getDialogTimeEligibleTaskIds: () => [...eligibility].filter(([, enabled]) => enabled).map(([id]) => id),
    _readDialogTimeVisits: () => [], _dialogTimeManualSelectedTask: null,
    _readDialogTimeTracker: () => null, _getActiveDialogTimeActivity: () => null,
    _getDialogRecentUniqueMeta: () => Array.from({ length: 41 }, (_, i) => ({ taskId: String(i + 1), isTask: true, lastMessageTs: 100 - i }))
  });
  vm.runInContext(section('\tfunction _getDialogTimeWorkingTaskIds(', '\n\tfunction _getDialogTaskKeysetCursor('), context);
  const taskIds = context._getDialogTimeWorkingTaskIds();
  const data = await time.loadElapsedItems({ taskIds, from: '2026-09-07', to: '2026-09-07', userId: '7', callPages: async jobs => jobs.map(params => ({ data: Number(params.TASKID ?? params[0]) === 40 ? [raw(1, '40', 600)] : Number(params.TASKID ?? params[0]) === 41 ? [raw(2, '41', 1200)] : [] })) });
  return { accessibleTasks: 41, queriedTasks: taskIds.length, expectedSeconds: 1800, actualSeconds: data.totalSeconds, unseenEligibleQueried: taskIds.includes('40'), historicalDisabledQueried: taskIds.includes('41') };
});

if (baseline) await run('baseline freshness observation: external write remains stale through seven 15-second polls', async () => {
  let now = 1000000, serverSeconds = 600, restCalls = 0;
  const range = { from: '2026-09-07', to: '2026-09-07' };
  class Clock extends Date { static now() { return now; } }
  const cache = new Map();
  const context = vm.createContext({ Date: Clock, _PENA_TIME_CONTROL: time, _dialogTimeRange: range,
    _getCurrentBitrixUserId: () => '7', _getDialogTimeCacheKey: () => '7:2026-09-07:2026-09-07',
    _dialogTimeCache: cache, _dialogTimeInFlight: new Map(), _PENA_TIME_CACHE_TTL_MS: 120000,
    _getDialogTimeWorkingTaskIds: () => ['1'], _queueDialogTimeUiSync: () => {},
    _loadDialogTimeTaskTitles: async () => {}, _getDialogTimeFriendlyError: e => e.message,
    _setDialogTimeCacheRecord: (key, record) => cache.set(key, record),
    _callDialogTimeElapsedPages: async () => { restCalls++; return [{ data: [raw(1, '1', serverSeconds)] }]; }
  });
  vm.runInContext(section('\tconst _dialogTimeForcedRefreshes = ', '\n\tfunction _setDialogTimeRange('), context);
  await context._loadDialogTimeRange(range);
  serverSeconds = 1800;
  const polls = [];
  for (let seconds = 15; seconds <= 120; seconds += 15) {
    now = 1000000 + seconds * 1000;
    const data = await context._loadDialogTimeRange(range);
    polls.push({ secondsAfterExternalWrite: seconds, displayedSeconds: data.totalSeconds, elapsedRequests: restCalls });
  }
  return { externalExpectedSeconds: 1800, firstFreshPollSeconds: polls.find(p => p.displayedSeconds === 1800)?.secondsAfterExternalWrite, polls, timing: 'Virtual clock; no network latency or browser wall-time measurement.' };
});

if (baseline) await run('baseline pagination observation: repeated server page consumes the entire 100-page allowance', async () => {
  let requests = 0, rejected = '';
  const page = Array.from({ length: 50 }, (_, i) => raw(i + 1, '400'));
  try {
    await time.loadElapsedItems({ from: '2026-09-07', to: '2026-09-07', userId: '7', taskIds: ['400'], callPages: async jobs => jobs.map(() => { requests++; return { data: page }; }) });
  } catch (error) { rejected = error.message; }
  assert.ok(rejected, 'A repeating full page must never become complete data');
  return { requests, uniqueServerEntries: 50, rejected, timing: 'Immediate in-memory server responses; request count is the measured cost.' };
});

mkdirSync('tests/artifacts', { recursive: true });
const report = { runtime: baseline ? 'v7.5.93 immutable tag' : 'current workspace', baseline, phases, limitations: 'VM/API contract acceptance; no live Bitrix or user-visible browser timing.' };
writeFileSync(`tests/artifacts/time-acceptance-${baseline ? 'baseline-v7.5.93' : 'current'}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!baseline && phases.some(p => p.status === 'FAIL')) process.exitCode = 1;

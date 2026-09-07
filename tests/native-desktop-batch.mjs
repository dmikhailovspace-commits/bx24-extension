import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const source = readFileSync(process.env.PENA_BATCH_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
const section = (a, b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert(start >= 0 && end > start, a);
  return source.slice(start, end);
};
const runtime = [
  section('\tfunction _createBxRestError(', '\n\tlet _dialogRestQueue'),
  section('\tfunction _dispatchBxRestPage(', '\n\tfunction _normalizeBxRestPageResult'),
  section('\tfunction _normalizeBxRestPageResult(', '\n\tfunction _callBxRestPageWithTimeout'),
  section('\tfunction _isBxRestBatchPressureError(', '\n\tfunction _extractDialogRecentItems'),
  section('\tasync function _runDialogRecentJobs(', '\n\tfunction _normalizeDialogRecentAuthorProfile')
].join('\n');
const report = { runtimeSha256: createHash('sha256').update(source).digest('hex'), phases: [], limitations: 'SDK transport contract under controlled network responses; not live Bitrix latency.' };
const test = async (name, run) => {
  const start = performance.now();
  try { const evidence = await run(); report.phases.push({ name, status: 'PASS', ms: performance.now() - start, evidence }); }
  catch (error) { report.phases.push({ name, status: 'FAIL', error: String(error) }); throw error; }
};
const nativeError = code => ({ getError: () => ({ error: code, error_description: 'Native SDK error' }), toString: () => `${code}: Native SDK error (400)` });
const jobs = Array.from({ length: 50 }, (_, i) => ({ method: 'task.elapseditem.getlist', params: [i + 1, { ID: 'ASC' }, { USER_ID: 7 }, ['ID', 'SECONDS'], { NAV_PARAMS: { nPageSize: 50, iNumPage: 1 } }] }));
function setup({ code = '', mixed = false, missing = false, useTop = false, official = false, next = null, rootError = false } = {}) {
  const calls = { batch: 0, single: 0, sizes: [] };
  const wrap = (data, error = '') => ({ error: () => error ? nativeError(error) : null, data: () => data, total: () => 1,
    answer: { next }, next() { throw Error('SDK next() is a transport operation, not a getter'); } });
  const client = { callBatch(batch, callback, halt) {
    assert.equal(halt, false); calls.batch++; calls.sizes.push(Object.keys(batch).length);
    callback(Object.fromEntries(Object.entries(batch).filter(([key]) => !missing || key !== 'page_17').map(([key, job]) => [key, wrap([{ ID: job.params[0], SECONDS: 60 }], !mixed || key === 'page_17' ? code : '')])));
  } };
  const window = { location: { origin: 'https://portal.test' }, BX: { namespace() {}, rest: useTop ? {} : client } };
  const context = vm.createContext({ window, document: {}, console, setTimeout, clearTimeout, Promise, Map, Set, encodeURIComponent,
    _getSafeTopWindow: () => useTop ? { BX: { rest: client } } : null,
    _scheduleBxRest: (_method, _params, run) => run(),
    _callBxRestPageWithTimeout: async (_method, params) => { calls.single++; return { data: [{ ID: params[0], SECONDS: 60 }], next: null, total: 1 }; },
    _sleepDialogControl: async () => {}, warn() {}
  });
  if (official) {
    // Optional local compatibility oracle executes Bitrix's real SDK against an
    // in-memory XMLHttpRequest. CI has no network or downloaded SDK dependency.
    const sdk = readFileSync(process.env.PENA_NATIVE_REST_CLIENT, 'utf8');
    report.sdkSha256 = createHash('sha256').update(sdk).digest('hex');
    window.BX.bitrix_sessid = () => 'test-only';
    context.XMLHttpRequest = class {
      open(method, url) { assert.equal(method, 'POST'); assert.equal(url, '/rest/batch.json'); }
      setRequestHeader() {}
      send(body) {
        calls.batch++;
        const cmd = [...new URLSearchParams(body)].filter(([key]) => key.startsWith('cmd['));
        calls.sizes.push(cmd.length);
        const result = {}, result_error = {}, result_next = {};
        for (const [key, value] of cmd) {
          const name = key.slice(4, -1);
          assert(value.startsWith('task.elapseditem.getlist?'));
          const params = new URLSearchParams(value.slice(value.indexOf('?') + 1));
          assert.equal(params.get('2[USER_ID]'), '7');
          assert.equal(params.get('4[NAV_PARAMS][nPageSize]'), '50');
          if (missing && name === 'page_17') continue;
          if (code && (!mixed || name === 'page_17')) result_error[name] = { error: code, error_description: 'Native SDK error' };
          else result[name] = [{ ID: Number(params.get('0')), SECONDS: 60 }];
          if (next != null) result_next[name] = next;
        }
        this.status = rootError ? 429 : 200;
        this.responseText = JSON.stringify(rootError ? { error: code, error_description: 'Root transport error' } : { result: { result, result_error, result_total: {}, result_next, result_time: {} } });
        queueMicrotask(() => this.onload());
      }
    };
    vm.runInContext(sdk, context);
  }
  vm.runInContext(runtime, context);
  return { context, calls };
}
try {
  for (const official of process.env.PENA_NATIVE_REST_CLIENT ? [false, true] : [false]) {
    const prefix = official ? 'Official native SDK' : 'Native SDK contract';
    await test(`${prefix}: 50 task reads use one Desktop batch without BX24`, async () => {
      const { context, calls } = setup({ official });
      const rows = await context._callBxRestPagesFast(jobs);
      (report.observations ||= []).push({ official, taskReads: 50, batches: calls.batch, singleRequests: calls.single });
      assert.equal(rows.length, 50); assert.deepEqual(Array.from(rows, row => row.data[0].ID), jobs.map(job => job.params[0]));
      assert.equal(calls.batch, 1); assert.equal(calls.single, 0);
      return { transportRequests: 1, taskReads: 50, previousSingleRequests: 50, requestReductionFactor: 50 };
    });
    await test(`${prefix}: pagination metadata never calls SDK next transport`, async () => {
      const { context, calls } = setup({ official, next: 50 });
      const rows = await context._callBxRestPagesFast(jobs);
      assert(rows.every(row => row.next === 50));
      assert.equal(calls.batch, 1); assert.equal(calls.single, 0);
      return { cursor: 50, transportRequests: 1, implicitNextRequests: 0 };
    });
    for (const code of ['QUERY_LIMIT_EXCEEDED', 'OPERATION_TIME_LIMIT', 'ERROR_NETWORK']) {
      await test(`${prefix}: structured ${code} preserves code and never fans out`, async () => {
        const { context, calls } = setup({ official, code });
        await assert.rejects(context._callBxRestPagesFast(jobs), error => error.code === code);
        assert.equal(calls.batch, 1); assert.equal(calls.single, 0);
      });
    }
    await test(`${prefix}: mixed failure keeps 49 successful pages`, async () => {
      const { context, calls } = setup({ official, code: 'ACCESS_DENIED', mixed: true });
      await assert.rejects(context._callBxRestPagesFast(jobs), error => error.code === 'ACCESS_DENIED' && error.partialPages.filter(Boolean).length === 49);
      assert.equal(calls.single, 0);
    });
    await test(`${prefix}: missing page is incomplete, not an empty success`, async () => {
      const { context } = setup({ official, missing: true });
      await assert.rejects(context._callBxRestPagesFast(jobs), error => error.code === 'BATCH_PARTIAL_RESPONSE');
    });
    await test(`${prefix}: native unsupported error permits bounded fallback`, async () => {
      const { context, calls } = setup({ official, code: 'ERROR_METHOD_NOT_FOUND' });
      assert.equal((await context._callBxRestPagesFast(jobs)).length, 50);
      assert.equal(calls.batch, 1); assert.equal(calls.single, 50);
    });
    if (official) for (const code of ['QUERY_LIMIT_EXCEEDED', 'ERROR_METHOD_NOT_FOUND']) {
      await test(`${prefix}: root ${code} distributed to all pages keeps transport policy`, async () => {
        const { context, calls } = setup({ official, code, rootError: true });
        if (code === 'QUERY_LIMIT_EXCEEDED') {
          await assert.rejects(context._callBxRestPagesFast(jobs), error => error.code === code);
          assert.equal(calls.single, 0);
        } else {
          assert.equal((await context._callBxRestPagesFast(jobs)).length, 50);
          assert.equal(calls.single, 50);
        }
        assert.equal(calls.batch, 1);
      });
    }
  }
  await test('Chunked batch keeps error indexes aligned with retained pages', async () => {
    const { context } = setup(); let round = 0;
    context.window.BX.rest.callBatch = (batch, callback) => {
      round++;
      callback(Object.fromEntries(Object.keys(batch).map(key => [key, { data: () => [], error: () => round === 2 && key === 'page_17' ? nativeError('ACCESS_DENIED') : null }])));
    };
    await assert.rejects(context._callBxRestPagesFast([...jobs, ...jobs]), error => {
      assert.equal(error.partialPages.length, 100); assert.equal(error.partialPages.filter(Boolean).length, 99);
      assert.equal(error.partialErrors.length, 100); assert.equal(error.partialErrors.filter(Boolean).length, 1);
      assert.equal(error.partialErrors[67].code, 'ACCESS_DENIED'); return true;
    });
  });
  await test('Freshness clock begins at dispatch, excluding queue time but including response age', async () => {
    const { context } = setup(); let clock = 100000;
    context.Date = class extends Date { static now() { return clock; } };
    context._scheduleBxRest = (_method, _params, run) => { clock += 15000; return run(); };
    const original = context.window.BX.rest.callBatch;
    context.window.BX.rest.callBatch = (batch, callback, halt) => original(batch, result => { clock += 9000; callback(result); }, halt);
    const rows = await context._callBxRestPagesFast(jobs);
    assert(rows.every(row => row.requestedAt === 115000)); assert.equal(clock, 124000);
    context.window.BX.rest.callMethod = (_method, _params, callback) => {
      clock += 9000; callback({ error: () => null, data: () => [] });
    };
    const single = await context._scheduleBxRest('task.elapseditem.getlist', {}, () => context._dispatchBxRestPage('task.elapseditem.getlist', {}));
    assert.equal(single.requestedAt, 139000); assert.equal(clock, 148000);
    return { excludedQueueMs: 15000, retainedResponseAgeMs: 9000, transports: ['batch', 'single'] };
  });
  await test('Native batch may belong to the same-origin top frame', async () => {
    const { context, calls } = setup({ useTop: true });
    assert.equal((await context._callBxRestPagesFast(jobs)).length, 50);
    assert.equal(calls.batch, 1); assert.equal(calls.single, 0);
  });
  console.log(`PASS Desktop batch: ${report.phases.length} phases`);
} finally {
  mkdirSync('tests/artifacts', { recursive: true });
  writeFileSync('tests/artifacts/native-desktop-batch-report.json', JSON.stringify(report, null, 2));
}

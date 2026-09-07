import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRequestQueue } = require('../extension/native-time-control.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const queue = createRequestQueue({ spacingMs: 5, timeoutMs: 300, cooldownMs: 30 });
let active = 0, peak = 0, calls = 0;
const run = () => { calls++; active++; peak = Math.max(peak, active); return sleep(20).then(() => { active--; return calls; }); };
const first = queue.run('tasks.task.get', 'same', run);
assert.equal(queue.run('tasks.task.get', 'same', run), first);
await Promise.all([first, ...Array.from({ length: 20 }, (_, i) => queue.run('tasks.task.list', `page${i}`, run))]);
assert.ok(queue.snapshot().samples.at(-1).startedAt - queue.snapshot().samples[0].startedAt >= 2400, 'Sustained requests exceeded 2/s after the burst');
assert.equal(calls, 21); assert.equal(peak, 2); assert.equal(queue.snapshot().deduplicated, 1);
const start = Date.now();
await assert.rejects(queue.run('hung', 'hung', () => new Promise(() => {}), { timeoutMs: 25 }), /время ожидания/);
await queue.run('recovered', 'next', async () => true);
assert.ok(Date.now() - start >= 50, 'Timeout retry bypassed cooldown');
await assert.rejects(queue.run('obsolete', '', run, { isCurrent: () => false }), /superseded/);
const afterFailure = queue.snapshot();
assert.equal(afterFailure.active, 0); assert.equal(afterFailure.queued, 0);
assert.ok(afterFailure.samples.some(row => row.code === 'TIMEOUT'));
// Writes deliberately have no deduplication key.
await Promise.all([queue.run('add', '', run), queue.run('add', '', run)]);
assert.equal(calls, 23);
// OPERATION_TIME_LIMIT is server resource pressure as well as HTTP quota.
// Already queued work must observe the cooldown rather than immediately dispatch.
const operationQueue = createRequestQueue({ concurrency: 1, spacingMs: 0, cooldownMs: 40 });
let operationFailedAt = 0, resumedAt = 0;
const limited = operationQueue.run('tasks.task.list', 'limited', async () => {
 await sleep(5); operationFailedAt = Date.now();
 throw Object.assign(new Error('Resource execution quota'), { code: 'OPERATION_TIME_LIMIT' });
});
const queuedAfterLimit = operationQueue.run('tasks.task.list', 'queued-page', async () => { resumedAt = Date.now(); return true; });
await assert.rejects(limited, error => error.code === 'OPERATION_TIME_LIMIT');
await queuedAfterLimit;
assert.ok(resumedAt - operationFailedAt >= 40, 'Queued work ignored OPERATION_TIME_LIMIT cooldown');
assert.equal(operationQueue.snapshot().active, 0);
assert.equal(operationQueue.snapshot().queued, 0);
console.log('PASS REST queue: concurrency, deduplication, cancellation, timeout cooldown, write isolation', JSON.stringify(queue.snapshot()));

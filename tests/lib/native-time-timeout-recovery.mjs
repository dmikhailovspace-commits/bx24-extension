import assert from 'node:assert/strict';

export function assertTimeRetryCooldown(retry, samples, nativeCalls, completedAt, mode) {
 const deadline = retry.at + retry.cooldownMs;
 assert.ok(samples.length > 0, `No completed retry reads in ${mode}`);
 assert.equal(samples[0].method, 'tasks.task.list', `Retry must reconcile the selected catalog before elapsed in ${mode}`);
 assert.ok(nativeCalls.length > 0, `No SDK catalog dispatch recorded in ${mode}`);
 assert.equal(nativeCalls[0].method, 'tasks.task.list');
 for (const sample of samples) assert.ok(sample.startedAt >= deadline,
  `REST request bypassed cooldown in ${mode}: ${JSON.stringify({ deadline, sample })}`);
 for (const call of nativeCalls) assert.ok(call.at >= deadline,
  `SDK request bypassed cooldown in ${mode}: ${JSON.stringify({ deadline, call })}`);
 assert.ok(completedAt - retry.at >= retry.cooldownMs, `Recovery completed before cooldown expired in ${mode}`);
 // The first catalog request waits in the queue. Elapsed is enqueued only
 // after that catalog completes and therefore has a short, separate queue wait.
 assert.ok(samples[0].queuedMs >= retry.cooldownMs - 250,
  `First retry catalog did not wait for cooldown in ${mode}: ${JSON.stringify({ first:samples[0], cooldownBeforeRetry:retry.cooldownMs })}`);
}

export async function verifyTimeTimeoutRecovery(page, timePanel, mode) {
 const elapsedSamples = () => page.evaluate(() => (window.__PENA_REST_DIAGNOSTICS__?.snapshot()?.samples || []).filter(sample => sample.method === 'batch:task.elapseditem.getlist'));
 // A useful first total can precede the catalog tail and its background read.
 // Since refresh remains usable during that read, injecting "next batch"
 // too early fails the predecessor, while the manual successor can succeed.
 // Establish a complete idle view and arm/click in one browser task so this
 // scenario specifically fails the manual request, without pausing scheduling.
 const armed = await page.waitForFunction(() => {
  const panel = document.querySelector('.pena-native-time-panel');
  const refresh = panel?.querySelector('.pena-native-time-refresh');
  const diagnostics = window.__PENA_REST_DIAGNOSTICS__?.snapshot();
  if (panel?.querySelector('.pena-native-time-read-status')?.dataset.state !== 'ready' ||
      panel.classList.contains('--loading') || !refresh || refresh.disabled ||
      !diagnostics || diagnostics.active !== 0 || diagnostics.queued !== 0 || diagnostics.cooldownMs > 0) return false;
  const before = diagnostics.samples.filter(sample => sample.method === 'batch:task.elapseditem.getlist').length;
  window.timeListTimeoutFailures = 1;
  refresh.click();
  return { before };
 });
 const { before } = await armed.jsonValue();
 await armed.dispose();
 await page.waitForFunction(previous => {
  const elapsed = (window.__PENA_REST_DIAGNOSTICS__?.snapshot()?.samples || []).filter(sample => sample.method === 'batch:task.elapseditem.getlist');
  return elapsed.length === previous + 1 && elapsed.at(-1)?.status === 'error' && !document.querySelector('.pena-native-time-panel')?.classList.contains('--loading');
 }, before);
 await page.locator('.pena-native-toast.--danger.--show').filter({ hasText: 'Bitrix24 не ответил вовремя' }).waitFor({ state: 'visible' });
 assert.equal(await page.locator('.pena-native-time-button').getAttribute('title'), 'Bitrix24 не ответил вовремя', `The cached timeout was not exposed in the time control in ${mode}`);
 assert.equal(await timePanel.locator('.pena-native-time-total-value').textContent(), '1 ч 30 мин', `Timeout discarded cached time summary in ${mode}`);
 const failed = (await elapsedSamples()).at(-1);
 assert.equal(failed.code, 'TIMEOUT');
 await page.waitForTimeout(350);
 assert.equal((await elapsedSamples()).length, before + 1, `Timeout automatically resubmitted the elapsed batch in ${mode}`);
 const retry = await page.evaluate(() => {
  const at = Date.now();
  const diagnostics = window.__PENA_REST_DIAGNOSTICS__.snapshot();
  return { at, cooldownMs:diagnostics.cooldownMs, sampleOffset:diagnostics.samples.length,
   nativeCallOffset:window.nativeRestCalls.length, batchCount:window.nativeBatchCalls, elapsedCallOffset:window.timeRestCalls.length };
 });
 const cooldownBeforeRetry = retry.cooldownMs;
 assert.ok(cooldownBeforeRetry >= 12000, `Timeout did not activate the real 15-second queue cooldown in ${mode}: ${cooldownBeforeRetry}`);
 const retryCallOffset = retry.elapsedCallOffset;
 await timePanel.locator('.pena-native-time-refresh').click();
 await page.waitForTimeout(350);
 assert.equal((await elapsedSamples()).length, before + 1, `Manual retry bypassed the queue cooldown in ${mode}`);
 const early = await page.evaluate(() => ({ nativeCalls:window.nativeRestCalls.length, batches:window.nativeBatchCalls,
  samples:window.__PENA_REST_DIAGNOSTICS__.snapshot().samples.length }));
 assert.equal(early.nativeCalls,retry.nativeCallOffset,`Catalog SDK dispatch bypassed cooldown in ${mode}`);
 assert.equal(early.batches,retry.batchCount,`Batch SDK dispatch bypassed cooldown in ${mode}`);
 assert.equal(early.samples,retry.sampleOffset,`A REST request completed during cooldown in ${mode}`);
 await page.waitForFunction(previous => {
  const elapsed = (window.__PENA_REST_DIAGNOSTICS__?.snapshot()?.samples || []).filter(sample => sample.method === 'batch:task.elapseditem.getlist');
  return elapsed.length >= previous + 2 && elapsed.slice(previous + 1).every(sample => sample.status === 'ok') && !document.querySelector('.pena-native-time-panel')?.classList.contains('--loading') && document.querySelector('.pena-native-toast.--show')?.textContent?.includes('Обновлено · 1 ч 30 мин · 2 задачи');
 }, before, { timeout: 22000 });
 const recoveryWaves = (await elapsedSamples()).slice(before + 1);
 const recovered = recoveryWaves[0];
 const admission = await page.evaluate(({sampleOffset,nativeCallOffset}) => ({
  completedAt:Date.now(), samples:window.__PENA_REST_DIAGNOSTICS__.snapshot().samples.slice(sampleOffset),
  nativeCalls:window.nativeRestCalls.slice(nativeCallOffset).map(({method,at})=>({method,at}))
 }),retry);
 const requested = await page.evaluate(offset => window.timeRestCalls.slice(offset).map(params => `${params[0]}:${params[4]?.NAV_PARAMS?.iNumPage || 1}`), retryCallOffset);
 assert.equal(new Set(requested).size, requested.length, `Manual recovery repeated a task page in ${mode}: ${JSON.stringify(requested)}`);
 assertTimeRetryCooldown(retry,admission.samples,admission.nativeCalls,admission.completedAt,mode);
 assert.equal(await page.locator('.pena-native-time-button').getAttribute('title'), 'Затраченное время за сегодня', `Manual recovery kept the timeout error on the time control in ${mode}`);
 assert.equal(await page.locator('.pena-native-toast.--danger.--show').count(), 0, `Manual recovery kept an error toast visible in ${mode}`);
 assert.equal(await timePanel.locator('.pena-native-time-total-value').textContent(), '1 ч 30 мин', `Manual recovery broke the time summary in ${mode}`);
 await page.waitForFunction(() => document.querySelector('.pena-native-toast.--show')?.textContent?.includes('Обновлено · 1 ч 30 мин · 2 задачи'));
 return { mode, submittedBatches: 1 + recoveryWaves.length, recoveryTaskPages:requested.length, automaticRetries: 0, cooldownBeforeRetry,
  firstRetryMethod:admission.samples[0].method, firstRetryQueuedMs:admission.samples[0].queuedMs,
  firstRetryDispatchDelayMs:admission.samples[0].startedAt-retry.at, recoveredQueuedMs: recovered.queuedMs,
  recoveryWallMs:admission.completedAt-retry.at };
}

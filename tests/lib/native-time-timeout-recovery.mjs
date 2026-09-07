import assert from 'node:assert/strict';

export async function verifyTimeTimeoutRecovery(page, timePanel, mode) {
 const elapsedSamples = () => page.evaluate(() => (window.__PENA_REST_DIAGNOSTICS__?.snapshot()?.samples || []).filter(sample => sample.method === 'batch:task.elapseditem.getlist'));
 const before = (await elapsedSamples()).length;
 await page.evaluate(() => {
  window.timeListTimeoutFailures = 1;
  document.querySelector('.pena-native-time-refresh')?.click();
 });
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
 const cooldownBeforeRetry = await page.evaluate(() => window.__PENA_REST_DIAGNOSTICS__.snapshot().cooldownMs);
 assert.ok(cooldownBeforeRetry >= 12000, `Timeout did not activate the real 15-second queue cooldown in ${mode}: ${cooldownBeforeRetry}`);
 await timePanel.locator('.pena-native-time-refresh').click();
 await page.waitForTimeout(350);
 assert.equal((await elapsedSamples()).length, before + 1, `Manual retry bypassed the queue cooldown in ${mode}`);
 await page.waitForFunction(previous => {
  const elapsed = (window.__PENA_REST_DIAGNOSTICS__?.snapshot()?.samples || []).filter(sample => sample.method === 'batch:task.elapseditem.getlist');
  return elapsed.length === previous + 2 && elapsed.at(-1)?.status === 'ok' && !document.querySelector('.pena-native-time-panel')?.classList.contains('--loading');
 }, before, { timeout: 22000 });
 const recovered = (await elapsedSamples()).at(-1);
 assert.ok(recovered.queuedMs >= cooldownBeforeRetry - 250, `Recovery did not wait for the real cooldown in ${mode}: ${JSON.stringify({ recovered, cooldownBeforeRetry })}`);
 assert.equal(await page.locator('.pena-native-time-button').getAttribute('title'), 'Затраченное время за сегодня', `Manual recovery kept the timeout error on the time control in ${mode}`);
 assert.equal(await page.locator('.pena-native-toast.--danger.--show').count(), 0, `Manual recovery kept an error toast visible in ${mode}`);
 assert.equal(await timePanel.locator('.pena-native-time-total-value').textContent(), '1 ч 30 мин', `Manual recovery broke the time summary in ${mode}`);
 await page.waitForFunction(() => document.querySelector('.pena-native-toast.--show')?.textContent?.includes('Обновлено · 1 ч 30 мин · 2 задачи'));
 return { mode, submittedBatches: 2, automaticRetries: 0, cooldownBeforeRetry, recoveredQueuedMs: recovered.queuedMs };
}

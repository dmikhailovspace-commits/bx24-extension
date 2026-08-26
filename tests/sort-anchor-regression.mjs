import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const extensionRoot = normalize(process.env.PENA_EXTENSION_DIR || join(root, 'extension'));
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
  const path = pathname.startsWith('/extension/')
    ? normalize(join(extensionRoot, pathname.slice('/extension/'.length)))
    : normalize(join(root, pathname));
  const allowedRoot = pathname.startsWith('/extension/') ? extensionRoot : root;
  if (!path.startsWith(allowedRoot)) return response.writeHead(403).end();
  const stream = createReadStream(path);
  stream.on('error', () => response.writeHead(404).end());
  response.writeHead(200, { 'content-type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8` });
  stream.pipe(response);
});

const listen = () => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const closeServer = () => new Promise(resolve => server.close(resolve));
const managedRows = page => page.evaluate(() => {
  const state = document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState;
  return (state?.view || []).map(row => ({
    id: String(row.id || row.dialogId || ''),
    color: String(row.color || '').toLowerCase(),
    date: Number(row.lastMessageTs || row.addedAt) || 0
  }));
});
const managedIds = async page => (await managedRows(page)).map(row => row.id);
const viewportState = page => page.evaluate(() => {
  const host = document.querySelector('.test-host:not([hidden])');
  const viewport = host?.querySelector('.pena-native-managed-viewport');
  const viewportRect = viewport?.getBoundingClientRect();
  const rows = Array.from(host?.querySelectorAll('.pena-native-managed-row') || []).filter(row => {
    if (!viewportRect || getComputedStyle(row).display === 'none') return false;
    const rect = row.getBoundingClientRect();
    return rect.bottom > viewportRect.top + 1 && rect.top < viewportRect.bottom - 1;
  });
  const anchor = rows[0] || null;
  return {
    scrollTop: viewport?.scrollTop || 0,
    anchorId: anchor?.dataset.id || '',
    anchorOffset: anchor && viewportRect ? anchor.getBoundingClientRect().top - viewportRect.top : 0
  };
});
const assertAnchor = (actual, expected, label) => {
  if (actual.anchorId !== expected.anchorId) {
    throw new Error(`${label}: visible top dialog changed; actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)}`);
  }
  assert.ok(Math.abs(actual.anchorOffset - expected.anchorOffset) < 1, `${label}: anchor moved by ${actual.anchorOffset - expected.anchorOffset}px`);
};
const expectedColorOrder = (baselineRows, direction) => {
  const rank = new Map(baselineRows.map((row, index) => [row.id, index]));
  const valueDirection = direction === 'asc' ? 1 : -1;
  return baselineRows.slice().sort((a, b) => {
    let byColor = 0;
    if (!a.color && b.color) byColor = 1;
    else if (a.color && !b.color) byColor = -1;
    else if (a.color && b.color) byColor = a.color.localeCompare(b.color) * valueDirection;
    return byColor || (rank.get(a.id) - rank.get(b.id));
  });
};
const expectedDateOrder = (baselineRows, direction) => {
  const rank = new Map(baselineRows.map((row, index) => [row.id, index]));
  const valueDirection = direction === 'asc' ? 1 : -1;
  return baselineRows.slice().sort((a, b) => {
    if (!a.date && b.date) return 1;
    if (a.date && !b.date) return -1;
    if (a.date !== b.date) return (a.date - b.date) * valueDirection;
    return rank.get(a.id) - rank.get(b.id);
  });
};
const assertColorlessTail = (rows, label) => {
  const firstColorless = rows.findIndex(row => !row.color);
  assert.ok(firstColorless >= 0, `${label}: fixture has no colorless rows`);
  assert.ok(rows.slice(firstColorless).every(row => !row.color), `${label}: a colored row appears after a colorless row`);
};
const assertExactOrder = (actual, expected, label) => {
  const toKey = value => typeof value === 'string' ? value : `${value.id}:${value.color || 'none'}`;
  const actualKeys = actual.map(toKey);
  const expectedKeys = expected.map(toKey);
  const mismatch = actualKeys.findIndex((value, index) => value !== expectedKeys[index]);
  if (actualKeys.length !== expectedKeys.length || mismatch >= 0) {
    const at = mismatch >= 0 ? mismatch : Math.min(actualKeys.length, expectedKeys.length);
    throw new Error(`${label}; firstMismatch=${at}, actual=${JSON.stringify(actualKeys.slice(Math.max(0, at - 2), at + 5))}, expected=${JSON.stringify(expectedKeys.slice(Math.max(0, at - 2), at + 5))}`);
  }
};
const waitForManagedOrder = (page, expectedIds) => page.waitForFunction(expected => {
  const state = document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState;
  const actual = (state?.view || []).map(row => String(row.id || row.dialogId || ''));
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}, expectedIds, { timeout: 5000 });
const managedContract = page => page.evaluate(() => {
  const host = document.querySelector('.test-host:not([hidden])');
  const source = host?.querySelector('.bx-im-list-container-recent__scroll-container,.bx-im-list-container-task__scroll-container');
  const managed = host?.querySelector('.pena-native-managed-viewport');
  const root = managed?.querySelector(':scope > .pena-native-managed-list');
  return {
    managedCount: host?.querySelectorAll('.pena-native-managed-viewport').length || 0,
    sourceHidden: !!source?.classList.contains('pena-native-source-viewport-hidden'),
    separateSibling: !!source && !!managed && source.parentElement === managed.parentElement && !source.contains(managed),
    rootOwned: !!root && root.parentElement === managed,
    managedVisible: !!managed && getComputedStyle(managed).display !== 'none' && managed.getBoundingClientRect().height > 0
  };
});
const assertManagedContract = async (page, label) => {
  const contract = await managedContract(page);
  assert.deepEqual(contract, {
    managedCount: 1,
    sourceHidden: true,
    separateSibling: true,
    rootOwned: true,
    managedVisible: true
  }, `${label}: invalid hybrid viewport contract`);
};
const nextFrames = (page, count = 2) => page.evaluate(frameCount => new Promise(resolve => {
  const tick = remaining => requestAnimationFrame(() => remaining <= 1 ? resolve() : tick(remaining - 1));
  tick(frameCount);
}), count);

await listen();
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const mode of ['chats', 'tasks']) {
    const page = await browser.newPage({ viewport: { width: 420, height: 760 } });
    try {
      await page.goto(`${base}/tests/native-consistency-harness.html?mode=${mode}&allUnread=1&many=1`);
      await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
      await page.waitForFunction(() => (document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState?.view?.length || 0) > 100);
      await assertManagedContract(page, `${mode} default date-desc catalog`);
      await page.getByRole('button', { name: /Фильтры/ }).click();
      const panel = page.locator('.pena-native-filter-panel');
      await panel.waitFor({ state: 'visible' });
      await panel.locator('.pena-native-unread-filter').click();
      await page.waitForFunction(() => (document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState?.view?.length || 0) > 100);
      await assertManagedContract(page, `${mode} date filter`);
      const viewport = page.locator('.test-host:not([hidden]) .pena-native-managed-viewport');
      const baselineRows = await managedRows(page);
      const dateDescExpected = expectedDateOrder(baselineRows, 'desc');
      const dateAscExpected = expectedDateOrder(baselineRows, 'asc');
      assertExactOrder(baselineRows, dateDescExpected, `${mode}: initial date-desc exact order mismatch`);
      await viewport.evaluate(node => {
        node.scrollTop = Math.floor((node.scrollHeight - node.clientHeight) / 2);
        node.dispatchEvent(new Event('scroll'));
      });
      await nextFrames(page);
      const baselineAnchor = await viewportState(page);
      assert.ok(baselineAnchor.anchorId, `${mode}: missing date baseline anchor`);

      await panel.getByRole('button', { name: 'По возрастанию', exact: true }).click();
      await waitForManagedOrder(page, dateAscExpected.map(row => row.id));
      await nextFrames(page);
      assert.equal(await page.evaluate(currentMode => JSON.parse(localStorage.getItem(`pena.dialogControlView.${currentMode}`) || '{}').sortDirection, mode), 'asc', `${mode}: ascending preference was not persisted`);
      assertExactOrder(await managedRows(page), dateAscExpected, `${mode}: date asc did not reorder rows`);
      assertAnchor(await viewportState(page), baselineAnchor, `${mode}: date asc`);
      await assertManagedContract(page, `${mode} date asc`);

      const ascAnchor = await viewportState(page);
      await panel.getByRole('button', { name: 'По убыванию', exact: true }).click();
      await waitForManagedOrder(page, dateDescExpected.map(row => row.id));
      await nextFrames(page);
      assertExactOrder(await managedRows(page), dateDescExpected, `${mode}: date desc did not restore order`);
      assertAnchor(await viewportState(page), ascAnchor, `${mode}: date desc`);
      await assertManagedContract(page, `${mode} date desc`);
    } catch (error) {
      failures.push(`${mode} date: ${error?.message || error}`);
      console.error(`FAIL native sort ${mode} date: ${error?.message || error}`);
    }

    await page.goto(`${base}/tests/native-consistency-harness.html?mode=${mode}&many=1`);
    await page.locator('.pena-native-folder-switcher').waitFor({ state: 'visible' });
    await page.waitForFunction(() => (document.querySelector('.test-host:not([hidden]) .pena-native-managed-list')?._penaManagedState?.view?.length || 0) > 100);
    await assertManagedContract(page, `${mode} default color fixture catalog`);
    await page.getByRole('button', { name: /Фильтры/ }).click();
    const panel = page.locator('.pena-native-filter-panel');
    await panel.waitFor({ state: 'visible' });
    try {
      const initialRows = await managedRows(page);
      const colorDescExpected = expectedColorOrder(initialRows, 'desc');
      const colorAscExpected = expectedColorOrder(initialRows, 'asc');
      await panel.getByRole('button', { name: 'Цвет', exact: true }).click();
      await waitForManagedOrder(page, colorDescExpected.map(row => row.id));
      await assertManagedContract(page, `${mode} color sort`);
      const viewport = page.locator('.test-host:not([hidden]) .pena-native-managed-viewport');
      const colorBaselineRows = await managedRows(page);
      assert.ok(colorBaselineRows.filter(row => row.color).length >= 10, `${mode}: fixture has too few colored rows`);
      assert.ok(colorBaselineRows.some(row => !row.color), `${mode}: fixture has no colorless rows`);
      assertExactOrder(colorBaselineRows, colorDescExpected, `${mode}: color desc exact order mismatch`);
      assertColorlessTail(colorBaselineRows, `${mode}: color desc`);
      await viewport.evaluate(node => {
        node.scrollTop = Math.floor((node.scrollHeight - node.clientHeight) / 2);
        node.dispatchEvent(new Event('scroll'));
      });
      await nextFrames(page);
      const colorAnchor = await viewportState(page);
      assert.ok(colorAnchor.anchorId, `${mode}: missing color baseline anchor`);

      await panel.getByRole('button', { name: 'По возрастанию', exact: true }).click();
      await waitForManagedOrder(page, colorAscExpected.map(row => row.id));
      await nextFrames(page);
      const colorAscRows = await managedRows(page);
      assertExactOrder(colorAscRows, colorAscExpected, `${mode}: color asc exact order mismatch`);
      assertColorlessTail(colorAscRows, `${mode}: color asc`);
      assertAnchor(await viewportState(page), colorAnchor, `${mode}: color asc`);

      const colorDescAnchor = await viewportState(page);
      await panel.getByRole('button', { name: 'По убыванию', exact: true }).click();
      await waitForManagedOrder(page, colorDescExpected.map(row => row.id));
      await nextFrames(page);
      const colorDescRows = await managedRows(page);
      assertExactOrder(colorDescRows, colorDescExpected, `${mode}: color desc exact order mismatch`);
      assertColorlessTail(colorDescRows, `${mode}: color desc`);
      assertAnchor(await viewportState(page), colorDescAnchor, `${mode}: color desc`);

      const colorAscRestoreAnchor = await viewportState(page);
      await panel.getByRole('button', { name: 'По возрастанию', exact: true }).click();
      await waitForManagedOrder(page, colorAscExpected.map(row => row.id));
      await nextFrames(page);
      assertExactOrder(await managedRows(page), colorAscExpected, `${mode}: color asc did not restore exact order`);
      assertAnchor(await viewportState(page), colorAscRestoreAnchor, `${mode}: color asc restore`);
    } catch (error) {
      failures.push(`${mode} color: ${error?.message || error}`);
      console.error(`FAIL native sort ${mode} color: ${error?.message || error}`);
    }
    await page.close();
  }
  if (failures.length) throw new AggregateError(failures.map(message => new Error(message)), `${failures.length} native sort regression(s) failed`);
  console.log('Native sort and viewport anchor regressions passed.');
} finally {
  await browser.close();
  await closeServer();
}

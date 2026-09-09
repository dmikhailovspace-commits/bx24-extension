import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = new URL('../', import.meta.url);
const inputs = Object.fromEntries(['popup.html', 'popup.css', 'popup.js'].map(name => [name, readFileSync(new URL(`chrome/${name}`, root))]));
const browser = await chromium.launch({ headless: true });
const phases = [];
const errors = [];
async function fixture(config = {}) {
  const page = await browser.newPage({ viewport: { width: 400, height: 650 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(config => {
    const s = window.popupFixture = {
      origins: config.origins || [], url: config.url || 'https://demo.example.test:8443/online/?dialog=42',
      grant: config.grant !== false, requestError: false, hold: false,
      calls: [], closes: 0, syncFailures: 0, ...config
    };
    window.close = () => { s.closes++; };
    document.addEventListener('click', event => { s.lastClickTrusted = event.isTrusted; }, true);
    window.chrome = {
      runtime: {
        getManifest: () => ({ version: '7.5.129' }),
        sendMessage: async message => {
          s.calls.push({ method: 'sync', message });
          if (s.syncFailures > 0) { s.syncFailures--; return { ok: false, error: 'Fixture worker failure' }; }
          return { ok: true };
        }
      },
      permissions: {
        getAll: async () => ({ origins: [...s.origins] }),
        contains: async ({ origins }) => origins.every(origin => s.origins.includes(origin)),
        request: async ({ origins }) => {
          s.calls.push({ method: 'request', origins: [...origins], active: navigator.userActivation.isActive, trusted: s.lastClickTrusted });
          if (s.hold) await new Promise(resolve => { s.release = resolve; });
          if (s.requestError) throw new Error('Fixture permission API error');
          if (s.grant) s.origins = [...new Set([...s.origins, ...origins])];
          return s.grant;
        },
        remove: async ({ origins }) => {
          s.calls.push({ method: 'remove', origins: [...origins] });
          if (s.removeError) throw new Error('Fixture remove error');
          s.origins = s.origins.filter(origin => !origins.includes(origin));
          return true;
        }
      },
      tabs: {
        query: async () => [{ id: 42, url: s.url }],
        get: async id => { s.calls.push({ method: 'getTab', id }); return { id, url: s.url }; },
        reload: async id => { s.calls.push({ method: 'reload', id }); }
      }
    };
  }, config);
  await page.route('https://popup.test/**', route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (inputs[name]) return route.fulfill({ status: 200, contentType: name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript', body: inputs[name] });
    if (name === 'icons/icon48.png') return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(new URL('chrome/assets/icon48.png', root)) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://popup.test/popup.html');
  await page.waitForFunction(() => window.popupFixture.calls.some(call => call.method === 'sync'));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page;
}
async function snapshot(page) {
  return page.evaluate(() => ({
    status: document.querySelector('#status').textContent,
    error: document.querySelector('#status').dataset.error || '',
    host: document.querySelector('#host').textContent,
    connectDisabled: document.querySelector('#connect').disabled,
    connectHidden: document.querySelector('#connect').hidden,
    reloadHidden: document.querySelector('#reload').hidden,
    portals: [...document.querySelectorAll('#portals li > span')].map(node => node.textContent),
    calls: window.popupFixture.calls,
    origins: window.popupFixture.origins,
    closes: window.popupFixture.closes
  }));
}
async function status(page, text) {
  await page.waitForFunction(text => document.querySelector('#status').textContent.includes(text), text, { timeout: 3000 });
}
async function phase(name, config, run) {
  const started = performance.now(); let page;
  try {
    page = await fixture(config); await run(page);
    phases.push({ name, status: 'PASS', ms: performance.now() - started, evidence: await snapshot(page) });
  } catch (error) {
    phases.push({ name, status: 'FAIL', error: error.stack, ms: performance.now() - started, evidence: page ? await snapshot(page).catch(() => null) : null });
  } finally { if (page) await page.close(); }
}
try {
  await phase('cold HTTPS shows host and waits for explicit permission click', {}, async page => {
    const s = await snapshot(page);
    assert.equal(s.host, 'demo.example.test:8443');
    assert.equal(s.connectDisabled, false);
    assert.equal(s.connectHidden, false);
    assert.equal(s.calls.filter(call => call.method === 'request').length, 0);
    assert.equal(await page.locator('a[href="privacy.html"]').count(), 1);
    assert.equal(await page.locator('h1').textContent(), 'Сортировщик чатов');
    await page.screenshot({ path: new URL('./artifacts/chrome-popup-cold.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
  });
  await phase('chrome internal URL cannot request portal access', { url: 'chrome://extensions/' }, async page => {
    await status(page, 'https://');
    const s = await snapshot(page);
    assert.equal(s.connectDisabled, true);
    assert.equal(s.origins.length, 0);
    assert.equal(s.calls.filter(call => call.method === 'request').length, 0);
  });
  await phase('permission denial leaves usable retry and no registered origin', { grant: false }, async page => {
    await page.locator('#connect').click(); await status(page, 'Доступ не выдан');
    const s = await snapshot(page);
    assert.equal(s.connectDisabled, false);
    assert.equal(s.connectHidden, false);
    assert.equal(s.origins.length, 0);
    assert.equal(s.calls.filter(call => call.method === 'sync').length, 1);
  });
  await phase('trusted grant requests exact HTTPS hostname without path, wildcard subdomain or port', {}, async page => {
    await page.locator('#connect').click(); await status(page, 'Готово');
    const s = await snapshot(page); const requests = s.calls.filter(call => call.method === 'request');
    assert.deepEqual(requests, [{ method: 'request', origins: ['https://demo.example.test/*'], active: true, trusted: true }]);
    assert.deepEqual(s.portals, ['demo.example.test']);
    assert.equal(s.connectHidden, true); assert.equal(s.reloadHidden, false);
    assert.equal(s.calls.filter(call => call.method === 'reload').length, 0, 'Grant must not discard unsaved work by automatically reloading');
  });
  await phase('permission API error is visible and next explicit attempt succeeds', { requestError: true }, async page => {
    await page.locator('#connect').click(); await status(page, 'Не удалось подключить');
    const failed = await snapshot(page);
    assert.equal(failed.error, 'true'); assert.equal(failed.connectDisabled, false);
    await page.evaluate(() => { popupFixture.requestError = false; });
    await page.locator('#connect').click(); await status(page, 'Готово');
    const s = await snapshot(page);
    assert.equal(s.error, 'false'); assert.equal(s.calls.filter(call => call.method === 'request').length, 2);
  });
  await phase('revoke removes only selected portal and asks to reload existing page', { origins: ['https://demo.example.test/*', 'https://other.example.test/*'] }, async page => {
    await page.getByRole('button', { name: 'Отключить demo.example.test', exact: true }).click();
    await status(page, 'Портал отключён');
    const s = await snapshot(page);
    assert.deepEqual(s.origins, ['https://other.example.test/*']);
    assert.deepEqual(s.calls.filter(call => call.method === 'remove').map(call => call.origins), [['https://demo.example.test/*']]);
    assert.equal(s.connectHidden, false); assert.equal(s.reloadHidden, false);
    assert.equal(s.calls.filter(call => call.method === 'reload').length, 0);
  });
  await phase('held permission prompt bounds repeated actual clicks to one request', { hold: true }, async page => {
    const button = page.locator('#connect'); const box = await button.boundingBox();
    await button.click();
    await page.waitForFunction(() => popupFixture.calls.some(call => call.method === 'request'));
    for (let i = 0; i < 4; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await button.isDisabled(), true);
    assert.equal((await snapshot(page)).calls.filter(call => call.method === 'request').length, 1);
    await page.evaluate(() => popupFixture.release()); await status(page, 'Готово');
    assert.equal((await snapshot(page)).calls.filter(call => call.method === 'request').length, 1);
  });
  await phase('reload refuses changed tab origin', { origins: ['https://demo.example.test/*'] }, async page => {
    await page.evaluate(() => { popupFixture.url = 'https://other.example.test/online/'; });
    await page.locator('#reload').click(); await status(page, 'Адрес вкладки изменился');
    const s = await snapshot(page);
    assert.equal(s.calls.filter(call => call.method === 'reload').length, 0);
    assert.equal(s.closes, 0);
  });
  await phase('same-origin reload runs once and closes the popup', { origins: ['https://demo.example.test/*'] }, async page => {
    await page.locator('#reload').click();
    await page.waitForFunction(() => popupFixture.closes === 1);
    const s = await snapshot(page);
    assert.deepEqual(s.calls.filter(call => call.method === 'reload'), [{ method: 'reload', id: 42 }]);
  });
} finally { await browser.close(); }
mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
const report = { scope: 'Actual Chrome popup DOM; mocked Chrome APIs, not an installed-extension permission-dialog test',
  sourceHashes: Object.fromEntries(Object.entries(inputs).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])), phases, errors };
writeFileSync(new URL('./artifacts/chrome-popup-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (errors.length || phases.some(item => item.status !== 'PASS')) process.exitCode = 1;

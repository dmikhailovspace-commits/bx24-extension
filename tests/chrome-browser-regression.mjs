import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { buildChrome } from '../tools/build-chrome.mjs';
const require = createRequire(import.meta.url), { chromium } = require('playwright');
mkdirSync(resolve('tests/artifacts'), { recursive:true });
const packageDir = mkdtempSync(resolve('tests/artifacts/chrome-browser-package-'));
const build = buildChrome(packageDir);
const origin = 'https://portal.chrome.test';
const phases = [], errors = [], consoleErrors = [];
let context;
const profiles = [];
async function launch(extension, existingProfile) {
  const profile = existingProfile || mkdtempSync(join(tmpdir(), 'bx24-chrome-test-'));
  if (!existingProfile) profiles.push(profile);
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  context.on('page', p => p.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  return { worker, id };
}
try {
  // Production manifest with no grants: the real MV3 worker stays dormant.
  let { worker, id } = await launch(build.unpacked);
  await worker.evaluate(async () => { await chrome.runtime.sendMessage({ channel: 'pena.chrome.portal.v1', action: 'sync' }).catch(() => {}); });
  assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
  assert.deepEqual((await worker.evaluate(() => chrome.permissions.getAll())).origins || [], []);
  const cold = await context.newPage();
  await cold.route('https://**/*', r => r.fulfill({ contentType: 'text/html', body: '<html><body><div class="bx-im-list-container-recent__elements">No access granted</div></body></html>' }));
  await cold.goto(`${origin}/online/`);
  assert.equal(await cold.evaluate(() => window.__ANITREC_RUNNING__), undefined);
  phases.push({ name: 'real MV3 install has no site access or automatic injection', status: 'PASS' });
  await context.close();

  // A test-only manifest grants one HTTPS fixture host. This models accepted
  // Chrome consent without automating or claiming to test Chrome's native dialog.
  const grantedDir = join(packageDir, 'granted-fixture');
  mkdirSync(grantedDir, { recursive: true }); cpSync(build.unpacked, grantedDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(grantedDir, 'manifest.json')));
  manifest.host_permissions = [`${origin}/*`];
  writeFileSync(join(grantedDir, 'manifest.json'), JSON.stringify(manifest));
  ({ worker, id } = await launch(grantedDir));
  const sync = async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const result = await popup.evaluate(() => chrome.runtime.sendMessage({ channel: 'pena.chrome.portal.v1', action: 'sync' }));
    assert.equal(result.ok, true);
    await popup.close();
  };
  await sync();
  const registered = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.deepEqual(registered[0].matches, [`${origin}/*`]);
  assert.equal(registered[0].persistAcrossSessions, true);
  let fixture = readFileSync('tests/native-cold-start-layout-harness.html', 'utf8');
  fixture = fixture.replace(/<link[^>]+injected\.css[^>]*>/g, '').replace(/<script src="\.\.\/extension\/[^>]+><\/script>/g, '').replace('<script>window.__coldStartHarness.markExtensionLoaded();</script>', '');
  fixture = fixture.replaceAll('<script>', '<script nonce="fixture">');
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url());
    const body = url.pathname.includes('/online/') ? fixture : '<!doctype html><body><main>Native task or unrelated site</main></body>';
    return route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': "script-src 'nonce-fixture'; object-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: chrome-extension:; font-src chrome-extension:" }, body });
  });
  const page = await context.newPage();
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto(`${origin}/online/?layoutDelay=50`);
  await page.waitForFunction(() => !!window.__ANITREC_RUNNING__, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.__ANITREC_RUNNING__), build.version);
  await page.waitForFunction(() => !!document.querySelector('.pena-native-folder-switcher'), null, { timeout: 15000 });
  assert.ok(await page.evaluate(() => window.__PENA_NATIVE_CATALOG__ || window.__PENA_TIME_CONTROL__));
  assert.ok(!requests.some(url => /github|raw\.githubusercontent|id-pr\.ru/.test(url)));
  assert.equal(await page.locator('script[src*="chrome-extension"],link[href*="injected.css"]').count(), 0);
  const css = await page.locator('.pena-native-folder-switcher').evaluate(el => getComputedStyle(el).display);
  assert.notEqual(css, 'inline');
  const fonts = await page.evaluate(async () => {
    await document.fonts.load('14px "Onest Variable"');
    await document.fonts.load('14px "Unbounded Variable"');
    return ['Onest Variable', 'Unbounded Variable'].map(name => document.fonts.check(`14px "${name}"`));
  });
  assert.deepEqual(fonts, [true, true]);
  assert.ok(!requests.some(url => url.startsWith(origin) && url.includes('/fonts/')), 'packaged fonts never request portal-relative paths');
  phases.push({ name: 'granted HTTPS Messenger loads real worker + MAIN runtime under nonce-only script CSP', status: 'PASS', version: build.version });

  const task = await context.newPage();
  await task.goto(`${origin}/company/personal/user/7/tasks/task/view/42/`);
  assert.equal(await task.evaluate(() => window.__ANITREC_RUNNING__), undefined);
  const other = await context.newPage();
  await other.goto('https://unrelated.chrome.test/online/');
  assert.equal(await other.evaluate(() => window.__ANITREC_RUNNING__), undefined);
  phases.push({ name: 'task surface and other host retain native page without runtime', status: 'PASS' });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await page.bringToFront();
  await popup.reload();
  await popup.waitForFunction(() => document.getElementById('portal-heading').textContent === 'Портал подключён');
  assert.equal(await popup.locator('#host').textContent(), 'portal.chrome.test');
  assert.equal(await popup.locator('#connect').isVisible(), false);
  assert.equal(await popup.locator('#reload').isVisible(), true);
  assert.equal(await popup.evaluate(() => document.body.scrollWidth > innerWidth), false);
  await popup.setViewportSize({ width: 360, height: 580 });
  await popup.screenshot({ path: 'tests/artifacts/chrome-popup-connected.png' });
  const before = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  await sync();
  assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), before);
  phases.push({ name: 'real extension popup reads grants, renders connected host and reuses registration', status: 'PASS' });
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  await worker.evaluate(() => chrome.storage.local.set({ 'chrome.acceptance.marker': { folder: 'work', color: '#245c59' } }));
  const persistentProfile = profiles.at(-1);
  await context.close();
  ({ worker, id } = await launch(grantedDir, persistentProfile));
  await sync();
  assert.deepEqual((await worker.evaluate(() => chrome.storage.local.get('chrome.acceptance.marker')))['chrome.acceptance.marker'], { folder: 'work', color: '#245c59' });
  assert.deepEqual((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()))[0].matches, [`${origin}/*`]);
  phases.push({ name: 'browser and service-worker restart preserve local data and portal registration', status: 'PASS' });
} finally {
  await context?.close();
  for (const profile of profiles) {
    // mkdtemp returns a resolved, task-owned child under the OS temp directory.
    if (profile.startsWith(join(tmpdir(), 'bx24-chrome-test-'))) rmSync(profile, { recursive: true, force: true });
  }
  mkdirSync('tests/artifacts', { recursive: true });
  writeFileSync('tests/artifacts/chrome-browser-regression.json', JSON.stringify({ packageSha256: build.sha256, phases, errors, consoleErrors, nativePermissionPromptTested: false, liveBitrixTested: false, grantedHostFixture: true }, null, 2));
}
console.log(`PASS actual MV3 browser: ${phases.length} scenarios; native permission dialog and live Bitrix remain manual checks`);

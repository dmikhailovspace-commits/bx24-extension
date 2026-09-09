import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transformChromeContent } from '../chrome/content-transform.mjs';

const source = readFileSync(new URL('../chrome/portal-worker.js', import.meta.url), 'utf8');
const content = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const channel = 'pena.chrome.portal.v1';
const report = { sourceSha: createHash('sha256').update(source).digest('hex'), phases: [], limitations: 'Actual worker and injected probe in deterministic Chrome API mocks. Browser/CSP acceptance is a separate suite.' };
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { for (const fn of this.listeners) fn(...args); } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(test) { for (let i = 0; i < 1000; i++) { if (test()) return; await Promise.resolve(); } throw new Error('Expected controlled gate was not reached'); }
function fixture(initial = ['https://portal.test/*']) {
  const state = { origins: initial, registered: [], calls: [], getHook: null, scriptHook: null, registerHook: null, stale: false, failFiles: false, silentFileError: false, surface: true, url: 'https://portal.test/online/', child: false };
  const realms = new Map();
  const runtime = { id: 'extension-id', getManifest: () => ({ version: '7.5.132' }), getURL: file => `chrome-extension://extension-id/${file}`, onMessage: event(), onInstalled: event(), onStartup: event() };
  const chrome = { runtime, permissions: {
    getAll: async () => { const snapshot = [...state.origins]; if (state.getHook) await state.getHook(); return { origins: snapshot }; },
    onAdded: event(), onRemoved: event(),
  }, scripting: {
    getRegisteredContentScripts: async () => state.registered,
    registerContentScripts: async definitions => { state.calls.push({ op: 'register', definitions }); if (state.registerHook) await state.registerHook(); state.registered = definitions; },
    updateContentScripts: async definitions => { state.calls.push({ op: 'update', definitions }); state.registered = definitions; },
    unregisterContentScripts: async () => { state.calls.push({ op: 'unregister' }); state.registered = []; },
    insertCSS: async args => { state.calls.push({ op: 'css', ...args }); if (state.stale) throw new Error('No document with id'); },
    executeScript: async args => {
      state.calls.push({ op: 'execute', ...args });
      assert.deepEqual(Object.keys(args.target).sort(), ['documentIds', 'tabId']);
      if (state.stale) throw new Error('No document with id');
      if (state.scriptHook) await state.scriptHook(args);
      if (args.files) {
        if (state.failFiles) throw new Error('Script transport failed');
        if (!state.silentFileError) Object.assign(realms.get(`${args.target.documentIds[0]}:MAIN`), {
          __PENA_NATIVE_CATALOG__: { buildIndex() {} }, __PENA_INTERACTIONS__: { createInteractionState() {} },
          __PENA_TIME_CONTROL__: { loadElapsedItems() {} }, __PENA_NATIVE_LIFECYCLE__: { createLifecycleController() {} },
          __PENA_DIALOG_REPOSITORY__: { get() {} }, __ANITREC_RUNNING__: '7.5.132',
        });
        return [{ documentId: args.target.documentIds[0], result: undefined }];
      }
      const key = `${args.target.documentIds[0]}:${args.world}`;
      if (!realms.has(key)) {
        const self = {};
        const ctx = { self, top: state.child ? {} : self, location: new URL(state.url), document: { querySelector: () => state.surface ? {} : null } };
        ctx.window = ctx;
        realms.set(key, vm.createContext(ctx));
      }
      const realm = realms.get(key);
      realm.args = args.args || [];
      const result = vm.runInContext(`(${args.func.toString()})(...args)`, realm);
      return [{ documentId: args.target.documentIds[0], result }];
    },
  } };
  const context = vm.createContext({ chrome, URL, console: { warn() {} }, Map, Set, Promise });
  vm.runInContext(source, context);
  const sender = overrides => ({ id: runtime.id, tab: { id: 7 }, frameId: 0, documentId: 'document-a', url: state.url, origin: new URL(state.url).origin, ...overrides });
  const message = (action, from = { id: runtime.id }, extra = {}) => new Promise(resolve => runtime.onMessage.listeners[0]({ channel, action, ...extra }, from, resolve));
  return { state, chrome, sender, message, realms };
}
async function phase(name, run) { try { report.phases.push({ name, status: 'PASS', evidence: await run() }); } catch (error) { report.phases.push({ name, status: 'FAIL', error: error.stack }); } }

await phase('exact HTTPS authority, persistent frame registration and removal', async () => {
  const f = fixture(['https://portal.test/*', 'http://insecure.test/*', 'https://*.broad.test/*', '<all_urls>', 'https://portal.test/*']);
  const first = await f.message('sync');
  assert.deepEqual([...first.origins], ['https://portal.test/*']);
  const registration = f.state.registered[0];
  assert.equal(registration.allFrames, true); assert.equal(registration.runAt, 'document_start'); assert.equal(registration.persistAcrossSessions, true);
  assert.equal(f.state.calls.filter(x => x.op === 'register').length, 1);
  f.state.origins = []; f.chrome.permissions.onRemoved.emit({ origins: ['https://portal.test/*'] });
  await f.message('sync'); assert.equal(f.state.registered.length, 0);
  assert.equal(f.chrome.permissions.request, undefined, 'worker has no automatic permission request');
});
await phase('revocation while registration is pending is reconciled before sync returns', async () => {
  const f = fixture(); const hold = deferred(); f.state.registerHook = () => hold.promise;
  await until(() => f.state.calls.some(x => x.op === 'register'));
  f.state.origins = []; f.chrome.permissions.onRemoved.emit();
  const sync = f.message('sync'); hold.resolve();
  assert.deepEqual([...(await sync).origins], []); assert.equal(f.state.registered.length, 0);
});
await phase('injection fixed files, MAIN world, document fencing, logo and once-only claim', async () => {
  const f = fixture(); await f.message('sync');
  const result = await f.message('inject', f.sender(), { files: ['evil.js'], url: 'https://evil.test/' }); assert.equal(result.ok, true);
  const scripts = f.state.calls.filter(x => x.files && x.op === 'execute');
  assert.equal(scripts.length, 1); assert.equal(scripts[0].world, 'MAIN');
  assert.deepEqual([...scripts[0].files], ['native-catalog.js', 'native-interaction-state.js', 'native-time-control.js', 'native-lifecycle.js', 'dialog-repository.js', 'injected.js']);
  assert.equal(f.state.calls.filter(x => x.op === 'css').length, 1);
  assert.equal(f.realms.get('document-a:MAIN').__PENA_LOGO_URL_OVERRIDE__, 'chrome-extension://extension-id/icons/logo.png');
  assert.equal((await f.message('inject', f.sender())).alreadyInjected, true);
  assert.equal(f.state.calls.filter(x => x.files && x.op === 'execute').length, 1);
});
await phase('untrusted, popup, denied, insecure, child and absent documents cannot inject', async () => {
  for (const override of [{ tab: undefined }, { id: 'another-extension' }, { documentId: '' }, { url: 'https://denied.test/online/', origin: 'https://denied.test' }, { url: 'http://portal.test/online/', origin: 'http://portal.test' }, { frameId: 2, url: 'https://portal.test/tasks/task/view/3/' }, { origin: 'https://other.test' }]) {
    const f = fixture(); await f.message('sync');
    assert.equal((await f.message('inject', f.sender(override))).ok, false);
    assert.equal(f.state.calls.filter(x => x.op === 'execute' || x.op === 'css').length, 0);
  }
});
await phase('non-Messenger top rejected, supported IM_LINES child accepted', async () => {
  const f = fixture(); await f.message('sync'); f.state.url = 'https://portal.test/crm/'; f.state.surface = false;
  assert.equal((await f.message('inject', f.sender())).error, 'UNSUPPORTED_DOCUMENT');
  assert.equal(f.state.calls.filter(x => x.op === 'css').length, 0);
  const child = fixture(); child.state.url = 'https://portal.test/desktop_app/?IM_LINES=Y'; child.state.child = true;
  assert.equal((await child.message('inject', child.sender({ frameId: 4 }))).ok, true);
});
await phase('permission removed during document probe stops unsent CSS/runtime', async () => {
  const f = fixture(); await f.message('sync');
  f.state.scriptHook = async () => { f.state.scriptHook = null; f.state.origins = []; f.chrome.permissions.onRemoved.emit(); };
  assert.equal((await f.message('inject', f.sender())).error, 'PORTAL_PERMISSION_REVOKED');
  assert.equal(f.state.calls.filter(x => x.op === 'css' || x.files).length, 0);
});
await phase('stale document has no frame fallback and transport failure is not success on retry', async () => {
  const stale = fixture(); stale.state.stale = true;
  assert.equal((await stale.message('inject', stale.sender())).ok, false);
  assert.equal(stale.state.calls.filter(x => x.op === 'css').length, 0);
  const failed = fixture(); failed.state.failFiles = true;
  assert.equal((await failed.message('inject', failed.sender())).error, 'Script transport failed');
  failed.state.failFiles = false;
  assert.equal((await failed.message('inject', failed.sender())).error, 'PARTIAL_RUNTIME_RELOAD_REQUIRED');
  assert.equal(failed.state.calls.filter(x => x.op === 'execute' && x.files).length, 1);
});
await phase('concurrent document launch shares one transport', async () => {
  const f = fixture(); await f.message('sync'); const hold = deferred(); let entered = false;
  f.state.scriptHook = async () => { entered = true; await hold.promise; };
  const first = f.message('inject', f.sender()); await until(() => entered);
  const second = f.message('inject', f.sender()); hold.resolve();
  assert.equal((await first).ok, true); assert.equal((await second).ok, true);
  assert.equal(f.state.calls.filter(x => x.op === 'execute' && x.files).length, 1);
});
await phase('resolved script transport with missing runtime exports cannot acknowledge readiness', async () => {
  const f = fixture(); f.state.silentFileError = true;
  assert.equal((await f.message('inject', f.sender())).error, 'RUNTIME_NOT_READY');
  assert.equal(f.realms.get('document-a:ISOLATED').__PENA_CHROME_RUNTIME_CLAIM__, 'pending');
  assert.equal((await f.message('inject', f.sender())).error, 'PARTIAL_RUNTIME_RELOAD_REQUIRED');
  assert.equal(f.state.calls.filter(x => x.op === 'execute' && x.files).length, 1);
});
await phase('deterministic strict transform retains release verification, health and bridge', async () => {
  const result = transformChromeContent(content);
  new vm.Script(result);
  assert.equal(result, transformChromeContent(content));
  assert.equal(result, transformChromeContent(content.replace(/\r?\n/g, '\r\n')));
  assert.match(result, /await verifyRelease\(\);\n      await injectChromeRuntime\(\);/);
  assert.match(result, /void _ensureRepositoryWorker\(\)/);
  assert.match(result, /pena\.dialog\.repository\.v2/);
  assert.doesNotMatch(result, /script\.src\s*=|link\.href\s*=/);
  assert.throws(() => transformChromeContent(content + content), /expected once/);
  assert.throws(() => transformChromeContent(content.replace("await inject('native-catalog.js');", "await inject('changed.js');")), /ordered runtime launch/);
  assert.throws(() => transformChromeContent(result), /expected once/);
});

mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
writeFileSync(new URL('./artifacts/chrome-portal-worker-regression.json', import.meta.url), JSON.stringify(report, null, 2));
for (const phase of report.phases) console.log(`${phase.status}: ${phase.name}${phase.error ? `\n${phase.error}` : ''}`);
assert.equal(report.phases.filter(x => x.status === 'FAIL').length, 0, 'Chrome portal worker regression failed');

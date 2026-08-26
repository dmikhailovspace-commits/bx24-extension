import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');

const createHarness = async (initialValue, { delayedRoot = false } = {}) => {
  const listeners = new Map();
  const storageListeners = [];
  const mutationObservers = [];
  const injected = [];
  const state = { value: initialValue, reloads: 0, applied: [] };
  const addEventListener = (type, listener, options = {}) => {
    const entries = listeners.get(type) || [];
    entries.push({ listener, once: !!options.once });
    listeners.set(type, entries);
  };
  const removeEventListener = (type, listener) => {
    const entries = listeners.get(type) || [];
    listeners.set(type, entries.filter(entry => entry.listener !== listener));
  };
  const dispatchEvent = event => {
    const entries = [...(listeners.get(event.type) || [])];
    entries.forEach(entry => entry.listener(event));
    listeners.set(event.type, entries.filter(entry => !entry.once));
    return true;
  };
  const root = {
    dataset: {},
    appendChild(script) {
      injected.push(script.src);
      queueMicrotask(() => script.onload?.());
    }
  };
  const document = {
    documentElement: delayedRoot ? null : root,
    head: null,
    body: null,
    addEventListener,
    removeEventListener,
    dispatchEvent,
    createElement() {
      return { dataset: {}, remove() {} };
    }
  };
  const location = { pathname: '/desktop_app/', reload: () => { state.reloads += 1; } };
  const window = { location };
  window.window = window;
  window.top = window;
  const chrome = {
    runtime: {
      getURL: path => `chrome-extension://pena/${path}`,
      getManifest: () => ({ version: '7.5.32' })
    },
    storage: {
      local: {
        get(_keys, callback) { callback(state.value === undefined ? {} : { 'pena.extension.enabled': state.value }); },
        set(values, callback) {
          state.value = values['pena.extension.enabled'];
          callback?.();
        }
      },
      onChanged: { addListener(listener) { storageListeners.push(listener); } }
    }
  };
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { mutationObservers.push(this); }
    disconnect() {}
  }
  addEventListener('pena-extension-enabled-applied', event => state.applied.push(event.detail?.enabled));
  const context = {
    chrome,
    document,
    location,
    window,
    self: window,
    top: window,
    CustomEvent,
    MutationObserver,
    fetch: async () => ({ ok: true, json: async () => ({ version: '7.5.32' }) }),
    setTimeout,
    clearTimeout,
    console
  };
  vm.runInNewContext(source, context, { filename: 'content.js' });
  if (delayedRoot) {
    assert.equal(injected.length, 0, 'runtime must wait until the document root exists');
    document.documentElement = root;
    mutationObservers.forEach(observer => observer.callback([]));
  }
  await new Promise(resolve => setTimeout(resolve, 10));
  return { state, root, document, storageListeners, injected, CustomEvent };
};

const enabledByDefault = await createHarness(undefined);
assert.equal(enabledByDefault.root.dataset.penaExtensionEnabled, '1');
assert.equal(enabledByDefault.injected.length, 6);

const delayedDisabled = await createHarness('0', { delayedRoot: true });
assert.equal(delayedDisabled.root.dataset.penaExtensionEnabled, '0');
assert.equal(delayedDisabled.injected.length, 6);

const disabled = await createHarness('0');
assert.equal(disabled.root.dataset.penaExtensionEnabled, '0');
disabled.document.dispatchEvent(new disabled.CustomEvent('pena-extension-enabled-request', { detail: { enabled: true } }));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(disabled.state.value, '1');
assert.equal(disabled.root.dataset.penaExtensionEnabled, '1');
assert.deepEqual(disabled.state.applied, [true]);

disabled.storageListeners.forEach(listener => listener({
  'pena.extension.enabled': { oldValue: '1', newValue: '0' }
}, 'local'));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(disabled.root.dataset.penaExtensionEnabled, '0');
assert.equal(disabled.state.reloads, 1);

console.log('PASS extension enable state: one shared setting across Bitrix frames');

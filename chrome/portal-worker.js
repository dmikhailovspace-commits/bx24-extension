/* Chrome-only adapter. The desktop worker and runtime stay unchanged. */
(() => {
  'use strict';
  const CHANNEL = 'pena.chrome.portal.v1';
  const SCRIPT_ID = 'pena-chrome-portals-v1';
  const FILES = ['native-catalog.js', 'native-interaction-state.js', 'native-time-control.js', 'native-lifecycle.js', 'dialog-repository.js', 'injected.js'];
  const flights = new Map();
  let permissionRevision = 0;
  let syncTail = Promise.resolve();

  const exactOrigin = value => {
    if (typeof value !== 'string' || !/^https:\/\/[^/*]+\/\*$/.test(value)) return null;
    try {
      const url = new URL(value.slice(0, -1));
      if (url.username || url.password || url.port || url.hostname.includes('*')) return null;
      return `https://${url.hostname}/*`;
    } catch { return null; }
  };
  const origins = async () => [...new Set((await chrome.permissions.getAll()).origins?.map(exactOrigin).filter(Boolean) || [])].sort();
  const reconcile = () => {
    const run = async () => {
      // Events during getAll/register are reconciled again before acknowledging sync.
      let revision;
      let desired;
      do {
        revision = permissionRevision;
        desired = await origins();
        const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
        const previous = registered.find(item => item.id === SCRIPT_ID);
        if (!desired.length) {
          if (previous) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
        } else {
          const definition = { id: SCRIPT_ID, matches: desired, js: ['content.js'], allFrames: true, runAt: 'document_start', persistAcrossSessions: true, world: 'ISOLATED' };
          if (!previous) await chrome.scripting.registerContentScripts([definition]);
          else if (JSON.stringify(previous.matches?.slice().sort()) !== JSON.stringify(desired) || previous.js?.join() !== 'content.js' || !previous.allFrames || previous.runAt !== 'document_start' || previous.persistAcrossSessions === false) {
            await chrome.scripting.updateContentScripts([definition]);
          }
        }
      } while (revision !== permissionRevision);
      return { ok: true, origins: desired };
    };
    const flight = syncTail.then(run, run);
    syncTail = flight.catch(() => {});
    return flight;
  };

  async function inject(sender) {
    if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || !Number.isInteger(sender.frameId) || sender.frameId < 0 || typeof sender.documentId !== 'string' || !sender.documentId) throw new Error('INVALID_DOCUMENT');
    const url = new URL(sender.url || '');
    if (url.protocol !== 'https:' || (sender.origin && sender.origin !== url.origin)) throw new Error('INVALID_ORIGIN');
    if (sender.frameId !== 0 && !(/\/desktop_app(?:\/|$)/i.test(url.pathname) && /(?:^|[?&])IM_LINES=Y(?:&|$)/i.test(url.search))) throw new Error('UNSUPPORTED_FRAME');
    if (/\/marketplace\//.test(url.pathname)) throw new Error('UNSUPPORTED_SURFACE');
    const origin = `https://${url.hostname}/*`;
    const revision = permissionRevision;
    const authorize = async () => {
      if (revision !== permissionRevision || !(await origins()).includes(origin) || revision !== permissionRevision) throw new Error('PORTAL_PERMISSION_REVOKED');
    };
    await authorize();
    const key = `${sender.tab.id}:${sender.documentId}`;
    if (flights.has(key)) return flights.get(key);
    const run = async () => {
      const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
      // Probe in the isolated realm, where the page cannot forge this result.
      const probe = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: () => {
        if (self !== top) return /\/desktop_app(?:\/|$)/i.test(location.pathname) && /(?:^|[?&])IM_LINES=Y(?:&|$)/i.test(location.search);
        if (/\/marketplace\//.test(location.pathname)) return false;
        return /\/(?:online|desktop_app)(?:\/|$)/i.test(location.pathname) || !!document.querySelector('.bx-im-list-container-recent__elements,.bx-im-list-container-task__elements,.bx-messenger-recent-wrap.bx-messenger-recent-lines-wrap');
      } });
      if (probe.length !== 1 || probe[0].documentId !== sender.documentId || probe[0].result !== true) throw new Error('UNSUPPORTED_DOCUMENT');
      await authorize();
      // An isolated per-document claim survives worker restarts. A partial runtime
      // must be recovered by reloading, never by redeclaring top-level constants.
      const claim = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: () => {
        if (globalThis.__PENA_CHROME_RUNTIME_CLAIM__) return globalThis.__PENA_CHROME_RUNTIME_CLAIM__;
        globalThis.__PENA_CHROME_RUNTIME_CLAIM__ = 'pending';
        return 'claimed';
      } });
      if (claim.length !== 1 || claim[0].documentId !== sender.documentId) throw new Error('STALE_DOCUMENT');
      if (claim[0].result === 'ready') return { ok: true, alreadyInjected: true };
      if (claim[0].result !== 'claimed') throw new Error('PARTIAL_RUNTIME_RELOAD_REQUIRED');
      await authorize();
      await chrome.scripting.insertCSS({ target, files: ['injected.css'] });
      await authorize();
      await chrome.scripting.executeScript({ target, world: 'MAIN', func: logo => { window.__PENA_LOGO_URL_OVERRIDE__ = logo; }, args: [chrome.runtime.getURL('icons/logo.png')] });
      await authorize();
      await chrome.scripting.executeScript({ target, world: 'MAIN', files: FILES.slice() });
      await authorize();
      const ready = await chrome.scripting.executeScript({ target, world: 'MAIN', func: version => (
        typeof window.__PENA_NATIVE_CATALOG__?.buildIndex === 'function' &&
        typeof window.__PENA_INTERACTIONS__?.createInteractionState === 'function' &&
        typeof window.__PENA_TIME_CONTROL__?.loadElapsedItems === 'function' &&
        typeof window.__PENA_NATIVE_LIFECYCLE__?.createLifecycleController === 'function' &&
        typeof window.__PENA_DIALOG_REPOSITORY__?.get === 'function' &&
        window.__ANITREC_RUNNING__ === version
      ), args: [chrome.runtime.getManifest().version] });
      if (ready.length !== 1 || ready[0].documentId !== sender.documentId || ready[0].result !== true) throw new Error('RUNTIME_NOT_READY');
      await authorize();
      await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: () => { globalThis.__PENA_CHROME_RUNTIME_CLAIM__ = 'ready'; } });
      return { ok: true };
    };
    const flight = run();
    flights.set(key, flight);
    try { return await flight; } finally { if (flights.get(key) === flight) flights.delete(key); }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.channel !== CHANNEL) return;
    if (sender.id !== chrome.runtime.id) { respond({ ok: false, error: 'INVALID_SENDER' }); return; }
    const task = message.action === 'sync' ? reconcile() : message.action === 'inject' ? inject(sender) : Promise.reject(new Error('UNKNOWN_ACTION'));
    task.then(respond, error => respond({ ok: false, error: String(error?.message || error) }));
    return true;
  });
  const changed = () => { permissionRevision++; void reconcile().catch(error => console.warn('[PENA Chrome] Portal registration failed:', error)); };
  chrome.permissions.onAdded.addListener(changed);
  chrome.permissions.onRemoved.addListener(changed);
  chrome.runtime.onInstalled.addListener(changed);
  chrome.runtime.onStartup.addListener(changed);
  void reconcile().catch(error => console.warn('[PENA Chrome] Portal registration failed:', error));
})();

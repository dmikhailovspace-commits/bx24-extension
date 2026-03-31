// PENA Agency — background service worker

const UPDATE_JSON_URL =
  'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';

function isNewer(remote, local) {
  const p = v => v.split('.').map(Number);
  const [ra, rb, rc] = p(remote), [la, lb, lc] = p(local);
  if (ra !== la) return ra > la;
  if (rb !== lb) return rb > lb;
  return rc > lc;
}

// Уведомить все открытые вкладки о доступном обновлении
async function _notifyTabs(version, injected_js_url) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'UPDATE_AVAILABLE', version, injected_js_url,
      }).catch(() => {});
    }
  } catch (_) {}
}

async function checkForUpdates() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch(UPDATE_JSON_URL, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) return;
    const data = await resp.json();
    const remoteVer = String(data.version || '');
    const localVer  = chrome.runtime.getManifest().version;
    if (remoteVer && isNewer(remoteVer, localVer)) {
      const info = {
        hasUpdate: true,
        version: remoteVer,
        injected_js_url: data.injected_js_url || '',
      };
      chrome.storage.local.set({ anit_update_info: info });
      // Немедленно показываем баннер во всех открытых вкладках
      _notifyTabs(remoteVer, data.injected_js_url || '');
    } else {
      chrome.storage.local.set({ anit_update_info: { hasUpdate: false } });
    }
  } catch (_) {}
}

// ── Инжект кешированного injected.js в MAIN мир страницы ─────────────────────
async function _injectCached(tabId) {
  let stored;
  try {
    stored = await chrome.storage.local.get(['pena.injected_cache', 'pena.injected_ver']);
  } catch (_) { return { ok: false, reason: 'storage_error' }; }

  const code = stored['pena.injected_cache'] || '';
  const ver  = stored['pena.injected_ver']   || '';
  if (!code || !ver) return { ok: false, reason: 'no_cache' };

  if (!isNewer(ver, chrome.runtime.getManifest().version)) {
    return { ok: false, reason: 'not_newer', ver };
  }

  const logoUrl = chrome.runtime.getURL('icons/logo.png');
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (src, logo) => {
        const oldPanel = document.getElementById('anit-filters');
        delete window.__ANITREC_RUNNING__;
        window.__PENA_LOGO_URL_OVERRIDE__ = logo;
        let ok = false;
        try { (0, eval)(src); ok = !!window.__ANITREC_RUNNING__; } catch (e) { console.error('[PENA] inject error:', e); } // eslint-disable-line no-eval
        delete window.__PENA_LOGO_URL_OVERRIDE__;
        if (ok && oldPanel) oldPanel.remove();
        return ok;
      },
      args: [code, logoUrl],
    });
    const ok = results?.[0]?.result === true;
    return { ok, ver };
  } catch (e) {
    console.warn('[PENA/BG] executeScript failed:', String(e));
    return { ok: false, reason: 'exec_error', ver };
  }
}

// ── Обработчик сообщений ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg?.type === 'PENA_PANEL_BUILT') {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    chrome.storage.local.get('pena.update_pending', async (s) => {
      if (!s['pena.update_pending']) return;
      const result = await _injectCached(tabId);
      chrome.storage.local.remove('pena.update_pending');
      if (!result.ok && result.reason !== 'not_newer') {
        chrome.tabs.sendMessage(tabId, {
          type: 'PENA_NEED_MANUAL_RESTART', _pena_dl: true,
        }).catch(() => {});
      }
    });
    return;
  }

  if (msg?.type === 'EXEC_CACHED_INJECTED') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false }); return; }

    (async () => {
      const result = await _injectCached(tabId);

      if (result.ok) {
        chrome.storage.local.remove('pena.update_pending');
        try { sendResponse({ ok: true }); } catch (_) {}
        return;
      }

      chrome.tabs.sendMessage(tabId, {
        type: 'PENA_NEED_MANUAL_RESTART', _pena_dl: true,
      }).catch(() => {});

      try { sendResponse({ ok: false, needRestart: true }); } catch (_) {}
    })();

    return true;
  }
});

// ── Периодическая проверка обновлений (каждые 30 мин) ───────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pena_update_check') checkForUpdates();
});

function _initAlarm() {
  chrome.alarms.get('pena_update_check', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('pena_update_check', { periodInMinutes: 30 });
    }
  });
}

chrome.runtime.onStartup.addListener(() => {
  checkForUpdates();
  _initAlarm();
});

chrome.runtime.onInstalled.addListener(() => {
  checkForUpdates();
  _initAlarm();
});

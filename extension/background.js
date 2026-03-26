// PENA Agency — background service worker

const UPDATE_JSON_URL =
  'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';

function isNewer(remote, local) {
  const p = (v) => v.split('.').map(Number);
  const [ra, rb, rc] = p(remote);
  const [la, lb, lc] = p(local);
  if (ra !== la) return ra > la;
  if (rb !== lb) return rb > lb;
  return rc > lc;
}

async function checkForUpdates() {
  try {
    const ctrl = new AbortController();
    const _abort = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch(UPDATE_JSON_URL, { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(_abort);
    if (!resp.ok) return { ok: false, err: 'HTTP ' + resp.status };
    const data = await resp.json();
    const remoteVer = String(data.version || '');
    const localVer  = chrome.runtime.getManifest().version;
    if (!remoteVer || !isNewer(remoteVer, localVer)) {
      chrome.storage.local.set({ anit_update_info: { hasUpdate: false } });
      return { ok: true, hasUpdate: false };
    }
    const url = data.exe_url || data.release_url || '';
    chrome.storage.local.set({
      anit_update_info: { hasUpdate: true, version: remoteVer, url }
    });
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_AVAILABLE', version: remoteVer, url }).catch(() => {});
        }
      }
    });
    chrome.notifications.create('pena_update_available', {
      type:     'basic',
      iconUrl:  'icons/icon128.png',
      title:    'PENA Agency — доступно обновление!',
      message:  `Версия ${remoteVer} готова. Откройте расширение для скачивания.`,
      priority: 1,
    });
    return { ok: true, hasUpdate: true, version: remoteVer, url };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
}

// ── Авто-инжект обновлённого injected.js при загрузке страницы ──────────────
// Срабатывает когда:
//  1. Пользователь нажал «Перезагрузить» после скачивания обновления
//     (флаг pena.reload_ts свежий — ≤ 5 минут)
//  2. Либо Electron-пользователь перезапустил Bitrix24 вручную в течение 5 мин
//
// executeScript(world:'MAIN') обходит CSP страницы — работает везде.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;

  let stored;
  try {
    stored = await chrome.storage.local.get([
      'pena.injected_cache', 'pena.injected_ver', 'pena.reload_ts'
    ]);
  } catch (_) { return; }

  const code     = stored['pena.injected_cache'] || '';
  const ver      = stored['pena.injected_ver']   || '';
  const reloadTs = parseInt(stored['pena.reload_ts'] || '0', 10);

  if (!code || !ver) return;
  // Инжектируем только если был явный запрос перезагрузки (не позднее 5 минут назад)
  if ((Date.now() - reloadTs) > 300_000) return;

  const manifestVer = chrome.runtime.getManifest().version;
  if (!isNewer(ver, manifestVer)) {
    chrome.storage.local.remove('pena.reload_ts');
    return;
  }

  // Снимаем флаг — повторная попытка только при новом явном запросе
  await chrome.storage.local.remove('pena.reload_ts');

  // Ждём, пока встроенный injected.js успеет создать панель
  await new Promise(r => setTimeout(r, 1000));

  const logoUrl = chrome.runtime.getURL('icons/logo.png');
  let ok = false;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (src, logo) => {
        // Проверяем, что мы на нужной странице (панель существует)
        if (!document.getElementById('anit-filters')) return false;
        // Сбрасываем guard
        delete window.__ANITREC_RUNNING__;
        const old = document.getElementById('anit-filters');
        window.__PENA_LOGO_URL_OVERRIDE__ = logo;
        // Метод 1: script.textContent (обходит unsafe-eval, нужен unsafe-inline)
        try {
          const s = document.createElement('script');
          s.textContent = src;
          (document.documentElement || document.head || document.body).appendChild(s);
          s.remove();
        } catch (_) {}
        // Метод 2: (0,eval) — executeScript world:MAIN освобождён от CSP
        if (!window.__ANITREC_RUNNING__) {
          try { (0, eval)(src); } catch (_) {} // eslint-disable-line no-eval
        }
        delete window.__PENA_LOGO_URL_OVERRIDE__;
        const ok = !!window.__ANITREC_RUNNING__;
        if (ok && old && old.parentNode) old.remove();
        return ok;
      },
      args: [code, logoUrl],
    });
    ok = results?.[0]?.result === true;
  } catch (e) {
    console.warn('[PENA/BG] onUpdated inject error:', e);
  }

  if (!ok) {
    // Инжект не удался — сообщаем пользователю (через content.js → injected.js)
    chrome.tabs.sendMessage(tabId, { type: 'PENA_UPDATE_IMPOSSIBLE', version: ver }).catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(checkForUpdates);
chrome.runtime.onInstalled.addListener(checkForUpdates);

// ── Обработчик сообщений от content.js и popup ───────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Скачать обновление через браузер (legacy, не используется для injected.js)
  if (msg?.type === 'DOWNLOAD_UPDATE') {
    const url      = msg.url;
    const filename = msg.filename || 'PENA_Agency_Update.exe';
    const tabId    = sender.tab?.id;
    if (!url || !tabId) { sendResponse({ ok: false }); return; }
    chrome.downloads.download({ url, filename, conflictAction: 'overwrite' }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        chrome.tabs.sendMessage(tabId, { type: 'DL_ERROR', err: String(chrome.runtime.lastError?.message || 'start failed') }).catch(() => {});
        sendResponse({ ok: false }); return;
      }
      sendResponse({ ok: true });
      const poll = setInterval(() => {
        chrome.downloads.search({ id: downloadId }, ([item]) => {
          if (!item) { clearInterval(poll); return; }
          if (item.state === 'in_progress') {
            const total = item.totalBytes > 0 ? item.totalBytes : 0;
            const recv  = item.bytesReceived || 0;
            const pct   = total > 0 ? Math.min(99, Math.round(recv / total * 100)) : -1;
            chrome.tabs.sendMessage(tabId, { type: 'DL_PROGRESS', pct, recv }).catch(() => {});
          } else if (item.state === 'complete') {
            clearInterval(poll);
            chrome.tabs.sendMessage(tabId, { type: 'DL_DONE' }).catch(() => {});
          } else if (item.state === 'interrupted') {
            clearInterval(poll);
            chrome.tabs.sendMessage(tabId, { type: 'DL_ERROR', err: item.error || 'interrupted' }).catch(() => {});
          }
        });
      }, 300);
    });
    return true;
  }

  // Перезагрузить вкладку (Chrome/Yandex/Edge)
  // В Electron-приложении Bitrix24 — пользователь перезапускает вручную,
  // но флаг pena.reload_ts уже выставлен → tabs.onUpdated подхватит при следующем запуске.
  if (msg?.type === 'RELOAD_TAB') {
    const tabId = sender.tab?.id;
    if (tabId) {
      try { chrome.tabs.reload(tabId); } catch (_) {}
    } else {
      // Electron или нестандартный контекст: ищем любую открытую вкладку
      chrome.tabs.query({}, (tabs) => {
        const t = tabs.find(t => t.id && t.url) || tabs[0];
        if (t?.id) try { chrome.tabs.reload(t.id); } catch (_) {}
      });
    }
    return;
  }

  // Реле: PENA_UPDATE_IMPOSSIBLE → injected.js
  // (background.js шлёт напрямую на вкладку; здесь relay для обратной совместимости)
  if (msg?.type === 'PENA_UPDATE_IMPOSSIBLE') {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, msg).catch(() => {});
    }
    return;
  }

  // Применить кеш немедленно (ручной вызов / отладка)
  if (msg?.type === 'EXEC_CACHED_INJECTED') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'no tabId' }); return; }
    const logoUrl = chrome.runtime.getURL('icons/logo.png');
    chrome.storage.local.get(['pena.injected_cache'], async (data) => {
      const code = data['pena.injected_cache'];
      if (!code) { sendResponse({ ok: false, error: 'no cache' }); return; }
      let injected = false;
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (src, logo) => {
            if (!document.getElementById('anit-filters')) return false;
            delete window.__ANITREC_RUNNING__;
            const old = document.getElementById('anit-filters');
            window.__PENA_LOGO_URL_OVERRIDE__ = logo;
            try { const s = document.createElement('script'); s.textContent = src; (document.documentElement || document.head || document.body).appendChild(s); s.remove(); } catch (_) {}
            if (!window.__ANITREC_RUNNING__) { try { (0, eval)(src); } catch (_) {} } // eslint-disable-line no-eval
            delete window.__PENA_LOGO_URL_OVERRIDE__;
            const ok = !!window.__ANITREC_RUNNING__;
            if (ok && old && old.parentNode) old.remove();
            return ok;
          },
          args: [code, logoUrl],
        });
        injected = results?.[0]?.result === true;
        sendResponse({ ok: true, injected });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      if (!injected) {
        chrome.tabs.sendMessage(tabId, { type: 'PENA_UPDATE_IMPOSSIBLE', version: data['pena.injected_ver'] || '?' }).catch(() => {});
      }
    });
    return true;
  }
});

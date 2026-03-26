// PENA Agency — background service worker
// Проверяет наличие обновлений при каждом запуске браузера.

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
    const _abort = setTimeout(() => ctrl.abort(), 12000); // 12 с таймаут на fetch
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

    // Сохраняем в storage — popup.js и content.js читают отсюда
    chrome.storage.local.set({
      anit_update_info: { hasUpdate: true, version: remoteVer, url }
    });

    // Немедленно уведомляем все открытые вкладки Битрикс24
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_AVAILABLE', version: remoteVer, url }).catch(() => {});
        }
      }
    });

    // OS-уведомление
    chrome.notifications.create('pena_update_available', {
      type:     'basic',
      iconUrl:  'icons/icon128.png',
      title:    'PENA Agency — доступно обновление!',
      message:  `Версия ${remoteVer} готова. Откройте расширение для скачивания.`,
      priority: 1,
    });

    return { ok: true, hasUpdate: true, version: remoteVer, url };
  } catch (e) {
    // Нет сети — повторим завтра
    return { ok: false, err: String(e) };
  }
}

// Проверяем при старте и после установки
chrome.runtime.onStartup.addListener(checkForUpdates);
chrome.runtime.onInstalled.addListener(checkForUpdates);

// Обработчик сообщений от content.js и popup
// Проверка обновлений теперь выполняется прямо в content.js (не зависит от жизни SW)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Скачать обновление (вызывается из injected.js через content.js)
  if (msg?.type === 'DOWNLOAD_UPDATE') {
    const url      = msg.url;
    const filename = msg.filename || 'PENA_Agency_Update.exe';
    const tabId    = sender.tab?.id;
    if (!url || !tabId) { sendResponse({ ok: false }); return; }

    chrome.downloads.download({ url, filename, conflictAction: 'overwrite' }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId === undefined) {
        chrome.tabs.sendMessage(tabId, {
          type: 'DL_ERROR',
          err:  String(chrome.runtime.lastError?.message || 'start failed')
        }).catch(() => {});
        sendResponse({ ok: false });
        return;
      }
      sendResponse({ ok: true });

      // Опрос прогресса каждые 300 мс
      const poll = setInterval(() => {
        chrome.downloads.search({ id: downloadId }, ([item]) => {
          if (!item) { clearInterval(poll); return; }
          if (item.state === 'in_progress') {
            // totalBytes может быть -1 если сервер не вернул Content-Length
            // Используем строгую проверку > 0, не || 0 (иначе -1 || 0 = -1)
            const total = item.totalBytes > 0 ? item.totalBytes : 0;
            const recv  = item.bytesReceived || 0;
            const pct   = total > 0 ? Math.min(99, Math.round(recv / total * 100)) : -1;
            chrome.tabs.sendMessage(tabId, { type: 'DL_PROGRESS', pct, recv }).catch(() => {});
          } else if (item.state === 'complete') {
            clearInterval(poll);
            chrome.tabs.sendMessage(tabId, { type: 'DL_DONE' }).catch(() => {});
          } else if (item.state === 'interrupted') {
            clearInterval(poll);
            chrome.tabs.sendMessage(tabId, {
              type: 'DL_ERROR',
              err:  item.error || 'interrupted'
            }).catch(() => {});
          }
        });
      }, 300);
    });
    return true; // async response
  }

  // Перезапустить расширение (подхватит обновлённые файлы)
  if (msg?.type === 'RELOAD_EXTENSION') {
    chrome.runtime.reload();
    return;
  }

  // Применить обновлённый injected.js из chrome.storage напрямую в страницу.
  // chrome.scripting.executeScript(world:'MAIN') обходит CSP — работает везде:
  // Chrome, Yandex Browser, Edge, десктоп-приложение Bitrix24 (Electron).
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
            // Сбрасываем guard — чтобы новый код мог запуститься
            delete window.__ANITREC_RUNNING__;
            const old = document.getElementById('anit-filters');
            // Передаём logoUrl через временный глобал
            window.__PENA_LOGO_URL_OVERRIDE__ = logo;
            // Метод 1: script.textContent (обходит unsafe-eval, требует unsafe-inline)
            try {
              const s = document.createElement('script');
              s.textContent = src;
              (document.documentElement || document.head || document.body).appendChild(s);
              s.remove();
            } catch (_) {}
            // Метод 2: (0,eval) — executeScript world:MAIN сам освобождён от CSP, eval тоже
            if (!window.__ANITREC_RUNNING__) {
              try { (0, eval)(src); } catch (_) {} // eslint-disable-line no-eval
            }
            delete window.__PENA_LOGO_URL_OVERRIDE__;
            const ok = !!window.__ANITREC_RUNNING__;
            // Убираем старую панель только при успехе — новая уже в DOM
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
      // Если инжект не удался — перезагружаем вкладку через Chrome API
      // (надёжнее window.location.reload в Electron/Bitrix24 desktop)
      if (!injected) {
        try { chrome.tabs.reload(tabId); } catch (_) {}
      }
    });
    return true; // async sendResponse
  }
});

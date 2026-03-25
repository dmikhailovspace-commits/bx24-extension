(function () {
  const LOGP = '[PENA/CS]';

  if (self === top && typeof location !== 'undefined' && /\/marketplace\//.test(location.pathname || '')) {
    return;
  }

  // Inject injected.js into page context to bypass CSP
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
    s.dataset.logoUrl = chrome.runtime.getURL('icons/logo.png');
    s.async = false;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.onload = s.onerror = () => {
      setTimeout(() => s.remove(), 0);
      // Мост: chrome.storage.local → injected.js (через postMessage)
      // background.js сохраняет результат проверки в chrome.storage, injected.js читает из localStorage.
      // Пробрасываем данные из хранилища расширения в контекст страницы.
      setTimeout(() => {
        try {
          chrome.storage.local.get('anit_update_info', (result) => {
            if (chrome.runtime.lastError) return;
            const info = result?.anit_update_info;
            if (info?.hasUpdate && info.version && info.url) {
              window.postMessage({ type: 'PENA_UPDATE_AVAILABLE', version: info.version, url: info.url, _pena_dl: true }, '*');
            }
          });
        } catch (_) {}
      }, 1500);
    };
  } catch (e) {
    console.warn(LOGP, 'inject failed', e);
  }

  // Relay: open options page request from injected.js
  function openOptionsPageSafe() {
    try { chrome.runtime.sendMessage({ type: 'ANIT_BXCS_OPEN_OPTIONS' }).catch?.(() => {}); } catch (_) {}
  }

  // Relay: прогресс скачивания из background.js → injected.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && (msg.type === 'DL_PROGRESS' || msg.type === 'DL_DONE' || msg.type === 'DL_ERROR')) {
      window.postMessage({ ...msg, _pena_dl: true }, '*');
    }
    // Фоновая проверка обновлений нашла что-то новое — сообщаем активной вкладке
    if (msg && msg.type === 'UPDATE_AVAILABLE') {
      window.postMessage({ type: 'PENA_UPDATE_AVAILABLE', version: msg.version, url: msg.url, _pena_dl: true }, '*');
    }
    // Результат ручной/авто проверки (ответ на CHECK_UPDATES)
    if (msg && msg.type === 'CHECK_RESULT') {
      window.postMessage({ ...msg, _pena_dl: true }, '*');
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d) return;

    if (d.type === 'ANIT_BXCS_OPEN_OPTIONS') {
      openOptionsPageSafe();
      return;
    }

    // Запрос на проверку обновлений → background.js (fetch вне CSP страницы)
    if (d.type === 'PENA_CHECK_UPDATES') {
      const silent = !!d.silent;
      try {
        chrome.runtime.sendMessage({ type: 'CHECK_UPDATES', silent }).catch(() => {
          window.postMessage({ type: 'CHECK_RESULT', ok: false, silent, _pena_dl: true }, '*');
        });
      } catch (_) {
        window.postMessage({ type: 'CHECK_RESULT', ok: false, silent, _pena_dl: true }, '*');
      }
      return;
    }

    // Скачать обновление через background.js (доступ к chrome.downloads)
    if (d.type === 'PENA_DOWNLOAD_UPDATE') {
      try {
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_UPDATE', url: d.url, filename: d.filename }).catch(() => {});
      } catch (_) {}
      return;
    }

    // Перезапустить расширение
    if (d.type === 'PENA_RELOAD_EXT') {
      try {
        chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION' }).catch(() => {});
      } catch (_) {}
      return;
    }
  });
})();

(function () {
  const LOGP = '[PENA/CS]';
  const _UPD_URL = 'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';
  function _isNewerVer(r, l) {
    const p = v => v.split('.').map(Number);
    const [ra,rb,rc]=p(r),[la,lb,lc]=p(l);
    if(ra!==la)return ra>la;if(rb!==lb)return rb>lb;return rc>lc;
  }

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
    // CHECK_RESULT теперь идёт через storage.onChanged (см. ниже), не через sendMessage
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d) return;

    if (d.type === 'ANIT_BXCS_OPEN_OPTIONS') {
      openOptionsPageSafe();
      return;
    }

    // Проверка обновлений: fetch ПРЯМО в content script
    // Content scripts не ограничены CSP страницы → работает в Chrome, Yandex, Edge, десктоп Bitrix24
    // Не зависит от жизненного цикла Service Worker
    if (d.type === 'PENA_CHECK_UPDATES') {
      const silent = !!d.silent;
      const ctrl = new AbortController();
      const _t = setTimeout(() => ctrl.abort(), 12000);
      fetch(_UPD_URL, { cache: 'no-store', signal: ctrl.signal })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(data => {
          clearTimeout(_t);
          const remoteVer = String(data.version || '');
          let localVer = '';
          try { localVer = chrome.runtime.getManifest().version; } catch (_) {}
          if (!remoteVer || !localVer || !_isNewerVer(remoteVer, localVer)) {
            window.postMessage({ type: 'CHECK_RESULT', ok: true, hasUpdate: false, silent, _pena_dl: true }, '*');
          } else {
            const url = data.exe_url || data.release_url || '';
            window.postMessage({ type: 'CHECK_RESULT', ok: true, hasUpdate: true, version: remoteVer, url, silent, _pena_dl: true }, '*');
          }
        })
        .catch(() => {
          clearTimeout(_t);
          window.postMessage({ type: 'CHECK_RESULT', ok: false, silent, _pena_dl: true }, '*');
        });
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

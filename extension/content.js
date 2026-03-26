(function () {
  const LOGP = '[PENA/CS]';
  const _UPD_URL            = 'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';
  const _INJECTED_CACHE_KEY = 'pena.injected_cache';
  const _INJECTED_VER_KEY   = 'pena.injected_ver';
  const _RELOAD_TS_KEY      = 'pena.reload_ts';

  function _isNewerVer(r, l) {
    const p = v => v.split('.').map(Number);
    const [ra,rb,rc]=p(r),[la,lb,lc]=p(l);
    if(ra!==la)return ra>la;if(rb!==lb)return rb>lb;return rc>lc;
  }

  if (self === top && typeof location !== 'undefined' && /\/marketplace\//.test(location.pathname || '')) {
    return;
  }

  // ── Inject injected.js ──────────────────────────────────────────────────────
  (async function injectMain() {
    const _root = () => document.documentElement || document.head || document.body;
    const _logoUrl = chrome.runtime.getURL('icons/logo.png');

    const injectBundled = () => {
      try {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('injected.js');
        s.dataset.logoUrl = _logoUrl;
        s.async = false;
        s.onload = s.onerror = () => setTimeout(() => s.remove(), 0);
        _root().appendChild(s);
      } catch (e) { console.warn(LOGP, 'inject bundled failed', e); }
    };

    try {
      const stored = await chrome.storage.local.get([
        _INJECTED_CACHE_KEY, _INJECTED_VER_KEY, _RELOAD_TS_KEY
      ]);
      const cachedCode  = stored[_INJECTED_CACHE_KEY] || '';
      const cachedVer   = stored[_INJECTED_VER_KEY]   || '';
      const reloadTs    = parseInt(stored[_RELOAD_TS_KEY] || '0', 10);
      const manifestVer = chrome.runtime.getManifest().version;

      // Если это перезагрузка после запроса обновления — пропускаем blob URL.
      // background.js применит кеш через executeScript (обходит CSP) после загрузки страницы.
      const isUpdateReload = (Date.now() - reloadTs) < 300_000; // 5 минут

      if (!isUpdateReload && cachedCode && cachedVer && _isNewerVer(cachedVer, manifestVer)) {
        // Обычный запуск: пробуем blob URL (быстро, без сети)
        const blob    = new Blob([cachedCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const s = document.createElement('script');
        s.src = blobUrl;
        s.dataset.logoUrl = _logoUrl;
        s.async = false;
        s.onload = () => { URL.revokeObjectURL(blobUrl); setTimeout(() => s.remove(), 0); };
        s.onerror = () => {
          // blob заблокирован CSP — НЕ чистим кеш (background.js попробует через executeScript)
          URL.revokeObjectURL(blobUrl);
          setTimeout(() => s.remove(), 0);
          injectBundled();
        };
        _root().appendChild(s);
        return;
      }
    } catch (_) {}

    injectBundled();

    // Мост: если есть кэшированная инфа об обновлении — сообщаем injected.js
    setTimeout(() => {
      try {
        chrome.storage.local.get('anit_update_info', (result) => {
          if (chrome.runtime.lastError) return;
          const info = result?.anit_update_info;
          if (info?.hasUpdate && info.version && info.injected_js_url) {
            window.postMessage({ type: 'PENA_UPDATE_AVAILABLE', version: info.version, injected_js_url: info.injected_js_url, _pena_dl: true }, '*');
          }
        });
      } catch (_) {}
    }, 1500);
  })();

  // ── Реле: сообщения от background.js → injected.js ─────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    // DL-прогресс (устаревшее, для совместимости)
    if (msg.type === 'DL_PROGRESS' || msg.type === 'DL_DONE' || msg.type === 'DL_ERROR') {
      window.postMessage({ ...msg, _pena_dl: true }, '*');
    }
    // Фоновая проверка обновлений
    if (msg.type === 'UPDATE_AVAILABLE') {
      window.postMessage({ type: 'PENA_UPDATE_AVAILABLE', version: msg.version, injected_js_url: msg.injected_js_url, _pena_dl: true }, '*');
    }
    // Инжект не удался — background.js уведомляет пользователя
    if (msg.type === 'PENA_UPDATE_IMPOSSIBLE') {
      window.postMessage({ type: 'PENA_UPDATE_IMPOSSIBLE', version: msg.version, _pena_dl: true }, '*');
    }
  });

  // ── postMessage bridge: injected.js → content.js ────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d) return;

    if (d.type === 'ANIT_BXCS_OPEN_OPTIONS') {
      try { chrome.runtime.sendMessage({ type: 'ANIT_BXCS_OPEN_OPTIONS' }).catch?.(() => {}); } catch (_) {}
      return;
    }

    // ── Проверка обновлений напрямую из content script (обходит CSP страницы) ──
    if (d.type === 'PENA_CHECK_UPDATES') {
      const silent = !!d.silent;
      const ctrl = new AbortController();
      const _t = setTimeout(() => ctrl.abort(), 12000);
      fetch(_UPD_URL, { cache: 'no-store', signal: ctrl.signal })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(async (data) => {
          clearTimeout(_t);
          const remoteVer = String(data.version || '');
          let localVer = '';
          try { localVer = chrome.runtime.getManifest().version; } catch (_) {}
          try {
            const st = await chrome.storage.local.get(_INJECTED_VER_KEY);
            const cachedVer = st[_INJECTED_VER_KEY] || '';
            if (cachedVer && _isNewerVer(cachedVer, localVer)) localVer = cachedVer;
          } catch (_) {}
          const ts = Date.now();
          if (!remoteVer || !localVer || !_isNewerVer(remoteVer, localVer)) {
            window.postMessage({ type: 'CHECK_RESULT', ok: true, hasUpdate: false, silent, ts, _pena_dl: true }, '*');
          } else {
            const injected_js_url = data.injected_js_url || '';
            window.postMessage({ type: 'CHECK_RESULT', ok: true, hasUpdate: true, version: remoteVer, injected_js_url, silent, ts, _pena_dl: true }, '*');
          }
        })
        .catch(() => {
          clearTimeout(_t);
          window.postMessage({ type: 'CHECK_RESULT', ok: false, silent, ts: Date.now(), _pena_dl: true }, '*');
        });
      return;
    }

    // ── Применить обновление: скачать новый injected.js → chrome.storage.local ─
    if (d.type === 'PENA_APPLY_UPDATE') {
      const jsUrl   = d.injected_js_url;
      const version = String(d.version || '');
      if (!jsUrl) {
        window.postMessage({ type: 'UPDATE_ERROR', reason: 'no_url', _pena_dl: true }, '*');
        return;
      }
      window.postMessage({ type: 'UPDATE_PROGRESS', pct: 0, _pena_dl: true }, '*');

      const ctrl = new AbortController();
      const _t   = setTimeout(() => ctrl.abort(), 30000);

      fetch(jsUrl, { cache: 'no-store', signal: ctrl.signal })
        .then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const contentLength = parseInt(r.headers.get('Content-Length') || '0') || 0;
          if (!r.body || !contentLength) return r.text();
          const reader = r.body.getReader();
          const chunks = []; let received = 0;
          const pump = () => reader.read().then(({ done, value }) => {
            if (done) {
              const total = chunks.reduce((s, c) => s + c.length, 0);
              const buf = new Uint8Array(total); let offset = 0;
              for (const ch of chunks) { buf.set(ch, offset); offset += ch.length; }
              return new TextDecoder().decode(buf);
            }
            chunks.push(value);
            received += value.length;
            window.postMessage({ type: 'UPDATE_PROGRESS', pct: Math.min(95, Math.round(received / contentLength * 100)), _pena_dl: true }, '*');
            return pump();
          });
          return pump();
        })
        .then(text => {
          clearTimeout(_t);
          if (!text || text.length < 500) throw new Error('empty');
          return chrome.storage.local.set({
            [_INJECTED_CACHE_KEY]: text,
            [_INJECTED_VER_KEY]:   version,
          });
        })
        .then(() => {
          // Обновление скачано и сохранено. Показываем кнопку "Перезагрузить".
          // Применение произойдёт при следующей загрузке страницы через background.js.
          window.postMessage({ type: 'UPDATE_DONE', _pena_dl: true }, '*');
        })
        .catch((err) => {
          clearTimeout(_t);
          window.postMessage({ type: 'UPDATE_ERROR', reason: String(err?.message || err), _pena_dl: true }, '*');
        });
      return;
    }

    // ── Перезагрузить приложение / страницу для применения обновления ─────────
    if (d.type === 'PENA_RELOAD_EXT') {
      // Детектируем Electron (Bitrix24 Desktop)
      const _isElectron = /electron/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');

      // Выставляем флаг — background.js увидит его в tabs.onUpdated и применит кеш
      try {
        chrome.storage.local.set({ [_RELOAD_TS_KEY]: Date.now() }, () => {
          if (_isElectron) {
            // Electron: не можем перезагрузить вкладку автоматически
            // Сообщаем пользователю перезапустить вручную
            window.postMessage({ type: 'PENA_NEED_MANUAL_RESTART', _pena_dl: true }, '*');
          } else {
            // Chrome / Yandex / Edge: перезагружаем вкладку через background.js
            try { chrome.runtime.sendMessage({ type: 'RELOAD_TAB' }).catch(() => {}); } catch (_) {}
          }
        });
      } catch (_) {
        try { chrome.runtime.sendMessage({ type: 'RELOAD_TAB' }).catch(() => {}); } catch (_) {}
      }
      return;
    }
  });
})();

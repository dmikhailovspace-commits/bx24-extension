(function () {
  const LOGP = '[PENA/CS]';
  const _UPD_URL            = 'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';
  const _INJECTED_CACHE_KEY = 'pena.injected_cache';
  const _INJECTED_VER_KEY   = 'pena.injected_ver';

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

    // Всегда-рабочий fallback — встроенный injected.js из расширения
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
      const stored = await chrome.storage.local.get([_INJECTED_CACHE_KEY, _INJECTED_VER_KEY]);
      const cachedCode = stored[_INJECTED_CACHE_KEY] || '';
      const cachedVer  = stored[_INJECTED_VER_KEY]   || '';
      const manifestVer = chrome.runtime.getManifest().version;

      if (cachedCode && cachedVer && _isNewerVer(cachedVer, manifestVer)) {
        // Пробуем blob URL (быстро, без сети)
        const blob    = new Blob([cachedCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const s = document.createElement('script');
        s.src = blobUrl;
        s.dataset.logoUrl = _logoUrl;
        s.async = false;
        s.onload = () => { URL.revokeObjectURL(blobUrl); setTimeout(() => s.remove(), 0); };
        // Если blob заблокирован CSP страницы — очищаем битый кеш и падаем на встроенный
        // (без очистки localVer останется = cachedVer → следующая проверка обновлений даст ложное «актуально»)
        s.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          setTimeout(() => s.remove(), 0);
          try { chrome.storage.local.remove([_INJECTED_CACHE_KEY, _INJECTED_VER_KEY]); } catch (_) {}
          injectBundled();
        };
        _root().appendChild(s);
        return; // ждём onload/onerror — не идём в injectBundled сразу
      }
    } catch (_) {}

    injectBundled();

    // Мост: если есть закэшированная инфа об обновлении — сообщаем injected.js
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

  // ── Relay: DL_PROGRESS / DL_DONE / DL_ERROR / UPDATE_AVAILABLE ─────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && (msg.type === 'DL_PROGRESS' || msg.type === 'DL_DONE' || msg.type === 'DL_ERROR')) {
      window.postMessage({ ...msg, _pena_dl: true }, '*');
    }
    if (msg && msg.type === 'UPDATE_AVAILABLE') {
      window.postMessage({ type: 'PENA_UPDATE_AVAILABLE', version: msg.version, injected_js_url: msg.injected_js_url, _pena_dl: true }, '*');
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

    // ── Проверка обновлений: fetch ПРЯМО в content script ────────────────────
    // Content scripts не ограничены CSP страницы → работает в Chrome, Yandex, Edge, десктоп Bitrix24
    if (d.type === 'PENA_CHECK_UPDATES') {
      const silent = !!d.silent;
      const ctrl = new AbortController();
      const _t = setTimeout(() => ctrl.abort(), 12000);
      fetch(_UPD_URL, { cache: 'no-store', signal: ctrl.signal })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(async (data) => {
          clearTimeout(_t);
          const remoteVer = String(data.version || '');
          // Эффективная локальная версия = max(manifest, кэш в storage)
          let localVer = '';
          try { localVer = chrome.runtime.getManifest().version; } catch (_) {}
          try {
            const st = await chrome.storage.local.get(_INJECTED_VER_KEY);
            const cachedVer = st[_INJECTED_VER_KEY] || '';
            if (cachedVer && _isNewerVer(cachedVer, localVer)) localVer = cachedVer;
          } catch (_) {}

          if (!remoteVer || !localVer || !_isNewerVer(remoteVer, localVer)) {
            window.postMessage({ type: 'CHECK_RESULT', ok: true, hasUpdate: false, silent, _pena_dl: true }, '*');
          } else {
            const injected_js_url = data.injected_js_url || '';
            window.postMessage({ type: 'CHECK_RESULT', ok: true, hasUpdate: true, version: remoteVer, injected_js_url, silent, _pena_dl: true }, '*');
          }
        })
        .catch(() => {
          clearTimeout(_t);
          window.postMessage({ type: 'CHECK_RESULT', ok: false, silent, _pena_dl: true }, '*');
        });
      return;
    }

    // ── Применить обновление: скачать новый injected.js → chrome.storage.local ─
    if (d.type === 'PENA_APPLY_UPDATE') {
      const jsUrl  = d.injected_js_url;
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
          // Потоковое чтение с прогрессом
          const contentLength = parseInt(r.headers.get('Content-Length') || '0') || 0;
          if (!r.body || !contentLength) {
            // Нет streaming — просто читаем текст
            return r.text().then(text => text);
          }
          const reader = r.body.getReader();
          const chunks = [];
          let received = 0;
          const pump = () => reader.read().then(({ done, value }) => {
            if (done) {
              const total = chunks.reduce((s, c) => s + c.length, 0);
              const buf   = new Uint8Array(total);
              let offset  = 0;
              for (const ch of chunks) { buf.set(ch, offset); offset += ch.length; }
              return new TextDecoder().decode(buf);
            }
            chunks.push(value);
            received += value.length;
            const pct = Math.min(95, Math.round(received / contentLength * 100));
            window.postMessage({ type: 'UPDATE_PROGRESS', pct, _pena_dl: true }, '*');
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
          window.postMessage({ type: 'UPDATE_DONE', _pena_dl: true }, '*');
          // Говорим текущей панели самоудалиться — она ответит PENA_READY_FOR_REINJECT,
          // после чего мы переинжектируем код прямо из кеша (без background.js / SW).
          window.postMessage({ type: 'PENA_SELF_RESTART', _pena_dl: true }, '*');
        })
        .catch((err) => {
          clearTimeout(_t);
          window.postMessage({ type: 'UPDATE_ERROR', reason: String(err?.message || err), _pena_dl: true }, '*');
        });
      return;
    }

    // ── Переинжект после самоудаления панели ──────────────────────────────────
    // Панель получила PENA_SELF_RESTART, удалила себя и прислала этот сигнал.
    // Загружаем обновлённый код из кеша (blob URL) или fallback — встроенный injected.js.
    // НЕ требует background.js / Service Worker — работает в Electron и в браузере.
    if (d.type === 'PENA_READY_FOR_REINJECT') {
      const _lu = chrome.runtime.getURL('icons/logo.png');
      const _rt = () => document.documentElement || document.head || document.body;
      const _injectBundledNow = () => {
        const s = document.createElement('script');
        s.src = chrome.runtime.getURL('injected.js');
        s.dataset.logoUrl = _lu;
        s.async = false;
        s.onload = s.onerror = () => setTimeout(() => s.remove(), 0);
        _rt().appendChild(s);
      };
      chrome.storage.local.get(_INJECTED_CACHE_KEY, (stored) => {
        const code = stored[_INJECTED_CACHE_KEY];
        if (!code) { _injectBundledNow(); return; }
        // Пробуем blob URL (без сети, быстро)
        const blob    = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const s = document.createElement('script');
        s.src = blobUrl;
        s.dataset.logoUrl = _lu;
        s.async = false;
        s.onload = () => { URL.revokeObjectURL(blobUrl); setTimeout(() => s.remove(), 0); };
        s.onerror = () => {
          // Blob заблокирован CSP — очищаем кеш, fallback на встроенный
          URL.revokeObjectURL(blobUrl);
          setTimeout(() => s.remove(), 0);
          try { chrome.storage.local.remove([_INJECTED_CACHE_KEY, _INJECTED_VER_KEY]); } catch (_) {}
          _injectBundledNow();
        };
        _rt().appendChild(s);
      });
      return;
    }

    // ── Перезапустить расширение ──────────────────────────────────────────────
    if (d.type === 'PENA_RELOAD_EXT') {
      try { chrome.runtime.sendMessage({ type: 'RELOAD_EXTENSION' }).catch(() => {}); } catch (_) {}
      return;
    }
  });
})();

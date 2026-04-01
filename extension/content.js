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
    const _root    = () => document.documentElement || document.head || document.body;
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
      const stored      = await chrome.storage.local.get([_INJECTED_CACHE_KEY, _INJECTED_VER_KEY]);
      const cachedCode  = stored[_INJECTED_CACHE_KEY] || '';
      const cachedVer   = stored[_INJECTED_VER_KEY]   || '';
      const manifestVer = chrome.runtime.getManifest().version;

      if (cachedCode && cachedVer && _isNewerVer(cachedVer, manifestVer)) {
        // Пробуем blob URL (быстро, без сети).
        // Если CSP страницы заблокирует — инжектируем bundled, а background.js
        // применит кеш через executeScript(world:MAIN) после сигнала PENA_PANEL_BUILT.
        const blob    = new Blob([cachedCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const s = document.createElement('script');
        s.src = blobUrl;
        s.dataset.logoUrl = _logoUrl;
        s.async = false;
        s.onload  = () => { URL.revokeObjectURL(blobUrl); setTimeout(() => s.remove(), 0); };
        s.onerror = () => { URL.revokeObjectURL(blobUrl); setTimeout(() => s.remove(), 0); injectBundled(); };
        _root().appendChild(s);
        return;
      }
    } catch (_) {}

    injectBundled();

    // Мост: если в chrome.storage есть свежая инфа об обновлении — показываем баннер
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
    // Relay: background.js → injected.js (через postMessage в MAIN world)
    const RELAY_TYPES = [
      'DL_PROGRESS', 'DL_DONE', 'DL_ERROR',
      'PENA_NEED_MANUAL_RESTART',
      'PENA_UPDATE_IMPOSSIBLE',
    ];
    if (RELAY_TYPES.includes(msg.type)) {
      window.postMessage({ ...msg, _pena_dl: true }, '*');
    }
    if (msg.type === 'UPDATE_AVAILABLE') {
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

    // Панель построена → relay в background для авто-инжекта обновления
    if (d.type === 'PENA_PANEL_BUILT') {
      try { chrome.runtime.sendMessage({ type: 'PENA_PANEL_BUILT' }).catch(() => {}); } catch (_) {}
      return;
    }

    // ── Проверка обновлений (обходит CSP страницы) ──────────────────────────
    if (d.type === 'PENA_CHECK_UPDATES') {
      const silent = !!d.silent;
      const ctrl = new AbortController();
      const _t = setTimeout(() => ctrl.abort(), 12000);
      fetch(_UPD_URL, { cache: 'no-store', signal: ctrl.signal })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((data) => {
          clearTimeout(_t);
          const remoteVer = String(data.version || '');
          // Сравниваем только с манифестом — кеш не считается «установленной» версией
          let localVer = '';
          try { localVer = chrome.runtime.getManifest().version; } catch (_) {}
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

    // ── Скачать новый injected.js и сохранить в chrome.storage.local ────────
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
          // Обновление скачано. Показываем кнопку «Перезагрузить» — пользователь решает когда применить.
          window.postMessage({ type: 'UPDATE_DONE', _pena_dl: true }, '*');
        })
        .catch((err) => {
          clearTimeout(_t);
          window.postMessage({ type: 'UPDATE_ERROR', reason: String(err?.message || err), _pena_dl: true }, '*');
        });
      return;
    }

    // ── Закрыть всё приложение Bitrix24 (многоуровнево) ─────────────────────────
    if (d.type === 'PENA_CLOSE_APP') {
      // Relay в background.js — закрывает все вкладки и окна через chrome API
      try { chrome.runtime.sendMessage({ type: 'PENA_CLOSE_APP' }).catch(() => {}); } catch (_) {}
      // Дополнительно: закрываем текущее окно напрямую из content-script
      setTimeout(() => { try { window.close(); } catch (_) {} }, 300);
      return;
    }

    // ── Применить обновление (нажата кнопка «Перезапустить») ────────────────
    // Пробуем in-place inject через eval (быстро, без reload).
    // Если CSP блокирует eval — background.js отправляет PENA_NEED_MANUAL_RESTART,
    // пользователь перезапускает Bitrix24 через ярлык, updater.ps1 обновит файлы.
    // НЕ делаем location.reload() — это бесполезно (файлы на диске не изменились).
    if (d.type === 'PENA_RELOAD_EXT') {
      chrome.storage.local.set({ 'pena.update_pending': true }, () => {
        try {
          chrome.runtime.sendMessage({ type: 'EXEC_CACHED_INJECTED' })
            .then(result => {
              if (result?.ok) {
                chrome.storage.local.remove('pena.update_pending');
              }
              // Если !ok → background уже отправил PENA_NEED_MANUAL_RESTART
            })
            .catch(() => {});
        } catch (_) {}
      });
      return;
    }
  });
})();

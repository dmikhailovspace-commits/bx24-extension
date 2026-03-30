// PENA Agency — background service worker

const UPDATE_JSON_URL =
  'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';

// Базовый URL для скачивания файлов расширения с GitHub
const _EXT_RAW_BASE =
  'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/extension';

// Файлы, которые обновляет скрипт обновления
const _UPDATE_FILES = ['injected.js', 'background.js', 'content.js', 'manifest.json'];

function isNewer(remote, local) {
  const p = v => v.split('.').map(Number);
  const [ra, rb, rc] = p(remote), [la, lb, lc] = p(local);
  if (ra !== la) return ra > la;
  if (rb !== lb) return rb > lb;
  return rc > lc;
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
      chrome.storage.local.set({
        anit_update_info: {
          hasUpdate: true,
          version: remoteVer,
          injected_js_url: data.injected_js_url || '',
        }
      });
    } else {
      chrome.storage.local.set({ anit_update_info: { hasUpdate: false } });
    }
  } catch (_) {}
}

// ── Скрипт обновления файлов на диске ────────────────────────────────────────
// Генерирует bat (Windows) или .command (macOS) скрипт, который:
//   1. Скачивает файлы расширения из GitHub прямо в папку установки
//   2. Убивает Bitrix24 и перезапускает его
// Скрипт запускается через chrome.downloads.open() — пользователь видит
// стандартный запрос ОС «Запустить?» и нажимает одну кнопку.

function _generateUpdaterScript(platform) {
  // Делегируем уже установленному updater-скрипту — он содержит всю логику:
  // проверка версии, скачивание файлов с GitHub, перезапуск Bitrix24.
  if (platform === 'win') {
    return [
      '@echo off',
      'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Normal' +
        ' -File "%LOCALAPPDATA%\\PENA Agency\\Extension\\updater.ps1"',
      'del "%~f0"',
    ].join('\r\n') + '\r\n';
  } else {
    return [
      '#!/bin/bash',
      '"$HOME/Library/Application Support/PENA Agency/Extension/pena_updater.sh"',
      'rm -f "$0"',
    ].join('\n') + '\n';
  }
}

// Скачать скрипт обновления через chrome.downloads и сразу открыть его.
// ВАЖНО: не ждём onChanged — MV3 Service Worker убивается во время ожидания,
// из-за чего sendResponse никогда не отправляется и content.js уходит в reload.
// Файл маленький (<300 байт) — скачивается мгновенно; open/show через 1.5 сек.
async function _downloadUpdater(tabId, platform) {
  const isWin = platform === 'win';
  const script = _generateUpdaterScript(platform);
  const filename = isWin ? 'pena_update.bat' : 'pena_update.command';
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(script);

  return new Promise((resolve) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId == null) { resolve(false); return; }

      // Отвечаем сразу — не ждём завершения загрузки.
      // Через 1.5 сек пробуем открыть файл (к этому моменту он уже скачан).
      setTimeout(() => {
        try { chrome.downloads.open(downloadId); } catch (_) {}
        chrome.downloads.show(downloadId);
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: 'PENA_UPDATER_DOWNLOADED', _pena_dl: true })
            .catch(() => {});
        }
      }, 1500);

      resolve(true);
    });
  });
}

// ── Инжект кешированного injected.js в MAIN мир страницы ─────────────────────
// executeScript(world:'MAIN') обходит CSP страницы — единственный надёжный путь.
// Старая панель удаляется ТОЛЬКО если новый код успешно запустился (ok=true).
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
        // Захватываем ссылку на старую панель ДО запуска нового кода.
        // Удаляем её ТОЛЬКО если новый код успешно инициализировался —
        // иначе старая панель остаётся и может отобразить сообщение об ошибке.
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

  // Панель построена (injected.js → content.js → сюда).
  // Если пользователь одобрил обновление — применяем кеш немедленно.
  if (msg?.type === 'PENA_PANEL_BUILT') {
    const tabId = sender.tab?.id;
    if (!tabId) return;
    chrome.storage.local.get('pena.update_pending', async (s) => {
      if (!s['pena.update_pending']) return;
      const result = await _injectCached(tabId);
      // В любом случае сбрасываем флаг — повторный авто-инжект не нужен
      chrome.storage.local.remove('pena.update_pending');
      if (!result.ok && result.reason !== 'not_newer') {
        // Инжект не удался — панель останется жить (мы не удаляем её),
        // показываем сообщение «обновление невозможно»
        chrome.tabs.sendMessage(tabId, {
          type: 'PENA_UPDATE_IMPOSSIBLE', version: result.ver || '?',
        }).catch(() => {});
      }
    });
    return;
  }

  // Применить кеш + если не выходит — скачать скрипт обновления на диск.
  // Вызывается когда пользователь нажал «Перезапустить».
  if (msg?.type === 'EXEC_CACHED_INJECTED') {
    const tabId   = sender.tab?.id;
    const platform = msg.platform || 'win'; // 'win' | 'mac'
    if (!tabId) { sendResponse({ ok: false, reason: 'no_tabId' }); return; }

    (async () => {
      const result = await _injectCached(tabId);

      if (result.ok) {
        // ✓ In-place inject сработал (eval не заблокирован CSP)
        chrome.storage.local.remove('pena.update_pending');
        try { sendResponse({ ok: true }); } catch (_) {}
        return;
      }

      // In-place inject не вышел → скачиваем скрипт обновления файлов на диске
      // Оповещаем панель: «скачиваем скрипт...»
      chrome.tabs.sendMessage(tabId, { type: 'PENA_UPDATER_DOWNLOADING', _pena_dl: true })
        .catch(() => {});

      const updaterOk = await _downloadUpdater(tabId, platform);

      try { sendResponse({ ok: false, updater: updaterOk }); } catch (_) {}

      if (!updaterOk) {
        // Скрипт не скачался — последний вариант: обычный reload
        chrome.tabs.sendMessage(tabId, {
          type: 'PENA_UPDATE_IMPOSSIBLE', version: result.ver || '?',
        }).catch(() => {});
      }
    })();

    return true; // async sendResponse
  }

  // Relay: PENA_UPDATE_IMPOSSIBLE от background → injected.js
  if (msg?.type === 'PENA_UPDATE_IMPOSSIBLE') {
    const tabId = sender.tab?.id;
    if (tabId) chrome.tabs.sendMessage(tabId, msg).catch(() => {});
    return;
  }
});

chrome.runtime.onStartup.addListener(checkForUpdates);
chrome.runtime.onInstalled.addListener(checkForUpdates);

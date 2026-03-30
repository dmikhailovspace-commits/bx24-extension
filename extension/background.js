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
  if (platform === 'win') {
    const lines = [
      '@echo off',
      'setlocal',
      'set EXT=%LOCALAPPDATA%\\PENA Agency\\Extension',
      'echo [PENA] Downloading extension files...',
    ];
    for (const f of _UPDATE_FILES) {
      lines.push(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest '${_EXT_RAW_BASE}/${f}' -OutFile '%EXT%\\${f}' -UseBasicParsing"`
      );
    }
    lines.push(
      'echo [PENA] Restarting Bitrix24...',
      'taskkill /F /IM Bitrix24.exe 2>nul',
      'timeout /t 3 /nobreak >nul',
      // Читаем сохранённый путь к Bitrix24 (установщик записывает его в bitrix_path.txt)
      'set BITRIX_EXE=',
      'if exist "%LOCALAPPDATA%\\PENA Agency\\bitrix_path.txt" (',
      '  set /p BITRIX_EXE=<"%LOCALAPPDATA%\\PENA Agency\\bitrix_path.txt"',
      ')',
      'if defined BITRIX_EXE if exist "%BITRIX_EXE%" (',
      '  start "" "%BITRIX_EXE%" --disable-extensions-except="%EXT%" --load-extension="%EXT%"',
      '  goto :done',
      ')',
      // Fallback: перебираем типичные пути установки Bitrix24
      'for %%p in (',
      '  "%LOCALAPPDATA%\\Programs\\Bitrix24\\Bitrix24.exe"',
      '  "%APPDATA%\\Bitrix24\\Bitrix24.exe"',
      '  "%ProgramFiles%\\Bitrix24\\Bitrix24.exe"',
      '  "%ProgramFiles(x86)%\\Bitrix24\\Bitrix24.exe"',
      ') do (',
      '  if exist "%%~p" (',
      '    start "" "%%~p" --disable-extensions-except="%EXT%" --load-extension="%EXT%"',
      '    goto :done',
      '  )',
      ')',
      'echo [PENA] Bitrix24.exe not found - please restart manually.',
      'pause',
      ':done',
      'del "%~f0"',
    );
    return lines.join('\r\n') + '\r\n';
  } else {
    // macOS .command (Terminal double-click)
    const lines = [
      '#!/bin/bash',
      'EXT="$HOME/Library/Application Support/PENA Agency/Extension"',
      'echo "[PENA] Downloading extension files..."',
    ];
    for (const f of _UPDATE_FILES) {
      lines.push(`curl -fsSL "${_EXT_RAW_BASE}/${f}" -o "$EXT/${f}"`);
    }
    lines.push(
      'echo "[PENA] Restarting Bitrix24..."',
      'pkill -f "Bitrix24" 2>/dev/null || true',
      'sleep 2',
      // Перебираем пути установки Bitrix24 на macOS
      'for p in "$HOME/Applications/Bitrix24.app" "/Applications/Bitrix24.app"; do',
      '  [ -d "$p" ] && open "$p" && break',
      'done',
      'rm -f "$0"',
    );
    return lines.join('\n') + '\n';
  }
}

// Скачать скрипт обновления через chrome.downloads и сразу открыть его
async function _downloadUpdater(tabId, platform) {
  const isWin = platform === 'win';
  const script = _generateUpdaterScript(platform);
  const filename = isWin ? 'pena_update.bat' : 'pena_update.command';
  // data:-URL: chrome.downloads принимает его; зональный идентификатор
  // (Mark of the Web) НЕ выставляется, поэтому SmartScreen не блокирует.
  const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(script);

  return new Promise((resolve) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError || downloadId == null) { resolve(false); return; }

      const _notify = () => {
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { type: 'PENA_UPDATER_DOWNLOADED', _pena_dl: true })
            .catch(() => {});
        }
      };

      const onChanged = (delta) => {
        if (delta.id !== downloadId) return;

        if (delta.state?.current === 'complete') {
          chrome.downloads.onChanged.removeListener(onChanged);
          // Пробуем открыть через ОС (Windows спросит «Запустить?» → Run)
          try { chrome.downloads.open(downloadId); } catch (_) {}
          // Параллельно показываем файл в проводнике — если авто-открытие не сработало
          chrome.downloads.show(downloadId);
          _notify();
          resolve(true);

        } else if (delta.danger?.current &&
                   delta.danger.current !== 'safe' &&
                   delta.danger.current !== 'accepted') {
          // Chrome пометил .bat как опасный — открыть не получится автоматически.
          // Показываем файл в проводнике, пользователь запустит вручную (ПКМ → Запустить).
          chrome.downloads.onChanged.removeListener(onChanged);
          chrome.downloads.show(downloadId);
          _notify();
          resolve(true);

        } else if (delta.error?.current) {
          chrome.downloads.onChanged.removeListener(onChanged);
          resolve(false);
        }
      };
      chrome.downloads.onChanged.addListener(onChanged);
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

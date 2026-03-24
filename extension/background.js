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
    const resp = await fetch(UPDATE_JSON_URL, { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    const remoteVer = String(data.version || '');
    const localVer  = chrome.runtime.getManifest().version;
    if (!remoteVer || !isNewer(remoteVer, localVer)) {
      chrome.storage.local.set({ anit_update_info: { hasUpdate: false } });
      return;
    }

    const url = data.exe_url || data.release_url || '';

    // Сохраняем в storage — popup.js читает отсюда
    chrome.storage.local.set({
      anit_update_info: { hasUpdate: true, version: remoteVer, url }
    });

    // OS-уведомление
    chrome.notifications.create('pena_update_available', {
      type:     'basic',
      iconUrl:  'icons/icon128.png',
      title:    'PENA Agency — доступно обновление!',
      message:  `Версия ${remoteVer} готова. Откройте расширение для скачивания.`,
      priority: 1,
    });
  } catch (_) {
    // Нет сети — повторим завтра
  }
}

// Проверяем при старте и после установки
chrome.runtime.onStartup.addListener(checkForUpdates);
chrome.runtime.onInstalled.addListener(checkForUpdates);

// Ручная проверка из popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'CHECK_UPDATES') {
    checkForUpdates().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});

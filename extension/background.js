// PENA Agency — background service worker
// Проверяет наличие обновлений при каждом запуске браузера.
// Фактическое скачивание выполняет pena_updater.ps1 / pena_updater.sh
// (установлен как задача Планировщика / LaunchAgent).

const UPDATE_JSON_URL =
  'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';

// Сравнивает версии вида "5.0.0". Возвращает true если remote > local.
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
    if (!remoteVer || !isNewer(remoteVer, localVer)) return;

    // Есть обновление — показываем уведомление
    chrome.notifications.create('pena_update_available', {
      type:     'basic',
      iconUrl:  'icons/icon128.png',
      title:    'PENA Agency — доступно обновление!',
      message:  `Версия ${remoteVer} готова к установке. Запустите установщик PENA Agency для обновления.`,
      priority: 1,
    });
  } catch (_) {
    // Нет сети или ошибка — не критично, повторим завтра через Task Scheduler
  }
}

// Проверяем при старте и раз в сутки
chrome.runtime.onStartup.addListener(checkForUpdates);
chrome.runtime.onInstalled.addListener(checkForUpdates);

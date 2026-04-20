// PENA Agency — background service worker
// Автообновление удалено. Обновление выполняется установщиком (updater.ps1 / install_macos.sh).

chrome.runtime.onInstalled.addListener(() => {
  // Удаляем мусорные ключи от прежнего механизма автообновления
  chrome.storage.local.remove([
    'pena.injected_cache',
    'pena.injected_ver',
    'anit_update_info',
    'pena.update_pending',
    'pena.update.info',
  ]);
});

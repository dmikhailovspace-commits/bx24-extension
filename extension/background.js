// PENA Agency — background service worker

chrome.runtime.onInstalled.addListener(() => {
  // Удаляем устаревшие ключи chrome.storage.local от старого механизма автообновления
  chrome.storage.local.remove([
    'pena.injected_cache',
    'pena.injected_ver',
    'anit_update_info',
    'pena.update_pending',
    'pena.update.info',
  ]);
});

(function () {
  const STORAGE_KEY = 'anit_update_info';

  chrome.storage.local.get([STORAGE_KEY], (res) => {
    const info = res[STORAGE_KEY];
    const updateBlock  = document.getElementById('updateBlock');
    const updateText   = document.getElementById('updateText');
    const updateLink   = document.getElementById('updateLink');
    const currentBlock = document.getElementById('currentBlock');
    const currentText  = document.getElementById('currentText');

    const manifest   = chrome.runtime.getManifest();
    const currentVer = (manifest && manifest.version) || '';

    if (info && info.hasUpdate && info.url) {
      updateBlock.style.display = 'block';
      updateText.textContent = 'Вышла новая версия ' + (info.tag || info.version || '') + '.';
      updateLink.href = info.url;
      currentBlock.style.display = 'none';
    } else {
      updateBlock.style.display = 'none';
      currentText.textContent = 'Версия ' + currentVer + ' — актуальна';
    }
  });
})();

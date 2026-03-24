(function () {
  'use strict';
  const UPDATE_JSON_URL =
    'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';

  const manifest   = chrome.runtime.getManifest();
  const currentVer = manifest.version || '';

  const $       = id => document.getElementById(id);
  const ALL_IDS = ['st-idle', 'st-checking', 'st-ok', 'st-update', 'st-dl', 'st-done', 'st-err'];
  const hideAll = () => ALL_IDS.forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
  const show    = id => { const el = $(id); if (el) el.style.display = ''; };

  const verLabel = $('verLabel');
  if (verLabel) verLabel.textContent = 'v' + currentVer;

  function isNewer(remote, local) {
    const p = v => v.split('.').map(Number);
    const [ra, rb, rc] = p(remote);
    const [la, lb, lc] = p(local);
    if (ra !== la) return ra > la;
    if (rb !== lb) return rb > lb;
    return rc > lc;
  }

  let _updateData = null;

  async function checkNow() {
    _updateData = null;
    hideAll();
    show('st-checking');
    try {
      const resp = await fetch(UPDATE_JSON_URL, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const remoteVer = String(data.version || '');
      hideAll();
      if (remoteVer && isNewer(remoteVer, currentVer)) {
        _updateData = data;
        const uvEl = $('updateVerText');
        if (uvEl) uvEl.textContent = `Версия ${remoteVer} (текущая: ${currentVer})`;
        chrome.storage.local.set({
          anit_update_info: { hasUpdate: true, version: remoteVer, url: data.exe_url || data.release_url || '' }
        });
        show('st-update');
      } else {
        chrome.storage.local.set({ anit_update_info: { hasUpdate: false } });
        show('st-ok');
      }
    } catch (_e) {
      hideAll();
      const el = $('st-err');
      if (el) { el.textContent = 'Нет соединения — проверьте позже'; el.style.display = ''; }
    }
  }

  async function startInstall() {
    if (!_updateData) return;
    const url     = _updateData.exe_url || _updateData.release_url || '';
    const version = _updateData.version || '';
    const filename = `PENA_Agency_Setup_v${version}.exe`;

    hideAll();
    show('st-dl');
    const dlPct = $('dlPct');
    const dlBar = $('dlBar');
    const dlTxt = $('dlText');
    if (dlPct) dlPct.textContent = '';
    if (dlBar) dlBar.style.width = '0%';
    if (dlTxt) dlTxt.textContent = 'Загружаю установщик...';

    let downloadId;
    try {
      downloadId = await new Promise((resolve, reject) => {
        chrome.downloads.download(
          { url, filename, conflictAction: 'overwrite', saveAs: false },
          id => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (!id) reject(new Error('download id is null'));
            else resolve(id);
          }
        );
      });
    } catch (e) {
      hideAll();
      const el = $('st-err');
      if (el) { el.textContent = 'Не удалось запустить загрузку: ' + e.message; el.style.display = ''; }
      return;
    }

    // Опрос прогресса
    const poll = setInterval(() => {
      chrome.downloads.search({ id: downloadId }, items => {
        const dl = items && items[0];
        if (!dl) { clearInterval(poll); return; }

        if (dl.totalBytes > 0) {
          const pct = Math.round(dl.bytesReceived / dl.totalBytes * 100);
          if (dlPct) dlPct.textContent = pct + '%';
          if (dlBar) dlBar.style.width = pct + '%';
        }

        if (dl.state === 'complete') {
          clearInterval(poll);
          if (dlBar) dlBar.style.width = '100%';
          chrome.storage.local.set({ anit_update_info: { hasUpdate: false } });
          hideAll();
          show('st-done');
        } else if (dl.state === 'interrupted') {
          clearInterval(poll);
          hideAll();
          const el = $('st-err');
          if (el) { el.textContent = 'Загрузка прервана. Попробуйте ещё раз.'; el.style.display = ''; }
        }
      });
    }, 300);
  }

  const checkBtn   = $('checkBtn');
  const installBtn = $('installBtn');
  const reCheckBtn = $('reCheckBtn');

  if (checkBtn)   checkBtn.addEventListener('click', checkNow);
  if (installBtn) installBtn.addEventListener('click', startInstall);
  if (reCheckBtn) reCheckBtn.addEventListener('click', checkNow);

  // Автопроверка при открытии popup
  checkNow();
})();

(function () {
  'use strict';
  const UPDATE_JSON_URL =
    'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';

  const manifest   = chrome.runtime.getManifest();
  const currentVer = manifest.version || '';

  const $       = id => document.getElementById(id);
  const ALL_IDS = ['st-idle', 'st-checking', 'st-ok', 'st-update', 'st-err'];
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

  async function checkNow() {
    hideAll();
    show('st-checking');
    try {
      const resp = await fetch(UPDATE_JSON_URL, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const remoteVer = String(data.version || '');
      hideAll();
      if (remoteVer && isNewer(remoteVer, currentVer)) {
        // Записываем корректное поле injected_js_url (не url!)
        // чтобы content.js мог показать баннер обновления на странице.
        chrome.storage.local.set({
          anit_update_info: {
            hasUpdate: true,
            version: remoteVer,
            injected_js_url: data.injected_js_url || '',
          }
        });
        const uvEl = $('updateVerText');
        if (uvEl) uvEl.textContent = `Версия ${remoteVer} (текущая: ${currentVer})`;
        show('st-update');
      } else {
        // Не перезаписываем hasUpdate:false если background.js уже записал обновление —
        // но раз мы сами только что проверили и версии равны, это актуально.
        chrome.storage.local.set({ anit_update_info: { hasUpdate: false } });
        show('st-ok');
      }
    } catch (_e) {
      hideAll();
      const el = $('st-err');
      if (el) { el.textContent = 'Нет соединения — проверьте позже'; el.style.display = ''; }
    }
  }

  const checkBtn   = $('checkBtn');
  const reCheckBtn = $('reCheckBtn');

  if (checkBtn)   checkBtn.addEventListener('click', checkNow);
  if (reCheckBtn) reCheckBtn.addEventListener('click', checkNow);

  // Автопроверка при открытии popup
  checkNow();
})();

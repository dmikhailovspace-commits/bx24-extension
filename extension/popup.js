(function () {
  const UPDATE_JSON_URL =
    'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';

  const manifest   = chrome.runtime.getManifest();
  const currentVer = manifest.version || '';

  const versionEl   = document.getElementById('version');
  const statusEl    = document.getElementById('status');
  const updateBlock = document.getElementById('updateBlock');
  const updateVerEl = document.getElementById('updateVer');
  const updateLink  = document.getElementById('updateLink');
  const checkBtn    = document.getElementById('checkBtn');

  if (versionEl) versionEl.textContent = 'v' + currentVer;

  function isNewer(remote, local) {
    const p = v => v.split('.').map(Number);
    const [ra, rb, rc] = p(remote);
    const [la, lb, lc] = p(local);
    if (ra !== la) return ra > la;
    if (rb !== lb) return rb > lb;
    return rc > lc;
  }

  function showUpdateAvailable(ver, url) {
    updateBlock.style.display = 'block';
    if (updateVerEl) updateVerEl.textContent = ver ? 'v' + ver : '';
    if (updateLink)  updateLink.href = url || '#';
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'status'; }
  }

  function showUpToDate() {
    updateBlock.style.display = 'none';
    if (statusEl) { statusEl.textContent = 'Версия актуальна'; statusEl.className = 'status ok'; }
  }

  function showError() {
    updateBlock.style.display = 'none';
    if (statusEl) { statusEl.textContent = 'Нет сети — проверьте позже'; statusEl.className = 'status err'; }
  }

  async function checkNow() {
    if (statusEl) { statusEl.textContent = 'Проверяю...'; statusEl.className = 'status'; }
    if (checkBtn) checkBtn.disabled = true;
    updateBlock.style.display = 'none';
    try {
      const resp = await fetch(UPDATE_JSON_URL, { cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const remoteVer = String(data.version || '');
      if (remoteVer && isNewer(remoteVer, currentVer)) {
        const url = data.exe_url || data.release_url || '#';
        chrome.storage.local.set({ anit_update_info: { hasUpdate: true, version: remoteVer, url } });
        showUpdateAvailable(remoteVer, url);
      } else {
        chrome.storage.local.set({ anit_update_info: { hasUpdate: false } });
        showUpToDate();
      }
    } catch (_) {
      // Нет сети — показываем кэш из storage
      chrome.storage.local.get(['anit_update_info'], (res) => {
        const info = res['anit_update_info'];
        if (info && info.hasUpdate && info.url) {
          showUpdateAvailable(info.version, info.url);
        } else {
          showError();
        }
      });
    } finally {
      if (checkBtn) checkBtn.disabled = false;
    }
  }

  if (checkBtn) checkBtn.addEventListener('click', checkNow);

  // Автопроверка при открытии popup
  checkNow();
})();

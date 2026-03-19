(function () {
  const LOGP = '[PENA/CS]';

  if (self === top && typeof location !== 'undefined' && /\/marketplace\//.test(location.pathname || '')) {
    return;
  }

  // Inject injected.js into page context to bypass CSP
  try {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
    s.dataset.logoUrl = chrome.runtime.getURL('icons/logo.png');
    s.async = false;
    (document.documentElement || document.head || document.body).appendChild(s);
    s.onload = s.onerror = () => setTimeout(() => s.remove(), 0);
  } catch (e) {
    console.warn(LOGP, 'inject failed', e);
  }

  // Relay: open options page request from injected.js
  function openOptionsPageSafe() {
    try { chrome.runtime.sendMessage({ type: 'ANIT_BXCS_OPEN_OPTIONS' }).catch?.(() => {}); } catch (_) {}
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.type !== 'ANIT_BXCS_OPEN_OPTIONS') return;
    openOptionsPageSafe();
  });
})();

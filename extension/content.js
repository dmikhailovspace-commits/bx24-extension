(function () {
  if (self === top && typeof location !== 'undefined' && /\/marketplace\//.test(location.pathname || '')) {
    return;
  }

  const _root    = () => document.documentElement || document.head || document.body;
  const _logoUrl = chrome.runtime.getURL('icons/logo.png');

  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.dataset.logoUrl = _logoUrl;
  s.async = false;
  s.onload = s.onerror = () => setTimeout(() => s.remove(), 0);
  _root().appendChild(s);
})();

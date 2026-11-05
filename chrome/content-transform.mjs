// Pure build-time transformation: no desktop file is modified.
export function transformChromeContent(source) {
  if (typeof source !== 'string') throw new TypeError('Content source must be a string');
  let result = source.replace(/\r\n/g, '\n');
  const replaceOnce = (pattern, replacement, label) => {
    const matches = [...result.matchAll(new RegExp(pattern.source, 'g'))];
    if (matches.length !== 1) throw new Error(`Chrome content transform: ${label} expected once, found ${matches.length}`);
    result = result.replace(pattern, replacement);
  };
  const updaterStart = result.indexOf('  // Consent lives in the isolated world');
  const updaterEnd = result.indexOf('  const _enabledKey', updaterStart);
  if (updaterStart < 0 || updaterEnd < 0 || result.indexOf('  // Consent lives in the isolated world', updaterStart + 1) >= 0) {
    throw new Error('Chrome content transform: desktop updater anchors changed');
  }
  result = result.slice(0, updaterStart) + `  // Chrome Web Store releases are updated by Chrome, not the desktop helper.
  (() => {
    let host;
    const mount = () => {
      const slot = document.querySelector('.pena-native-update-slot');
      if (!slot) return;
      if (!host) {
        host = document.createElement('span');
        host.style.cssText = 'display:inline-flex;position:relative;flex:0 0 auto';
        const root = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = ':host{all:initial;display:inline-flex}*{box-sizing:border-box}button{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:2px;border:0;border-radius:6px;background:transparent;color:#526071;cursor:pointer}button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}p{position:relative;width:100%;margin:0;padding:12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:#263241;box-shadow:0 8px 28px #0f172a30;font:12px/1.5 system-ui}p[hidden]{display:none}';
        const button = document.createElement('button');
        button.type = 'button';
        button.title = 'Обновление';
        button.setAttribute('aria-label', 'Обновление');
        button.setAttribute('aria-expanded', 'false');
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.7-2.6L20 9M4 15l2.2 2.6A7 7 0 0 0 17.9 15"/></svg>';
        const panel = document.createElement('p');
        panel.hidden = true;
        panel.setAttribute('role', 'status');
        panel.textContent = 'Версия ' + _releaseVersion + '. Обновления из Chrome Web Store устанавливаются браузером автоматически. При ручной установке ZIP обновляйте расширение вручную.';
        const popup = document.createElement('div');
        popup.className = 'pena-chrome-update-popup';
        popup.style.cssText = 'position:fixed;z-index:2147483647;margin:0;padding:0;border:0;background:transparent;max-width:calc(100vw - 16px)';
        if (popup.showPopover) popup.setAttribute('popover', 'manual');
        const popupRoot = popup.attachShadow({ mode: 'open' });
        popupRoot.append(style.cloneNode(true), panel);
        const close = () => { panel.hidden = true; if(popup.hidePopover && popup.matches(':popover-open')) popup.hidePopover(); popup.remove(); button.setAttribute('aria-expanded', 'false'); };
        const place = () => {
          if (panel.hidden) return;
          if (!host.isConnected || !host.getClientRects().length) { close(); return; }
          const rect = button.getBoundingClientRect(), width = Math.min(280, innerWidth - 16);
          popup.style.width = width + 'px';
          popup.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.right - width)) + 'px';
          const height = popup.getBoundingClientRect().height;
          popup.style.top = Math.max(8, Math.min(innerHeight - height - 8, rect.bottom + 6)) + 'px';
        };
        button.addEventListener('click', event => {
          if (!event.isTrusted) return;
          if (!panel.hidden) { close(); return; }
          document.body.append(popup); panel.hidden = false; popup.showPopover?.(); place();
          button.setAttribute('aria-expanded', 'true');
        });
        document.addEventListener('pointerdown', event => { if (!event.composedPath().includes(host) && !event.composedPath().includes(popup)) close(); }, true);
        document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }, true);
        window.addEventListener('resize', place);
        document.addEventListener('scroll', place, true);
        root.append(style, button);
      }
      if (host.parentElement !== slot) slot.append(host);
    };
    document.addEventListener('pena-update-slot-ready', mount);
  })();
` + result.slice(updaterEnd);
  replaceOnce(/  const inject = \(path, configure\) => new Promise\(\(resolve, reject\) => \{[\s\S]*?\n  const verifyRelease = async \(\) => \{/, `  const injectChromeRuntime = () => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ channel: 'pena.chrome.portal.v1', action: 'inject' }, response => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) reject(new Error(error?.message || response?.error || 'Chrome runtime injection failed'));
      else resolve(response);
    });
  });

  const verifyRelease = async () => {`, 'DOM injection block');
  replaceOnce(/      await injectStylesheet\(\);\n      await inject\('native-catalog\.js'\);\n      await inject\('native-interaction-state\.js'\);\n\s*await inject\('native-time-control\.js'\);\n      await inject\('native-lifecycle\.js'\);\n      await inject\('dialog-repository\.js'\);\n      await inject\('injected\.js', script => \{ script\.dataset\.logoUrl = _logoUrl; \}\);/, '      await injectChromeRuntime();', 'ordered runtime launch');
  if (/script\.src\s*=|link\.href\s*=/.test(result)) throw new Error('Chrome content transform retained DOM resource injection');
  return result;
}

export default transformChromeContent;

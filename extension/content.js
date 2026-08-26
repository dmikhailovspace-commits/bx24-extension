(function () {
  if (self === top && typeof location !== 'undefined' && /\/marketplace\//.test(location.pathname || '')) {
    return;
  }

  const _root    = () => document.documentElement || document.head || document.body;
  const _logoUrl = chrome.runtime.getURL('icons/logo.png');
  const _releaseVersion = chrome.runtime.getManifest().version;
  const _enabledKey = 'pena.extension.enabled';
  const _repositoryChannel = 'pena.dialog.repository.v1';
  const _repositoryRequestEvent = 'pena-dialog-repository-request';
  const _repositoryResponseEvent = 'pena-dialog-repository-response';
  let _rootPromise = null;
  let _pendingEnabled = true;
  const _waitForRoot = () => {
    const existing = _root();
    if (existing) return Promise.resolve(existing);
    if (_rootPromise) return _rootPromise;
    _rootPromise = new Promise(resolve => {
      let observer = null;
      const finish = () => {
        const root = _root();
        if (!root) return;
        observer?.disconnect();
        document.removeEventListener('readystatechange', finish);
        document.removeEventListener('DOMContentLoaded', finish);
        resolve(root);
      };
      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(finish);
        observer.observe(document, { childList: true, subtree: true });
      }
      document.addEventListener('readystatechange', finish);
      document.addEventListener('DOMContentLoaded', finish);
    });
    return _rootPromise;
  };
  const _setPageEnabled = async enabled => {
    _pendingEnabled = !!enabled;
    const root = await _waitForRoot();
    root.dataset.penaExtensionEnabled = _pendingEnabled ? '1' : '0';
  };

  const _publishRepositoryResponse = response => {
    document.dispatchEvent(new CustomEvent(_repositoryResponseEvent, {
      detail: JSON.stringify(response)
    }));
  };

  document.addEventListener(_repositoryRequestEvent, event => {
    let request = null;
    try { request = JSON.parse(String(event.detail || '')); } catch {}
    if (!request?.requestId || !request?.command) return;
	const scopeHost = String(request.scope?.portalHost || '').trim().toLowerCase();
	const pageHost = String(location.hostname || '').trim().toLowerCase();
	if (!scopeHost || scopeHost !== pageHost) {
	  _publishRepositoryResponse({
		requestId: request.requestId,
		ok: false,
		error: 'Catalog scope does not match page origin'
	  });
	  return;
	}
    chrome.runtime.sendMessage({
      channel: _repositoryChannel,
      command: request.command,
      scope: request.scope,
      payload: request.payload || {}
    }, response => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        _publishRepositoryResponse({
          requestId: request.requestId,
          ok: false,
          error: runtimeError.message || 'Extension service worker is unavailable'
        });
        return;
      }
      _publishRepositoryResponse({
        requestId: request.requestId,
        ok: response?.ok === true,
        result: response?.result,
        error: response?.error || ''
      });
    });
  });

  _waitForRoot().then(root => {
    root.dataset.penaDialogRepositoryBridge = '1';
  });

  document.addEventListener('pena-extension-enabled-request', event => {
    const requested = document.documentElement?.dataset?.penaExtensionEnabled;
    const explicit = typeof event.detail?.enabled === 'boolean' ? event.detail.enabled : null;
    const enabled = explicit ?? (requested !== '0');
    chrome.storage.local.set({ [_enabledKey]: enabled ? '1' : '0' }, () => {
      _setPageEnabled(enabled).then(() => {
        document.dispatchEvent(new CustomEvent('pena-extension-enabled-applied', { detail: { enabled } }));
      });
    });
  });

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local' || !changes[_enabledKey]) return;
    const enabled = changes[_enabledKey].newValue !== '0';
    await _setPageEnabled(enabled);
    if (window === window.top) location.reload();
  });

  const inject = (path, configure) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${chrome.runtime.getURL(path)}?release=${encodeURIComponent(_releaseVersion)}`;
    script.async = false;
    script.dataset.releaseVersion = _releaseVersion;
    configure?.(script);
    script.onload = () => {
      setTimeout(() => script.remove(), 0);
      resolve();
    };
    script.onerror = () => {
      setTimeout(() => script.remove(), 0);
      reject(new Error(`Failed to load runtime dependency: ${path}`));
    };
    const root = _root();
    if (!root) {
      reject(new Error(`Document root is unavailable for: ${path}`));
      return;
    }
    root.appendChild(script);
  });

  const verifyRelease = async () => {
    const response = await fetch(
      `${chrome.runtime.getURL('manifest.json')}?release=${encodeURIComponent(_releaseVersion)}`,
      { cache: 'no-store' }
    );
    if (!response.ok) {
      throw new Error(`Failed to verify extension release: HTTP ${response.status}`);
    }
    const diskManifest = await response.json();
    if (diskManifest.version !== _releaseVersion) {
      throw new Error(`Mixed extension release: loaded ${_releaseVersion}, disk ${diskManifest.version || 'unknown'}`);
    }
  };

  const launch = async () => {
    try {
      await verifyRelease();
      await inject('native-catalog.js');
      await inject('native-interaction-state.js');
	  await inject('native-time-control.js');
      await inject('native-lifecycle.js');
      await inject('dialog-repository.js');
      await inject('injected.js', script => { script.dataset.logoUrl = _logoUrl; });
    } catch (error) {
      console.error('[PENA] Runtime injection aborted:', error);
    }
  };

  chrome.storage.local.get([_enabledKey], async values => {
    const enabled = values?.[_enabledKey] !== '0';
    await _setPageEnabled(enabled);
    await launch();
  });
})();

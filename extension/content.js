(function () {
  const _pageHref = typeof location !== 'undefined' ? String(location.href || '') : '';
  const _pagePath = typeof location !== 'undefined' ? String(location.pathname || '') : '';
  const _pageSearch = typeof location !== 'undefined' ? String(location.search || '') : '';
  const _isChildFrame = self !== top;
  const _isSupportedOlFrame = _isChildFrame &&
    /\/desktop_app(?:\/|$)/i.test(_pagePath || _pageHref) &&
    /(?:^|[?&])IM_LINES=Y(?:&|$)/i.test(_pageSearch || _pageHref.replace(/^[^?]*/, ''));

  // Bitrix opens task cards, CRM sliders and other auxiliary documents in
  // child frames. Loading the 1.4 MB Messenger runtime in every such frame
  // delays the native SidePanel and duplicates observers/listeners. The only
  // supported child realm is the legacy Open Lines desktop frame.
  if (_isChildFrame && !_isSupportedOlFrame) return;

  if (self === top && typeof location !== 'undefined' && /\/marketplace\//.test(location.pathname || '')) {
    return;
  }

  const _root    = () => document.documentElement || document.head || document.body;
  const _logoUrl = chrome.runtime.getURL('icons/logo.png');
  const _releaseVersion = chrome.runtime.getManifest().version;
  const _enabledKey = 'pena.extension.enabled';
  const _repositoryChannel = 'pena.dialog.repository.v2';
	const _workerHealthChannel = 'pena.runtime.worker-health.v1';
	const _expectedWorkerEntry = 'worker-v7_5_90.js';
	const _expectedWorkerBuild = '7.5.90';
	const _expectedWorkerProtocol = 'dialog-repository-v2';
  const _repositoryRequestEvent = 'pena-dialog-repository-request';
  const _repositoryResponseEvent = 'pena-dialog-repository-response';
  const _repositoryChangedEvent = 'pena-dialog-repository-changed';
  const _repositoryConnectionEvent = 'pena-dialog-repository-connection';
  const _repositoryManifestPattern = /^pena\.dialog\.catalog\.v1\.([^~]+)~([^.]*)\.manifest$/;
  const _messengerListSelector = '.bx-im-list-container-recent__elements,.bx-im-list-container-task__elements,.bx-messenger-recent-wrap.bx-messenger-recent-lines-wrap';
  const _runtimeStyleMarker = `pena-runtime-style-${_releaseVersion}`;
  let _rootPromise = null;
  let _supportedSurfacePromise = null;
  let _pendingEnabled = true;

  const _isExplicitTopMessengerLocation = () => !_isChildFrame && (
    /\/(?:online|desktop_app)(?:\/|$)/i.test(String(location.pathname || '')) ||
    /\/(?:online|desktop_app)(?:[/?#]|$)/i.test(String(location.href || ''))
  );
  const _hasMessengerSurface = node => {
    if (!node) return false;
    try {
      if (node.nodeType === 1 && node.matches?.(_messengerListSelector)) return true;
      return !!node.querySelector?.(_messengerListSelector);
    } catch { return false; }
  };
  const _waitForSupportedSurface = () => {
    if (_isSupportedOlFrame || _isExplicitTopMessengerLocation() || _hasMessengerSurface(document)) {
      return Promise.resolve(true);
    }
    if (_supportedSurfacePromise) return _supportedSurfacePromise;
    _supportedSurfacePromise = new Promise(resolve => {
      let observer = null;
      const finish = () => {
        observer?.disconnect();
        document.removeEventListener('readystatechange', probe);
        window.removeEventListener?.('popstate', probe, true);
        window.removeEventListener?.('hashchange', probe, true);
        resolve(true);
      };
      const probe = records => {
        if (_isExplicitTopMessengerLocation() || _hasMessengerSurface(document)) return finish();
        if (!Array.isArray(records)) return;
        for (const record of records) {
          for (const node of record?.addedNodes || []) {
            if (_hasMessengerSurface(node)) return finish();
          }
        }
      };
      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(probe);
        observer.observe(document, { childList: true, subtree: true });
      }
      document.addEventListener('readystatechange', probe);
      window.addEventListener?.('popstate', probe, true);
      window.addEventListener?.('hashchange', probe, true);
      probe();
    });
    return _supportedSurfacePromise;
  };
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

  const _publishRepositoryConnection = connected => {
    document.dispatchEvent(new CustomEvent(_repositoryConnectionEvent, {
      detail: JSON.stringify({ connected: connected === true, at: Date.now() })
    }));
  };

	const _pingRepositoryWorker = () => new Promise(resolve => {
		if (typeof chrome.runtime?.sendMessage !== 'function') return resolve(null);
		let settled = false;
		const finish = value => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(value || null);
		};
		const timer = setTimeout(() => finish(null), 1500);
		try {
			chrome.runtime.sendMessage({ channel: _workerHealthChannel }, response => {
				if (chrome.runtime.lastError) return finish(null);
				finish(response);
			});
		} catch { finish(null); }
	});

	const _ensureRepositoryWorker = async () => {
		if (self !== top) return { healthy: true, skipped: true };
		const response = await _pingRepositoryWorker();
		const healthy = response?.ok === true && response.version === _releaseVersion &&
			response.entry === _expectedWorkerEntry && response.build === _expectedWorkerBuild &&
			response.protocol === _expectedWorkerProtocol && Number(response.repositorySchema) === 2;
		_publishRepositoryConnection(healthy);
		return { healthy, response };
	};

  const _publishRepositoryChange = (key, change) => {
    const match = String(key || '').match(_repositoryManifestPattern);
    if (!match || !change?.newValue) return;
    let portalHost = '';
    let userId = '';
    try {
      portalHost = decodeURIComponent(match[1]).toLowerCase();
      userId = decodeURIComponent(match[2]);
    } catch { return; }
    if (!portalHost || portalHost !== String(location.hostname || '').toLowerCase()) return;
    document.dispatchEvent(new CustomEvent(_repositoryChangedEvent, {
      detail: JSON.stringify({
        scope: { portalHost, userId },
        revision: Math.max(0, Number(change.newValue.revision) || 0),
        operationId: String(change.newValue.operationId || ''),
        savedAt: Math.max(0, Number(change.newValue.savedAt) || 0)
      })
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
        _publishRepositoryConnection(false);
        _publishRepositoryResponse({
          requestId: request.requestId,
          ok: false,
          error: runtimeError.message || 'Extension service worker is unavailable',
          code: 'repository_unavailable',
          retryable: true,
          details: {}
        });
        return;
      }
      if (!response || typeof response.ok !== 'boolean') {
        _publishRepositoryConnection(false);
        _publishRepositoryResponse({
          requestId: request.requestId,
          ok: false,
          error: 'Extension service worker returned no response',
          code: 'repository_unavailable',
          retryable: true,
          details: {}
        });
        return;
      }
      _publishRepositoryConnection(true);
      _publishRepositoryResponse({
        requestId: request.requestId,
        ok: response?.ok === true,
        result: response?.result,
        error: response?.error || '',
        code: response?.code || '',
        retryable: response?.retryable === true,
        details: response?.details || {}
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
    if (areaName !== 'local') return;
    Object.entries(changes || {}).forEach(([key, change]) => _publishRepositoryChange(key, change));
    if (changes[_enabledKey]) {
      const enabled = changes[_enabledKey].newValue !== '0';
      await _setPageEnabled(enabled);
      if (window === window.top) location.reload();
    }
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

  const injectStylesheet = async () => {
    const root = await _waitForRoot();
    const existing = document.querySelector?.(`link[data-pena-runtime-style="${_runtimeStyleMarker}"]`);
    if (existing) return;
    const link = document.createElement('link');
    // The small VM harnesses used by repository/enable-state tests intentionally
    // expose script-only nodes. Real DOM links always have tagName/rel.
    if (!link || (!('rel' in link) && !link.tagName)) return;
    link.rel = 'stylesheet';
    link.href = `${chrome.runtime.getURL('injected.css')}?release=${encodeURIComponent(_releaseVersion)}`;
    link.dataset.penaRuntimeStyle = _runtimeStyleMarker;
    await new Promise((resolve, reject) => {
      link.onload = () => resolve();
      link.onerror = () => reject(new Error('Failed to load runtime stylesheet: injected.css'));
      root.appendChild(link);
    });
  };

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
		// Repository health is diagnostic only. A cold or recovering MV3 worker must
		// never hold the visible Bitrix runtime for the 1.5 s health timeout; the
		// repository bridge already retries unavailable requests independently.
		void _ensureRepositoryWorker();
      await verifyRelease();
      await injectStylesheet();
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
    await _waitForSupportedSurface();
    await launch();
  });
})();

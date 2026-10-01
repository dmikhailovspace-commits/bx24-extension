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
  const _runtimeManifest = chrome.runtime.getManifest();
  const _releaseVersion = _runtimeManifest.version;
  // Consent lives in the isolated world and a closed shadow root. Page events
  // may request mounting, but can never request installation or forge a click.
  (() => {
    let host, root, button, panel, info, pending = false, checkedAt = 0, checking = null, installTimer;
    const send = (action, fields = {}) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Помощник не ответил. Повторите.')), 30000);
      try { chrome.runtime.sendMessage({channel:'pena.update.v1',action,...fields}, response => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response?.ok) reject(new Error(response?.error || 'Не удалось проверить обновление.'));
        else resolve(response.result);
      }); } catch (error) {clearTimeout(timer);reject(error);}
    });
    const close = () => {if (!panel) return; if (typeof panel.hidePopover==='function' && panel.matches(':popover-open')) panel.hidePopover(); panel.hidden=true;button?.setAttribute('aria-expanded','false');};
    const position = () => {
      if (!panel || panel.hidden || typeof panel.showPopover !== 'function') return;
      const rect=button.getBoundingClientRect();
      panel.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-panel.offsetWidth-8))}px`;
      panel.style.top=`${Math.max(8,Math.min(rect.bottom+8,innerHeight-panel.offsetHeight-8))}px`;
    };
    const render = () => { if (button) {button.hidden=!info?.available;button.textContent=pending?'Обновляем…':'Доступно обновление';} };
    const check = () => {
      if (!host?.isConnected || document.visibilityState==='hidden' || navigator.onLine===false || checking || Date.now()-checkedAt<60000) return;
      checkedAt=Date.now();
      checking=send('check').then(value=>{info=value;render();}).catch(()=>{}).finally(()=>{checking=null;});
    };
    const open = async event => {
      if (!event.isTrusted) return;
      close();panel.replaceChildren();panel.hidden=false;button.setAttribute('aria-expanded','true');
      const title=document.createElement('strong');title.textContent=`Обновление ${info.version}`;
      const text=document.createElement('p');text.setAttribute('role','status');text.textContent='Проверяем способ установки…';
      const actions=document.createElement('div');actions.className='actions';
      const later=document.createElement('button');later.textContent='Позже';later.addEventListener('click',()=>{close();button.focus();});
      actions.append(later);panel.append(title,text,actions);
      if (typeof panel.showPopover==='function') panel.showPopover();
      position();later.focus();
      const approved=info.version;
      let mode;
      try {mode=await send('prepare');} catch {mode={native:false,desktop:info.desktop};}
      if (panel.hidden || info.version!==approved) return;
      if (pending) {text.textContent='Загружаем обновление. Bitrix24 перезапустится после проверки файлов.';position();return;}
      if (mode.native) {
        text.textContent='Bitrix24 перезапустится. Сохраните незавершённую работу.';
        const apply=document.createElement('button');apply.className='primary';apply.textContent='Обновить и перезапустить';
        apply.addEventListener('click',async click=>{
          if (!click.isTrusted || pending || apply.disabled) return;
          apply.disabled=true;pending=true;render();text.textContent='Проверяем и загружаем обновление…';
          const fail=message=>{clearTimeout(installTimer);pending=false;apply.disabled=false;text.textContent=message;render();position();};
          try {
            await send('apply',{version:approved});
            const started=Date.now();
            const poll=async()=>{
              try {
                const result=await send('status');
                if (result.state?.version===approved && result.state?.status==='error') return fail('Обновление не установлено. Текущая версия сохранена. Повторите.');
                if (result.state?.version===approved && result.state?.status==='done') {pending=false;render();text.textContent='Обновление установлено. Перезапустите Bitrix24, если окно осталось открытым.';return;}
                if (Date.now()-started>600000) return fail('Установка ещё не подтверждена. Проверьте подключение и повторите.');
              } catch {if (Date.now()-started>600000) return fail('Не удалось подтвердить установку. Перезапустите Bitrix24 и проверьте версию.');}
              installTimer=setTimeout(poll,5000);
            };
            installTimer=setTimeout(poll,5000);
          } catch(error) {fail(error.message);checkedAt=0;check();}
        });
        actions.prepend(apply);
      } else {
        text.textContent=mode.desktop?'Для этой установки нужен новый установщик. Скачайте его и запустите.':'Скачайте ZIP, распакуйте и обновите расширение на странице chrome://extensions.';
        const downloadLink=document.createElement('a');downloadLink.className='primary';downloadLink.textContent=mode.desktop?'Скачать установщик':'Скачать ZIP';
        const base=`https://github.com/dmikhailovspace-commits/bx24-extension/releases/`;
        downloadLink.href=mode.desktop?`${base}tag/v${approved}`:`${base}download/v${approved}/BX24_Chat_Sorter_Chrome_v${approved}.zip`;
        downloadLink.target='_blank';downloadLink.rel='noopener noreferrer';actions.prepend(downloadLink);
      }
      position();
    };
    const mount = () => {
      const slot=document.querySelector('.pena-native-update-slot');if (!slot) return;
      if (!host) {
        host=document.createElement('span');host.style.cssText='display:inline-flex;position:relative;flex:0 0 auto';
        root=host.attachShadow({mode:'closed'});
        const style=document.createElement('style');style.textContent=`:host{all:initial;display:inline-flex}*{box-sizing:border-box}[hidden]{display:none!important}button,a{font:600 11px/1.3 system-ui;cursor:pointer;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 7px;text-decoration:none}button:disabled{opacity:.65;cursor:wait}button:focus-visible,a:focus-visible{outline:2px solid #2563eb;outline-offset:2px}.badge{height:26px;white-space:nowrap}.panel{position:fixed;inset:auto;margin:0;width:min(330px,calc(100vw - 16px));padding:14px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#263241;box-shadow:0 8px 28px #0f172a30;font:13px/1.4 system-ui;z-index:2147483647}.panel strong{font-size:14px}.panel p{margin:10px 0 14px}.actions{display:flex;flex-wrap:wrap;gap:8px}.primary{background:#2563eb;border-color:#2563eb;color:#fff}`;
        button=document.createElement('button');button.type='button';button.className='badge';button.hidden=true;button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.addEventListener('click',open);
        panel=document.createElement('div');panel.className='panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Обновление расширения');
        if (typeof panel.showPopover==='function') panel.setAttribute('popover','manual');else panel.style.cssText='position:absolute;left:0;top:32px';
        root.append(style,button,panel);
        document.addEventListener('pointerdown',event=>{if (!event.composedPath().includes(host)) close();},true);
        document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();button.focus();}},true);
        window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
        window.addEventListener('online',()=>{checkedAt=0;check();});
        document.addEventListener('visibilitychange',check);
        setInterval(check,60000);
      }
      if (host.parentElement!==slot) {close();slot.append(host);}
      render();check();
    };
    document.addEventListener('pena-update-slot-ready',mount);
  })();
  const _enabledKey = 'pena.extension.enabled';
  const _repositoryChannel = 'pena.dialog.repository.v2';
	const _workerHealthChannel = 'pena.runtime.worker-health.v1';
	const _expectedWorkerEntry = _runtimeManifest.background?.service_worker || '';
	const _expectedWorkerBuild = _releaseVersion;
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
        if (_isExplicitTopMessengerLocation()) return finish();
        // Mutation batches describe the changed subtrees. Searching the entire
        // task/CRM document for every batch delays unrelated Bitrix navigation.
        // Full scans belong only to readiness/route checkpoints.
        if (!Array.isArray(records)) {
          if (_hasMessengerSurface(document)) finish();
          return;
        }
        const seen = new Set();
        for (const record of records) {
          if (record.target?.matches?.(_messengerListSelector)) return finish();
          for (const node of record?.addedNodes || []) {
            if (node.nodeType !== 1 || seen.has(node)) continue;
            seen.add(node);
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

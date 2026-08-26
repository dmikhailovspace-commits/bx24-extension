(function installPenaDialogRepositoryBridge(global) {
  if (global.__PENA_DIALOG_REPOSITORY__) return;

  const REQUEST_EVENT = 'pena-dialog-repository-request';
  const RESPONSE_EVENT = 'pena-dialog-repository-response';
  const pending = new Map();
  let sequence = 0;

  document.addEventListener(RESPONSE_EVENT, event => {
    let response = null;
    try { response = JSON.parse(String(event.detail || '')); } catch {}
    const request = response?.requestId ? pending.get(response.requestId) : null;
    if (!request) return;
    pending.delete(response.requestId);
    clearTimeout(request.timer);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(response.error || 'Dialog repository request failed'));
  });

  function request(command, scope, payload = {}, timeoutMs = 20000) {
    const requestId = `pena-repository-${Date.now().toString(36)}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Dialog repository timeout: ${command}`));
      }, Math.max(1000, Number(timeoutMs) || 20000));
      pending.set(requestId, { resolve, reject, timer });
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: JSON.stringify({ requestId, command, scope, payload })
      }));
    });
  }

  global.__PENA_DIALOG_REPOSITORY__ = Object.freeze({
    get: scope => request('catalog.get', scope),
    commit: (scope, records, meta) => request('catalog.commit', scope, { records, meta }, 60000),
    patch: (scope, records, deletedIds, meta) => request('catalog.patch', scope, { records, deletedIds, meta }, 60000),
    acquire: (scope, ownerToken, ttlMs = 30000) => request('sync.acquire', scope, { ownerToken, ttlMs })
  });
})(window);

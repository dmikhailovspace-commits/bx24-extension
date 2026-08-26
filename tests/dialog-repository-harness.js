(function installDialogRepositoryHarness() {
  const REQUEST_EVENT = 'pena-dialog-repository-request';
  const RESPONSE_EVENT = 'pena-dialog-repository-response';
  const snapshots = new Map();
  const leases = new Map();

  document.documentElement.dataset.userId = document.documentElement.dataset.userId || '101';
  document.documentElement.dataset.penaDialogRepositoryBridge = '1';

  const scopeKey = scope => `${String(scope?.portalHost || '').toLowerCase()}::${String(scope?.userId || '')}`;
  const respond = (requestId, result, error = '') => {
    queueMicrotask(() => document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({ requestId, ok: !error, result, error })
    })));
  };

  document.addEventListener(REQUEST_EVENT, event => {
    let request = null;
    try { request = JSON.parse(String(event.detail || '')); } catch {}
    if (!request?.requestId) return;

    const key = scopeKey(request.scope);
    const previous = snapshots.get(key) || { records: [], manifest: null, recovered: false };
    const payload = request.payload || {};
    const now = Date.now();

    if (request.command === 'catalog.get') {
      respond(request.requestId, structuredClone(previous));
      return;
    }

    if (request.command === 'catalog.commit') {
      const records = Array.isArray(payload.records) ? structuredClone(payload.records) : [];
      const manifest = {
        schema: 1,
        generation: `test-${now}`,
        count: records.length,
        chunkCount: Math.ceil(records.length / 250),
        savedAt: now,
        lastSuccessAt: Number(payload.meta?.lastSuccessAt) || now,
        lastFullAt: Number(payload.meta?.lastFullAt) || now,
        cursorAt: Number(payload.meta?.cursorAt) || now,
        windowCount: Number(payload.meta?.windowCount) || records.length,
        truncated: payload.meta?.truncated === true,
        patches: []
      };
      snapshots.set(key, { records, manifest, recovered: false });
      respond(request.requestId, { manifest, count: records.length });
      return;
    }

    if (request.command === 'catalog.patch') {
      const byId = new Map(previous.records.map(record => [String(record.id), structuredClone(record)]));
      (payload.deletedIds || []).forEach(id => byId.delete(String(id)));
      (payload.records || []).forEach(record => byId.set(String(record.id), structuredClone(record)));
      const records = Array.from(byId.values());
      const manifest = {
        ...(previous.manifest || {}),
        schema: 1,
        generation: previous.manifest?.generation || `test-${now}`,
        count: records.length,
        savedAt: now,
        lastSuccessAt: Number(payload.meta?.lastSuccessAt) || previous.manifest?.lastSuccessAt || now,
        cursorAt: Number(payload.meta?.cursorAt) || previous.manifest?.cursorAt || now
      };
      snapshots.set(key, { records, manifest, recovered: false });
      respond(request.requestId, { manifest, count: records.length, patched: payload.records?.length || 0 });
      return;
    }

    if (request.command === 'sync.acquire') {
      const ownerToken = String(payload.ownerToken || '');
      const current = leases.get(key);
      const acquired = !current || current.expiresAt <= now || current.ownerToken === ownerToken;
      if (acquired) leases.set(key, { ownerToken, expiresAt: now + Math.max(1000, Number(payload.ttlMs) || 30000) });
      const active = leases.get(key);
      respond(request.requestId, {
        acquired,
        expiresAt: active?.expiresAt || now,
        retryAfterMs: acquired ? 0 : Math.max(0, active.expiresAt - now)
      });
      return;
    }

    respond(request.requestId, null, `Unsupported repository command: ${request.command}`);
  });

  window.__dialogRepositoryHarness = { snapshots, leases };
})();

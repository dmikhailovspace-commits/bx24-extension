(function installDialogRepositoryHarness() {
  const REQUEST_EVENT = 'pena-dialog-repository-request';
  const RESPONSE_EVENT = 'pena-dialog-repository-response';
  const snapshots = new Map();
  const leases = new Map();

  document.documentElement.dataset.userId = document.documentElement.dataset.userId || '101';
  document.documentElement.dataset.penaDialogRepositoryBridge = '1';

  const scopeKey = scope => `${String(scope?.portalHost || '').toLowerCase()}::${String(scope?.userId || '')}`;
  const normalizeIds = ids => Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').trim().toLowerCase()).filter(Boolean)));
  const sameIds = (left, right) => left.length === right.length && right.every(id => new Set(left).has(id));
  const respond = (requestId, result, error = '', code = '', retryable = false, details = {}) => {
    queueMicrotask(() => document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({ requestId, ok: !error, result, error, code, retryable, details })
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
      const revision = Math.max(0, Number(previous.manifest?.revision) || 0);
      if (payload.operationId && payload.operationId === previous.manifest?.operationId) {
        respond(request.requestId, { manifest: structuredClone(previous.manifest), count: previous.records.length, duplicate: true });
        return;
      }
      if (Number(payload.baseRevision) !== revision) {
        respond(request.requestId, null, 'Dialog catalog revision conflict', 'revision_conflict', true, { currentRevision: revision });
        return;
      }
      const intended = Array.isArray(payload.records) ? structuredClone(payload.records) : [];
      const byId = new Map(previous.records.map(record => [String(record.id).toLowerCase(), structuredClone(record)]));
      const deletedIds = normalizeIds(payload.deletedIds);
      if (payload.confirmedReplace === true) {
        const baseIds = normalizeIds(payload.baseIds);
        const intendedIds = new Set(normalizeIds(intended.map(record => record.id)));
        const expectedDeleted = baseIds.filter(id => !intendedIds.has(id));
        if (!sameIds(expectedDeleted, deletedIds)) {
          respond(request.requestId, null, 'Confirmed catalog tombstones do not match the base snapshot', 'invalid_tombstones');
          return;
        }
        if (Number(payload.snapshotRevision) === revision && !sameIds(baseIds, normalizeIds(previous.records.map(record => record.id)))) {
          respond(request.requestId, null, 'Confirmed catalog base snapshot does not match baseRevision', 'base_snapshot_mismatch', true);
          return;
        }
        deletedIds.forEach(id => byId.delete(id));
      } else if (deletedIds.length) {
        respond(request.requestId, null, 'Unconfirmed catalog commit cannot delete records', 'unconfirmed_tombstones');
        return;
      }
      intended.forEach(record => byId.set(String(record.id).toLowerCase(), structuredClone(record)));
      const records = Array.from(byId.values());
      const manifest = {
        schema: 2,
        revision: revision + 1,
        baseRevision: revision,
        operationId: String(payload.operationId || ''),
        leaseFence: Math.max(0, Number(payload.leaseFence) || Number(previous.manifest?.leaseFence) || 0),
        generation: `test-${now}`,
        count: records.length,
        chunkCount: Math.ceil(records.length / 250),
        savedAt: now,
        lastSuccessAt: Number(payload.meta?.lastSuccessAt) || now,
        lastFullAt: Number(payload.meta?.lastFullAt) || now,
        cursorAt: Number(payload.meta?.cursorAt) || now,
        windowCount: Number(payload.meta?.windowCount) || records.length,
        truncated: payload.meta?.truncated === true,
        catalogVersion: Math.max(0, Number(payload.meta?.catalogVersion) || 0),
        catalogModes: structuredClone(payload.meta?.catalogModes || {}),
        taskCatalog: structuredClone(payload.meta?.taskCatalog || {}),
        patches: []
      };
      snapshots.set(key, { records, manifest, recovered: false });
      respond(request.requestId, {
        manifest,
        count: records.length,
        deleted: payload.confirmedReplace === true ? deletedIds.length : 0,
        confirmedReplace: payload.confirmedReplace === true,
        operationRevision: manifest.revision
      });
      return;
    }

    if (request.command === 'catalog.patch') {
      const revision = Math.max(0, Number(previous.manifest?.revision) || 0);
      if (payload.operationId && payload.operationId === previous.manifest?.operationId) {
        respond(request.requestId, { manifest: structuredClone(previous.manifest), count: previous.records.length, duplicate: true });
        return;
      }
      if (Number(payload.baseRevision) !== revision) {
        respond(request.requestId, null, 'Dialog catalog revision conflict', 'revision_conflict', true, { currentRevision: revision });
        return;
      }
      const byId = new Map(previous.records.map(record => [String(record.id), structuredClone(record)]));
      (payload.deletedIds || []).forEach(id => byId.delete(String(id)));
      (payload.records || []).forEach(record => byId.set(String(record.id), structuredClone(record)));
      const records = Array.from(byId.values());
      const manifest = {
        ...(previous.manifest || {}),
        schema: 2,
        revision: revision + 1,
        baseRevision: revision,
        operationId: String(payload.operationId || ''),
        leaseFence: Math.max(0, Number(payload.leaseFence) || Number(previous.manifest?.leaseFence) || 0),
        generation: previous.manifest?.generation || `test-${now}`,
        count: records.length,
        savedAt: now,
        lastSuccessAt: Number(payload.meta?.lastSuccessAt) || previous.manifest?.lastSuccessAt || now,
        cursorAt: Number(payload.meta?.cursorAt) || previous.manifest?.cursorAt || now
      };
      snapshots.set(key, { records, manifest, recovered: false });
      respond(request.requestId, { manifest, count: records.length, patched: payload.records?.length || 0, operationRevision: manifest.revision });
      return;
    }

    if (request.command === 'sync.acquire') {
      const ownerToken = String(payload.ownerToken || '');
      const current = leases.get(key);
      const acquired = !current || current.expiresAt <= now || current.ownerToken === ownerToken;
      if (acquired) leases.set(key, {
        ownerToken,
        fence: current && current.ownerToken === ownerToken && current.expiresAt > now
          ? current.fence
          : Math.max(0, Number(current?.fence) || 0) + 1,
        expiresAt: now + Math.max(1000, Number(payload.ttlMs) || 30000)
      });
      const active = leases.get(key);
      respond(request.requestId, {
        acquired,
        fence: Math.max(0, Number(active?.fence) || 0),
        expiresAt: active?.expiresAt || now,
        retryAfterMs: acquired ? 0 : Math.max(0, active.expiresAt - now)
      });
      return;
    }

    respond(request.requestId, null, `Unsupported repository command: ${request.command}`);
  });

  window.__dialogRepositoryHarness = { snapshots, leases };
})();

(function installPenaDialogRepositoryBridge(global) {
  if (global.__PENA_DIALOG_REPOSITORY__) return;

  const REQUEST_EVENT = 'pena-dialog-repository-request';
  const RESPONSE_EVENT = 'pena-dialog-repository-response';
  const CHANGED_EVENT = 'pena-dialog-repository-changed';
  const CONNECTION_EVENT = 'pena-dialog-repository-connection';
  const RETRY_DELAYS = [1000, 2000, 5000, 15000, 30000, 60000];
  const pending = new Map();
  const scopeStates = new Map();
  const subscribers = new Set();
  const retryWaiters = new Set();
  let sequence = 0;

  const normalizeScope = scope => ({
    portalHost: String(scope?.portalHost || '').trim().toLowerCase(),
    userId: String(scope?.userId || '').trim()
  });
  const scopeKey = scope => {
    const normalized = normalizeScope(scope);
    return `${normalized.portalHost}~${normalized.userId}`;
  };
  const stateFor = scope => {
    const key = scopeKey(scope);
    if (!scopeStates.has(key)) scopeStates.set(key, { revision: null, observedRevision: 0, snapshot: null, lease: null });
    return scopeStates.get(key);
  };
  const newOperationId = prefix => {
    const random = global.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}:${random}`.slice(0, 160);
  };

  function repositoryError(response, fallback) {
    const error = new Error(response?.error || fallback || 'Dialog repository request failed');
    error.code = String(response?.code || 'repository_error');
    error.retryable = response?.retryable === true;
    error.details = response?.details && typeof response.details === 'object' ? response.details : {};
    return error;
  }

  document.addEventListener(RESPONSE_EVENT, event => {
    let response = null;
    try { response = JSON.parse(String(event.detail || '')); } catch {}
    const request = response?.requestId ? pending.get(response.requestId) : null;
    if (!request) return;
    pending.delete(response.requestId);
    clearTimeout(request.timer);
    if (response.ok) request.resolve(response.result);
    else request.reject(repositoryError(response));
  });

  function requestOnce(command, scope, payload = {}, timeoutMs = 20000) {
    const requestId = `pena-repository-${Date.now().toString(36)}-${++sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(repositoryError({
          error: `Dialog repository timeout: ${command}`,
          code: 'repository_timeout',
          retryable: true
        }));
      }, Math.max(1000, Number(timeoutMs) || 20000));
      pending.set(requestId, { resolve, reject, timer });
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: JSON.stringify({ requestId, command, scope: normalizeScope(scope), payload })
      }));
    });
  }

  function wakeRetries() {
    retryWaiters.forEach(resolve => resolve());
    retryWaiters.clear();
  }

  function waitForRetry(delayMs) {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        retryWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(0, Number(delayMs) || 0));
      retryWaiters.add(finish);
    });
  }

  ['online', 'focus', 'pageshow'].forEach(name => global.addEventListener?.(name, wakeRetries));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') wakeRetries();
  });
  document.addEventListener(CONNECTION_EVENT, wakeRetries);

  async function requestRetryable(command, scope, payload, timeoutMs) {
    let attempt = 0;
    for (;;) {
      try {
        return await requestOnce(command, scope, payload, timeoutMs);
      } catch (error) {
        if (!error?.retryable || ['revision_conflict', 'base_snapshot_mismatch', 'lease_fenced', 'lease_expired'].includes(error.code)) throw error;
        const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        attempt += 1;
        await waitForRetry(delay);
      }
    }
  }

  function rememberSnapshot(scope, snapshot) {
    const state = stateFor(scope);
    if (snapshot?.manifest) {
      state.revision = Math.max(0, Number(snapshot.manifest.revision) || 0);
      state.observedRevision = Math.max(state.observedRevision, state.revision);
      state.snapshot = snapshot;
    } else if (snapshot) {
      state.revision = 0;
      state.observedRevision = Math.max(0, state.observedRevision);
      state.snapshot = snapshot;
    }
    return snapshot;
  }

  async function get(scope) {
    return rememberSnapshot(scope, await requestRetryable('catalog.get', scope, {}, 20000));
  }

  function normalizeRecordIds(records) {
    return Array.from(new Set((Array.isArray(records) ? records : []).map(record =>
      String(record?.id || '').trim().toLowerCase()).filter(Boolean)));
  }

  function applyRecords(base, intended, deletedIds = []) {
    const byId = new Map();
    (Array.isArray(base) ? base : []).forEach(record => {
      const id = String(record?.id || '').trim().toLowerCase();
      if (id) byId.set(id, record);
    });
    (Array.isArray(deletedIds) ? deletedIds : []).forEach(id => byId.delete(String(id || '').trim().toLowerCase()));
    (Array.isArray(intended) ? intended : []).forEach(record => {
      const id = String(record?.id || '').trim().toLowerCase();
      if (id) byId.set(id, record);
    });
    return Array.from(byId.values());
  }

  function confirmedCommitBase(snapshot, intendedRecords) {
    const baseIds = normalizeRecordIds(snapshot?.records);
    const intendedIds = new Set(normalizeRecordIds(intendedRecords));
    return {
      baseIds,
      deletedIds: baseIds.filter(id => !intendedIds.has(id)),
      snapshotRevision: Math.max(0, Number(snapshot?.manifest?.revision) || 0)
    };
  }

  function recordsById(records) {
    const byId = new Map();
    (Array.isArray(records) ? records : []).forEach(record => {
      const id = String(record?.id || '').trim().toLowerCase();
      if (id) byId.set(id, record);
    });
    return byId;
  }

  function stableRecordSignature(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableRecordSignature).join(',')}]`;
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${stableRecordSignature(value[key])}`).join(',')}}`;
  }

  function recordsEqual(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;
    return stableRecordSignature(left) === stableRecordSignature(right);
  }

  function recordFreshness(record) {
    const state = record?.state && typeof record.state === 'object' ? record.state : {};
    return Math.max(
      0,
      Number(record?.remoteUpdatedAt) || 0,
      Number(record?.lastMessage?.date) || 0,
      Number(record?.unread?.fetchedAt) || 0,
      Number(state.fetchedAt) || 0,
      Number(state.recentListFetchedAt) || 0,
      Number(state.detailFetchedAt) || 0,
      Number(state.taskCatalogFetchedAt) || 0,
      Number(state.counterFetchedAt) || 0,
      Number(state.availabilityCheckedAt) || 0,
      Number(state.lastMessageTs) || 0
    );
  }

  function recordIsTombstone(record) {
    const availability = String(record?.state?.availability || record?.availability || '').toLowerCase();
    return record?.deleted === true || record?.tombstone === true ||
      ['unavailable', 'deleted', 'forbidden', 'not_found'].includes(availability);
  }

  function mutationProofAt(meta) {
    // Only a versioned full API audit proves that an omitted ID is gone.
    // Delta cursors, native materialization timestamps and task-index freshness
    // say nothing about the availability of this particular record.
    return Number(meta?.apiWatermarkVersion) === 1
      ? Math.max(0, Number(meta?.apiFullAt) || 0)
      : 0;
  }

  function preferIntendedRecord(intended, latest) {
    const intendedAt = recordFreshness(intended);
    const latestAt = recordFreshness(latest);
    if (intendedAt !== latestAt) return intendedAt > latestAt;
    if (recordIsTombstone(intended) !== recordIsTombstone(latest)) return recordIsTombstone(intended);
    // Equal/unknown freshness is not enough to overwrite a value committed by
    // another writer after our base snapshot.
    return false;
  }

  function rebaseMutation(baseSnapshot, latestSnapshot, intendedRecords, intendedDeletedIds, meta, confirmedReplace) {
    const base = recordsById(baseSnapshot?.records);
    const latest = recordsById(latestSnapshot?.records);
    const intended = recordsById(intendedRecords);
    const rebasedRecords = new Map();
    const rebasedDeletedIds = new Set();
    const deleteProofAt = mutationProofAt(meta);

    intended.forEach((localRecord, id) => {
      const baseRecord = base.get(id);
      const latestRecord = latest.get(id);
      if (baseRecord && recordsEqual(localRecord, baseRecord)) {
        if (confirmedReplace && latestRecord) rebasedRecords.set(id, latestRecord);
        return;
      }
      if (!latestRecord) {
        if (!baseRecord || recordFreshness(localRecord) > Math.max(
          recordFreshness(baseRecord),
          Number(latestSnapshot?.manifest?.savedAt) || 0
        )) rebasedRecords.set(id, localRecord);
        return;
      }
      if ((!baseRecord && (recordsEqual(localRecord, latestRecord) || preferIntendedRecord(localRecord, latestRecord))) ||
          (baseRecord && recordsEqual(latestRecord, baseRecord)) ||
          (baseRecord && preferIntendedRecord(localRecord, latestRecord))) {
        rebasedRecords.set(id, localRecord);
      } else if (confirmedReplace && baseRecord) {
        rebasedRecords.set(id, latestRecord);
      }
    });

    const requestedDeletes = confirmedReplace
      ? Array.from(base.keys()).filter(id => !intended.has(id))
      : normalizeRecordIds((Array.isArray(intendedDeletedIds) ? intendedDeletedIds : []).map(id => ({ id })));
    requestedDeletes.forEach(id => {
      const baseRecord = base.get(id);
      const latestRecord = latest.get(id);
      if (!latestRecord) {
        rebasedDeletedIds.add(id);
        return;
      }
      const latestChanged = !baseRecord || !recordsEqual(latestRecord, baseRecord);
      if (!latestChanged || (deleteProofAt > 0 && deleteProofAt > recordFreshness(latestRecord))) {
        rebasedDeletedIds.add(id);
      } else if (confirmedReplace && baseRecord) {
        rebasedRecords.set(id, latestRecord);
      }
    });

    if (confirmedReplace) {
      // The worker validates tombstones against the immutable original base.
      // Preserved concurrent values must therefore remain in the intended set.
      const intendedIds = new Set(rebasedRecords.keys());
      Array.from(base.keys()).forEach(id => {
        if (!intendedIds.has(id)) rebasedDeletedIds.add(id);
        else rebasedDeletedIds.delete(id);
      });
    }
    return { records: Array.from(rebasedRecords.values()), deletedIds: Array.from(rebasedDeletedIds) };
  }

  function mergeMeta(latest, intended) {
    const meta = intended && typeof intended === 'object' ? { ...intended } : {};
    const current = latest && typeof latest === 'object' ? latest : {};
    for (const key of ['lastSuccessAt', 'lastFullAt', 'cursorAt', 'windowCount', 'catalogVersion']) {
      meta[key] = Math.max(0, Number(meta[key]) || 0, Number(current[key]) || 0);
    }
    const expectedApiWatermarkVersion = 1;
    const nextApiWatermarkVersion = Number(intended?.apiWatermarkVersion) === expectedApiWatermarkVersion
      ? expectedApiWatermarkVersion
      : 0;
    const savedApiWatermarkVersion = Number(current?.apiWatermarkVersion) === expectedApiWatermarkVersion
      ? expectedApiWatermarkVersion
      : 0;
    meta.apiWatermarkVersion = nextApiWatermarkVersion || savedApiWatermarkVersion;
    meta.apiCursorAt = meta.apiWatermarkVersion ? Math.max(
      nextApiWatermarkVersion ? Number(intended?.apiCursorAt) || 0 : 0,
      savedApiWatermarkVersion ? Number(current?.apiCursorAt) || 0 : 0
    ) : 0;
    meta.apiFullAt = meta.apiWatermarkVersion ? Math.max(
      nextApiWatermarkVersion ? Number(intended?.apiFullAt) || 0 : 0,
      savedApiWatermarkVersion ? Number(current?.apiFullAt) || 0 : 0
    ) : 0;
    const mergeMode = mode => {
      const next = intended?.catalogModes?.[mode] || {};
      const saved = current?.catalogModes?.[mode] || {};
      const nextAt = Math.max(0, Number(next.loadedAt) || 0);
      const savedAt = Math.max(0, Number(saved.loadedAt) || 0);
      const compact = (value, loadedAt) => {
        const count = Math.max(0, Number(value?.count) || 0);
        const confirmedIds = Array.from(new Set((Array.isArray(value?.confirmedIds) ? value.confirmedIds : [])
          .map(id => String(id || '').trim().toLowerCase()).filter(Boolean))).slice(0, 100000);
        return {
          complete: value?.complete === true,
          loadedAt,
          count,
          ...(count > 0 && confirmedIds.length === count ? { confirmedIds } : {})
        };
      };
      if (nextAt > savedAt) return compact(next, nextAt);
      // Equal timestamps are possible within one millisecond. On a CAS rebase,
      // the already committed descriptor wins that tie; otherwise a stale tab
      // can replace an exact confirmedIds set with its different same-time set.
      return compact(saved, savedAt);
    };
    meta.catalogModes = { chats: mergeMode('chats'), tasks: mergeMode('tasks') };
    const nextTaskAt = Math.max(0, Number(intended?.taskCatalog?.fetchedAt) || 0);
    const savedTaskAt = Math.max(0, Number(current?.taskCatalog?.fetchedAt) || 0);
    meta.taskCatalog = nextTaskAt > savedTaskAt
      ? { complete: intended?.taskCatalog?.complete === true, fetchedAt: nextTaskAt }
      : savedTaskAt > nextTaskAt
        ? { complete: current?.taskCatalog?.complete === true, fetchedAt: savedTaskAt }
        : {
            complete: intended?.taskCatalog?.complete === true || current?.taskCatalog?.complete === true,
            fetchedAt: nextTaskAt
          };
    return meta;
  }

  function leasePayload(state) {
    if (!state.lease?.acquired) return {};
    return {
      leaseFence: Math.max(0, Number(state.lease.fence) || 0),
      leaseOwnerToken: state.lease.ownerToken
    };
  }

  async function renewLease(scope, state) {
    if (!state.lease?.ownerToken) return false;
    for (;;) {
      const lease = await requestRetryable('sync.acquire', scope, {
        ownerToken: state.lease.ownerToken,
        ttlMs: state.lease.ttlMs
      }, 20000);
      state.lease = { ...state.lease, ...lease };
      if (lease?.acquired) return true;
      await waitForRetry(Math.max(1000, Number(lease?.retryAfterMs) || 1000));
    }
  }

  async function mutate(command, scope, records, deletedIds, meta, options = {}) {
    const state = stateFor(scope);
    const id = String(options.operationId || newOperationId(command === 'catalog.commit' ? 'commit' : 'patch'));
    const intendedRecords = Array.isArray(records) ? records : [];
    const intendedDeletedIds = Array.isArray(deletedIds) ? deletedIds : [];
    const confirmedReplace = command === 'catalog.commit' && options.confirmedReplace === true;
    if (state.revision == null || !state.snapshot) await get(scope);
    const baseSnapshot = state.snapshot;
    const confirmation = confirmedReplace ? confirmedCommitBase(baseSnapshot, intendedRecords) : null;
    let workingSnapshot = state.snapshot;
    let outgoingRecords = intendedRecords;
    let outgoingDeletedIds = confirmedReplace ? confirmation.deletedIds : intendedDeletedIds;
    let outgoingMeta = mergeMeta(state.snapshot?.manifest, meta);

    const rebaseAgainst = latest => {
      workingSnapshot = latest;
      const rebased = rebaseMutation(
        baseSnapshot,
        latest,
        intendedRecords,
        intendedDeletedIds,
        meta,
        confirmedReplace
      );
      outgoingRecords = rebased.records;
      outgoingDeletedIds = rebased.deletedIds;
      outgoingMeta = mergeMeta(latest?.manifest, meta);
    };

    for (;;) {
      const commitDeletedIds = confirmedReplace ? outgoingDeletedIds : [];
      const payload = {
        records: outgoingRecords,
        deletedIds: command === 'catalog.commit' ? commitDeletedIds : outgoingDeletedIds,
        meta: outgoingMeta,
        baseRevision: Math.max(0, Number(state.revision) || 0),
        operationId: id,
        confirmedReplace,
        baseIds: confirmedReplace ? confirmation.baseIds : [],
        snapshotRevision: confirmedReplace ? confirmation.snapshotRevision : Math.max(0, Number(state.revision) || 0),
        ...leasePayload(state)
      };
      try {
        const result = await requestRetryable(command, scope, payload, 60000);
        if (result?.manifest) {
          const appliedDeletedIds = command === 'catalog.commit' ? commitDeletedIds : intendedDeletedIds;
          const operationRevision = Math.max(0, Number(result.operationRevision) || Number(result.manifest.revision) || 0);
          state.revision = operationRevision;
          state.observedRevision = Math.max(state.observedRevision, Number(result.manifest.revision) || 0, operationRevision);
          state.snapshot = {
            records: applyRecords(workingSnapshot?.records, outgoingRecords, appliedDeletedIds),
            manifest: { ...result.manifest, revision: operationRevision },
            recovered: false
          };
        }
        return result;
      } catch (error) {
        if (error?.code === 'revision_conflict') {
          const latest = await get(scope);
          rebaseAgainst(latest);
          continue;
        }
        if (error?.code === 'base_snapshot_mismatch') {
          const latest = await get(scope);
          rebaseAgainst(latest);
          continue;
        }
        if (['lease_fenced', 'lease_expired'].includes(error?.code)) {
          if (state.lease?.ownerToken) await renewLease(scope, state);
          else await waitForRetry(Math.max(1000, Number(error?.details?.expiresAt) - Date.now() || 1000));
          rebaseAgainst(await get(scope));
          continue;
        }
        throw error;
      }
    }
  }

  async function acquire(scope, ownerToken, ttlMs = 30000) {
    const state = stateFor(scope);
    const lease = await requestRetryable('sync.acquire', scope, { ownerToken, ttlMs }, 20000);
    state.lease = { ...lease, ownerToken: String(ownerToken || ''), ttlMs };
    return lease;
  }

  document.addEventListener(CHANGED_EVENT, event => {
    let change = null;
    try { change = JSON.parse(String(event.detail || '')); } catch {}
    if (!change?.scope) return;
    const state = stateFor(change.scope);
    const revision = Math.max(0, Number(change.revision) || 0);
    state.observedRevision = Math.max(state.observedRevision, revision);
    subscribers.forEach(listener => {
      try { listener(change); } catch {}
    });
    wakeRetries();
  });

  global.__PENA_DIALOG_REPOSITORY__ = Object.freeze({
    get,
    commit: (scope, records, meta, options) => mutate('catalog.commit', scope, records, [], meta, options),
    patch: (scope, records, deletedIds, meta, options) => mutate('catalog.patch', scope, records, deletedIds, meta, options),
    acquire,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    }
  });
})(window);

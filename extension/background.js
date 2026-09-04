// PENA Agency - background service worker

const REPOSITORY_CHANNEL_V1 = 'pena.dialog.repository.v1';
const REPOSITORY_CHANNEL_V2 = 'pena.dialog.repository.v2';
const WORKER_HEALTH_CHANNEL = 'pena.runtime.worker-health.v1';
const REPOSITORY_SCHEMA = 2;
const REPOSITORY_LEGACY_SCHEMA = 1;
const DIALOG_API_WATERMARK_VERSION = 1;
const REPOSITORY_CHUNK_SIZE = 250;
// Keep the v1 key space so installed catalogs migrate in place instead of
// disappearing after the worker upgrade.
const REPOSITORY_PREFIX = 'pena.dialog.catalog.v1';
const LEASE_PREFIX = 'pena.dialog.sync-lease.v1';
const LEASE_DEFAULT_MS = 30000;
const PATCH_COMPACT_COUNT = 32;
const PATCH_COMPACT_RECORDS = 2000;
const RECENT_OPERATION_LIMIT = 64;

const scopeLocks = new Map();
const memoryLeases = new Map();

const storageArea = area => chrome.storage?.[area] || null;

function storageGet(area, keys) {
  const storage = storageArea(area);
  if (!storage) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    storage.get(keys, values => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve(values || {});
    });
  });
}

function storageSet(area, values) {
  const storage = storageArea(area);
  if (!storage) return Promise.reject(new Error(`chrome.storage.${area} is unavailable`));
  return new Promise((resolve, reject) => {
    storage.set(values, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function storageRemove(area, keys) {
  const storage = storageArea(area);
  if (!storage || !keys?.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    storage.remove(keys, () => {
      const error = chrome.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function normalizeScope(scope) {
  const portalHost = String(scope?.portalHost || '').trim().toLowerCase();
  const userId = String(scope?.userId || '').trim();
  if (!portalHost || !/^\d+$/.test(userId) || Number(userId) <= 0) {
    throw new Error('Catalog scope requires portalHost and numeric userId');
  }
  return { portalHost, userId };
}

function scopeId(scope) {
  const normalized = normalizeScope(scope);
  return `${encodeURIComponent(normalized.portalHost)}~${encodeURIComponent(normalized.userId)}`;
}

function scopeRoot(scope) {
  return `${REPOSITORY_PREFIX}.${scopeId(scope)}`;
}

function manifestKey(scope) {
  return `${scopeRoot(scope)}.manifest`;
}

function chunkKey(scope, generation, index) {
  return `${scopeRoot(scope)}.generation.${generation}.chunk.${index}`;
}

function patchKey(scope, generation) {
  return `${scopeRoot(scope)}.patch.${generation}`;
}

function leaseKey(scope) {
  return `${LEASE_PREFIX}.${scopeId(scope)}`;
}

function newGeneration() {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

function repositoryError(code, message, details = {}, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable === true;
  error.details = details && typeof details === 'object' ? details : {};
  return error;
}

function normalizeRevision(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizeOperationId(value) {
  const operationId = String(value || '').trim();
  if (!operationId || operationId.length > 160) return '';
  return operationId;
}

function compactRecentOperations(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(operation => ({
    id: normalizeOperationId(operation?.id),
    revision: normalizeRevision(operation?.revision),
    count: Math.max(0, Number(operation?.count) || 0),
    patched: Math.max(0, Number(operation?.patched) || 0),
    deleted: Math.max(0, Number(operation?.deleted) || 0)
  })).filter(operation => operation.id && !seen.has(operation.id) && seen.add(operation.id)).slice(-RECENT_OPERATION_LIMIT);
}

function appendRecentOperation(manifest, operation) {
  const operationId = normalizeOperationId(operation?.id);
  const existing = compactRecentOperations(manifest?.recentOperations)
    .filter(item => item.id !== operationId);
  if (operationId) existing.push({
    id: operationId,
    revision: normalizeRevision(operation?.revision),
    count: Math.max(0, Number(operation?.count) || 0),
    patched: Math.max(0, Number(operation?.patched) || 0),
    deleted: Math.max(0, Number(operation?.deleted) || 0)
  });
  return existing.slice(-RECENT_OPERATION_LIMIT);
}

function serialForScope(scope, worker) {
  const id = scopeId(scope);
  const previous = scopeLocks.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(worker);
  scopeLocks.set(id, current);
  return current.finally(() => {
    if (scopeLocks.get(id) === current) scopeLocks.delete(id);
  });
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const id = String(record.id || '').trim().toLowerCase();
  if (!id) return null;
  return { ...record, id };
}

function normalizeRecords(records) {
  const byId = new Map();
  (Array.isArray(records) ? records : []).forEach(record => {
    const normalized = normalizeRecord(record);
    if (normalized) byId.set(normalized.id, normalized);
  });
  return Array.from(byId.values());
}

function normalizeIds(ids) {
  return Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map(id => String(id || '').trim().toLowerCase())
    .filter(Boolean)));
}

function sameIdSet(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every(id => expected.has(id));
}

function prepareCommitRecords(currentRecords, payload, mutation) {
  const intendedRecords = normalizeRecords(payload.records);
  const intendedIds = intendedRecords.map(record => record.id);
  const confirmedReplace = payload.confirmedReplace === true;
  const deletedIds = normalizeIds(payload.deletedIds);
  const byId = new Map(currentRecords.map(record => [record.id, record]));

  if (!confirmedReplace) {
    if (deletedIds.length) {
      throw repositoryError('unconfirmed_tombstones', 'Unconfirmed catalog commit cannot delete records');
    }
    intendedRecords.forEach(record => byId.set(record.id, record));
    return { records: Array.from(byId.values()), deletedIds: [], confirmedReplace: false };
  }

  const baseIds = normalizeIds(payload.baseIds);
  const snapshotRevision = Number(payload.snapshotRevision);
  if (!Number.isInteger(snapshotRevision) || snapshotRevision < 0 || snapshotRevision > mutation.baseRevision) {
    throw repositoryError('invalid_snapshot_revision', 'Confirmed catalog commit requires a valid snapshotRevision');
  }
  const intendedSet = new Set(intendedIds);
  const expectedDeletedIds = baseIds.filter(id => !intendedSet.has(id));
  if (!sameIdSet(expectedDeletedIds, deletedIds)) {
    throw repositoryError('invalid_tombstones', 'Confirmed catalog tombstones do not match the base snapshot');
  }
  if (snapshotRevision === mutation.baseRevision) {
    const currentIds = currentRecords.map(record => record.id);
    if (!sameIdSet(baseIds, currentIds)) {
      throw repositoryError('base_snapshot_mismatch', 'Confirmed catalog base snapshot does not match baseRevision', {
        snapshotRevision,
        currentRevision: mutation.baseRevision
      }, true);
    }
  }

  deletedIds.forEach(id => byId.delete(id));
  intendedRecords.forEach(record => byId.set(record.id, record));
  return { records: Array.from(byId.values()), deletedIds, confirmedReplace: true };
}

function compactCatalogModes(value, records = null) {
  const source = value && typeof value === 'object' ? value : {};
  const recordIdsByMode = Array.isArray(records)
    ? {
        chats: new Set(records.filter(record => record?.mode !== 'tasks').map(record => String(record?.id || '').trim().toLowerCase()).filter(Boolean)),
        tasks: new Set(records.filter(record => record?.mode === 'tasks').map(record => String(record?.id || '').trim().toLowerCase()).filter(Boolean))
      }
    : null;
  const compactMode = mode => {
    const count = Math.max(0, Number(source[mode]?.count) || 0);
    const confirmedIds = Array.from(new Set((Array.isArray(source[mode]?.confirmedIds) ? source[mode].confirmedIds : [])
      .map(id => String(id || '').trim().toLowerCase()).filter(Boolean)))
      .slice(0, 100000)
      .filter(id => !recordIdsByMode || recordIdsByMode[mode].has(id));
    return {
      complete: source[mode]?.complete === true,
      loadedAt: Math.max(0, Number(source[mode]?.loadedAt) || 0),
      count,
      ...(count > 0 && confirmedIds.length === count ? { confirmedIds } : {})
    };
  };
  return { chats: compactMode('chats'), tasks: compactMode('tasks') };
}

function compactTaskCatalog(value) {
  return {
    complete: value?.complete === true,
    fetchedAt: Math.max(0, Number(value?.fetchedAt) || 0)
  };
}

function compactGenerationDescriptor(manifest) {
  if (!manifest || !manifest.generation) return null;
  return {
    schema: REPOSITORY_SCHEMA,
    revision: normalizeRevision(manifest.revision),
    baseRevision: normalizeRevision(manifest.baseRevision),
    operationId: normalizeOperationId(manifest.operationId),
    leaseFence: normalizeRevision(manifest.leaseFence),
    generation: String(manifest.generation),
    chunkCount: Math.max(0, Number(manifest.chunkCount) || 0),
    baseCount: Math.max(0, Number(manifest.baseCount ?? manifest.count) || 0),
    count: Math.max(0, Number(manifest.count) || 0),
    savedAt: Math.max(0, Number(manifest.savedAt) || 0),
    lastSuccessAt: Math.max(0, Number(manifest.lastSuccessAt) || 0),
    lastFullAt: Math.max(0, Number(manifest.lastFullAt) || 0),
    cursorAt: Math.max(0, Number(manifest.cursorAt) || 0),
    apiWatermarkVersion: Number(manifest.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
      ? DIALOG_API_WATERMARK_VERSION
      : 0,
    apiCursorAt: Number(manifest.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
      ? Math.max(0, Number(manifest.apiCursorAt) || 0)
      : 0,
    apiFullAt: Number(manifest.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
      ? Math.max(0, Number(manifest.apiFullAt) || 0)
      : 0,
    windowCount: Math.max(0, Number(manifest.windowCount) || 0),
    truncated: !!manifest.truncated,
    catalogVersion: Math.max(0, Number(manifest.catalogVersion) || 0),
    catalogModes: compactCatalogModes(manifest.catalogModes),
    taskCatalog: compactTaskCatalog(manifest.taskCatalog),
    recentOperations: compactRecentOperations(manifest.recentOperations),
    patches: Array.isArray(manifest.patches) ? manifest.patches.map(patch => ({
      generation: String(patch?.generation || ''),
      count: Math.max(0, Number(patch?.count) || 0),
      deletedCount: Math.max(0, Number(patch?.deletedCount) || 0),
      savedAt: Math.max(0, Number(patch?.savedAt) || 0)
    })).filter(patch => patch.generation) : [],
    previous: null
  };
}

function compactManifest(manifest) {
  if (!manifest || ![REPOSITORY_LEGACY_SCHEMA, REPOSITORY_SCHEMA].includes(Number(manifest.schema))) return null;
  const descriptor = compactGenerationDescriptor(manifest);
  if (!descriptor) return null;
  descriptor.previous = compactGenerationDescriptor(manifest.previous);
  return descriptor;
}

async function readGeneration(scope, generationInfo) {
  if (!generationInfo?.generation) return null;
  const chunkCount = Math.max(0, Number(generationInfo.chunkCount) || 0);
  const keys = Array.from({ length: chunkCount }, (_, index) => chunkKey(scope, generationInfo.generation, index));
  const stored = await storageGet('local', keys);
  const records = [];
  for (const key of keys) {
    if (!Array.isArray(stored[key])) return null;
    records.push(...stored[key]);
  }
  const normalized = normalizeRecords(records);
  const expectedCount = Number(generationInfo.baseCount ?? generationInfo.count);
  if (Number.isFinite(expectedCount) && normalized.length !== expectedCount) return null;
  return normalized;
}

async function applyPatchesStrict(scope, records, patches) {
  if (!patches?.length) return records;
  const keys = patches.map(patch => patchKey(scope, patch.generation));
  const stored = await storageGet('local', keys);
  const byId = new Map(records.map(record => [record.id, record]));
  for (let index = 0; index < patches.length; index += 1) {
    const descriptor = patches[index];
    const patch = stored[keys[index]];
    if (!patch || ![REPOSITORY_LEGACY_SCHEMA, REPOSITORY_SCHEMA].includes(Number(patch.schema)) || String(patch.generation || '') !== descriptor.generation) return null;
    if (!Array.isArray(patch.records) || !Array.isArray(patch.deletedIds)) return null;
    const patchRecords = normalizeRecords(patch.records);
    const deletedIds = Array.from(new Set(patch.deletedIds
      .map(id => String(id || '').trim().toLowerCase()).filter(Boolean)));
    if (patchRecords.length !== descriptor.count || deletedIds.length !== descriptor.deletedCount) return null;
    deletedIds.forEach(id => byId.delete(id));
    patchRecords.forEach(record => byId.set(record.id, record));
  }
  return Array.from(byId.values());
}

async function migrateLegacyManifest(scope, rawManifest, manifest, actualCount) {
  if (Number(rawManifest?.schema) !== REPOSITORY_LEGACY_SCHEMA || !manifest?.generation) return manifest;
  const operationId = `migration-v1:${manifest.generation}`;
  const revision = Math.max(1, normalizeRevision(manifest.revision));
  const next = {
    ...manifest,
    schema: REPOSITORY_SCHEMA,
    baseCount: Math.max(0, Number(manifest.count) || 0),
    count: Math.max(0, Number(actualCount) || 0),
    revision,
    baseRevision: 0,
    operationId,
    recentOperations: appendRecentOperation(manifest, {
      id: operationId,
      revision,
      count: Math.max(0, Number(actualCount) || 0)
    })
  };
  try {
    await storageSet('local', { [manifestKey(scope)]: next });
    return compactManifest(next);
  } catch {
    // Reading a valid v1 catalog remains available even if the best-effort
    // migration publication is temporarily blocked. The following mutation
    // will retry the schema upgrade through the normal CAS path.
    return { ...manifest, migrationPending: true };
  }
}

async function readCatalogUnlocked(scope, options = {}) {
  const key = manifestKey(scope);
  const values = await storageGet('local', key);
  const rawManifest = values[key];
  let manifest = compactManifest(rawManifest);
  if (!manifest) return { records: [], manifest: null, recovered: false };

  const activeBase = await readGeneration(scope, manifest);
  const activeRecords = activeBase && await applyPatchesStrict(scope, activeBase, manifest.patches);
  if (activeRecords) {
    if (options.migrateLegacy === true) manifest = await migrateLegacyManifest(scope, rawManifest, manifest, activeRecords.length);
    return { records: activeRecords, manifest, recovered: false };
  }

  if (manifest.previous) {
    const previousBase = await readGeneration(scope, manifest.previous);
    const previousRecords = previousBase && await applyPatchesStrict(scope, previousBase, manifest.previous.patches);
    if (previousRecords) {
      return {
        records: previousRecords,
        manifest: {
          ...manifest.previous,
          schema: REPOSITORY_SCHEMA,
          revision: Math.max(normalizeRevision(manifest.revision), normalizeRevision(manifest.previous.revision)),
          leaseFence: Math.max(normalizeRevision(manifest.leaseFence), normalizeRevision(manifest.previous.leaseFence)),
          previous: null
        },
        recovered: true
      };
    }
  }
  return { records: [], manifest: null, recovered: false, corrupt: true };
}

async function writeChunks(scope, generation, records) {
  const chunks = [];
  for (let index = 0; index < records.length; index += REPOSITORY_CHUNK_SIZE) {
    chunks.push(records.slice(index, index + REPOSITORY_CHUNK_SIZE));
  }
  for (let index = 0; index < chunks.length; index += 12) {
    const batch = {};
    chunks.slice(index, index + 12).forEach((chunk, offset) => {
      batch[chunkKey(scope, generation, index + offset)] = chunk;
    });
    await storageSet('local', batch);
  }
  return chunks.length;
}

function previousDescriptor(manifest) {
  if (!manifest?.generation) return null;
  return {
    schema: REPOSITORY_SCHEMA,
    revision: normalizeRevision(manifest.revision),
    baseRevision: normalizeRevision(manifest.baseRevision),
    operationId: normalizeOperationId(manifest.operationId),
    leaseFence: normalizeRevision(manifest.leaseFence),
    generation: manifest.generation,
    chunkCount: manifest.chunkCount,
    baseCount: Math.max(0, Number(manifest.baseCount ?? manifest.count) || 0),
    count: manifest.count,
    savedAt: manifest.savedAt,
    lastSuccessAt: manifest.lastSuccessAt,
    lastFullAt: manifest.lastFullAt,
    cursorAt: manifest.cursorAt,
    apiWatermarkVersion: Number(manifest.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
      ? DIALOG_API_WATERMARK_VERSION
      : 0,
    apiCursorAt: Number(manifest.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
      ? Math.max(0, Number(manifest.apiCursorAt) || 0)
      : 0,
    apiFullAt: Number(manifest.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
      ? Math.max(0, Number(manifest.apiFullAt) || 0)
      : 0,
    windowCount: manifest.windowCount,
    truncated: manifest.truncated,
    catalogVersion: Math.max(0, Number(manifest.catalogVersion) || 0),
    catalogModes: compactCatalogModes(manifest.catalogModes),
    taskCatalog: compactTaskCatalog(manifest.taskCatalog),
    recentOperations: compactRecentOperations(manifest.recentOperations),
    patches: Array.isArray(manifest.patches) ? manifest.patches.map(patch => ({ ...patch })) : []
  };
}

async function removeGeneration(scope, generationInfo) {
  if (!generationInfo?.generation) return;
  const keys = Array.from(
    { length: Math.max(0, Number(generationInfo.chunkCount) || 0) },
    (_, index) => chunkKey(scope, generationInfo.generation, index)
  );
  await storageRemove('local', keys);
}

function senderLeaseOwner(sender, ownerToken) {
  return `${sender?.tab?.id ?? 'no-tab'}:${sender?.frameId ?? 0}:${ownerToken}`;
}

function leaseStorageArea() {
  return storageArea('session') ? 'session' : 'local';
}

async function readLease(scope) {
  const key = leaseKey(scope);
  const values = await storageGet(leaseStorageArea(), key);
  const stored = values[key] || null;
  const memory = memoryLeases.get(key) || null;
  const current = normalizeRevision(stored?.fence) >= normalizeRevision(memory?.fence) ? stored : memory;
  if (current) memoryLeases.set(key, current);
  return current;
}

function operationResult(manifest, operationId) {
  const operation = compactRecentOperations(manifest?.recentOperations)
    .find(item => item.id === operationId);
  if (!operation) return null;
  return {
    manifest,
    count: operation.count,
    patched: operation.patched,
    deleted: operation.deleted,
    duplicate: true,
    operationRevision: operation.revision
  };
}

async function prepareMutation(scope, payload, sender, protocol, currentManifest) {
  const currentRevision = normalizeRevision(currentManifest?.revision);
  const operationId = normalizeOperationId(payload?.operationId);
  if (!operationId) {
    throw repositoryError(
      protocol >= REPOSITORY_SCHEMA ? 'invalid_operation' : 'protocol_upgrade_required',
      protocol >= REPOSITORY_SCHEMA
        ? 'Repository v2 mutation requires operationId'
        : 'Legacy repository writers must reload before saving'
    );
  }

  const duplicate = operationResult(currentManifest, operationId);
  if (duplicate) return { duplicate };

  const suppliedBase = payload?.baseRevision;
  if (suppliedBase === null || suppliedBase === '' || !Number.isInteger(Number(suppliedBase)) || Number(suppliedBase) < 0) {
    throw repositoryError(
      protocol >= REPOSITORY_SCHEMA ? 'invalid_base_revision' : 'protocol_upgrade_required',
      protocol >= REPOSITORY_SCHEMA
        ? 'Repository v2 mutation requires baseRevision'
        : 'Legacy repository writers must reload before saving'
    );
  }
  const baseRevision = normalizeRevision(suppliedBase);
  if (baseRevision !== currentRevision) {
    throw repositoryError('revision_conflict', 'Dialog catalog revision conflict', {
      baseRevision,
      currentRevision,
      operationId
    }, true);
  }

  const lease = await readLease(scope);
  const now = Date.now();
  const activeLease = lease && Number(lease.expiresAt) > now ? lease : null;
  const leaseFence = normalizeRevision(payload?.leaseFence);
  const leaseOwnerToken = String(payload?.leaseOwnerToken || '').trim();
  if (activeLease) {
    const expectedOwner = senderLeaseOwner(sender, leaseOwnerToken);
    if (!leaseFence || leaseFence !== normalizeRevision(activeLease.fence) || !leaseOwnerToken || activeLease.owner !== expectedOwner) {
      throw repositoryError('lease_fenced', 'Dialog catalog writer lost its lease', {
        currentFence: normalizeRevision(activeLease.fence),
        expiresAt: Math.max(0, Number(activeLease.expiresAt) || 0)
      }, true);
    }
  } else if (leaseFence) {
    throw repositoryError('lease_expired', 'Dialog catalog writer lease expired', {
      currentFence: normalizeRevision(lease?.fence)
    }, true);
  }

  return {
    operationId,
    baseRevision,
    revision: currentRevision + 1,
    leaseFence: Math.max(normalizeRevision(currentManifest?.leaseFence), leaseFence)
  };
}

async function commitCatalogUnlocked(scope, payload = {}, context = {}) {
  const key = manifestKey(scope);
  const currentSnapshot = await readCatalogUnlocked(scope);
  const current = currentSnapshot.manifest;
  const mutation = await prepareMutation(scope, payload, context.sender, context.protocol, current);
  if (mutation.duplicate) return mutation.duplicate;
  const commit = prepareCommitRecords(currentSnapshot.records, payload, mutation);
  const records = commit.records;
  let previous = previousDescriptor(current);
  const stagedGenerations = [];
  if (current && current.patches.length) {
    const backupGeneration = newGeneration();
    const backupChunkCount = await writeChunks(scope, backupGeneration, currentSnapshot.records);
    stagedGenerations.push({ generation: backupGeneration, chunkCount: backupChunkCount });
    previous = {
      ...previous,
      generation: backupGeneration,
      chunkCount: backupChunkCount,
      baseCount: currentSnapshot.records.length,
      count: currentSnapshot.records.length,
      patches: []
    };
  }
  const generation = newGeneration();
  const chunkCount = await writeChunks(scope, generation, records);
  stagedGenerations.push({ generation, chunkCount });
  const now = Date.now();
  const meta = payload.meta || {};
  const apiWatermarkVersion = Number(meta.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
    ? DIALOG_API_WATERMARK_VERSION
    : 0;
  const next = {
    schema: REPOSITORY_SCHEMA,
    revision: mutation.revision,
    baseRevision: mutation.baseRevision,
    operationId: mutation.operationId,
    leaseFence: mutation.leaseFence,
    generation,
    chunkCount,
    baseCount: records.length,
    count: records.length,
    savedAt: now,
    lastSuccessAt: Math.max(0, Number(meta.lastSuccessAt) || 0),
    lastFullAt: Math.max(0, Number(meta.lastFullAt) || 0),
    cursorAt: Math.max(0, Number(meta.cursorAt) || Number(meta.lastSuccessAt) || 0),
    apiWatermarkVersion,
    apiCursorAt: apiWatermarkVersion ? Math.max(0, Number(meta.apiCursorAt) || 0) : 0,
    apiFullAt: apiWatermarkVersion ? Math.max(0, Number(meta.apiFullAt) || 0) : 0,
    windowCount: Math.max(0, Number(meta.windowCount) || records.length),
    truncated: !!meta.truncated,
    catalogVersion: Math.max(0, Number(meta.catalogVersion) || 0),
    catalogModes: compactCatalogModes(meta.catalogModes, records),
    taskCatalog: compactTaskCatalog(meta.taskCatalog),
    recentOperations: appendRecentOperation(current, {
      id: mutation.operationId,
      revision: mutation.revision,
      count: records.length,
      deleted: commit.deletedIds.length
    }),
    patches: [],
    previous
  };
  // The manifest is the only publication point. Until this succeeds, readers
  // continue to see the previous complete generation.
  try {
    await storageSet('local', { [key]: next });
  } catch (error) {
    await Promise.all(stagedGenerations.map(info => removeGeneration(scope, info).catch(() => {})));
    throw error;
  }

  const stalePatchKeys = (current?.patches || []).map(patch => patchKey(scope, patch.generation));
  await storageRemove('local', stalePatchKeys).catch(() => {});
  const keptPreviousGeneration = next.previous?.generation || '';
  if (current?.generation && current.generation !== keptPreviousGeneration) await removeGeneration(scope, current).catch(() => {});
  if (current?.previous?.generation && current.previous.generation !== keptPreviousGeneration) await removeGeneration(scope, current.previous).catch(() => {});
  return {
    manifest: compactManifest(next),
    count: records.length,
    deleted: commit.deletedIds.length,
    confirmedReplace: commit.confirmedReplace,
    operationRevision: mutation.revision
  };
}

async function patchCatalogUnlocked(scope, payload = {}, context = {}) {
  const current = await readCatalogUnlocked(scope);
  if (current.corrupt) {
    throw repositoryError('catalog_corrupt', 'Dialog catalog is corrupt; full commit required');
  }
  if (!current.manifest) return commitCatalogUnlocked(scope, payload, context);
  const mutation = await prepareMutation(scope, payload, context.sender, context.protocol, current.manifest);
  if (mutation.duplicate) return mutation.duplicate;
  const records = normalizeRecords(payload.records);
  const deletedIds = normalizeIds(payload.deletedIds);
  if (!records.length && !deletedIds.length) {
    return { manifest: current.manifest, count: current.records.length, patched: 0 };
  }

  const merged = new Map(current.records.map(record => [record.id, record]));
  deletedIds.forEach(id => merged.delete(id));
  records.forEach(record => merged.set(record.id, record));
  const mergedCount = merged.size;

  const generation = newGeneration();
  const patch = { schema: REPOSITORY_SCHEMA, generation, records, deletedIds, savedAt: Date.now() };
  await storageSet('local', { [patchKey(scope, generation)]: patch });
  const meta = payload.meta || {};
  const currentApiWatermarkVersion = Number(current.manifest.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
    ? DIALOG_API_WATERMARK_VERSION
    : 0;
  const incomingApiWatermarkVersion = Number(meta.apiWatermarkVersion) === DIALOG_API_WATERMARK_VERSION
    ? DIALOG_API_WATERMARK_VERSION
    : 0;
  const apiWatermarkVersion = incomingApiWatermarkVersion || currentApiWatermarkVersion;
  const next = {
    ...current.manifest,
    schema: REPOSITORY_SCHEMA,
    revision: mutation.revision,
    baseRevision: mutation.baseRevision,
    operationId: mutation.operationId,
    leaseFence: mutation.leaseFence,
    count: mergedCount,
    savedAt: patch.savedAt,
    lastSuccessAt: Math.max(Number(current.manifest.lastSuccessAt) || 0, Number(meta.lastSuccessAt) || 0),
    lastFullAt: Math.max(Number(current.manifest.lastFullAt) || 0, Number(meta.lastFullAt) || 0),
    cursorAt: Math.max(Number(current.manifest.cursorAt) || 0, Number(meta.cursorAt) || Number(meta.lastSuccessAt) || 0),
    apiWatermarkVersion,
    apiCursorAt: apiWatermarkVersion ? Math.max(
      currentApiWatermarkVersion ? Number(current.manifest.apiCursorAt) || 0 : 0,
      incomingApiWatermarkVersion ? Number(meta.apiCursorAt) || 0 : 0
    ) : 0,
    apiFullAt: apiWatermarkVersion ? Math.max(
      currentApiWatermarkVersion ? Number(current.manifest.apiFullAt) || 0 : 0,
      incomingApiWatermarkVersion ? Number(meta.apiFullAt) || 0 : 0
    ) : 0,
    windowCount: Math.max(0, Number(meta.windowCount) || Number(current.manifest.windowCount) || current.records.length),
    truncated: meta.truncated === undefined ? !!current.manifest.truncated : !!meta.truncated,
    catalogVersion: Math.max(0, Number(meta.catalogVersion) || Number(current.manifest.catalogVersion) || 0),
    catalogModes: meta.catalogModes === undefined
      ? compactCatalogModes(current.manifest.catalogModes, Array.from(merged.values()))
      : compactCatalogModes(meta.catalogModes, Array.from(merged.values())),
    taskCatalog: meta.taskCatalog === undefined
      ? compactTaskCatalog(current.manifest.taskCatalog)
      : compactTaskCatalog(meta.taskCatalog),
    recentOperations: appendRecentOperation(current.manifest, {
      id: mutation.operationId,
      revision: mutation.revision,
      count: mergedCount,
      patched: records.length,
      deleted: deletedIds.length
    }),
    patches: [...current.manifest.patches, {
      generation,
      count: records.length,
      deletedCount: deletedIds.length,
      savedAt: patch.savedAt
    }]
  };
  try {
    await storageSet('local', { [manifestKey(scope)]: next });
  } catch (error) {
    await storageRemove('local', [patchKey(scope, generation)]).catch(() => {});
    throw error;
  }

  const patchVolume = next.patches.reduce((sum, item) => sum + item.count + item.deletedCount, 0);
  if (next.patches.length >= PATCH_COMPACT_COUNT || patchVolume >= PATCH_COMPACT_RECORDS) {
    return commitCatalogUnlocked(scope, {
      records: Array.from(merged.values()),
      baseRevision: mutation.revision,
      operationId: `compact:${mutation.operationId}`.slice(0, 160),
      leaseFence: payload.leaseFence,
      leaseOwnerToken: payload.leaseOwnerToken,
      meta: {
        lastSuccessAt: next.lastSuccessAt,
        lastFullAt: next.lastFullAt,
        cursorAt: next.cursorAt,
        apiWatermarkVersion: next.apiWatermarkVersion,
        apiCursorAt: next.apiCursorAt,
        apiFullAt: next.apiFullAt,
        windowCount: next.windowCount,
        truncated: next.truncated,
        catalogVersion: next.catalogVersion,
        catalogModes: next.catalogModes,
        taskCatalog: next.taskCatalog
      }
    }, context);
  }
  return {
    manifest: compactManifest(next),
    count: mergedCount,
    patched: records.length,
    deleted: deletedIds.length,
    operationRevision: mutation.revision
  };
}

async function acquireSync(scope, payload, sender) {
  const ownerToken = String(payload?.ownerToken || '').trim();
  if (!ownerToken) throw new Error('sync.acquire requires ownerToken');
  const ttlMs = Math.max(10000, Math.min(120000, Number(payload?.ttlMs) || LEASE_DEFAULT_MS));
  const owner = senderLeaseOwner(sender, ownerToken);
  const key = leaseKey(scope);
  const now = Date.now();
  const leaseArea = leaseStorageArea();
  let current = await readLease(scope);
  const acquired = !current || Number(current.expiresAt) <= now || current.owner === owner;
  if (acquired) {
    let fence = normalizeRevision(current?.fence);
    if (!current || Number(current.expiresAt) <= now || current.owner !== owner) {
      const manifestValues = await storageGet('local', manifestKey(scope));
      const manifest = compactManifest(manifestValues[manifestKey(scope)]);
      fence = Math.max(fence, normalizeRevision(manifest?.leaseFence)) + 1;
    }
    current = { owner, ownerToken, fence: Math.max(1, fence), touchedAt: now, expiresAt: now + ttlMs };
    memoryLeases.set(key, current);
    await storageSet(leaseArea, { [key]: current });
  }
  return {
    acquired,
    fence: normalizeRevision(current?.fence),
    expiresAt: Math.max(0, Number(current?.expiresAt) || 0),
    retryAfterMs: acquired ? 0 : Math.max(0, Number(current?.expiresAt) - now)
  };
}

async function handleRepositoryMessage(message, sender) {
  const scope = normalizeScope(message.scope);
  const senderUrls = [sender?.url, sender?.tab?.url].filter(Boolean);
  const senderHost = senderUrls.map(value => {
    try { return new URL(value).hostname.toLowerCase(); } catch { return ''; }
  }).find(Boolean) || '';
  if (!senderHost || senderHost !== scope.portalHost) throw new Error('Catalog scope does not match sender origin');
  const payload = message.payload || {};
  const protocol = message.channel === REPOSITORY_CHANNEL_V2 ? REPOSITORY_SCHEMA : REPOSITORY_LEGACY_SCHEMA;
  const context = { sender, protocol };
  try {
    switch (message.command) {
      case 'catalog.get':
        return await serialForScope(scope, () => readCatalogUnlocked(scope, { migrateLegacy: true }));
      case 'catalog.commit':
        return await serialForScope(scope, () => commitCatalogUnlocked(scope, payload, context));
      case 'catalog.patch':
        return await serialForScope(scope, () => patchCatalogUnlocked(scope, payload, context));
      case 'sync.acquire':
        return await serialForScope(scope, () => acquireSync(scope, payload, sender));
      default:
        throw new Error(`Unknown dialog repository command: ${message.command || ''}`);
    }
  } catch (error) {
    if (error?.code) throw error;
    const retryable = ['catalog.get', 'catalog.commit', 'catalog.patch', 'sync.acquire'].includes(message.command);
    throw repositoryError(
      message.command === 'catalog.get' ? 'repository_read_failed' : 'repository_write_failed',
      String(error?.message || error),
      {},
      retryable
    );
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.channel === WORKER_HEALTH_CHANNEL) {
		sendResponse({
			ok: true,
			version: chrome.runtime.getManifest().version,
			entry: globalThis.__PENA_WORKER_ENTRY__ || 'legacy',
			build: globalThis.__PENA_WORKER_BUILD__ || 'legacy',
			protocol: globalThis.__PENA_WORKER_PROTOCOL__ || 'legacy',
			repositorySchema: REPOSITORY_SCHEMA
		});
		return false;
	}
  if (!message || ![REPOSITORY_CHANNEL_V1, REPOSITORY_CHANNEL_V2].includes(message.channel)) return false;
  handleRepositoryMessage(message, sender)
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({
      ok: false,
      error: String(error?.message || error),
      code: String(error?.code || 'repository_error'),
      retryable: error?.retryable === true,
      details: error?.details && typeof error.details === 'object' ? error.details : {}
    }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove([
    'pena.injected_cache',
    'pena.injected_ver',
    'anit_update_info',
    'pena.update_pending',
    'pena.update.info'
  ]);
});

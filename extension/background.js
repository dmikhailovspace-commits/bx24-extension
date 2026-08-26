// PENA Agency - background service worker

const REPOSITORY_CHANNEL = 'pena.dialog.repository.v1';
const REPOSITORY_SCHEMA = 1;
const REPOSITORY_CHUNK_SIZE = 250;
const REPOSITORY_PREFIX = 'pena.dialog.catalog.v1';
const LEASE_PREFIX = 'pena.dialog.sync-lease.v1';
const LEASE_DEFAULT_MS = 30000;
const PATCH_COMPACT_COUNT = 32;
const PATCH_COMPACT_RECORDS = 2000;

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

function compactGenerationDescriptor(manifest) {
  if (!manifest || !manifest.generation) return null;
  return {
    schema: REPOSITORY_SCHEMA,
    generation: String(manifest.generation),
    chunkCount: Math.max(0, Number(manifest.chunkCount) || 0),
    count: Math.max(0, Number(manifest.count) || 0),
    savedAt: Math.max(0, Number(manifest.savedAt) || 0),
    lastSuccessAt: Math.max(0, Number(manifest.lastSuccessAt) || 0),
    lastFullAt: Math.max(0, Number(manifest.lastFullAt) || 0),
    cursorAt: Math.max(0, Number(manifest.cursorAt) || 0),
    windowCount: Math.max(0, Number(manifest.windowCount) || 0),
    truncated: !!manifest.truncated,
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
  if (!manifest || Number(manifest.schema) !== REPOSITORY_SCHEMA) return null;
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
  if (Number.isFinite(Number(generationInfo.count)) && normalized.length !== Number(generationInfo.count)) return null;
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
    if (!patch || Number(patch.schema) !== REPOSITORY_SCHEMA || String(patch.generation || '') !== descriptor.generation) return null;
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

async function readCatalogUnlocked(scope) {
  const key = manifestKey(scope);
  const values = await storageGet('local', key);
  const manifest = compactManifest(values[key]);
  if (!manifest) return { records: [], manifest: null, recovered: false };

  const activeBase = await readGeneration(scope, manifest);
  const activeRecords = activeBase && await applyPatchesStrict(scope, activeBase, manifest.patches);
  if (activeRecords) return { records: activeRecords, manifest, recovered: false };

  if (manifest.previous) {
    const previousBase = await readGeneration(scope, manifest.previous);
    const previousRecords = previousBase && await applyPatchesStrict(scope, previousBase, manifest.previous.patches);
    if (previousRecords) {
      return {
        records: previousRecords,
        manifest: { ...manifest.previous, schema: REPOSITORY_SCHEMA, previous: null },
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
    generation: manifest.generation,
    chunkCount: manifest.chunkCount,
    count: manifest.count,
    savedAt: manifest.savedAt,
    lastSuccessAt: manifest.lastSuccessAt,
    lastFullAt: manifest.lastFullAt,
    cursorAt: manifest.cursorAt,
    windowCount: manifest.windowCount,
    truncated: manifest.truncated,
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

async function commitCatalogUnlocked(scope, payload = {}) {
  const records = normalizeRecords(payload.records);
  const key = manifestKey(scope);
  const currentSnapshot = await readCatalogUnlocked(scope);
  const current = currentSnapshot.manifest;
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
      count: currentSnapshot.records.length,
      patches: []
    };
  }
  const generation = newGeneration();
  const chunkCount = await writeChunks(scope, generation, records);
  stagedGenerations.push({ generation, chunkCount });
  const now = Date.now();
  const meta = payload.meta || {};
  const next = {
    schema: REPOSITORY_SCHEMA,
    generation,
    chunkCount,
    count: records.length,
    savedAt: now,
    lastSuccessAt: Math.max(0, Number(meta.lastSuccessAt) || now),
    lastFullAt: Math.max(0, Number(meta.lastFullAt) || now),
    cursorAt: Math.max(0, Number(meta.cursorAt) || Number(meta.lastSuccessAt) || now),
    windowCount: Math.max(0, Number(meta.windowCount) || records.length),
    truncated: !!meta.truncated,
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
  return { manifest: compactManifest(next), count: records.length };
}

async function patchCatalogUnlocked(scope, payload = {}) {
  const current = await readCatalogUnlocked(scope);
  if (current.corrupt) throw new Error('Dialog catalog is corrupt; full commit required');
  if (!current.manifest) return commitCatalogUnlocked(scope, payload);
  const records = normalizeRecords(payload.records);
  const deletedIds = Array.from(new Set((Array.isArray(payload.deletedIds) ? payload.deletedIds : [])
    .map(id => String(id || '').trim().toLowerCase()).filter(Boolean)));
  if (!records.length && !deletedIds.length) {
    return { manifest: current.manifest, count: current.records.length, patched: 0 };
  }

  const generation = newGeneration();
  const patch = { schema: REPOSITORY_SCHEMA, generation, records, deletedIds, savedAt: Date.now() };
  await storageSet('local', { [patchKey(scope, generation)]: patch });
  const meta = payload.meta || {};
  const next = {
    ...current.manifest,
    savedAt: patch.savedAt,
    lastSuccessAt: Math.max(Number(current.manifest.lastSuccessAt) || 0, Number(meta.lastSuccessAt) || 0),
    cursorAt: Math.max(Number(current.manifest.cursorAt) || 0, Number(meta.cursorAt) || Number(meta.lastSuccessAt) || 0),
    windowCount: Math.max(0, Number(meta.windowCount) || Number(current.manifest.windowCount) || current.records.length),
    truncated: meta.truncated === undefined ? !!current.manifest.truncated : !!meta.truncated,
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
    const merged = new Map(current.records.map(record => [record.id, record]));
    deletedIds.forEach(id => merged.delete(id));
    records.forEach(record => merged.set(record.id, record));
    return commitCatalogUnlocked(scope, {
      records: Array.from(merged.values()),
      meta: {
        lastSuccessAt: next.lastSuccessAt,
        lastFullAt: next.lastFullAt,
        cursorAt: next.cursorAt,
        windowCount: next.windowCount,
        truncated: next.truncated
      }
    });
  }
  return {
    manifest: compactManifest(next),
    count: current.records.length,
    patched: records.length,
    deleted: deletedIds.length
  };
}

async function acquireSync(scope, payload, sender) {
  const ownerToken = String(payload?.ownerToken || '').trim();
  if (!ownerToken) throw new Error('sync.acquire requires ownerToken');
  const ttlMs = Math.max(10000, Math.min(120000, Number(payload?.ttlMs) || LEASE_DEFAULT_MS));
  const owner = `${sender?.tab?.id ?? 'no-tab'}:${sender?.frameId ?? 0}:${ownerToken}`;
  const key = leaseKey(scope);
  const now = Date.now();
  const leaseArea = storageArea('session') ? 'session' : null;
  let current = memoryLeases.get(key) || null;
  if (leaseArea) {
    const values = await storageGet(leaseArea, key);
    current = values[key] || current;
  }
  const acquired = !current || Number(current.expiresAt) <= now || current.owner === owner;
  if (acquired) {
    current = { owner, ownerToken, touchedAt: now, expiresAt: now + ttlMs };
    memoryLeases.set(key, current);
    if (leaseArea) await storageSet(leaseArea, { [key]: current });
  }
  return {
    acquired,
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
  switch (message.command) {
    case 'catalog.get':
      return serialForScope(scope, () => readCatalogUnlocked(scope));
    case 'catalog.commit':
      return serialForScope(scope, () => commitCatalogUnlocked(scope, payload));
    case 'catalog.patch':
      return serialForScope(scope, () => patchCatalogUnlocked(scope, payload));
    case 'sync.acquire':
      return serialForScope(scope, () => acquireSync(scope, payload, sender));
    default:
      throw new Error(`Unknown dialog repository command: ${message.command || ''}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.channel !== REPOSITORY_CHANNEL) return false;
  handleRepositoryMessage(message, sender)
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
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

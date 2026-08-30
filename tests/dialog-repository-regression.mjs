import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const localData = {};
const sessionData = {};
let failManifestWrite = false;
let messageListener = null;

const clone = value => value === undefined ? undefined : structuredClone(value);
const makeStorage = data => ({
  get(keys, callback) {
    const list = keys == null ? Object.keys(data) : (Array.isArray(keys) ? keys : [keys]);
    callback(Object.fromEntries(list.filter(key => Object.prototype.hasOwnProperty.call(data, key)).map(key => [key, clone(data[key])])));
  },
  set(values, callback) {
    if (failManifestWrite && Object.keys(values).some(key => key.endsWith('.manifest'))) {
      context.chrome.runtime.lastError = { message: 'planned manifest failure' };
      callback();
      context.chrome.runtime.lastError = null;
      return;
    }
    Object.entries(values).forEach(([key, value]) => { data[key] = clone(value); });
    callback();
  },
  remove(keys, callback) {
    (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete data[key]; });
    callback?.();
  }
});

const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  Math,
  Date,
  Map,
  Promise,
  URL,
  encodeURIComponent,
  structuredClone,
  chrome: {
    storage: { local: makeStorage(localData), session: makeStorage(sessionData) },
    runtime: {
      lastError: null,
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    }
  }
});

const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
vm.runInContext(source, context, { filename: 'background.js' });
assert.equal(typeof messageListener, 'function', 'background did not register the repository listener');

const requestOnChannel = (channel, command, scope, payload = {}, sender = { tab: { id: 1 }, frameId: 0 }) => new Promise((resolve, reject) => {
  const scopedSender = { ...sender, url: sender.url || `https://${scope.portalHost}/desktop_app/` };
  const keepAlive = messageListener({ channel, command, scope, payload }, scopedSender, response => {
    if (response?.ok) resolve(response.result);
    else {
      const error = new Error(response?.error || 'repository request failed');
      error.code = response?.code || '';
      error.retryable = response?.retryable === true;
      error.details = response?.details || {};
      reject(error);
    }
  });
  assert.equal(keepAlive, true, `${command} did not keep the response channel alive`);
});
let compatibilityOperationSequence = 0;
const request = async (command, scope, payload = {}, sender) => {
  if (['catalog.commit', 'catalog.patch'].includes(command)) {
    const snapshot = await requestOnChannel('pena.dialog.repository.v2', 'catalog.get', scope, {}, sender);
    return requestOnChannel('pena.dialog.repository.v2', command, scope, {
      ...payload,
      baseRevision: Math.max(0, Number(snapshot?.manifest?.revision) || 0),
      operationId: `compatibility-test-${++compatibilityOperationSequence}`
    }, sender);
  }
  return requestOnChannel('pena.dialog.repository.v1', command, scope, payload, sender);
};
const requestV2 = (command, scope, payload = {}, sender) => requestOnChannel('pena.dialog.repository.v2', command, scope, payload, sender);

const scopeA = { portalHost: 'portal-a.example', userId: '101' };
const scopeB = { portalHost: 'portal-a.example', userId: '202' };
await assert.rejects(
  request('catalog.get', scopeA, {}, { tab: { id: 9 }, frameId: 0, url: 'https://evil.example/' }),
  /scope does not match sender origin/
);
const records = Array.from({ length: 620 }, (_, index) => ({
  id: `chat${index + 1}`,
  restDialogId: `chat${index + 1}`,
  mode: index % 7 === 0 ? 'tasks' : 'chats',
  title: `Dialog ${index + 1}`,
  avatar: { url: `https://cdn.example/avatar-${index + 1}.png` },
  lastMessage: { id: 1000 + index, text: `Message ${index + 1}`, date: 1700000000000 + index },
  author: { id: String((index % 15) + 1), name: `Author ${index % 15}` },
  unread: { count: index % 5 },
  task: {},
  remoteUpdatedAt: 1700000000000 + index
}));

const firstCommit = await request('catalog.commit', scopeA, {
  records,
  meta: {
    lastSuccessAt: 100,
    lastFullAt: 90,
    cursorAt: 100,
    apiWatermarkVersion: 1,
    apiCursorAt: 100,
    apiFullAt: 90,
    windowCount: 620,
    catalogVersion: 1,
    catalogModes: {
      chats: { complete: true, loadedAt: 80, count: 531 },
      tasks: { complete: true, loadedAt: 85, count: 89 }
    },
    taskCatalog: { complete: true, fetchedAt: 85 }
  }
});
assert.equal(firstCommit.count, 620);
assert.equal(firstCommit.manifest.chunkCount, 3, 'catalog was not chunked in groups of 250');
let snapshot = await request('catalog.get', scopeA);
assert.equal(snapshot.records.length, 620);
assert.equal(snapshot.records[619].title, 'Dialog 620');
assert.equal(snapshot.manifest.catalogVersion, 1, 'catalog cache contract version was not persisted');
assert.deepEqual(
  {
    version: snapshot.manifest.apiWatermarkVersion,
    cursor: snapshot.manifest.apiCursorAt,
    full: snapshot.manifest.apiFullAt
  },
  { version: 1, cursor: 100, full: 90 },
  'explicit API watermarks were not persisted'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(snapshot.manifest.catalogModes)),
  {
    chats: { complete: true, loadedAt: 80, count: 531 },
    tasks: { complete: true, loadedAt: 85, count: 89 }
  },
  'per-mode completeness was not persisted'
);
assert.deepEqual(
  JSON.parse(JSON.stringify(snapshot.manifest.taskCatalog)),
  { complete: true, fetchedAt: 85 },
  'task metadata freshness was not persisted'
);

await request('catalog.patch', scopeA, {
  records: [{ ...records[9], title: 'Patched dialog' }],
  deletedIds: ['chat11'],
  meta: { lastSuccessAt: 110, cursorAt: 110, taskCatalog: { complete: true, fetchedAt: 105 } }
});
snapshot = await request('catalog.get', scopeA);
assert.equal(snapshot.records.find(record => record.id === 'chat10')?.title, 'Patched dialog');
assert.equal(snapshot.records.some(record => record.id === 'chat11'), false);
assert.equal(snapshot.manifest.count, 619, 'manifest count did not reflect the patched catalog');
assert.equal(snapshot.manifest.baseCount, 620, 'base chunk count was not preserved separately');
assert.equal(snapshot.manifest.catalogModes.chats.loadedAt, 80, 'metadata patch erased mode completeness');
assert.equal(snapshot.manifest.taskCatalog.fetchedAt, 105, 'metadata patch did not advance task freshness');
assert.deepEqual(
  { cursor: snapshot.manifest.apiCursorAt, full: snapshot.manifest.apiFullAt },
  { cursor: 100, full: 90 },
  'a metadata/native patch without an API proof advanced API watermarks'
);

const nativeOnlyScope = { portalHost: 'portal-native-only.example', userId: '303' };
await request('catalog.commit', nativeOnlyScope, { records: [{ id: 'chat1', title: 'Native only' }] });
const nativeOnlySnapshot = await request('catalog.get', nativeOnlyScope);
assert.deepEqual(
  {
    lastSuccessAt: nativeOnlySnapshot.manifest.lastSuccessAt,
    lastFullAt: nativeOnlySnapshot.manifest.lastFullAt,
    cursorAt: nativeOnlySnapshot.manifest.cursorAt,
    apiWatermarkVersion: nativeOnlySnapshot.manifest.apiWatermarkVersion,
    apiCursorAt: nativeOnlySnapshot.manifest.apiCursorAt,
    apiFullAt: nativeOnlySnapshot.manifest.apiFullAt
  },
  { lastSuccessAt: 0, lastFullAt: 0, cursorAt: 0, apiWatermarkVersion: 0, apiCursorAt: 0, apiFullAt: 0 },
  'worker invented API freshness for a native-only commit'
);

const oldGeneration = snapshot.manifest.generation;
const keysBeforeInterruptedCommit = Object.keys(localData).sort();
failManifestWrite = true;
let interruptedError = null;
try {
  await request('catalog.commit', scopeA, { records: [{ id: 'chat999', title: 'Incomplete generation' }] });
} catch (error) {
  interruptedError = error;
}
assert.match(interruptedError?.message || '', /planned manifest failure/);
assert.equal(interruptedError?.code, 'repository_write_failed');
assert.equal(interruptedError?.retryable, true, 'storage failure was not reported as retryable');
failManifestWrite = false;
snapshot = await request('catalog.get', scopeA);
assert.equal(snapshot.manifest.generation, oldGeneration, 'interrupted commit replaced the active generation');
assert.equal(snapshot.records.length, 619, 'interrupted commit damaged the previous catalog');
assert.deepEqual(Object.keys(localData).sort(), keysBeforeInterruptedCommit, 'interrupted commit leaked staged chunks');

await request('catalog.commit', scopeB, { records: [{ id: 'user-b-only', title: 'Second user' }] });
const userA = await request('catalog.get', scopeA);
const userB = await request('catalog.get', scopeB);
assert.equal(userA.records.some(record => record.id === 'user-b-only'), false, 'catalog leaked across user scopes');
assert.equal(Array.from(userB.records, record => record.id).join(','), 'user-b-only');

const leaseA = await request('sync.acquire', scopeA, { ownerToken: 'owner-a', ttlMs: 30000 }, { tab: { id: 1 }, frameId: 0 });
const leaseB = await request('sync.acquire', scopeA, { ownerToken: 'owner-b', ttlMs: 30000 }, { tab: { id: 1 }, frameId: 1 });
const leaseARefresh = await request('sync.acquire', scopeA, { ownerToken: 'owner-a', ttlMs: 30000 }, { tab: { id: 1 }, frameId: 0 });
assert.equal(leaseA.acquired, true);
assert.equal(leaseB.acquired, false, 'a second frame acquired the same synchronization lease');
assert.equal(leaseARefresh.acquired, true, 'the current owner could not refresh its lease');

const raceScope = { portalHost: 'portal-race.example', userId: '303' };
const racedLeases = await Promise.all([
  request('sync.acquire', raceScope, { ownerToken: 'race-a', ttlMs: 30000 }, { tab: { id: 7 }, frameId: 0 }),
  request('sync.acquire', raceScope, { ownerToken: 'race-b', ttlMs: 30000 }, { tab: { id: 7 }, frameId: 1 })
]);
assert.equal(racedLeases.filter(lease => lease.acquired).length, 1, 'parallel frames both acquired the same lease');

const corruptScope = { portalHost: 'portal-corrupt.example', userId: '404' };
await request('catalog.commit', corruptScope, { records: [{ id: 'chat1', title: 'Before patch' }, { id: 'chat2', title: 'Delete me' }] });
await request('catalog.patch', corruptScope, { records: [{ id: 'chat1', title: 'After patch' }], deletedIds: ['chat2'] });
const corruptManifestKey = Object.keys(localData).find(key => key.includes('portal-corrupt.example') && key.endsWith('.manifest'));
const corruptPatchGeneration = localData[corruptManifestKey].patches[0].generation;
const corruptPatchKey = Object.keys(localData).find(key => key.includes('portal-corrupt.example') && key.endsWith(`.patch.${corruptPatchGeneration}`));
delete localData[corruptPatchKey];
const corruptSnapshot = await request('catalog.get', corruptScope);
assert.equal(corruptSnapshot.corrupt, true, 'missing patch was silently accepted');
await assert.rejects(
  request('catalog.patch', corruptScope, { records: [{ id: 'chat3', title: 'Must not replace catalog' }] }),
  /full commit required/
);

const recoveryScope = { portalHost: 'portal-recovery.example', userId: '505' };
await request('catalog.commit', recoveryScope, { records: [{ id: 'chat1', title: 'Base' }, { id: 'chat2', title: 'Remove' }] });
await request('catalog.patch', recoveryScope, { records: [{ id: 'chat1', title: 'Patched previous' }], deletedIds: ['chat2'] });
await request('catalog.commit', recoveryScope, { records: [{ id: 'chat9', title: 'Active' }] });
const recoveryManifestKey = Object.keys(localData).find(key => key.includes('portal-recovery.example') && key.endsWith('.manifest'));
const recoveryManifest = localData[recoveryManifestKey];
const activeChunkKey = Object.keys(localData).find(key => key.includes('portal-recovery.example') && key.includes(`.generation.${recoveryManifest.generation}.chunk.0`));
delete localData[activeChunkKey];
const recoveredSnapshot = await request('catalog.get', recoveryScope);
assert.equal(recoveredSnapshot.recovered, true, 'corrupt active generation did not recover the previous snapshot');
assert.equal(JSON.stringify(recoveredSnapshot.records.map(record => [record.id, record.title])), JSON.stringify([['chat1', 'Patched previous']]));
assert.equal(recoveredSnapshot.manifest.revision, recoveryManifest.revision, 'recovery moved the revision fence backwards');
const postRecoveryCommit = await requestV2('catalog.commit', recoveryScope, {
  records: recoveredSnapshot.records,
  baseRevision: recoveredSnapshot.manifest.revision,
  operationId: 'post-recovery-operation'
});
assert.equal(postRecoveryCommit.manifest.revision, recoveryManifest.revision + 1, 'post-recovery write did not advance the revision fence');

const v2Scope = { portalHost: 'portal-v2.example', userId: '606' };
const v2Initial = await requestV2('catalog.get', v2Scope);
assert.equal(v2Initial.manifest, null);
const v2CommitPayload = {
  records: [{ id: 'chat1', title: 'First v2 record' }],
  baseRevision: 0,
  operationId: 'operation-v2-commit-1'
};
const v2Commit = await requestV2('catalog.commit', v2Scope, v2CommitPayload);
assert.equal(v2Commit.manifest.schema, 2);
assert.equal(v2Commit.manifest.revision, 1);
assert.equal(v2Commit.manifest.baseRevision, 0);
assert.equal(v2Commit.manifest.operationId, 'operation-v2-commit-1');

const v2Generation = v2Commit.manifest.generation;
const v2KeysAfterCommit = Object.keys(localData).sort();
const v2Duplicate = await requestV2('catalog.commit', v2Scope, v2CommitPayload);
assert.equal(v2Duplicate.duplicate, true, 'operationId retry was not deduplicated');
assert.equal(v2Duplicate.manifest.revision, 1, 'idempotent retry advanced revision');
assert.equal(v2Duplicate.manifest.generation, v2Generation, 'idempotent retry published another generation');
assert.deepEqual(Object.keys(localData).sort(), v2KeysAfterCommit, 'idempotent retry changed storage');

let staleWriterError = null;
try {
  await requestV2('catalog.commit', v2Scope, {
    records: [{ id: 'stale-only', title: 'Must not win' }],
    baseRevision: 0,
    operationId: 'operation-v2-stale'
  });
} catch (error) {
  staleWriterError = error;
}
assert.equal(staleWriterError?.code, 'revision_conflict');
assert.equal(staleWriterError?.retryable, true);
assert.equal(staleWriterError?.details?.currentRevision, 1);
assert.equal((await requestV2('catalog.get', v2Scope)).records.map(record => record.id).join(','), 'chat1');

const v2Patch = await requestV2('catalog.patch', v2Scope, {
  records: [{ id: 'chat1', title: 'Patched in v2' }, { id: 'chat2', title: 'Added in v2' }],
  deletedIds: [],
  baseRevision: 1,
  operationId: 'operation-v2-patch-2'
});
assert.equal(v2Patch.manifest.revision, 2);
assert.equal(v2Patch.manifest.baseRevision, 1);
assert.equal(v2Patch.manifest.count, 2);
assert.equal(v2Patch.count, 2);

const replaceScope = { portalHost: 'portal-replace.example', userId: '616' };
const replaceBase = await requestV2('catalog.commit', replaceScope, {
  records: [{ id: 'keep', title: 'Keep' }, { id: 'remove', title: 'Remove' }],
  baseRevision: 0,
  operationId: 'replace-base'
});
const additiveCommit = await requestV2('catalog.commit', replaceScope, {
  records: [{ id: 'added', title: 'Added by incomplete response' }],
  baseRevision: replaceBase.manifest.revision,
  operationId: 'replace-additive'
});
assert.equal(additiveCommit.count, 3, 'unconfirmed commit removed records missing from a partial response');
const additiveSnapshot = await requestV2('catalog.get', replaceScope);
await assert.rejects(
  requestV2('catalog.commit', replaceScope, {
    records: [{ id: 'keep', title: 'Invalid weak replace' }],
    deletedIds: [],
    confirmedReplace: true,
    baseIds: additiveSnapshot.records.map(record => record.id),
    snapshotRevision: additiveSnapshot.manifest.revision,
    baseRevision: additiveSnapshot.manifest.revision,
    operationId: 'replace-invalid-tombstones'
  }),
  error => error?.code === 'invalid_tombstones'
);
const exactCommit = await requestV2('catalog.commit', replaceScope, {
  records: [{ id: 'keep', title: 'Keep exact' }],
  deletedIds: ['remove', 'added'],
  confirmedReplace: true,
  baseIds: additiveSnapshot.records.map(record => record.id),
  snapshotRevision: additiveSnapshot.manifest.revision,
  baseRevision: additiveSnapshot.manifest.revision,
  operationId: 'replace-exact'
});
assert.equal(exactCommit.count, 1, 'confirmed full snapshot was weakened to a union');
assert.equal(exactCommit.deleted, 2);
assert.equal((await requestV2('catalog.get', replaceScope)).records.map(record => record.id).join(','), 'keep');

const threeWayScope = { portalHost: 'portal-three-way.example', userId: '626' };
const threeWayBase = await requestV2('catalog.commit', threeWayScope, {
  records: [{ id: 'base-keep', title: 'Base keep' }, { id: 'base-remove', title: 'Base remove' }],
  baseRevision: 0,
  operationId: 'three-way-base'
});
const threeWayBaseSnapshot = await requestV2('catalog.get', threeWayScope);
const concurrentAdd = await requestV2('catalog.patch', threeWayScope, {
  records: [{ id: 'foreign-new', title: 'Concurrent new' }],
  deletedIds: [],
  baseRevision: threeWayBase.manifest.revision,
  operationId: 'three-way-concurrent-add'
});
const staleConfirmedPayload = {
  records: [{ id: 'base-keep', title: 'Confirmed keep' }],
  deletedIds: ['base-remove'],
  confirmedReplace: true,
  baseIds: threeWayBaseSnapshot.records.map(record => record.id),
  snapshotRevision: threeWayBaseSnapshot.manifest.revision,
  baseRevision: threeWayBaseSnapshot.manifest.revision,
  operationId: 'three-way-stale-confirmed'
};
await assert.rejects(
  requestV2('catalog.commit', threeWayScope, staleConfirmedPayload),
  error => error?.code === 'revision_conflict'
);
const threeWayCommit = await requestV2('catalog.commit', threeWayScope, {
  ...staleConfirmedPayload,
  baseRevision: concurrentAdd.manifest.revision
});
assert.equal(threeWayCommit.count, 2);
assert.equal(
  (await requestV2('catalog.get', threeWayScope)).records.map(record => record.id).sort().join(','),
  'base-keep,foreign-new',
  'stale confirmed snapshot deleted an ID created after its base snapshot'
);

const leaseScope = { portalHost: 'portal-fence.example', userId: '707' };
const leaseSenderA = { tab: { id: 11 }, frameId: 0 };
const leaseSenderB = { tab: { id: 11 }, frameId: 1 };
const fencedLeaseA = await requestV2('sync.acquire', leaseScope, { ownerToken: 'fence-owner-a', ttlMs: 30000 }, leaseSenderA);
assert.equal(fencedLeaseA.acquired, true);
assert.ok(fencedLeaseA.fence >= 1, 'lease did not return a fence');
const fencedCommitA = await requestV2('catalog.commit', leaseScope, {
  records: [{ id: 'chat-a', title: 'Owner A' }],
  baseRevision: 0,
  operationId: 'fenced-operation-a',
  leaseFence: fencedLeaseA.fence,
  leaseOwnerToken: 'fence-owner-a'
}, leaseSenderA);
assert.equal(fencedCommitA.manifest.leaseFence, fencedLeaseA.fence);

const persistedLeaseKey = Object.keys(sessionData).find(key => key.includes('portal-fence.example'));
sessionData[persistedLeaseKey].expiresAt = 0;
const fencedLeaseB = await requestV2('sync.acquire', leaseScope, { ownerToken: 'fence-owner-b', ttlMs: 30000 }, leaseSenderB);
assert.equal(fencedLeaseB.acquired, true);
assert.ok(fencedLeaseB.fence > fencedLeaseA.fence, 'new lease owner did not advance the fence');
let fencedWriterError = null;
try {
  await requestV2('catalog.patch', leaseScope, {
    records: [{ id: 'chat-stale', title: 'Stale owner' }],
    deletedIds: [],
    baseRevision: 1,
    operationId: 'fenced-operation-stale',
    leaseFence: fencedLeaseA.fence,
    leaseOwnerToken: 'fence-owner-a'
  }, leaseSenderA);
} catch (error) {
  fencedWriterError = error;
}
assert.equal(fencedWriterError?.code, 'lease_fenced');
const fencedCommitB = await requestV2('catalog.patch', leaseScope, {
  records: [{ id: 'chat-b', title: 'Owner B' }],
  deletedIds: [],
  baseRevision: 1,
  operationId: 'fenced-operation-b',
  leaseFence: fencedLeaseB.fence,
  leaseOwnerToken: 'fence-owner-b'
}, leaseSenderB);
assert.equal(fencedCommitB.manifest.revision, 2);
assert.equal(fencedCommitB.manifest.leaseFence, fencedLeaseB.fence);

let restartedMessageListener = null;
const restartStorage = data => ({
  get(keys, callback) {
    const list = keys == null ? Object.keys(data) : (Array.isArray(keys) ? keys : [keys]);
    callback(Object.fromEntries(list.filter(key => Object.prototype.hasOwnProperty.call(data, key)).map(key => [key, clone(data[key])])));
  },
  set(values, callback) {
    Object.entries(values).forEach(([key, value]) => { data[key] = clone(value); });
    callback();
  },
  remove(keys, callback) {
    (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete data[key]; });
    callback?.();
  }
});
const restartedContext = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  Math,
  Date,
  Map,
  Promise,
  URL,
  encodeURIComponent,
  structuredClone,
  chrome: {
    storage: { local: restartStorage(localData), session: restartStorage(sessionData) },
    runtime: {
      lastError: null,
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { restartedMessageListener = listener; } }
    }
  }
});
vm.runInContext(source, restartedContext, { filename: 'background-restarted.js' });
const requestAfterRestart = (command, scope, payload, sender) => new Promise((resolve, reject) => {
  restartedMessageListener({ channel: 'pena.dialog.repository.v2', command, scope, payload }, {
    ...sender,
    url: `https://${scope.portalHost}/desktop_app/`
  }, response => {
    if (response?.ok) resolve(response.result);
    else reject(Object.assign(new Error(response?.error || 'restart request failed'), response));
  });
});
const renewedAfterRestart = await requestAfterRestart(
  'sync.acquire',
  leaseScope,
  { ownerToken: 'fence-owner-b', ttlMs: 30000 },
  leaseSenderB
);
assert.equal(renewedAfterRestart.acquired, true);
assert.equal(renewedAfterRestart.fence, fencedLeaseB.fence, 'worker restart reset the active lease fence');
const snapshotAfterRestart = await requestAfterRestart('catalog.get', leaseScope, {}, leaseSenderB);
assert.equal(snapshotAfterRestart.manifest.revision, 2, 'worker restart lost the published repository revision');

const legacyScope = { portalHost: 'portal-legacy.example', userId: '808' };
const legacyRoot = `pena.dialog.catalog.v1.${encodeURIComponent(legacyScope.portalHost)}~${encodeURIComponent(legacyScope.userId)}`;
const legacyGeneration = 'legacy-generation';
const legacyPatchGeneration = 'legacy-patch';
localData[`${legacyRoot}.generation.${legacyGeneration}.chunk.0`] = [{ id: 'chat1', title: 'Legacy base' }];
localData[`${legacyRoot}.patch.${legacyPatchGeneration}`] = {
  schema: 1,
  generation: legacyPatchGeneration,
  records: [{ id: 'chat1', title: 'Legacy patched' }],
  deletedIds: [],
  savedAt: 10
};
localData[`${legacyRoot}.manifest`] = {
  schema: 1,
  generation: legacyGeneration,
  chunkCount: 1,
  count: 1,
  savedAt: 10,
  patches: [{ generation: legacyPatchGeneration, count: 1, deletedCount: 0, savedAt: 10 }]
};
const migratedLegacy = await requestV2('catalog.get', legacyScope);
assert.equal(migratedLegacy.records[0].title, 'Legacy patched', 'v1 patches were not read during migration');
assert.equal(migratedLegacy.manifest.schema, 2);
assert.equal(migratedLegacy.manifest.revision, 1);
assert.match(migratedLegacy.manifest.operationId, /^migration-v1:/);
assert.equal(localData[`${legacyRoot}.manifest`].schema, 2, 'v1 manifest was not migrated in place');
let legacyWriterError = null;
try {
  await requestOnChannel('pena.dialog.repository.v1', 'catalog.commit', legacyScope, {
    records: [{ id: 'stale-tab', title: 'Must not overwrite migrated catalog' }]
  });
} catch (error) {
  legacyWriterError = error;
}
assert.equal(legacyWriterError?.code, 'protocol_upgrade_required', 'stale v1 writer was allowed to overwrite a v2 catalog');
assert.equal((await requestV2('catalog.get', legacyScope)).records[0].id, 'chat1');

const bridgeSource = await readFile(new URL('../extension/dialog-repository.js', import.meta.url), 'utf8');
const bridgeServer = {
  records: [],
  revision: 0,
  manifest: null,
  operations: new Map(),
  requests: [],
  dropFirstCommittedResponse: true,
  handle(request, respond, signalReconnect) {
    this.requests.push(structuredClone(request));
    if (request.command === 'catalog.get') {
      respond({ ok: true, result: { records: structuredClone(this.records), manifest: structuredClone(this.manifest), recovered: false } });
      return;
    }
    if (request.command !== 'catalog.commit') {
      respond({ ok: false, error: 'Unsupported client test command', code: 'unsupported' });
      return;
    }
    const payload = request.payload || {};
    const duplicate = this.operations.get(payload.operationId);
    if (duplicate) {
      respond({ ok: true, result: { ...structuredClone(duplicate), duplicate: true } });
      return;
    }
    if (Number(payload.baseRevision) !== this.revision) {
      respond({
        ok: false,
        error: 'Dialog catalog revision conflict',
        code: 'revision_conflict',
        retryable: true,
        details: { currentRevision: this.revision }
      });
      return;
    }
    const byId = new Map(this.records.map(record => [String(record.id || '').toLowerCase(), structuredClone(record)]));
    if (payload.confirmedReplace === true) {
      (payload.deletedIds || []).forEach(id => byId.delete(String(id || '').toLowerCase()));
    }
    (payload.records || []).forEach(record => byId.set(String(record.id || '').toLowerCase(), structuredClone(record)));
    this.records = Array.from(byId.values());
    const baseRevision = this.revision;
    this.revision += 1;
    this.manifest = {
      ...(payload.meta || {}),
      schema: 2,
      revision: this.revision,
      baseRevision,
      operationId: payload.operationId,
      savedAt: Date.now()
    };
    const result = { manifest: structuredClone(this.manifest), count: this.records.length, operationRevision: this.revision };
    this.operations.set(payload.operationId, structuredClone(result));
    if (this.dropFirstCommittedResponse) {
      this.dropFirstCommittedResponse = false;
      respond({
        ok: false,
        error: 'Service worker restarted after commit',
        code: 'repository_unavailable',
        retryable: true,
        details: {}
      });
      setTimeout(signalReconnect, 0);
      return;
    }
    respond({ ok: true, result });
  }
};

function createBridgeClient() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const add = (map, type, listener) => map.set(type, [...(map.get(type) || []), listener]);
  const dispatch = (map, event) => {
    (map.get(event.type) || []).slice().forEach(listener => listener(event));
    return true;
  };
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const document = {
    visibilityState: 'visible',
    addEventListener(type, listener) { add(documentListeners, type, listener); },
    dispatchEvent(event) { return dispatch(documentListeners, event); }
  };
  const window = {
    document,
    addEventListener(type, listener) { add(windowListeners, type, listener); },
    dispatchEvent(event) { return dispatch(windowListeners, event); }
  };
  window.window = window;
  document.addEventListener('pena-dialog-repository-request', event => {
    const request = JSON.parse(String(event.detail || ''));
    const respond = response => queueMicrotask(() => document.dispatchEvent(new CustomEvent('pena-dialog-repository-response', {
      detail: JSON.stringify({ requestId: request.requestId, ...response })
    })));
    bridgeServer.handle(request, respond, () => document.dispatchEvent(new CustomEvent('pena-dialog-repository-connection')));
  });
  const bridgeContext = vm.createContext({
    window,
    document,
    CustomEvent,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Date,
    Math,
    Map,
    Set,
    Promise,
    JSON
  });
  vm.runInContext(bridgeSource, bridgeContext, { filename: 'dialog-repository.js' });
  return {
    repository: window.__PENA_DIALOG_REPOSITORY__,
    dispatchChanged(change) {
      document.dispatchEvent(new CustomEvent('pena-dialog-repository-changed', { detail: JSON.stringify(change) }));
    }
  };
}

const bridgeScope = { portalHost: 'portal-bridge.example', userId: '909' };
const bridgeA = createBridgeClient();
const bridgeB = createBridgeClient();
await Promise.all([bridgeA.repository.get(bridgeScope), bridgeB.repository.get(bridgeScope)]);
const bridgeCommitA = await bridgeA.repository.commit(
  bridgeScope,
  [{ id: 'chat-a', title: 'From A' }],
  {},
  { operationId: 'bridge-operation-a' }
);
assert.equal(bridgeCommitA.manifest.revision, 1);
const bridgeOperationARequests = bridgeServer.requests.filter(request => request.payload?.operationId === 'bridge-operation-a');
assert.equal(bridgeOperationARequests.length, 2, 'retryable worker disconnect did not retry the pending write');
assert.equal(new Set(bridgeOperationARequests.map(request => request.payload.operationId)).size, 1, 'write retry changed operationId');

const bridgeCommitB = await bridgeB.repository.commit(
  bridgeScope,
  [{ id: 'chat-b', title: 'From B' }],
  {},
  { operationId: 'bridge-operation-b' }
);
assert.equal(bridgeCommitB.manifest.revision, 2);
assert.equal(bridgeServer.records.map(record => record.id).sort().join(','), 'chat-a,chat-b', 'stale bridge commit did not get, merge and retry');
const bridgeOperationBRequests = bridgeServer.requests.filter(request => request.payload?.operationId === 'bridge-operation-b');
assert.equal(bridgeOperationBRequests.length, 2, 'stale bridge writer did not retry after conflict');
assert.deepEqual(bridgeOperationBRequests.map(request => Number(request.payload.baseRevision)), [0, 1]);

const bridgeC = createBridgeClient();
const bridgeD = createBridgeClient();
await Promise.all([bridgeC.repository.get(bridgeScope), bridgeD.repository.get(bridgeScope)]);
await bridgeD.repository.commit(
  bridgeScope,
  [{ id: 'foreign-new', title: 'Created after C base' }],
  {},
  { operationId: 'bridge-operation-foreign' }
);
const bridgeConfirmed = await bridgeC.repository.commit(
  bridgeScope,
  [{ id: 'chat-a', title: 'Exact from C' }],
  {},
  { operationId: 'bridge-operation-confirmed', confirmedReplace: true }
);
assert.equal(bridgeConfirmed.manifest.revision, 4);
assert.equal(
  bridgeServer.records.map(record => record.id).sort().join(','),
  'chat-a,foreign-new',
  'three-way bridge merge weakened exact tombstones or deleted a concurrent addition'
);
const bridgeConfirmedRequests = bridgeServer.requests.filter(request => request.payload?.operationId === 'bridge-operation-confirmed');
assert.deepEqual(bridgeConfirmedRequests.map(request => Number(request.payload.baseRevision)), [2, 3]);
assert.deepEqual(bridgeConfirmedRequests.map(request => Number(request.payload.snapshotRevision)), [2, 2]);
assert.equal(bridgeConfirmedRequests[1].payload.deletedIds.join(','), 'chat-b');

const bridgeSeedDelete = createBridgeClient();
await bridgeSeedDelete.repository.get(bridgeScope);
await bridgeSeedDelete.repository.commit(
  bridgeScope,
  [...bridgeServer.records, { id: 'race-delete', title: 'Delete base', remoteUpdatedAt: 100 }],
  {},
  { operationId: 'bridge-operation-delete-seed', confirmedReplace: true }
);
const bridgeDeleteStale = createBridgeClient();
const bridgeDeleteWinner = createBridgeClient();
const [deleteStaleBase, deleteWinnerBase] = await Promise.all([
  bridgeDeleteStale.repository.get(bridgeScope),
  bridgeDeleteWinner.repository.get(bridgeScope)
]);
await bridgeDeleteWinner.repository.commit(
  bridgeScope,
  deleteWinnerBase.records.filter(record => record.id !== 'race-delete'),
  {},
  { operationId: 'bridge-operation-concurrent-delete', confirmedReplace: true }
);
await bridgeDeleteStale.repository.commit(
  bridgeScope,
  deleteStaleBase.records,
  {},
  { operationId: 'bridge-operation-stale-after-delete', confirmedReplace: true }
);
assert.equal(
  bridgeServer.records.some(record => record.id === 'race-delete'),
  false,
  'unchanged stale intent resurrected a concurrently deleted record'
);
const staleAfterDeleteRequests = bridgeServer.requests
  .filter(request => request.payload?.operationId === 'bridge-operation-stale-after-delete');
assert.equal(staleAfterDeleteRequests.length, 2, 'concurrent delete did not exercise CAS rebase');
assert.equal(
  staleAfterDeleteRequests[1].payload.deletedIds.includes('race-delete'),
  true,
  'rebased confirmed payload did not preserve the concurrent tombstone against its immutable base'
);

const bridgeSameSeed = createBridgeClient();
await bridgeSameSeed.repository.get(bridgeScope);
await bridgeSameSeed.repository.commit(
  bridgeScope,
  [{ id: 'race-same', title: 'Same-ID base', remoteUpdatedAt: 300 }],
  {},
  { operationId: 'bridge-operation-same-seed' }
);
const bridgeSameStale = createBridgeClient();
const bridgeSameWinner = createBridgeClient();
const [sameStaleBase] = await Promise.all([
  bridgeSameStale.repository.get(bridgeScope),
  bridgeSameWinner.repository.get(bridgeScope)
]);
await bridgeSameWinner.repository.commit(
  bridgeScope,
  [{ id: 'race-same', title: 'Same-ID newer', remoteUpdatedAt: 700 }],
  {},
  { operationId: 'bridge-operation-same-newer' }
);
await bridgeSameStale.repository.commit(
  bridgeScope,
  sameStaleBase.records.map(record => record.id === 'race-same'
    ? { ...record, title: 'Same-ID stale local', remoteUpdatedAt: 500 }
    : record),
  {},
  { operationId: 'bridge-operation-same-stale', confirmedReplace: true }
);
assert.equal(
  bridgeServer.records.find(record => record.id === 'race-same')?.title,
  'Same-ID newer',
  'stale explicit same-ID change overwrote a fresher concurrent update'
);
const sameStaleRequests = bridgeServer.requests
  .filter(request => request.payload?.operationId === 'bridge-operation-same-stale');
assert.equal(sameStaleRequests.length, 2, 'same-ID freshness scenario did not exercise CAS rebase');
assert.equal(
  sameStaleRequests[1].payload.records.find(record => record.id === 'race-same')?.remoteUpdatedAt,
  700,
  'rebased confirmed payload did not carry the fresher concurrent record'
);

const bridgeDeleteVsUpdate = createBridgeClient();
const bridgeUpdateVsDelete = createBridgeClient();
const [deleteVsUpdateBase] = await Promise.all([
  bridgeDeleteVsUpdate.repository.get(bridgeScope),
  bridgeUpdateVsDelete.repository.get(bridgeScope)
]);
await bridgeUpdateVsDelete.repository.commit(
  bridgeScope,
  [{ id: 'race-same', title: 'Same-ID newest', remoteUpdatedAt: 900 }],
  {},
  { operationId: 'bridge-operation-update-before-delete' }
);
await bridgeDeleteVsUpdate.repository.commit(
  bridgeScope,
  deleteVsUpdateBase.records.filter(record => record.id !== 'race-same'),
  {
    // Legacy API timestamps were polluted by native commits in old builds and
    // cannot authorize a tombstone without the explicit watermark marker.
    lastSuccessAt: Number.MAX_SAFE_INTEGER,
    lastFullAt: Number.MAX_SAFE_INTEGER,
    cursorAt: Number.MAX_SAFE_INTEGER,
    catalogModes: { chats: { complete: true, loadedAt: Number.MAX_SAFE_INTEGER } },
    taskCatalog: { complete: true, fetchedAt: Number.MAX_SAFE_INTEGER }
  },
  { operationId: 'bridge-operation-delete-vs-newer', confirmedReplace: true }
);
assert.equal(
  bridgeServer.records.find(record => record.id === 'race-same')?.remoteUpdatedAt,
  900,
  'confirmed delete from an older proof removed a fresher concurrent same-ID update'
);
const deleteVsNewerRequests = bridgeServer.requests
  .filter(request => request.payload?.operationId === 'bridge-operation-delete-vs-newer');
assert.equal(deleteVsNewerRequests.length, 2, 'delete-vs-update scenario did not exercise CAS rebase');
assert.equal(
  deleteVsNewerRequests[1].payload.deletedIds.includes('race-same'),
  false,
  'rebased tombstones still targeted a fresher concurrent same-ID update'
);
delete bridgeServer.manifest.catalogModes;
delete bridgeServer.manifest.taskCatalog;
delete bridgeServer.manifest.lastSuccessAt;
delete bridgeServer.manifest.lastFullAt;
delete bridgeServer.manifest.cursorAt;

const bridgeFullDelete = createBridgeClient();
const bridgeBeforeFullDeleteUpdate = createBridgeClient();
const [fullDeleteBase] = await Promise.all([
  bridgeFullDelete.repository.get(bridgeScope),
  bridgeBeforeFullDeleteUpdate.repository.get(bridgeScope)
]);
await bridgeBeforeFullDeleteUpdate.repository.commit(
  bridgeScope,
  [{ id: 'race-same', title: 'Same-ID after full base', remoteUpdatedAt: 1000 }],
  {},
  { operationId: 'bridge-operation-update-before-full-delete' }
);
await bridgeFullDelete.repository.commit(
  bridgeScope,
  fullDeleteBase.records.filter(record => record.id !== 'race-same'),
  { apiWatermarkVersion: 1, apiCursorAt: 5000, apiFullAt: 1100 },
  { operationId: 'bridge-operation-newer-full-delete', confirmedReplace: true }
);
assert.equal(
  bridgeServer.records.some(record => record.id === 'race-same'),
  false,
  'newer versioned full-audit proof did not authorize its same-ID tombstone'
);

const bridgeMetaStale = createBridgeClient();
const bridgeMetaLatest = createBridgeClient();
await Promise.all([
  bridgeMetaStale.repository.get(bridgeScope),
  bridgeMetaLatest.repository.get(bridgeScope)
]);
await bridgeMetaLatest.repository.commit(
  bridgeScope,
  [],
  { catalogModes: { chats: { complete: true, loadedAt: 4242, count: 2, confirmedIds: ['chat-a', 'foreign-new'] } } },
  { operationId: 'bridge-operation-meta-latest' }
);
await bridgeMetaStale.repository.commit(
  bridgeScope,
  [],
  { catalogModes: { chats: { complete: true, loadedAt: 4242, count: 2, confirmedIds: ['chat-a', 'stale-id'] } } },
  { operationId: 'bridge-operation-meta-stale' }
);
const metaStaleRequests = bridgeServer.requests
  .filter(request => request.payload?.operationId === 'bridge-operation-meta-stale');
assert.equal(metaStaleRequests.length, 2, 'same-millisecond catalog metadata did not exercise CAS rebase');
assert.deepEqual(
  metaStaleRequests[1].payload.meta.catalogModes.chats.confirmedIds,
  ['chat-a', 'foreign-new'],
  'same-millisecond stale confirmedIds replaced the latest committed set'
);

let observedChange = null;
const unsubscribe = bridgeB.repository.subscribe(change => { observedChange = change; });
bridgeB.dispatchChanged({ scope: bridgeScope, revision: 3, operationId: 'external-operation' });
unsubscribe();
assert.equal(observedChange?.operationId, 'external-operation', 'repository change notification was not exposed to the page client');

const contentSource = await readFile(new URL('../extension/content.js', import.meta.url), 'utf8');
const contentDocumentListeners = new Map();
const contentStorageListeners = [];
const contentEvents = [];
let forwardedRepositoryMessage = null;
const addContentListener = (type, listener) => contentDocumentListeners.set(type, [...(contentDocumentListeners.get(type) || []), listener]);
class ContentCustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}
const contentRoot = {
  dataset: {},
  appendChild(script) { queueMicrotask(() => script.onload?.()); }
};
const contentDocument = {
  documentElement: contentRoot,
  head: null,
  body: null,
  addEventListener: addContentListener,
  removeEventListener() {},
  dispatchEvent(event) {
    contentEvents.push(event);
    (contentDocumentListeners.get(event.type) || []).slice().forEach(listener => listener(event));
    return true;
  },
  createElement() { return { dataset: {}, remove() {} }; }
};
const contentLocation = { pathname: '/desktop_app/', hostname: 'portal-content.example', reload() {} };
const contentWindow = { location: contentLocation };
contentWindow.window = contentWindow;
contentWindow.top = contentWindow;
const contentRuntime = {
  lastError: null,
  getURL: path => `chrome-extension://pena/${path}`,
  getManifest: () => ({ version: 'test' }),
  sendMessage(message, callback) {
    forwardedRepositoryMessage = structuredClone(message);
    this.lastError = { message: 'planned worker restart' };
    callback();
    this.lastError = null;
  }
};
const contentContext = vm.createContext({
  chrome: {
    runtime: contentRuntime,
    storage: {
      local: {
        get(_keys, callback) { callback({ 'pena.extension.enabled': '1' }); },
        set(_values, callback) { callback?.(); }
      },
      onChanged: { addListener(listener) { contentStorageListeners.push(listener); } }
    }
  },
  document: contentDocument,
  location: contentLocation,
  window: contentWindow,
  self: contentWindow,
  top: contentWindow,
  CustomEvent: ContentCustomEvent,
  MutationObserver: class { observe() {} disconnect() {} },
  fetch: async () => ({ ok: true, json: async () => ({ version: 'test' }) }),
  setTimeout,
  clearTimeout,
  queueMicrotask,
  console,
  Date,
  JSON,
  decodeURIComponent,
  encodeURIComponent
});
vm.runInContext(contentSource, contentContext, { filename: 'content.js' });
await new Promise(resolve => setTimeout(resolve, 0));
contentDocument.dispatchEvent(new ContentCustomEvent('pena-dialog-repository-request', {
  detail: JSON.stringify({
    requestId: 'content-request-1',
    command: 'catalog.get',
    scope: { portalHost: 'portal-content.example', userId: '101' },
    payload: {}
  })
}));
const contentResponse = contentEvents
  .filter(event => event.type === 'pena-dialog-repository-response')
  .map(event => JSON.parse(String(event.detail || '')))
  .find(response => response.requestId === 'content-request-1');
assert.equal(forwardedRepositoryMessage?.channel, 'pena.dialog.repository.v2');
assert.equal(contentResponse?.code, 'repository_unavailable');
assert.equal(contentResponse?.retryable, true, 'content bridge made a worker restart terminal');

contentStorageListeners.forEach(listener => listener({
  'pena.dialog.catalog.v1.portal-content.example~101.manifest': {
    newValue: { schema: 2, revision: 7, operationId: 'storage-operation', savedAt: 123 }
  }
}, 'local'));
await new Promise(resolve => setTimeout(resolve, 0));
const contentChanged = contentEvents
  .filter(event => event.type === 'pena-dialog-repository-changed')
  .map(event => JSON.parse(String(event.detail || '')))
  .find(change => change.operationId === 'storage-operation');
assert.equal(contentChanged?.scope?.portalHost, 'portal-content.example');
assert.equal(contentChanged?.revision, 7, 'content bridge did not publish the storage revision');

console.log('PASS dialog repository v2: CAS, idempotency, fence, confirmed tombstones, reconnect and three-way merge');

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

const request = (command, scope, payload = {}, sender = { tab: { id: 1 }, frameId: 0 }) => new Promise((resolve, reject) => {
  const scopedSender = { ...sender, url: sender.url || `https://${scope.portalHost}/desktop_app/` };
  const keepAlive = messageListener({ channel: 'pena.dialog.repository.v1', command, scope, payload }, scopedSender, response => {
    if (response?.ok) resolve(response.result);
    else reject(new Error(response?.error || 'repository request failed'));
  });
  assert.equal(keepAlive, true, `${command} did not keep the response channel alive`);
});

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
  meta: { lastSuccessAt: 100, lastFullAt: 90, cursorAt: 100, windowCount: 620 }
});
assert.equal(firstCommit.count, 620);
assert.equal(firstCommit.manifest.chunkCount, 3, 'catalog was not chunked in groups of 250');
let snapshot = await request('catalog.get', scopeA);
assert.equal(snapshot.records.length, 620);
assert.equal(snapshot.records[619].title, 'Dialog 620');

await request('catalog.patch', scopeA, {
  records: [{ ...records[9], title: 'Patched dialog' }],
  deletedIds: ['chat11'],
  meta: { lastSuccessAt: 110, cursorAt: 110 }
});
snapshot = await request('catalog.get', scopeA);
assert.equal(snapshot.records.find(record => record.id === 'chat10')?.title, 'Patched dialog');
assert.equal(snapshot.records.some(record => record.id === 'chat11'), false);

const oldGeneration = snapshot.manifest.generation;
const keysBeforeInterruptedCommit = Object.keys(localData).sort();
failManifestWrite = true;
await assert.rejects(
  request('catalog.commit', scopeA, { records: [{ id: 'chat999', title: 'Incomplete generation' }] }),
  /planned manifest failure/
);
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

console.log('PASS dialog repository: chunks, atomic commit, patch, user scope and single sync owner');

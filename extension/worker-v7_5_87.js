// Release-specific MV3 entrypoint. Bitrix Desktop can retain the registered
// worker URL across unpacked-extension updates, so every release gets a new
// entry filename and an independently verifiable build/protocol marker.
const PENA_WORKER_ENTRY = 'worker-v7_5_87.js';
const PENA_WORKER_BUILD = '7.5.87';
const PENA_WORKER_PROTOCOL = 'dialog-repository-v2';
const manifestVersion = chrome.runtime.getManifest().version;

globalThis.__PENA_WORKER_ENTRY__ = PENA_WORKER_ENTRY;
globalThis.__PENA_WORKER_BUILD__ = PENA_WORKER_BUILD;
globalThis.__PENA_WORKER_PROTOCOL__ = PENA_WORKER_PROTOCOL;

importScripts(
  `background.js?release=${encodeURIComponent(manifestVersion)}` +
  `&workerBuild=${encodeURIComponent(PENA_WORKER_BUILD)}` +
  `&protocol=${encodeURIComponent(PENA_WORKER_PROTOCOL)}`
);

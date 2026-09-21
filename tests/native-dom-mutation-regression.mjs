import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { startHarnessServer, collectPageErrors } from './lib/harness-server.mjs';
import { checkNativeAvatarTransitions, checkNativeImageRing } from './lib/native-avatar-transitions.mjs';

const sourcePath = process.env.PENA_DOM_AUDIT_SOURCE || new URL('../extension/injected.js', import.meta.url);
const raw = readFileSync(sourcePath, 'utf8');
const anchor = '\tasync function boot() {';
assert.equal(raw.split(anchor).length - 1, 1, 'DOM regression instrumentation anchor changed');
const source = raw.replace(anchor, `${anchor}
		window.__PENA_DOM_AUDIT__ = {
			eventRowContracts() {
				const originalFind = findContainer;
				const originalManaged = _dialogControlManagedRoot;
				const originalSource = _dialogControlManagedSource;
				const originalContext = window.__PENA_ACTIVE_LIST_CONTEXT__;
				const originalSelection = _dialogControlMultiSelected;
				const originalAnchor = _dialogControlMultiSelectionAnchorId;
				const host = document.createElement('div');
				host.innerHTML = '<div class="bx-im-list-container-task__elements"><div class="bx-im-list-recent-item__wrap" data-id="chat901"><svg><circle></circle></svg><span>text</span></div><div class="bx-im-custom-row" data-id="chat902" style="width:200px;height:40px">generic</div><div class="bx-im-search-result-item" data-dialog-id="chat903">search</div></div><div class="pena-native-managed-list"><div class="bx-im-list-recent-item__wrap" data-id="chat904">managed</div></div><button>outside</button>';
				document.body.append(host);
				const native = host.firstElementChild;
				const managed = host.children[1];
				let reads = 0;
				findContainer = () => { reads++; return native; };
				_dialogControlManagedRoot = managed;
				_dialogControlManagedSource = native;
				window.__PENA_ACTIVE_LIST_CONTEXT__ = null;
				try {
					const svg = _getDialogControlNativeEventRow(native.querySelector('circle')) === native.children[0];
					const text = _getDialogControlNativeEventRow(native.querySelector('span').firstChild) === native.children[0];
					const generic = _getDialogControlNativeEventRow(native.children[1]) === native.children[1];
					const lateSearch = _getDialogControlNativeEventRow(native.children[2]) === native.children[2];
					const managedRow = _getDialogControlNativeEventRow(managed.firstElementChild) === managed.firstElementChild;
					const before = reads;
					const outside = _getDialogControlNativeEventRow(host.lastElementChild) === null;
					const outsideDiscovery = reads - before;
					_dialogControlMultiSelected = new Set(['chat901']);
					_dialogControlMultiSelectionAnchorId = 'chat901';
					const targetRow = _getDialogControlNativeEventRow(native.children[1].firstChild);
					const range = !!targetRow && _selectDialogControlMultiSelectionRange(targetRow.dataset.id, [{id:'chat901'}, {id:'chat902'}, {id:'chat903'}]) && _dialogControlMultiSelected.has('chat901') && _dialogControlMultiSelected.has('chat902') && !_dialogControlMultiSelected.has('chat903');
					return { svg, text, generic, lateSearch, managedRow, outside, outsideDiscovery, range };
				} finally {
					findContainer = originalFind;
					_dialogControlManagedRoot = originalManaged;
					_dialogControlManagedSource = originalSource;
					window.__PENA_ACTIVE_LIST_CONTEXT__ = originalContext;
					_dialogControlMultiSelected = originalSelection;
					_dialogControlMultiSelectionAnchorId = originalAnchor;
					host.remove();
				}
			},
			repaint() { _dialogControlNativeViewSig = ''; _applyDialogControlNativeView(findContainer(), { forceShow: true }); },
			repairLayers(row, host) { _syncDialogControlNativeAvatarLayers(row, host); },
			colorAvatar(row, color) { _ensureDialogControlNativeColorLabel(row, color); },
			syncStableTracker() {
				const originalRead = _readDialogTimeTracker;
				_readDialogTimeTracker = () => ({ taskId: '123', pendingSeconds: 60 });
				try { _syncDialogTimeUi(document.querySelector('.pena-native-folder-switcher')); }
				finally { _readDialogTimeTracker = originalRead; }
			},
			nativeRowReads: 0,
			eventRowDiscoveryReads: 0,
			scans: 0
		};
		const originalRows = _getDialogControlNativeRows;
		const originalEventRow = _getDialogControlNativeEventRow;
		_getDialogControlNativeEventRow = function(...args) {
			const originalFind = findContainer;
			findContainer = function(...findArgs) { window.__PENA_DOM_AUDIT__.eventRowDiscoveryReads++; return originalFind.apply(this, findArgs); };
			try { return originalEventRow.apply(this, args); }
			finally { findContainer = originalFind; }
		};
		_getDialogControlNativeRows = function(...args) { window.__PENA_DOM_AUDIT__.nativeRowReads++; return originalRows.apply(this, args); };
		const originalResolve = _resolveNativeLifecycleCandidates;
		_resolveNativeLifecycleCandidates = function(...args) { window.__PENA_DOM_AUDIT__.scans++; return originalResolve.apply(this, args); };
`).replace('\t\t\tconst knownRouteLists = new Set(document.querySelectorAll(routeListSelector));',
 '\t\t\tconst knownRouteLists = new Set(document.querySelectorAll(routeListSelector));\nwindow.__PENA_DOM_AUDIT__.knownRouteListCount = () => knownRouteLists.size;\nwindow.__PENA_DOM_AUDIT__.hasRouteList = list => knownRouteLists.has(list);');
const server = await startHarnessServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = collectPageErrors(page);
let result;
try {
 await page.route(/\/extension\/injected\.js(?:\?.*)?$/, route => route.fulfill({ status: 200, contentType: 'application/javascript', body: source }));
 const url = new URL('/tests/native-consistency-harness.html', server.baseUrl);
 url.search = new URLSearchParams({ mode: 'chats', nativeCatalog: '1', nativeFirst: '1', passThrough: '1', repositoryCache: '1', repositoryFullProof: '1', repositoryProofCount: '1000', catalogRows: '997', lazy: '1', lazyChunk: '997', startupBudget: '12000', headTtl: '60000', taskTtl: '900000', auditTtl: '86400000' });
 await page.goto(url.href);
 await page.waitForFunction(() => {
  const status = window.__PENA_NATIVE_PREFETCH__?.status?.();
  return window.__PENA_RECENT_SYNC__?.nativeUsable && status && !status.originalActive && !status.apiActive && !status.modeLoadPending && !status.reconcile?.active;
 }, null, { timeout: 30000 });
 await page.waitForTimeout(1500);
 result = await page.evaluate(async () => {
  const source = window.__PENA_ACTIVE_LIST_CONTEXT__.list;
  const viewport = window.__PENA_ACTIVE_LIST_CONTEXT__.viewport;
  const rows = Array.from(source.querySelectorAll('.bx-im-list-recent-item__wrap'));
  const ids = rows.map(row => row.getAttribute('data-id'));
  const top = viewport.scrollTop;
  const mutations = [];
  const observer = new MutationObserver(records => mutations.push(...records));
  observer.observe(source, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style', 'draggable', 'aria-hidden'] });
  const durations = [];
  for (let index = 0; index < 10; index++) {
   const start = performance.now();
   window.__PENA_DOM_AUDIT__.repaint();
   durations.push(performance.now() - start);
   await new Promise(resolve => requestAnimationFrame(resolve));
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  observer.disconnect();
  const sourceStable = rows.every(row => row.isConnected && source.contains(row)) && ids.every((id, index) => rows[index].getAttribute('data-id') === id);
  const toolbar = document.querySelector('.pena-native-folder-switcher');
  const scansBefore = window.__PENA_DOM_AUDIT__.scans;
  for (let index = 0; index < 12; index++) {
   toolbar.classList.toggle('--time-modal-open');
   await new Promise(resolve => requestAnimationFrame(resolve));
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  const toolbarScans = window.__PENA_DOM_AUDIT__.scans - scansBefore;
  window.__PENA_DOM_AUDIT__.syncStableTracker();
  const labelMutations = [];
  const labelObserver = new MutationObserver(records => labelMutations.push(...records));
  labelObserver.observe(toolbar.querySelector('.pena-native-time-button'), { attributes: true, childList: true, subtree: true });
  for (let index = 0; index < 20; index++) window.__PENA_DOM_AUDIT__.syncStableTracker();
  await Promise.resolve();
  labelObserver.disconnect();
  const outsideButton = document.createElement('button');
  outsideButton.textContent = 'Native message send';
  document.body.append(outsideButton);
  let nativeClicks = 0;
  outsideButton.addEventListener('click', () => nativeClicks++);
  const rowReadsBefore = window.__PENA_DOM_AUDIT__.nativeRowReads;
  const discoveryReadsBefore = window.__PENA_DOM_AUDIT__.eventRowDiscoveryReads;
  for (let index = 0; index < 20; index++) {
   outsideButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
   outsideButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
   outsideButton.click();
  }
  const outsideRowReads = window.__PENA_DOM_AUDIT__.nativeRowReads - rowReadsBefore;
  const outsideDiscoveryReads = window.__PENA_DOM_AUDIT__.eventRowDiscoveryReads - discoveryReadsBefore;
  outsideButton.remove();
  // A native typing/status node can be replaced without a row identity change.
  const row = rows.find(candidate => candidate.querySelector('.pena-native-avatar-ring'));
  let nativeOverlayPreserved = false;
  if (row) {
   const ring = row.querySelector('.pena-native-avatar-ring');
   const host = ring.parentElement;
   const badge = document.createElement('span');
   badge.className = 'bx-im-avatar__typing';
   badge.textContent = 'typing';
   host.append(badge);
   window.__PENA_DOM_AUDIT__.repairLayers(row, host);
   const replacement = badge.cloneNode(true);
   replacement.classList.remove('pena-native-avatar-native-overlay');
   badge.replaceWith(replacement);
   window.__PENA_DOM_AUDIT__.repairLayers(row, host);
   nativeOverlayPreserved = replacement.parentElement === host && replacement.classList.contains('pena-native-avatar-native-overlay') && ring.parentElement === host;
   replacement.remove();
  }
  return { rows: rows.length, mutationRecords: mutations.length, repaintMs: durations, sourceStable, scrollStable: viewport.scrollTop === top, toolbarScans, nativeOverlayPreserved, stableTrackerMutations: labelMutations.length, outsideRowReads, outsideDiscoveryReads, nativeClicks };
 });
 result.eventRowContracts = await page.evaluate(() => window.__PENA_DOM_AUDIT__.eventRowContracts());
 const routeNoise = await page.evaluate(async () => {
  const host = document.createElement('div');
  host.id = 'native-message-attribute-noise';
  host.innerHTML = '<div class="native-message"><span>Message</span></div>'.repeat(4000);
  document.body.append(host);
  await new Promise(resolve => requestAnimationFrame(resolve));
  let routeSubtreeQueries = 0;
  const originalQuery = host.querySelector.bind(host);
  const originalQueries = host.querySelectorAll.bind(host);
  host.querySelector = selector => { if (/bx-im-list-container|pena-native-folder-switcher/.test(selector)) routeSubtreeQueries++; return originalQuery(selector); };
  host.querySelectorAll = selector => { if (/bx-im-list-container|pena-native-folder-switcher/.test(selector)) routeSubtreeQueries++; return originalQueries(selector); };
  const scansBefore = window.__PENA_DOM_AUDIT__.scans;
  for (let index = 0; index < 40; index++) {
   host.classList.toggle('native-active');
   host.style.opacity = index % 2 ? '1' : '.99';
   await new Promise(resolve => requestAnimationFrame(resolve));
  }
  await new Promise(resolve => requestAnimationFrame(resolve));
  const unrelatedRouteScans = window.__PENA_DOM_AUDIT__.scans - scansBefore;
  host.remove();
  return { routeSubtreeQueries, unrelatedRouteScans };
 });
 Object.assign(result, routeNoise);
 // The task source was present but hidden at connection time. An attribute on
 // that inactive ancestor must still switch the actual lifecycle context.
 await page.evaluate(() => { document.querySelector('.recent-host').hidden = true; document.querySelector('.task-host').hidden = false; });
 await page.waitForFunction(() => window.__PENA_ACTIVE_LIST_CONTEXT__?.mode === 'tasks', null, { timeout: 5000 });
 result.inactiveAncestorActivated = true;
 await page.evaluate(() => { document.querySelector('.recent-host').hidden = false; document.querySelector('.task-host').hidden = true; });
 await page.waitForFunction(() => window.__PENA_ACTIVE_LIST_CONTEXT__?.mode === 'chats', null, { timeout: 5000 });
 result.detachedRouteCache = await page.evaluate(async () => {
  const count = window.__PENA_DOM_AUDIT__.knownRouteListCount;
  if (!count) return null;
  const before = count();
  const first = document.createElement('div');
  const second = document.createElement('div');
  first.hidden = second.hidden = true;
  first.innerHTML = '<div class="bx-im-list-container-task__elements"></div>';
  second.innerHTML = '<div class="bx-im-list-container-task__elements"></div>';
  document.body.append(first);
  document.body.append(second);
  // The first addition makes records.some() stop. The second ancestor changes
  // before the queued RAF, then must remain in inventory for later attributes.
  await Promise.resolve();
  second.hidden = false;
  for (let frame = 0; frame < 3; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
  const sameBatchSecondRegistered = window.__PENA_DOM_AUDIT__.hasRouteList(second.firstElementChild);
  first.remove(); second.remove();
  for (let frame = 0; frame < 2; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
  for (let index = 0; index < 12; index++) {
   const shell = document.createElement('div');
   shell.hidden = true;
   shell.innerHTML = '<div class="bx-im-list-container-task__elements"></div>';
   document.body.append(shell);
   await new Promise(resolve => requestAnimationFrame(resolve));
   shell.remove();
   await new Promise(resolve => requestAnimationFrame(resolve));
  }
  await new Promise(resolve => requestAnimationFrame(resolve));
  return { before, after: count(), sameBatchSecondRegistered };
 });
 // The extension on/off control runs even before Messenger exists. Unrelated
 // task/message renders must not restart document-wide header discovery.
 const toolbarPage = await browser.newPage();
 const toolbarSource = raw.replace('\tfunction _ensureBitrixListSystemToolbarSticky(searchHost = _getBitrixListSearchHost()) {', '\tfunction _ensureBitrixListSystemToolbarSticky(searchHost = _getBitrixListSearchHost()) {\nwindow.__PENA_TOOLBAR_AUDIT_CALLS__ = (window.__PENA_TOOLBAR_AUDIT_CALLS__ || 0) + 1;');
 await toolbarPage.setContent('<html data-pena-extension-enabled="0"><body><div id="native-task-messages"></div></body></html>');
 await toolbarPage.addScriptTag({ content: toolbarSource });
 await toolbarPage.waitForTimeout(100);
 const toolbarResult = await toolbarPage.evaluate(async () => {
  const before = window.__PENA_TOOLBAR_AUDIT_CALLS__ || 0;
  const messages = document.getElementById('native-task-messages');
  for (let index = 0; index < 40; index++) {
   messages.innerHTML = '<div class="native-message">Message</div>'.repeat(100);
   await new Promise(resolve => requestAnimationFrame(resolve));
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  const absentHeaderRescans = (window.__PENA_TOOLBAR_AUDIT_CALLS__ || 0) - before;
  const header = document.createElement('div');
  header.className = 'bx-im-list-container-recent__header_container';
  header.style.cssText = 'width:400px;height:50px';
  header.innerHTML = '<input type="search" placeholder="Найти чат">';
  document.body.append(header);
  for (let index = 0; index < 4; index++) await new Promise(resolve => requestAnimationFrame(resolve));
  const lateToolbarMounted = !!header.querySelector('.pena-extension-toolbar-controls');
  return { absentHeaderRescans, lateToolbarMounted };
 });
 await toolbarPage.close();
 Object.assign(result, toolbarResult);
 result.avatarTransitions = await checkNativeAvatarTransitions(page);
 result.nativeImageRings = await checkNativeImageRing(page);
 for (const state of result.nativeImageRings) {
  assert.equal(state.ringRendered, true, `Avatar ring is not painted: ${JSON.stringify(state)}`);
  assert.equal(state.ringInsideImage, false, `Ring appended inside a void IMG: ${JSON.stringify(state)}`);
  assert.equal(state.geometryPreserved, true, `Ring no longer follows the native portrait: ${JSON.stringify(state)}`);
  assert.equal(state.photoRounded, true, `Photo lost its native rounding: ${JSON.stringify(state)}`);
  assert.equal(state.typingVisible, true, `Native typing overlay was clipped: ${JSON.stringify(state)}`);
  assert.equal(state.nativePortraitPreserved, true, `Native portrait was replaced: ${JSON.stringify(state)}`);
 }
 for (const state of result.avatarTransitions) {
  assert.equal(state.cornerExposesPhoto, false, `Native photo became square: ${JSON.stringify(state)}`);
  assert.equal(state.geometryPreserved, true, `Native avatar geometry changed: ${JSON.stringify(state)}`);
  assert.equal(state.typingVisible, true, `Native typing overlay was clipped: ${JSON.stringify(state)}`);
  assert.equal(state.staleHosts, 0, `Replaced portrait retained ring styles: ${JSON.stringify(state)}`);
 }
 assert.ok(result.rows >= 1000, `Large native row fixture was not materialized: ${JSON.stringify(result)}`);
 assert.ok(result.mutationRecords < result.rows, `Repeated projection flooded native observers: ${JSON.stringify(result)}`);
 assert.equal(result.toolbarScans, 0, `PENA toolbar classes triggered native route scans: ${JSON.stringify(result)}`);
 assert.equal(result.sourceStable, true, 'Repaint replaced native row identity');
 assert.equal(result.scrollStable, true, 'Repaint moved native viewport');
 assert.equal(result.nativeOverlayPreserved, true, 'Replaced native typing overlay lost its layer above the ring');
 assert.equal(result.stableTrackerMutations, 0, 'Unchanged compact tracker duration rewrote the native toolbar');
 assert.equal(result.outsideRowReads, 0, 'Native actions outside the list scanned every native row');
 assert.equal(result.outsideDiscoveryReads, 0, 'Native actions outside the list entered layout-sensitive list discovery');
 assert.deepEqual(result.eventRowContracts, { svg: true, text: true, generic: true, lateSearch: true, managedRow: true, outside: true, outsideDiscovery: 0, range: true }, 'Early event filtering broke native row targeting, late source discovery, or range selection');
 assert.equal(result.nativeClicks, 20, 'PENA intercepted an unrelated native action');
 assert.equal(result.absentHeaderRescans, 0, 'Missing header retried discovery on unrelated message renders');
 assert.equal(result.lateToolbarMounted, true, 'Header appearing after unrelated renders did not mount its controls');
 assert.equal(result.routeSubtreeQueries, 0, 'Class/style changes rescanned the unrelated 4000-message subtree');
 assert.equal(result.unrelatedRouteScans, 0, 'Unrelated attributes triggered full native route reconciliation');
 assert.equal(result.inactiveAncestorActivated, true, 'Hidden inactive ancestor was omitted from native route detection');
 assert.ok(result.detachedRouteCache && result.detachedRouteCache.after <= result.detachedRouteCache.before, 'Removed route lists leaked from the lifecycle candidate cache');
 assert.equal(result.detachedRouteCache.sameBatchSecondRegistered, true, 'Early observer exit lost the second source inserted in the same mutation batch');
 assert.deepEqual(errors, [], `Page errors: ${errors.join('\n')}`);
 console.log(`PASS native DOM mutation budget: ${result.rows} rows, ${result.mutationRecords} mutations / 10 repaints, ${result.toolbarScans} toolbar route scans`);
} finally {
 const artifact = { runtimeSha256: createHash('sha256').update(raw).digest('hex'), result, errors };
 mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
 writeFileSync(new URL('./artifacts/native-dom-mutation-report.json', import.meta.url), JSON.stringify(artifact, null, 2));
 await browser.close();
 await server.close();
}

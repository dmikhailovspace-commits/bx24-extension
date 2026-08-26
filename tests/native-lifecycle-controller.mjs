import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const lifecycle = require('../extension/native-lifecycle.js');

const {
	OBSERVED_ATTRIBUTES,
	DEFAULT_ABSENCE_GRACE_MS,
	elementVisibility,
	selectActiveCandidate,
	createLifecycleController
} = lifecycle;

class FakeClock {
	constructor() {
		this.time = 0;
		this.nextId = 1;
		this.timers = new Map();
	}

	now = () => this.time;

	setTimeout = (callback, delay = 0) => {
		const id = this.nextId++;
		this.timers.set(id, { id, callback, due: this.time + Math.max(0, Number(delay) || 0) });
		return id;
	};

	clearTimeout = id => {
		this.timers.delete(id);
	};

	tick(milliseconds) {
		const target = this.time + milliseconds;
		while (true) {
			const next = Array.from(this.timers.values())
				.filter(timer => timer.due <= target)
				.sort((left, right) => left.due - right.due || left.id - right.id)[0];
			if (!next) break;
			this.time = next.due;
			this.timers.delete(next.id);
			next.callback();
		}
		this.time = target;
	}
}

class MockDocument {
	constructor() {
		this.nodes = new Set();
		this.defaultView = {
			getComputedStyle: element => element.computedStyle || element.style
		};
	}

	querySelectorAll(selector) {
		if (selector !== '.pena-native-folder-switcher') return [];
		return Array.from(this.nodes).filter(node => (
			node.isConnected
			&& String(node.className || '').split(/\s+/).includes('pena-native-folder-switcher')
		));
	}
}

class MockElement {
	constructor(ownerDocument, name, rect = { left: 0, top: 0, width: 360, height: 500 }) {
		this.ownerDocument = ownerDocument;
		this.name = name;
		this.parentElement = null;
		this.parentNode = null;
		this.children = [];
		this.attributes = new Map();
		this.className = '';
		this.hidden = false;
		this.isConnected = false;
		this.style = { display: 'block', visibility: 'visible', opacity: '1' };
		this.rect = { ...rect };
		ownerDocument.nodes.add(this);
	}

	appendChild(child) {
		if (child.parentNode) child.parentNode.removeChild(child);
		this.children.push(child);
		child.parentNode = this;
		child.parentElement = this;
		child.setConnected(this.isConnected);
		return child;
	}

	insertBefore(child, reference) {
		if (child === reference) return child;
		if (child.parentNode) child.parentNode.removeChild(child);
		const index = this.children.indexOf(reference);
		if (index < 0) return this.appendChild(child);
		this.children.splice(index, 0, child);
		child.parentNode = this;
		child.parentElement = this;
		child.setConnected(this.isConnected);
		return child;
	}

	removeChild(child) {
		const index = this.children.indexOf(child);
		if (index >= 0) this.children.splice(index, 1);
		child.parentNode = null;
		child.parentElement = null;
		child.setConnected(false);
		return child;
	}

	remove() {
		if (this.parentNode) this.parentNode.removeChild(this);
		else this.setConnected(false);
	}

	setConnected(connected) {
		this.isConnected = !!connected;
		for (const child of this.children) child.setConnected(this.isConnected);
	}

	contains(node) {
		if (node === this) return true;
		return this.children.some(child => child.contains(node));
	}

	setAttribute(name, value = '') {
		this.attributes.set(name, String(value));
		if (name === 'class') this.className = String(value);
		if (name === 'hidden') this.hidden = true;
	}

	removeAttribute(name) {
		this.attributes.delete(name);
		if (name === 'class') this.className = '';
		if (name === 'hidden') this.hidden = false;
	}

	hasAttribute(name) {
		return this.attributes.has(name);
	}

	getAttribute(name) {
		if (name === 'class') return this.className || null;
		return this.attributes.has(name) ? this.attributes.get(name) : null;
	}

	getBoundingClientRect() {
		const left = Number(this.rect.left) || 0;
		const top = Number(this.rect.top) || 0;
		const width = Number(this.rect.width) || 0;
		const height = Number(this.rect.height) || 0;
		return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
	}

	getClientRects() {
		return this.rect.width > 0 && this.rect.height > 0 ? [this.getBoundingClientRect()] : [];
	}
}

function makeFixture() {
	const document = new MockDocument();
	const root = new MockElement(document, 'root', { left: 0, top: 0, width: 800, height: 700 });
	root.setConnected(true);

	function makeMode(mode, left) {
		const host = new MockElement(document, `${mode}-host`, { left, top: 0, width: 360, height: 650 });
		const viewport = new MockElement(document, `${mode}-viewport`, { left, top: 100, width: 360, height: 550 });
		const list = new MockElement(document, `${mode}-list`, { left, top: 100, width: 360, height: 1200 });
		const searchInput = new MockElement(document, `${mode}-search`, { left: left + 20, top: 20, width: 280, height: 32 });
		root.appendChild(host);
		host.appendChild(viewport);
		viewport.appendChild(list);
		host.appendChild(searchInput);
		return { mode, host, viewport, list, searchInput };
	}

	const chats = makeMode('chats', 0);
	const tasks = makeMode('tasks', 400);
	return { document, root, chats, tasks };
}

function candidate(fixture, flags = {}) {
	return { ...fixture, ...flags };
}

function visibleSwitchers(document) {
	return document.querySelectorAll('.pena-native-folder-switcher');
}

function makeController(fixture, clock = new FakeClock(), overrides = {}) {
	return {
		clock,
		controller: createLifecycleController({
			now: clock.now,
			setTimeout: clock.setTimeout,
			clearTimeout: clock.clearTimeout,
			createSwitcher: () => {
				const node = new MockElement(fixture.document, 'switcher', { left: 0, top: 0, width: 360, height: 96 });
				node.className = 'pena-native-folder-switcher';
				return node;
			},
			...overrides
		})
	};
}

function testBrowserPublication() {
	const source = readFileSync(new URL('../extension/native-lifecycle.js', import.meta.url), 'utf8');
	const sandbox = { window: {} };
	vm.runInNewContext(source, sandbox, { filename: 'native-lifecycle.js' });
	assert.equal(typeof sandbox.window.__PENA_NATIVE_LIFECYCLE__?.createLifecycleController, 'function');
}

function testVisibilitySignals() {
	const fixture = makeFixture();
	const node = fixture.chats.list;
	assert.equal(elementVisibility(node).visible, true);

	node.hidden = true;
	assert.equal(elementVisibility(node).reason, 'attribute');
	node.hidden = false;

	node.className = 'bx-panel is-hidden';
	assert.equal(elementVisibility(node).reason, 'class');
	node.className = '';

	node.style.display = 'none';
	assert.equal(elementVisibility(node).reason, 'style');
	node.style.display = 'block';

	fixture.chats.host.setAttribute('aria-hidden', 'true');
	assert.equal(elementVisibility(node).reason, 'attribute', 'ancestor aria-hidden must hide the list');
	fixture.chats.host.removeAttribute('aria-hidden');

	fixture.chats.host.style.opacity = '0';
	assert.equal(elementVisibility(node).reason, 'opacity', 'ancestor opacity must participate in crossfade visibility');
	fixture.chats.host.style.opacity = '1';
}

function testCandidateCoherenceAndCrossfade() {
	const fixture = makeFixture();
	const chats = candidate(fixture.chats, { routeActive: true });
	const tasks = candidate(fixture.tasks, { routeActive: true });
	const selected = selectActiveCandidate([chats, tasks], null, { preferredMode: 'tasks' });
	assert.equal(selected.mode, 'tasks');
	assert.equal(selected.list, fixture.tasks.list);
	assert.equal(selected.viewport, fixture.tasks.viewport);
	assert.equal(selected.host, fixture.tasks.host);
	assert.equal(selected.searchInput, fixture.tasks.searchInput);

	const { controller } = makeController(fixture);
	let context = controller.reconcile([candidate(fixture.chats, { routeActive: true })]);
	assert.equal(context.mode, 'chats');
	const firstGeneration = context.generation;

	context = controller.reconcile([
		candidate(fixture.chats, { routeActive: true }),
		candidate(fixture.tasks, { routeActive: true })
	], { reason: 'ambiguous-crossfade' });
	assert.equal(context.mode, 'chats', 'ambiguous crossfade must preserve the stable context');
	assert.equal(context.generation, firstGeneration);

	context = controller.reconcile([
		candidate(fixture.chats, { routeActive: false }),
		candidate(fixture.tasks, { routeActive: true })
	], { reason: 'task-tab-selected' });
	assert.equal(context.mode, 'tasks');
	assert.equal(context.list, fixture.tasks.list, 'mode and list must come from the same candidate');
	assert.equal(context.host, fixture.tasks.host);
	assert.equal(context.generation, firstGeneration + 1);
	assert.equal(visibleSwitchers(fixture.document).length, 1);
	assert.equal(controller.getSwitcher().parentNode, fixture.tasks.host);
	controller.dispose();
}

function testTemporaryAbsence() {
	const fixture = makeFixture();
	const { controller, clock } = makeController(fixture);
	const original = controller.reconcile([candidate(fixture.chats, { active: true })]);
	assert.equal(DEFAULT_ABSENCE_GRACE_MS, 1200);

	assert.equal(controller.reconcile([], { now: clock.now(), reason: 'route-gap' }), original);
	clock.tick(1199);
	assert.equal(controller.getContext(), original, 'panel must survive a temporary 1199 ms DOM gap');
	assert.equal(visibleSwitchers(fixture.document).length, 1);

	controller.reconcile([candidate(fixture.chats, { active: true })], { now: clock.now() });
	clock.tick(10);
	assert.equal(controller.getContext().mode, 'chats', 'returning list must cancel stale absence timer');

	controller.reconcile([], { now: clock.now() });
	clock.tick(1200);
	assert.equal(controller.getContext(), null, 'a confirmed absence must eventually unmount the context');
	assert.equal(visibleSwitchers(fixture.document).length, 0);
	controller.dispose();
}

function testFiftyAtomicTransitions() {
	const fixture = makeFixture();
	const stale = new MockElement(fixture.document, 'stale-switcher');
	stale.className = 'pena-native-folder-switcher';
	fixture.chats.host.appendChild(stale);
	const disconnectedHandles = [];
	const { controller } = makeController(fixture);

	let previousHandle = null;
	for (let index = 0; index < 50; index += 1) {
		const target = index % 2 === 0 ? fixture.chats : fixture.tasks;
		const other = index % 2 === 0 ? fixture.tasks : fixture.chats;
		const context = controller.reconcile([
			candidate(other, { routeActive: false, visibility: 0.65 }),
			candidate(target, { routeActive: true, visibility: 0.65 })
		], { reason: `transition-${index}` });

		assert.equal(context.mode, target.mode);
		assert.equal(context.list, target.list);
		assert.equal(context.viewport, target.viewport);
		assert.equal(context.host, target.host);
		assert.equal(context.searchInput, target.searchInput);
		assert.equal(visibleSwitchers(fixture.document).length, 1, `transition ${index} created duplicate switchers`);
		assert.equal(controller.getSwitcher().parentNode, target.host);
		if (previousHandle) assert.equal(previousHandle.disconnected, true, `transition ${index} leaked a context observer`);

		const handle = {
			disconnected: false,
			disconnect() {
				this.disconnected = true;
				disconnectedHandles.push(this);
			}
		};
		controller.registerObserver(handle, { scope: 'context', generation: context.generation });
		previousHandle = handle;
	}

	assert.equal(controller.getGeneration(), 50);
	assert.equal(disconnectedHandles.length, 49);
	assert.equal(previousHandle.disconnected, false);
	controller.dispose();
	assert.equal(previousHandle.disconnected, true);
	assert.equal(visibleSwitchers(fixture.document).length, 0);
}

function testStaleGenerationCancellation() {
	const fixture = makeFixture();
	const { controller, clock } = makeController(fixture);
	const first = controller.reconcile([candidate(fixture.chats, { active: true })]);
	let guardedRuns = 0;
	let deferredRuns = 0;
	const staleCallback = controller.guard(first.generation, () => { guardedRuns += 1; });
	controller.defer(() => { deferredRuns += 1; }, 100);

	const second = controller.reconcile([
		candidate(fixture.chats, { active: false }),
		candidate(fixture.tasks, { active: true })
	]);
	assert.notEqual(second.generation, first.generation);
	staleCallback();
	clock.tick(100);
	assert.equal(guardedRuns, 0, 'guarded callback from a stale generation must be ignored');
	assert.equal(deferredRuns, 0, 'deferred callback from a stale generation must be cancelled');

	controller.defer(() => { deferredRuns += 1; }, 25);
	clock.tick(25);
	assert.equal(deferredRuns, 1, 'current-generation deferred callback must run');
	controller.dispose();
}

function testAtomicSwitcherRollback() {
	const fixture = makeFixture();
	const errors = [];
	const { controller } = makeController(fixture, new FakeClock(), {
		attachSwitcher: (switcher, context) => {
			context.host.insertBefore(switcher, context.viewport);
			if (context.mode === 'tasks') throw new Error('simulated attach failure');
		},
		onError: error => errors.push(error)
	});
	const first = controller.reconcile([candidate(fixture.chats, { active: true })]);
	const switcher = controller.getSwitcher();
	assert.equal(switcher.parentNode, fixture.chats.host);

	const afterFailure = controller.reconcile([
		candidate(fixture.chats, { active: false }),
		candidate(fixture.tasks, { active: true })
	]);
	assert.equal(afterFailure, first, 'failed mount must not publish a half-switched context');
	assert.equal(controller.getGeneration(), first.generation);
	assert.equal(switcher.parentNode, fixture.chats.host, 'failed mount must restore the previous switcher host');
	assert.equal(visibleSwitchers(fixture.document).length, 1);
	assert.equal(errors.length, 1);
	controller.dispose();
}

class FakeResizeObserver {
	static instances = [];

	constructor(callback) {
		this.callback = callback;
		this.targets = [];
		this.disconnected = false;
		FakeResizeObserver.instances.push(this);
	}

	observe(target) {
		this.targets.push(target);
	}

	disconnect() {
		this.disconnected = true;
	}

	emit(target, contentRect) {
		this.callback([{ target, contentRect }]);
	}
}

function testResizeMetadataAndObserverCleanup() {
	FakeResizeObserver.instances.length = 0;
	const fixture = makeFixture();
	const { controller } = makeController(fixture);
	const first = controller.reconcile([candidate(fixture.chats, { active: true })]);
	const observer = controller.observeResize(fixture.chats.host, 'host', FakeResizeObserver);
	assert.ok(observer);
	assert.equal(controller.getContext().resize.host.width, 360);
	const firstRevision = controller.getContext().resize.revision;

	observer.emit(fixture.chats.host, { left: 0, top: 0, width: 284, height: 640 });
	assert.equal(controller.getContext().resize.host.width, 284);
	assert.equal(controller.getContext().resize.revision, firstRevision + 1);
	assert.equal(controller.getContext().generation, first.generation, 'resize must not invalidate the active generation');

	const staleGeneration = first.generation;
	controller.reconcile([
		candidate(fixture.chats, { active: false }),
		candidate(fixture.tasks, { active: true })
	]);
	assert.equal(observer.disconnected, true, 'old-context ResizeObserver must be disconnected');
	assert.equal(controller.getContext().resize.revision, 0);
	observer.emit(fixture.chats.host, { left: 0, top: 0, width: 111, height: 111 });
	assert.equal(controller.getContext().resize.revision, 0, 'stale ResizeObserver callback must be ignored');
	assert.equal(controller.updateResizeMetadata(staleGeneration, 'host', { width: 1, height: 1 }), false);
	controller.dispose();
}

class FakeMutationObserver {
	static instances = [];

	constructor(callback) {
		this.callback = callback;
		this.options = null;
		this.disconnected = false;
		FakeMutationObserver.instances.push(this);
	}

	observe(target, options) {
		this.target = target;
		this.options = options;
	}

	disconnect() {
		this.disconnected = true;
	}

	emit(records) {
		this.callback(records);
	}
}

function testBrowserObserverConnection() {
	FakeMutationObserver.instances.length = 0;
	const fixture = makeFixture();
	const { controller } = makeController(fixture);
	let activeMode = 'chats';
	const frames = [];
	const cancelledFrames = [];
	const disconnect = controller.connect({
		root: fixture.root,
		MutationObserver: FakeMutationObserver,
		requestAnimationFrame: callback => {
			frames.push(callback);
			return frames.length;
		},
		cancelAnimationFrame: frame => cancelledFrames.push(frame),
		resolveCandidates: () => [
			candidate(fixture.chats, { routeActive: activeMode === 'chats' }),
			candidate(fixture.tasks, { routeActive: activeMode === 'tasks' })
		]
	});

	const observer = FakeMutationObserver.instances[0];
	assert.deepEqual(observer.options.attributeFilter, OBSERVED_ATTRIBUTES);
	assert.equal(observer.options.attributes, true);
	assert.equal(observer.options.childList, true);
	assert.equal(observer.options.subtree, true);
	assert.equal(controller.getContext().mode, 'chats');

	activeMode = 'tasks';
	fixture.chats.host.className = 'is-hidden';
	observer.emit([{ type: 'attributes', attributeName: 'class', target: fixture.chats.host }]);
	assert.equal(frames.length, 1);
	frames.shift()();
	assert.equal(controller.getContext().mode, 'tasks');

	observer.emit([{ type: 'characterData', target: fixture.tasks.list }]);
	assert.equal(frames.length, 0, 'irrelevant mutations must not trigger a lifecycle pass');
	disconnect();
	assert.equal(observer.disconnected, true);
	assert.deepEqual(cancelledFrames, []);
	controller.dispose();
}

const tests = [
	['browser publication', testBrowserPublication],
	['hidden/class/style/aria visibility', testVisibilitySignals],
	['candidate coherence and crossfade', testCandidateCoherenceAndCrossfade],
	['1200 ms temporary absence', testTemporaryAbsence],
	['50 atomic transitions', testFiftyAtomicTransitions],
	['stale generation cancellation', testStaleGenerationCancellation],
	['atomic switcher rollback', testAtomicSwitcherRollback],
	['resize metadata and observer cleanup', testResizeMetadataAndObserverCleanup],
	['browser mutation observer connection', testBrowserObserverConnection]
];

for (const [name, test] of tests) {
	test();
	console.log(`ok - ${name}`);
}

console.log('native lifecycle controller: all checks passed');

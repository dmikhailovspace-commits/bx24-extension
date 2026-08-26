(function attachPenaNativeLifecycle(root, factory) {
	'use strict';

	const api = factory(root);
	if (root && typeof root === 'object') {
		root.__PENA_NATIVE_LIFECYCLE__ = api;
	}
	if (typeof module === 'object' && module && module.exports) {
		module.exports = api;
	}
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function createPenaNativeLifecycleApi(root) {
	'use strict';

	const OBSERVED_ATTRIBUTES = Object.freeze(['class', 'style', 'hidden', 'aria-hidden']);
	const DEFAULT_ABSENCE_GRACE_MS = 1200;
	const HIDDEN_CLASS_NAMES = new Set([
		'hidden',
		'is-hidden',
		'ui-hidden',
		'bx-hidden',
		'bx-hide',
		'display-none',
		'visibility-hidden',
		'--hidden'
	]);
	const RESIZE_ROLES = new Set(['list', 'viewport', 'host', 'searchInput', 'switcher']);

	function hasOwn(value, key) {
		return Object.prototype.hasOwnProperty.call(value, key);
	}

	function finiteNumber(value, fallback) {
		const number = Number(value);
		return Number.isFinite(number) ? number : fallback;
	}

	function normalizeMode(mode) {
		return String(mode || '').toLowerCase() === 'tasks' ? 'tasks' : 'chats';
	}

	function explicitMode(mode) {
		const value = String(mode || '').toLowerCase();
		return value === 'chats' || value === 'tasks' ? value : '';
	}

	function classText(element) {
		if (!element) return '';
		if (typeof element.className === 'string') return element.className;
		if (element.className && typeof element.className.baseVal === 'string') return element.className.baseVal;
		if (typeof element.getAttribute === 'function') return String(element.getAttribute('class') || '');
		return '';
	}

	function hasHiddenClass(element) {
		const tokens = classText(element).split(/\s+/).filter(Boolean);
		return tokens.some(token => HIDDEN_CLASS_NAMES.has(token.toLowerCase()) || /(?:^|--)hidden$/i.test(token));
	}

	function attributeValue(element, name) {
		if (!element || typeof element.getAttribute !== 'function') return null;
		try {
			return element.getAttribute(name);
		} catch (_) {
			return null;
		}
	}

	function hasHiddenAttribute(element) {
		if (!element) return true;
		if (element.hidden === true) return true;
		if (typeof element.hasAttribute === 'function') {
			try {
				if (element.hasAttribute('hidden')) return true;
			} catch (_) {
				// A foreign DOM wrapper may throw while Bitrix replaces it.
			}
		}
		return String(attributeValue(element, 'aria-hidden') || '').toLowerCase() === 'true';
	}

	function readStyle(element) {
		if (!element) return null;
		const view = element.ownerDocument && element.ownerDocument.defaultView;
		if (view && typeof view.getComputedStyle === 'function') {
			try {
				return view.getComputedStyle(element);
			} catch (_) {
				// Detached nodes can fail computed-style lookup during a route change.
			}
		}
		return element.style || null;
	}

	function normalizeRect(rect) {
		if (!rect || typeof rect !== 'object') return null;
		const width = Math.max(0, finiteNumber(rect.width, finiteNumber(rect.right, 0) - finiteNumber(rect.left, 0)));
		const height = Math.max(0, finiteNumber(rect.height, finiteNumber(rect.bottom, 0) - finiteNumber(rect.top, 0)));
		const left = finiteNumber(rect.left, finiteNumber(rect.x, 0));
		const top = finiteNumber(rect.top, finiteNumber(rect.y, 0));
		const right = finiteNumber(rect.right, left + width);
		const bottom = finiteNumber(rect.bottom, top + height);
		return Object.freeze({
			x: finiteNumber(rect.x, left),
			y: finiteNumber(rect.y, top),
			width,
			height,
			top,
			right,
			bottom,
			left
		});
	}

	function elementRect(element) {
		if (!element || typeof element.getBoundingClientRect !== 'function') return null;
		try {
			return normalizeRect(element.getBoundingClientRect());
		} catch (_) {
			return null;
		}
	}

	function elementVisibility(element) {
		if (!element || typeof element !== 'object') {
			return Object.freeze({ visible: false, opacity: 0, area: 0, rect: null, reason: 'missing' });
		}
		if ('isConnected' in element && element.isConnected === false) {
			return Object.freeze({ visible: false, opacity: 0, area: 0, rect: null, reason: 'detached' });
		}

		let opacity = 1;
		let current = element;
		const visited = new Set();
		while (current && typeof current === 'object' && !visited.has(current)) {
			visited.add(current);
			if (hasHiddenAttribute(current)) {
				return Object.freeze({ visible: false, opacity: 0, area: 0, rect: elementRect(element), reason: 'attribute' });
			}
			if (hasHiddenClass(current)) {
				return Object.freeze({ visible: false, opacity: 0, area: 0, rect: elementRect(element), reason: 'class' });
			}

			const style = readStyle(current);
			if (style) {
				const display = String(style.display || '').toLowerCase();
				const visibility = String(style.visibility || '').toLowerCase();
				if (display === 'none' || visibility === 'hidden' || visibility === 'collapse') {
					return Object.freeze({ visible: false, opacity: 0, area: 0, rect: elementRect(element), reason: 'style' });
				}
				if (style.opacity !== '' && style.opacity != null) {
					const ownOpacity = finiteNumber(style.opacity, 1);
					opacity *= Math.max(0, Math.min(1, ownOpacity));
				}
			}
			current = current.parentElement || null;
		}

		const rect = elementRect(element);
		const area = rect ? rect.width * rect.height : 0;
		const hasGeometry = !!rect && (typeof element.getClientRects === 'function' || rect.width > 0 || rect.height > 0);
		if (hasGeometry && (rect.width <= 0 || rect.height <= 0)) {
			return Object.freeze({ visible: false, opacity: 0, area: 0, rect, reason: 'geometry' });
		}
		if (opacity <= 0.001) {
			return Object.freeze({ visible: false, opacity: 0, area, rect, reason: 'opacity' });
		}
		return Object.freeze({ visible: true, opacity, area, rect, reason: '' });
	}

	function candidateActiveRank(candidate) {
		if (candidate.routeActive === true) return 4;
		if (candidate.tabActive === true) return 3;
		if (candidate.active === true) return 2;
		if (candidate.selected === true) return 1;
		return 0;
	}

	function candidateExplicitlyInactive(candidate) {
		return candidate.routeActive === false || candidate.tabActive === false || candidate.active === false;
	}

	function normalizeCandidate(candidate, index, options) {
		if (!candidate || typeof candidate !== 'object' || !candidate.list) return null;
		const viewport = candidate.viewport || candidate.list;
		const host = candidate.host || viewport.parentElement || candidate.list.parentElement;
		if (!viewport || !host) return null;

		const visibilityResolver = options && typeof options.visibilityResolver === 'function'
			? options.visibilityResolver
			: elementVisibility;
		const parts = [];
		for (const element of [candidate.list, viewport, host]) {
			if (!parts.includes(element)) parts.push(element);
		}
		const measurements = parts.map(element => visibilityResolver(element));
		const visible = candidate.visible !== false && measurements.every(value => value && value.visible !== false);
		const opacity = measurements.reduce((lowest, value) => Math.min(lowest, finiteNumber(value && value.opacity, 1)), 1);
		const area = measurements.reduce((largest, value) => Math.max(largest, finiteNumber(value && value.area, 0)), 0);
		const explicitVisibility = typeof candidate.visibility === 'number'
			? Math.max(0, Math.min(1, candidate.visibility))
			: 1;

		return Object.freeze({
			index: finiteNumber(index, 0),
			key: candidate.key == null ? '' : String(candidate.key),
			mode: normalizeMode(candidate.mode),
			list: candidate.list,
			viewport,
			host,
			searchInput: candidate.searchInput || null,
			visible: visible && explicitVisibility > 0,
			opacity: opacity * explicitVisibility,
			area,
			activeRank: candidateActiveRank(candidate),
			explicitlyInactive: candidateExplicitlyInactive(candidate),
			priority: finiteNumber(candidate.priority, 0),
			source: candidate
		});
	}

	function sameCandidate(left, right) {
		return !!left && !!right
			&& left.mode === right.mode
			&& left.list === right.list
			&& left.viewport === right.viewport
			&& left.host === right.host
			&& left.searchInput === right.searchInput;
	}

	function compareCandidates(left, right) {
		if (left.activeRank !== right.activeRank) return right.activeRank - left.activeRank;
		if (left.explicitlyInactive !== right.explicitlyInactive) return left.explicitlyInactive ? 1 : -1;
		if (left.priority !== right.priority) return right.priority - left.priority;
		if (left.opacity !== right.opacity) return right.opacity - left.opacity;
		if (left.area !== right.area) return right.area - left.area;
		return left.index - right.index;
	}

	function compareCandidateQuality(left, right) {
		if (left.activeRank !== right.activeRank) return right.activeRank - left.activeRank;
		if (left.explicitlyInactive !== right.explicitlyInactive) return left.explicitlyInactive ? 1 : -1;
		if (left.priority !== right.priority) return right.priority - left.priority;
		if (left.opacity !== right.opacity) return right.opacity - left.opacity;
		if (left.area !== right.area) return right.area - left.area;
		return 0;
	}

	function selectActiveCandidate(candidates, currentContext, options) {
		const settings = options || {};
		let eligible = (Array.isArray(candidates) ? candidates : [])
			.map((candidate, index) => normalizeCandidate(candidate, index, settings))
			.filter(candidate => candidate && candidate.visible);
		if (!eligible.length) return null;

		const preferredMode = explicitMode(settings.preferredMode);
		if (preferredMode) {
			eligible = eligible.filter(candidate => candidate.mode === preferredMode);
			if (!eligible.length) return null;
		}

		const current = eligible.find(candidate => sameCandidate(candidate, currentContext));
		const best = eligible.slice().sort(compareCandidates)[0] || null;
		// Keep the current context only while it is genuinely as strong as the best
		// candidate. A stale Bitrix screen may remain visible underneath a newer one;
		// retaining it merely because the mode matches leaves the panel in that host.
		if (current && best && compareCandidateQuality(current, best) <= 0) return current;
		return best;
	}

	function cleanupFunction(handle) {
		if (typeof handle === 'function') return handle;
		if (!handle || typeof handle !== 'object') return function noop() {};
		if (typeof handle.disconnect === 'function') return () => handle.disconnect();
		if (typeof handle.abort === 'function') return () => handle.abort();
		if (typeof handle.unsubscribe === 'function') return () => handle.unsubscribe();
		if (typeof handle.remove === 'function') return () => handle.remove();
		return function noop() {};
	}

	function defaultAttachSwitcher(switcher, context) {
		if (!switcher || !context || !context.host) return;
		const host = context.host;
		if (typeof host.insertBefore === 'function' && context.viewport && context.viewport.parentNode === host) {
			host.insertBefore(switcher, context.viewport);
			return;
		}
		if (typeof host.appendChild === 'function') host.appendChild(switcher);
	}

	function defaultDetachSwitcher(switcher) {
		if (!switcher) return;
		if (typeof switcher.remove === 'function') {
			switcher.remove();
			return;
		}
		const parent = switcher.parentNode;
		if (parent && typeof parent.removeChild === 'function') parent.removeChild(switcher);
	}

	function defaultPruneSwitchers(switcher, context, selector) {
		if (!switcher || !context) return;
		const documentRoot = context.host && context.host.ownerDocument;
		if (!documentRoot || typeof documentRoot.querySelectorAll !== 'function') return;
		let nodes = [];
		try {
			nodes = Array.from(documentRoot.querySelectorAll(selector));
		} catch (_) {
			return;
		}
		for (const node of nodes) {
			if (node !== switcher) defaultDetachSwitcher(node);
		}
	}

	function createLifecycleController(options) {
		const settings = options || {};
		const clockNow = typeof settings.now === 'function' ? settings.now : Date.now;
		const setTimer = typeof settings.setTimeout === 'function'
			? settings.setTimeout
			: (root && typeof root.setTimeout === 'function' ? root.setTimeout.bind(root) : setTimeout);
		const clearTimer = typeof settings.clearTimeout === 'function'
			? settings.clearTimeout
			: (root && typeof root.clearTimeout === 'function' ? root.clearTimeout.bind(root) : clearTimeout);
		const absenceGraceMs = Math.min(
			DEFAULT_ABSENCE_GRACE_MS,
			Math.max(0, finiteNumber(settings.absenceGraceMs, DEFAULT_ABSENCE_GRACE_MS))
		);
		const switcherSelector = String(settings.switcherSelector || '.pena-native-folder-switcher');
		const controllerHandles = new Set();
		const contextHandles = new Set();

		let generation = 0;
		let context = null;
		let activeCandidate = null;
		let switcher = settings.switcher || null;
		let missingSince = null;
		let absenceTimer = null;
		let absenceTicket = 0;
		let disposed = false;

		function safeCall(callback, args) {
			if (typeof callback !== 'function') return undefined;
			try {
				return callback.apply(null, args || []);
			} catch (error) {
				if (callback !== settings.onError && typeof settings.onError === 'function') {
					try { settings.onError(error); } catch (_) { /* no-op */ }
				}
				return undefined;
			}
		}

		function makeHandleRecord(handle, scope, token) {
			return {
				handle,
				scope,
				generation: token,
				cleanup: cleanupFunction(handle),
				closed: false
			};
		}

		function closeRecord(record) {
			if (!record || record.closed) return;
			record.closed = true;
			controllerHandles.delete(record);
			contextHandles.delete(record);
			try {
				record.cleanup();
			} catch (error) {
				safeCall(settings.onError, [error]);
			}
		}

		function cleanupRecords(records) {
			for (const record of Array.from(records)) closeRecord(record);
		}

		function registerHandle(handle, registration) {
			const details = registration || {};
			const scope = details.scope === 'context' ? 'context' : 'controller';
			const token = details.generation == null ? generation : Number(details.generation);
			const record = makeHandleRecord(handle, scope, token);
			if (disposed || (scope === 'context' && (!context || token !== generation))) {
				closeRecord(record);
				return function alreadyClosed() {};
			}
			(scope === 'context' ? contextHandles : controllerHandles).add(record);
			return () => closeRecord(record);
		}

		function clearAbsenceTimer() {
			if (absenceTimer != null) {
				clearTimer(absenceTimer);
				absenceTimer = null;
			}
			absenceTicket += 1;
		}

		function clearMissingState() {
			missingSince = null;
			clearAbsenceTimer();
		}

		function detachSwitcher(reason) {
			if (!switcher) return;
			const detach = typeof settings.detachSwitcher === 'function' ? settings.detachSwitcher : defaultDetachSwitcher;
			safeCall(detach, [switcher, context, reason]);
		}

		function ensureSwitcher(nextContext) {
			let created = false;
			if (!switcher && typeof settings.createSwitcher === 'function') {
				try {
					switcher = settings.createSwitcher(nextContext) || null;
				} catch (error) {
					safeCall(settings.onError, [error]);
					return false;
				}
				created = !!switcher;
			}
			if (!switcher) return true;
			const previousParent = switcher.parentNode || null;
			let previousNextSibling = switcher.nextSibling || null;
			if (!previousNextSibling && previousParent && previousParent.children) {
				const siblings = Array.from(previousParent.children);
				const position = siblings.indexOf(switcher);
				previousNextSibling = position >= 0 ? siblings[position + 1] || null : null;
			}

			try {
				const attach = typeof settings.attachSwitcher === 'function' ? settings.attachSwitcher : defaultAttachSwitcher;
				attach(switcher, nextContext);
				if (typeof settings.pruneSwitchers === 'function') {
					settings.pruneSwitchers(switcher, nextContext);
				} else {
					defaultPruneSwitchers(switcher, nextContext, switcherSelector);
				}
				return true;
			} catch (error) {
				if (created) {
					defaultDetachSwitcher(switcher);
					switcher = null;
				} else {
					try {
						if (previousParent && typeof previousParent.insertBefore === 'function' && previousNextSibling && previousNextSibling.parentNode === previousParent) {
							previousParent.insertBefore(switcher, previousNextSibling);
						} else if (previousParent && typeof previousParent.appendChild === 'function') {
							previousParent.appendChild(switcher);
						} else {
							defaultDetachSwitcher(switcher);
						}
					} catch (rollbackError) {
						safeCall(settings.onError, [rollbackError]);
					}
				}
				safeCall(settings.onError, [error]);
				return false;
			}
		}

		function createContext(candidate, nextGeneration, resize) {
			return Object.freeze({
				generation: nextGeneration,
				mode: candidate.mode,
				list: candidate.list,
				viewport: candidate.viewport,
				host: candidate.host,
				searchInput: candidate.searchInput,
				resize: Object.freeze(resize || { revision: 0, updatedAt: 0 })
			});
		}

		function commitCandidate(candidate, details) {
			if (context && sameCandidate(candidate, context)) {
				activeCandidate = candidate;
				clearMissingState();
				ensureSwitcher(context);
				return context;
			}

			const previous = context;
			const nextGeneration = generation + 1;
			const nextContext = createContext(candidate, nextGeneration);
			if (!ensureSwitcher(nextContext)) return context;

			cleanupRecords(contextHandles);
			generation = nextGeneration;
			context = nextContext;
			activeCandidate = candidate;
			clearMissingState();
			safeCall(settings.onTransition, [context, previous, details || {}]);
			return context;
		}

		function deactivate(reason) {
			if (!context) {
				clearMissingState();
				return null;
			}
			const previous = context;
			cleanupRecords(contextHandles);
			generation += 1;
			context = null;
			activeCandidate = null;
			clearMissingState();
			detachSwitcher(reason || 'inactive');
			safeCall(settings.onInactive, [previous, reason || 'inactive']);
			return null;
		}

		function expireMissing(ticket) {
			absenceTimer = null;
			if (disposed || ticket !== absenceTicket || missingSince == null || !context) return;
			const elapsed = Math.max(0, finiteNumber(clockNow(), 0) - missingSince);
			if (elapsed < absenceGraceMs) {
				absenceTimer = setTimer(() => expireMissing(ticket), absenceGraceMs - elapsed);
				return;
			}
			deactivate('absence-timeout');
		}

		function keepDuringAbsence(details) {
			if (!context) return null;
			const currentTime = finiteNumber(details && details.now, finiteNumber(clockNow(), 0));
			if (missingSince == null) {
				missingSince = currentTime;
				clearAbsenceTimer();
				const ticket = absenceTicket;
				absenceTimer = setTimer(() => expireMissing(ticket), absenceGraceMs);
			}
			const elapsed = Math.max(0, currentTime - missingSince);
			safeCall(settings.onMissing, [context, elapsed, details || {}]);
			if (elapsed >= absenceGraceMs) return deactivate('absence-timeout');
			return context;
		}

		function reconcile(candidates, details) {
			if (disposed) return null;
			const selectionOptions = {
				visibilityResolver: settings.visibilityResolver,
				preferredMode: details && details.preferredMode
			};
			const candidate = selectActiveCandidate(candidates, context, selectionOptions);
			if (!candidate) return keepDuringAbsence(details || {});
			return commitCandidate(candidate, details || {});
		}

		function isCurrentGeneration(token) {
			const value = token && typeof token === 'object' ? token.generation : token;
			return !disposed && !!context && Number(value) === generation;
		}

		function guard(token, callback) {
			return function guardedCallback() {
				if (!isCurrentGeneration(token)) return undefined;
				return callback.apply(this, arguments);
			};
		}

		function runIfCurrent(token, callback) {
			if (!isCurrentGeneration(token)) return false;
			callback(context);
			return true;
		}

		function defer(callback, delay) {
			if (!context || disposed || typeof callback !== 'function') return function noop() {};
			const token = generation;
			let timer = null;
			let disposeRegistration = function noop() {};
			let cancelled = false;
			const cancel = () => {
				if (cancelled) return;
				cancelled = true;
				if (timer != null) clearTimer(timer);
				timer = null;
			};
			timer = setTimer(() => {
				timer = null;
				try {
					if (!cancelled && isCurrentGeneration(token)) callback(context);
				} finally {
					disposeRegistration();
				}
			}, Math.max(0, finiteNumber(delay, 0)));
			disposeRegistration = registerHandle(cancel, { scope: 'context', generation: token });
			return disposeRegistration;
		}

		function updateResizeMetadata(token, roleOrPatch, rect) {
			if (!isCurrentGeneration(token)) return false;
			const patch = {};
			if (typeof roleOrPatch === 'string') {
				if (!RESIZE_ROLES.has(roleOrPatch)) return false;
				const normalized = normalizeRect(rect);
				if (!normalized) return false;
				patch[roleOrPatch] = normalized;
			} else if (roleOrPatch && typeof roleOrPatch === 'object') {
				for (const role of RESIZE_ROLES) {
					if (!hasOwn(roleOrPatch, role)) continue;
					const normalized = normalizeRect(roleOrPatch[role]);
					if (normalized) patch[role] = normalized;
				}
			}
			if (!Object.keys(patch).length) return false;

			const previous = context;
			const resize = Object.freeze({
				...previous.resize,
				...patch,
				revision: finiteNumber(previous.resize && previous.resize.revision, 0) + 1,
				updatedAt: finiteNumber(clockNow(), 0)
			});
			context = createContext(activeCandidate, generation, resize);
			safeCall(settings.onResize, [context, previous]);
			return true;
		}

		function observeResize(target, role, ResizeObserverConstructor) {
			if (!context || !target || !RESIZE_ROLES.has(role)) return null;
			const Constructor = ResizeObserverConstructor
				|| settings.ResizeObserver
				|| (root && root.ResizeObserver);
			if (typeof Constructor !== 'function') return null;
			const token = generation;
			const observer = new Constructor(entries => {
				if (!isCurrentGeneration(token)) return;
				const entry = Array.isArray(entries)
					? entries.find(value => !value || !value.target || value.target === target) || entries[0]
					: null;
				const nextRect = entry && (entry.contentRect || entry.borderBoxSize) || elementRect(target);
				updateResizeMetadata(token, role, nextRect);
			});
			try {
				observer.observe(target);
			} catch (error) {
				safeCall(settings.onError, [error]);
				cleanupFunction(observer)();
				return null;
			}
			registerHandle(observer, { scope: 'context', generation: token });
			const initialRect = elementRect(target);
			if (initialRect) updateResizeMetadata(token, role, initialRect);
			return observer;
		}

		function connect(connection) {
			const details = connection || {};
			const target = details.root;
			const resolveCandidates = details.resolveCandidates;
			const Constructor = details.MutationObserver
				|| settings.MutationObserver
				|| (root && root.MutationObserver);
			if (!target || typeof resolveCandidates !== 'function' || typeof Constructor !== 'function') return function noop() {};

			const requestFrame = details.requestAnimationFrame
				|| settings.requestAnimationFrame
				|| (root && root.requestAnimationFrame && root.requestAnimationFrame.bind(root))
				|| (callback => setTimer(callback, 0));
			const cancelFrame = details.cancelAnimationFrame
				|| settings.cancelAnimationFrame
				|| (root && root.cancelAnimationFrame && root.cancelAnimationFrame.bind(root))
				|| clearTimer;
			let frame = null;
			let closed = false;

			const scan = reason => {
				if (closed || disposed) return;
				const preferredMode = typeof details.resolvePreferredMode === 'function'
					? details.resolvePreferredMode()
					: details.preferredMode;
				reconcile(resolveCandidates(), { reason, preferredMode });
			};
			const scheduleScan = () => {
				if (closed || frame != null) return;
				frame = requestFrame(() => {
					frame = null;
					scan('mutation');
				});
			};
			const observer = new Constructor(records => {
				const relevant = !Array.isArray(records) || records.some(record => {
					if (typeof details.isRelevantMutation === 'function') {
						try { return details.isRelevantMutation(record) === true; }
						catch (_) { return true; }
					}
					if (!record || record.type === 'childList') return true;
					return record.type === 'attributes' && OBSERVED_ATTRIBUTES.includes(record.attributeName);
				});
				if (relevant) scheduleScan();
			});
			observer.observe(target, {
				subtree: true,
				childList: true,
				attributes: true,
				attributeFilter: OBSERVED_ATTRIBUTES.slice()
			});
			const disposeConnection = () => {
				if (closed) return;
				closed = true;
				if (frame != null) cancelFrame(frame);
				frame = null;
				observer.disconnect();
			};
			const unregister = registerHandle(disposeConnection, { scope: 'controller' });
			scan('connect');
			return unregister;
		}

		function setSwitcher(nextSwitcher) {
			if (switcher === nextSwitcher) return switcher;
			if (switcher) detachSwitcher('replace');
			switcher = nextSwitcher || null;
			if (switcher && context) ensureSwitcher(context);
			return switcher;
		}

		function dispose() {
			if (disposed) return;
			disposed = true;
			cleanupRecords(contextHandles);
			cleanupRecords(controllerHandles);
			clearMissingState();
			detachSwitcher('dispose');
			context = null;
			activeCandidate = null;
		}

		return Object.freeze({
			reconcile,
			connect,
			getContext: () => context,
			getGeneration: () => generation,
			getSwitcher: () => switcher,
			setSwitcher,
			isCurrentGeneration,
			guard,
			runIfCurrent,
			defer,
			registerHandle,
			registerObserver: registerHandle,
			updateResizeMetadata,
			observeResize,
			deactivate,
			dispose,
			isDisposed: () => disposed
		});
	}

	return Object.freeze({
		OBSERVED_ATTRIBUTES,
		DEFAULT_ABSENCE_GRACE_MS,
		normalizeMode,
		normalizeRect,
		elementVisibility,
		normalizeCandidate,
		sameCandidate,
		selectActiveCandidate,
		createLifecycleController
	});
});

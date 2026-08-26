(function attachPenaInteractions(root, factory) {
	'use strict';

	const api = factory();
	if (root && typeof root === 'object') {
		root.__PENA_INTERACTIONS__ = api;
	}
	if (typeof module === 'object' && module && module.exports) {
		module.exports = api;
	}
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function createPenaInteractionsModule() {
	'use strict';

	const IDLE = 'idle';
	const GESTURE_KINDS = Object.freeze(['context', 'eyedropper', 'drag', 'multiselect']);
	const GESTURE_KIND_SET = new Set(GESTURE_KINDS);
	const LIFECYCLE_RESETS = Object.freeze(['drop', 'pointercancel', 'blur', 'route']);
	const DEFAULT_TOKEN_TTL_MS = 30000;
	let controllerSequence = 0;

	function hasOwn(value, key) {
		return Object.prototype.hasOwnProperty.call(value, key);
	}

	function normalizeKind(kind, allowIdle = false) {
		const value = String(kind == null ? '' : kind).trim().toLowerCase();
		if (allowIdle && value === IDLE) return IDLE;
		if (!GESTURE_KIND_SET.has(value)) {
			throw new TypeError(`Unknown interaction kind: ${String(kind)}`);
		}
		return value;
	}

	function normalizeMode(mode) {
		const value = String(mode == null ? '' : mode).trim().toLowerCase();
		if (value === 'chat') return 'chats';
		if (value === 'task') return 'tasks';
		if (value === 'chats' || value === 'tasks') return value;
		throw new TypeError(`Unknown interaction mode: ${String(mode)}`);
	}

	function normalizeDialogId(dialogId) {
		const value = String(dialogId == null ? '' : dialogId).trim().toLowerCase();
		if (!value) throw new TypeError('dialogId is required');
		return value;
	}

	function normalizePointerId(pointerId) {
		if (pointerId === undefined || pointerId === null || pointerId === '') return null;
		return String(pointerId);
	}

	function finiteNow(now) {
		const value = Number(now());
		if (!Number.isFinite(value)) throw new TypeError('now() must return a finite number');
		return value;
	}

	function finiteTtl(value) {
		const ttl = Number(value);
		if (!Number.isFinite(ttl) || ttl <= 0) throw new TypeError('tokenTtlMs must be a positive number');
		return ttl;
	}

	function eventIdentitySource(candidate) {
		if (!candidate || typeof candidate !== 'object') return null;
		return candidate.penaInteractionIdentity
			|| candidate.interactionIdentity
			|| candidate.detail?.penaInteractionIdentity
			|| candidate.detail?.interactionIdentity
			|| candidate;
	}

	function normalizeEventIdentity(candidate) {
		const source = eventIdentitySource(candidate);
		if (!source || typeof source !== 'object') return null;

		const kind = source.kind ?? source.gestureKind;
		const mode = source.mode ?? source.penaMode;
		const dialogId = source.dialogId ?? source.penaDialogId;
		if (kind == null || mode == null || dialogId == null) return null;

		return {
			kind: normalizeKind(kind),
			mode: normalizeMode(mode),
			dialogId: normalizeDialogId(dialogId),
			pointerId: normalizePointerId(source.pointerId ?? source.penaPointerId)
		};
	}

	function createInteractionState(options = {}) {
		const now = typeof options.now === 'function' ? options.now : Date.now;
		const tokenTtlMs = finiteTtl(options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS);
		const controllerId = ++controllerSequence;
		let generation = 0;
		let active = null;
		let lastResetReason = '';

		function expireIfNeeded() {
			if (!active || finiteNow(now) <= active.expiresAt) return false;
			active = null;
			lastResetReason = 'expired';
			return true;
		}

		function snapshot() {
			expireIfNeeded();
			return Object.freeze({
				state: active?.kind || IDLE,
				active: active ? active.token : null,
				consumed: !!active?.consumed,
				generation,
				lastResetReason
			});
		}

		function begin(kind, identity) {
			const normalizedKind = normalizeKind(kind);
			const source = identity && typeof identity === 'object' ? identity : {};
			const startedAt = finiteNow(now);
			const mode = normalizeMode(source.mode);
			const dialogId = normalizeDialogId(source.dialogId);
			const pointerId = normalizePointerId(source.pointerId);
			generation += 1;

			const token = Object.freeze({
				id: `pena-interaction-${controllerId}-${generation}`,
				kind: normalizedKind,
				mode,
				dialogId,
				pointerId,
				generation,
				startedAt,
				expiresAt: startedAt + tokenTtlMs
			});

			active = {
				kind: normalizedKind,
				mode,
				dialogId,
				pointerId,
				expiresAt: token.expiresAt,
				token,
				consumed: false
			};
			lastResetReason = '';
			return token;
		}

		function matchTokenCandidate(candidate) {
			if (!active) return { recognized: false, matches: false };
			if (candidate === active.token) return { recognized: true, matches: true };
			if (typeof candidate === 'string') {
				return { recognized: true, matches: candidate === active.token.id };
			}
			if (!candidate || typeof candidate !== 'object') {
				return { recognized: false, matches: false };
			}
			if (hasOwn(candidate, 'token')) {
				return {
					recognized: true,
					matches: candidate.token === active.token || candidate.token === active.token.id
				};
			}

			const looksLikeToken = hasOwn(candidate, 'id')
				&& hasOwn(candidate, 'generation')
				&& hasOwn(candidate, 'expiresAt');
			if (!looksLikeToken) return { recognized: false, matches: false };
			return {
				recognized: true,
				matches: candidate.id === active.token.id
					&& candidate.generation === active.token.generation
					&& candidate.kind === active.kind
			};
		}

		function identityMatches(candidate) {
			let identity;
			try {
				identity = normalizeEventIdentity(candidate);
			} catch {
				return false;
			}
			if (!identity || identity.kind !== active.kind || identity.mode !== active.mode) return false;
			if (active.kind === 'eyedropper') return true;
			return identity.dialogId === active.dialogId && identity.pointerId === active.pointerId;
		}

		function consumeClick(candidate) {
			expireIfNeeded();
			if (!active || active.consumed) return false;
			const tokenMatch = matchTokenCandidate(candidate);
			if (tokenMatch.recognized ? !tokenMatch.matches : !identityMatches(candidate)) return false;

			active.consumed = true;
			if (active.kind === 'eyedropper') {
				active = null;
				lastResetReason = 'consumed:eyedropper';
			}
			return true;
		}

		function end(kind) {
			expireIfNeeded();
			const normalizedKind = normalizeKind(kind);
			if (!active || active.kind !== normalizedKind) return false;
			active = null;
			lastResetReason = `end:${normalizedKind}`;
			return true;
		}

		function reset(reason) {
			const normalizedReason = String(reason == null ? '' : reason).trim().toLowerCase() || 'reset';
			const hadActiveGesture = !!active;
			active = null;
			generation += 1;
			lastResetReason = normalizedReason;
			return hadActiveGesture;
		}

		return Object.freeze({ begin, consumeClick, end, reset, snapshot });
	}

	const defaultState = createInteractionState();
	return Object.freeze({
		IDLE,
		GESTURE_KINDS,
		LIFECYCLE_RESETS,
		DEFAULT_TOKEN_TTL_MS,
		createInteractionState,
		begin: defaultState.begin,
		consumeClick: defaultState.consumeClick,
		end: defaultState.end,
		reset: defaultState.reset,
		snapshot: defaultState.snapshot
	});
});

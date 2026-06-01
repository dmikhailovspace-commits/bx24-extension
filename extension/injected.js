

	// URL логотипа: через data-атрибут (обычная инъекция) или через глобал (executeScript-инъекция)
	const _PENA_LOGO_URL = (function() {
		try { return window.__PENA_LOGO_URL_OVERRIDE__ || document.currentScript?.dataset?.logoUrl || ''; } catch(e) { return ''; }
	})();

	(function () {

	if (window.__ANITREC_RUNNING__) { return; }
	window.__ANITREC_RUNNING__ = '7.1.20';

	const VER = '7.1.20';
	const TAG = 'PENA: CHAT SORTER';
	const LBL = `%c[${TAG}]`;
	const CSS_LOG  = 'background:#000;color:#fff;padding:1px 4px;border-radius:10px';
	const CSS_WARN = 'background:#8B5E00;color:#fff;padding:1px 4px;border-radius:10px';
	const CSS_ERR  = 'background:#7F1D1D;color:#fff;padding:1px 4px;border-radius:10px';
	const _PENA_BASE_DPR = window.devicePixelRatio || 1;

	const log  = (...a) => console.log(LBL, CSS_LOG, ...a);
	const warn = (...a) => console.log(LBL, CSS_WARN, ...a);
	const err  = (...a) => console.error(LBL, CSS_ERR, ...a);

	const IS_FRAME = self !== top;
	const qs = new URLSearchParams(location.search || '');
	const IS_OL_FRAME =
	IS_FRAME &&
	/\/desktop_app\/\?/i.test(location.href) &&
	(qs.get('IM_LINES') === 'Y' || /IM_LINES=Y/i.test(location.href));
	function isVisibleElement(el) {
		if (!el) return false;
		const st = getComputedStyle(el);
		if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
		const r = el.getBoundingClientRect();
		return r.width > 0 && r.height > 0;
	}

	function findVisibleInternalContainer(selector) {
		return Array.from(document.querySelectorAll(selector)).find(isVisibleElement) || null;
	}

	function isInternalRecentDOM() {
		const c = findVisibleInternalContainer('.bx-im-list-container-recent__elements');
		return !!c?.querySelector('.bx-im-list-recent-item__wrap');
	}

	function isInternalTaskDOM() {
		const c = findVisibleInternalContainer('.bx-im-list-container-task__elements');
		return !!c?.querySelector('.bx-im-list-recent-item__wrap');
	}

	function isInternalChatsDOM() {
		return isInternalRecentDOM() || isInternalTaskDOM();
	}

	function findContainerInternal() {

		const taskList = findVisibleInternalContainer('.bx-im-list-container-task__elements');
		if (taskList) return taskList;
		return findVisibleInternalContainer('.bx-im-list-container-recent__elements');
	}



	function findContainerOL() {
	return document.querySelector('.bx-messenger-recent-wrap.bx-messenger-recent-lines-wrap');
}

	function findContainer() {
	if (IS_OL_FRAME) return findContainerOL();
	if (isInternalChatsDOM()) return findContainerInternal();
	return null;
}

	function getCurrentPortalHost() {
		return window.location.host;
	}

	function extractChatIdNumber(el) {
		const id = (el?.dataset?.id || el?.getAttribute?.('data-id') || el?.querySelector?.('[data-id]')?.getAttribute?.('data-id') || '').toString();
		if (!id.startsWith('chat')) return null;
		const n = parseInt(id.slice(4), 10);
		return Number.isFinite(n) ? n : null;
	}


	const OL_URL_RX =
	/(\/rest\/.*im\.recent\.(list|get|pin)|\/bitrix\/services\/main\/ajax\.php\?[^#]*action=im\.recent\.(list|get|pin))/i;
	let gateOpened = false;
	let openGateResolve;
	const gatePromise = new Promise(r => (openGateResolve = r));
	function openGate(reason, url) {
	if (gateOpened) return;
	gateOpened = true;
	log('GATE OPEN', { reason, url });
	openGateResolve();
}
	function maybeOpenGate(from, url) {
	if (!gateOpened && OL_URL_RX.test(String(url || ''))) openGate(from, url);
}

	(function hookFetch() {
	const orig = window.fetch && window.fetch.bind(window);
	if (!orig) return;
	window.fetch = function (input, init) {
	try { maybeOpenGate('fetch', typeof input === 'string' ? input : input?.url); } catch {}
	return orig(input, init);
};
})();
	(function hookXHR() {
	const XO = window.XMLHttpRequest;
	if (!XO) return;
	const _open = XO.prototype.open;
	const _send = XO.prototype.send;
	XO.prototype.open = function (m, url, ...rest) { this.__anit_url = url; return _open.call(this, m, url, ...rest); };
	XO.prototype.send = function (body) { try { maybeOpenGate('xhr', this.__anit_url || ''); } catch {} return _send.call(this, body); };
})();

	function armDomRetroGate() {
	if (!IS_OL_FRAME) return;
	const c = findContainerOL();
	if (c && c.querySelector('.bx-messenger-cl-item')) openGate('dom-retro', location.href);
	requestAnimationFrame(() => {
	const cc = findContainerOL();
	if (cc && cc.querySelector('.bx-messenger-cl-item')) openGate('dom-retro-rAF', location.href);
	else setTimeout(() => {
	const ccc = findContainerOL();
	if (ccc && ccc.querySelector('.bx-messenger-cl-item')) openGate('dom-retro-timeout', location.href);
}, 250);
});
}

		async function waitForEl(locator, {timeout=8000, interval=100} = {}) {
			const isFn = typeof locator === 'function';
			const t0 = performance.now();
			while (performance.now() - t0 < timeout) {
				const el = isFn ? locator() : document.querySelector(locator);
				if (el) return el;
				await new Promise(r => setTimeout(r, interval));
			}
			return null;
		}


		function findInternalScrollContainer() {
			const list =
				document.querySelector('.bx-im-list-container-task__elements') ||
				document.querySelector('.bx-im-list-container-recent__elements');
			if (!list) return null;


			let n = list;
			for (let i = 0; i < 6 && n; i++) {
				if (n.classList && n.classList.contains('bx-im-list-recent__scroll-container')) return n;
				n = n.parentElement;
			}


			const direct =
				document.querySelector('.bx-im-list-task__scroll-container') ||
				document.querySelector('.bx-im-list-recent__scroll-container');
			if (direct) return direct;


			n = list.parentElement;
			while (n) {
				const st = getComputedStyle(n);
				if (/(auto|scroll)/i.test(st.overflowY)) return n;
				n = n.parentElement;
			}
			return null;
		}
	function waitForBody(timeout = 5000) {
	return new Promise((resolve, reject) => {
	if (document.body) return resolve(document.body);
	const done = () => { if (document.body) { cleanup(); resolve(document.body); } };
	const cleanup = () => { clearInterval(t); document.removeEventListener('DOMContentLoaded', done); };
	const t = setInterval(done, 50);
	document.addEventListener('DOMContentLoaded', done);
	setTimeout(() => { cleanup(); document.body ? resolve(document.body) : reject(new Error('body-timeout')); }, timeout);
});
}


		function autoScrollWithObserver(
			{ scrollEl = null, observeEl = null, tick = 250, idleLimit = 1500, maxTime = 60000, onProgress = null } = {}
		) {
			let _stopped = false;
			let _cancelFn = () => { _stopped = true; };
			const promise = new Promise(async (resolve) => {

				if (!scrollEl) {
					scrollEl = await waitForEl(findInternalScrollContainer, {timeout: 10000, interval: 100});
				}
				if (_stopped) { resolve(); return; }
				if (!observeEl) {
					observeEl = await waitForEl(
						() => document.querySelector('.bx-im-list-container-task__elements') ||
						      document.querySelector('.bx-im-list-container-recent__elements'),
						{timeout: 10000, interval: 100}
					);
				}
				if (!scrollEl) { console.warn('[ANIT-CHATSORTER] autoScroll: не найден scroll container'); return resolve(); }
				if (!observeEl) observeEl = scrollEl;

				let changed = false, idle = 0, t0 = performance.now();

				const scrollDown = () => {

					scrollEl.scrollTop = scrollEl.scrollHeight;
				};

				const obs = new MutationObserver(() => { changed = true; });
				obs.observe(observeEl, { childList: true, subtree: true });

				let _lastPct = 0;
				const id = setInterval(() => {
					if (_stopped) { clearInterval(id); obs.disconnect(); resolve(); return; }
					const before = scrollEl.scrollTop;
					scrollDown();

					if (onProgress) {
						const total = scrollEl.scrollHeight - scrollEl.clientHeight;
						if (total > 0) {
							const pct = Math.min(94, Math.round(scrollEl.scrollTop / total * 100));
							if (pct > _lastPct) { _lastPct = pct; onProgress(pct); }
						}
					}

					if (changed) { changed = false; idle = 0; }
					else {
						const atBottom =
							Math.abs((scrollEl.scrollTop + scrollEl.clientHeight) - scrollEl.scrollHeight) < 2 ||
							scrollEl.scrollTop === before;
						if (atBottom) idle += tick;
					}

					const timedOut = (performance.now() - t0) > maxTime;
					if (idle >= idleLimit || timedOut) {
						clearInterval(id);
						obs.disconnect();
						console.log('[ANIT-CHATSORTER] Автоскролл остановлен. idle =', idle, 'ms, timedOut =', timedOut);
						resolve();
					}
				}, tick);
			});
			promise.cancel = () => { if (_cancelFn) _cancelFn(); };
			return promise;
		}



		function waitForContainer(timeout = 5000) {
	return new Promise((resolve, reject) => {
	const ok = () => { const c = findContainer(); if (c) { clearInterval(t); resolve(c); } };
	const t = setInterval(ok, 80);
	ok();
	setTimeout(() => { clearInterval(t); const c = findContainer(); c ? resolve(c) : reject(new Error('container-timeout')); }, timeout);
});
}


	async function getRecentTsMap() {
	const map = new Map();
	const BXNS = window.BX;
	if (!BXNS?.rest?.callMethod) {
	warn('BX.rest недоступен — работаю без tsMap');
	return map;
}
	try {
	const data = await new Promise((resolve, reject) => {
	BXNS.rest.callMethod('im.recent.list', { ONLY_OPENLINES: 'Y' }, (res) => {
	if (typeof res?.data !== 'function') return reject(new Error('unexpected BX.rest response'));
	resolve(res.data());
});
});
	const items = data?.items || data || [];
	for (const it of items) {
	const dialogId = String(
	it.dialogId ?? it.id ?? (it.chat_id != null ? 'chat' + it.chat_id : it.user_id != null ? it.user_id : '')
	).toLowerCase();
	let dateStr = it?.message?.date || it?.date_update || it?.date || it?.message?.DATE || '';
	if (typeof dateStr === 'string') dateStr = dateStr.replace(' ', 'T');
	const ts = Date.parse(dateStr) || 0;
	if (dialogId) map.set(dialogId, ts);
	}
		log('REST tsMap size', map.size);
		return map;
	} catch (e) {
		warn('REST error, без tsMap', e);
		return map;
	}
	}

	const normId = (raw) => {
	if (!raw) return '';
	const s = String(raw).toLowerCase();
	if (/^chat\d+/.test(s)) return s;
	if (/^\d+$/.test(s)) return 'chat' + s;
	return s;
};

	const isDialogControlId = (raw) => /^chat\d+$/i.test(normId(raw));
	const _CHAT_LIST_ITEM_SELECTOR = '.bx-messenger-cl-item,.bx-im-list-recent-item__wrap';
	const _CHAT_SEARCH_ITEM_SELECTOR = '.bx-im-search-result-item,.bx-im-search-item,.bx-im-dialog-search-result-item,.bx-im-list-search-item,[data-dialog-id],[data-dialog-id-value],[data-dialogid]';

	function _getOwnChatIdFromElement(el) {
		if (!el) return '';
		return normId(
			el.getAttribute?.('data-userid') ||
			el.getAttribute?.('data-id') ||
			el.getAttribute?.('data-dialog-id') ||
			el.getAttribute?.('data-dialog-id-value') ||
			el.getAttribute?.('data-dialogid') ||
			el.dataset?.userid ||
			el.dataset?.dialogId ||
			el.dataset?.dialogid ||
			el.dataset?.id
		);
	}

	function _isUsableDialogCandidate(el, { allowNestedId = false } = {}) {
		if (!el || el.nodeType !== 1) return false;
		const id = allowNestedId ? getChatIdFromElement(el) : _getOwnChatIdFromElement(el);
		if (!isDialogControlId(id)) return false;
		if (el.matches?.(`${_CHAT_LIST_ITEM_SELECTOR},${_CHAT_SEARCH_ITEM_SELECTOR}`)) return true;
		const cls = String(el.className || '');
		if (!/bx-im|messenger|search|recent|task|dialog|chat/i.test(cls)) return false;
		const rect = el.getBoundingClientRect?.();
		return !rect || (rect.width >= 120 && rect.height >= 28);
	}

		function getChatItemElement(target) {
			if (!target) return null;

			if (IS_OL_FRAME) {
				const el = target.closest?.('.bx-messenger-cl-item');
				if (_isUsableDialogCandidate(el, { allowNestedId: true })) return el;
			}

			// Внутренние чаты / чаты задач
			const el2 = target.closest?.('.bx-im-list-recent-item__wrap');
			if (_isUsableDialogCandidate(el2, { allowNestedId: true })) return el2;

			const searchCandidate = target.closest?.(_CHAT_SEARCH_ITEM_SELECTOR);
			if (_isUsableDialogCandidate(searchCandidate, { allowNestedId: true })) return searchCandidate;

			let n = target.nodeType === 1 ? target : target.parentElement;
			for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
				if (n === document.body || n === document.documentElement) break;
				if (_isUsableDialogCandidate(n)) return n;
			}

			return null;
		}

		function getChatIdFromElement(el) {
			if (!el) return '';

			if (IS_OL_FRAME) {

				return normId(el.getAttribute('data-userid') || el.dataset.userid);
			}


			return normId(
				el.getAttribute('data-id') ||
				el.getAttribute('data-dialog-id') ||
				el.getAttribute('data-dialog-id-value') ||
				el.getAttribute('data-dialogid') ||
				el.dataset.dialogId ||
				el.dataset.dialogid ||
				el.dataset.id ||
				el.querySelector('[data-id]')?.getAttribute('data-id') ||
				el.querySelector('[data-dialog-id]')?.getAttribute('data-dialog-id') ||
				el.querySelector('[data-dialogid]')?.getAttribute('data-dialogid')
			);
		}

		function getVisibleChatElements() {
			const container = findContainer();
			const root = container || document;
			return IS_OL_FRAME
				? Array.from(root.querySelectorAll('.bx-messenger-cl-item'))
				: Array.from(new Set([
					...root.querySelectorAll('.bx-im-list-recent-item__wrap'),
					...document.querySelectorAll(_CHAT_SEARCH_ITEM_SELECTOR)
				])).filter(el => _isUsableDialogCandidate(el, { allowNestedId: true }));
		}

		function buildChatElementIndex() {
			const map = new Map();
			for (const el of getVisibleChatElements()) {
				const id = getChatIdFromElement(el);
				if (id && !map.has(id)) map.set(id, el);
			}
			return map;
		}

	function getChatTitleFromElement(el) {
		if (!el) return 'Диалог';
		const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
		if (IS_OL_FRAME) {
			return clean(el.querySelector('.bx-messenger-cl-user-title')?.textContent || el.getAttribute('title')) || 'Диалог';
		}
		const selectors = [
			'.bx-im-chat-title__text',
			'.bx-im-list-recent-item__title_text',
			'.bx-im-list-recent-item__title-text',
			'.bx-im-list-recent-item__title',
			'.bx-im-list-recent-item__name',
			'.bx-im-list-item__title',
			'.bx-im-list-item__name',
			'[data-title]',
			'[class*="title" i]'
		];
		for (const sel of selectors) {
			const node = el.matches?.(sel) ? el : el.querySelector?.(sel);
			const title = clean(node?.getAttribute?.('title') || node?.dataset?.title || node?.textContent);
			if (title) return title;
		}
		return clean(el.getAttribute('title') || el.dataset?.title || el.getAttribute('aria-label')) || 'Диалог';
	}

	function _normalizeDialogControlTitle(value) {
		return String(value || '')
			.replace(/\s+/g, ' ')
			.replace(/[«»"']/g, '')
			.trim()
			.toLowerCase();
	}

	function _isVisibleTextNodeCandidate(node) {
		if (!node || !node.isConnected) return false;
		const rect = node.getBoundingClientRect?.();
		if (!rect || rect.width < 8 || rect.height < 8) return false;
		const style = window.getComputedStyle?.(node);
		return !(style?.display === 'none' || style?.visibility === 'hidden' || Number(style?.opacity) === 0);
	}

	function _getActiveDialogTitleFromScreen() {
		if (IS_OL_FRAME) return '';
		const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
		const chatSelectors = [
			'.bx-im-dialog-chat-header__title',
			'.bx-im-dialog-header__title',
			'.bx-im-dialog-header__name',
			'.bx-im-chat-title__text',
			'.bx-im-dialog-chat__title',
			'.bx-im-sidebar-header__title',
			'[class*="dialog" i][class*="header" i] [class*="title" i]',
			'[class*="chat" i][class*="header" i] [class*="title" i]'
		];
		const taskSelectors = _isTaskViewRouteNow() ? [
			'.tasks-task-full-card-title',
			'.tasks-task-detail-title',
			'.tasks-task-title',
			'.task-detail-title',
			'.task-view-title',
			'[class*="task" i][class*="title" i]'
		] : [];
		const selectors = [...chatSelectors, ...taskSelectors];
		for (const sel of selectors) {
			let nodes = [];
			try { nodes = Array.from(document.querySelectorAll(sel)); } catch { nodes = []; }
			for (const node of nodes) {
				if (!_isVisibleTextNodeCandidate(node)) continue;
				if (node.closest?.('#anit-filters,#anit-dialog-control-dock,.dialog-control-palette')) continue;
				const title = clean(node.value || node.getAttribute?.('title') || node.getAttribute?.('aria-label') || node.textContent);
				if (title && title.length >= 2 && title.length <= 180) return title;
			}
		}
		return '';
	}

	function _getActiveDialogControlTaskIdFromScreen() {
		const fromUrl = (value) => _extractTaskIdFromTaskUrl(value || '');
		const current = fromUrl(`${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}`);
		if (current) return current;
		try {
			const frame = Array.from(document.querySelectorAll('iframe[src],iframe[data-src],iframe[data-url]'))
				.map(el => el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-url') || '')
				.find(url => /\/tasks\/task\/view\/\d+/i.test(url));
			const id = fromUrl(frame);
			if (id) return id;
		} catch {}
		return '';
	}

	function _findDialogControlItemIdByTaskId(taskId, items = _getDialogControlItems()) {
		const id = String(taskId || '').trim();
		if (!/^\d+$/.test(id)) return '';
		const item = (Array.isArray(items) ? items : []).find(candidate =>
			!_isDialogControlFolder(candidate) && String(candidate.taskId || '').trim() === id
		);
		return item ? normId(item.id) : '';
	}

	function _findDialogControlItemIdByTitle(title, items = _getDialogControlItems()) {
		const wanted = _normalizeDialogControlTitle(title);
		if (!wanted) return '';
		const candidates = (Array.isArray(items) ? items : []).filter(item => !_isDialogControlFolder(item));
		for (const item of candidates) {
			const current = _normalizeDialogControlTitle(item.title);
			if (current && (current === wanted || current.includes(wanted) || wanted.includes(current))) return normId(item.id);
		}
		return '';
	}

		function findChatElementById(id) {
			const wanted = normId(id);
			if (!wanted) return null;
			return buildChatElementIndex().get(wanted) || null;
		}

	function openChatElement(el) {
		if (!el) return false;
		const target =
			el.querySelector?.('a,button,[role="button"],.bx-im-list-recent-item__content,.bx-messenger-cl-user') ||
			el;
		target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
		target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
		target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
		return true;
	}

	function _getSafeTopWindow() {
		try {
			return window.top && window.top.location?.origin === window.location.origin ? window.top : null;
		} catch { return null; }
	}

	function _callBxRestMethod(method, params = {}) {
		return new Promise((resolve, reject) => {
			const topWin = _getSafeTopWindow();
			const BXNS = [window.BX, topWin?.BX].filter(Boolean).find(ns => typeof ns?.rest?.callMethod === 'function');
			const caller = BXNS?.rest?.callMethod;
			if (!caller) return reject(new Error('BX.rest недоступен'));
			try {
				caller.call(BXNS.rest, method, params, (res) => {
					try {
						if (typeof res?.error === 'function' && res.error()) {
							const details = typeof res.error_description === 'function' ? res.error_description() : res.error_description;
							reject(new Error(details || res.error()));
							return;
						}
						resolve(typeof res?.data === 'function' ? res.data() : res);
					} catch (e) {
						reject(e);
					}
				});
			} catch (e) {
				reject(e);
			}
		});
	}

	function _normalizeBitrixPath(rawUrl) {
		const raw = String(rawUrl || '').trim();
		if (!raw) return '';
		try {
			const url = new URL(raw, window.location.origin);
			if (url.origin !== window.location.origin) return '';
			return `${url.pathname}${url.search}${url.hash}`;
		} catch { return ''; }
	}

	function _extractTaskIdFromTaskUrl(rawUrl) {
		const path = _normalizeBitrixPath(rawUrl) || String(rawUrl || '');
		const m = /\/tasks\/task\/view\/(\d+)(?:\/|[?#]|$)/i.exec(path);
		return m ? m[1] : '';
	}

	function _getCurrentBitrixUserId() {
		const pathMatch = /\/company\/personal\/user\/(\d+)\//i.exec(window.location.pathname || '');
		if (pathMatch) return pathMatch[1];
		const topWin = _getSafeTopWindow();
		for (const BXNS of [window.BX, topWin?.BX].filter(Boolean)) {
			try {
				const id = typeof BXNS?.message === 'function' ? BXNS.message('USER_ID') : '';
				if (/^\d+$/.test(String(id || ''))) return String(id);
			} catch {}
			try {
				const id = BXNS?.Messenger?.Common?.getUserId?.() || BXNS?.user?.id;
				if (/^\d+$/.test(String(id || ''))) return String(id);
			} catch {}
		}
		return '';
	}

	function _buildTaskUrl(taskId) {
		const id = String(taskId || '').trim();
		if (!/^\d+$/.test(id)) return '';
		const userId = _getCurrentBitrixUserId();
		return userId ? `/company/personal/user/${userId}/tasks/task/view/${id}/?ta_sec=chat_tasks&ta_el=view_button` : '';
	}

	function _extractTaskMetaFromElement(el, fallbackTitle = '') {
		if (!el) return null;
		let taskUrl = '';
		try {
			taskUrl = Array.from(el.querySelectorAll?.('a[href]') || [])
				.map(a => a.getAttribute('href') || '')
				.map(_normalizeBitrixPath)
				.find(url => /\/tasks\/task\/view\/\d+/i.test(url)) || '';
		} catch {}

		const attrNames = ['taskId', 'taskid', 'task-id', 'data-task-id', 'entityId', 'entityid'];
		let taskId = _extractTaskIdFromTaskUrl(taskUrl);
		if (!taskId) {
			for (const name of attrNames) {
				const v = el.dataset?.[name] || el.getAttribute?.(name);
				if (/^\d+$/.test(String(v || ''))) {
					taskId = String(v);
					break;
				}
			}
		}
		if (!taskId) {
			const text = `${fallbackTitle || ''} ${el.textContent || ''}`;
			const m = /(?:задач[аиуы]?\s*|task\s*)?[#№]\s*(\d{2,})/i.exec(text);
			if (m) taskId = m[1];
		}
		if (!taskUrl && taskId) taskUrl = _buildTaskUrl(taskId);
		return taskUrl || taskId ? { taskId, taskUrl } : null;
	}

	function _extractTaskMetaFromDialogData(data) {
		if (!data || typeof data !== 'object') return null;
		const chat = data.chat && typeof data.chat === 'object' ? data.chat : data;
		const entityLink = chat.entity_link || chat.entityLink || data.entity_link || data.entityLink || null;
		const entityType = String(chat.entity_type || chat.entityType || data.entity_type || data.entityType || '').toUpperCase();
		const linkType = String(entityLink?.type || '').toUpperCase();
		let taskUrl = _normalizeBitrixPath(entityLink?.url || '');
		let taskId = _extractTaskIdFromTaskUrl(taskUrl);

		const entityId = String(chat.entity_id || chat.entityId || data.entity_id || data.entityId || '').trim();
		const linkedId = String(entityLink?.id || '').trim();
		if (!taskId && /^(TASKS|TASKS_TASK)$/.test(entityType) && /^\d+$/.test(entityId)) taskId = entityId;
		if (!taskId && linkType === 'TASKS' && /^\d+$/.test(linkedId)) taskId = linkedId;
		if (!taskUrl && taskId) taskUrl = _buildTaskUrl(taskId);

		return taskUrl || taskId ? { taskId, taskUrl } : null;
	}

	const _dialogTaskMetaCache = new Map();
	async function _resolveTaskMetaForDialog(dialogId) {
		const id = normId(dialogId);
		if (!id) return null;
		if (_dialogTaskMetaCache.has(id)) return _dialogTaskMetaCache.get(id);
		const promise = _callBxRestMethod('im.dialog.get', { DIALOG_ID: id })
			.then(_extractTaskMetaFromDialogData)
			.catch((e) => {
				warn('Не удалось получить связанную задачу для диалога', id, e?.message || e);
				return null;
			});
		_dialogTaskMetaCache.set(id, promise);
		const meta = await promise;
		if (meta) _dialogTaskMetaCache.set(id, meta);
		else _dialogTaskMetaCache.delete(id);
		return meta;
	}

function _rememberTaskMetaForDialogControlItem(item, meta) {
		if (!item || !meta) return false;
		let changed = false;
		if (meta.taskId && item.taskId !== String(meta.taskId)) {
			item.taskId = String(meta.taskId);
			changed = true;
		}
		if (meta.taskUrl && item.taskUrl !== meta.taskUrl) {
			item.taskUrl = meta.taskUrl;
			changed = true;
		}
		if (changed) _saveDialogControlItems();
		return changed;
	}

	function _extractDialogTitleFromDialogData(data) {
		const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
		const seen = new Set();
		const read = (obj, depth = 0) => {
			if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj)) return '';
			seen.add(obj);
			const keys = ['title', 'TITLE', 'name', 'NAME', 'dialogTitle', 'dialog_title', 'chatTitle', 'chat_title'];
			for (const key of keys) {
				const value = clean(obj[key]);
				if (value && !/^chat\d+$/i.test(value) && !/^\d+$/.test(value)) return value;
			}
			const nestedKeys = ['dialog', 'DIALOG', 'chat', 'CHAT', 'item', 'ITEM', 'result', 'RESULT', 'user', 'USER'];
			for (const key of nestedKeys) {
				const value = read(obj[key], depth + 1);
				if (value) return value;
			}
			return '';
		};
		return read(data);
	}

	function _extractTaskTitleFromData(data) {
		const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
		const task = data?.task || data?.TASK || data?.result?.task || data?.RESULT?.TASK || data?.result?.TASK || data?.RESULT?.task || data;
		return clean(task?.title || task?.TITLE || task?.name || task?.NAME);
	}

	async function _resolveTaskTitleForDialogControlItem(item) {
		if (!item) return '';
		let taskId = item.taskId ? String(item.taskId) : '';
		if (!taskId) {
			const meta = await _resolveTaskMetaForDialog(item.id);
			if (meta) {
				_rememberTaskMetaForDialogControlItem(item, meta);
				taskId = meta.taskId ? String(meta.taskId) : '';
			}
		}
		if (!taskId) return '';
		try {
			const data = await _callBxRestMethod('tasks.task.get', { taskId });
			return _extractTaskTitleFromData(data);
		} catch (e) {
			try {
				const data = await _callBxRestMethod('tasks.task.get', { id: taskId });
				return _extractTaskTitleFromData(data);
			} catch (e2) {
				warn('Не удалось получить название задачи', taskId, e2?.message || e2 || e);
				return '';
			}
		}
	}

	function _openBitrixUrl(rawUrl) {
		const path = _normalizeBitrixPath(rawUrl);
		if (!path) return false;
		const topWin = _getSafeTopWindow();
		const candidates = [topWin, window].filter(Boolean);
		for (const win of candidates) {
			try {
				const sidePanel = win.BX?.SidePanel?.Instance;
				if (typeof sidePanel?.open === 'function') {
					sidePanel.open(path, { cacheable: false });
					return true;
				}
			} catch {}
		}
		try {
			(topWin || window).location.assign(new URL(path, window.location.origin).href);
			return true;
		} catch {}
		return false;
	}

	function _isTaskViewRouteNow() {
		if (/\/tasks\/task\/view\/\d+/i.test(`${window.location.pathname || ''}${window.location.search || ''}`)) return true;
		try {
			return !!document.querySelector('iframe[src*="/tasks/task/view/"],iframe[data-src*="/tasks/task/view/"]');
		} catch { return false; }
	}

	async function _openTaskForDialogControlItem(item) {
		if (!item) return false;
		let meta = item.taskUrl
			? { taskId: item.taskId || _extractTaskIdFromTaskUrl(item.taskUrl), taskUrl: _normalizeBitrixPath(item.taskUrl) }
			: _extractTaskMetaFromDialogData(item);
		if (!meta?.taskUrl && item.taskId) meta = { taskId: String(item.taskId), taskUrl: _buildTaskUrl(item.taskId) };
		if (!meta?.taskUrl) meta = await _resolveTaskMetaForDialog(item.id);
		if (!meta?.taskUrl) return false;
		_rememberTaskMetaForDialogControlItem(item, meta);
		return _openBitrixUrl(meta.taskUrl);
	}

	function hasMentionMarker(el) {
		if (!el) return false;
		const selector = [
			'[class*="mention" i]',
			'[title*="упом" i]',
			'[title*="mention" i]',
			'[aria-label*="упом" i]',
			'[aria-label*="mention" i]',
			'[data-id*="mention" i]',
			'[data-testid*="mention" i]',
			'[data-test-id*="mention" i]'
		].join(',');
		try {
			if (el.matches?.(selector) || el.querySelector?.(selector)) return true;
		} catch {}
		const own = [
			el.className,
			el.getAttribute?.('title'),
			el.getAttribute?.('aria-label'),
			el.dataset ? Object.values(el.dataset).join(' ') : ''
		].join(' ').toLowerCase();
		return /mention|упом/.test(own);
	}

	let rankMap = new Map();
	let frozenSetSig = '';
	let tsMapOnce = null;
	let lastOrderSig = '';
	const currentSetSignature = (ids) => Array.from(new Set(ids)).sort().join('#');
	const currentOrderSignature = (ids) => ids.join('|');

	const RU_DAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
	const RU_MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
	function dateKey(ts) {
	if (!ts || ts <= 0) return 'nodate';
	const d = new Date(ts);
	return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
	function formatGroupTitleFromTS(ts) {
	if (!ts || ts <= 0) return 'Без даты';
	const d = new Date(ts);
	const now = new Date();
	const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const diffDays = Math.round((dayStart - d0)/86400000);
	if (diffDays === 0) return 'сегодня';
	if (diffDays === -1) return 'вчера';
	const w = RU_DAYS_SHORT[d.getDay()];
	return `${w}, ${d.getDate()} ${RU_MONTHS_GEN[d.getMonth()]}`;
}
	function rebuildDateGroups(tsMap) {
	if (!IS_OL_FRAME) return;
	const container = findContainerOL();
	if (!container) return;
	container.querySelectorAll('.bx-messenger-recent-group').forEach(n => n.remove());
	const items = Array.from(container.querySelectorAll('.bx-messenger-cl-item'))
	.filter(el => el.style.display !== 'none');
	let lastKey = null;
	for (const el of items) {
	const id = (el.getAttribute('data-userid') || el.dataset.userid || '').toLowerCase();
	const ts = tsMap?.get?.(id)   -1;
	const key = dateKey(ts);
	if (key !== lastKey) {
	const div = document.createElement('div');
	div.className = 'bx-messenger-recent-group';
	const span = document.createElement('span');
	span.className = 'bx-messenger-recent-group-title';
	span.textContent = formatGroupTitleFromTS(ts);
	div.appendChild(span);
	container.insertBefore(div, el);
	lastKey = key;
}
}
}


	const LS_KEY_BASE = 'anit.filters.v2';
	// Кэш текущего режима панели ? устанавливается явно при переключении,
	// чтобы getLSKey/saveFilters не зависели от живого DOM во время переходов.
	// Инициализируется до первого loadFilters().
	let _currentPanelMode = getPanelModeKey();
// Кэш фильтров по режиму ? изолирует вкладки браузера друг от друга:
// при переключении режима берём данные из памяти, а не перечитываем localStorage.
const _modeFiltersCache = {};
// Режимы, в которых авто-загрузка чатов уже выполнялась в текущей вкладке
const _prefetchedModes = new Set(JSON.parse((() => { try { return sessionStorage.getItem('pena.prefetchedModes'); } catch { return null; } })() || '[]'));
// Флаг активной предзагрузки ? на время прокрутки отключает фильтрацию
let _prefetchActive = false;
// в?Ђв?Р‚ Пресеты фильтров (раздельные для "чатов" и "чатов задач") в?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Р‚
const _LS_PRESETS_CHATS = 'pena.presets.chats';
const _LS_PRESETS_TASKS = 'pena.presets.tasks';
// Сбрасываем устаревший ключ (до v2.6)
try { localStorage.removeItem('pena.presets'); } catch {}
// Кеш массивов пресетов ? загружаются лениво при первом обращении к режиму
const _presetsData = { chats: null, tasks: null };
// Активный пресет для каждого режима (null = общий режим)
const _activePresetIds = { chats: null, tasks: null };
let _debugModeActive = false;
const _LS_DIALOG_CONTROL = 'pena.dialogControl.v1';
let _dialogControlActive = false;
let _dialogControlTimer = null;
let _dialogControlItems = {};
let _dialogControlMultiSelected = new Set();
let _dialogControlCurrentIds = { chats: null, tasks: null };
let _dialogControlMissTimer = null;
	let _dialogControlRefreshTimer = null;
	let _dialogControlLastSig = '';
	let _dialogControlDock = null;
	const _DIALOG_CONTROL_IDLE_MS = 10000;
	let _dialogControlPointerTracking = false;
	let _dialogControlLastPointerX = null;
	let _dialogControlLastPointerY = null;
	let _dialogControlLastPointerTs = 0;
	let _dialogControlSelectionSyncTimer = null;
	let _dialogControlTitleSyncTimer = null;
	let _dialogControlTitleSyncInFlight = false;
	let _dialogControlTitleLastSyncAt = 0;
	let _lastExpandedFiltersPaneHeight = 0;
	let _lastExpandedFiltersPaneBottom = 0;
	let _dialogDockHideFinalizeTimer = null;
	let _dialogDockAutoCloseTimer = null;
	let _panelModeSwitching = false;
	let _panelModeSwitchingVisualTimer = null;
	function _setPanelModeSwitching(active) {
		_panelModeSwitching = !!active;
		if (_panelModeSwitchingVisualTimer) {
			clearTimeout(_panelModeSwitchingVisualTimer);
			_panelModeSwitchingVisualTimer = null;
		}
		if (active) {
			document.documentElement.classList.add('anit-panel-mode-switching');
			return;
		}
		_panelModeSwitchingVisualTimer = setTimeout(() => {
			_panelModeSwitchingVisualTimer = null;
			document.documentElement.classList.remove('anit-panel-mode-switching');
		}, 280);
	}
// Режим текущей вкладки: 'chats' | 'tasks'
const _pMode = () => isTasksChatsModeNow() ? 'tasks' : 'chats';
const _pLSKey = (m) => m === 'tasks' ? _LS_PRESETS_TASKS : _LS_PRESETS_CHATS;
// Получить массив пресетов текущего режима (с ленивой загрузкой из localStorage)
const _getPresetsArr = () => {
	const m = _pMode();
	if (_presetsData[m] === null) {
		try {
			const raw = localStorage.getItem(_pLSKey(m));
			_presetsData[m] = raw !== null ? JSON.parse(raw) : [];
		} catch { _presetsData[m] = []; }
	}
	return _presetsData[m];
};
// Геттер/сеттер активного пресета текущего режима
const _getActiveId = () => _activePresetIds[_pMode()];
const _setActiveId = (id) => { _activePresetIds[_pMode()] = id; };
// Синхронизация пресетов между вкладками Битрикс24
let _presetChannel = null;
try { _presetChannel = new BroadcastChannel('pena-agency-presets-v2'); } catch {}
const _saveCustomPresets = () => {
	const m = _pMode();
	const arr = _getPresetsArr();
	try {
		localStorage.setItem(_pLSKey(m), JSON.stringify(arr));
		_presetChannel?.postMessage({ t: 'sync', mode: m, d: arr });
	} catch {}
};
if (_presetChannel) {
	_presetChannel.onmessage = (e) => {
		if (e.data?.t === 'sync' && Array.isArray(e.data.d) && e.data.mode) {
			const m = e.data.mode;
			_presetsData[m] = e.data.d;
			// Активный пресет мог быть удалён в РТ‘ругой вкладке
			if (_activePresetIds[m] && !_presetsData[m].find(p => p.id === _activePresetIds[m])) {
				_activePresetIds[m] = null;
			}
			// Обновляем UI только если текущий режим совпадает
			if (_pMode() === m && typeof filtersHost !== 'undefined' && filtersHost) {
				renderPresetsUI(filtersHost);
			}
		}
	};
}
	// Возвращает ключ localStorage для текущего режима панели
	function getLSKey() { return LS_KEY_BASE + '.' + _currentPanelMode; }
	const defaultFilters = () => ({
	unreadOnly: false,
	query: '',
	typesSelected: [],
	projectIndexes: [],
	responsibleIndexes: [],
	statusIndexes: [],
	hiddenProjectIndexes: [],
	hiddenResponsibleIndexes: [],
	sortMode: 'native',
	keywordTags: _currentPanelMode === 'tasks' ? [] : ['Scrum', 'Главная', 'Дизайн', 'Клиент'],
	selectedTags: [],
	intersectionTags: [],
	selectedIntersectionTags: [],
});
	let filters = loadFilters();
	function loadFilters() {
	try {
		const key = getLSKey();
		const raw = localStorage.getItem(key);
		const loaded = JSON.parse(raw || '{}');
		delete loaded.withAttach;
		return { ...defaultFilters(), ...loaded };
	} catch { return defaultFilters(); }
}
	function saveFilters() {
	_modeFiltersCache[_currentPanelMode] = JSON.parse(JSON.stringify(filters));
	try { localStorage.setItem(getLSKey(), JSON.stringify(filters)); } catch {}
}
	// Универсальное сохранение: в общее хранилище + в активный пресет (если есть)
	function persistFilters(options = {}) {
		saveFilters();
		saveFiltersToActivePreset(options);
	}
	function getItemMetaOL(el) {
	const id = normId(el.getAttribute('data-userid') || el.dataset.userid);
	const status = parseInt(el.getAttribute('data-status') || el.dataset.status || '0', 10) || 0;
	const countText = (el.querySelector('.bx-messenger-cl-count-digit')?.textContent || '').replace(/\D+/g, '');
	const unreadCount = parseInt(countText || '0', 10) || 0;
	const hasMention = hasMentionMarker(el);
	const hasUnread = unreadCount > 0 || !!el.querySelector('.bx-messenger-cl-count-digit') || hasMention;
	const lastText = (el.querySelector('.bx-messenger-cl-user-desc')?.textContent || '').trim().toLowerCase();
	const title = (el.querySelector('.bx-messenger-cl-user-title')?.textContent || '').trim().toLowerCase();
	const cls = el.className || '';
	const isWhatsApp = /-wz_whatsapp_/i.test(cls);
	const isTelegram = /-wz_telegram_/i.test(cls);
	return { id, status, hasUnread, hasLater: false, hasMention, unreadCount, lastText, title, isWhatsApp, isTelegram, type: 'ol' };
}

	function getItemMetaInternal(el) {
	const id = normId(el.getAttribute('data-id') || el.dataset.id || el.querySelector('[data-id]')?.getAttribute('data-id'));
		const title = (
			el.querySelector('.bx-im-chat-title__text')?.getAttribute('title') ||
			el.querySelector('.bx-im-chat-title__text')?.textContent || ''
		).trim().toLowerCase();
		const lastText = (
			el.querySelector('.bx-im-list-recent-item__message_text')?.textContent || ''
		).trim().toLowerCase();


		let counterValue = 0;
		const getUnread = () => {

			const numEl = el.querySelector('.bx-im-list-recent-item__counter_number');
			if (numEl) {
				const n = parseInt((numEl.textContent || '').replace(/\D+/g, ''), 10);
				counterValue = Number.isFinite(n) ? n : 0;
				return Number.isFinite(n) && n > 0;
			}

			const cntWrap = el.querySelector('.bx-im-list-recent-item__counters');
			if (cntWrap) {
				const n = parseInt((cntWrap.textContent || '').replace(/\D+/g, ''), 10);
				counterValue = Number.isFinite(n) ? n : 0;
				return Number.isFinite(n) && n > 0;
			}
			counterValue = 0;
			return false;
		};
		const hasMention = hasMentionMarker(el);
		const hasUnread = getUnread() || hasMention;
		// «Посмотреть позже» (IM_LIB_MENU_UNREAD) ? Битрикс вызывает im.v2.Chat.unread.json,
		// после чего в DOM появляется counter_number с классом --no-counter (пустой элемент,
		// число отсутствует). У обычных прочитанных чатов counter_number не рендерится вовсе.
		const _noCounterEl = el.querySelector('.bx-im-list-recent-item__counter_number');
		const hasLater = !hasUnread && !!_noCounterEl && _noCounterEl.classList.contains('--no-counter');
		const hasSelfAuthor = !!el.querySelector('.bx-im-list-recent-item__self_author-icon');
		const msgText = el.querySelector('.bx-im-list-recent-item__message_text');
		const hasAuthorAvatar = !!(msgText && msgText.querySelector('.bx-im-list-recent-item__author-avatar'));
		// Системное = нет ни стрелочки, ни аватарки (для фильтра «Скрыть системные» ? скрывать все такие)
		const isSystemMessage = !hasSelfAuthor && !hasAuthorAvatar;
		// Только если 1 непрочитанное и оно системное ? не показывать в «Непрочитанные»; если >1 ? показываем
		const isSystemUnreadOnly = hasUnread && counterValue === 1 && isSystemMessage;
	const avatar = el.querySelector('.bx-im-avatar__container') || el;
	const cl = (avatar?.className || '') + ' ' + (el.querySelector('.bx-im-chat-title__icon')?.className || '');
	const has = (rx) => rx.test(cl) || rx.test(title) /*|| rx.test(lastText)*/;

	let itemType = 'other';
	if (has(/--user\b/)) itemType = 'dialog';
	if (has(/--chat\b/)) itemType = 'chat';
	if (has(/--videoconf\b/)) itemType = 'videoconf';
	if (has(/--support24|--support24Question/)) itemType = 'support';
	if (has(/--sonetGroup\b/) || !!el.querySelector('.ui-avatar.--hexagon')) itemType = 'group';
	if (has(/--general\b/)) itemType = 'general';
	if (has(/--network\b/)) itemType = 'network';
	if (has(/--tasks\b/)) itemType = 'tasks';
	if (has(/--call\b/)) itemType = 'phone';
	if (has(/--calendar\b/)) itemType = 'calendar';
	if (has(/--extranet|--guest/)) itemType = 'guests';

	// Custom categories (PENA extension)
	if (itemType === 'other') {
		const customCats = loadCustomCats();
		for (const cc of customCats) {
			if (cc.rxPattern) {
				try {
					const ccRx = new RegExp(cc.rxPattern, 'i');
					if (ccRx.test(cl) || ccRx.test(title)) { itemType = cc.type; break; }
				} catch {}
			}
		}
	}

	const meta = { id, hasUnread, hasLater, hasMention, unreadCount: counterValue, lastText, title, type: itemType, status: 0, isWhatsApp: false, isTelegram: false, isSystemMessage, isSystemUnreadOnly };

	// project mapping only in "task chats" mode
	if (isTasksChatsModeNow() && window.__anitProjectLookup?.chatToProject) {
		const chatId = extractChatIdNumber(el);
		if (chatId !== null) {
			const chatToProject = window.__anitProjectLookup.chatToProject;
			const map = chatToProject instanceof Map ? chatToProject : new Map(chatToProject || []);
			const pIdx = map.get(chatId);
			if (pIdx !== undefined) {
				const p = (window.__anitProjectLookup.projects || [])[pIdx];
				meta.projectIndex = pIdx;
				meta.projectName = (p && p[1]) ? p[1] : 'Без проекта';
			} else {
				meta.projectIndex = -1;
				meta.projectName = 'Без проекта';
			}
		}
	}

	// responsible mapping only in "task chats" mode
	if (isTasksChatsModeNow() && window.__anitProjectLookup?.chatToResponsible) {
		const chatId = extractChatIdNumber(el);
		if (chatId !== null) {
			const chatToResponsible = window.__anitProjectLookup.chatToResponsible;
			const map = chatToResponsible instanceof Map ? chatToResponsible : new Map(chatToResponsible || []);
			const rIdx = map.get(chatId);
			if (rIdx !== undefined) {
				const u = (window.__anitProjectLookup.users || [])[rIdx];
				meta.responsibleIndex = rIdx;
				meta.responsibleName = (u && u[1]) ? u[1] : 'Без исполнителя';
			} else {
				meta.responsibleIndex = 0;
				meta.responsibleName = 'Без исполнителя';
			}
		}
	}

	// status mapping only in "task chats" mode (если расширение поддерживает статусы)
	if (isTasksChatsModeNow() && window.__anitProjectLookup?.chatToStatus) {
		const chatId = extractChatIdNumber(el);
		if (chatId !== null) {
			const chatToStatus = window.__anitProjectLookup.chatToStatus;
			const map = chatToStatus instanceof Map ? chatToStatus : new Map(chatToStatus || []);
			const sIdx = map.get(chatId);
			if (sIdx !== undefined) {
				const st = (window.__anitProjectLookup.statuses || [])[sIdx];
				meta.statusIndex = sIdx;
				meta.statusName = (st && st[1]) ? st[1] : 'Без статуса';
			} else {
				meta.statusIndex = 0;
				meta.statusName = 'Без статуса';
			}
		}
	}

	return meta;
}

	function getItemMeta(el) {
	if (IS_OL_FRAME) return getItemMetaOL(el);
	return getItemMetaInternal(el);
}

	function isTasksChatsModeNow() {
		// В разных версиях интерфейса Bitrix24 селекторы отличаются.
		// Нам важно лишь понять, что открыт список "чаты задач".
		return !!(
			findVisibleInternalContainer('.bx-im-list-container-task__elements') ||
			findVisibleInternalContainer('.bx-im-list-task__scroll-container')
		);
	}

	function matchByFilters(meta) {
	if (filters.unreadOnly && !meta.hasUnread && !meta.hasLater) return false;

	const sel = Array.isArray(filters.typesSelected) ? filters.typesSelected : [];
	if (sel.length && !sel.includes(meta.type)) return false;
	const q = (filters.query || '').trim().toLowerCase();
	if (q) {
	const haystack = [meta.title, meta.lastText, meta.projectName, meta.responsibleName, meta.statusName].filter(Boolean).join(' ').toLowerCase();
	if (!haystack.includes(q)) return false;
}
	// project filter only in "task chats" mode
	if (isTasksChatsModeNow()) {
		const pSel = Array.isArray(filters.projectIndexes) ? filters.projectIndexes : [];
		if (pSel.length) {
			const pi = (typeof meta.projectIndex === 'number') ? meta.projectIndex : -1;
			if (!pSel.includes(pi)) return false;
		}
	}
	// responsible filter only in "task chats" mode
	if (isTasksChatsModeNow()) {
		const rSel = Array.isArray(filters.responsibleIndexes) ? filters.responsibleIndexes : [];
		if (rSel.length) {
			const ri = (typeof meta.responsibleIndex === 'number') ? meta.responsibleIndex : 0;
			if (!rSel.includes(ri)) return false;
		}
	}
	// status filter only in "task chats" mode (если расширение поддерживает статусы)
	if (!IS_OL_FRAME && isTasksChatsModeNow() && window.__anitProjectLookup?.statuses) {
		const sSel = Array.isArray(filters.statusIndexes) ? filters.statusIndexes : [];
		if (sSel.length) {
			const si = (typeof meta.statusIndex === 'number') ? meta.statusIndex : 0;
			if (!sSel.includes(si)) return false;
		}
	}
	// скрытые проекты и исполнители (только в чатах задач)
	if (isTasksChatsModeNow()) {
		const hProj = Array.isArray(filters.hiddenProjectIndexes) ? filters.hiddenProjectIndexes : [];
		if (hProj.length && typeof meta.projectIndex === 'number' && hProj.includes(meta.projectIndex)) return false;
		const hResp = Array.isArray(filters.hiddenResponsibleIndexes) ? filters.hiddenResponsibleIndexes : [];
		if (hResp.length && typeof meta.responsibleIndex === 'number' && hResp.includes(meta.responsibleIndex)) return false;
	}
	// keyword tag filter
	const selTags = Array.isArray(filters.selectedTags) ? filters.selectedTags : [];
	if (selTags.length > 0) {
		const titleLC = (meta.title || '').toLowerCase();
		const matchesAny = selTags.some(tag => titleLC.includes(tag.toLowerCase()));
		if (!matchesAny) return false;
	}
	// intersection tags filter (второе AND-условие: чат должен совпадать с обеими группами тегов)
	const selIntersect = Array.isArray(filters.selectedIntersectionTags) ? filters.selectedIntersectionTags : [];
	if (selIntersect.length > 0) {
		const titleLC = (meta.title || '').toLowerCase();
		const matchesIntersect = selIntersect.some(tag => titleLC.includes(tag.toLowerCase()));
		if (!matchesIntersect) return false;
	}
		return true;
}

	function applyFilters() {
	const container = findContainer();
	if (!container) return;

	// Во время предзагрузки ? показываем все чаты без фильтрации
	if (_prefetchActive) {
		const items = IS_OL_FRAME
			? Array.from(container.querySelectorAll('.bx-messenger-cl-item'))
			: Array.from(container.querySelectorAll('.bx-im-list-recent-item__wrap'));
		items.forEach(el => { el.style.display = ''; });
		return;
	}

	if (IS_OL_FRAME) container.querySelectorAll('.bx-messenger-recent-group').forEach(n => n.remove());

	const items = IS_OL_FRAME
	? Array.from(container.querySelectorAll('.bx-messenger-cl-item'))
	: Array.from(container.querySelectorAll('.bx-im-list-recent-item__wrap'));

	for (const el of items) {
	const meta = getItemMeta(el);
	el.style.display = matchByFilters(meta) ? '' : 'none';

}
	if (!isTasksChatsModeNow() && window.__anitProjectLookup && (filters.sortMode === 'project' || filters.sortMode === 'projectName')) {
		const visible = items.filter(el => el.style.display !== 'none');
		const hidden = items.filter(el => el.style.display === 'none');
		const withMeta = visible.map(el => ({ el, meta: getItemMeta(el) }));
		withMeta.sort((a, b) => {
			const pa = a.meta.projectIndex   -2;
			const pb = b.meta.projectIndex   -2;
			if (pa !== pb) return pa - pb;
			if (filters.sortMode === 'projectName') {
				const ta = (a.meta.title || '').toLowerCase();
				const tb = (b.meta.title || '').toLowerCase();
				return ta.localeCompare(tb);
			}
			return 0;
		});
		const frag = document.createDocumentFragment();
		withMeta.forEach(({ el }) => frag.appendChild(el));
		hidden.forEach(el => frag.appendChild(el));
		container.appendChild(frag);
	}
	if (IS_OL_FRAME) rebuildDateGroups(tsMapOnce || new Map());
	if (filtersHost) _refreshDialogControlPanel(filtersHost);
}


	// в?Ђв?Р‚ Функции пресетов в?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Р‚

	// Снимок фильтров для сохранения (без опреРТ‘елений тегов ? они глобальны)
	function _snapFilters(options = {}) {
		const { excludeQuery = false } = options;
		// JSON deep copy ? гарантирует независимость пресетов друг от друга
		const snap = JSON.parse(JSON.stringify(filters));
		delete snap.keywordTags;      // определения тегов глобальны
		delete snap.intersectionTags;
		if (excludeQuery) delete snap.query;
		return snap;
	}

	// Применить пресет: восстановить фильтры + обновить весь UI
	function applyPreset(presetId) {
		_debugModeActive = false;          // сброс режима отладки при переключении пресета
		const preset = _getPresetsArr().find(p => p.id === presetId);
		if (!preset) return;
		// Всегда сохраняем текущий активный пресет перед переключением
		saveFiltersToActivePreset({ excludeQuery: !!_getActiveId() && !_debugModeActive });
		if (_getActiveId() === presetId) {
			// Повторный клик ? деактивируем, возвращаемся в общий режим
			_setActiveId(null);
			filters = loadFilters();
		} else {
			_setActiveId(presetId);
			// Определения тегов глобальны ? не перезаписываем из пресета
			const kwTags = filters.keywordTags ? [...filters.keywordTags] : [];
			const ixTags = filters.intersectionTags ? [...filters.intersectionTags] : [];
			// Deep copy ? чтобы мутации filters не влияли на сохранённый снимок пресета
			const pf = JSON.parse(JSON.stringify(preset.filters));
			filters = { ...defaultFilters(), ...pf, keywordTags: kwTags, intersectionTags: ixTags };
		}
		uiFromFilters(filtersHost); // обновляет чекбоксы, теги, категории и т.д.
		applyFilters();
		renderPresetsUI(filtersHost);
	}

	// Зафиксировать текущие фильтры в активном пресете
	function saveFiltersToActivePreset(options = {}) {
		const activeId = _getActiveId();
		if (!activeId) return;
		const preset = _getPresetsArr().find(p => p.id === activeId);
		if (preset) { preset.filters = _snapFilters(options); _saveCustomPresets(); }
	}

	// в?Ђв?Ђв?Р‚ Режим отладки: вспомогательные функции в?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Р‚
	function _updateDebugUI(h) {
		const hasPreset  = !!_getActiveId();
		const debugActive = _debugModeActive && hasPreset;
		const locked      = hasPreset && !_debugModeActive;
		if (h) {
			h.classList.toggle('anit-debug-mode', debugActive);
			h.classList.toggle('preset-locked',   locked);
		}
		const dbBtn = h?.querySelector('#anit_preset_debug_btn');
		if (dbBtn) {
			const LOCK_CLOSED = 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z';
			const LOCK_OPEN   = 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h2c0-1.66 1.34-3 3-3s3 1.34 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z';
			const iconPath = debugActive ? LOCK_OPEN : LOCK_CLOSED;
			dbBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="width:14px;height:14px;fill:#f59e0b;display:block"><path d="${iconPath}"/></svg>`;
			dbBtn.style.opacity = debugActive ? '1' : (hasPreset ? '0.75' : '0.4');
			dbBtn.title = debugActive
				? 'Выйти из режима отладки (заблокировать фильтры)'
				: (hasPreset ? 'Войти в режим отладки (разблокировать фильтры)' : 'Режим отладки пресета');
		}
	}

	let _toastTimer = null;
	function _showPresetToast(msg, tone = '') {
		const toast = filtersHost?.querySelector('#anit_preset_toast');
		if (!toast) return;
		toast.textContent = msg;
		toast.classList.toggle('--danger', tone === 'danger');
		toast.classList.toggle('--ok', tone === 'ok');
		toast.classList.add('--show');
		if (_toastTimer) clearTimeout(_toastTimer);
		_toastTimer = setTimeout(() => {
			toast.classList.remove('--show', '--danger', '--ok');
		}, 2400);
	}

	function _showDialogControlMiss() {
		if (_dialogControlMissTimer) clearTimeout(_dialogControlMissTimer);
		_showDialogDockToast('Необходимо выбрать диалог', 'danger');
		_dialogControlMissTimer = setTimeout(() => { _dialogControlMissTimer = null; }, 900);
	}

	function _getDialogControlItems() {
		const mode = _pMode();
		if (!_dialogControlItems || Array.isArray(_dialogControlItems)) _dialogControlItems = {};
		if (Array.isArray(_dialogControlItems[mode])) return _dialogControlItems[mode];
		try {
			const modeKey = `${_LS_DIALOG_CONTROL}.${mode}`;
			const raw = localStorage.getItem(modeKey);
			const parsed = JSON.parse(raw || '[]');
			_dialogControlItems[mode] = Array.isArray(parsed) ? parsed : [];
		} catch { _dialogControlItems[mode] = []; }
		return _dialogControlItems[mode];
	}

	function _saveDialogControlItems() {
		try { localStorage.setItem(`${_LS_DIALOG_CONTROL}.${_pMode()}`, JSON.stringify(_getDialogControlItems())); } catch {}
	}

	function _isDialogControlFolder(item) {
		return item?.type === 'folder';
	}

	function _pruneDialogControlMultiSelection(items = _getDialogControlItems()) {
		if (!(_dialogControlMultiSelected instanceof Set)) _dialogControlMultiSelected = new Set();
		const valid = new Set((Array.isArray(items) ? items : [])
			.filter(item => !_isDialogControlFolder(item))
			.map(item => String(item.id)));
		let changed = false;
		Array.from(_dialogControlMultiSelected).forEach(id => {
			if (!valid.has(String(id))) {
				_dialogControlMultiSelected.delete(id);
				changed = true;
			}
		});
		return changed;
	}

	function _clearDialogControlMultiSelection() {
		if (!(_dialogControlMultiSelected instanceof Set) || !_dialogControlMultiSelected.size) return false;
		_dialogControlMultiSelected.clear();
		return true;
	}

	function _toggleDialogControlMultiSelection(dialogId, items = _getDialogControlItems()) {
		const id = String(dialogId || '');
		if (!id) return false;
		if (!(_dialogControlMultiSelected instanceof Set)) _dialogControlMultiSelected = new Set();
		_pruneDialogControlMultiSelection(items);
		const item = (Array.isArray(items) ? items : []).find(x => !_isDialogControlFolder(x) && String(x.id) === id);
		if (!item) return false;
		if (_dialogControlMultiSelected.has(id)) _dialogControlMultiSelected.delete(id);
		else _dialogControlMultiSelected.add(id);
		return true;
	}

	function _getDialogControlMultiSelectedItems(items = _getDialogControlItems()) {
		_pruneDialogControlMultiSelection(items);
		return (Array.isArray(items) ? items : []).filter(item =>
			!_isDialogControlFolder(item) &&
			_dialogControlMultiSelected.has(String(item.id))
		);
	}

	function _getDialogControlColorTargetIds(item, items = _getDialogControlItems()) {
		const id = String(item?.id || '');
		const selected = _getDialogControlMultiSelectedItems(items);
		if (id && _dialogControlMultiSelected.has(id) && selected.length > 1) {
			return selected.map(x => String(x.id));
		}
		return id ? [id] : [];
	}

	function _normalizeDialogControlMoveIds(ids) {
		const raw = Array.isArray(ids) ? ids : [ids];
		return Array.from(new Set(raw.map(id => String(id || '')).filter(Boolean)));
	}

	function _getDialogControlMoveGroupIds(movedId, items = _getDialogControlItems()) {
		const id = String(movedId || '');
		if (!id) return [];
		const selected = _getDialogControlMultiSelectedItems(items);
		if (_dialogControlMultiSelected.has(id) && selected.length > 1) {
			return selected.map(item => String(item.id));
		}
		return [id];
	}

	function _setDialogControlCurrentId(dialogId) {
		if (!_dialogControlCurrentIds || typeof _dialogControlCurrentIds !== 'object') _dialogControlCurrentIds = { chats: null, tasks: null };
		_dialogControlCurrentIds[_pMode()] = dialogId ? normId(dialogId) : null;
	}

	function _isLikelyActiveChatElement(el) {
		if (!el) return false;
		const className = String(el.className || '').replace(/\banit-dialog-control-selected\b/g, '');
		const own = [
			className,
			el.getAttribute?.('aria-selected'),
			el.getAttribute?.('aria-current'),
			el.getAttribute?.('data-selected'),
			el.getAttribute?.('data-active')
		].join(' ');
		if (/(^|\s|_|-)(selected|active|current|opened)(\s|_|-|$)/i.test(own)) return true;
		try {
			return !!el.querySelector?.('[aria-selected="true"],[aria-current="true"],[data-selected="true"],[data-active="true"],[class*="--selected"],[class*="--active"],[class*="_selected"],[class*="_active"]');
		} catch {}
		return false;
	}

	function _getDialogControlCurrentId(items = _getDialogControlItems(), visibleChatIndex = null) {
		if (!_dialogControlCurrentIds || typeof _dialogControlCurrentIds !== 'object') _dialogControlCurrentIds = { chats: null, tasks: null };
		const ids = new Set((Array.isArray(items) ? items : [])
			.filter(item => !_isDialogControlFolder(item))
			.map(item => normId(item.id))
			.filter(Boolean));
		const index = visibleChatIndex || buildChatElementIndex();
		let activeListItemOutsideControl = false;
		for (const [id, el] of index.entries()) {
			const activeId = normId(id);
			if (!activeId || !_isLikelyActiveChatElement(el)) continue;
			if (ids.has(activeId)) {
				_setDialogControlCurrentId(activeId);
				return activeId;
			}
			activeListItemOutsideControl = true;
			break;
		}
		const taskId = _getActiveDialogControlTaskIdFromScreen();
		const taskItemId = _findDialogControlItemIdByTaskId(taskId, items);
		if (taskItemId && ids.has(taskItemId)) {
			_setDialogControlCurrentId(taskItemId);
			return taskItemId;
		}
		if (activeListItemOutsideControl) {
			_setDialogControlCurrentId(null);
			return '';
		}
		const titleId = _findDialogControlItemIdByTitle(_getActiveDialogTitleFromScreen(), items);
		if (titleId && ids.has(titleId)) {
			_setDialogControlCurrentId(titleId);
			return titleId;
		}
		_setDialogControlCurrentId(null);
		return '';
	}

	const _DIALOG_CONTROL_EMPTY_FOLDER_GRACE_MS = 45000;

	function _makeDialogControlFolderId() {
		return `folder:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
	}

	function _getDialogControlFolderMap(items = _getDialogControlItems()) {
		const map = new Map();
		(Array.isArray(items) ? items : []).forEach(item => {
			if (_isDialogControlFolder(item) && item.id) map.set(String(item.id), item);
		});
		return map;
	}

	function _getDialogControlFolderChildCount(folderId, items = _getDialogControlItems()) {
		const id = String(folderId || '');
		return (Array.isArray(items) ? items : []).filter(item => !_isDialogControlFolder(item) && String(item.folderId || '') === id).length;
	}

	function _shouldKeepEmptyDialogControlFolder(folder, now = Date.now()) {
		return Number(folder?.emptyVisibleUntil || 0) > now;
	}

	function _pruneEmptyDialogControlFolders(items = _getDialogControlItems()) {
		if (!Array.isArray(items)) return false;
		let changed = false;
		const now = Date.now();
		for (let i = items.length - 1; i >= 0; i--) {
			const item = items[i];
			if (!_isDialogControlFolder(item)) continue;
			const childCount = _getDialogControlFolderChildCount(item.id, items);
			if (childCount > 0) {
				if (item.emptyVisibleUntil) {
					delete item.emptyVisibleUntil;
					changed = true;
				}
				continue;
			}
			if (_shouldKeepEmptyDialogControlFolder(item, now)) continue;
			items.splice(i, 1);
			changed = true;
		}
		if (changed) {
			_dialogControlItems[_pMode()] = items;
			_saveDialogControlItems();
			_dialogControlLastSig = '';
		}
		return changed;
	}

	function _normalizeDialogControlFolderGrouping(items = _getDialogControlItems()) {
		if (!Array.isArray(items)) return false;
		const folderIds = new Set(items.filter(_isDialogControlFolder).map(item => String(item.id || '')));
		if (!folderIds.size) return false;
		const childrenByFolder = new Map();
		items.forEach(item => {
			if (_isDialogControlFolder(item) || !item.folderId || !folderIds.has(String(item.folderId))) return;
			const id = String(item.folderId);
			if (!childrenByFolder.has(id)) childrenByFolder.set(id, []);
			childrenByFolder.get(id).push(item);
		});
		const placedChildren = new Set();
		const next = [];
		items.forEach(item => {
			if (_isDialogControlFolder(item)) {
				next.push(item);
				(childrenByFolder.get(String(item.id || '')) || []).forEach(child => {
					if (!placedChildren.has(child)) {
						next.push(child);
						placedChildren.add(child);
					}
				});
				return;
			}
			if (item.folderId && folderIds.has(String(item.folderId))) return;
			next.push(item);
		});
		if (next.length !== items.length || next.some((item, idx) => item !== items[idx])) {
			items.splice(0, items.length, ...next);
			_dialogControlItems[_pMode()] = items;
			_saveDialogControlItems();
			_dialogControlLastSig = '';
			return true;
		}
		return false;
	}

	function _ensureDialogControlFoldersIntegrity(items = _getDialogControlItems()) {
		if (!Array.isArray(items)) return false;
		const folderIds = new Set();
		let changed = false;
		items.forEach(item => {
			if (_isDialogControlFolder(item)) {
				if (!item.id) {
					item.id = _makeDialogControlFolderId();
					changed = true;
				}
				if (!item.title) {
					item.title = 'Папка';
					changed = true;
				}
				folderIds.add(String(item.id));
			}
		});
		items.forEach(item => {
			if (!_isDialogControlFolder(item) && item.folderId && !folderIds.has(String(item.folderId))) {
				delete item.folderId;
				changed = true;
			}
		});
		if (changed) _saveDialogControlItems();
		if (_normalizeDialogControlFolderGrouping(items)) changed = true;
		if (_pruneEmptyDialogControlFolders(items)) changed = true;
		return changed;
	}

	function _createDialogControlFolder() {
		const items = _getDialogControlItems();
		const n = items.filter(_isDialogControlFolder).length + 1;
		items.unshift({
			type: 'folder',
			id: _makeDialogControlFolderId(),
			title: `Папка ${n}`,
			color: '',
			addedAt: Date.now(),
			emptyVisibleUntil: Date.now() + _DIALOG_CONTROL_EMPTY_FOLDER_GRACE_MS
		});
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		_renderDialogControlPanel(filtersHost);
		_showDialogDockToast('Папка создана', 'ok');
	}

	function _setDialogControlFolderTitle(folderId, title) {
		const id = String(folderId || '');
		const next = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Папка';
		const item = _getDialogControlItems().find(x => _isDialogControlFolder(x) && String(x.id) === id);
		if (!item || item.title === next) return false;
		item.title = next;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _setDialogControlFolderColor(folderId, color) {
		const id = String(folderId || '');
		const item = _getDialogControlItems().find(x => _isDialogControlFolder(x) && String(x.id) === id);
		if (!item) return false;
		const next = _normalizeDialogControlColor(color);
		if (next) item.color = next;
		else delete item.color;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _setDialogControlFolderCollapsed(folderId, collapsed) {
		const id = String(folderId || '');
		const item = _getDialogControlItems().find(x => _isDialogControlFolder(x) && String(x.id) === id);
		if (!item) return false;
		item.collapsed = !!collapsed;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _insertDialogControlItemRelative(items, moved, target, side) {
		const fromIdx = items.indexOf(moved);
		if (fromIdx >= 0) items.splice(fromIdx, 1);
		const toIdx = items.indexOf(target);
		let insertIdx = Math.max(0, toIdx + (side === 'after' ? 1 : 0));
		if (side === 'after' && _isDialogControlFolder(target)) {
			const folderId = String(target.id || '');
			const lastChildIdx = items.reduce((last, x, idx) => String(x.folderId || '') === folderId ? idx : last, toIdx);
			insertIdx = Math.max(0, lastChildIdx + 1);
		}
		items.splice(insertIdx, 0, moved);
	}

	function _moveDialogControlItemRelative(movedId, targetId, side = 'before') {
		const items = _getDialogControlItems();
		const moved = items.find(x => String(x.id) === String(movedId));
		const target = items.find(x => String(x.id) === String(targetId));
		if (!moved || !target || moved === target) return false;
		if (_isDialogControlFolder(moved) && !_isDialogControlFolder(target) && target.folderId) return false;
		if (!_isDialogControlFolder(moved)) {
			if (_isDialogControlFolder(target) || !target.folderId) delete moved.folderId;
			else moved.folderId = target.folderId;
		}
		_insertDialogControlItemRelative(items, moved, target, side);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _moveDialogControlItemToFolder(itemId, folderId) {
		const items = _getDialogControlItems();
		const item = items.find(x => String(x.id) === String(itemId));
		const folder = items.find(x => _isDialogControlFolder(x) && String(x.id) === String(folderId));
		if (!item || !folder || _isDialogControlFolder(item) || item.folderId === folder.id) return false;
		const fromIdx = items.indexOf(item);
		if (fromIdx >= 0) items.splice(fromIdx, 1);
		item.folderId = folder.id;
		if (folder.emptyVisibleUntil) delete folder.emptyVisibleUntil;
		const lastChildIdx = items.reduce((last, x, idx) => x.folderId === folder.id ? idx : last, -1);
		const folderIdx = items.indexOf(folder);
		items.splice((lastChildIdx >= 0 ? lastChildIdx : folderIdx) + 1, 0, item);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _moveDialogControlItemToFolderStart(itemId, folderId) {
		const items = _getDialogControlItems();
		const item = items.find(x => String(x.id) === String(itemId));
		const folder = items.find(x => _isDialogControlFolder(x) && String(x.id) === String(folderId));
		if (!item || !folder || _isDialogControlFolder(item)) return false;
		const fromIdx = items.indexOf(item);
		if (fromIdx >= 0) items.splice(fromIdx, 1);
		item.folderId = folder.id;
		if (folder.emptyVisibleUntil) delete folder.emptyVisibleUntil;
		const folderIdx = items.indexOf(folder);
		items.splice(Math.max(0, folderIdx + 1), 0, item);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _moveDialogControlItemOutOfFolder(itemId) {
		const items = _getDialogControlItems();
		const item = items.find(x => String(x.id) === String(itemId));
		if (!item || _isDialogControlFolder(item) || !item.folderId) return false;
		const folderId = String(item.folderId);
		const folderIdx = items.findIndex(x => _isDialogControlFolder(x) && String(x.id) === folderId);
		const lastChildIdx = items.reduce((last, x, idx) => String(x.folderId || '') === folderId ? idx : last, folderIdx);
		const fromIdx = items.indexOf(item);
		if (fromIdx >= 0) items.splice(fromIdx, 1);
		delete item.folderId;
		const adjustedLast = fromIdx >= 0 && fromIdx < lastChildIdx ? lastChildIdx - 1 : lastChildIdx;
		items.splice(Math.max(0, adjustedLast + 1), 0, item);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _moveDialogControlItemToRootEnd(itemId) {
		const items = _getDialogControlItems();
		const item = items.find(x => String(x.id) === String(itemId));
		if (!item || _isDialogControlFolder(item) || !item.folderId) return false;
		const fromIdx = items.indexOf(item);
		if (fromIdx >= 0) items.splice(fromIdx, 1);
		delete item.folderId;
		items.push(item);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _moveDialogControlItemsRelative(movedIds, targetId, side = 'before') {
		const items = _getDialogControlItems();
		const ids = _normalizeDialogControlMoveIds(movedIds);
		if (!ids.length) return false;
		const idSet = new Set(ids);
		const moved = items.filter(item => !_isDialogControlFolder(item) && idSet.has(String(item.id)));
		const target = items.find(item => String(item.id) === String(targetId));
		if (!moved.length || !target || idSet.has(String(target.id))) return false;
		const remaining = items.filter(item => !(!_isDialogControlFolder(item) && idSet.has(String(item.id))));
		const targetIdx = remaining.indexOf(target);
		if (targetIdx < 0) return false;
		const nextFolderId = !_isDialogControlFolder(target) && target.folderId ? String(target.folderId) : '';
		let insertIdx = Math.max(0, targetIdx + (side === 'after' ? 1 : 0));
		if (side === 'after' && _isDialogControlFolder(target)) {
			const folderId = String(target.id || '');
			const lastChildIdx = remaining.reduce((last, x, idx) => String(x.folderId || '') === folderId ? idx : last, targetIdx);
			insertIdx = Math.max(0, lastChildIdx + 1);
		}
		moved.forEach(item => {
			if (nextFolderId) item.folderId = nextFolderId;
			else delete item.folderId;
		});
		remaining.splice(insertIdx, 0, ...moved);
		items.splice(0, items.length, ...remaining);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _moveDialogControlItemsToFolder(movedIds, folderId, atStart = false) {
		const items = _getDialogControlItems();
		const ids = _normalizeDialogControlMoveIds(movedIds);
		if (!ids.length) return false;
		const idSet = new Set(ids);
		const folder = items.find(item => _isDialogControlFolder(item) && String(item.id) === String(folderId));
		const moved = items.filter(item => !_isDialogControlFolder(item) && idSet.has(String(item.id)));
		if (!folder || !moved.length) return false;
		const remaining = items.filter(item => !(!_isDialogControlFolder(item) && idSet.has(String(item.id))));
		const folderIdx = remaining.indexOf(folder);
		if (folderIdx < 0) return false;
		moved.forEach(item => { item.folderId = folder.id; });
		if (folder.emptyVisibleUntil) delete folder.emptyVisibleUntil;
		const lastChildIdx = remaining.reduce((last, x, idx) => String(x.folderId || '') === String(folder.id) ? idx : last, -1);
		const insertIdx = atStart ? folderIdx + 1 : (lastChildIdx >= 0 ? lastChildIdx + 1 : folderIdx + 1);
		remaining.splice(Math.max(0, insertIdx), 0, ...moved);
		items.splice(0, items.length, ...remaining);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _moveDialogControlItemsToRootEnd(movedIds) {
		const items = _getDialogControlItems();
		const ids = _normalizeDialogControlMoveIds(movedIds);
		if (!ids.length) return false;
		const idSet = new Set(ids);
		const moved = items.filter(item => !_isDialogControlFolder(item) && idSet.has(String(item.id)));
		if (!moved.length) return false;
		const remaining = items.filter(item => !(!_isDialogControlFolder(item) && idSet.has(String(item.id))));
		moved.forEach(item => { delete item.folderId; });
		remaining.push(...moved);
		items.splice(0, items.length, ...remaining);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _removeDialogControlFolder(folderId) {
		const id = String(folderId || '');
		const items = _getDialogControlItems();
		const folder = items.find(x => _isDialogControlFolder(x) && String(x.id) === id);
		if (!folder) return false;
		items.forEach(item => {
			if (!_isDialogControlFolder(item) && String(item.folderId || '') === id) delete item.folderId;
		});
		_dialogControlItems[_pMode()] = items.filter(x => String(x.id) !== id);
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	const _LS_DIALOG_CONTROL_COLORS = 'pena.dialogControlColors.v1';
	const _DIALOG_CONTROL_DEFAULT_COLORS = [
		'#4d9dff', '#5dc87e', '#f59e0b', '#ef4444',
		'#a855f7', '#14b8a6', '#f97316', '#94a3b8'
	];

	function _isHexColor(value) {
		return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
	}

	function _getCustomDialogControlColors() {
		try {
			const parsed = JSON.parse(localStorage.getItem(_LS_DIALOG_CONTROL_COLORS) || '[]');
			return Array.isArray(parsed) ? parsed.map(c => String(c || '').toLowerCase()).filter(_isHexColor) : [];
		} catch { return []; }
	}

	function _saveCustomDialogControlColors(colors) {
		const arr = Array.from(new Set((Array.isArray(colors) ? colors : []).map(c => String(c || '').toLowerCase()).filter(_isHexColor))).slice(0, 24);
		try { localStorage.setItem(_LS_DIALOG_CONTROL_COLORS, JSON.stringify(arr)); } catch {}
	}

	function _getDialogControlColors() {
		return Array.from(new Set([..._DIALOG_CONTROL_DEFAULT_COLORS, ..._getCustomDialogControlColors()]));
	}

	function _getRemovedDefaultDialogControlColors() {
		try {
			const parsed = JSON.parse(localStorage.getItem(`${_LS_DIALOG_CONTROL_COLORS}.removedDefaults`) || '[]');
			return Array.isArray(parsed) ? parsed.map(c => String(c || '').toLowerCase()).filter(c => _DIALOG_CONTROL_DEFAULT_COLORS.includes(c)) : [];
		} catch { return []; }
	}

	function _saveRemovedDefaultDialogControlColors(colors) {
		const arr = Array.from(new Set((Array.isArray(colors) ? colors : []).map(c => String(c || '').toLowerCase()).filter(c => _DIALOG_CONTROL_DEFAULT_COLORS.includes(c))));
		try { localStorage.setItem(`${_LS_DIALOG_CONTROL_COLORS}.removedDefaults`, JSON.stringify(arr)); } catch {}
	}

	function _getVisibleDialogControlColors() {
		const removed = new Set(_getRemovedDefaultDialogControlColors());
		return _getDialogControlColors().filter(color => !removed.has(color));
	}

	function _normalizeDialogControlColor(value) {
		const color = String(value || '').trim().toLowerCase();
		return _isHexColor(color) ? color : '';
	}

	function _hexToRgb(hex) {
		const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
		if (!m) return null;
		const n = parseInt(m[1], 16);
		return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
	}

	function _rgbToHex(r, g, b) {
		const clamp = (v) => Math.max(0, Math.min(255, parseInt(v, 10) || 0));
		return '#' + [clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('');
	}

	function _hsvToRgb(h, s, v) {
		const hue = (((Number(h) || 0) % 360) + 360) % 360;
		const sat = Math.max(0, Math.min(1, Number(s) || 0));
		const val = Math.max(0, Math.min(1, Number(v) || 0));
		const c = val * sat;
		const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
		const m = val - c;
		let r = 0, g = 0, b = 0;
		if (hue < 60) [r, g, b] = [c, x, 0];
		else if (hue < 120) [r, g, b] = [x, c, 0];
		else if (hue < 180) [r, g, b] = [0, c, x];
		else if (hue < 240) [r, g, b] = [0, x, c];
		else if (hue < 300) [r, g, b] = [x, 0, c];
		else [r, g, b] = [c, 0, x];
		return {
			r: Math.round((r + m) * 255),
			g: Math.round((g + m) * 255),
			b: Math.round((b + m) * 255)
		};
	}

	function _hsvToHex(h, s, v) {
		const rgb = _hsvToRgb(h, s, v);
		return _rgbToHex(rgb.r, rgb.g, rgb.b);
	}

	function _rgbToHsv(r, g, b) {
		const rr = Math.max(0, Math.min(255, Number(r) || 0)) / 255;
		const gg = Math.max(0, Math.min(255, Number(g) || 0)) / 255;
		const bb = Math.max(0, Math.min(255, Number(b) || 0)) / 255;
		const max = Math.max(rr, gg, bb);
		const min = Math.min(rr, gg, bb);
		const d = max - min;
		let h = 0;
		if (d) {
			if (max === rr) h = 60 * (((gg - bb) / d) % 6);
			else if (max === gg) h = 60 * ((bb - rr) / d + 2);
			else h = 60 * ((rr - gg) / d + 4);
		}
		if (h < 0) h += 360;
		return { h, s: max === 0 ? 0 : d / max, v: max };
	}

	function _hexToHsv(hex) {
		const rgb = _hexToRgb(hex);
		return rgb ? _rgbToHsv(rgb.r, rgb.g, rgb.b) : null;
	}

	function _ruPlural(n, one, few, many) {
		const value = Math.abs(Number(n) || 0);
		const mod10 = value % 10;
		const mod100 = value % 100;
		if (mod10 === 1 && mod100 !== 11) return one;
		if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
		return many;
	}

	function _applyDialogControlColorVars(el, color) {
		const rgb = _hexToRgb(color);
		if (!el || !rgb) return;
		el.style.setProperty('--dialog-chip-color', color);
		el.style.setProperty('--dialog-chip-bg', `rgba(${rgb.r},${rgb.g},${rgb.b},.24)`);
		el.style.setProperty('--dialog-chip-bg-hover', `rgba(${rgb.r},${rgb.g},${rgb.b},.32)`);
		el.style.setProperty('--dialog-chip-border', `rgba(${rgb.r},${rgb.g},${rgb.b},.58)`);
		el.style.setProperty('--dialog-chip-border-hover', `rgba(${rgb.r},${rgb.g},${rgb.b},.78)`);
		el.style.setProperty('--dialog-chip-shadow', `rgba(${rgb.r},${rgb.g},${rgb.b},.55)`);
	}

	function _clearDialogControlColorVars(el) {
		if (!el) return;
		[
			'--dialog-chip-color',
			'--dialog-chip-bg',
			'--dialog-chip-bg-hover',
			'--dialog-chip-border',
			'--dialog-chip-border-hover',
			'--dialog-chip-shadow'
		].forEach(name => el.style.removeProperty(name));
	}

	function _setDialogControlItemColor(dialogId, color) {
		const id = normId(dialogId);
		if (!id) return false;
		const arr = _getDialogControlItems();
		const item = arr.find(x => normId(x.id) === id);
		if (!item) return false;
		const next = _normalizeDialogControlColor(color);
		if (next) item.color = next;
		else delete item.color;
		_saveDialogControlItems();
		_dialogControlLastSig = '';
		return true;
	}

	function _setDialogControlItemsColor(dialogIds, color) {
		const ids = new Set((Array.isArray(dialogIds) ? dialogIds : [dialogIds]).map(normId).filter(Boolean));
		if (!ids.size) return 0;
		const next = _normalizeDialogControlColor(color);
		let changed = 0;
		_getDialogControlItems().forEach(item => {
			if (_isDialogControlFolder(item) || !ids.has(normId(item.id))) return;
			const current = _normalizeDialogControlColor(item.color);
			if (current === next) return;
			if (next) item.color = next;
			else delete item.color;
			changed++;
		});
		if (changed) {
			_saveDialogControlItems();
			_dialogControlLastSig = '';
		}
		return changed;
	}

	function _getDialogControlItemsForMode(mode) {
		const m = mode === 'tasks' ? 'tasks' : 'chats';
		if (_dialogControlItems && Array.isArray(_dialogControlItems[m])) return _dialogControlItems[m];
		try {
			const parsed = JSON.parse(localStorage.getItem(`${_LS_DIALOG_CONTROL}.${m}`) || '[]');
			return Array.isArray(parsed) ? parsed : [];
		} catch { return []; }
	}

	function _saveDialogControlItemsForMode(mode, items) {
		const m = mode === 'tasks' ? 'tasks' : 'chats';
		if (!_dialogControlItems || Array.isArray(_dialogControlItems)) _dialogControlItems = {};
		_dialogControlItems[m] = Array.isArray(items) ? items : [];
		try { localStorage.setItem(`${_LS_DIALOG_CONTROL}.${m}`, JSON.stringify(_dialogControlItems[m])); } catch {}
	}

	function _getDialogControlColorUsage(color) {
		const target = _normalizeDialogControlColor(color);
		const result = { total: 0, modes: [] };
		if (!target) return result;
		[
			{ key: 'chats', label: 'Чаты' },
			{ key: 'tasks', label: 'Чаты задач' }
		].forEach(mode => {
			const items = _getDialogControlItemsForMode(mode.key);
			const count = items.filter(item => _normalizeDialogControlColor(item.color) === target).length;
			if (count) {
				result.total += count;
				result.modes.push({ ...mode, count });
			}
		});
		return result;
	}

	function _deleteCustomDialogControlColor(color) {
		const target = _normalizeDialogControlColor(color);
		if (!target) return;
		if (_DIALOG_CONTROL_DEFAULT_COLORS.includes(target)) {
			_saveRemovedDefaultDialogControlColors([target, ..._getRemovedDefaultDialogControlColors()]);
		} else {
			_saveCustomDialogControlColors(_getCustomDialogControlColors().filter(c => c !== target));
		}
		['chats', 'tasks'].forEach(mode => {
			const items = _getDialogControlItemsForMode(mode);
			let changed = false;
			items.forEach(item => {
				if (_normalizeDialogControlColor(item.color) === target) {
					delete item.color;
					changed = true;
				}
			});
			if (changed) _saveDialogControlItemsForMode(mode, items);
		});
		_dialogControlLastSig = '';
	}

	function _showDialogControlColorDeleteConfirm(notice, color, onConfirm) {
		const target = _normalizeDialogControlColor(color);
		if (!notice || !target) return;
		const usage = _getDialogControlColorUsage(target);
		const palette = notice.closest?.('.dialog-control-palette');
		if (!notice._penaColorDeleteStopBound) {
			notice.addEventListener('pointerdown', (e) => e.stopPropagation());
			notice.addEventListener('mousedown', (e) => e.stopPropagation());
			notice.addEventListener('click', (e) => e.stopPropagation());
			notice._penaColorDeleteStopBound = true;
		}
		const hide = () => {
			notice.classList.remove('--show');
			palette?.classList.remove('--confirming');
		};
		const usageText = usage.total === 0
			? 'Этот цвет не используется.'
			: `Цвет сбросится у ${usage.total} ${_ruPlural(usage.total, 'диалога', 'диалогов', 'диалогов')}.`;
		notice.innerHTML = '';
		_applyDialogControlColorVars(notice, target);
		const card = document.createElement('div');
		card.className = 'dialog-control-delete-card';
		const swatch = document.createElement('span');
		swatch.className = 'dialog-control-delete-swatch';
		const title = document.createElement('span');
		title.className = 'dialog-control-delete-title';
		title.textContent = 'Удалить цвет?';
		const textEl = document.createElement('span');
		textEl.className = 'dialog-control-delete-text';
		textEl.textContent = usageText;
		const actions = document.createElement('div');
		actions.className = 'dialog-control-delete-actions';
		const cancel = document.createElement('button');
		cancel.type = 'button';
		cancel.textContent = 'Отмена';
		const ok = document.createElement('button');
		ok.type = 'button';
		ok.className = '--danger';
		ok.textContent = 'Удалить';
		cancel.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			hide();
		});
		ok.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			hide();
			if (typeof onConfirm === 'function') onConfirm(target, usage);
		});
		actions.append(cancel, ok);
		card.append(swatch, title, textEl, actions);
		notice.append(card);
		notice.classList.add('--show');
		palette?.classList.add('--confirming');
		_clearDialogControlPaletteClose();
	}

	let _dialogControlPaletteCloseTimer = null;
	function _clearDialogControlPaletteClose() {
		if (_dialogControlPaletteCloseTimer) {
			clearTimeout(_dialogControlPaletteCloseTimer);
			_dialogControlPaletteCloseTimer = null;
		}
	}

	function _detachDialogControlPaletteOutsideHandler(el) {
		if (!el?._penaOutsideHandler) return;
		document.removeEventListener('pointerdown', el._penaOutsideHandler, true);
		el._penaOutsideHandler = null;
	}

	function _clearDialogControlPaletteRemoveTimer(el) {
		if (!el?._penaRemoveTimer) return;
		clearTimeout(el._penaRemoveTimer);
		el._penaRemoveTimer = null;
	}

	function _isDialogControlPaletteOpenFor(paletteId) {
		const id = String(paletteId || '');
		return Array.from(document.querySelectorAll('.dialog-control-palette')).some(el =>
			el.dataset.dialogId === id &&
			el.classList.contains('--open') &&
			!el.classList.contains('--closing')
		);
	}

	function _prepareDialogControlPaletteForOpen(palette) {
		if (!palette) return;
		_clearDialogControlPaletteRemoveTimer(palette);
		_detachDialogControlPaletteOutsideHandler(palette);
		palette.classList.remove('--open', '--closing', '--confirming');
		palette.querySelectorAll('.dialog-control-delete-notice.--show').forEach(el => el.classList.remove('--show'));
	}

	function _armDialogControlPaletteOutsideHandler(palette, closeOnOutside) {
		if (!palette || typeof closeOnOutside !== 'function') return;
		_detachDialogControlPaletteOutsideHandler(palette);
		palette._penaOutsideHandler = closeOnOutside;
		setTimeout(() => {
			if (
				!palette.isConnected ||
				palette._penaOutsideHandler !== closeOnOutside ||
				!palette.classList.contains('--open') ||
				palette.classList.contains('--closing')
			) return;
			document.addEventListener('pointerdown', closeOnOutside, true);
		}, 0);
	}

	function _scheduleDialogControlPaletteClose(delay = 5000) {
		_clearDialogControlPaletteClose();
		_dialogControlPaletteCloseTimer = setTimeout(() => {
			_dialogControlPaletteCloseTimer = null;
			_closeDialogControlPalettes(true);
		}, delay);
	}

	function _closeDialogControlPalettes(animated = true) {
		_clearDialogControlPaletteClose();
		document.querySelectorAll('.dialog-control-palette').forEach(el => {
			_detachDialogControlPaletteOutsideHandler(el);
			_clearDialogControlPaletteRemoveTimer(el);
			el.classList.remove('--open', '--confirming');
			el.querySelectorAll('.dialog-control-delete-notice.--show').forEach(notice => notice.classList.remove('--show'));
			el.classList.add('--closing');
			if (animated) {
				el._penaRemoveTimer = setTimeout(() => {
					el._penaRemoveTimer = null;
					el.remove();
				}, 190);
			}
			else el.remove();
		});
		document.querySelectorAll('.dialog-control-color-wrap.--open,.dialog-control-folder-color-wrap.--open').forEach(el => el.classList.remove('--open'));
	}

	function _forceCloseDialogControlPalettes() {
		_clearDialogControlPaletteClose();
		document.querySelectorAll('.dialog-control-palette').forEach(el => {
			_detachDialogControlPaletteOutsideHandler(el);
			_clearDialogControlPaletteRemoveTimer(el);
			el.remove();
		});
		document.querySelectorAll('.dialog-control-color-wrap.--open,.dialog-control-folder-color-wrap.--open').forEach(el => el.classList.remove('--open'));
	}

	function _wireDialogControlColorPalette(anchorBtn, wrapEl, options = {}) {
		if (!anchorBtn || !wrapEl || typeof options.onCommit !== 'function') return;
		anchorBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const paletteId = String(options.id || '');
			const wasOpen = _isDialogControlPaletteOpenFor(paletteId);
			_clearDialogControlPaletteClose();
			_forceCloseDialogControlPalettes();
			if (wasOpen) return;
			wrapEl.classList.add('--open');
			const optionColor = typeof options.getCurrentColor === 'function' ? options.getCurrentColor() : options.currentColor;
			const optionFolderColor = typeof options.getFolderColor === 'function' ? options.getFolderColor() : options.folderColor;
			const folderRefColor = _normalizeDialogControlColor(optionFolderColor);
			let selectedColor = _normalizeDialogControlColor(optionColor);
			let draftColor = selectedColor || folderRefColor || '#4d9dff';
			let draftHsv = _hexToHsv(draftColor) || { h: 210, s: 1, v: 1 };
			const palette = document.createElement('div');
			palette.className = 'dialog-control-palette';
			palette.tabIndex = -1;
			const preview = document.createElement('span');
			preview.className = 'dialog-control-preview';
			const miniPicker = document.createElement('div');
			miniPicker.className = 'dialog-control-mini-picker';
			const pickerKnob = document.createElement('span');
			pickerKnob.className = 'dialog-control-picker-knob';
			miniPicker.appendChild(pickerKnob);
			const hueStrip = document.createElement('div');
			hueStrip.className = 'dialog-control-hue-strip';
			const hueKnob = document.createElement('span');
			hueKnob.className = 'dialog-control-hue-knob';
			hueStrip.appendChild(hueKnob);
			const closePalette = document.createElement('button');
			closePalette.type = 'button';
			closePalette.className = 'dialog-control-palette-close';
			closePalette.title = 'Закрыть';
			closePalette.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg>';
			const swatches = document.createElement('div');
			swatches.className = 'dialog-control-swatches';
			const notice = document.createElement('div');
			notice.className = 'dialog-control-delete-notice';
			const syncPickerVisual = () => {
				miniPicker.style.setProperty('--picker-hue-color', _hsvToHex(draftHsv.h, 1, 1));
				pickerKnob.style.left = (draftHsv.s * 100) + '%';
				pickerKnob.style.top = ((1 - draftHsv.v) * 100) + '%';
				hueKnob.style.left = (draftHsv.h / 360 * 100) + '%';
			};
			const updateDraftPaint = () => {
				_applyDialogControlColorVars(preview, draftColor);
				_applyDialogControlColorVars(pickerKnob, draftColor);
				palette.querySelectorAll('.dialog-control-swatch').forEach(btn => {
					btn.classList.toggle('--active', !!selectedColor && btn.dataset.color === selectedColor);
				});
				syncPickerVisual();
			};
			const setDraftFromColor = (color) => {
				draftColor = _normalizeDialogControlColor(color) || '#4d9dff';
				draftHsv = _hexToHsv(draftColor) || draftHsv;
				updateDraftPaint();
			};
			const setDraftFromHsv = (h, s, v) => {
				draftHsv = {
					h: (((Number(h) || 0) % 360) + 360) % 360,
					s: Math.max(0, Math.min(1, Number(s) || 0)),
					v: Math.max(0, Math.min(1, Number(v) || 0))
				};
				draftColor = _hsvToHex(draftHsv.h, draftHsv.s, draftHsv.v);
				updateDraftPaint();
			};
			const commitColor = (color) => {
				const next = _normalizeDialogControlColor(color);
				selectedColor = next;
				options.onCommit(next);
				palette.querySelectorAll('.dialog-control-swatch').forEach(btn => {
					btn.classList.toggle('--active', !!next && btn.dataset.color === next);
				});
			};
			const makeColorSwatch = (color) => {
				const swatchWrap = document.createElement('span');
				swatchWrap.className = 'dialog-control-swatch-wrap';
				const swatch = document.createElement('button');
				swatch.type = 'button';
				swatch.className = 'dialog-control-swatch';
				swatch.draggable = false;
				swatch.dataset.color = color;
				_applyDialogControlColorVars(swatch, color);
				swatch.classList.toggle('--active', selectedColor === color);
				const isFolderRef = !!folderRefColor && color === folderRefColor;
				swatch.classList.toggle('--folder-ref', isFolderRef);
				if (isFolderRef) swatch.innerHTML = _getDialogControlFolderRefIconSvg();
				swatch.title = isFolderRef ? `Применить цвет папки «${options.folderTitle || 'Папка'}»` : 'Применить цвет';
				swatch.addEventListener('click', (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					setDraftFromColor(color);
					commitColor(color);
				});
				swatchWrap.appendChild(swatch);
				const del = document.createElement('button');
				del.type = 'button';
				del.className = 'dialog-control-swatch-delete';
				del.title = 'Удалить цвет';
				del.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg>';
				del.addEventListener('click', (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					_showDialogControlColorDeleteConfirm(notice, color, (deletedColor, usage) => {
						_deleteCustomDialogControlColor(deletedColor);
						if (selectedColor === deletedColor) commitColor('');
						swatchWrap.remove();
						_showDialogDockToast(usage.total > 0 ? `Цвет удалён. Сброшено в ${usage.total} ${_ruPlural(usage.total, 'диалоге', 'диалогах', 'диалогах')}` : 'Цвет удалён', 'ok');
					});
				});
				swatchWrap.appendChild(del);
				return swatchWrap;
			};
			const visibleColors = _getVisibleDialogControlColors();
			const paletteColors = folderRefColor && !visibleColors.includes(folderRefColor)
				? [folderRefColor, ...visibleColors]
				: visibleColors;
			paletteColors.forEach(color => swatches.appendChild(makeColorSwatch(color)));
			const clearColor = document.createElement('button');
			clearColor.type = 'button';
			clearColor.className = 'dialog-control-swatch --clear';
			clearColor.draggable = false;
			clearColor.title = 'Без цвета';
			clearColor.innerHTML = '<span class="dialog-control-transparent-icon" aria-hidden="true"></span>';
			clearColor.addEventListener('click', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				commitColor('');
			});
			const clearWrap = document.createElement('span');
			clearWrap.className = 'dialog-control-swatch-wrap';
			clearWrap.appendChild(clearColor);
			swatches.appendChild(clearWrap);
			const addColor = document.createElement('button');
			addColor.type = 'button';
			addColor.className = 'dialog-control-swatch --add';
			addColor.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 3v10"/><path d="M3 8h10"/></svg>';
			addColor.title = 'Добавить цвет';
			addColor.addEventListener('click', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				_saveRemovedDefaultDialogControlColors(_getRemovedDefaultDialogControlColors().filter(c => c !== draftColor));
				_saveCustomDialogControlColors([draftColor, ..._getCustomDialogControlColors()]);
				if (!palette.querySelector(`.dialog-control-swatch[data-color="${draftColor}"]`)) {
					swatches.insertBefore(makeColorSwatch(draftColor), clearWrap);
				}
				commitColor(draftColor);
			});
			const addWrap = document.createElement('span');
			addWrap.className = 'dialog-control-swatch-wrap';
			addWrap.appendChild(addColor);
			swatches.appendChild(addWrap);
			const pickFromPointer = (ev, commit = false) => {
				const rect = miniPicker.getBoundingClientRect();
				const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
				const y = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
				setDraftFromHsv(draftHsv.h, x / Math.max(1, rect.width), 1 - y / Math.max(1, rect.height));
				if (commit) commitColor(draftColor);
			};
			const pickHueFromPointer = (ev, commit = false) => {
				const rect = hueStrip.getBoundingClientRect();
				const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
				setDraftFromHsv((x / Math.max(1, rect.width)) * 360, draftHsv.s, draftHsv.v);
				if (commit) commitColor(draftColor);
			};
			let pickingColor = false;
			miniPicker.addEventListener('pointerdown', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				pickingColor = true;
				miniPicker.setPointerCapture?.(ev.pointerId);
				pickFromPointer(ev, false);
			});
			miniPicker.addEventListener('pointermove', (ev) => {
				if (!pickingColor) return;
				ev.preventDefault();
				pickFromPointer(ev, false);
			});
			miniPicker.addEventListener('pointerup', (ev) => {
				if (!pickingColor) return;
				pickingColor = false;
				ev.preventDefault();
				pickFromPointer(ev, true);
			});
			let pickingHue = false;
			hueStrip.addEventListener('pointerdown', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				pickingHue = true;
				hueStrip.setPointerCapture?.(ev.pointerId);
				pickHueFromPointer(ev, false);
			});
			hueStrip.addEventListener('pointermove', (ev) => {
				if (!pickingHue) return;
				ev.preventDefault();
				pickHueFromPointer(ev, false);
			});
			hueStrip.addEventListener('pointerup', (ev) => {
				if (!pickingHue) return;
				pickingHue = false;
				ev.preventDefault();
				pickHueFromPointer(ev, true);
			});
			closePalette.addEventListener('click', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				_closeDialogControlPalettes(true);
			});
			palette.addEventListener('mousedown', (ev) => ev.stopPropagation());
			palette.addEventListener('click', (ev) => ev.stopPropagation());
			palette.addEventListener('mouseenter', () => {
				_clearDialogControlPaletteClose();
				_setLinkedPanelOpacityLift(true);
				_clearDialogDockAutoClose();
			});
			palette.addEventListener('mouseleave', () => {
				_setLinkedPanelOpacityLift(false);
				_scheduleDialogDockAutoClose();
				_scheduleDialogControlPaletteClose(5000);
			});
			const closeOnOutside = (ev) => {
				if (palette.contains(ev.target) || anchorBtn.contains(ev.target)) return;
				document.removeEventListener('pointerdown', closeOnOutside, true);
				_closeDialogControlPalettes(true);
			};
			palette.append(preview, miniPicker, hueStrip, closePalette, swatches, notice);
			setDraftFromColor(draftColor);
			const paletteW = 246;
			const gap = 8;
			const margin = 12;
			const paletteH = Math.min(250, window.innerHeight - margin * 2);
			const btnRect = anchorBtn.getBoundingClientRect();
			const left = Math.max(margin, Math.min(btnRect.right - paletteW, window.innerWidth - paletteW - margin));
			const placeBelow = btnRect.bottom + gap + paletteH <= window.innerHeight - margin;
			const top = placeBelow ? btnRect.bottom + gap : Math.max(margin, btnRect.top - gap - paletteH);
			palette.style.left = left + 'px';
			palette.style.top = top + 'px';
			palette.dataset.dialogId = paletteId;
			_prepareDialogControlPaletteForOpen(palette);
			document.body.appendChild(palette);
			requestAnimationFrame(() => {
				if (!palette.isConnected) return;
				palette.classList.remove('--closing');
				palette.classList.add('--open');
				_armDialogControlPaletteOutsideHandler(palette, closeOnOutside);
			});
		});
	}

	function _syncDialogControlSelectionOutlines() {
		if (_panelModeSwitching) return;
		const index = buildChatElementIndex();
		index.forEach(el => el.classList.remove('anit-dialog-control-selected'));
		if (!_dialogControlActive) return;
		const ids = new Set(_getDialogControlItems().filter(item => !_isDialogControlFolder(item)).map(item => normId(item.id)).filter(Boolean));
		ids.forEach(id => {
			const el = index.get(id);
			if (el) el.classList.add('anit-dialog-control-selected');
		});
	}

	function _scheduleDialogControlSelectionOutlines() {
		if (_dialogControlSelectionSyncTimer) return;
		_dialogControlSelectionSyncTimer = setTimeout(() => {
			_dialogControlSelectionSyncTimer = null;
			_syncDialogControlSelectionOutlines();
		}, 0);
	}

	function _getDialogControlStatusSig() {
		const index = buildChatElementIndex();
		const items = _getDialogControlItems();
		const folderMap = _getDialogControlFolderMap(items);
		const activePart = `active:${_getDialogControlCurrentId(items, index) || ''}:${_getActiveDialogControlTaskIdFromScreen()}:${_normalizeDialogControlTitle(_getActiveDialogTitleFromScreen())}`;
		return activePart + '|' + items.map(item => {
			if (_isDialogControlFolder(item)) {
				const childCount = _getDialogControlFolderChildCount(item.id, items);
				return [
					'folder',
					item.id,
					item.title || '',
					_normalizeDialogControlColor(item.color),
					item.collapsed ? 1 : 0,
					childCount,
					childCount > 0 || _shouldKeepEmptyDialogControlFolder(item) ? 1 : 0
				].join(':');
			}
			const el = index.get(normId(item.id));
			const meta = el ? getItemMeta(el) : null;
			const folder = item.folderId ? folderMap.get(String(item.folderId)) : null;
			return [
				item.id,
				item.title || '',
				el ? getChatTitleFromElement(el) : '',
				item.folderId || '',
				_normalizeDialogControlColor(item.color),
				_normalizeDialogControlColor(folder?.color),
				meta?.hasUnread ? 1 : 0,
				meta?.hasLater ? 1 : 0,
				meta?.hasMention ? 1 : 0,
				meta?.unreadCount || 0
			].join(':');
		}).join('|');
	}

	function _syncDialogControlItemTitleFromElement(item, visibleChatIndex) {
		if (!item || _isDialogControlFolder(item)) return false;
		const el = visibleChatIndex?.get?.(normId(item.id)) || null;
		const liveTitle = el ? getChatTitleFromElement(el) : '';
		if (!liveTitle || liveTitle === item.title) return false;
		item.title = liveTitle;
		return true;
	}

	function _getDialogControlItemLiveMeta(item, visibleChatIndex) {
		if (!item || _isDialogControlFolder(item)) return null;
		const el = visibleChatIndex?.get?.(normId(item.id)) || null;
		return el ? getItemMeta(el) : null;
	}

	function _getDialogControlFolderStatus(folderId, items, visibleChatIndex) {
		const id = String(folderId || '');
		const children = (Array.isArray(items) ? items : []).filter(item => !_isDialogControlFolder(item) && String(item.folderId || '') === id);
		let unreadCount = 0;
		let hasUnread = false;
		let hasMention = false;
		let hasLater = false;
		children.forEach(child => {
			const meta = _getDialogControlItemLiveMeta(child, visibleChatIndex);
			if (!meta) return;
			if (meta.hasMention) hasMention = true;
			if (meta.hasLater && !meta.hasUnread) hasLater = true;
			if (meta.hasUnread) {
				hasUnread = true;
				unreadCount += Math.max(1, Number(meta.unreadCount) || 0);
			} else if (meta.hasMention || meta.hasLater) {
				unreadCount += 1;
			}
		});
		return { childCount: children.length, unreadCount, hasUnread, hasMention, hasLater };
	}

	function _renderDialogControlState(stateEl, meta, emptyTitle = '') {
		if (!stateEl) return;
		const unreadCount = Number(meta?.unreadCount) || 0;
		if (meta?.hasLater && !meta?.hasUnread && !meta?.hasMention) {
			stateEl.title = 'Посмотреть позже';
			stateEl.innerHTML = '<span class="dialog-control-dot --later"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg></span>';
		} else if (meta?.hasUnread || meta?.hasMention || unreadCount > 0) {
			stateEl.title = meta?.hasMention ? 'Вас упомянули' : 'Непрочитанные';
			if (meta?.hasMention && unreadCount <= 0) {
				stateEl.innerHTML = `<span class="dialog-control-dot --mention-dot">${_getDialogControlMentionIconSvg()}</span>`;
			} else {
				const countLabel = unreadCount > 0 ? String(unreadCount) : '';
				const dotClass = meta?.hasMention ? 'dialog-control-dot --mention-dot' : 'dialog-control-dot';
				stateEl.innerHTML = `<span class="${dotClass}"><span class="dialog-control-count">${countLabel}</span></span>`;
			}
		} else {
			stateEl.title = emptyTitle;
			stateEl.innerHTML = '<span class="dialog-control-dot --empty"></span>';
		}
	}

	function _getDialogControlMentionIconSvg() {
		return '<svg class="dialog-control-mention-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>';
	}

	function _getDialogControlFolderRefIconSvg() {
		return '<svg class="dialog-control-folder-ref-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 5h4l1.1 1.4h5.9v4.9c0 .8-.6 1.4-1.4 1.4H3.9c-.8 0-1.4-.6-1.4-1.4V5Z"/></svg>';
	}

	async function _syncDialogControlTitlesFromRest(h = filtersHost) {
		if (_dialogControlTitleSyncInFlight || IS_OL_FRAME) return;
		const items = _getDialogControlItems().filter(item => !_isDialogControlFolder(item));
		if (!items.length) return;
		_dialogControlTitleSyncInFlight = true;
		_dialogControlTitleLastSyncAt = Date.now();
		let changed = false;
		try {
			for (const item of items) {
				let nextTitle = '';
				if (_pMode() === 'tasks') nextTitle = await _resolveTaskTitleForDialogControlItem(item);
				if (!nextTitle) {
					try {
						nextTitle = _extractDialogTitleFromDialogData(await _callBxRestMethod('im.dialog.get', { DIALOG_ID: normId(item.id) }));
					} catch (e) {
						warn('Не удалось получить название диалога', item.id, e?.message || e);
					}
				}
				if (nextTitle && nextTitle !== item.title) {
					item.title = nextTitle;
					changed = true;
				}
			}
		} finally {
			_dialogControlTitleSyncInFlight = false;
		}
		if (changed) {
			_saveDialogControlItems();
			_dialogControlLastSig = '';
			_renderDialogControlPanel(h);
		}
	}

	function _scheduleDialogControlTitleSync(h = filtersHost) {
		if (_dialogControlTitleSyncTimer || _dialogControlTitleSyncInFlight || IS_OL_FRAME) return;
		const elapsed = Date.now() - (_dialogControlTitleLastSyncAt || 0);
		const delay = elapsed > 7000 ? 600 : 7000 - elapsed;
		_dialogControlTitleSyncTimer = setTimeout(() => {
			_dialogControlTitleSyncTimer = null;
			_syncDialogControlTitlesFromRest(h);
		}, delay);
	}

	function _refreshDialogControlPanel(h = filtersHost, force = false) {
		if (_panelModeSwitching) return;
		if (!h || !document.body.contains(h)) return;
		if (!_getDialogControlItems().length) {
			if (_dialogControlLastSig !== '') {
				_dialogControlLastSig = '';
				_renderDialogControlPanel(h);
			}
			if (_dialogControlActive) _scheduleDialogControlSelectionOutlines();
			return;
		}
		_scheduleDialogControlTitleSync(h);
		const sig = _getDialogControlStatusSig();
		if (force || sig !== _dialogControlLastSig) {
			_dialogControlLastSig = sig;
			_renderDialogControlPanel(h);
		} else if (_dialogControlActive) {
			_scheduleDialogControlSelectionOutlines();
		}
	}

	function _startDialogControlLiveRefresh(h = filtersHost) {
		if (_dialogControlRefreshTimer) clearInterval(_dialogControlRefreshTimer);
		_dialogControlLastSig = '';
		_dialogControlRefreshTimer = setInterval(() => {
			if (!h || !document.body.contains(h)) {
				clearInterval(_dialogControlRefreshTimer);
				_dialogControlRefreshTimer = null;
				return;
			}
			_refreshDialogControlPanel(h);
		}, 700);
	}

	function _dialogDockKey() { return `pena.dialogControlDock.${_pMode()}`; }

	function _saveDialogDockState() {
		const dock = _dialogControlDock;
		if (!dock) return;
		const win = dock.querySelector('.dialog-control-window');
		try {
			localStorage.setItem(_dialogDockKey(), JSON.stringify({
				w: win ? win.offsetWidth : 260,
				h: null,
				scale: parseFloat(dock.dataset.dockScale || dock.style.getPropertyValue('--dock-scale') || '1') || 1,
				cols: dock.classList.contains('--cols-2') ? 2 : 1,
				pinned: dock.classList.contains('--pinned')
			}));
		} catch {}
	}

	let _linkedPanelOpacityLifted = false;
	let _linkedPanelOpacityTimer = null;
	function _readLinkedPanelOpacity() {
		const saved = parseInt(localStorage.getItem('pena.panel.opacity') || '100', 10);
		return Math.max(20, Math.min(100, isNaN(saved) ? 100 : saved));
	}

	function _applyLinkedPanelOpacity(value = _readLinkedPanelOpacity(), forceFull = _linkedPanelOpacityLifted) {
		const pct = Math.max(20, Math.min(100, parseInt(value, 10) || 100));
		const opacity = forceFull ? 1 : Math.max(0.2, Math.min(1, pct / 100));
		if (filtersHost) filtersHost.style.opacity = String(opacity);
		if (_dialogControlDock) {
			_dialogControlDock.style.setProperty('--dock-opacity', String(opacity));
			_dialogControlDock.dataset.dockOpacity = String(Math.round(opacity * 100));
			const win = _dialogControlDock.querySelector('.dialog-control-window');
			if (win) win.style.opacity = '';
		}
		return pct;
	}

	function _setLinkedPanelOpacityLift(active) {
		if (_linkedPanelOpacityTimer) {
			clearTimeout(_linkedPanelOpacityTimer);
			_linkedPanelOpacityTimer = null;
		}
		_linkedPanelOpacityLifted = !!active;
		if (_linkedPanelOpacityLifted) {
			_applyLinkedPanelOpacity(_readLinkedPanelOpacity(), true);
			return;
		}
		_linkedPanelOpacityTimer = setTimeout(() => {
			_applyLinkedPanelOpacity(_readLinkedPanelOpacity(), false);
		}, 2000);
	}

	function _syncDialogDockAppearance(panelHost = filtersHost) {
		const dock = _dialogControlDock;
		if (!dock) return;
		const scale = parseFloat(dock.dataset.dockScale || panelHost?.dataset?.panelScale || '1') || 1;
		dock.style.setProperty('--dock-scale', String(scale));
		dock.style.setProperty('--dock-icon-counter-scale', String(1 / Math.max(0.1, scale)));
		_applyLinkedPanelOpacity(_readLinkedPanelOpacity(), _linkedPanelOpacityLifted);
	}

	function _applyDialogDockScale(dock = _dialogControlDock, value = 1) {
		if (!dock) return 1;
		const scale = Math.max(0.65, Math.min(1.5, Number.isFinite(value) ? value : 1));
		dock.dataset.dockScale = String(scale);
		dock.style.setProperty('--dock-scale', String(scale));
		dock.style.setProperty('--dock-icon-counter-scale', String(1 / Math.max(0.1, scale)));
		_fitDialogDockHeight(false);
		return scale;
	}

	function _showDialogDockToast(msg, tone = '') {
		const panel = _ensureDialogControlDock(filtersHost);
		const toast = panel?.querySelector('#anit_dialog_control_toast');
		if (!toast) {
			_showPresetToast(msg, tone);
			return;
		}
		if (_toastTimer) clearTimeout(_toastTimer);
		panel.querySelector('#anit_dialog_control_confirm')?.classList.remove('--show');
		toast.classList.remove('--show');
		toast.textContent = msg;
		toast.classList.remove('--danger', '--ok');
		toast.classList.toggle('--danger', tone === 'danger');
		toast.classList.toggle('--ok', tone === 'ok');
		toast.classList.add('--show');
		_toastTimer = setTimeout(() => {
			toast.classList.remove('--show', '--danger', '--ok');
		}, 2400);
	}

	function _showDialogControlConfirm(msg, okLabel, cancelLabel, onOk) {
		const panel = _ensureDialogControlDock(filtersHost);
		const overlay = panel?.querySelector('#anit_dialog_control_confirm');
		if (!overlay) { onOk(); return; }
		if (_toastTimer) clearTimeout(_toastTimer);
		if (!panel.classList.contains('--host-hidden')) panel.classList.add('--expanded');
		panel.querySelector('#anit_dialog_control_toast')?.classList.remove('--show', '--danger', '--ok');
		overlay.innerHTML = '';
		const p = document.createElement('p');
		p.textContent = msg;
		const btns = document.createElement('div');
		btns.className = 'confirm-btns';
		const ok = document.createElement('button');
		ok.type = 'button';
		ok.className = '--ok';
		ok.textContent = okLabel;
		const cancel = document.createElement('button');
		cancel.type = 'button';
		cancel.textContent = cancelLabel;
		const hide = () => overlay.classList.remove('--show');
		ok.addEventListener('click', () => { hide(); onOk(); });
		cancel.addEventListener('click', hide);
		btns.append(ok, cancel);
		overlay.append(p, btns);
		overlay.classList.add('--show');
	}

	function _placeDialogDockNearPanel(dock, panelHost = filtersHost) {
		if (!dock || !panelHost) return;
		const iconW = parseFloat(getComputedStyle(panelHost).getPropertyValue('--pena-icon-size')) || 24;
		const gap = 12;
		const panelLeft = parseFloat(panelHost.style.left || '8') || 8;
		const panelTop = parseFloat(panelHost.style.top || '8') || 8;
		let left = panelLeft - iconW - gap;
		if (left < 6) {
			const visualW = panelHost.getBoundingClientRect().width || panelHost.offsetWidth || 260;
			left = Math.min(window.innerWidth - iconW - 6, panelLeft + visualW + gap);
		}
		dock.style.left = left + 'px';
		dock.style.top = Math.max(6, Math.min(panelTop, window.innerHeight - 46)) + 'px';
	}

	function _safePositiveNumber(value, fallback = 1) {
		const n = parseFloat(value);
		return Number.isFinite(n) && n > 0 ? n : fallback;
	}

	function _getPanelVisualScale(panelHost = filtersHost) {
		const scale = _safePositiveNumber(panelHost?.dataset?.panelScale, 1);
		const zoom = _safePositiveNumber(panelHost?.style?.zoom, 1);
		return Math.max(0.1, scale * zoom);
	}

	function _getDockVisualScale(dock = _dialogControlDock, panelHost = filtersHost) {
		const scale = _safePositiveNumber(dock?.style?.getPropertyValue('--dock-scale') || panelHost?.dataset?.panelScale, 1);
		const zoom = _safePositiveNumber(dock?.style?.zoom || panelHost?.style?.zoom, 1);
		return Math.max(0.1, scale * zoom);
	}

	function _isFiltersPanelHidden(panelHost = filtersHost) {
		return !!panelHost?.classList?.contains('anit-hidden');
	}

	function _rememberExpandedFiltersPaneMetrics(panelHost = filtersHost) {
		const pane = panelHost?.querySelector?.('.pane');
		if (!pane || _isFiltersPanelHidden(panelHost)) return;
		const rect = pane.getBoundingClientRect?.();
		if (!Number.isFinite(rect?.height) || rect.height <= 0) return;
		const scale = _getPanelVisualScale(panelHost);
		_lastExpandedFiltersPaneHeight = rect.height / Math.max(0.1, scale);
		_lastExpandedFiltersPaneBottom = rect.bottom;
	}

	function _getViewportCssHeightLimit(el, scale, minHeight = 160) {
		const rect = el?.getBoundingClientRect?.();
		const top = Number.isFinite(rect?.top) ? Math.max(0, rect.top) : 0;
		const available = Math.max(96, window.innerHeight - top - 8);
		return Math.max(minHeight, available / Math.max(0.1, scale || 1));
	}

	function _getLinkedPanelMaxHeight(panelHost = filtersHost) {
		const max = panelHost ? _getViewportCssHeightLimit(panelHost, _getPanelVisualScale(panelHost), 220) : window.innerHeight - 16;
		return Math.max(220, max);
	}

	function _getLinkedPanelMinHeight(maxHeight) {
		return Math.min(220, Math.max(120, maxHeight));
	}

	function _clampLinkedPanelHeight(height, panelHost = filtersHost) {
		const max = _getLinkedPanelMaxHeight(panelHost);
		const min = _getLinkedPanelMinHeight(max);
		const value = Number.isFinite(height) ? height : min;
		return Math.max(min, Math.min(max, value));
	}

	function _getMainPaneHeight(panelHost = filtersHost) {
		if (_isFiltersPanelHidden(panelHost) && _lastExpandedFiltersPaneHeight > 0) {
			return _clampLinkedPanelHeight(_lastExpandedFiltersPaneHeight, panelHost);
		}
		const pane = panelHost?.querySelector?.('.pane');
		const visual = pane?.getBoundingClientRect?.().height;
		const scale = _getPanelVisualScale(panelHost);
		const raw = (Number.isFinite(visual) && visual > 0 ? visual / scale : 0) || parseFloat(pane?.style?.maxHeight || '') || pane?.offsetHeight || 0;
		return _clampLinkedPanelHeight(raw || _getLinkedPanelMaxHeight(panelHost), panelHost);
	}

	function _getDialogDockMaxHeight(panelHost = filtersHost, dock = _dialogControlDock, win = null) {
		if (_isFiltersPanelHidden(panelHost)) {
			const winRect = win?.getBoundingClientRect?.() || dock?.querySelector?.('.dialog-control-window')?.getBoundingClientRect?.();
			const scale = _getDockVisualScale(dock, null);
			if (Number.isFinite(_lastExpandedFiltersPaneBottom) && _lastExpandedFiltersPaneBottom > 0 && Number.isFinite(winRect?.top)) {
				return Math.max(132, (_lastExpandedFiltersPaneBottom - winRect.top) / Math.max(0.1, scale));
			}
			return _getMainPaneHeight(panelHost);
		}
		_rememberExpandedFiltersPaneMetrics(panelHost);
		const pane = panelHost?.querySelector?.('.pane');
		const paneRect = pane?.getBoundingClientRect?.();
		const winRect = win?.getBoundingClientRect?.() || dock?.querySelector?.('.dialog-control-window')?.getBoundingClientRect?.();
		const scale = _getDockVisualScale(dock, panelHost);
		if (Number.isFinite(paneRect?.bottom) && Number.isFinite(winRect?.top)) {
			const available = (paneRect.bottom - winRect.top) / scale;
			return Math.max(132, available);
		}
		return _getMainPaneHeight(panelHost);
	}

	function _clampDialogDockHeightToMain(height, panelHost = filtersHost, dock = _dialogControlDock, win = null) {
		const max = _getDialogDockMaxHeight(panelHost, dock, win);
		const min = Math.min(132, max);
		const value = Number.isFinite(height) ? height : min;
		return Math.max(min, Math.min(max, value));
	}

	function _clampDialogDockResizeWidth(width, panelHost = filtersHost) {
		const dock = _dialogControlDock;
		const scale = _getDockVisualScale(dock, panelHost);
		const dockRect = dock?.getBoundingClientRect?.();
		const hasDockPosition = !!dock?.style?.left;
		const availableVisual = hasDockPosition && Number.isFinite(dockRect?.right) ? Math.max(220, dockRect.right - 8) : window.innerWidth - 8;
		const max = Math.max(220, Math.min(520, availableVisual / scale));
		return Math.max(220, Math.min(max, Number.isFinite(width) ? width : 260));
	}

	function _syncDialogDockWidthToPanel(panelHost = filtersHost) {
		const dock = _dialogControlDock;
		const win = dock?.querySelector('.dialog-control-window');
		if (!dock || !win || !panelHost) return;
		if (_isFiltersPanelHidden(panelHost)) return;
		const max = _clampDialogDockResizeWidth(520, panelHost);
		dock.style.setProperty('--dock-max-width', max + 'px');
		win.style.maxWidth = max + 'px';
		const current = win.offsetWidth || parseFloat(win.style.width || '') || 260;
		const next = _clampDialogDockResizeWidth(current, panelHost);
		if (Math.abs(current - next) > 0.5) win.style.width = next + 'px';
		_fitDialogDockHeight(false);
	}

	function _getDialogDockContentHeight(win, list) {
		if (!win || !list) return 160;
		const prevWinHeight = win.style.height;
		const prevWinMinHeight = win.style.minHeight;
		const prevWinMaxHeight = win.style.maxHeight;
		const prevListFlex = list.style.flex;
		const prevListHeight = list.style.height;
		const prevListMaxHeight = list.style.maxHeight;
		const prevListOverflow = list.style.overflow;
		try {
			win.style.height = 'auto';
			win.style.minHeight = '0px';
			win.style.maxHeight = 'none';
			list.style.flex = '0 0 auto';
			list.style.height = 'auto';
			list.style.maxHeight = 'none';
			list.style.overflow = 'visible';
			const st = getComputedStyle(win);
			const pad = (parseFloat(st.paddingTop) || 0) + (parseFloat(st.paddingBottom) || 0);
			const border = (parseFloat(st.borderTopWidth) || 0) + (parseFloat(st.borderBottomWidth) || 0);
			const header = win.querySelector('.dialog-control-header');
			const headerH = header ? header.offsetHeight + (parseFloat(getComputedStyle(header).marginBottom) || 0) : 0;
			return Math.ceil(pad + border + headerH + list.scrollHeight + 8);
		} finally {
			win.style.height = prevWinHeight;
			win.style.minHeight = prevWinMinHeight;
			win.style.maxHeight = prevWinMaxHeight;
			list.style.flex = prevListFlex;
			list.style.height = prevListHeight;
			list.style.maxHeight = prevListMaxHeight;
			list.style.overflow = prevListOverflow;
		}
	}

	function _setDialogDockListOverflow(list, canScroll) {
		if (!list) return;
		list.style.overflow = canScroll ? 'auto' : 'hidden';
	}

	function _syncLinkedPanelHeights() {
		const dock = _dialogControlDock;
		const win = dock?.querySelector('.dialog-control-window');
		const list = dock?.querySelector('#anit_dialog_control_list');
		const pane = filtersHost?.querySelector('.pane');
		if (!dock || !win || !list || !pane || !_getDialogControlItems().length) return;
		const contentH = _getDialogDockContentHeight(win, list);
		const mainH = _getDialogDockMaxHeight(filtersHost, dock, win);
		dock.classList.remove('--manual-height');
		const desired = _clampDialogDockHeightToMain(contentH, filtersHost, dock, win);
		const minHeight = Math.min(132, mainH);
		const fits = contentH <= desired + 1;
		win.style.minHeight = minHeight + 'px';
		win.style.maxHeight = mainH + 'px';
		win.style.height = desired + 'px';
		_setDialogDockListOverflow(list, !fits);
	}

	function _fitDialogDockHeight(autoGrow = false) {
		const dock = _dialogControlDock;
		const win = dock?.querySelector('.dialog-control-window');
		const list = dock?.querySelector('#anit_dialog_control_list');
		if (!dock || !win || !list) return;
		if (!_getDialogControlItems().length) {
			dock.classList.remove('--manual-height');
			win.style.height = 'auto';
			win.style.minHeight = '0px';
			win.style.maxHeight = 'none';
			_setDialogDockListOverflow(list, false);
			return;
		}
		_syncLinkedPanelHeights();
	}

	function _clearDialogDockHostHiddenState() {
		const dock = _dialogControlDock || document.getElementById('anit-dialog-control-dock');
		if (!dock) return;
		if (_dialogDockHideFinalizeTimer) {
			clearTimeout(_dialogDockHideFinalizeTimer);
			_dialogDockHideFinalizeTimer = null;
		}
		document.documentElement.classList.remove('pena-linked-panels-hidden');
		dock.style.pointerEvents = '';
		dock.style.removeProperty('width');
		dock.style.removeProperty('height');
		dock.classList.remove('--host-hidden', '--host-hidden-final');
		const toggle = dock.querySelector('.dialog-control-toggle');
		if (toggle) toggle.style.removeProperty('display');
		const win = dock.querySelector('.dialog-control-window');
		if (win) {
			win.style.removeProperty('display');
			win.style.removeProperty('opacity');
			win.style.removeProperty('pointer-events');
			win.style.removeProperty('visibility');
		}
	}

	function _setDialogDockOpenByUi(open, panelHost = filtersHost) {
		const dock = _dialogControlDock || document.getElementById('anit-dialog-control-dock');
		if (!dock) return;
		if (_dialogDockAutoCloseTimer) {
			clearTimeout(_dialogDockAutoCloseTimer);
			_dialogDockAutoCloseTimer = null;
		}
		dock.style.removeProperty('width');
		dock.style.removeProperty('height');
		dock.style.pointerEvents = '';
		dock.classList.remove('--host-hidden', '--host-hidden-final');
		const toggle = dock.querySelector('.dialog-control-toggle');
		if (toggle) toggle.style.removeProperty('display');
		const win = dock.querySelector('.dialog-control-window');
		if (win) {
			win.style.removeProperty('display');
			win.style.removeProperty('opacity');
			win.style.removeProperty('pointer-events');
			win.style.removeProperty('visibility');
		}
		dock.querySelector('#anit_dialog_control_confirm')?.classList.remove('--show');
		dock.querySelector('#anit_dialog_control_toast')?.classList.remove('--show', '--danger', '--ok');
		if (open) {
			dock.dataset.openedByClick = '1';
			dock.classList.add('--expanded');
			_syncDialogDockAppearance(panelHost);
			_refreshDialogControlPanel(panelHost, true);
			_fitDialogDockHeight(false);
		} else {
			dock.dataset.openedByClick = '';
			dock.classList.remove('--expanded');
			_saveDialogDockState();
		}
	}

	function _clearDialogDockAutoClose() {
		if (_dialogDockAutoCloseTimer) {
			clearTimeout(_dialogDockAutoCloseTimer);
			_dialogDockAutoCloseTimer = null;
		}
	}

	function _setDialogDockPinned(pinned, panelHost = filtersHost) {
		const dock = _dialogControlDock || document.getElementById('anit-dialog-control-dock');
		if (!dock) return;
		const shouldPin = !!pinned;
		dock.classList.toggle('--pinned', shouldPin);
		if (shouldPin) {
			dock.classList.add('--expanded');
			_clearDialogDockAutoClose();
		}
		_syncDialogDockPinButton(dock);
		_syncDialogDockAppearance(panelHost);
		_refreshDialogControlPanel(panelHost, true);
		_fitDialogDockHeight(false);
		_saveDialogDockState();
	}

	function _scheduleDialogDockAutoClose() {
		const dock = _dialogControlDock || document.getElementById('anit-dialog-control-dock');
		if (!dock || dock.classList.contains('--pinned') || !dock.classList.contains('--expanded')) return;
		_clearDialogDockAutoClose();
		_dialogDockAutoCloseTimer = setTimeout(() => {
			_dialogDockAutoCloseTimer = null;
			const current = _dialogControlDock || document.getElementById('anit-dialog-control-dock');
			if (!current || current.classList.contains('--pinned')) return;
			_setDialogDockOpenByUi(false, filtersHost);
		}, 7000);
	}

	function _syncDialogDockPinButton(dock = _dialogControlDock) {
		const btn = dock?.querySelector('.dialog-control-close');
		if (!btn) return;
		const pinned = !!dock?.classList.contains('--pinned');
		btn.classList.toggle('--active', pinned);
		btn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
		btn.title = pinned ? 'Открепить док контроля' : 'Закрепить док контроля';
		btn.innerHTML = pinned
			? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="10" width="11" height="9" rx="2"/><path d="M9 10V7.5a3 3 0 0 1 6 0V10"/></svg>'
			: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="10" width="11" height="9" rx="2"/><path d="M9 10V7.7a3 3 0 0 1 5.4-1.8"/></svg>';
	}

	function _applyDialogDockColumns(dock = _dialogControlDock, cols = 1) {
		if (!dock) return;
		const two = Number(cols) === 2;
		dock.classList.toggle('--cols-2', two);
		const btn = dock.querySelector('.dialog-control-columns-btn');
		if (btn) {
			btn.classList.toggle('--active', two);
			btn.setAttribute('aria-pressed', two ? 'true' : 'false');
			btn.title = two ? 'Показать в одну колонку' : 'Показать в две колонки';
		}
	}

	function _syncDialogDockToPanel(panelHost = filtersHost, grow = false) {
		if (_panelModeSwitching) return;
		if (!_dialogControlDock || !panelHost || !document.body.contains(_dialogControlDock)) return;
		if (_isFiltersPanelHidden(panelHost)) return;
		_placeDialogDockNearPanel(_dialogControlDock, panelHost);
		_syncDialogDockWidthToPanel(panelHost);
		if (grow) _syncLinkedPanelHeights();
	}

	function _ensureDialogControlDock(panelHost = filtersHost) {
		let dock = document.getElementById('anit-dialog-control-dock');
		if (dock) {
			_dialogControlDock = dock;
			if (dock.dataset.mode !== _pMode()) {
				_forceCloseDialogControlPalettes();
				dock.dataset.mode = _pMode();
				const saved = (() => { try { return JSON.parse(localStorage.getItem(_dialogDockKey()) || '{}'); } catch { return {}; } })();
				const win = dock.querySelector('.dialog-control-window');
				if (win) {
					if (Number.isFinite(saved.w)) win.style.width = Math.max(220, Math.min(520, saved.w)) + 'px';
					win.style.removeProperty('height');
					dock.classList.remove('--manual-height');
				}
				_applyDialogDockScale(dock, Number.isFinite(saved.scale) ? saved.scale : (parseFloat(panelHost?.dataset?.panelScale || '1') || 1));
				dock.classList.toggle('--pinned', !!saved.pinned);
				_applyDialogDockColumns(dock, saved.cols);
			}
			_syncDialogDockAppearance(panelHost);
			_placeDialogDockNearPanel(dock, panelHost);
			_syncDialogDockWidthToPanel(panelHost, false);
			_syncDialogDockPinButton(dock);
			return dock;
		}
		dock = document.createElement('div');
		dock.id = 'anit-dialog-control-dock';
		dock.dataset.mode = _pMode();
		dock.innerHTML = `
			<button type="button" class="dialog-control-toggle" title="Диалоги под контролем">
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>
			</button>
			<div class="dialog-control-window">
				<div class="dialog-control-header">
					<div class="dialog-control-brand">
						${_PENA_LOGO_URL
							? `<img src="${_PENA_LOGO_URL}" class="dialog-control-logo" alt="PENA Agency">`
							: `<span class="dialog-control-logo-fallback" aria-hidden="true">PA</span>`}
						<div class="dialog-control-section">Контроль</div>
					</div>
					<div class="dialog-control-actions">
						<button type="button" class="dialog-control-mode-btn" title="Выбрать диалог для контроля" aria-pressed="false">
							<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg>
						</button>
						<button type="button" class="dialog-control-folder-add-btn" title="Создать папку">
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"/><path d="M12 11v5"/><path d="M9.5 13.5h5"/></svg>
						</button>
						<button type="button" class="dialog-control-clear-btn" title="Очистить список">
							<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M7 7l1 13h8l1-13"/><path d="M9 7V4h6v3"/></svg>
						</button>
						<button type="button" class="dialog-control-columns-btn" title="Показать в две колонки" aria-pressed="false">
							<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="6" height="14" rx="1.5"/><rect x="14" y="5" width="6" height="14" rx="1.5"/></svg>
						</button>
						<button type="button" class="dialog-control-close" title="Свернуть">
							<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="10" width="11" height="9" rx="2"/><path d="M9 10V7.7a3 3 0 0 1 5.4-1.8"/></svg>
						</button>
					</div>
				</div>
				<div class="dialog-control-confirm" id="anit_dialog_control_confirm"></div>
				<div class="dialog-control-toast" id="anit_dialog_control_toast"></div>
				<div id="anit_dialog_control_overlay"><span class="anit-control-flag"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/></svg><span>Режим контроля диалога</span></span></div>
				<div class="dialog-control-list" id="anit_dialog_control_list"></div>
			</div>`;
		document.body.appendChild(dock);
		_dialogControlDock = dock;
		const externalScale = parseFloat(panelHost?.dataset?.externalScale || '1') || 1;
		dock.style.zoom = String(1 / externalScale);

		const saved = (() => { try { return JSON.parse(localStorage.getItem(_dialogDockKey()) || '{}'); } catch { return {}; } })();
		const win = dock.querySelector('.dialog-control-window');
		if (win) {
			if (Number.isFinite(saved.w)) win.style.width = Math.max(220, Math.min(520, saved.w)) + 'px';
			win.style.removeProperty('height');
			dock.classList.remove('--manual-height');
		}
		_applyDialogDockScale(dock, Number.isFinite(saved.scale) ? saved.scale : (parseFloat(panelHost?.dataset?.panelScale || '1') || 1));
		_applyDialogDockColumns(dock, saved.cols);
		_placeDialogDockNearPanel(dock, panelHost);
		_syncDialogDockWidthToPanel(panelHost, false);
		dock.classList.toggle('--pinned', !!saved.pinned);
		_syncDialogDockAppearance(panelHost);
		_syncDialogDockPinButton(dock);
		dock.addEventListener('mouseenter', () => {
			_setLinkedPanelOpacityLift(true);
			_clearDialogDockAutoClose();
			_setDialogDockOpenByUi(true, panelHost);
		});
		dock.addEventListener('mouseleave', () => {
			_setLinkedPanelOpacityLift(false);
			_scheduleDialogDockAutoClose();
		});
		dock.querySelector('.dialog-control-close')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			_closeDialogControlPalettes(false);
			_setDialogDockPinned(!dock.classList.contains('--pinned'), panelHost);
			if (!dock.classList.contains('--pinned')) _scheduleDialogDockAutoClose();
		});
		dock.querySelector('.dialog-control-folder-add-btn')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			_closeDialogControlPalettes(false);
			_createDialogControlFolder();
			dock.classList.add('--expanded');
			_fitDialogDockHeight(true);
		});
		dock.querySelector('.dialog-control-clear-btn')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (!_getDialogControlItems().length) {
				_showDialogDockToast('Список уже пуст', 'danger');
				return;
			}
			_showDialogControlConfirm(
				'Очистить все диалоги под контролем?',
				'Очистить', 'Отмена',
				() => {
					_dialogControlItems[_pMode()] = [];
					_saveDialogControlItems();
					_renderDialogControlPanel(panelHost);
					_showDialogDockToast('Список контроля очищен', 'ok');
				}
			);
		});
		dock.querySelector('.dialog-control-columns-btn')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const next = dock.classList.contains('--cols-2') ? 1 : 2;
			_applyDialogDockColumns(dock, next);
			_syncDialogDockWidthToPanel(panelHost, !!_getDialogControlItems().length);
			_saveDialogDockState();
		});
		dock.querySelector('.dialog-control-mode-btn')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (_dialogControlActive) {
				_exitDialogControlMode();
				/*
					'Выключить режим контроля диалога?',
					'Выключить', 'Отмена',
				*/
			} else {
				_enterDialogControlMode();
				/*
					'Войти в режим контроля? Следующим кликом выберите диалог в ленте.',
					'Войти', 'Отмена',
				*/
			}
		});
		const dockResizeClasses = ['dock-rz-w', 'dock-rz-s', 'dock-rz-sw'];
		const dockResizeEdge = 12;
		let rz = null;
		const getDockWin = () => dock.querySelector('.dialog-control-window');
		const isDockOpen = () => dock.classList.contains('--expanded') || dock.classList.contains('--pinned');
		const getDockEdges = (e) => {
			const w = getDockWin();
			if (!w || !isDockOpen()) return { l: false, r: false, b: false };
			const r = w.getBoundingClientRect();
			const leftEdge = e.clientX <= r.left + dockResizeEdge;
			const bottomEdge = e.clientY >= r.bottom - dockResizeEdge;
			return {
				l: leftEdge,
				r: false,
				b: leftEdge && bottomEdge
			};
		};
		const dockEdgeClass = (g) => {
			if (g.l && g.b) return 'dock-rz-sw';
			if (g.l) return 'dock-rz-w';
			if (g.b) return 'dock-rz-s';
			return '';
		};
		const setDockResizeCursor = (cls) => {
			dock.classList.remove(...dockResizeClasses);
			if (cls) dock.classList.add(cls);
		};
		dock.addEventListener('mousemove', (e) => {
			if (rz) return;
			if (!isDockOpen()) {
				setDockResizeCursor('');
				return;
			}
			const edges = getDockEdges(e);
			const overUI = !!e.target.closest('button,input,select,textarea,a,[contenteditable],.dialog-control-chip,.dialog-control-folder,label');
			setDockResizeCursor(overUI && !edges.l && !edges.r && !edges.b ? '' : dockEdgeClass(edges));
		});
		dock.addEventListener('mouseleave', () => {
			if (!rz) setDockResizeCursor('');
		});
		dock.addEventListener('mousedown', (e) => {
			if (e.button !== 0 || !isDockOpen()) return;
			const edges = getDockEdges(e);
			if (!edges.l && !edges.r && !edges.b) return;
			const w = getDockWin();
			if (!w) return;
			rz = { x: e.clientX, y: e.clientY, w: w.offsetWidth, h: w.offsetHeight, edges, scale: _getDockVisualScale(dock, filtersHost), dockScale: _safePositiveNumber(dock.dataset.dockScale || dock.style.getPropertyValue('--dock-scale'), 1) };
			e.preventDefault();
			e.stopPropagation();
			setDockResizeCursor(dockEdgeClass(edges));
		});
		document.addEventListener('mousemove', (e) => {
			if (!rz) return;
			const w = getDockWin();
			if (!w) return;
			const dx = (e.clientX - rz.x) / (rz.scale || 1);
			const dy = (e.clientY - rz.y) / (rz.scale || 1);
			if (rz.edges.l && rz.edges.b) {
				const rawDx = rz.x - e.clientX;
				const rawDy = e.clientY - rz.y;
				const delta = Math.abs(rawDx) >= Math.abs(rawDy) ? rawDx : rawDy;
				_applyDialogDockScale(dock, rz.dockScale + (delta / 360));
				_fitDialogDockHeight(true);
				e.preventDefault();
				return;
			}
			let nextW = null;
			if (rz.edges.l) nextW = _clampDialogDockResizeWidth(rz.w - dx, filtersHost);
			if (rz.edges.r) nextW = _clampDialogDockResizeWidth(rz.w + dx, filtersHost);
			if (nextW !== null) {
				w.style.width = nextW + 'px';
				_fitDialogDockHeight(true);
			}
			_fitDialogDockHeight(true);
			e.preventDefault();
		});
		document.addEventListener('mouseup', () => {
			if (!rz) return;
			rz = null;
			setDockResizeCursor('');
			_saveDialogDockState();
		});

		let dockDrag = null;
		dock.addEventListener('mousedown', (e) => {
			if (e.button !== 0) return;
			const t = e.target;
			const fromToggle = !!t.closest('.dialog-control-toggle');
			if (!fromToggle && !t.closest('.dialog-control-window')) return;
			if (!fromToggle && t.closest('button,input,select,textarea,a,[contenteditable],.dialog-control-chip,.dialog-control-folder,.dialog-control-confirm,.dialog-control-toast')) return;
			const edges = getDockEdges(e);
			if (edges.l || edges.r || edges.b) return;
			const main = filtersHost;
			dockDrag = {
				x: e.clientX,
				y: e.clientY,
				left: parseFloat(dock.style.left || '0') || 0,
				top: parseFloat(dock.style.top || '0') || 0,
				main,
				mainLeft: main ? (parseFloat(main.style.left || '0') || 0) : 0,
				mainTop: main ? (parseFloat(main.style.top || '0') || 0) : 0
			};
			dock.classList.add('dock-dragging');
			main?.classList.add('anit-dragging');
			e.preventDefault();
			e.stopPropagation();
		});
		document.addEventListener('mousemove', (e) => {
			if (!dockDrag) return;
			const dx = e.clientX - dockDrag.x;
			const dy = e.clientY - dockDrag.y;
			if (dockDrag.main && document.body.contains(dockDrag.main)) {
				const r = dockDrag.main.getBoundingClientRect();
				const maxLeft = Math.max(0, window.innerWidth - r.width);
				const maxTop = Math.max(0, window.innerHeight - r.height);
				dockDrag.main.style.left = Math.max(0, Math.min(dockDrag.mainLeft + dx, maxLeft)) + 'px';
				dockDrag.main.style.top = Math.max(0, Math.min(dockDrag.mainTop + dy, maxTop)) + 'px';
				_placeDialogDockNearPanel(dock, dockDrag.main);
			} else {
				dock.style.left = Math.max(6, Math.min(dockDrag.left + dx, window.innerWidth - 30)) + 'px';
				dock.style.top = Math.max(6, Math.min(dockDrag.top + dy, window.innerHeight - 30)) + 'px';
			}
			if (Math.abs(e.clientX - dockDrag.x) > 3 || Math.abs(e.clientY - dockDrag.y) > 3) dockDrag.moved = true;
		});
		document.addEventListener('mouseup', () => {
			if (!dockDrag) return;
			const main = dockDrag.main;
			const moved = dockDrag.moved;
			dockDrag = null;
			dock.classList.remove('dock-dragging');
			main?.classList.remove('anit-dragging');
			if (main && document.body.contains(main)) {
				try {
					localStorage.setItem(POS_LS_KEY(IS_OL_FRAME ? 'ol' : 'internal'), JSON.stringify({
						left: parseInt(main.style.left || '0', 10) || 0,
						top: parseInt(main.style.top || '0', 10) || 0
					}));
				} catch {}
			}
			if (moved) dock.dataset.lastDragTs = String(Date.now());
			if (main && document.body.contains(main)) {
				const pane = main.querySelector('.pane');
				try { localStorage.setItem(`pena.panelSize.${_pMode()}`, JSON.stringify({ w: main.style.width, h: pane?.style.maxHeight || '' })); } catch {}
			}
			_saveDialogDockState();
		});

		return dock;
	}

	function _renderDialogControlPanel(h = filtersHost) {
		if (_panelModeSwitching) return;
		const panel = _ensureDialogControlDock(h);
		const list = panel?.querySelector('#anit_dialog_control_list');
		if (!panel || !list) return;
		const items = _getDialogControlItems();
		_ensureDialogControlFoldersIntegrity(items);
		_pruneDialogControlMultiSelection(items);
		const folderMap = _getDialogControlFolderMap(items);
		let titlesChanged = false;
		panel.classList.toggle('--empty', !items.length);
		panel.classList.toggle('--has-items', !!items.length);
		list.innerHTML = '';
		if (!items.length) {
			_clearDialogControlMultiSelection();
			const empty = document.createElement('div');
			empty.className = 'dialog-control-empty';
			empty.textContent = 'Диалогов под контролем нет';
			list.appendChild(empty);
			_fitDialogDockHeight(false);
			return;
		}
		const dropLine = document.createElement('div');
		dropLine.className = 'dialog-control-drop-line';
		list.appendChild(dropLine);
		let draggingId = null;
		let draggingType = '';
		let draggingIds = new Set();
		let draggingItems = [];
		let overRow = null;
		let dropSide = 'before';
		let dropIntent = null;
		let dropRowsCache = null;
		let visibleFolderChildrenCache = null;
		let lastDropKey = '';
		const invalidateDropMetrics = () => {
			dropRowsCache = null;
			visibleFolderChildrenCache = null;
			lastDropKey = '';
		};
		const visibleChatIndex = buildChatElementIndex();
		items.forEach(item => {
			if (_syncDialogControlItemTitleFromElement(item, visibleChatIndex)) titlesChanged = true;
		});
		const multiSelectedCount = _getDialogControlMultiSelectedItems(items).length;
		const currentDialogId = multiSelectedCount > 0 ? null : _getDialogControlCurrentId(items, visibleChatIndex);
		const syncCurrentHighlightInPanel = (selectedCount = null) => {
			const count = Number.isFinite(selectedCount) ? selectedCount : _getDialogControlMultiSelectedItems(_getDialogControlItems()).length;
			const activeId = count > 0 ? '' : _getDialogControlCurrentId(_getDialogControlItems(), buildChatElementIndex());
			list.querySelectorAll('.dialog-control-chip').forEach(el => {
				const isCurrent = !!activeId && normId(el.dataset.dialogId) === activeId;
				el.classList.toggle('--current', isCurrent);
				el.setAttribute('aria-current', isCurrent ? 'true' : 'false');
			});
		};
		const syncMultiSelectionInPanel = () => {
			const selected = _getDialogControlMultiSelectedItems(_getDialogControlItems());
			const selectedIds = new Set(selected.map(item => String(item.id)));
			list.querySelectorAll('.dialog-control-chip').forEach(el => {
				const isSelected = selectedIds.has(String(el.dataset.dialogId || ''));
				el.classList.toggle('--multi-selected', isSelected);
				el.setAttribute('aria-selected', isSelected ? 'true' : 'false');
			});
			syncCurrentHighlightInPanel(selected.length);
			return selected.length;
		};
		const includeCurrentDialogInFreshMultiSelection = (clickedId) => {
			if (_getDialogControlMultiSelectedItems(items).length) return;
			const activeId = _getDialogControlCurrentId(items, visibleChatIndex);
			if (!activeId || activeId === normId(clickedId)) return;
			const activeItem = items.find(candidate => !_isDialogControlFolder(candidate) && normId(candidate.id) === activeId);
			if (activeItem) _dialogControlMultiSelected.add(String(activeItem.id));
		};
		const clearMultiSelectionInPanel = (options = {}) => {
			const changed = _clearDialogControlMultiSelection();
			if (!changed) return false;
			list.querySelectorAll('.dialog-control-chip.--multi-selected').forEach(el => {
				el.classList.remove('--multi-selected');
				el.setAttribute('aria-selected', 'false');
			});
			if (!options.skipCurrentSync) syncCurrentHighlightInPanel(0);
			return true;
		};
		panel._penaClearDialogControlMultiSelection = clearMultiSelectionInPanel;
		if (!panel._penaMultiSelectionClearAttached) {
			panel._penaMultiSelectionClearAttached = true;
			panel.addEventListener('click', (e) => {
				const targetEl = e.target?.nodeType === 1 ? e.target : e.target?.parentElement || null;
				if (targetEl?.closest?.('.dialog-control-chip')) return;
				if (targetEl?.closest?.('button,input,select,textarea,a,[contenteditable],.dialog-control-palette')) return;
				panel._penaClearDialogControlMultiSelection?.();
			});
		}
		if (!panel._penaOutsideMultiSelectionClearAttached) {
			panel._penaOutsideMultiSelectionClearAttached = true;
			document.addEventListener('click', (e) => {
				const targetEl = e.target?.nodeType === 1 ? e.target : e.target?.parentElement || null;
				if (!targetEl) return;
				const dock = document.getElementById('anit-dialog-control-dock');
				const filtersPanel = document.getElementById('anit-filters');
				if (dock?.contains(targetEl) || filtersPanel?.contains(targetEl) || targetEl.closest?.('.dialog-control-palette')) return;
				dock?._penaClearDialogControlMultiSelection?.();
			}, true);
		}
		const hideDropLine = () => {
			dropLine.classList.remove('--show', '--neutral', '--folder-start', '--folder-after', '--folder-end', '--hierarchy-up', '--root');
			dropLine.removeAttribute('style');
		};
		const clearDragOver = () => {
			if (overRow) overRow.classList.remove('--drop-before', '--drop-after', '--drop-into');
			list.querySelectorAll('.--drop-before,.--drop-after,.--drop-into').forEach(row => row.classList.remove('--drop-before', '--drop-after', '--drop-into'));
			overRow = null;
			list.classList.remove('--drop-root');
			dropIntent = null;
			lastDropKey = '';
			hideDropLine();
		};
		const setDropMarker = (row, side) => {
			if (!row) {
				clearDragOver();
				return;
			}
			list.classList.remove('--drop-root');
			if (overRow && overRow !== row) overRow.classList.remove('--drop-before', '--drop-after', '--drop-into');
			overRow = row;
			dropIntent = { root: false, row, side };
			dropSide = side;
			const visualSide = side === 'folder-start' || side === 'folder-after' || side === 'folder-end' ? 'after' : side;
			row.classList.toggle('--drop-into', visualSide === 'inside');
			row.classList.remove('--drop-before', '--drop-after');
			if (visualSide === 'inside') {
				hideDropLine();
				return;
			}
			dropLine.classList.remove('--neutral', '--folder-start', '--folder-after', '--folder-end', '--hierarchy-up', '--root');
			dropLine.classList.toggle('--folder-start', side === 'folder-start');
			dropLine.classList.toggle('--folder-after', side === 'folder-after');
			dropLine.classList.toggle('--folder-end', side === 'folder-end');
			const movedItems = draggingType === 'dialog' ? getCurrentDragItems() : [];
			const hierarchyUp = draggingType === 'folder' || side === 'folder-after' || !!(movedItems.some(item => item?.folderId) && side !== 'folder-start' && side !== 'folder-end' && !row.dataset?.parentFolderId);
			dropLine.classList.toggle('--hierarchy-up', hierarchyUp);
			dropLine.classList.toggle('--neutral', !hierarchyUp && side !== 'folder-start' && side !== 'folder-end');
			const markerRow = side === 'folder-after' && row?.dataset?.folderId
				? (getLastVisibleFolderChildRow(row.dataset.folderId) || row)
				: row;
			const top = visualSide === 'before'
				? markerRow.offsetTop - 3
				: markerRow.offsetTop + markerRow.offsetHeight + 3;
			const isFolderAfter = side === 'folder-after';
			const folderStartIndent = side === 'folder-start' && row?.dataset?.folderId ? 18 : 8;
			const left = isFolderAfter || hierarchyUp ? 8 : Math.max(8, markerRow.offsetLeft + folderStartIndent);
			const right = isFolderAfter || hierarchyUp ? 8 : Math.max(8, list.clientWidth - (markerRow.offsetLeft + markerRow.offsetWidth) + 8);
			dropLine.style.top = Math.max(1, top) + 'px';
			dropLine.style.left = left + 'px';
			dropLine.style.right = right + 'px';
			dropLine.classList.add('--show');
		};
		const getVisibleDropRows = () => Array.from(list.querySelectorAll('.dialog-control-folder,.dialog-control-chip'));
		const getVisibleFolderChildrenMap = () => {
			if (visibleFolderChildrenCache) return visibleFolderChildrenCache;
			const map = new Map();
			Array.from(list.children).forEach(el => {
				const id = String(el.dataset?.parentFolderId || '');
				if (!id) return;
				if (!map.has(id)) map.set(id, []);
				map.get(id).push(el);
			});
			visibleFolderChildrenCache = map;
			return map;
		};
		const setRootDropMarker = () => {
			if (overRow) overRow.classList.remove('--drop-before', '--drop-after', '--drop-into');
			overRow = null;
			dropIntent = { root: true };
			dropSide = 'root';
			list.classList.remove('--drop-root');
			dropLine.classList.remove('--neutral', '--folder-start', '--folder-after', '--folder-end', '--hierarchy-up', '--root');
			dropLine.classList.add('--hierarchy-up', '--root');
			const rows = getDropRowInfos();
			const last = rows[rows.length - 1]?.row || null;
			const top = last ? last.offsetTop + last.offsetHeight + 3 : 4;
			dropLine.style.top = Math.max(1, top) + 'px';
			dropLine.style.left = '8px';
			dropLine.style.right = '8px';
			dropLine.classList.add('--show');
		};
		const hasVisibleFolderChildren = (folderId) => {
			const id = String(folderId || '');
			return !!getVisibleFolderChildrenMap().get(id)?.length;
		};
		const getFolderRow = (folderId) => {
			const id = String(folderId || '');
			return Array.from(list.children).find(el => String(el.dataset?.folderId || '') === id) || null;
		};
		const getLastVisibleFolderChildRow = (folderId) => {
			const id = String(folderId || '');
			const children = getVisibleFolderChildrenMap().get(id) || [];
			return children.length ? children[children.length - 1] : null;
		};
		const isLastVisibleFolderChild = (row) => {
			const id = String(row?.dataset?.parentFolderId || '');
			if (!id) return false;
			const children = getVisibleFolderChildrenMap().get(id) || [];
			return !!children.length && children[children.length - 1] === row;
		};
		const getEventElement = (target) => {
			return target?.nodeType === 1 ? target : target?.parentElement || null;
		};
		const getDropTargetId = (row) => {
			return row?.dataset?.folderId || row?.dataset?.dialogId || '';
		};
		const getDraggingIds = () => draggingIds instanceof Set && draggingIds.size
			? draggingIds
			: new Set(draggingId ? [String(draggingId)] : []);
		const isDraggingTargetId = (id) => {
			const value = String(id || '');
			return !!value && getDraggingIds().has(value);
		};
		const getCurrentDragItems = () => {
			if (draggingItems.length) return draggingItems;
			const activeIds = getDraggingIds();
			if (!activeIds.size) return [];
			return _getDialogControlItems().filter(item => !_isDialogControlFolder(item) && activeIds.has(String(item.id)));
		};
		const markDraggingRows = (active) => {
			list.querySelectorAll('.dialog-control-chip.--dragging,.dialog-control-folder.--dragging,.dialog-control-chip.--drag-origin').forEach(el => {
				el.classList.remove('--dragging', '--drag-origin');
				delete el.dataset.dragCount;
			});
			list.classList.remove('--multi-dragging');
			delete list.dataset.dragCount;
			if (!active) return;
			const activeIds = getDraggingIds();
			const dragCount = activeIds.size;
			list.classList.toggle('--multi-dragging', dragCount > 1);
			if (dragCount > 1) list.dataset.dragCount = String(dragCount);
			list.querySelectorAll('.dialog-control-chip,.dialog-control-folder').forEach(el => {
				if (activeIds.has(String(getDropTargetId(el)))) el.classList.add('--dragging');
			});
		};
		const setMultiDragImage = (event, count) => {
			if (!event?.dataTransfer || count < 2) return;
			const ghost = document.createElement('div');
			ghost.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:74px;height:34px;border:1px solid rgba(77,157,255,.72);border-radius:8px;background:rgba(12,16,24,.96);box-shadow:0 10px 24px rgba(0,0,0,.36);display:grid;place-items:center;color:#fff;font:800 13px system-ui,-apple-system,Segoe UI,Roboto,Arial;box-sizing:border-box;pointer-events:none;';
			ghost.innerHTML = '<span style="position:absolute;left:13px;top:9px;width:24px;height:16px;border:1px solid rgba(255,255,255,.38);border-radius:5px;background:rgba(255,255,255,.08);box-shadow:8px 3px 0 rgba(255,255,255,.12)"></span><span style="position:absolute;right:10px;top:7px;min-width:20px;height:20px;border-radius:999px;background:#4d9dff;display:grid;place-items:center;box-shadow:0 0 0 2px rgba(12,16,24,.96)">' + String(count) + '</span>';
			document.body.appendChild(ghost);
			try { event.dataTransfer.setDragImage(ghost, 22, 17); } catch {}
			setTimeout(() => ghost.remove(), 0);
		};
		const normalizeDropSide = (row, side, options = {}) => {
			if (
				draggingType === 'dialog' &&
				side === 'after' &&
				row?.dataset?.folderId &&
				hasVisibleFolderChildren(row.dataset.folderId)
			) return 'folder-start';
			if (
				draggingType === 'dialog' &&
				side === 'after' &&
				row?.dataset?.parentFolderId &&
				isLastVisibleFolderChild(row)
			) return options.gap ? 'folder-after' : 'folder-end';
			if (
				draggingType === 'folder' &&
				side === 'after' &&
				row?.dataset?.folderId &&
				hasVisibleFolderChildren(row.dataset.folderId)
			) return 'folder-after';
			return side;
		};
		const getDropIntentForRow = (row, clientY, options = {}, rectOverride = null) => {
			if (!row) return null;
			const id = getDropTargetId(row);
			if (!id || isDraggingTargetId(id)) return null;
			if (draggingType === 'folder' && row.dataset?.parentFolderId) {
				const folderRow = getFolderRow(row.dataset.parentFolderId);
				return folderRow && !isDraggingTargetId(folderRow.dataset.folderId || '')
					? { row: folderRow, side: 'folder-after' }
					: null;
			}
			const rect = rectOverride || row.getBoundingClientRect();
			const y = (clientY - rect.top) / Math.max(1, rect.height);
			const side = clientY > rect.top + rect.height / 2 ? 'after' : 'before';
			if (row.dataset?.folderId) {
				if (draggingType === 'dialog') {
					const movedItems = getCurrentDragItems();
					const alreadyInThisFolder = movedItems.length > 0 && movedItems.every(item => String(item?.folderId || '') === String(row.dataset.folderId || ''));
					if (hasVisibleFolderChildren(row.dataset.folderId) && y > .24) return { row, side: 'folder-start' };
					if (!alreadyInThisFolder && y > .24 && y < .76) return { row, side: 'inside' };
				}
				return { row, side: normalizeDropSide(row, side, options) };
			}
			return { row, side: normalizeDropSide(row, side, options) };
		};
		const getDropRows = () => {
			return getVisibleDropRows().filter(row => {
				const id = getDropTargetId(row);
				if (!id || isDraggingTargetId(id)) return false;
				return true;
			});
		};
		const getDropRowInfos = () => {
			if (dropRowsCache) return dropRowsCache;
			dropRowsCache = getDropRows()
				.map(row => ({ row, rect: row.getBoundingClientRect() }))
				.filter(info => info.rect.width && info.rect.height);
			return dropRowsCache;
		};
		const getNearestDropTarget = (clientX, clientY) => {
			let best = null;
			getDropRowInfos().forEach(({ row, rect }) => {
				const x = Math.max(rect.left, Math.min(clientX, rect.right));
				if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
					const intent = getDropIntentForRow(row, clientY, { gap: false }, rect);
					if (!intent) return;
					const distance = Math.min(Math.abs(clientY - rect.top), Math.abs(clientY - rect.bottom));
					if (!best || distance < best.distance) best = { ...intent, distance };
					return;
				}
				const beforeDistance = Math.hypot(clientX - x, clientY - rect.top);
				const afterDistance = Math.hypot(clientX - x, clientY - rect.bottom);
				const beforeIntent = getDropIntentForRow(row, rect.top, { gap: clientY < rect.top }, rect);
				const afterIntent = getDropIntentForRow(row, rect.bottom + 1, { gap: clientY > rect.bottom }, rect);
				if (beforeIntent && (!best || beforeDistance < best.distance)) best = { ...beforeIntent, side: beforeIntent.side === 'inside' ? 'before' : beforeIntent.side, distance: beforeDistance };
				if (afterIntent && (!best || afterDistance < best.distance)) best = { ...afterIntent, distance: afterDistance };
			});
			return best;
		};
		const isBelowAllDropRows = (clientY) => {
			const rows = getDropRowInfos();
			if (!rows.length) return true;
			const bottom = rows.reduce((max, info) => Math.max(max, info.rect.bottom), -Infinity);
			return clientY > bottom + 10;
		};
		const confirmFolderOut = (moveItems, onOk) => {
			const group = (Array.isArray(moveItems) ? moveItems : [moveItems]).filter(Boolean);
			const leaving = group.filter(item => item?.folderId);
			if (!leaving.length) { onOk(); return; }
			const count = leaving.length;
			_showDialogControlConfirm(
				count === 1
					? `Вынести «${leaving[0].title || 'Диалог'}» из папки?`
					: `Вынести ${count} ${_ruPlural(count, 'диалог', 'диалога', 'диалогов')} из папок?`,
				'Вынести', 'Отмена',
				onOk
			);
		};
		const moveItemsToRootEnd = (movedIds) => {
			const ids = _normalizeDialogControlMoveIds(movedIds);
			if (!ids.length) return false;
			const itemsNow = _getDialogControlItems();
			const moved = itemsNow.filter(item => !_isDialogControlFolder(item) && ids.includes(String(item.id)));
			if (!moved.length) return false;
			const rootRows = getVisibleDropRows().filter(row => !row.dataset?.parentFolderId && !isDraggingTargetId(getDropTargetId(row)));
			const lastTargetId = getDropTargetId(rootRows[rootRows.length - 1]);
			if (!lastTargetId) return _moveDialogControlItemsToRootEnd(ids);
			return _moveDialogControlItemsRelative(ids, lastTargetId, 'after');
		};
		const moveFolderToRootEnd = (movedId) => {
			const rootRows = getVisibleDropRows().filter(row => !row.dataset?.parentFolderId && !isDraggingTargetId(getDropTargetId(row)));
			const lastTargetId = getDropTargetId(rootRows[rootRows.length - 1]);
			if (!lastTargetId) return false;
			return _moveDialogControlItemRelative(movedId, lastTargetId, 'after');
		};
		const showDropIntent = (intent) => {
			if (!intent) {
				clearDragOver();
				return;
			}
			const key = intent.root ? 'root' : `${getDropTargetId(intent.row)}:${intent.side}`;
			if (key && key === lastDropKey) return;
			lastDropKey = key;
			if (intent.root) setRootDropMarker();
			else setDropMarker(intent.row, intent.side);
		};
		const updateDropFromPointer = (clientX, clientY) => {
			if (!draggingId) return null;
			if (isBelowAllDropRows(clientY)) {
				showDropIntent({ root: true });
				return dropIntent;
			}
			const nearest = getNearestDropTarget(clientX, clientY);
			showDropIntent(nearest);
			return dropIntent;
		};
		const handleControlDragOver = (e) => {
			if (!draggingId || (draggingType !== 'dialog' && draggingType !== 'folder')) return false;
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			updateDropFromPointer(e.clientX, e.clientY);
			return true;
		};
		const applyCurrentDrop = (e) => {
			if (!draggingId || (draggingType !== 'dialog' && draggingType !== 'folder')) return false;
			e.preventDefault();
			e.stopPropagation();
			const movedId = draggingId;
			const itemsNow = _getDialogControlItems();
			const item = itemsNow.find(x => String(x.id) === String(movedId));
			const moveIds = draggingType === 'dialog' ? Array.from(getDraggingIds()) : [String(movedId)];
			const moveItems = draggingType === 'dialog'
				? itemsNow.filter(x => !_isDialogControlFolder(x) && moveIds.includes(String(x.id)))
				: (item ? [item] : []);
			const intent = dropIntent || updateDropFromPointer(e.clientX, e.clientY);
			const markerRow = intent?.row || overRow;
			const markerTargetId = getDropTargetId(markerRow);
			const markerTarget = markerTargetId ? itemsNow.find(x => String(x.id) === String(markerTargetId)) : null;
			const activeSide = intent?.side || dropSide;
			const rootDrop = !!intent?.root;
			clearDragOver();
			if (!item || !intent || !moveItems.length) return true;
			if (rootDrop) {
				const applyMove = () => {
					const changed = draggingType === 'dialog'
						? moveItemsToRootEnd(moveIds)
						: moveFolderToRootEnd(movedId);
					if (!changed) return;
					list.dataset.lastDragTs = String(Date.now());
					_renderDialogControlPanel(h);
				};
				if (draggingType === 'dialog') confirmFolderOut(moveItems, applyMove);
				else applyMove();
				return true;
			}
			if (!rootDrop && markerTarget && !isDraggingTargetId(markerTarget.id)) {
				if (draggingType === 'folder' && !_isDialogControlFolder(markerTarget) && markerTarget.folderId) return true;
				const getDestinationFolderId = () => {
					if (draggingType !== 'dialog' || !markerTarget) return '';
					if ((activeSide === 'inside' || activeSide === 'folder-start') && _isDialogControlFolder(markerTarget)) return String(markerTarget.id || '');
					if (activeSide === 'folder-end') return String(markerTarget.folderId || markerRow?.dataset?.parentFolderId || '');
					if (activeSide === 'folder-after') return '';
					if (!_isDialogControlFolder(markerTarget) && markerTarget.folderId) return String(markerTarget.folderId);
					return '';
				};
				const destinationFolderId = getDestinationFolderId();
				const willLeaveFolder = draggingType === 'dialog' && !destinationFolderId && moveItems.some(moveItem => moveItem?.folderId);
				const applyMove = () => {
					const parentFolderId = String(markerRow?.dataset?.parentFolderId || '');
					const parentFolder = parentFolderId ? _getDialogControlItems().find(x => _isDialogControlFolder(x) && String(x.id) === parentFolderId) : null;
					const changed = draggingType === 'dialog' && (activeSide === 'folder-start' || activeSide === 'inside') && _isDialogControlFolder(markerTarget)
						? _moveDialogControlItemsToFolder(moveIds, markerTarget.id, activeSide === 'folder-start')
						: draggingType === 'dialog' && activeSide === 'folder-after' && parentFolder
							? _moveDialogControlItemsRelative(moveIds, parentFolder.id, 'after')
							: draggingType === 'dialog'
								? _moveDialogControlItemsRelative(moveIds, markerTarget.id, activeSide === 'folder-end' || activeSide === 'folder-after' ? 'after' : activeSide)
								: _moveDialogControlItemRelative(movedId, markerTarget.id, activeSide === 'folder-end' || activeSide === 'folder-after' ? 'after' : activeSide);
					if (!changed) return;
					list.dataset.lastDragTs = String(Date.now());
					_renderDialogControlPanel(h);
				};
				if (willLeaveFolder) confirmFolderOut(moveItems, applyMove);
				else applyMove();
				return true;
			}
			return true;
		};
		list.ondragover = handleControlDragOver;
		list.addEventListener('scroll', invalidateDropMetrics, { passive: true });
		list.ondragleave = (e) => {
			if (!list.contains(e.relatedTarget)) clearDragOver();
		};
		list.ondrop = applyCurrentDrop;
		list.addEventListener('click', (e) => {
			const targetEl = getEventElement(e.target);
			if (targetEl?.closest?.('.dialog-control-chip')) return;
			if (targetEl?.closest?.('button,input,select,textarea,a,[contenteditable],.dialog-control-palette')) return;
			clearMultiSelectionInPanel();
		});
		items.forEach(item => {
			if (_isDialogControlFolder(item)) {
				const folderStatus = _getDialogControlFolderStatus(item.id, items, visibleChatIndex);
				if (!folderStatus.childCount && !_shouldKeepEmptyDialogControlFolder(item)) return;
				const folderColor = _normalizeDialogControlColor(item.color);
				const row = document.createElement('div');
				row.className = 'dialog-control-folder';
				row.draggable = true;
				row.dataset.folderId = item.id;
				row.classList.toggle('--collapsed', !!item.collapsed);
				row.classList.toggle('--colored', !!folderColor);
				row.classList.toggle('--empty-folder', !folderStatus.childCount);
				if (folderColor) _applyDialogControlColorVars(row, folderColor);
				let toggleFolder = null;
				if (folderStatus.childCount) {
					toggleFolder = document.createElement('button');
					toggleFolder.type = 'button';
					toggleFolder.className = 'dialog-control-folder-toggle';
					toggleFolder.title = item.collapsed ? 'Развернуть папку' : 'Свернуть папку';
					toggleFolder.setAttribute('aria-expanded', item.collapsed ? 'false' : 'true');
					toggleFolder.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 4l4 4-4 4"/></svg>';
					toggleFolder.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						_setDialogControlFolderCollapsed(item.id, !item.collapsed);
						_renderDialogControlPanel(h);
					});
				} else {
					toggleFolder = null;
				}
				const folderState = document.createElement('span');
				folderState.className = 'dialog-control-state dialog-control-folder-state';
				_renderDialogControlState(folderState, {
					hasUnread: folderStatus.unreadCount > 0,
					hasMention: folderStatus.hasMention,
					hasLater: folderStatus.hasLater,
					unreadCount: folderStatus.unreadCount
				}, `${folderStatus.childCount} ${_ruPlural(folderStatus.childCount, 'диалог', 'диалога', 'диалогов')}`);
				const titleInp = document.createElement('input');
				titleInp.type = 'text';
				titleInp.className = 'dialog-control-folder-title';
				titleInp.value = item.title || 'Папка';
				titleInp.maxLength = 40;
				titleInp.title = 'Название папки';
				const commitFolderTitle = () => {
					const oldValue = item.title || 'Папка';
					_setDialogControlFolderTitle(item.id, titleInp.value);
					titleInp.value = item.title || titleInp.value.trim() || oldValue;
				};
				titleInp.addEventListener('blur', commitFolderTitle);
				titleInp.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') { e.preventDefault(); titleInp.blur(); }
					if (e.key === 'Escape') { titleInp.value = item.title || 'Папка'; titleInp.blur(); }
					e.stopPropagation();
				});
				const colorWrap = document.createElement('span');
				colorWrap.className = 'dialog-control-folder-color-wrap';
				const colorBtn = document.createElement('button');
				colorBtn.type = 'button';
				colorBtn.className = 'dialog-control-folder-color';
				colorBtn.draggable = false;
				colorBtn.title = folderColor ? 'Изменить цвет папки' : 'Выбрать цвет папки';
				colorBtn.setAttribute('aria-label', colorBtn.title);
				if (folderColor) _applyDialogControlColorVars(colorBtn, folderColor);
				_wireDialogControlColorPalette(colorBtn, colorWrap, {
					id: item.id,
					currentColor: folderColor,
					getCurrentColor: () => item.color,
					onCommit: (next) => {
						_setDialogControlFolderColor(item.id, next);
						item.color = next || '';
						row.classList.toggle('--colored', !!next);
						if (next) {
							_applyDialogControlColorVars(row, next);
							_applyDialogControlColorVars(colorBtn, next);
						} else {
							_clearDialogControlColorVars(row);
							_clearDialogControlColorVars(colorBtn);
						}
					}
				});
				colorWrap.append(colorBtn);
				const rmFolder = document.createElement('button');
				rmFolder.type = 'button';
				rmFolder.className = 'dialog-control-folder-remove';
				rmFolder.title = 'Удалить папку';
				rmFolder.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg>';
				rmFolder.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					_showDialogControlConfirm(
						`Удалить папку «${item.title || 'Папка'}»? Диалоги останутся под контролем.`,
						'Удалить', 'Отмена',
						() => {
							_removeDialogControlFolder(item.id);
							_renderDialogControlPanel(h);
							_showDialogDockToast('Папка удалена', 'ok');
						}
					);
				});
				row.addEventListener('dragstart', (e) => {
					draggingId = item.id;
					draggingType = 'folder';
					draggingIds = new Set([String(item.id)]);
					draggingItems = [];
					invalidateDropMetrics();
					markDraggingRows(true);
					if (e.dataTransfer) {
						e.dataTransfer.effectAllowed = 'move';
						try { e.dataTransfer.setData('text/plain', item.id); } catch {}
					}
				});
				row.addEventListener('dragend', () => {
					markDraggingRows(false);
					clearDragOver();
					draggingId = null;
					draggingType = '';
					draggingIds = new Set();
					draggingItems = [];
					invalidateDropMetrics();
					list.dataset.lastDragTs = String(Date.now());
				});
				row.addEventListener('dragover', (e) => {
					if (!draggingId || isDraggingTargetId(item.id)) return;
					handleControlDragOver(e);
				});
				row.addEventListener('dragleave', (e) => {
					if (e.relatedTarget && !list.contains(e.relatedTarget)) clearDragOver();
				});
				row.addEventListener('drop', (e) => {
					if (!draggingId || isDraggingTargetId(item.id)) return;
					applyCurrentDrop(e);
				});
				if (toggleFolder) row.append(toggleFolder, folderState, titleInp, colorWrap, rmFolder);
				else row.append(folderState, titleInp, colorWrap, rmFolder);
				list.appendChild(row);
				return;
			}
			if (item.folderId && folderMap.get(String(item.folderId))?.collapsed) return;
			const el = visibleChatIndex.get(normId(item.id)) || null;
			const meta = el ? getItemMeta(el) : null;
			const liveTitle = el ? getChatTitleFromElement(el) : '';
			if (liveTitle && liveTitle !== item.title) {
				item.title = liveTitle;
				titlesChanged = true;
			}
			const parentFolder = item.folderId ? folderMap.get(String(item.folderId)) : null;
			const folderColor = _normalizeDialogControlColor(parentFolder?.color);
			const unreadCount = meta?.unreadCount || 0;
			const isUnread = !!(meta?.hasUnread || meta?.hasLater || meta?.hasMention);
			const row = document.createElement('div');
			row.className = 'dialog-control-chip';
			row.setAttribute('role', 'button');
			row.tabIndex = 0;
			row.draggable = true;
			const isMultiSelected = _dialogControlMultiSelected.has(String(item.id));
			const isCurrentDialog = !!currentDialogId && normId(item.id) === currentDialogId;
			row.classList.toggle('--unread', isUnread);
			row.classList.toggle('--later', !!meta?.hasLater && !meta?.hasUnread);
			row.classList.toggle('--mention', !!meta?.hasMention);
			row.classList.toggle('--in-folder', !!parentFolder);
			row.classList.toggle('--folder-colored', !!folderColor);
			row.classList.toggle('--multi-selected', isMultiSelected);
			row.classList.toggle('--current', isCurrentDialog);
			row.setAttribute('aria-selected', isMultiSelected ? 'true' : 'false');
			row.setAttribute('aria-current', isCurrentDialog ? 'true' : 'false');
			const chipColor = _normalizeDialogControlColor(item.color);
			const effectiveChipColor = chipColor;
			row.classList.toggle('--colored', !!effectiveChipColor);
			if (effectiveChipColor) _applyDialogControlColorVars(row, effectiveChipColor);
			row.dataset.dialogId = item.id;
			if (parentFolder) row.dataset.parentFolderId = parentFolder.id;
			row.title = _pMode() === 'tasks'
				? 'Открыть задачу; Ctrl+клик — мультивыбор'
				: 'Открыть диалог; Ctrl+клик — мультивыбор';
			const markCurrentRow = () => {
				_setDialogControlCurrentId(item.id);
				list.querySelectorAll('.dialog-control-chip.--current').forEach(el => {
					el.classList.remove('--current');
					el.setAttribute('aria-current', 'false');
				});
				row.classList.add('--current');
				row.setAttribute('aria-current', 'true');
			};
			row.addEventListener('click', async (e) => {
				e.preventDefault();
				e.stopPropagation();
				_closeDialogControlPalettes(true);
				list.querySelectorAll('.dialog-control-color-wrap.--open,.dialog-control-folder-color-wrap.--open').forEach(el => el.classList.remove('--open'));
				const ts = Number(list.dataset.lastDragTs || 0);
				if (ts && (Date.now() - ts) < 250) return;
				if (e.ctrlKey || e.metaKey) {
					includeCurrentDialogInFreshMultiSelection(item.id);
					_toggleDialogControlMultiSelection(item.id, items);
					syncMultiSelectionInPanel();
					return;
				}
				clearMultiSelectionInPanel();
				if (_pMode() === 'tasks' && _isTaskViewRouteNow() && await _openTaskForDialogControlItem(item)) {
					markCurrentRow();
					return;
				}
				const targetEl = findChatElementById(item.id);
				if (targetEl && openChatElement(targetEl)) {
					markCurrentRow();
					return;
				}
				if (_pMode() === 'tasks' && await _openTaskForDialogControlItem(item)) {
					markCurrentRow();
					return;
				}
				if (!targetEl) {
					_showDialogDockToast(_pMode() === 'tasks' ? 'Задача не найдена в текущей ленте' : 'Диалог не найден в текущей ленте', 'danger');
				}
			});
			row.addEventListener('keydown', (e) => {
				if (e.key !== 'Enter' && e.key !== ' ') return;
				e.preventDefault();
				row.click();
			});
			row.addEventListener('dragstart', (e) => {
				draggingId = item.id;
				draggingType = 'dialog';
				draggingIds = new Set(_getDialogControlMoveGroupIds(item.id, items));
				draggingItems = items.filter(candidate => !_isDialogControlFolder(candidate) && draggingIds.has(String(candidate.id)));
				invalidateDropMetrics();
				markDraggingRows(true);
				if (draggingIds.size > 1) {
					row.classList.add('--drag-origin');
					row.dataset.dragCount = String(draggingIds.size);
					setMultiDragImage(e, draggingIds.size);
				}
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = 'move';
					try { e.dataTransfer.setData('text/plain', Array.from(draggingIds).join(',')); } catch {}
				}
			});
			row.addEventListener('dragend', () => {
				markDraggingRows(false);
				clearDragOver();
				draggingId = null;
				draggingType = '';
				draggingIds = new Set();
				draggingItems = [];
				invalidateDropMetrics();
				list.dataset.lastDragTs = String(Date.now());
			});
			row.addEventListener('dragover', (e) => {
				if (!draggingId || isDraggingTargetId(item.id)) return;
				handleControlDragOver(e);
			});
			row.addEventListener('dragleave', (e) => {
				if (e.relatedTarget && !list.contains(e.relatedTarget)) clearDragOver();
			});
			row.addEventListener('drop', (e) => {
				if (!draggingId || isDraggingTargetId(item.id)) return;
				applyCurrentDrop(e);
			});
			const state = document.createElement('span');
			state.className = 'dialog-control-state';
			if (meta?.hasLater && !meta?.hasUnread && !meta?.hasMention) {
				state.title = 'Посмотреть позже';
				state.innerHTML = '<span class="dialog-control-dot --later"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg></span>';
			} else if (meta?.hasMention) {
				state.title = 'Вас упомянули';
				state.innerHTML = `<span class="dialog-control-dot --mention-dot">${_getDialogControlMentionIconSvg()}</span>`;
			} else if (isUnread) {
				state.title = 'Непрочитанные';
				const countLabel = unreadCount > 0 ? String(unreadCount) : (meta?.hasLater ? '!' : '');
				state.innerHTML = `<span class="dialog-control-dot"><span class="dialog-control-count">${countLabel}</span></span>`;
			} else {
				state.innerHTML = '<span class="dialog-control-dot --empty"></span>';
			}
			const title = document.createElement('span');
			title.className = 'dialog-control-title';
			title.textContent = item.title || 'Диалог';
			const colorWrap = document.createElement('span');
			colorWrap.className = 'dialog-control-color-wrap';
			colorWrap.addEventListener('mousedown', (e) => {
				e.stopPropagation();
			});
			colorWrap.addEventListener('dragstart', (e) => {
				e.preventDefault();
				e.stopPropagation();
			});
			const colorBtn = document.createElement('button');
			colorBtn.type = 'button';
			colorBtn.className = 'dialog-control-color';
			colorBtn.draggable = false;
			const colorTargetCount = isMultiSelected && multiSelectedCount > 1 ? multiSelectedCount : 1;
			colorBtn.title = colorTargetCount > 1
				? `Изменить цвет ${colorTargetCount} выбранных ${_ruPlural(colorTargetCount, 'диалог', 'диалога', 'диалогов')}`
				: folderColor
				? `Цвет папки «${parentFolder?.title || 'Папка'}» отмечен в палитре`
				: (chipColor ? 'Изменить цвет диалога' : 'Выбрать цвет диалога');
			colorBtn.setAttribute('aria-label', colorBtn.title);
			if (effectiveChipColor) _applyDialogControlColorVars(colorBtn, effectiveChipColor);
			const palette = document.createElement('div');
			palette.className = 'dialog-control-palette';
			palette.tabIndex = -1;
			palette.addEventListener('mousedown', (e) => {
				e.stopPropagation();
			});
			palette.addEventListener('click', (e) => {
				e.stopPropagation();
			});
			palette.addEventListener('mouseenter', () => {
				_clearDialogControlPaletteClose();
				_setLinkedPanelOpacityLift(true);
				_clearDialogDockAutoClose();
			});
			palette.addEventListener('mouseleave', () => {
				_setLinkedPanelOpacityLift(false);
				_scheduleDialogDockAutoClose();
				_scheduleDialogControlPaletteClose(5000);
			});
			let draftColor = chipColor || '#4d9dff';
			const preview = document.createElement('span');
			preview.className = 'dialog-control-preview';
			const miniPicker = document.createElement('div');
			miniPicker.className = 'dialog-control-mini-picker';
			const pickerKnob = document.createElement('span');
			pickerKnob.className = 'dialog-control-picker-knob';
			miniPicker.appendChild(pickerKnob);
			const hueStrip = document.createElement('div');
			hueStrip.className = 'dialog-control-hue-strip';
			const hueKnob = document.createElement('span');
			hueKnob.className = 'dialog-control-hue-knob';
			hueStrip.appendChild(hueKnob);
			const swatches = document.createElement('div');
			swatches.className = 'dialog-control-swatches';
			const closePalette = document.createElement('button');
			closePalette.type = 'button';
			closePalette.className = 'dialog-control-palette-close';
			closePalette.title = 'Закрыть';
			closePalette.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg>';
			closePalette.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				_closeDialogControlPalettes(true);
			});
			const notice = document.createElement('div');
			notice.className = 'dialog-control-delete-notice';
			const closeOnOutside = (e) => {
				if (palette.contains(e.target) || colorBtn.contains(e.target)) return;
				document.removeEventListener('pointerdown', closeOnOutside, true);
				_closeDialogControlPalettes(true);
			};
			const showDeleteConfirm = (color) => {
				_showDialogControlColorDeleteConfirm(notice, color, (deletedColor, usage) => {
					_deleteCustomDialogControlColor(deletedColor);
					if (_normalizeDialogControlColor(item.color) === deletedColor) commitColor('');
					palette.querySelector(`.dialog-control-swatch[data-color="${deletedColor}"]`)?.closest('.dialog-control-swatch-wrap')?.remove();
					const resetText = usage.total > 0
						? `Цвет удалён. Сброшено в ${usage.total} ${_ruPlural(usage.total, 'диалоге', 'диалогах', 'диалогах')}`
						: 'Цвет удалён';
					_showDialogDockToast(resetText, 'ok');
				});
			};
			let draftHsv = _hexToHsv(draftColor) || { h: 210, s: 1, v: 1 };
			const syncPickerVisual = () => {
				miniPicker.style.setProperty('--picker-hue-color', _hsvToHex(draftHsv.h, 1, 1));
				pickerKnob.style.left = (draftHsv.s * 100) + '%';
				pickerKnob.style.top = ((1 - draftHsv.v) * 100) + '%';
				hueKnob.style.left = (draftHsv.h / 360 * 100) + '%';
			};
			const setDraftFromHsv = (h, s, v) => {
				draftHsv = {
					h: (((Number(h) || 0) % 360) + 360) % 360,
					s: Math.max(0, Math.min(1, Number(s) || 0)),
					v: Math.max(0, Math.min(1, Number(v) || 0))
				};
				draftColor = _hsvToHex(draftHsv.h, draftHsv.s, draftHsv.v);
				_applyDialogControlColorVars(preview, draftColor);
				_applyDialogControlColorVars(pickerKnob, draftColor);
				palette.querySelectorAll('.dialog-control-swatch').forEach(btn => {
					btn.classList.toggle('--active', btn.dataset.color === draftColor);
				});
				syncPickerVisual();
			};
			const applyDraft = (color) => {
				const next = _normalizeDialogControlColor(color) || '#4d9dff';
				draftColor = next;
				draftHsv = _hexToHsv(next) || draftHsv;
				_applyDialogControlColorVars(preview, next);
				_applyDialogControlColorVars(pickerKnob, next);
				palette.querySelectorAll('.dialog-control-swatch').forEach(btn => {
					btn.classList.toggle('--active', btn.dataset.color === next);
				});
				syncPickerVisual();
			};
			const commitColor = (color) => {
				const next = _normalizeDialogControlColor(color);
				const targetIds = _getDialogControlColorTargetIds(item);
				_setDialogControlItemsColor(targetIds, next);
				const targetSet = new Set(targetIds.map(normId).filter(Boolean));
				_getDialogControlItems().forEach(targetItem => {
					if (!targetSet.has(normId(targetItem.id))) return;
					if (next) targetItem.color = next;
					else delete targetItem.color;
					const targetRow = Array.from(list.querySelectorAll('.dialog-control-chip')).find(el => normId(el.dataset.dialogId) === normId(targetItem.id));
					if (!targetRow) return;
					const targetColorBtn = targetRow.querySelector('.dialog-control-color');
					targetRow.classList.toggle('--colored', !!next);
					if (next) {
						_applyDialogControlColorVars(targetRow, next);
						_applyDialogControlColorVars(targetColorBtn, next);
					} else {
						_clearDialogControlColorVars(targetRow);
						_clearDialogControlColorVars(targetColorBtn);
					}
				});
				palette.querySelectorAll('.dialog-control-swatch').forEach(btn => {
					btn.classList.toggle('--active', !!next && btn.dataset.color === next);
				});
			};
			const makeColorSwatch = (color) => {
				const swatchWrap = document.createElement('span');
				swatchWrap.className = 'dialog-control-swatch-wrap';
				const swatch = document.createElement('button');
				swatch.type = 'button';
				swatch.className = 'dialog-control-swatch';
				swatch.draggable = false;
				swatch.dataset.color = color;
				_applyDialogControlColorVars(swatch, color);
				swatch.classList.toggle('--active', chipColor === color);
				const isFolderRef = !!folderColor && color === folderColor;
				swatch.classList.toggle('--folder-ref', isFolderRef);
				if (isFolderRef) swatch.innerHTML = _getDialogControlFolderRefIconSvg();
				swatch.title = isFolderRef
					? `Применить цвет папки «${parentFolder?.title || 'Папка'}»`
					: 'Применить цвет';
				swatch.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					applyDraft(color);
					commitColor(color);
				});
				swatchWrap.appendChild(swatch);
				if (true) {
					const del = document.createElement('button');
					del.type = 'button';
					del.className = 'dialog-control-swatch-delete';
					del.title = 'Удалить цвет';
					del.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg>';
					del.addEventListener('click', (e) => {
						e.preventDefault();
						e.stopPropagation();
						showDeleteConfirm(color);
					});
					swatchWrap.appendChild(del);
				}
				return swatchWrap;
			};
			const visibleColors = _getVisibleDialogControlColors();
			const paletteColors = folderColor && !visibleColors.includes(folderColor)
				? [folderColor, ...visibleColors]
				: visibleColors;
			paletteColors.forEach(color => {
				swatches.appendChild(makeColorSwatch(color));
			});
			const clearColor = document.createElement('button');
			clearColor.type = 'button';
			clearColor.className = 'dialog-control-swatch --clear';
			clearColor.draggable = false;
			clearColor.title = 'Без цвета';
			clearColor.innerHTML = '<span class="dialog-control-transparent-icon" aria-hidden="true"></span>';
			clearColor.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				commitColor('');
			});
			const clearWrap = document.createElement('span');
			clearWrap.className = 'dialog-control-swatch-wrap';
			clearWrap.appendChild(clearColor);
			swatches.appendChild(clearWrap);
			const addColor = document.createElement('button');
			addColor.type = 'button';
			addColor.className = 'dialog-control-swatch --add';
			addColor.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 3v10"/><path d="M3 8h10"/></svg>';
			addColor.title = 'Добавить цвет';
			const addWrap = document.createElement('span');
			addWrap.className = 'dialog-control-swatch-wrap';
			addWrap.appendChild(addColor);
			swatches.appendChild(addWrap);
			const pickFromPointer = (e, commit = false) => {
				const rect = miniPicker.getBoundingClientRect();
				const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
				const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
				const xRatio = x / Math.max(1, rect.width);
				const yRatio = y / Math.max(1, rect.height);
				setDraftFromHsv(draftHsv.h, xRatio, 1 - yRatio);
				if (commit) commitColor(draftColor);
			};
			const pickHueFromPointer = (e, commit = false) => {
				const rect = hueStrip.getBoundingClientRect();
				const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
				const xRatio = x / Math.max(1, rect.width);
				setDraftFromHsv(xRatio * 360, draftHsv.s, draftHsv.v);
				if (commit) commitColor(draftColor);
			};
			let pickingColor = false;
			miniPicker.addEventListener('pointerdown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				pickingColor = true;
				miniPicker.setPointerCapture?.(e.pointerId);
				pickFromPointer(e, false);
			});
			miniPicker.addEventListener('pointermove', (e) => {
				if (!pickingColor) return;
				e.preventDefault();
				pickFromPointer(e, false);
			});
			miniPicker.addEventListener('pointerup', (e) => {
				if (!pickingColor) return;
				pickingColor = false;
				e.preventDefault();
				pickFromPointer(e, true);
			});
			let pickingHue = false;
			hueStrip.addEventListener('pointerdown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				pickingHue = true;
				hueStrip.setPointerCapture?.(e.pointerId);
				pickHueFromPointer(e, false);
			});
			hueStrip.addEventListener('pointermove', (e) => {
				if (!pickingHue) return;
				e.preventDefault();
				pickHueFromPointer(e, false);
			});
			hueStrip.addEventListener('pointerup', (e) => {
				if (!pickingHue) return;
				pickingHue = false;
				e.preventDefault();
				pickHueFromPointer(e, true);
			});
			addColor.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				_saveRemovedDefaultDialogControlColors(_getRemovedDefaultDialogControlColors().filter(c => c !== draftColor));
				_saveCustomDialogControlColors([draftColor, ..._getCustomDialogControlColors()]);
				if (!palette.querySelector(`.dialog-control-swatch[data-color="${draftColor}"]`)) {
					swatches.insertBefore(makeColorSwatch(draftColor), clearWrap);
				}
				commitColor(draftColor);
			});
			palette.append(preview, miniPicker, hueStrip, closePalette, swatches, notice);
			applyDraft(draftColor);
			colorBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				const paletteId = String(item.id);
				const wasOpen = _isDialogControlPaletteOpenFor(paletteId);
				_clearDialogControlPaletteClose();
				_forceCloseDialogControlPalettes();
				if (wasOpen) return;
				colorWrap.classList.add('--open');
				const paletteW = 246;
				const gap = 8;
				const margin = 12;
				const paletteH = Math.min(250, window.innerHeight - margin * 2);
				const btnRect = colorBtn.getBoundingClientRect();
				const left = Math.max(margin, Math.min(btnRect.right - paletteW, window.innerWidth - paletteW - margin));
				const placeBelow = btnRect.bottom + gap + paletteH <= window.innerHeight - margin;
				const top = placeBelow
					? btnRect.bottom + gap
					: Math.max(margin, btnRect.top - gap - paletteH);
				palette.style.left = left + 'px';
				palette.style.top = top + 'px';
				palette.dataset.dialogId = paletteId;
				_prepareDialogControlPaletteForOpen(palette);
				document.body.appendChild(palette);
				requestAnimationFrame(() => {
					if (!palette.isConnected) return;
					palette.classList.remove('--closing');
					palette.classList.add('--open');
					_armDialogControlPaletteOutsideHandler(palette, closeOnOutside);
				});
			});
			colorWrap.append(colorBtn);
			const rm = document.createElement('button');
			rm.type = 'button';
			rm.className = 'dialog-control-remove';
			rm.draggable = false;
			rm.title = 'Убрать из контроля';
			rm.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg>';
			rm.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				_showDialogControlConfirm(
					`Убрать «${item.title || 'Диалог'}» из контроля?`,
					'Убрать', 'Отмена',
					() => {
						_dialogControlItems[_pMode()] = _getDialogControlItems().filter(x => normId(x.id) !== normId(item.id));
						_saveDialogControlItems();
						_renderDialogControlPanel(h);
						_showDialogDockToast('Диалог убран из контроля', 'ok');
					}
				);
			});
			row.append(state, title, colorWrap, rm);
			list.appendChild(row);
		});
		if (titlesChanged) _saveDialogControlItems();
		_scheduleDialogControlTitleSync(h);
		_fitDialogDockHeight(true);
	}

	function _updateDialogControlUI(h = filtersHost) {
		if (_panelModeSwitching) return;
		if (h) h.classList.remove('anit-dialog-control-mode');
		const dock = _ensureDialogControlDock(h);
		dock?.classList.toggle('anit-dialog-control-mode', _dialogControlActive);
		document.documentElement.classList.toggle('anit-dialog-control-cursor', _dialogControlActive);
		_scheduleDialogControlSelectionOutlines();
		const btn = dock?.querySelector('.dialog-control-mode-btn');
		if (btn) {
			btn.classList.toggle('--active', _dialogControlActive);
			btn.setAttribute('aria-pressed', _dialogControlActive ? 'true' : 'false');
			btn.title = _dialogControlActive ? 'Выйти из режима контроля диалога' : 'Контроль диалога';
		}
	}

	function _scheduleDialogControlIdleExit() {
		if (_dialogControlTimer) clearTimeout(_dialogControlTimer);
		_dialogControlTimer = setTimeout(() => {
			_dialogControlTimer = null;
			if (_dialogControlActive) _exitDialogControlMode();
		}, _DIALOG_CONTROL_IDLE_MS);
	}

	function _onDialogControlPointerActivity(e) {
		if (!_dialogControlActive) return;
		_scheduleDialogControlIdleExit();
	}

	function _armDialogControlIdleTracking() {
		_dialogControlLastPointerX = null;
		_dialogControlLastPointerY = null;
		_dialogControlLastPointerTs = 0;
		if (!_dialogControlPointerTracking) {
			document.addEventListener('click', _onDialogControlPointerActivity, true);
			document.addEventListener('keydown', _onDialogControlPointerActivity, true);
			_dialogControlPointerTracking = true;
		}
		_scheduleDialogControlIdleExit();
	}

	function _disarmDialogControlIdleTracking() {
		if (_dialogControlTimer) {
			clearTimeout(_dialogControlTimer);
			_dialogControlTimer = null;
		}
		if (_dialogControlPointerTracking) {
			document.removeEventListener('click', _onDialogControlPointerActivity, true);
			document.removeEventListener('keydown', _onDialogControlPointerActivity, true);
			_dialogControlPointerTracking = false;
		}
		_dialogControlLastPointerX = null;
		_dialogControlLastPointerY = null;
		_dialogControlLastPointerTs = 0;
	}

	function _exitDialogControlMode() {
		_dialogControlActive = false;
		_disarmDialogControlIdleTracking();
		_updateDialogControlUI();
	}

	function _enterDialogControlMode() {
		_dialogControlActive = true;
		if (_toastTimer) {
			clearTimeout(_toastTimer);
			_toastTimer = null;
			filtersHost?.querySelector('#anit_preset_toast')?.classList.remove('--show', '--danger', '--ok');
			_dialogControlDock?.querySelector('#anit_dialog_control_toast')?.classList.remove('--show', '--danger', '--ok');
		}
		_armDialogControlIdleTracking();
		_updateDialogControlUI();
	}

	function _addDialogToControl(el, keepActive = false) {
		const id = getChatIdFromElement(el);
		if (!id) {
			_showDialogDockToast('Не удалось определить диалог', 'danger');
			return;
		}
		const title = getChatTitleFromElement(el);
		const taskMeta = isTasksChatsModeNow() ? _extractTaskMetaFromElement(el, title) : null;
		const items = _getDialogControlItems();
		const existingIdx = items.findIndex(x => normId(x.id) === normId(id));
		if (existingIdx >= 0) {
			const existing = items[existingIdx];
			_showDialogControlConfirm(
				`Убрать «${existing?.title || title}» из контроля?`,
				'Убрать', 'Отмена',
				() => {
					const current = _getDialogControlItems();
					const idx = current.findIndex(x => normId(x.id) === normId(id));
					if (idx < 0) return;
					const removed = current.splice(idx, 1)[0];
					_dialogControlItems[_pMode()] = current;
					_saveDialogControlItems();
					_renderDialogControlPanel();
					_fitDialogDockHeight(true);
					_dialogControlDock?.classList.add('--expanded');
					el.classList.remove('anit-dialog-control-selected');
					el.classList.add('anit-dialog-controlled-pulse');
					setTimeout(() => el.classList.remove('anit-dialog-controlled-pulse'), 850);
					_showDialogDockToast(`Диалог «${removed?.title || title}» убран из контроля`, 'ok');
					if (keepActive) _scheduleDialogControlIdleExit();
					else _exitDialogControlMode();
				}
			);
			return;
		}
		const nextItem = { id, title, addedAt: Date.now() };
		if (taskMeta?.taskId) nextItem.taskId = String(taskMeta.taskId);
		if (taskMeta?.taskUrl) nextItem.taskUrl = taskMeta.taskUrl;
		items.unshift(nextItem);
		_dialogControlItems[_pMode()] = items;
		_saveDialogControlItems();
		_renderDialogControlPanel();
		_fitDialogDockHeight(true);
		_dialogControlDock?.classList.add('--expanded');
		el.classList.add('anit-dialog-controlled-pulse');
		el.classList.add('anit-dialog-control-selected');
		setTimeout(() => el.classList.remove('anit-dialog-controlled-pulse'), 850);
		_showDialogDockToast(`Диалог «${title}» выбран`, 'ok');
		if (keepActive) {
			_scheduleDialogControlIdleExit();
		} else {
			_exitDialogControlMode();
		}
	}

	function _showPresetConfirm(msg, okLabel, cancelLabel, onOk, tone = '') {
		const overlay = filtersHost?.querySelector('#anit_preset_confirm');
		if (!overlay) { onOk(); return; }
		overlay.innerHTML = '';
		overlay.classList.toggle('--danger', tone === 'danger');
		const p = document.createElement('p');
		p.textContent = msg;
		const btns = document.createElement('div');
		btns.className = 'confirm-btns';
		const ok = document.createElement('button');
		ok.type = 'button'; ok.className = '--ok'; ok.textContent = okLabel;
		const cancel = document.createElement('button');
		cancel.type = 'button'; cancel.textContent = cancelLabel;
		const hide = () => overlay.classList.remove('--show', '--danger');
		ok.addEventListener('click', () => { hide(); onOk(); });
		cancel.addEventListener('click', hide);
		btns.append(ok, cancel);
		overlay.append(p, btns);
		overlay.classList.add('--show');
	}

	// Отрисовать строку кнопок-пресетов
	function renderPresetsUI(host) {
		const row = host?.querySelector('#anit_presets_row');
		if (!row) return;
		row.innerHTML = '';
		const activeId = _getActiveId();
		_getPresetsArr().forEach((p, idx) => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'preset-btn' + (p.id === activeId ? ' --active' : '');
			btn.dataset.presetId = p.id;
			btn.textContent = p.label;
			if (idx < 9) btn.title = `Ctrl+${idx + 1}`;
			btn.addEventListener('click', () => applyPreset(p.id));
			row.appendChild(btn);
		});
		_updateDebugUI(host);
	}

	// Отрисовать панель управления пресетами (список с rename/delete + форма добавления)
	function renderPresetManagePanel(host) {
		const listEl = host?.querySelector('#anit_preset_list_edit');
		if (!listEl) return;
		listEl.innerHTML = '';
		const presets = _getPresetsArr();

		if (!presets.length) {
			const empty = document.createElement('div');
			empty.className = 'pm-empty';
			empty.textContent = 'Пресетов нет — добавьте первый ниже';
			listEl.appendChild(empty);
			return;
		}

		let _draggingId = null;
		let _overEl     = null;

		const DRAG_SVG = '<svg viewBox="0 0 16 16" style="width:12px;height:12px;fill:currentColor;display:block"><rect y="2" width="16" height="2" rx="1"/><rect y="7" width="16" height="2" rx="1"/><rect y="12" width="16" height="2" rx="1"/></svg>';
		const DEL_SVG  = '<svg viewBox="0 0 12 12" style="width:9px;height:9px;fill:currentColor;display:block"><path d="M11 1.7 9.3 0 6 3.3 2.7 0 1 1.7 4.3 5 1 8.3 2.7 10 6 6.7 9.3 10 11 8.3 7.7 5z"/></svg>';

		for (const p of presets) {
			const row = document.createElement('div');
			row.className = 'pm-row';
			row.dataset.presetId = p.id;
			row.draggable = true;

			const handle = document.createElement('span');
			handle.className = 'pm-drag';
			handle.innerHTML = DRAG_SVG;
			handle.title = 'Перетащите для изменения порядка';

			const inp = document.createElement('input');
			inp.type = 'text';
			inp.className = 'pm-inp';
			inp.value = p.label;
			inp.maxLength = 30;
			inp.addEventListener('blur', () => {
				const label = inp.value.trim();
				if (!label) { inp.value = p.label; return; }
				if (label !== p.label) {
					const found = _getPresetsArr().find(x => x.id === p.id);
					if (found) { found.label = label; p.label = label; _saveCustomPresets(); renderPresetsUI(host); }
				}
			});
			inp.addEventListener('keydown', (e) => {
				if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
				if (e.key === 'Escape') { inp.value = p.label; inp.blur(); }
				e.stopPropagation();
			});

			const delBtn = document.createElement('button');
			delBtn.type = 'button';
			delBtn.className = 'pm-del';
			delBtn.title = 'Удалить пресет';
			delBtn.innerHTML = DEL_SVG;
			delBtn.addEventListener('mousedown', (e) => {
				e.preventDefault();
				e.stopPropagation();
				_showPresetConfirm(`Удалить пресет «${p.label}»?`, 'Удалить', 'Отмена', () => {
					_presetsData[_pMode()] = _getPresetsArr().filter(x => x.id !== p.id);
					if (_getActiveId() === p.id) {
						_setActiveId(null);
						_debugModeActive = false;
						_updateDebugUI(host);
					}
					_saveCustomPresets();
					renderPresetManagePanel(host);
					renderPresetsUI(host);
				}, 'danger');
			});

			row.addEventListener('dragstart', (e) => {
				_draggingId = p.id;
				e.dataTransfer.effectAllowed = 'move';
				setTimeout(() => { row.style.opacity = '0.4'; }, 0);
			});
			row.addEventListener('dragend', () => {
				row.style.opacity = '';
				if (_overEl) { _overEl.classList.remove('drag-over'); _overEl = null; }
				_draggingId = null;
			});
			row.addEventListener('dragover', (e) => {
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				if (_overEl && _overEl !== row) _overEl.classList.remove('drag-over');
				_overEl = row;
				row.classList.add('drag-over');
			});
			row.addEventListener('dragleave', (e) => {
				if (!row.contains(e.relatedTarget)) {
					row.classList.remove('drag-over');
					if (_overEl === row) _overEl = null;
				}
			});
			row.addEventListener('drop', (e) => {
				e.preventDefault();
				row.classList.remove('drag-over');
				if (!_draggingId || _draggingId === p.id) return;
				const arr = _getPresetsArr();
				const fromIdx = arr.findIndex(x => x.id === _draggingId);
				const toIdx   = arr.findIndex(x => x.id === p.id);
				if (fromIdx < 0 || toIdx < 0) return;
				const [moved] = arr.splice(fromIdx, 1);
				arr.splice(toIdx, 0, moved);
				_saveCustomPresets();
				renderPresetManagePanel(host);
				renderPresetsUI(host);
			});

			row.append(handle, inp, delBtn);
			listEl.appendChild(row);
		}
	}


	const POS_LS_KEY = (mode) => `anit.filters.pos.${mode}`; // 'ol' | 'internal'
	const CAT_COLLAPSED_KEY = 'anit.filters.categories.collapsed';
	const HIDDEN_COLLAPSED_KEY = 'anit.filters.hidden.collapsed';

	// === PENA: Category management ===
	const CAT_VIS_LS_KEY = 'pena.cat.visibility';
	const CUSTOM_CATS_LS_KEY = 'pena.cat.custom';

	// All built-in categories (type, label, cssPattern)
	const BUILTIN_CATS = [
		{ type: 'dialog',   label: 'Диалоги',        rx: /--user\b/         },
		{ type: 'chat',     label: 'Чаты',            rx: /--chat\b/         },
			{ type: 'videoconf',label: 'Видеоконф.',      rx: /--videoconf\b/    },
		{ type: 'support',  label: 'Техподдержка',    rx: /--support24/      },
		{ type: 'group',    label: 'Группы/Коллабы',  rx: /--sonetGroup\b|--hexagon/ },
		{ type: 'phone',    label: 'Телефон',         rx: /--call\b/         },
		{ type: 'calendar', label: 'Календарь',       rx: /--calendar\b/     },
		{ type: 'general',  label: 'Общий чат',       rx: /--general\b/      },
		{ type: 'network',  label: 'Внешние чаты',    rx: /--network\b/      },
		{ type: 'guests',   label: 'Гости',           rx: /--extranet|--guest/ },
		{ type: 'tasks',    label: 'Задачи',          rx: /--tasks\b/        },
		{ type: 'other',    label: 'Остальные',       rx: null               },
	];
	// Hidden by default: show only dialog, chat, group, other
	const DEFAULT_HIDDEN_CATS = new Set(['deal','videoconf','support','phone','calendar','general','network','guests','tasks']);

	function loadCatVisibility() {
		try { return JSON.parse(localStorage.getItem(CAT_VIS_LS_KEY) || '{}'); } catch { return {}; }
	}
	function saveCatVisibility(obj) {
		try { localStorage.setItem(CAT_VIS_LS_KEY, JSON.stringify(obj)); } catch {}
	}
	function isCatVisible(type) {
		const vis = loadCatVisibility();
		if (type in vis) return !!vis[type];
		return !DEFAULT_HIDDEN_CATS.has(type);
	}
	function setCatVisible(type, visible) {
		const vis = loadCatVisibility();
		vis[type] = visible;
		saveCatVisibility(vis);
	}
	function loadCustomCats() {
		try { return JSON.parse(localStorage.getItem(CUSTOM_CATS_LS_KEY) || '[]'); } catch { return []; }
	}
	function saveCustomCats(arr) {
		try { localStorage.setItem(CUSTOM_CATS_LS_KEY, JSON.stringify(arr)); } catch {}
	}
	function getAllVisibleCats() {
		const result = BUILTIN_CATS.filter(c => isCatVisible(c.type));
		const custom = loadCustomCats().filter(c => isCatVisible(c.type));
		return [...result, ...custom];
	}
	function getPanelModeKey() {
		if (IS_OL_FRAME) return 'ol';
		return isTasksChatsModeNow() ? 'tasks' : 'internal';
	}
	function updateTypeChipsUI(host) {
		const sel = new Set(Array.isArray(filters.typesSelected) ? filters.typesSelected : []);
		host.querySelectorAll('#anit_types .anit-type-chip').forEach((btn) => {
			const v = String(btn.getAttribute('data-type') || '');
			btn.classList.toggle('is-selected', sel.has(v));
			btn.setAttribute('aria-pressed', sel.has(v) ? 'true' : 'false');
		});
	}
	function readTypesFromUI(host) {
		const chosen = [];
		host.querySelectorAll('#anit_types .anit-type-chip.is-selected').forEach((btn) => {
			const v = String(btn.getAttribute('data-type') || '');
			if (v) chosen.push(v);
		});
		return chosen;
	}

	function restorePosition(host, mode) {
	try {
	const raw = localStorage.getItem(POS_LS_KEY(mode));
	if (!raw) return false;
	const pos = JSON.parse(raw);
	if (!pos) return false;
	host.style.left  = (pos.left ?? 0) + 'px';
	host.style.top   = (pos.top ?? 0) + 'px';
	return true;
} catch { return false; }
}
		function uiFromFilters(host){
			host.querySelector('#anit_unread').checked = !!filters.unreadOnly;
			host.querySelector('#anit_query').value = String(filters.query || '');
			updateTypeChipsUI(host);
			if (host.querySelector('#anit_project_input')) {
				try { syncProjectInputFromFilters?.(); } catch {}
			}
			if (host.querySelector('#anit_responsible_input')) {
				try { syncResponsibleInputFromFilters?.(); } catch {}
			}
			if (host.querySelector('#anit_status_input')) {
				try { syncStatusInputFromFilters?.(); } catch {}
			}
			if (host.querySelector('#anit_hidden_group')) {
				try { refreshHiddenChips(host); updateHiddenCounts(host); } catch {}
			}
			// Обновляем визуальное состояние тегов (renderTagChips/renderIntersectionTagChips
			// определены внутри buildFiltersPanel и недоступны из этой области видимости ? обновляем напрямую)
			const _kwChips = host.querySelector('#anit_kwtags_chips');
			if (_kwChips) {
				const _kwSel = new Set(Array.isArray(filters.selectedTags) ? filters.selectedTags : []);
				_kwChips.querySelectorAll('.kw-tag-chip').forEach(chip => {
					const tag = chip.childNodes[0]?.textContent?.trim();
					if (tag !== undefined) chip.classList.toggle('is-active', _kwSel.has(tag));
				});
			}
			const _ixChips = host.querySelector('#anit_itags_chips');
			if (_ixChips) {
				const _ixSel = new Set(Array.isArray(filters.selectedIntersectionTags) ? filters.selectedIntersectionTags : []);
				_ixChips.querySelectorAll('.kw-tag-chip').forEach(chip => {
					const tag = chip.childNodes[0]?.textContent?.trim();
					if (tag !== undefined) chip.classList.toggle('is-active', _ixSel.has(tag));
				});
			}
		}

		function filtersFromUI(host){
			filters.unreadOnly = host.querySelector('#anit_unread').checked;
			filters.query      = host.querySelector('#anit_query').value;
				filters.typesSelected = readTypesFromUI(host);
			const pInp = host.querySelector('#anit_project_input');
			if (pInp) {
				const v = String(pInp.value || '').trim();
				if (v === '') filters.projectIndexes = [];
			}
			const rInp = host.querySelector('#anit_responsible_input');
			if (rInp) {
				const v = String(rInp.value || '').trim();
				if (v === '') filters.responsibleIndexes = [];
			}
			const sInp = host.querySelector('#anit_status_input');
			if (sInp) {
				const v = String(sInp.value || '').trim();
				if (v === '') filters.statusIndexes = [];
			}
			if (isTasksChatsModeNow()) filters.sortMode = 'native';
		}

		function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

	function makeDraggable(host, mode) {
	const handles = [host.querySelector('.header'), host.querySelector('#anit_mini_toggle'), host].filter(Boolean);
	let dragging = false, moved = false, startX=0, startY=0, startLeft=0, startTop=0, dragMiniWithDock=false, dockStartLeft=0, dockStartTop=0;

	const keepInsideViewport = () => {
	// При сужении окна браузера ? тоже сужаем панель, если она шире
	const maxW = window.innerWidth - 8;
	if (host.offsetWidth > maxW) host.style.width = maxW + 'px';
	const r = host.getBoundingClientRect();
	let left = parseInt(host.style.left || '0', 10) || 0;
	let top  = parseInt(host.style.top  || '0', 10) || 0;
	const maxLeft = Math.max(0, window.innerWidth  - r.width);
	const maxTop  = Math.max(0, window.innerHeight - r.height);
	host.style.left = clamp(left, 0, maxLeft) + 'px';
	host.style.top  = clamp(top,  0, maxTop)  + 'px';
	_syncDialogDockToPanel(host);
};

	const onMove = (clientX, clientY) => {
	const dx = clientX - startX;
	const dy = clientY - startY;
	if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
	const r  = host.getBoundingClientRect();
	const maxLeft = Math.max(0, window.innerWidth  - r.width);
	const maxTop  = Math.max(0, window.innerHeight - r.height);
	const left = clamp(startLeft + dx, 0, maxLeft);
	const top  = clamp(startTop  + dy, 0, maxTop);
	host.style.left  = left + 'px';
	host.style.top   = top  + 'px';
	if (dragMiniWithDock && _dialogControlDock) {
		_dialogControlDock.style.left = clamp(dockStartLeft + dx, 0, Math.max(0, window.innerWidth - (_dialogControlDock.getBoundingClientRect().width || 24))) + 'px';
		_dialogControlDock.style.top = clamp(dockStartTop + dy, 0, Math.max(0, window.innerHeight - (_dialogControlDock.getBoundingClientRect().height || 24))) + 'px';
	} else {
		_syncDialogDockToPanel(host);
	}
};

	const onPointerDown = (e) => {
	if (e.type === 'mousedown' && e.button !== 0) return;
	const t = e.target;
	const fromMiniToggle = !!t?.closest?.('#anit_mini_toggle');
	// Запрещаем перетаскивание при клике на интерактивные/скролл элементы
	if (!fromMiniToggle && t && (t.closest?.('button, input, select, textarea, a, [contenteditable], #anit_scr_thumb, #anit_scr_track, .controls-pop, .pm-drag') || t.isContentEditable)) return;
	// Запрещаем drag в зонах ресайза (края окна) ? там должен работать resize
	if (!fromMiniToggle && !host.classList.contains('anit-hidden')) {
		const _r = host.getBoundingClientRect(), _E = 12;
		const cx = e.touches?.[0]?.clientX ?? e.clientX ?? 0;
		const cy = e.touches?.[0]?.clientY ?? e.clientY ?? 0;
		if (cx <= _r.left + _E || cx >= _r.right - _E || cy >= _r.bottom - _E) return;
	}
	dragging = true;
	moved = false;
	dragMiniWithDock = fromMiniToggle && host.classList.contains('anit-hidden') && !!_dialogControlDock;
	host.classList.add('anit-dragging');
	startLeft = parseInt(host.style.left || (window.innerWidth - host.offsetWidth - 10) + '', 10) || 0;
	startTop  = parseInt(host.style.top  || '8', 10) || 0;
	dockStartLeft = parseInt(_dialogControlDock?.style.left || '0', 10) || 0;
	dockStartTop = parseInt(_dialogControlDock?.style.top || '8', 10) || 0;
	startX = (e.touches?.[0]?.clientX ?? e.clientX ?? 0);
	startY = (e.touches?.[0]?.clientY ?? e.clientY ?? 0);

	document.addEventListener('mousemove', onMouseMove);
	document.addEventListener('mouseup', onPointerUp);
	document.addEventListener('touchmove', onTouchMove, {passive:false});
	document.addEventListener('touchend', onPointerUp);
	e.preventDefault();
};
	const onMouseMove = (e) => { if (!dragging) return; onMove(e.clientX, e.clientY); };
	const onTouchMove = (e) => { if (!dragging) return; onMove(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); };
	const onPointerUp  = () => {
	if (!dragging) return;
	dragging = false;
	dragMiniWithDock = false;
	host.classList.remove('anit-dragging');
	document.removeEventListener('mousemove', onMouseMove);
	document.removeEventListener('mouseup', onPointerUp);
	document.removeEventListener('touchmove', onTouchMove);
	document.removeEventListener('touchend', onPointerUp);
	try {
	localStorage.setItem(POS_LS_KEY(mode), JSON.stringify({
	left: parseInt(host.style.left || '0', 10) || 0,
	top:  parseInt(host.style.top  || '0', 10) || 0,
}));
} catch {}
	if (moved) host.dataset.lastDragTs = String(Date.now());
};

	handles.forEach((h) => {
		h.addEventListener('mousedown', onPointerDown);
		h.addEventListener('touchstart', onPointerDown, {passive:false});
	});
	keepInsideViewport();
	window.addEventListener('resize', keepInsideViewport);
}


	let filtersHost = null;
	let _setFiltersPanelHidden = null;
	let _globalHotkeysInstalled = false;

	function _getFiltersPanelHost() {
		return filtersHost || document.getElementById('anit-filters');
	}

	function _setFiltersPanelHiddenState(hidden, pane = _getFiltersPanelHost()) {
		const shouldHide = !!hidden;
		_clearDialogDockHostHiddenState();
		if (typeof _setFiltersPanelHidden === 'function') {
			_setFiltersPanelHidden(shouldHide);
		} else if (pane) {
			pane.classList.toggle('anit-hidden', shouldHide);
			pane.classList.toggle('anit-hidden-final', shouldHide);
			try { localStorage.setItem('anit.filters.hidden', shouldHide ? '1' : '0'); } catch {}
		}
		if (shouldHide) {
			document.querySelectorAll('#anit_controls_pop,#anit_help_popup,#anit_preset_manage_panel,#anit_cat_manage_panel').forEach(el => el.classList.remove('--show'));
		}
		return pane;
	}

	function _setLinkedPanelsHidden(hidden) {
		_setFiltersPanelHiddenState(!!hidden, _getFiltersPanelHost());
	}

	function _toggleLinkedPanelsHidden() {
		const pane = _getFiltersPanelHost();
		_setLinkedPanelsHidden(!pane?.classList.contains('anit-hidden'));
	}

	function _isFindKey(e) {
		const code = String(e.code || '');
		const key = String(e.key || '').toLowerCase();
		return code === 'KeyF' || key === 'f' || key === 'а';
	}

	function _isCtrlAltFindHotkey(e) {
		return !!e && e.altKey && !e.shiftKey && (e.ctrlKey || e.metaKey) && _isFindKey(e);
	}

	function _installGlobalHotkeys() {
		if (_globalHotkeysInstalled) return;
		_globalHotkeysInstalled = true;
		const hotkeyHandler = (e) => {
			// Ctrl+1..9 ? быстрый выбор пресета по слоту
			if (e.ctrlKey && !e.altKey && !e.shiftKey) {
				const _d = e.code;
				if (_d >= 'Digit1' && _d <= 'Digit9') {
					// Перехватываем везде ? кроме полей ввода внутри самой панели расширения
					const _ae = document.activeElement;
					const _inPanel = _ae && document.getElementById('anit-filters')?.contains(_ae);
					if (!_inPanel) {
						const _idx = parseInt(_d.replace('Digit', '')) - 1;
						const _presets = _getPresetsArr();
						if (_idx < _presets.length) {
							applyPreset(_presets[_idx].id);
							e.stopImmediatePropagation();
							e.preventDefault();
							return;
						}
					}
				}
			}

			// Ctrl+Alt+F ? показать/скрыть панель
			if (_isCtrlAltFindHotkey(e)) {
				_toggleLinkedPanelsHidden();

				e.stopImmediatePropagation();
				e.preventDefault();
				return;
			}

			// Ctrl+Shift+A ? сброс всех фильтров
			if (e.ctrlKey && !e.altKey && e.shiftKey && e.code === 'KeyA') {
				const _ae = document.activeElement;
				const _tag = _ae?.tagName?.toLowerCase();
				if (_tag === 'input' || _tag === 'textarea' || _tag === 'select') return;
				const _inPanel = _ae && document.getElementById('anit-filters')?.contains(_ae);
				if (_inPanel) return;
				e.stopImmediatePropagation();
				e.preventDefault();
				document.getElementById('anit-filters')?.querySelector('#anit_reset')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));
				return;
			}

			// Ctrl+Q ? подавляем нежелательное РТ‘ействие Bitrix24 вне полей ввода
			if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyQ') {
				const _ae = document.activeElement;
				const _tag = _ae?.tagName?.toLowerCase();
				if (_tag === 'input' || _tag === 'textarea' || _tag === 'select') return;
				e.stopImmediatePropagation();
				e.preventDefault();
			}
		};
		document.addEventListener('keydown', hotkeyHandler, true);
		window.addEventListener('keydown', hotkeyHandler, true);
	}

	_installGlobalHotkeys();

	function nukeDuplicatePanels() {
	document.querySelectorAll('#anit-filters').forEach((n, i) => { if (i === 0) return; n.remove(); });
}

	async function buildFiltersPanel() {

	if (!isInternalChatsDOM()) return;

	await waitForBody(5000);


	if (document.getElementById('anit-filters')) { nukeDuplicatePanels(); return; }

	nukeDuplicatePanels();
	const isTasksMode = isTasksChatsModeNow();
	const host = document.createElement('div');
	host.id = 'anit-filters';
	host.innerHTML = `
<style>
#anit-filters{
  --pena-min-width:224px;
  --pena-radius:10px;
  --pena-icon-size:24px;
  --pena-font-heading:13px;
  --pena-font-subheading:11px;
  --pena-font-body:12px;
  --pena-bg:#10151d;
  --pena-bg-soft:rgba(255,255,255,.04);
  --pena-bg-strong:rgba(255,255,255,.08);
  --pena-border:rgba(255,255,255,.12);
  --pena-border-strong:rgba(255,255,255,.2);
  --pena-text:#f3f7fb;
  --pena-muted:#9dadc3;
  --pena-accent:#4d9dff;
  --pena-accent-soft:rgba(77,157,255,.18);
  position:fixed;top:8px;left:8px;z-index:10004;width:clamp(260px,32vw,448px);min-width:min(var(--pena-min-width),calc(100vw - 16px));max-width:94vw;transition:opacity .4s ease;box-sizing:border-box;container-type:inline-size;transform-origin:top left
}
#anit-filters.anit-hidden-final{min-width:0 !important;max-width:none !important;width:var(--pena-icon-size) !important;height:var(--pena-icon-size) !important}
#anit-filters.anit-hidden .pane{opacity:0;pointer-events:none;visibility:hidden;transition:opacity .16s ease,visibility 0s linear .16s}
#anit-filters.anit-hidden-final .pane{display:none !important}
#anit-filters .mini-toggle{display:none;width:var(--pena-icon-size);height:var(--pena-icon-size);min-width:var(--pena-icon-size);min-height:var(--pena-icon-size);box-sizing:border-box;padding:0;border:1px solid var(--pena-border-strong);border-radius:var(--pena-radius);background:linear-gradient(180deg,rgba(20,26,36,.98),rgba(11,15,22,.98));color:#fff;align-items:center;justify-content:center;cursor:grab;box-shadow:0 10px 24px rgba(0,0,0,.45);transition:border-color .15s,box-shadow .15s,transform .15s}
#anit-filters.anit-hidden .mini-toggle{display:inline-flex;position:absolute;top:0;left:0;z-index:2;transform:scale(var(--panel-icon-counter-scale,1));transform-origin:top left}
#anit-filters .mini-toggle:hover{border-color:rgba(255,255,255,.4);box-shadow:0 14px 28px rgba(0,0,0,.52)}
#anit-filters.anit-hidden .mini-toggle:hover{transform:scale(var(--panel-icon-counter-scale,1)) translateY(-1px)}
#anit-filters .mini-toggle svg{width:11px;height:11px;display:block;fill:#ffffff;opacity:.9}
#anit-filters .pane{background:linear-gradient(180deg,rgba(20,26,36,.98),rgba(11,15,22,.98));color:var(--pena-text);border:1px solid var(--pena-border);
  border-radius:var(--pena-radius);padding:12px;font:var(--pena-font-body)/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial;
  box-shadow:0 18px 40px rgba(0,0,0,.34),0 2px 0 rgba(255,255,255,.03) inset;cursor:grab;
  position:relative;width:100%;box-sizing:border-box;overflow-y:scroll;overflow-x:clip;scrollbar-width:none;max-height:90vh;opacity:1;visibility:visible;transition:opacity .16s ease;}
#anit-filters .pane::after{content:none!important;display:none!important}
#anit-filters .pane::-webkit-scrollbar{display:none}
/* Кастомный скроллбар ? позиционируется снаружи .pane, справа от панели */
#anit-filters #anit_scr_track{position:absolute;right:-10px;top:0;bottom:0;width:5px;background:rgba(255,255,255,.06);border-radius:var(--pena-radius);display:none;z-index:10001;cursor:pointer}
#anit-filters #anit_scr_thumb{position:absolute;left:0;right:0;background:rgba(255,255,255,.25);border-radius:var(--pena-radius);min-height:20px;cursor:grab;transition:background .15s}
#anit-filters #anit_scr_thumb:hover,#anit-filters #anit_scr_track:hover #anit_scr_thumb{background:rgba(255,255,255,.42)}
#anit-filters #anit_scr_thumb:active{cursor:grabbing}
/* Курсор при ресайзе за края ? перекрывает cursor:grab на .pane и других дочерних элементах */
#anit-filters.rz-e,#anit-filters.rz-e *{cursor:e-resize!important}
#anit-filters.rz-w,#anit-filters.rz-w *{cursor:w-resize!important}
#anit-filters.rz-s,#anit-filters.rz-s *{cursor:s-resize!important}
#anit-filters.rz-se,#anit-filters.rz-se *{cursor:se-resize!important}
#anit-filters.rz-sw,#anit-filters.rz-sw *{cursor:sw-resize!important}
#anit-filters.rz-e,#anit-filters.rz-w,#anit-filters.rz-s,#anit-filters.rz-se,#anit-filters.rz-sw{user-select:none;touch-action:none}
#anit-filters .header{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;column-gap:14px;row-gap:8px;margin:0 0 10px 0;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.08)}
#anit-filters .header-actions{display:flex;align-items:center;justify-content:flex-start;gap:8px;flex:0 0 auto;position:relative;flex-wrap:nowrap;max-width:100%;justify-self:start;margin-left:0;grid-row:2;grid-column:1}
#anit-filters .icon-btn{width:var(--pena-icon-size);height:var(--pena-icon-size);border:1px solid rgba(255,255,255,.18);border-radius:var(--pena-radius);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:border-color .15s,background .15s,transform .15s;box-sizing:border-box;flex:0 0 var(--pena-icon-size)}
#anit-filters .icon-btn svg{width:12px;height:12px;display:block;fill:#ffffff;opacity:.88}
#anit-filters .icon-btn:hover{border-color:rgba(255,255,255,.34);background:rgba(255,255,255,.08);transform:translateY(-1px)}
html.anit-panel-mode-switching #anit-filters .header-actions .icon-btn,
html.anit-panel-mode-switching #anit-dialog-control-dock .dialog-control-actions button{transition:none!important}
html.anit-panel-mode-switching #anit-filters .header-actions .icon-btn:hover,
html.anit-panel-mode-switching #anit-dialog-control-dock .dialog-control-actions button:hover{border-color:rgba(255,255,255,.18)!important;background:rgba(255,255,255,.04)!important;transform:none!important}
#anit-filters .icon-btn.--active{border-color:rgba(255,73,73,.58);background:rgba(255,73,73,.16);color:#ffd6d6}
#anit-filters .icon-btn:focus-visible,
#anit-filters button:focus-visible,
#anit-filters input:focus-visible,
#anit-filters select:focus-visible{outline:2px solid rgba(77,157,255,.6);outline-offset:2px}
#anit-filters .brand{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 auto;overflow:hidden}
#anit-filters .brand-icon{width:20px;height:20px;display:inline-flex;flex:0 0 20px}
#anit-filters .brand-logo{height:22px;width:auto;max-width:120px;filter:invert(1);mix-blend-mode:screen;flex-shrink:0;display:block}
#anit-filters .brand > div{min-width:0;max-width:100%;overflow:hidden}
#anit-filters .brand-title{font-size:var(--pena-font-subheading);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--pena-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#anit-filters .brand-sub{font-size:var(--pena-font-heading);font-weight:700;opacity:.97;letter-spacing:.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2}
#anit-filters .group{margin-top:10px;padding:10px;border:1px solid rgba(255,255,255,.08);border-radius:var(--pena-radius);background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.02))}
#anit-filters .group:first-of-type{margin-top:0}
#anit-filters .group-title{font-size:var(--pena-font-subheading);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--pena-muted);margin:0 0 8px 0}
#anit-filters .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:6px 0 0}
#anit-filters label{display:flex;align-items:center;gap:8px;white-space:nowrap;cursor:pointer;color:#d8e0eb}
#anit-filters label span,
#anit-filters label{min-width:0}
#anit-filters input[type="checkbox"]{
  -webkit-appearance:none;appearance:none;
  width:14px;height:14px;min-width:14px;
  margin:0;
  border:1px solid rgba(255,255,255,.95);
  border-radius:50%;
  background:#070809;
  display:inline-flex;align-items:center;justify-content:center;
  cursor:pointer;
  box-sizing:border-box;
}
#anit-filters input[type="checkbox"]::before{
  content:"";
  width:6px;height:6px;
  border-radius:50%;
  background:#ffffff;
  transform:scale(0);
  transform-origin:center;
  transition:transform .12s ease;
}
#anit-filters input[type="checkbox"]:checked::before{transform:scale(1)}
#anit-filters input[type="text"]{height:32px;min-width:0;box-sizing:border-box;padding:0 10px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;outline:none;line-height:18px;font-size:var(--pena-font-body);-webkit-appearance:none;appearance:none;transition:border-color .15s,background .15s,box-shadow .15s}
#anit-filters input[type="text"]::placeholder{color:rgba(180,194,214,.62)}
#anit-filters input[type="text"]:hover,
#anit-filters select:hover{border-color:rgba(255,255,255,.24)}
#anit-filters input[type="text"]:focus,
#anit-filters select:focus{border-color:rgba(77,157,255,.5);background:rgba(77,157,255,.08);box-shadow:0 0 0 3px rgba(77,157,255,.12)}
#anit-filters input[type="text"]:-webkit-autofill,
#anit-filters input[type="text"]:-webkit-autofill:hover,
#anit-filters input[type="text"]:-webkit-autofill:focus{-webkit-text-fill-color:#fff!important;caret-color:#fff!important;line-height:20px!important;box-shadow:0 0 0 1000px rgba(255,255,255,.04) inset!important;-webkit-box-shadow:0 0 0 1000px rgba(255,255,255,.04) inset!important;transition:background-color 9999s ease-out 0s}
#anit-filters #anit_query{width:100%}
#anit-filters #anit_project_input,#anit-filters #anit_responsible_input,#anit-filters #anit_status_input{width:100%}
#anit-filters .search-field{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:0 10px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.03);transition:border-color .15s,background .15s,box-shadow .15s;box-sizing:border-box}
#anit-filters .search-field:hover{border-color:rgba(255,255,255,.24);background:rgba(255,255,255,.05)}
#anit-filters .search-field:focus-within{border-color:rgba(77,157,255,.5);background:rgba(77,157,255,.08);box-shadow:0 0 0 3px rgba(77,157,255,.12)}
#anit-filters .search-field svg{width:12px;height:12px;fill:var(--pena-muted);flex:0 0 auto}
#anit-filters .search-field #anit_query{flex:1 1 auto;border:0;background:transparent;box-shadow:none;padding:0;height:32px;line-height:18px}
#anit-filters .search-field #anit_query:focus{background:transparent;box-shadow:none}
#anit-filters .project-wrap{position:relative;flex:1 1 220px;min-width:0;max-width:100%}
#anit-filters #anit_projects_row{align-items:center}
#anit-filters #anit_projects_row .muted{flex:0 0 auto}
#anit-filters #anit_responsibles_row{align-items:center}
#anit-filters #anit_responsibles_row .muted{flex:0 0 auto}
#anit-filters #anit_status_row{align-items:center}
#anit-filters #anit_status_row .muted{flex:0 0 auto}
#anit-filters #anit_project_suggest,
#anit-filters #anit_responsible_suggest,
#anit-filters #anit_status_suggest,
#anit-filters #anit_hidden_project_suggest,
#anit-filters #anit_hidden_responsible_suggest{top:40px;left:0;right:0;max-width:100%;box-sizing:border-box;background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(255,255,255,.13);border-radius:var(--pena-radius);padding:6px;box-shadow:0 14px 34px rgba(0,0,0,.42),0 1px 0 rgba(255,255,255,.04) inset;z-index:2147483638;color:var(--pena-text);max-height:230px;overflow:auto}
#anit-filters #anit_project_suggest .muted,
#anit-filters #anit_responsible_suggest .muted,
#anit-filters #anit_status_suggest .muted,
#anit-filters #anit_hidden_project_suggest .muted,
#anit-filters #anit_hidden_responsible_suggest .muted{padding:8px 10px;color:var(--pena-muted);opacity:1}
#anit-filters #anit_project_suggest button,
#anit-filters #anit_responsible_suggest button,
#anit-filters #anit_status_suggest button{display:flex!important;align-items:center;min-height:32px;border:0;background:transparent;border-radius:var(--pena-radius);color:#dce6f3;box-shadow:none;line-height:1.35;white-space:normal}
#anit-filters #anit_project_suggest button:hover,
#anit-filters #anit_responsible_suggest button:hover,
#anit-filters #anit_status_suggest button:hover{background:rgba(77,157,255,.12);transform:none}
#anit-filters #anit_hidden_project_suggest label,
#anit-filters #anit_hidden_responsible_suggest label{border-radius:var(--pena-radius);white-space:normal;line-height:1.35;min-height:32px;box-sizing:border-box}
#anit-filters #anit_hidden_project_suggest label:hover,
#anit-filters #anit_hidden_responsible_suggest label:hover{background:rgba(77,157,255,.12)}
#anit-filters select{padding:8px 10px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff}
#anit-filters .muted{opacity:.75;color:var(--pena-muted)}
#anit-filters .actions{display:flex;gap:8px;margin-top:4px;flex-wrap:wrap}
#anit-filters button{padding:7px 11px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:var(--pena-font-body);line-height:1.2;transition:border-color .15s,background .15s,transform .15s}
#anit-filters button:hover{border-color:rgba(255,255,255,.28);background:rgba(255,255,255,.08);transform:translateY(-1px)}
#anit-filters .anit-toggle,#anit-filters .category-toggle{padding:0 !important;line-height:1;box-sizing:border-box;flex-shrink:0}
#anit-filters .btn-primary{background:linear-gradient(180deg,#4d9dff,#2f7ee6);border-color:#4d9dff;color:#fff}
#anit-filters .btn-secondary{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18);color:#fff}
#anit-filters .btn-tertiary{background:transparent;border-color:rgba(255,255,255,.18);color:#d6dce5}
#anit-filters .kbd-seq{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
#anit-filters .kbd{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border:1px solid rgba(255,255,255,.3);border-radius:var(--pena-radius);font-family:monospace;font-size:11px;line-height:1;background:rgba(255,255,255,.045)}
#anit-filters .kbd-plus{display:inline-flex;align-items:center;justify-content:center;min-width:7px;color:rgba(255,255,255,.72);font-size:12px;font-weight:700;line-height:1}
#anit-filters .chips{display:flex;flex-wrap:wrap;gap:6px}
#anit-filters .chip{display:inline-flex;gap:6px;align-items:center;border:1px solid rgba(255,255,255,.25);border-radius:var(--pena-radius);padding:3px 8px;background:#070809}
#anit-filters .chip input{accent-color:#5dc}
#anit-filters .kw-tag-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.18);border-radius:var(--pena-radius);padding:5px 8px 5px 10px;background:rgba(255,255,255,.04);cursor:pointer;font-size:var(--pena-font-body);color:#c5d3e7;transition:all .12s ease;white-space:nowrap}
#anit-filters .kw-tag-chip.is-active{background:rgba(77,157,255,.22);border-color:#4d9dff;color:#fff}
#anit-filters .kw-tag-chip .tag-rm{width:16px;height:16px;margin-left:0;opacity:.68;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-align:center;color:#aeb9c8;flex:0 0 16px;border-radius:var(--pena-radius)}
#anit-filters .kw-tag-chip .tag-rm svg{width:11px;height:11px;display:block;fill:currentColor;pointer-events:none}
#anit-filters .kw-tag-chip .tag-rm:hover{opacity:1;color:#ff8f8f}
#anit-filters .tag-confirm-pop{position:absolute;inset:0;background:rgba(7,10,15,.8);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;z-index:999;border-radius:inherit;padding:12px}
#anit-filters .tag-confirm-box{background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(255,255,255,.14);border-radius:var(--pena-radius);padding:16px 18px;text-align:center;width:min(230px,100%);box-shadow:0 18px 42px rgba(0,0,0,.46)}
#anit-filters .tag-confirm-text{font-size:13px;color:#dce4ef;margin-bottom:12px;line-height:1.45}
#anit-filters .tag-confirm-btns{display:flex;gap:8px;justify-content:center}
#anit-filters .tag-confirm-cancel{padding:7px 14px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#c7d3e4;cursor:pointer;font-size:12px}
#anit-filters .tag-confirm-cancel:hover{background:rgba(255,255,255,.12);color:#fff}
#anit-filters .tag-confirm-ok{padding:7px 14px;border-radius:var(--pena-radius);border:1px solid rgba(255,96,96,.42);background:rgba(255,80,80,.14);color:#ffb2b2;cursor:pointer;font-size:12px}
#anit-filters .tag-confirm-ok:hover{background:rgba(255,80,80,.22);color:#ffd0d0}
#anit-filters #anit_tag_add_input{flex:1;min-width:0;padding:6px 8px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.25);background:#070809;color:#fff;outline:none;font-size:12px}
#anit-filters #anit_tag_add_btn{width:var(--pena-icon-size);min-width:var(--pena-icon-size);flex-shrink:0;align-self:stretch;display:flex;align-items:center;justify-content:center;padding:0;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.25);background:#070809;color:#b8c6dc;cursor:pointer;font-size:14px;line-height:1}
#anit-filters #anit_tag_add_btn:hover{border-color:#1587fa;color:#fff}
#anit-filters #anit_itag_add_input{flex:1;min-width:0;padding:6px 8px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.25);background:#070809;color:#fff;outline:none;font-size:12px}
#anit-filters #anit_itag_add_btn{width:var(--pena-icon-size);min-width:var(--pena-icon-size);flex-shrink:0;align-self:stretch;display:flex;align-items:center;justify-content:center;padding:0;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.25);background:#070809;color:#b8c6dc;cursor:pointer;font-size:14px;line-height:1}
#anit-filters #anit_itag_add_btn:hover{border-color:#1587fa;color:#fff}
/* Floating popups (.pena-fpop) */
.pena-fpop{position:absolute;background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(255,255,255,.13);border-radius:var(--pena-radius);padding:12px;box-shadow:0 18px 42px rgba(0,0,0,.46),0 1px 0 rgba(255,255,255,.04) inset;z-index:2147483648;min-width:220px;max-width:min(340px,calc(100vw - 24px));opacity:0;pointer-events:none;transform:translateY(-6px) scale(0.96);transform-origin:top right;transition:opacity .18s ease,transform .18s ease;color:var(--pena-text);box-sizing:border-box}
.pena-fpop.--show{opacity:1;pointer-events:auto;transform:translateY(0) scale(1)}
#anit-filters .pena-fpop-header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.08)}
#anit-filters .pena-fpop-title{font-size:10px;font-weight:700;color:var(--pena-muted);text-transform:uppercase;letter-spacing:.08em}
#anit-filters .pena-fpop-close{width:var(--pena-icon-size);height:var(--pena-icon-size);background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.2);outline:0;-webkit-appearance:none;appearance:none;color:rgba(255,120,120,.9);cursor:pointer;font-size:14px;line-height:1;padding:0;margin:0;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border-radius:var(--pena-radius);box-sizing:border-box}
#anit-filters .pena-fpop-close svg,#anit-filters .controls-pop-close svg{width:10px;height:10px;display:block;fill:currentColor;stroke:none;opacity:1;pointer-events:none}
#anit-filters .pena-fpop-close:hover{color:#ffd0d0;border-color:rgba(255,100,100,.42);background:rgba(255,80,80,.16)}
#anit-filters .pena-fpop table{border-collapse:separate;border-spacing:0 6px;font-size:11px;width:100%}
#anit-filters .pena-fpop td{padding:0;color:#c7d3e4;vertical-align:middle}
#anit-filters .pena-fpop td:first-child{padding-right:12px;white-space:nowrap}
#anit-filters .pena-prefetch-popup{position:absolute;inset:0;z-index:1000;background:rgba(7,10,15,.68);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);display:flex;align-items:center;justify-content:center;border-radius:var(--pena-radius);padding:22px}
#anit-filters .pena-prefetch-box{background:transparent;border:0;border-radius:0;padding:0;width:min(230px,100%);box-shadow:none;text-align:center}
#anit-filters .pena-prefetch-handle{font-size:13px;font-weight:700;color:#fff;margin-bottom:12px;cursor:default;user-select:none}
#anit-filters .pena-prefetch-sub{font-size:12px;color:#dce4ef;margin-top:9px;line-height:1.45}
#anit-filters .pena-prefetch-bar-wrap{height:6px;background:rgba(255,255,255,.08);border-radius:var(--pena-radius);overflow:hidden;margin-bottom:2px}
#anit-filters .pena-prefetch-bar{height:100%;width:0%;background:linear-gradient(90deg,#4d9dff,#7fc4ff);border-radius:var(--pena-radius);transition:width .15s ease}
#anit-filters .pena-prefetch-cancel{margin-top:10px;width:100%;padding:8px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#c7d3e4;cursor:pointer;font-size:11px;box-sizing:border-box}
#anit-filters .pena-prefetch-cancel:hover{border-color:#f66;color:#f88}
#anit-filters .type-grid{display:flex;flex-wrap:wrap;gap:8px;width:100%;align-items:flex-start}
#anit-filters .anit-type-chip{display:flex;align-items:center;justify-content:flex-start;min-height:32px;max-width:100%;padding:6px 10px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035);color:#c5d1e1;cursor:pointer;font-size:var(--pena-font-body);line-height:1.25;text-align:left;transition:background .12s,border-color .12s,color .12s,transform .12s;box-sizing:border-box;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#anit-filters .anit-type-chip:hover{border-color:rgba(255,255,255,.28);background:rgba(255,255,255,.08);color:#eef4fb;transform:translateY(-1px)}
#anit-filters .anit-type-chip.is-selected{background:rgba(77,157,255,.22);border-color:#4d9dff;color:#fff}
#anit-filters .group{position:relative}
#anit-filters .group-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:nowrap;margin:0 0 8px 0}
#anit-filters .group-head .group-title{margin:0;line-height:var(--pena-icon-size);min-width:0}
#anit-filters .group-head > div:last-child{display:flex!important;align-items:center!important;gap:8px!important;margin-left:auto;padding-left:10px;flex:0 0 auto}
#anit-filters .category-toggle{width:var(--pena-icon-size);height:var(--pena-icon-size);border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.04);color:#9ab;border-radius:var(--pena-radius);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:border-color .15s,background .15s;box-sizing:border-box;flex:0 0 var(--pena-icon-size)}
#anit-filters .category-toggle:hover{border-color:rgba(255,255,255,.4);background:rgba(255,255,255,.09)}
#anit-filters .category-toggle svg{display:block;width:11px;height:11px;fill:none;stroke:#b8c4d4;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}
#anit-filters .group.is-collapsed .category-toggle svg{transform:rotate(-90deg)}
#anit-filters .group.is-collapsed .group-body{display:none}
#anit-filters .chip-remove{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:14px;line-height:1;color:#aeb9c8;opacity:.7;flex:0 0 16px;border-radius:var(--pena-radius)}
#anit-filters .chip-remove:hover{color:#ff8f8f;opacity:1}
#anit-filters .anit-hidden-row .project-wrap{position:relative}
#anit-filters #anit_hidden_project_input,#anit-filters #anit_hidden_responsible_input{width:100%;box-sizing:border-box}
#anit-filters .presets-row{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 0;justify-content:flex-start;align-items:flex-start}
#anit-filters .preset-btn{flex:0 1 auto;min-width:0;max-width:100%;min-height:26px;padding:0 10px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#c6d2e2;font-size:var(--pena-font-body);cursor:pointer;transition:background .15s,border-color .15s,color .15s,transform .15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1;display:inline-flex;align-items:center;justify-content:center;text-align:center;box-sizing:border-box}
#anit-filters .preset-btn:hover{background:rgba(255,255,255,.11);color:#fff;transform:translateY(-1px)}
#anit-filters .preset-btn.--active{background:linear-gradient(180deg,rgba(77,157,255,.35),rgba(54,116,196,.35));border-color:#4d9dff;color:#fff;box-shadow:0 0 0 1px rgba(77,157,255,.15) inset}
#anit-filters .pm-header{font-size:10px;font-weight:600;color:rgba(255,255,255,.32);text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px}
#anit-filters .pm-row{display:flex;align-items:center;gap:5px;padding:2px 0;border-radius:var(--pena-radius);transition:background .1s}
#anit-filters .pm-row.drag-over{background:rgba(21,135,250,.1);outline:1px dashed rgba(21,135,250,.35);outline-offset:-1px}
#anit-filters .pm-drag{cursor:grab;padding:0 3px;opacity:.3;flex-shrink:0;display:flex;align-items:center;color:#fff;user-select:none;touch-action:none}
#anit-filters .pm-drag:hover{opacity:.7}
#anit-filters .pm-drag:active{cursor:grabbing}
#anit-filters .pm-inp{flex:1;padding:4px 8px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#e9edf1;font-size:11px;min-width:0;outline:none;transition:border-color .15s,background .15s}
#anit-filters .pm-inp:focus{border-color:rgba(21,135,250,.55);background:rgba(21,135,250,.07)}
#anit-filters .pm-del{flex-shrink:0;width:22px;height:22px;min-height:22px;align-self:center;padding:0;box-sizing:border-box;border-radius:var(--pena-radius);border:0!important;background:transparent;color:rgba(255,120,120,.72);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:color .15s,opacity .15s;opacity:.78}
#anit-filters .pm-del:hover{border:0!important;background:transparent;color:#ff9a9a;opacity:1;transform:none}
#anit-filters .pm-del svg{width:14px;height:14px;display:block}
#anit-filters .pm-add-section{border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:6px}
#anit-filters .pm-add-label{font-size:10px;color:rgba(255,255,255,.32);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px}
#anit-filters .pm-add-row{display:flex;gap:4px}
#anit-filters .pm-add-inp{flex:1;min-width:0;padding:5px 8px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#e9edf1;font-size:11px;outline:none;transition:border-color .15s}
#anit-filters .pm-add-inp:focus{border-color:rgba(21,135,250,.5)}
#anit-filters .pm-add-btn{padding:5px 10px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#c8d0dc;cursor:pointer;font-size:11px;white-space:nowrap;transition:all .15s}
#anit-filters .pm-add-btn:hover{background:rgba(255,255,255,.14);color:#fff}
#anit-filters .pm-empty{font-size:11px;color:rgba(255,255,255,.28);padding:4px 2px 6px;text-align:center}
#anit-filters #anit_preset_manage_panel,#anit-filters #anit_cat_manage_panel{position:absolute;z-index:2147483640;background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(255,255,255,.13);border-radius:var(--pena-radius);padding:12px;box-shadow:0 18px 42px rgba(0,0,0,.46),0 1px 0 rgba(255,255,255,.04) inset;min-width:min(280px,calc(100vw - 24px));max-width:min(360px,calc(100vw - 24px));opacity:0;pointer-events:none;transform:translateY(-6px) scale(0.96);transform-origin:top left;transition:opacity .18s ease,transform .18s ease;color:var(--pena-text);box-sizing:border-box}
#anit-filters #anit_preset_manage_panel.--show,#anit-filters #anit_cat_manage_panel.--show{opacity:1;pointer-events:auto;transform:translateY(0) scale(1)}
#anit-filters.anit-debug-mode .pane{outline:4px solid #f59e0b;outline-offset:-2px;border-radius:var(--pena-radius)}
#anit-filters.anit-dialog-control-mode .pane{outline:4px solid #ef4444;outline-offset:-2px;border-radius:var(--pena-radius)}
#anit-filters.anit-dragging,#anit-filters.anit-dragging .pane{cursor:grabbing !important;user-select:none}
/* debug-badge внутри панели скрыт ? индикатор вынесен над окном (#anit_debug_overlay) */
#anit-filters .debug-badge{display:none !important}
/* Overlay «Режим отладки» ? над окном расширения */
#anit-filters #anit_debug_overlay{position:absolute;bottom:calc(100% + 5px);left:0;right:0;display:none;align-items:center;justify-content:center;pointer-events:none;z-index:2147483647;gap:8px}
#anit-filters.anit-debug-mode #anit_debug_overlay{display:flex;pointer-events:auto}
#anit-filters .anit-debug-flag{width:100%;font-size:13px;font-weight:700;color:#f8c86c;background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(245,158,11,.42);border-radius:var(--pena-radius);padding:8px 14px;letter-spacing:.2px;box-shadow:0 12px 30px rgba(0,0,0,.38),0 1px 0 rgba(255,255,255,.04) inset;display:inline-flex;align-items:center;justify-content:center;gap:7px;text-align:center;line-height:1.25;box-sizing:border-box}
#anit-filters .anit-debug-flag svg{width:13px;height:13px;display:block;flex:0 0 13px;stroke:#f8c86c}
#anit-filters #anit_dialog_control_overlay{position:absolute;bottom:calc(100% + 5px);left:0;right:0;display:none;align-items:center;justify-content:center;pointer-events:none;z-index:2147483647}
#anit-filters.anit-dialog-control-mode #anit_dialog_control_overlay{display:flex}
#anit-filters .anit-control-flag{width:100%;font-size:13px;font-weight:700;color:#ffb3b3;background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(239,68,68,.48);border-radius:var(--pena-radius);padding:8px 14px;letter-spacing:.2px;box-shadow:0 12px 30px rgba(0,0,0,.38),0 1px 0 rgba(255,255,255,.04) inset;display:inline-flex;align-items:center;justify-content:center;gap:7px;text-align:center;line-height:1.25;box-sizing:border-box}
#anit-filters .anit-control-flag svg{width:13px;height:13px;display:block;flex:0 0 13px;stroke:#ffb3b3}
#anit-dialog-control-dock{--pena-radius:10px;--pena-icon-size:24px;--pena-font-heading:13px;--pena-font-subheading:11px;--pena-font-body:12px;--pena-bg:#10151d;--pena-bg-soft:rgba(255,255,255,.04);--pena-bg-strong:rgba(255,255,255,.08);--pena-border:rgba(255,255,255,.12);--pena-border-strong:rgba(255,255,255,.2);--pena-text:#f3f7fb;--pena-muted:#9dadc3;--pena-accent:#4d9dff;--pena-accent-soft:rgba(77,157,255,.18);--dock-scale:1;--dock-opacity:1;position:fixed;z-index:10003;width:var(--pena-icon-size);height:var(--pena-icon-size);box-sizing:border-box;font:var(--pena-font-body)/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial;color:var(--pena-text);opacity:var(--dock-opacity);transform:scale(var(--dock-scale));transform-origin:top right;pointer-events:auto;transition:opacity .4s ease}
#anit-dialog-control-dock.--expanded,#anit-dialog-control-dock.--pinned{width:var(--pena-icon-size);height:var(--pena-icon-size)}
#anit-dialog-control-dock.--expanded .dialog-control-toggle,#anit-dialog-control-dock.--pinned .dialog-control-toggle{display:none}
#anit-dialog-control-dock.--empty .dialog-control-toggle{opacity:.9}
#anit-dialog-control-dock .dialog-control-toggle{width:var(--pena-icon-size);height:var(--pena-icon-size);min-width:var(--pena-icon-size);min-height:var(--pena-icon-size);border:1px solid rgba(255,255,255,.2);border-radius:var(--pena-radius);background:linear-gradient(180deg,rgba(20,26,36,.98),rgba(11,15,22,.98));box-shadow:0 10px 24px rgba(0,0,0,.45);color:#fff;display:inline-flex;align-items:center;justify-content:center;padding:0;cursor:grab;box-sizing:border-box}
#anit-dialog-control-dock:not(.--expanded):not(.--pinned) .dialog-control-toggle{transform:scale(var(--dock-icon-counter-scale,1));transform-origin:top right}
#anit-dialog-control-dock .dialog-control-toggle svg{width:14px;height:14px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:.9}
#anit-dialog-control-dock .dialog-control-window{container-type:inline-size;position:absolute;right:0;top:0;width:260px;height:260px;min-width:220px;min-height:160px;max-width:min(var(--dock-max-width,520px),calc(100vw - 60px));max-height:calc(100vh - 16px);opacity:0;pointer-events:none;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:var(--pena-radius);padding:12px;background:linear-gradient(180deg,rgba(20,26,36,.98),rgba(11,15,22,.98));box-shadow:0 18px 40px rgba(0,0,0,.34),0 2px 0 rgba(255,255,255,.03) inset;transform:none;transform-origin:right top;transition:opacity .16s ease;box-sizing:border-box;cursor:grab;display:flex;flex-direction:column}
#anit-dialog-control-dock .dialog-control-window::after{content:none!important;display:none!important}
#anit-dialog-control-dock.--expanded .dialog-control-window,#anit-dialog-control-dock.--pinned .dialog-control-window{opacity:1;pointer-events:auto;transform:none}
#anit-dialog-control-dock.--empty:not(.--manual-height) .dialog-control-window{height:auto!important;min-height:132px;max-height:none!important;overflow:visible}
#anit-dialog-control-dock.anit-dialog-control-mode .dialog-control-window{outline:4px solid #ef4444;outline-offset:-2px}
#anit-dialog-control-dock .dialog-control-header{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;column-gap:14px;row-gap:8px;margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.08)}
#anit-dialog-control-dock .dialog-control-brand{display:flex;align-items:center;gap:10px;min-width:0;overflow:hidden}
#anit-dialog-control-dock .dialog-control-logo{height:22px;width:auto;max-width:120px;filter:invert(1);mix-blend-mode:screen;flex:0 0 auto;display:block}
#anit-dialog-control-dock .dialog-control-logo-fallback{width:20px;height:20px;border-radius:var(--pena-radius);display:inline-flex;align-items:center;justify-content:center;background:#1e2024;color:#fff;font-size:10px;font-weight:800;flex:0 0 20px}
#anit-dialog-control-dock .dialog-control-section{font-size:var(--pena-font-heading);font-weight:700;color:#fff;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#anit-dialog-control-dock .dialog-control-close{width:var(--pena-icon-size);height:var(--pena-icon-size);border:1px solid rgba(255,255,255,.18);border-radius:var(--pena-radius);background:rgba(255,255,255,.04);color:#fff;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;line-height:1;box-sizing:border-box;flex:0 0 var(--pena-icon-size)}
#anit-dialog-control-dock .dialog-control-close svg{width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:2.15;stroke-linecap:round;stroke-linejoin:round;opacity:.94}
#anit-dialog-control-dock .dialog-control-close:hover{border-color:rgba(255,255,255,.34);background:rgba(255,255,255,.08);transform:translateY(-1px)}
#anit-dialog-control-dock .dialog-control-close.--active{border-color:rgba(77,157,255,.58);background:rgba(77,157,255,.16);color:#d7eaff}
#anit-dialog-control-dock .dialog-control-actions{display:flex;align-items:center;justify-content:flex-start;gap:8px;flex:0 0 auto;position:relative;flex-wrap:nowrap;max-width:100%;justify-self:start;margin-left:0;grid-row:2;grid-column:1}
#anit-dialog-control-dock .dialog-control-mode-btn,#anit-dialog-control-dock .dialog-control-folder-add-btn,#anit-dialog-control-dock .dialog-control-clear-btn,#anit-dialog-control-dock .dialog-control-columns-btn{width:var(--pena-icon-size);height:var(--pena-icon-size);border:1px solid rgba(255,255,255,.18);border-radius:var(--pena-radius);background:rgba(255,255,255,.04);color:#fff;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-sizing:border-box;flex:0 0 var(--pena-icon-size);transition:border-color .15s,background .15s,transform .15s}
#anit-dialog-control-dock .dialog-control-mode-btn svg,#anit-dialog-control-dock .dialog-control-folder-add-btn svg,#anit-dialog-control-dock .dialog-control-clear-btn svg,#anit-dialog-control-dock .dialog-control-columns-btn svg{width:12px;height:12px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;opacity:.88;flex:0 0 12px;margin:auto}
#anit-dialog-control-dock .dialog-control-mode-btn:hover,#anit-dialog-control-dock .dialog-control-folder-add-btn:hover,#anit-dialog-control-dock .dialog-control-clear-btn:hover,#anit-dialog-control-dock .dialog-control-columns-btn:hover{border-color:rgba(255,255,255,.34);background:rgba(255,255,255,.08);transform:translateY(-1px)}
#anit-dialog-control-dock .dialog-control-mode-btn.--active{border-color:rgba(255,73,73,.58);background:rgba(255,73,73,.16);color:#ffd6d6}
#anit-dialog-control-dock .dialog-control-columns-btn.--active{border-color:rgba(77,157,255,.5);background:rgba(77,157,255,.12);color:#d6e9ff}
#anit-filters .controls-pop-close{position:absolute;top:8px;right:8px;width:22px;height:22px;border:0;background:transparent;color:rgba(255,255,255,.72);padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;line-height:1;border-radius:var(--pena-radius)}
#anit-filters .controls-pop-close:hover{color:#fff;background:rgba(255,255,255,.08);transform:none}
#anit-dialog-control-dock #anit_dialog_control_overlay{position:absolute;left:0;right:0;bottom:calc(100% + 8px);display:none;z-index:4;pointer-events:none}
#anit-dialog-control-dock.anit-dialog-control-mode #anit_dialog_control_overlay{display:flex}
#anit-dialog-control-dock .anit-control-flag{width:100%;font-size:12px;font-weight:700;color:#ffb3b3;background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(239,68,68,.48);border-radius:var(--pena-radius);padding:8px 12px;box-shadow:0 12px 30px rgba(0,0,0,.38),0 1px 0 rgba(255,255,255,.04) inset;display:inline-flex;align-items:center;justify-content:center;gap:7px;text-align:center;line-height:1.25;box-sizing:border-box}
#anit-dialog-control-dock .anit-control-flag svg{width:13px;height:13px;display:block;flex:0 0 13px;stroke:#ffb3b3}
#anit-dialog-control-dock .dialog-control-confirm{position:absolute;inset:0;z-index:6;display:none;align-items:center;justify-content:center;gap:12px;padding:20px;background:rgba(7,10,15,.82);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);border:0;box-shadow:none;border-radius:var(--pena-radius);box-sizing:border-box;text-align:center}
#anit-dialog-control-dock .dialog-control-confirm.--show{display:flex;flex-direction:column}
#anit-dialog-control-dock .dialog-control-confirm p{margin:0;color:#c8d0dc;font-size:12px;line-height:1.5;max-width:230px;text-align:center}
#anit-dialog-control-dock .dialog-control-confirm .confirm-btns{display:flex;gap:8px;align-items:center;justify-content:center;width:100%}
#anit-dialog-control-dock .dialog-control-confirm button{min-height:28px;padding:5px 14px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.2}
#anit-dialog-control-dock .dialog-control-confirm button.--ok{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.2);color:#fff}
#anit-dialog-control-dock .dialog-control-confirm button.--ok:hover{background:rgba(255,255,255,.12)}
#anit-dialog-control-dock .dialog-control-toast{position:absolute;left:0;right:0;bottom:calc(100% + 8px);z-index:7;opacity:0;pointer-events:none;transform:translateY(6px);transition:opacity .12s ease,transform .12s ease;text-align:center;background:rgba(12,16,24,.98);border:1px solid rgba(255,255,255,.13);color:#d8e0eb;padding:8px 12px;border-radius:var(--pena-radius);font-size:12px;line-height:1.25;box-shadow:0 12px 30px rgba(0,0,0,.38),0 1px 0 rgba(255,255,255,.04) inset;box-sizing:border-box}
#anit-dialog-control-dock .dialog-control-toast.--show{opacity:1;transform:translateY(0)}
#anit-dialog-control-dock .dialog-control-toast.--ok{border-color:rgba(93,200,126,.5);color:#5dc87e}
#anit-dialog-control-dock .dialog-control-toast.--danger{border-color:rgba(239,68,68,.5);color:#ffb3b3}
#anit-dialog-control-dock .dialog-control-list{position:relative;display:grid;grid-template-columns:1fr;align-content:start;gap:6px;min-height:0;flex:1 1 auto;overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.28) rgba(255,255,255,.06);padding-right:6px;padding-bottom:12px}
#anit-dialog-control-dock .dialog-control-drop-line{position:absolute;height:2px;border-radius:999px;background:transparent;box-shadow:none;opacity:0;pointer-events:none;z-index:5;transform:translateY(-50%)}
#anit-dialog-control-dock .dialog-control-drop-line.--show{opacity:1}
#anit-dialog-control-dock .dialog-control-drop-line.--neutral,#anit-dialog-control-dock .dialog-control-drop-line.--folder-start,#anit-dialog-control-dock .dialog-control-drop-line.--folder-end{height:2px;background:#4d9dff;box-shadow:0 0 0 1px rgba(77,157,255,.22),0 0 12px rgba(77,157,255,.36)}
#anit-dialog-control-dock .dialog-control-drop-line.--folder-after,#anit-dialog-control-dock .dialog-control-drop-line.--hierarchy-up{height:3px;background:#f59e0b;box-shadow:0 0 0 1px rgba(245,158,11,.24),0 0 14px rgba(245,158,11,.44);left:8px!important;right:8px!important}
#anit-dialog-control-dock .dialog-control-list::-webkit-scrollbar{width:5px;height:5px}
#anit-dialog-control-dock .dialog-control-list::-webkit-scrollbar-track{background:rgba(255,255,255,.06);border-radius:var(--pena-radius)}
#anit-dialog-control-dock .dialog-control-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:var(--pena-radius)}
#anit-dialog-control-dock .dialog-control-list::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.42)}
#anit-dialog-control-dock.--empty .dialog-control-list{display:flex;align-items:flex-start;overflow:hidden;min-height:38px;flex:0 0 auto}
#anit-dialog-control-dock .dialog-control-empty{display:flex;align-items:center;min-height:38px;color:var(--pena-muted);font-size:var(--pena-font-body);line-height:1.35;padding:0 2px;box-sizing:border-box}
#anit-dialog-control-dock .dialog-control-folder{position:relative;width:100%;min-width:0;min-height:32px;display:grid;grid-template-columns:22px 34px minmax(0,1fr) 22px 22px;align-items:center;column-gap:7px;border:1px solid rgba(255,255,255,.16);border-radius:var(--pena-radius);background:rgba(255,255,255,.055);padding:4px 6px 4px 8px;box-sizing:border-box;color:#e7edf6;cursor:pointer;overflow:visible}
#anit-dialog-control-dock .dialog-control-folder.--empty-folder{grid-template-columns:34px minmax(0,1fr) 22px 22px}
#anit-dialog-control-dock .dialog-control-folder.--colored{border-color:var(--dialog-chip-border);background:linear-gradient(90deg,var(--dialog-chip-bg),rgba(255,255,255,.055) 64%)}
#anit-dialog-control-dock .dialog-control-folder:hover{border-color:rgba(77,157,255,.5);background:rgba(77,157,255,.1)}
#anit-dialog-control-dock .dialog-control-folder.--colored:hover{border-color:var(--dialog-chip-border-hover);background:linear-gradient(90deg,var(--dialog-chip-bg-hover),rgba(77,157,255,.1) 66%)}
#anit-dialog-control-dock .dialog-control-folder.--dragging{opacity:.45}
#anit-dialog-control-dock .dialog-control-folder.--drop-before::before,#anit-dialog-control-dock .dialog-control-folder.--drop-after::after{content:none!important}
#anit-dialog-control-dock .dialog-control-folder.--drop-into{outline:1px dashed rgba(93,200,126,.78);outline-offset:-3px;border-color:rgba(93,200,126,.7);background:rgba(93,200,126,.12)}
#anit-dialog-control-dock .dialog-control-folder-toggle{width:22px;height:22px;min-width:22px;min-height:22px;border:0!important;background:transparent!important;color:#c9d6e8;padding:0;display:inline-grid;place-items:center;box-shadow:none;border-radius:var(--pena-radius);cursor:pointer;line-height:0;box-sizing:border-box}
#anit-dialog-control-dock .dialog-control-folder-toggle:hover{color:#fff;transform:none;border:0!important;background:rgba(255,255,255,.08)!important}
#anit-dialog-control-dock .dialog-control-folder-toggle svg{width:14px;height:14px;display:block;fill:none;stroke:currentColor;stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round;transition:transform .16s ease;transform-origin:50% 50%;transform-box:fill-box}
#anit-dialog-control-dock .dialog-control-folder:not(.--collapsed) .dialog-control-folder-toggle svg{transform:rotate(90deg)}
#anit-dialog-control-dock .dialog-control-folder-state{width:34px;min-width:34px;justify-self:center}
#anit-dialog-control-dock .dialog-control-folder-state .dialog-control-dot{width:18px;min-width:18px;max-width:18px;height:18px;border-radius:5px;padding:0}
#anit-dialog-control-dock .dialog-control-folder-state .dialog-control-dot.--later{width:18px;min-width:18px;max-width:18px;height:18px;border-radius:5px;padding:0}
#anit-dialog-control-dock .dialog-control-folder-state .dialog-control-dot.--later svg{width:12px;height:12px}
#anit-dialog-control-dock .dialog-control-folder-state .dialog-control-count{font-size:9px;line-height:1}
#anit-dialog-control-dock .dialog-control-folder-title{min-width:0;height:22px;border:0!important;background:transparent!important;box-shadow:none!important;color:#e7edf6!important;padding:0!important;font:600 var(--pena-font-body)/22px system-ui,-apple-system,Segoe UI,Roboto,Arial!important;outline:0!important;overflow:hidden;text-overflow:ellipsis}
#anit-dialog-control-dock .dialog-control-folder-title:focus{color:#fff!important}
#anit-dialog-control-dock .dialog-control-folder-color-wrap{position:relative;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;justify-self:end}
#anit-dialog-control-dock .dialog-control-folder-color{width:20px;height:20px;min-height:20px;border:1px solid rgba(255,255,255,.22);border-radius:var(--pena-radius);background:var(--dialog-chip-color,rgba(255,255,255,.08));padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 0 1px rgba(0,0,0,.18) inset}
#anit-dialog-control-dock .dialog-control-folder-color:not([style*="--dialog-chip-color"])::before{content:"";width:9px;height:7px;border:1px solid rgba(255,255,255,.45);border-radius:2px;box-sizing:border-box}
#anit-dialog-control-dock .dialog-control-folder-remove{width:22px;height:22px;min-height:22px;justify-self:end;border:0!important;background:transparent!important;color:rgba(255,150,150,.76);padding:0;display:inline-flex;align-items:center;justify-content:center;box-shadow:none;border-radius:var(--pena-radius);cursor:pointer}
#anit-dialog-control-dock .dialog-control-folder-remove:hover{color:#ffd0d0;transform:none;border:0!important;background:transparent!important}
#anit-dialog-control-dock .dialog-control-folder-remove svg{width:12px;height:12px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#anit-dialog-control-dock .dialog-control-folder-remove svg{fill:currentColor;stroke:none}
#anit-dialog-control-dock .dialog-control-chip{position:relative;width:100%;min-width:0;min-height:32px;display:grid;grid-template-columns:34px minmax(0,1fr) 22px 22px;align-items:center;column-gap:7px;border:1px solid rgba(255,255,255,.14);border-radius:var(--pena-radius);background:rgba(255,255,255,.04);padding:4px 6px 4px 8px;box-sizing:border-box;text-align:left;color:#e7edf6;cursor:pointer;font-size:var(--pena-font-body);overflow:visible}
#anit-dialog-control-dock .dialog-control-chip.--in-folder{grid-template-columns:34px minmax(0,1fr) 22px 22px;margin-left:10px;width:calc(100% - 10px)}
#anit-dialog-control-dock .dialog-control-chip.--colored{border-color:var(--dialog-chip-border);background:linear-gradient(90deg,var(--dialog-chip-bg),rgba(255,255,255,.04) 58%)}
#anit-dialog-control-dock .dialog-control-chip.--colored::before{content:none}
#anit-dialog-control-dock .dialog-control-chip:hover{border-color:rgba(77,157,255,.5);background:rgba(77,157,255,.1);transform:none}
#anit-dialog-control-dock .dialog-control-chip.--colored:hover{border-color:var(--dialog-chip-border-hover);background:linear-gradient(90deg,var(--dialog-chip-bg-hover),rgba(77,157,255,.1) 62%)}
#anit-dialog-control-dock .dialog-control-chip.--current{border-color:rgba(77,157,255,.78);box-shadow:0 0 0 1px rgba(77,157,255,.34) inset}
#anit-dialog-control-dock .dialog-control-chip.--current::after{content:"";position:absolute;inset:-2px;border:1px solid rgba(77,157,255,.38);border-radius:calc(var(--pena-radius) + 2px);pointer-events:none}
#anit-dialog-control-dock .dialog-control-chip.--current.--colored{background:linear-gradient(90deg,var(--dialog-chip-bg),rgba(255,255,255,.04) 62%)}
#anit-dialog-control-dock .dialog-control-chip.--multi-selected{border-color:rgba(77,157,255,.9);background:linear-gradient(90deg,rgba(77,157,255,.24),rgba(255,255,255,.055));box-shadow:0 0 0 1px rgba(77,157,255,.3) inset,0 0 0 1px rgba(77,157,255,.18)}
#anit-dialog-control-dock .dialog-control-chip.--multi-selected.--colored{background:linear-gradient(90deg,var(--dialog-chip-bg),rgba(77,157,255,.16) 62%)}
#anit-dialog-control-dock .dialog-control-chip.--current.--multi-selected{box-shadow:0 0 0 1px rgba(77,157,255,.36) inset,0 0 0 1px rgba(77,157,255,.18)}
#anit-dialog-control-dock .dialog-control-chip[draggable="true"]{cursor:pointer}
#anit-dialog-control-dock .dialog-control-chip.--dragging{opacity:.45;cursor:pointer}
#anit-dialog-control-dock .dialog-control-list.--multi-dragging .dialog-control-chip.--dragging{opacity:.56}
#anit-dialog-control-dock .dialog-control-chip.--drag-origin[data-drag-count]::after{content:attr(data-drag-count);position:absolute;right:-6px;top:-7px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#4d9dff;color:#fff;font-size:10px;font-weight:800;line-height:18px;text-align:center;box-shadow:0 0 0 2px rgba(12,16,24,.96),0 6px 12px rgba(0,0,0,.32);box-sizing:border-box;pointer-events:none}
#anit-dialog-control-dock .dialog-control-chip.--drop-before::before,#anit-dialog-control-dock .dialog-control-chip.--drop-after::after{content:none}
#anit-dialog-control-dock .dialog-control-state{width:34px;min-width:34px;height:22px;display:inline-grid;place-items:center;color:#fff;font-size:10px;font-weight:700;font-variant-numeric:tabular-nums;justify-self:center;line-height:0}
#anit-dialog-control-dock .dialog-control-dot{min-width:18px;height:18px;border-radius:999px;background:rgba(77,157,255,.95);box-shadow:0 0 0 2px rgba(77,157,255,.16);display:inline-grid;place-items:center;box-sizing:border-box;padding:0 5px;line-height:0}
#anit-dialog-control-dock .dialog-control-chip.--mention .dialog-control-dot,#anit-dialog-control-dock .dialog-control-dot.--mention-dot{background:rgba(239,68,68,.95);box-shadow:0 0 0 2px rgba(239,68,68,.2)}
#anit-dialog-control-dock .dialog-control-dot.--later{width:20px;min-width:20px;height:18px;padding:0;background:rgba(239,68,68,.95);box-shadow:0 0 0 2px rgba(239,68,68,.2);color:#fff}
#anit-dialog-control-dock .dialog-control-dot.--later svg{width:12px;height:12px;display:block;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
#anit-dialog-control-dock .dialog-control-dot.--empty{background:transparent;box-shadow:none;border:1px solid rgba(255,255,255,.22);box-sizing:border-box}
#anit-dialog-control-dock .dialog-control-count{display:block;min-width:0;line-height:1;text-align:center;transform:none}
#anit-dialog-control-dock .dialog-control-mention-icon{width:11px;height:11px;display:block;fill:none;stroke:currentColor;stroke-width:2.35;stroke-linecap:round;stroke-linejoin:round}
#anit-dialog-control-dock .dialog-control-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e7edf6;font-size:var(--pena-font-body)}
#anit-dialog-control-dock .dialog-control-color-wrap{position:relative;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;justify-self:end}
#anit-dialog-control-dock .dialog-control-color{width:20px;height:20px;min-height:20px;border:1px solid rgba(255,255,255,.22);border-radius:var(--pena-radius);background:var(--dialog-chip-color,rgba(255,255,255,.08));padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 0 0 1px rgba(0,0,0,.18) inset}
#anit-dialog-control-dock .dialog-control-color:not([style*="--dialog-chip-color"])::before{content:"";width:8px;height:8px;border-radius:50%;border:1px solid rgba(255,255,255,.42);box-sizing:border-box}
#anit-dialog-control-dock .dialog-control-color:hover{border-color:rgba(255,255,255,.55);transform:none}
.dialog-control-palette{position:fixed;z-index:2147483647;width:min(246px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.28) rgba(255,255,255,.06);display:grid;grid-template-columns:28px minmax(0,1fr);grid-auto-rows:min-content;gap:7px;padding:10px 28px 10px 10px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:radial-gradient(circle at 20% 0%,rgba(77,157,255,.12),transparent 42%),linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));box-shadow:0 18px 42px rgba(0,0,0,.46),0 1px 0 rgba(255,255,255,.04) inset;box-sizing:border-box;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-8px) scale(.94);transform-origin:top right;transition:opacity .18s ease,transform .18s ease,visibility 0s linear .18s}
.dialog-control-palette::-webkit-scrollbar{width:5px}
.dialog-control-palette::-webkit-scrollbar-track{background:rgba(255,255,255,.06);border-radius:10px}
.dialog-control-palette::-webkit-scrollbar-thumb{background:rgba(255,255,255,.28);border-radius:10px}
.dialog-control-palette.--open{opacity:1;visibility:visible;pointer-events:auto;transform:translateY(0) scale(1);transition:opacity .18s ease,transform .18s ease,visibility 0s}
.dialog-control-palette.--closing{opacity:0;visibility:visible;pointer-events:none;transform:translateY(-8px) scale(.94)}
.dialog-control-palette.--confirming{overflow:hidden}
.dialog-control-preview{grid-column:1;grid-row:1 / span 2;width:28px;height:auto;min-width:28px;min-height:109px;align-self:stretch;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:var(--dialog-chip-color,#4d9dff);box-shadow:0 0 0 1px rgba(0,0,0,.36) inset;box-sizing:border-box}
.dialog-control-mini-picker{--picker-hue-color:#4d9dff;grid-column:2;grid-row:1;position:relative;width:100%;height:88px;min-height:88px;align-self:start;min-width:0;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(8,12,18,.82);box-shadow:0 0 0 1px rgba(0,0,0,.38) inset;overflow:hidden;cursor:crosshair;touch-action:none;box-sizing:border-box}
.dialog-control-mini-picker::before{content:"";position:absolute;inset:2px;border-radius:6px;background:linear-gradient(0deg,#000,rgba(0,0,0,0)),linear-gradient(90deg,#fff,var(--picker-hue-color));pointer-events:none}
.dialog-control-mini-picker::after{content:none}
.dialog-control-picker-knob{position:absolute;left:50%;top:50%;z-index:1;width:12px;height:12px;border:2px solid #fff;border-radius:50%;background:var(--dialog-chip-color,#4d9dff);box-shadow:0 2px 8px rgba(0,0,0,.55);transform:translate(-50%,-50%);pointer-events:none}
.dialog-control-hue-strip{grid-column:2;grid-row:2;position:relative;height:14px;min-height:14px;border:1px solid rgba(255,255,255,.18);border-radius:999px;background:rgba(8,12,18,.82);box-shadow:0 0 0 1px rgba(0,0,0,.38) inset;cursor:crosshair;touch-action:none;box-sizing:border-box}
.dialog-control-hue-strip::before{content:"";position:absolute;inset:2px;border-radius:999px;background:linear-gradient(90deg,#f04444,#f59e0b 16%,#f5e642 32%,#3bd671 48%,#20c5c7 64%,#4d9dff 78%,#a855f7 90%,#f04444);pointer-events:none}
.dialog-control-hue-knob{position:absolute;left:0;top:50%;z-index:1;width:10px;height:18px;border:2px solid #fff;border-radius:999px;background:transparent;box-shadow:0 2px 8px rgba(0,0,0,.5);transform:translate(-50%,-50%);pointer-events:none;box-sizing:border-box}
.dialog-control-palette-close{position:absolute;right:8px;top:8px;width:16px;height:16px;min-height:16px;border:0;border-radius:0;background:transparent;color:#ff8f8f;padding:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.dialog-control-palette-close:hover{background:transparent;color:#ffd0d0;transform:none}
.dialog-control-palette-close svg{width:10px;height:10px;fill:currentColor}
.dialog-control-swatch.--add{border-color:rgba(77,157,255,.34);background:rgba(77,157,255,.12);color:#d7eaff}
.dialog-control-swatch.--add:hover{border-color:rgba(77,157,255,.62);background:rgba(77,157,255,.2);transform:none}
.dialog-control-swatch.--add svg{width:12px;height:12px;display:block;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
.dialog-control-swatches{grid-column:1 / -1;display:grid;grid-template-columns:repeat(7,20px);grid-auto-rows:20px;gap:6px;align-items:center;justify-content:space-between}
.dialog-control-swatch-wrap{position:relative;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center}
.dialog-control-swatch{position:relative;width:20px;height:20px;min-width:20px;min-height:20px;border:1px solid rgba(255,255,255,.2);border-radius:7px;background:var(--dialog-chip-color);padding:0;margin:0;cursor:pointer;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;line-height:1}
.dialog-control-swatch:hover,.dialog-control-swatch.--active{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.2)}
.dialog-control-swatch.--folder-ref{box-shadow:0 0 0 2px rgba(93,200,126,.45),0 0 0 4px rgba(93,200,126,.16)}
.dialog-control-folder-ref-icon{width:13px;height:13px;display:block;fill:none;stroke:#fff;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));pointer-events:none;transform:translateY(-.5px)}
.dialog-control-swatch.--clear{background:linear-gradient(135deg,rgba(255,255,255,.12) 0 24%,rgba(255,255,255,.03) 24% 50%,rgba(255,255,255,.12) 50% 74%,rgba(255,255,255,.03) 74%);color:rgba(255,255,255,.74)}
.dialog-control-transparent-icon{position:relative;width:12px;height:12px;border:1px solid rgba(255,255,255,.6);border-radius:4px;display:block;box-sizing:border-box;background:repeating-conic-gradient(rgba(255,255,255,.38) 0 25%,transparent 0 50%) 50%/6px 6px}
.dialog-control-transparent-icon::after{content:"";position:absolute;left:-2px;right:-2px;top:50%;height:1px;background:#ff9a9a;transform:rotate(-45deg)}
.dialog-control-swatch-delete{position:absolute;right:-5px;top:-5px;width:14px;height:14px;min-height:14px;border:1px solid rgba(255,255,255,.34);border-radius:50%;background:rgba(10,14,20,.96);color:#ffd0d0;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transform:scale(.82);transition:opacity .12s ease,transform .12s ease;box-shadow:0 4px 10px rgba(0,0,0,.34)}
.dialog-control-swatch-wrap:hover .dialog-control-swatch-delete{opacity:1;transform:scale(1)}
.dialog-control-swatch-delete svg{width:8px;height:8px;fill:currentColor}
.dialog-control-delete-notice{position:absolute;inset:0;z-index:5;display:none;grid-template-columns:1fr;align-items:center;justify-items:center;padding:14px;border:0;border-radius:10px;background:rgba(7,10,15,.9);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);box-sizing:border-box;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.dialog-control-delete-notice.--show{display:grid}
.dialog-control-delete-card{width:100%;min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;text-align:center}
.dialog-control-delete-swatch{width:34px;height:34px;min-width:34px;border:1px solid rgba(255,255,255,.28);border-radius:9px;background:var(--dialog-chip-color,#4d9dff);box-shadow:0 0 0 1px rgba(0,0,0,.4) inset,0 8px 18px rgba(0,0,0,.34);box-sizing:border-box}
.dialog-control-delete-title{color:#fff;font-size:clamp(12px,calc(12px * var(--dock-scale,1)),14px);line-height:1.2;font-weight:800}
.dialog-control-delete-text{max-width:184px;color:#cfd8e6;font-size:clamp(10px,calc(10px * var(--dock-scale,1)),12px);line-height:1.35}
.dialog-control-delete-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:min(100%,178px);margin-top:2px}
.dialog-control-delete-actions button{height:28px;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(255,255,255,.07);color:#eef3fb;font-size:clamp(10px,calc(10px * var(--dock-scale,1)),12px);font-weight:700;padding:0 9px;cursor:pointer}
.dialog-control-delete-actions button:hover{background:rgba(255,255,255,.12)}
.dialog-control-delete-actions button.--danger{border-color:rgba(239,68,68,.48);background:rgba(239,68,68,.16);color:#ffd0d0}
.dialog-control-delete-actions button.--danger:hover{background:rgba(239,68,68,.26)}
#anit-dialog-control-dock .dialog-control-remove{width:22px;height:22px;min-height:22px;justify-self:end;border:0!important;background:transparent!important;color:rgba(255,150,150,.76);padding:0;display:inline-flex;align-items:center;justify-content:center;box-shadow:none;border-radius:var(--pena-radius);cursor:pointer}
#anit-dialog-control-dock .dialog-control-remove:hover{color:#ffd0d0;transform:none;border:0!important;background:transparent!important}
#anit-dialog-control-dock .dialog-control-remove svg{width:12px;height:12px;display:block;fill:currentColor}
#anit-dialog-control-dock.dock-dragging,#anit-dialog-control-dock.dock-dragging .dialog-control-window{cursor:grabbing!important;user-select:none}
#anit-dialog-control-dock.--cols-2 .dialog-control-list{grid-template-columns:repeat(2,minmax(0,1fr))}
#anit-dialog-control-dock.--cols-2 .dialog-control-folder{grid-column:1 / -1;grid-template-columns:18px 22px minmax(0,1fr) 18px 18px;column-gap:5px;padding:4px 5px}
#anit-dialog-control-dock.--cols-2 .dialog-control-folder.--empty-folder{grid-template-columns:22px minmax(0,1fr) 18px 18px}
#anit-dialog-control-dock.--cols-2 .dialog-control-folder-toggle{width:18px;height:22px;min-height:22px}
#anit-dialog-control-dock.--cols-2 .dialog-control-folder-toggle svg{width:13px;height:13px}
#anit-dialog-control-dock.--cols-2 .dialog-control-folder-state{width:22px;min-width:22px;font-size:9px}
#anit-dialog-control-dock.--cols-2 .dialog-control-folder-state .dialog-control-dot{width:18px;min-width:18px;max-width:18px;height:18px;border-radius:5px}
#anit-dialog-control-dock.--cols-2 .dialog-control-folder-color-wrap,#anit-dialog-control-dock.--cols-2 .dialog-control-folder-remove{width:18px;height:22px;min-height:22px}
#anit-dialog-control-dock.--cols-2 .dialog-control-folder-color{width:16px;height:16px;min-height:16px}
#anit-dialog-control-dock.--cols-2 .dialog-control-chip{grid-template-columns:22px minmax(0,1fr) 18px 18px;column-gap:5px;padding:4px 5px}
#anit-dialog-control-dock.--cols-2 .dialog-control-chip.--in-folder{grid-column:1 / -1;grid-template-columns:22px minmax(0,1fr) 18px 18px;margin-left:18px;width:calc(100% - 18px)}
#anit-dialog-control-dock.--cols-2 .dialog-control-state{width:22px;min-width:22px;font-size:9px}
#anit-dialog-control-dock.--cols-2 .dialog-control-dot:not(.--later){min-width:18px;max-width:22px;height:18px;padding:0 3px}
#anit-dialog-control-dock.--cols-2 .dialog-control-mention-icon{width:10px;height:10px}
#anit-dialog-control-dock.--cols-2 .dialog-control-color-wrap{width:18px;height:22px}
#anit-dialog-control-dock.--cols-2 .dialog-control-color{width:16px;height:16px;min-height:16px}
#anit-dialog-control-dock.--cols-2 .dialog-control-remove{width:18px;height:22px;min-height:22px}
@container (max-width:278px){
  #anit-dialog-control-dock .dialog-control-header{grid-template-columns:minmax(0,1fr);row-gap:8px}
  #anit-dialog-control-dock .dialog-control-brand{grid-row:1;grid-column:1}
  #anit-dialog-control-dock .dialog-control-actions{width:auto;justify-self:start;grid-row:2;grid-column:1;margin-left:0}
}
#anit-dialog-control-dock.dock-rz-w,#anit-dialog-control-dock.dock-rz-w *{cursor:w-resize!important}
#anit-dialog-control-dock.dock-rz-s,#anit-dialog-control-dock.dock-rz-s *{cursor:s-resize!important}
#anit-dialog-control-dock.dock-rz-sw,#anit-dialog-control-dock.dock-rz-sw *{cursor:sw-resize!important}
#anit-dialog-control-dock.dock-rz-w,#anit-dialog-control-dock.dock-rz-s,#anit-dialog-control-dock.dock-rz-sw{user-select:none;touch-action:none}
.bx-im-list-recent-item__wrap.anit-dialog-controlled-pulse,.bx-messenger-cl-item.anit-dialog-controlled-pulse{outline:2px solid rgba(239,68,68,.86)!important;outline-offset:-2px}
.bx-im-list-recent-item__wrap.anit-dialog-control-selected,.bx-messenger-cl-item.anit-dialog-control-selected{outline:2px solid rgba(239,68,68,.72)!important;outline-offset:-2px;background:rgba(239,68,68,.1)!important}
html.anit-dialog-control-cursor,html.anit-dialog-control-cursor body,html.anit-dialog-control-cursor body *{cursor:crosshair!important}
html.anit-dialog-control-cursor #anit-filters,html.anit-dialog-control-cursor #anit-filters *{cursor:auto!important}
html.anit-dialog-control-cursor #anit-filters button{cursor:pointer!important}
html.anit-dialog-control-cursor #anit-dialog-control-dock,html.anit-dialog-control-cursor #anit-dialog-control-dock *{cursor:auto!important}
html.anit-dialog-control-cursor #anit-dialog-control-dock button{cursor:pointer!important}
html.anit-dialog-control-cursor .bx-im-list-recent-item__wrap:hover,html.anit-dialog-control-cursor .bx-messenger-cl-item:hover,html.anit-dialog-control-cursor .bx-im-search-result-item:hover,html.anit-dialog-control-cursor .bx-im-search-item:hover,html.anit-dialog-control-cursor .bx-im-dialog-search-result-item:hover,html.anit-dialog-control-cursor .bx-im-list-search-item:hover{cursor:crosshair!important;outline:2px solid rgba(239,68,68,.9)!important;outline-offset:-2px}
/* Тост (уведомления) ? над окном расширения, не внутри */
.anit-preset-toast{position:absolute;bottom:calc(100% + 6px);left:0;right:0;text-align:center;background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(245,158,11,.42);color:#f8c86c;padding:8px 16px;border-radius:var(--pena-radius);font-size:12px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .25s;white-space:normal;box-shadow:0 12px 30px rgba(0,0,0,.38),0 1px 0 rgba(255,255,255,.04) inset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;line-height:1.35}
.anit-preset-toast.--show{opacity:1}
.anit-preset-toast.--ok{border-color:rgba(93,200,126,.5);color:#5dc87e}
.anit-preset-toast.--danger{border-color:rgba(239,68,68,.5);color:#ffb3b3}
/* Версия ? нижний правый угол панели */
#anit-filters .pena-ver-badge{position:sticky;bottom:4px;text-align:right;font-size:9px;color:rgba(255,255,255,.22);pointer-events:none;user-select:none;padding:6px 2px 0;line-height:1;letter-spacing:.2px}
.anit-preset-confirm{position:absolute;inset:0;background:rgba(7,10,15,.82);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);border-radius:var(--pena-radius);display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:2147483646;padding:20px;text-align:center}
.anit-preset-confirm.--show{display:flex}
.anit-preset-confirm p{color:#c8d0dc;font-size:12px;line-height:1.5;margin:0;max-width:230px;text-align:center}
.anit-preset-confirm .confirm-btns{display:flex;gap:8px;align-items:center;justify-content:center;width:100%}
.anit-preset-confirm .confirm-btns button{min-height:28px;padding:5px 14px;border-radius:var(--pena-radius);border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;font-size:11px;cursor:pointer;transition:background .15s;display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.2}
.anit-preset-confirm .confirm-btns button.--ok{background:rgba(245,158,11,.18);border-color:rgba(245,158,11,.5);color:#f59e0b}
.anit-preset-confirm .confirm-btns button.--ok:hover{background:rgba(245,158,11,.32)}
.anit-preset-confirm.--danger .confirm-btns button.--ok{background:rgba(239,68,68,.18);border-color:rgba(239,68,68,.5);color:#ffb3b3}
.anit-preset-confirm.--danger .confirm-btns button.--ok:hover{background:rgba(239,68,68,.3)}
#anit-filters .controls-wrap{position:relative;display:inline-flex;flex:0 0 auto}
#anit-filters .controls-pop{position:absolute;top:0;left:0;z-index:2147483641;width:min(220px,calc(100vw - 24px));padding:42px 14px 14px;background:linear-gradient(180deg,rgba(22,29,40,.98),rgba(12,16,24,.98));border:1px solid rgba(255,255,255,.13);border-radius:var(--pena-radius);box-shadow:0 18px 42px rgba(0,0,0,.46),0 1px 0 rgba(255,255,255,.04) inset;opacity:0;pointer-events:none;transform:translateY(-6px) scale(.96);transform-origin:top right;transition:opacity .18s ease,transform .18s ease;box-sizing:border-box}
#anit-filters .controls-pop.--show{opacity:1;pointer-events:auto;transform:translateY(0) scale(1)}
#anit-filters .controls-pop-title{position:absolute;top:8px;left:14px;right:42px;height:22px;display:flex;align-items:center;font-size:10px;font-weight:700;color:var(--pena-muted);text-transform:uppercase;letter-spacing:.08em;margin:0;line-height:1.2}
#anit-filters .control-row{display:grid;grid-template-columns:minmax(0,1fr) 44px;align-items:center;column-gap:12px;row-gap:8px;margin:0 0 14px}
#anit-filters .control-row:first-child{margin-top:0}
#anit-filters .control-row:last-child{margin-bottom:0}
#anit-filters .control-label{font-size:var(--pena-font-subheading);font-weight:700;color:var(--pena-muted);text-transform:uppercase;letter-spacing:.08em;min-width:0}
#anit-filters .control-value{font-size:var(--pena-font-body);color:#c7d3e4;text-align:right;font-variant-numeric:tabular-nums;justify-self:end;min-width:44px}
#anit-filters .control-row .pena-range{grid-column:1 / -1;justify-self:center;width:100%}
#anit-filters .pena-range{-webkit-appearance:none;appearance:none;height:3px;border-radius:var(--pena-radius);background:rgba(255,255,255,.2);cursor:pointer;outline:none;border:none;padding:0;margin:0;vertical-align:middle;min-width:0;box-sizing:border-box}
#anit-filters .pena-range::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;border-radius:var(--pena-radius);background:#4a90d9;border:2px solid #1d3550;cursor:pointer;transition:background .15s,transform .1s;box-shadow:0 1px 4px rgba(0,0,0,.5)}
#anit-filters .pena-range::-webkit-slider-thumb:hover{background:#6ab0ff;transform:scale(1.18)}
#anit-filters .pena-range::-moz-range-thumb{width:11px;height:11px;border-radius:var(--pena-radius);background:#4a90d9;border:2px solid #1d3550;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.5)}
#anit-filters .pena-range::-moz-range-track{height:3px;border-radius:var(--pena-radius);background:rgba(255,255,255,.2);border:none}
@container (max-width:278px){
  #anit-filters .header{grid-template-columns:minmax(0,1fr);row-gap:8px}
  #anit-filters .brand{justify-content:flex-start;text-align:left;width:100%;max-width:100%;grid-row:1;grid-column:1}
  #anit-filters .header-actions{width:auto;max-width:100%;justify-content:flex-start;justify-self:start;grid-row:2;grid-column:1;gap:8px;margin-left:0;padding-top:0}
  #anit-filters .controls-pop{transform-origin:top left}
  #anit-filters .row{gap:8px}
  #anit-filters label{white-space:normal;line-height:1.3}
  #anit-filters .project-wrap{flex-basis:100%}
  #anit-filters .type-grid{gap:6px}
  #anit-filters .anit-type-chip{flex:0 1 auto}
  #anit-filters .preset-btn{flex:0 1 auto;text-align:center;max-width:100%}
}

/* Locked state: пресет активен, режим отладки не включён */
#anit-filters.preset-locked .kw-tag-chip:not(.is-active){opacity:.22;pointer-events:none}
#anit-filters.preset-locked .kw-tag-chip.is-active{pointer-events:none}
#anit-filters.preset-locked .kw-tag-chip .tag-rm{display:none}
#anit-filters.preset-locked .anit-type-chip:not(.is-selected){opacity:.22;pointer-events:none}
#anit-filters.preset-locked .anit-type-chip.is-selected{pointer-events:none}
#anit-filters.preset-locked .search-field{border-color:rgba(77,157,255,.24);background:rgba(77,157,255,.06)}
#anit-filters.preset-locked #anit_query{pointer-events:auto;opacity:1}
#anit-filters.preset-locked #anit_tag_add_btn,
#anit-filters.preset-locked #anit_itag_add_btn,
#anit-filters.preset-locked #anit_tag_add_input,
#anit-filters.preset-locked #anit_itag_add_input{pointer-events:none;opacity:.2}
#anit-filters.preset-locked .chips,
#anit-filters.preset-locked .type-grid{cursor:default}
</style>
<div class="pane">
  <div class="header">
    <div class="brand">
      ${_PENA_LOGO_URL
        ? `<img src="${_PENA_LOGO_URL}" class="brand-logo" alt="PENA Agency">`
        : `<span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 100 100" width="20" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" rx="18" fill="#1e2024"/><text x="50" y="68" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="46" font-weight="800" fill="#ffffff">PA</text></svg></span>`}
      <div>
        ${!_PENA_LOGO_URL ? `<div class="brand-title">PENA Agency</div>` : ''}
        <div class="brand-sub">${IS_OL_FRAME ? 'Контакт-центр' : (isTasksMode ? 'Чаты задач' : 'Чаты')}</div>
      </div>
    </div>
    <div class="header-actions">
      <div class="controls-wrap">
        <button id="anit_controls_btn" class="icon-btn" type="button" title="Прозрачность">
          <svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h2"/><path d="M10 17h10"/><circle cx="8" cy="17" r="2"/></svg>
        </button>
        <div id="anit_controls_pop" class="controls-pop">
          <div class="controls-pop-title">Настройки панели</div>
          <button type="button" class="controls-pop-close" id="anit_controls_pop_close" title="Закрыть"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg></button>
          <div class="control-row">
            <span class="control-label">Прозрачность</span>
            <span class="control-value" id="anit_opacity_value">100%</span>
            <input type="range" id="anit_opacity_slider" class="pena-range" min="20" max="100" step="1">
          </div>
        </div>
      </div>
      <button id="anit_help_btn" class="icon-btn" type="button" title="Горячие клавиши">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="opacity:.65"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>
      </button>
      <button id="anit_toggle_btn" class="anit-toggle icon-btn" type="button" title="Скрыть/показать (Ctrl+Alt+F)"><svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 5v14"/><path d="m15 9-3 3 3 3"/></svg></button>
    </div>
  </div>
  <div class="anit-preset-confirm" id="anit_preset_confirm"></div>
  <div class="group">
    <div class="group-head">
      <div class="group-title">Пресеты</div>
      <div style="display:flex;gap:4px;align-items:center">
        <span class="debug-badge" id="anit_debug_badge">&#9881; Отладка</span>
        <button type="button" id="anit_preset_debug_btn" class="icon-btn" title="Войти в режим отладки (разблокировать фильтры)">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="fill:#f59e0b"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
        </button>
        <button type="button" id="anit_preset_manage_btn" class="icon-btn" title="Управление пресетами">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="fill:#fff;opacity:.8">
            <path d="M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="presets-row" id="anit_presets_row"></div>
    <div id="anit_preset_manage_panel">
      <div class="pm-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span>Управление пресетами</span>
        <button type="button" id="anit_preset_manage_close" class="pena-fpop-close" title="Закрыть"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg></button>
      </div>
      <div id="anit_preset_list_edit"></div>
      <div class="pm-add-section">
        <div class="pm-add-label">Новый пресет</div>
        <div class="pm-add-row">
        <input type="text" id="anit_preset_new_name" class="pm-add-inp" placeholder="Название..." maxlength="30" autocomplete="off" spellcheck="false">
          <button type="button" id="anit_preset_add_btn" class="pm-add-btn">+ Добавить</button>
        </div>
      </div>
    </div>
  </div>

  <div class="group">
    <div class="group-title">Быстрые фильтры</div>
    <div class="row">
    <label><input type="checkbox" id="anit_unread"> Непрочитанные</label>
    </div>
    ${IS_OL_FRAME ? `<div class="row">
      <label><input type="checkbox" id="anit_wa"> WhatsApp</label>
      <label><input type="checkbox" id="anit_tg"> Telegram</label>
      <label class="muted">Статус:
        <select id="anit_status">
          <option value="any">Любой</option>
          <option value="20">В работе</option>
          <option value="40">Отвеченные</option>
        </select>
      </label>
    </div>` : ``}
  </div>

  ${IS_OL_FRAME ? '' : !isTasksMode ? `
  <div class="group" id="anit_categories_group">
    <div class="group-head">
      <div class="group-title">Категории</div>
      <div style="display:flex;gap:4px;align-items:center">
        <button type="button" id="anit_cat_manage_btn" class="icon-btn" title="Настроить категории">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="fill:#fff;opacity:.8">
            <path d="M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
          </svg>
        </button>
        <button type="button" id="anit_categories_toggle" class="category-toggle" title="Свернуть/развернуть категории"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      </div>
    </div>
    <div class="group-body">
      <div class="row">
        <div class="type-grid" id="anit_types"></div>
      </div>
    </div>
    <div id="anit_cat_manage_panel">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:11px;font-weight:700;opacity:.9">Показывать категории</span>
        <button type="button" id="anit_cat_manage_close" class="pena-fpop-close" title="Закрыть"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg></button>
      </div>
      <div id="anit_cat_vis_list" style="display:flex;flex-wrap:wrap;gap:4px"></div>
      <div id="anit_cat_custom_list" style="margin-top:4px"></div>
    </div>
  </div>
  ` : ''}
  <div class="group">
    <div class="group-title">Поиск</div>
    <div class="row">
      <div class="search-field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a6 6 0 1 0 3.87 10.58l4.27 4.27 1.41-1.41-4.27-4.27A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/></svg>
        <input type="text" id="anit_query" autocomplete="off" autocapitalize="off" spellcheck="false" aria-autocomplete="none" placeholder="Поиск по названию">
      </div>
    </div>
  </div>


  <div class="group" id="anit_kwtags_group">
    <div class="group-title">Теги</div>
    <div id="anit_kwtags_chips" class="chips" style="gap:6px;flex-wrap:wrap"></div>
    <div class="row" style="margin-top:6px;gap:6px;align-items:center">
      <input type="text" id="anit_tag_add_input" autocomplete="off" spellcheck="false" placeholder="Новый тег...">
      <button type="button" id="anit_tag_add_btn">+</button>
    </div>
  </div>

  ${isTasksMode ? `
  <div class="group" id="anit_itags_group">
    <div class="group-title">Теги пересечений</div>
    <div id="anit_itags_chips" class="chips" style="gap:6px;flex-wrap:wrap"></div>
    <div class="row" style="margin-top:6px;gap:6px;align-items:center">
      <input type="text" id="anit_itag_add_input" autocomplete="off" spellcheck="false" placeholder="Новый тег...">
      <button type="button" id="anit_itag_add_btn">+</button>
    </div>
  </div>
  ` : ``}

  <div class="group">
    <div class="group-title">Действия</div>
    <div class="actions">
      <button id="anit_reset" class="btn-secondary" title="Сброс фильтров (Ctrl+Shift+A)">Сброс</button>
      ${!IS_OL_FRAME ? `<button id="anit_prefetch_manual" class="btn-tertiary">Загрузить чаты</button>` : ``}
    </div>
  </div>
  <div class="pena-ver-badge" id="anit_ver_badge"></div>
</div>
<div id="anit_help_popup" class="pena-fpop">
  <div class="pena-fpop-header">
    <span class="pena-fpop-title">Горячие клавиши</span>
    <button type="button" class="pena-fpop-close" id="anit_help_popup_close" title="Закрыть"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg></button>
  </div>
  <table>
    <tr><td><span class="kbd-seq"><span class="kbd">Ctrl</span><span class="kbd-plus">+</span><span class="kbd">Alt</span><span class="kbd-plus">+</span><span class="kbd">F</span></span><br><span class="kbd-seq"><span class="kbd">⌘</span><span class="kbd-plus">+</span><span class="kbd">⌥</span><span class="kbd-plus">+</span><span class="kbd">F</span></span></td><td>Показать / скрыть панель</td></tr>
    <tr><td><span class="kbd-seq"><span class="kbd">Ctrl</span><span class="kbd-plus">+</span><span class="kbd">Shift</span><span class="kbd-plus">+</span><span class="kbd">A</span></span><br><span class="kbd-seq"><span class="kbd">⌘</span><span class="kbd-plus">+</span><span class="kbd">Shift</span><span class="kbd-plus">+</span><span class="kbd">A</span></span></td><td>Сброс всех фильтров</td></tr>
    <tr><td><span class="kbd-seq"><span class="kbd">Ctrl</span><span class="kbd-plus">+</span><span class="kbd">1</span><span class="kbd-plus">…</span><span class="kbd">9</span></span><br><span class="kbd-seq"><span class="kbd">⌘</span><span class="kbd-plus">+</span><span class="kbd">1</span><span class="kbd-plus">…</span><span class="kbd">9</span></span></td><td>Быстрый выбор пресета</td></tr>
  </table>
</div>
<div class="anit-preset-toast" id="anit_preset_toast"></div>
<div id="anit_debug_overlay"><span class="anit-debug-flag"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.06A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.06A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.06A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.06A1.7 1.7 0 0 0 19.4 15Z"/></svg><span>Режим отладки</span></span></div>
<div id="anit_mini_toggle" class="mini-toggle" title="Показать панель (Ctrl+Alt+F)">
  <svg viewBox="0 0 402.577 402.577" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <path d="M400.858,11.427c-3.241-7.421-8.85-11.132-16.854-11.136H18.564c-7.993,0-13.61,3.715-16.846,11.136 c-3.234,7.801-1.903,14.467,3.999,19.985l140.757,140.753v138.755c0,4.955,1.809,9.232,5.424,12.854l73.085,73.083 c3.429,3.614,7.71,5.428,12.851,5.428c2.282,0,4.66-0.479,7.135-1.43c7.426-3.238,11.14-8.851,11.14-16.845V172.166L396.861,31.413 C402.765,25.895,404.093,19.231,400.858,11.427z"/>
  </svg>
</div>`;
	document.body.appendChild(host);
	filtersHost = host;
	host.dataset.mode = _currentPanelMode;
	host.querySelectorAll('input[type="text"]').forEach(inp => {
		inp.setAttribute('autocomplete', 'off');
		inp.setAttribute('spellcheck', 'false');
		if (!inp.hasAttribute('autocapitalize')) inp.setAttribute('autocapitalize', 'off');
	});
	// Перемещаем плавающие панели из .pane в host (position:absolute, не обрезаются .pane)
	['#anit_preset_manage_panel','#anit_cat_manage_panel','#anit_controls_pop'].forEach(sel => {
		const el = host.querySelector(sel);
		if (el) host.appendChild(el);
	});
	// Apply saved opacity immediately ? prevents flicker on tab switch
	try {
		const _initOp = parseInt(localStorage.getItem('pena.panel.opacity') || '100', 10);
		_applyLinkedPanelOpacity(isNaN(_initOp) ? 100 : _initOp, false);
	} catch {}
	renderPresetsUI(host);
	_renderDialogControlPanel(host);
	_startDialogControlLiveRefresh(host);
	_updateDialogControlUI(host);


		function getProjectsSafe() {
			const p = window.__anitProjectLookup?.projects;
			return Array.isArray(p) ? p : null;
		}

		function getUsedProjectIndexes() {
			const chatToProject = window.__anitProjectLookup?.chatToProject;
			const map = chatToProject instanceof Map ? chatToProject : new Map(chatToProject || []);
			const used = new Set();
			for (const idx of map.values()) {
				const n = Number(idx);
				if (Number.isFinite(n) && n >= 0) used.add(n);
			}
			return used;
		}

		function getSelectedProjectIndexes() {
			const arr = Array.isArray(filters.projectIndexes) ? filters.projectIndexes : [];
			return arr.filter(n => Number.isFinite(n));
		}

		function setSelectedProjectIndex(v) {
			if (v === '' || v === null || v === undefined) {
				filters.projectIndexes = [];
				return;
			}
			const n = parseInt(String(v), 10);
			filters.projectIndexes = Number.isFinite(n) ? [n] : [];
		}

		function getProjectLabelByIndex(idx) {
			if (idx === -1) return 'Без проекта';
			const projects = getProjectsSafe();
			if (!projects) return '';
			const p = projects[idx];
			return (p && p[1]) ? String(p[1]) : '';
		}

		function syncProjectInputFromFilters() {
			const inp = host.querySelector('#anit_project_input');
			if (!inp) return;
			const chosen = getSelectedProjectIndexes();
			if (!chosen.length) { inp.value = ''; return; }
			inp.value = getProjectLabelByIndex(chosen[0]) || '';
		}

		function closeProjectSuggest() {
			const box = host.querySelector('#anit_project_suggest');
			if (box) box.style.display = 'none';
		}

		function renderProjectSuggest(qRaw = '') {
			const box = host.querySelector('#anit_project_suggest');
			if (!box) return;
			const projects = getProjectsSafe();
			const usedIndexes = getUsedProjectIndexes();
			const q = String(qRaw || '').trim().toLowerCase();
			let hasNoProjectTasks = false;
			if (projects) {
				for (let i = 0; i < projects.length; i++) {
					const p = projects[i];
					const name = (p && p[1]) ? String(p[1]) : '';
					if (name.trim().toLowerCase() === 'без проекта' && usedIndexes.has(i)) {
						hasNoProjectTasks = true;
						break;
					}
				}
			}

			const items = [];
			if (!q || 'все'.includes(q)) items.push({ idx: '', label: 'Все проекты' });
			if (hasNoProjectTasks && (!q || 'без проекта'.includes(q) || 'без'.includes(q))) {
				items.push({ idx: -1, label: 'Без проекта' });
			}
			if (projects) {
				for (let i = 0; i < projects.length; i++) {
					// Показываем только проекты, у которых есть задачи (есть связи в dmap)
					if (!usedIndexes.has(i)) continue;
					const p = projects[i];
					const name = (p && p[1]) ? String(p[1]) : '';
					if (!name) continue;
					// "Без проекта" показываем только один раз (как системный вариант idx=-1)
					if (name.trim().toLowerCase() === 'без проекта') continue;
					if (q && !name.toLowerCase().includes(q)) continue;
					items.push({ idx: i, label: name });
				}
			}

			box.innerHTML = '';
			if (!items.length) {
				box.innerHTML = '<div class="muted">Ничего не найдено</div>';
				box.style.display = 'block';
				return;
			}

			for (const it of items.slice(0, 100)) {
				const row = document.createElement('button');
				row.type = 'button';
				row.textContent = it.label;
				row.style.display = 'block';
				row.style.width = '100%';
				row.style.textAlign = 'left';
				row.style.margin = '2px 0';
				row.style.padding = '6px 8px';
				row.addEventListener('click', (e) => {
					e.preventDefault();
					setSelectedProjectIndex(it.idx);
					syncProjectInputFromFilters();
					closeProjectSuggest();
					persistFilters();
					applyFilters();
				});
				box.appendChild(row);
			}
			box.style.display = 'block';
		}

		function getUsersSafe() {
			const u = window.__anitProjectLookup?.users;
			return Array.isArray(u) ? u : null;
		}

		function getUsedResponsibleIndexes() {
			const chatToResponsible = window.__anitProjectLookup?.chatToResponsible;
			const map = chatToResponsible instanceof Map ? chatToResponsible : new Map(chatToResponsible || []);
			const used = new Set();
			for (const idx of map.values()) {
				const n = Number(idx);
				if (Number.isFinite(n) && n >= 0) used.add(n);
			}
			return used;
		}

		function getSelectedResponsibleIndexes() {
			const arr = Array.isArray(filters.responsibleIndexes) ? filters.responsibleIndexes : [];
			return arr.filter(n => Number.isFinite(n));
		}

		function setSelectedResponsibleIndex(v) {
			if (v === '' || v === null || v === undefined) {
				filters.responsibleIndexes = [];
				return;
			}
			const n = parseInt(String(v), 10);
			filters.responsibleIndexes = Number.isFinite(n) ? [n] : [];
		}

		function getResponsibleLabelByIndex(idx) {
			const users = getUsersSafe();
			if (!users) return '';
			const u = users[idx];
			return (u && u[1]) ? String(u[1]) : '';
		}

		function syncResponsibleInputFromFilters() {
			const inp = host.querySelector('#anit_responsible_input');
			if (!inp) return;
			const chosen = getSelectedResponsibleIndexes();
			if (!chosen.length) { inp.value = ''; return; }
			inp.value = getResponsibleLabelByIndex(chosen[0]) || '';
		}

		function closeResponsibleSuggest() {
			const box = host.querySelector('#anit_responsible_suggest');
			if (box) box.style.display = 'none';
		}

		function renderResponsibleSuggest(qRaw = '') {
			const box = host.querySelector('#anit_responsible_suggest');
			if (!box) return;
			const users = getUsersSafe();
			const usedIndexes = getUsedResponsibleIndexes();
			const q = String(qRaw || '').trim().toLowerCase();

			let noIdx = -1;
			let hasNoResponsible = false;
			if (users) {
				for (let i = 0; i < users.length; i++) {
					const u = users[i];
					const uid = (u && u[0]) ? Number(u[0]) : 0;
					if (uid === 0) { noIdx = i; break; }
				}
				if (noIdx >= 0 && usedIndexes.has(noIdx)) hasNoResponsible = true;
			}

			const items = [];
			if (!q || 'все'.includes(q)) items.push({ idx: '', label: 'Все исполнители' });
			if (hasNoResponsible && (!q || 'без исполнителя'.includes(q) || 'без'.includes(q))) {
				items.push({ idx: noIdx, label: 'Без исполнителя' });
			}
			if (users) {
				for (let i = 0; i < users.length; i++) {
					if (!usedIndexes.has(i)) continue;
					const u = users[i];
					const uid = (u && u[0]) ? Number(u[0]) : 0;
					const label = (u && u[1]) ? String(u[1]) : '';
					if (!label) continue;
					if (uid === 0) continue; // "Без исполнителя" выводим отРТ‘ельной системной строкой
					if (q && !label.toLowerCase().includes(q)) continue;
					items.push({ idx: i, label });
				}
			}

			box.innerHTML = '';
			if (!items.length) {
				box.innerHTML = '<div class="muted">Ничего не найдено</div>';
				box.style.display = 'block';
				return;
			}

			for (const it of items.slice(0, 100)) {
				const row = document.createElement('button');
				row.type = 'button';
				row.textContent = it.label;
				row.style.display = 'block';
				row.style.width = '100%';
				row.style.textAlign = 'left';
				row.style.margin = '2px 0';
				row.style.padding = '6px 8px';
				row.addEventListener('click', (e) => {
					e.preventDefault();
					setSelectedResponsibleIndex(it.idx);
					syncResponsibleInputFromFilters();
					closeResponsibleSuggest();
					persistFilters();
					applyFilters();
				});
				box.appendChild(row);
			}
			box.style.display = 'block';
		}

		function closeHiddenProjectSuggest() {
			const box = host.querySelector('#anit_hidden_project_suggest');
			if (box) box.style.display = 'none';
		}
		function closeHiddenResponsibleSuggest() {
			const box = host.querySelector('#anit_hidden_responsible_suggest');
			if (box) box.style.display = 'none';
		}
		function refreshHiddenChips(h) { /* чипсы убраны, оставлено для совместимости вызовов */ }
		function updateHiddenCounts(h) {
			const root = h || host;
			const projEl = root.querySelector('#anit_hidden_projects_count');
			const respEl = root.querySelector('#anit_hidden_responsibles_count');
			if (projEl) {
				const n = Array.isArray(filters.hiddenProjectIndexes) ? filters.hiddenProjectIndexes.length : 0;
				projEl.textContent = n > 0 ? '(' + n + ')' : '';
			}
			if (respEl) {
				const n = Array.isArray(filters.hiddenResponsibleIndexes) ? filters.hiddenResponsibleIndexes.length : 0;
				respEl.textContent = n > 0 ? '(' + n + ')' : '';
			}
		}
		function renderHiddenProjectSuggest(qRaw) {
			const box = host.querySelector('#anit_hidden_project_suggest');
			if (!box) return;
			const projects = getProjectsSafe();
			const usedIndexes = getUsedProjectIndexes();
			const hiddenSet = new Set(Array.isArray(filters.hiddenProjectIndexes) ? filters.hiddenProjectIndexes : []);
			const q = String(qRaw || '').trim().toLowerCase();
			let hasNoProjectTasks = false;
			if (projects) {
				for (let i = 0; i < projects.length; i++) {
					const p = projects[i];
					const name = (p && p[1]) ? String(p[1]) : '';
					if (name.trim().toLowerCase() === 'без проекта' && usedIndexes.has(i)) { hasNoProjectTasks = true; break; }
				}
			}
			const items = [];
			if (hasNoProjectTasks && (!q || 'без проекта'.includes(q) || 'без'.includes(q))) items.push({ idx: -1, label: 'Без проекта' });
			if (projects) {
				for (let i = 0; i < projects.length; i++) {
					if (!usedIndexes.has(i)) continue;
					const p = projects[i];
					const name = (p && p[1]) ? String(p[1]) : '';
					if (!name || name.trim().toLowerCase() === 'без проекта') continue;
					if (q && !name.toLowerCase().includes(q)) continue;
					items.push({ idx: i, label: name });
				}
			}
			box.innerHTML = '';
			if (!items.length) {
				box.innerHTML = '<div class="muted">Нет проектов</div>';
				box.style.display = 'block';
				return;
			}
			for (const it of items.slice(0, 100)) {
				const row = document.createElement('label');
				row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:2px 0;padding:6px 8px;cursor:pointer;color:#dce4ef';
				const cb = document.createElement('input');
				cb.type = 'checkbox';
				cb.checked = hiddenSet.has(it.idx);
				cb.style.accentColor = '#5dc';
				const span = document.createElement('span');
				span.textContent = it.label;
				row.appendChild(cb);
				row.appendChild(span);
				const toggle = () => {
					if (!filters.hiddenProjectIndexes) filters.hiddenProjectIndexes = [];
					const arr = filters.hiddenProjectIndexes;
					const i = arr.indexOf(it.idx);
					if (i >= 0) arr.splice(i, 1);
					else arr.push(it.idx);
					persistFilters();
					applyFilters();
					updateHiddenCounts(host);
					renderHiddenProjectSuggest(host.querySelector('#anit_hidden_project_input')?.value || '');
				};
				cb.addEventListener('change', toggle);
				row.addEventListener('click', (e) => { if (e.target !== cb) { e.preventDefault(); toggle(); } });
				box.appendChild(row);
			}
			box.style.display = 'block';
		}
		function renderHiddenResponsibleSuggest(qRaw) {
			const box = host.querySelector('#anit_hidden_responsible_suggest');
			if (!box) return;
			const users = getUsersSafe();
			const usedIndexes = getUsedResponsibleIndexes();
			const hiddenSet = new Set(Array.isArray(filters.hiddenResponsibleIndexes) ? filters.hiddenResponsibleIndexes : []);
			const q = String(qRaw || '').trim().toLowerCase();
			let noIdx = -1, hasNoResponsible = false;
			if (users) {
				for (let i = 0; i < users.length; i++) {
					const u = users[i];
					if ((u && u[0]) === 0) { noIdx = i; break; }
				}
				if (noIdx >= 0 && usedIndexes.has(noIdx)) hasNoResponsible = true;
			}
			const items = [];
			if (hasNoResponsible && (!q || 'без исполнителя'.includes(q) || 'без'.includes(q))) items.push({ idx: noIdx, label: 'Без исполнителя' });
			if (users) {
				for (let i = 0; i < users.length; i++) {
					if (!usedIndexes.has(i)) continue;
					const u = users[i];
					if ((u && u[0]) === 0) continue;
					const label = (u && u[1]) ? String(u[1]) : '';
					if (!label) continue;
					if (q && !label.toLowerCase().includes(q)) continue;
					items.push({ idx: i, label });
				}
			}
			box.innerHTML = '';
			if (!items.length) {
				box.innerHTML = '<div class="muted">Нет исполнителей</div>';
				box.style.display = 'block';
				return;
			}
			for (const it of items.slice(0, 100)) {
				const row = document.createElement('label');
				row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:2px 0;padding:6px 8px;cursor:pointer;color:#dce4ef';
				const cb = document.createElement('input');
				cb.type = 'checkbox';
				cb.checked = hiddenSet.has(it.idx);
				cb.style.accentColor = '#5dc';
				const span = document.createElement('span');
				span.textContent = it.label;
				row.appendChild(cb);
				row.appendChild(span);
				const toggle = () => {
					if (!filters.hiddenResponsibleIndexes) filters.hiddenResponsibleIndexes = [];
					const arr = filters.hiddenResponsibleIndexes;
					const i = arr.indexOf(it.idx);
					if (i >= 0) arr.splice(i, 1);
					else arr.push(it.idx);
					persistFilters();
					applyFilters();
					updateHiddenCounts(host);
					renderHiddenResponsibleSuggest(host.querySelector('#anit_hidden_responsible_input')?.value || '');
				};
				cb.addEventListener('change', toggle);
				row.addEventListener('click', (e) => { if (e.target !== cb) { e.preventDefault(); toggle(); } });
				box.appendChild(row);
			}
			box.style.display = 'block';
		}

		function getStatusesSafe() {
			const s = window.__anitProjectLookup?.statuses;
			return Array.isArray(s) ? s : null;
		}

		function getUsedStatusIndexes() {
			const chatToStatus = window.__anitProjectLookup?.chatToStatus;
			const map = chatToStatus instanceof Map ? chatToStatus : new Map(chatToStatus || []);
			const used = new Set();
			for (const idx of map.values()) {
				const n = Number(idx);
				if (Number.isFinite(n) && n >= 0) used.add(n);
			}
			return used;
		}

		function getSelectedStatusIndexes() {
			const arr = Array.isArray(filters.statusIndexes) ? filters.statusIndexes : [];
			return arr.filter(n => Number.isFinite(n));
		}

		function setSelectedStatusIndex(v) {
			if (v === '' || v === null || v === undefined) {
				filters.statusIndexes = [];
				return;
			}
			const n = parseInt(String(v), 10);
			filters.statusIndexes = Number.isFinite(n) ? [n] : [];
		}

		function getStatusLabelByIndex(idx) {
			const statuses = getStatusesSafe();
			if (!statuses) return '';
			const st = statuses[idx];
			return (st && st[1]) ? String(st[1]) : '';
		}

		function syncStatusInputFromFilters() {
			const inp = host.querySelector('#anit_status_input');
			if (!inp) return;
			const chosen = getSelectedStatusIndexes();
			if (!chosen.length) { inp.value = ''; return; }
			inp.value = getStatusLabelByIndex(chosen[0]) || '';
		}

		function closeStatusSuggest() {
			const box = host.querySelector('#anit_status_suggest');
			if (box) box.style.display = 'none';
		}

		function renderStatusSuggest(qRaw = '') {
			const box = host.querySelector('#anit_status_suggest');
			if (!box) return;
			const statuses = getStatusesSafe();
			const usedIndexes = getUsedStatusIndexes();
			const q = String(qRaw || '').trim().toLowerCase();

			let noIdx = -1;
			let hasNoStatus = false;
			if (statuses) {
				for (let i = 0; i < statuses.length; i++) {
					const st = statuses[i];
					const sid = (st && st[0]) ? Number(st[0]) : 0;
					if (sid === 0) { noIdx = i; break; }
				}
				if (noIdx >= 0 && usedIndexes.has(noIdx)) hasNoStatus = true;
			}

			const items = [];
			if (!q || 'все'.includes(q)) items.push({ idx: '', label: 'Все статусы' });
			if (hasNoStatus && (!q || 'без статуса'.includes(q) || 'без'.includes(q))) {
				items.push({ idx: noIdx, label: 'Без статуса' });
			}
			if (statuses) {
				for (let i = 0; i < statuses.length; i++) {
					if (!usedIndexes.has(i)) continue;
					const st = statuses[i];
					const sid = (st && st[0]) ? Number(st[0]) : 0;
					const label = (st && st[1]) ? String(st[1]) : '';
					if (!label) continue;
					if (sid === 0) continue;
					if (q && !label.toLowerCase().includes(q)) continue;
					items.push({ idx: i, label });
				}
			}

			box.innerHTML = '';
			if (!items.length) {
				box.innerHTML = '<div class="muted">Ничего не найдено</div>';
				box.style.display = 'block';
				return;
			}

			for (const it of items.slice(0, 100)) {
				const row = document.createElement('button');
				row.type = 'button';
				row.textContent = it.label;
				row.style.display = 'block';
				row.style.width = '100%';
				row.style.textAlign = 'left';
				row.style.margin = '2px 0';
				row.style.padding = '6px 8px';
				row.addEventListener('click', (e) => {
					e.preventDefault();
					setSelectedStatusIndex(it.idx);
					syncStatusInputFromFilters();
					closeStatusSuggest();
					persistFilters();
					applyFilters();
				});
				box.appendChild(row);
			}
			box.style.display = 'block';
		}

		(function initProjectPicker() {
			const row = host.querySelector('#anit_projects_row');
			if (!row) return;


			if (!isTasksChatsModeNow()) {
				row.style.display = 'none';
				return;
			}

			// По умолчанию фильтр проекта всегда пустой
			if (Array.isArray(filters.projectIndexes) && filters.projectIndexes.length) {
				filters.projectIndexes = [];
				persistFilters();
			}

			row.style.display = 'flex';
			syncProjectInputFromFilters();
			const inp = host.querySelector('#anit_project_input');
			const wrap = inp?.parentElement;
			if (inp) {
				inp.addEventListener('focus', () => renderProjectSuggest(inp.value || ''));
				inp.addEventListener('input', () => {
					// живой поиск: подстраиваем список снизу
					renderProjectSuggest(inp.value || '');
					const v = String(inp.value || '').trim();
					if (v === '') {
						setSelectedProjectIndex('');
						persistFilters();
						applyFilters();
					}
				});
				inp.addEventListener('keydown', (e) => {
					if (e.key === 'Escape') closeProjectSuggest();
				});
			}
			document.addEventListener('mousedown', (e) => {
				if (wrap && !wrap.contains(e.target)) closeProjectSuggest();
				const rInp = host.querySelector('#anit_responsible_input');
				const rWrap = rInp?.parentElement;
				if (rWrap && !rWrap.contains(e.target)) closeResponsibleSuggest();
				const sWrap = host.querySelector('#anit_status_row')?.querySelector('.project-wrap');
				if (sWrap && !sWrap.contains(e.target)) closeStatusSuggest();
				const projectSuggestBox = host.querySelector('#anit_hidden_project_suggest');
				const responsibleSuggestBox = host.querySelector('#anit_hidden_responsible_suggest');
				if (projectSuggestBox && !projectSuggestBox.contains(e.target)) closeHiddenProjectSuggest();
				if (responsibleSuggestBox && !responsibleSuggestBox.contains(e.target)) closeHiddenResponsibleSuggest();
			}, true);
		})();

		(function initResponsiblePicker() {
			const row = host.querySelector('#anit_responsibles_row');
			if (!row) return;


			if (!isTasksChatsModeNow()) {
				row.style.display = 'none';
				return;
			}


			if (Array.isArray(filters.responsibleIndexes) && filters.responsibleIndexes.length) {
				filters.responsibleIndexes = [];
				persistFilters();
			}

			row.style.display = 'flex';
			syncResponsibleInputFromFilters();
			const inp = host.querySelector('#anit_responsible_input');
			if (inp) {
				inp.addEventListener('focus', () => renderResponsibleSuggest(inp.value || ''));
				inp.addEventListener('input', () => {
					// живой поиск: подстраиваем список снизу
					renderResponsibleSuggest(inp.value || '');
					const v = String(inp.value || '').trim();
					if (v === '') {
						setSelectedResponsibleIndex('');
						persistFilters();
						applyFilters();
					}
				});
				inp.addEventListener('keydown', (e) => {
					if (e.key === 'Escape') closeResponsibleSuggest();
				});
			}
		})();

		(function initStatusPicker() {
			const row = host.querySelector('#anit_status_row');
			if (!row) return;
			if (!isTasksChatsModeNow()) {
				row.style.display = 'none';
				return;
			}
			const hasStatuses = Array.isArray(window.__anitProjectLookup?.statuses) && window.__anitProjectLookup.statuses.length > 0;
			if (!hasStatuses) {
				row.style.display = 'none';
				return;
			}
			if (Array.isArray(filters.statusIndexes) && filters.statusIndexes.length) {
				filters.statusIndexes = [];
				persistFilters();
			}
			row.style.display = 'flex';
			syncStatusInputFromFilters();
			const inp = host.querySelector('#anit_status_input');
			if (inp) {
				inp.addEventListener('focus', () => renderStatusSuggest(inp.value || ''));
				inp.addEventListener('input', () => {
					renderStatusSuggest(inp.value || '');
					const v = String(inp.value || '').trim();
					if (v === '') {
						setSelectedStatusIndex('');
						persistFilters();
						applyFilters();
					}
				});
				inp.addEventListener('keydown', (e) => {
					if (e.key === 'Escape') closeStatusSuggest();
				});
			}
		})();

		(function initHiddenSection() {
			const hiddenGroup = host.querySelector('#anit_hidden_group');
			if (!hiddenGroup) return;
			refreshHiddenChips(host);
			updateHiddenCounts(host);
			const hpInp = host.querySelector('#anit_hidden_project_input');
			if (hpInp) {
				hpInp.addEventListener('focus', () => renderHiddenProjectSuggest(hpInp.value || ''));
				hpInp.addEventListener('input', () => renderHiddenProjectSuggest(hpInp.value || ''));
				hpInp.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHiddenProjectSuggest(); });
			}
			const hrInp = host.querySelector('#anit_hidden_responsible_input');
			if (hrInp) {
				hrInp.addEventListener('focus', () => renderHiddenResponsibleSuggest(hrInp.value || ''));
				hrInp.addEventListener('input', () => renderHiddenResponsibleSuggest(hrInp.value || ''));
				hrInp.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHiddenResponsibleSuggest(); });
			}
		})();

		const HIDE_LS_KEY = 'anit.filters.hidden';
		let hideFinalizeTimer = null;
		function setHidden(hidden) {
			if (hidden) _rememberExpandedFiltersPaneMetrics(host);
			_clearDialogDockHostHiddenState();
			const dockSnapshot = _dialogControlDock ? {
				left: _dialogControlDock.style.left,
				top: _dialogControlDock.style.top,
				width: _dialogControlDock.style.width,
				height: _dialogControlDock.style.height
			} : null;
			if (hideFinalizeTimer) {
				clearTimeout(hideFinalizeTimer);
				hideFinalizeTimer = null;
			}
			if (hidden) {
				host.classList.add('anit-hidden', 'anit-hidden-final');
			} else {
				host.classList.remove('anit-hidden-final');
				requestAnimationFrame(() => host.classList.remove('anit-hidden'));
			}
			const mini = host.querySelector('#anit_mini_toggle');
			const full = host.querySelector('#anit_toggle_btn');
			if (mini) mini.title = hidden ? 'Показать панель (Ctrl+Alt+F)' : 'Скрыть панель (Ctrl+Alt+F)';
			if (full) full.innerHTML = hidden
			? '<svg viewBox="0 0 24 24" style="width:14px;height:14px;display:block;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 5v14"/><path d="m13 9 3 3-3 3"/></svg>'
			: '<svg viewBox="0 0 24 24" style="width:14px;height:14px;display:block;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 5v14"/><path d="m15 9-3 3 3 3"/></svg>';
			try { localStorage.setItem(HIDE_LS_KEY, hidden ? '1' : '0'); } catch {}
			if (hidden && dockSnapshot && _dialogControlDock) {
				_dialogControlDock.style.left = dockSnapshot.left;
				_dialogControlDock.style.top = dockSnapshot.top;
				_dialogControlDock.style.width = dockSnapshot.width;
				_dialogControlDock.style.height = dockSnapshot.height;
				_fitDialogDockHeight(false);
			}
		}
		_setFiltersPanelHidden = setHidden;
		function togglePanel() {
			const nowHidden = host.classList.contains('anit-hidden');
			_setLinkedPanelsHidden(!nowHidden);
		}


		try { setHidden(false); } catch {} // всегда разворачиваем при загрузке


		host.querySelector('#anit_toggle_btn')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const ts = Number(host.dataset.lastDragTs || 0);
			if (ts && (Date.now() - ts) < 250) return;
			togglePanel();
		});
		host.querySelector('#anit_mini_toggle')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const ts = Number(host.dataset.lastDragTs || 0);
			if (ts && (Date.now() - ts) < 250) return;
			togglePanel();
		});

	// Версия в нижнем правом углу
	const _verBadge = host.querySelector('#anit_ver_badge');
	if (_verBadge) _verBadge.textContent = 'v7.1.20';

	// Очистка устарев?их ключей localStorage
	['pena.update.info','pena.last_seen_ver','anit.filters.v2',
	 'pena.injected_cache','pena.injected_ver','anit_update_info',
	 'pena.update_pending','anit.opt.collapseHidden','anit.opt.collapseCategories'
	].forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });

	// --- Help popup (горячие клавиши) ---
	const _helpBtn = host.querySelector('#anit_help_btn');
	const _helpPop = host.querySelector('#anit_help_popup');
	let _helpDismissTimer = null;
	function _positionFpop(popup, anchorBtn) {
		const hr = host.getBoundingClientRect(); // позиция панели в viewport
		const br = anchorBtn.getBoundingClientRect(); // позиция кнопки в viewport
		const hostScale = parseFloat(host.dataset.panelScale || '1') || 1;
		const pw = (popup.offsetWidth  || 220) * hostScale;
		const ph = (popup.offsetHeight || 150) * hostScale;
		// Желаемая позиция в viewport: под кнопкой, выравнивание по правому краю
		let vl = br.right - pw;
		let vt = br.bottom + 6;
		if (vl < 6) vl = br.left;
		if (vl + pw > window.innerWidth  - 6) vl = window.innerWidth  - pw - 6;
		if (vt + ph > window.innerHeight - 6) vt = br.top - ph - 6;
		// Переводим в координаты относительно host (position:absolute)
		popup.style.left = ((vl - hr.left) / hostScale) + 'px';
		popup.style.top  = ((vt - hr.top) / hostScale)  + 'px';
	}
	if (_helpBtn && _helpPop) {
		_helpBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const isShown = _helpPop.classList.contains('--show');
			if (isShown) { _helpPop.classList.remove('--show'); return; }
			_helpPop.classList.add('--show');
			requestAnimationFrame(() => _positionFpop(_helpPop, _helpBtn));
		});
		_helpPop.querySelector('#anit_help_popup_close')?.addEventListener('click', () => _helpPop.classList.remove('--show'));
		_helpPop.addEventListener('mouseenter', () => { if (_helpDismissTimer) { clearTimeout(_helpDismissTimer); _helpDismissTimer = null; } });
		_helpPop.addEventListener('mouseleave', () => { _helpDismissTimer = setTimeout(() => _helpPop.classList.remove('--show'), 2000); });
		_helpBtn.addEventListener('mouseleave', () => {
			if (!_helpPop.classList.contains('--show')) return;
			_helpDismissTimer = setTimeout(() => _helpPop.classList.remove('--show'), 2000);
		});
		_helpBtn.addEventListener('mouseenter', () => { if (_helpDismissTimer) { clearTimeout(_helpDismissTimer); _helpDismissTimer = null; } });
		document.addEventListener('click', (e) => {
			if (!_helpPop.classList.contains('--show')) return;
			if (!_helpPop.contains(e.target) && e.target !== _helpBtn) _helpPop.classList.remove('--show');
		}, true);
	}

	const controlsBtn = host.querySelector('#anit_controls_btn');
	const controlsPop = host.querySelector('#anit_controls_pop');
	let controlsDismissTimer = null;
	if (controlsBtn && controlsPop) {
		const clearControlsDismiss = () => {
			if (controlsDismissTimer) {
				clearTimeout(controlsDismissTimer);
				controlsDismissTimer = null;
			}
		};
		const scheduleControlsDismiss = () => {
			if (!controlsPop.classList.contains('--show')) return;
			clearControlsDismiss();
			controlsDismissTimer = setTimeout(() => controlsPop.classList.remove('--show'), 2000);
		};
		controlsBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			clearControlsDismiss();
			const isShown = controlsPop.classList.contains('--show');
			controlsPop.classList.toggle('--show', !isShown);
			if (!isShown) requestAnimationFrame(() => _positionFpop(controlsPop, controlsBtn));
		});
		controlsBtn.addEventListener('mouseenter', clearControlsDismiss);
		controlsBtn.addEventListener('mouseleave', scheduleControlsDismiss);
		controlsPop.querySelector('#anit_controls_pop_close')?.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			clearControlsDismiss();
			controlsPop.classList.remove('--show');
		});
		controlsPop.addEventListener('mouseenter', clearControlsDismiss);
		controlsPop.addEventListener('mouseleave', scheduleControlsDismiss);
		controlsPop.addEventListener('mousedown', (e) => e.stopPropagation());
		controlsPop.addEventListener('touchstart', (e) => e.stopPropagation(), {passive:true});
		controlsPop.addEventListener('click', (e) => e.stopPropagation());
		document.addEventListener('click', (e) => {
			if (!controlsPop.classList.contains('--show')) return;
			if (!controlsPop.contains(e.target) && e.target !== controlsBtn && !controlsBtn.contains(e.target)) {
				clearControlsDismiss();
				controlsPop.classList.remove('--show');
			}
		}, true);
		window.addEventListener('resize', () => {
			if (controlsPop.classList.contains('--show')) _positionFpop(controlsPop, controlsBtn);
		});
	}

	const mode = IS_OL_FRAME ? 'ol' : 'internal';


	const listCol = IS_OL_FRAME
	? findContainerOL()
	: document.querySelector('.bx-im-list-container-recent__elements')?.closest('.bx-im-list-container-recent__container')
	|| document.querySelector('.bx-im-list-container-recent__elements');

	if (!restorePosition(host, mode)) {
	const vr = document.documentElement.getBoundingClientRect();
	const rr = listCol?.getBoundingClientRect();
	let top = 8, left = (vr.width - host.offsetWidth - 10);
	if (rr) {
	top  = Math.max(8, rr.top + 8);
	left = Math.min(vr.width - host.offsetWidth - 10, rr.right - host.offsetWidth - 10);
}
	host.style.left  = `${Math.max(0, left)}px`;
	host.style.top   = `${Math.max(0, top)}px`;
}


	host.querySelector('#anit_unread').checked = !!filters.unreadOnly;
	host.querySelector('#anit_query').value = String(filters.query || '');

	if (!isTasksMode) {
		updateTypeChipsUI(host);
	}
	if (host.querySelector('#anit_project_input')) {
		try { syncProjectInputFromFilters?.(); } catch {}
	}

	let _isResetting = false;

	function readAndApply() {
	// Не вмешиваемся в процесс сброса (change-события чекбоксов могут стрелять в ходе reset)
	if (_isResetting) return;
	// При активном пресете без debug-режима: разрешаем только unreadOnly,
		// Текстовый поиск и сброс остаются временными поверх пресета; остальные изменения отклоняем
	const _presetLocked = _getActiveId() && !_debugModeActive;
	if (_presetLocked) {
		// Поиск остаётся временным фильтром поверх пресета и не должен менять его снимок.
		filters.unreadOnly        = host.querySelector('#anit_unread')?.checked || false;
		filters.query             = host.querySelector('#anit_query')?.value || '';
		persistFilters({ excludeQuery: true });
		applyFilters();
		return;
	}
	filters.unreadOnly = host.querySelector('#anit_unread').checked;
	filters.query      = host.querySelector('#anit_query').value;

	if (!isTasksMode){
	filters.typesSelected = readTypesFromUI(host);
	} else {
		filters.typesSelected = [];
	}
	const pInp = host.querySelector('#anit_project_input');
	if (pInp) {
		const v = String(pInp.value || '').trim();
		if (v === '') {
			filters.projectIndexes = [];
		} else {
			// если вручную введено значение, но не выбрано из списка ? не меняем текущее состояние
			const chosen = Array.isArray(filters.projectIndexes) ? filters.projectIndexes : [];
			filters.projectIndexes = chosen.filter(n => Number.isFinite(n)).slice(0, 1);
		}
	}
			const rInp = host.querySelector('#anit_responsible_input');
			if (rInp) {
				const v = String(rInp.value || '').trim();
				if (v === '') {
					filters.responsibleIndexes = [];
				} else {
					// если вручную введено значение, но не выбрано из списка ? не меняем текущее состояние
					const chosen = Array.isArray(filters.responsibleIndexes) ? filters.responsibleIndexes : [];
					filters.responsibleIndexes = chosen.filter(n => Number.isFinite(n)).slice(0, 1);
				}
			}
			const sInp = host.querySelector('#anit_status_input');
			if (sInp) {
				const v = String(sInp.value || '').trim();
				if (v === '') {
					filters.statusIndexes = [];
				} else {
					const chosen = Array.isArray(filters.statusIndexes) ? filters.statusIndexes : [];
					filters.statusIndexes = chosen.filter(n => Number.isFinite(n)).slice(0, 1);
				}
			}
			if (isTasksChatsModeNow()) filters.sortMode = 'native';
			persistFilters();
			applyFilters();
			renderPresetsUI(host);
	}

	const _doReset = () => {
	_setActiveId(null);   // снимаем активный пресет при сбросе
	_debugModeActive = false;
	_isResetting = true;
	try {
	// Сохраняем теги ? сброс только снимает выбор, не удаляет теги
	const savedTags = Array.isArray(filters.keywordTags) ? [...filters.keywordTags] : [];
	const savedIntersectionTags = Array.isArray(filters.intersectionTags) ? [...filters.intersectionTags] : [];
	filters = defaultFilters();
	filters.keywordTags = savedTags;
	filters.selectedTags = [];
	filters.intersectionTags = savedIntersectionTags;
	filters.selectedIntersectionTags = [];
	persistFilters();
	// Визуально снимаем все активные теги (renderTagChips/renderIntersectionTagChips
	// определены внутри buildFiltersPanel и недоступны здесь ? обновляем напрямую)
	const _kwChipsR = host.querySelector('#anit_kwtags_chips');
	if (_kwChipsR) _kwChipsR.querySelectorAll('.kw-tag-chip').forEach(c => c.classList.remove('is-active'));
	const _ixChipsR = host.querySelector('#anit_itags_chips');
	if (_ixChipsR) _ixChipsR.querySelectorAll('.kw-tag-chip').forEach(c => c.classList.remove('is-active'));
	try { renderTypeChips(); } catch(e){}
	host.querySelector('#anit_unread').checked = false;
	host.querySelector('#anit_query').value = '';
	if (!isTasksMode) {
		host.querySelectorAll('#anit_types .anit-type-chip').forEach(btn => { btn.classList.remove('is-selected'); btn.setAttribute('aria-pressed','false'); });
	}
	const pInpReset = host.querySelector('#anit_project_input');
	if (pInpReset) pInpReset.value = '';
	const rInpReset = host.querySelector('#anit_responsible_input');
	if (rInpReset) rInpReset.value = '';
	const sInpReset = host.querySelector('#anit_status_input');
	if (sInpReset) sInpReset.value = '';
	if (host.querySelector('#anit_hidden_group')) { try { refreshHiddenChips(host); updateHiddenCounts(host); } catch {} }
	filters.sortMode = 'native';
	persistFilters();
	applyFilters();
	renderPresetsUI(host);
	} finally {
		_isResetting = false;
	}
	};
	host.querySelector('#anit_reset').addEventListener('click', _doReset);

	// --- Кастомный скроллбар (снаружи .pane, не смещает контент) ---
	(function _initScrollbar() {
		const pane = host.querySelector('.pane');
		if (!pane) return;
		const track = document.createElement('div');
		track.id = 'anit_scr_track';
		const thumb = document.createElement('div');
		thumb.id = 'anit_scr_thumb';
		track.appendChild(thumb);
		host.appendChild(track); // в #anit-filters, не в .pane ? выходит за правый край

		function _syncThumb() {
			const sh = pane.scrollHeight, ch = pane.clientHeight;
			if (sh <= ch + 2) { track.style.display = 'none'; return; }
			track.style.display = 'block';
			const trackH = track.clientHeight;
			const thumbH = Math.max(20, (ch / sh) * trackH);
			const maxTop  = trackH - thumbH;
			const frac    = pane.scrollTop / (sh - ch);
			thumb.style.height = thumbH + 'px';
			thumb.style.top    = (frac * maxTop) + 'px';
		}

		pane.addEventListener('scroll', _syncThumb, { passive: true });
		try { new ResizeObserver(_syncThumb).observe(pane); } catch (_) {}
		_syncThumb();

		// Перетаскивание ползунка
		let _drag = false, _sy = 0, _sst = 0;
		thumb.addEventListener('mousedown', e => {
			_drag = true; _sy = e.clientY; _sst = pane.scrollTop;
			e.preventDefault(); e.stopPropagation();
		});
		document.addEventListener('mousemove', e => {
			if (!_drag) return;
			const moveRange   = track.clientHeight - thumb.clientHeight;
			const scrollRange = pane.scrollHeight - pane.clientHeight;
			if (moveRange > 0) pane.scrollTop = _sst + ((e.clientY - _sy) / moveRange) * scrollRange;
		}, { passive: true });
		document.addEventListener('mouseup', () => { _drag = false; });

		// Клик по треку ? прыжок к позиции
		track.addEventListener('click', e => {
			if (e.target === thumb) return;
			const rect = track.getBoundingClientRect();
			const frac = (e.clientY - rect.top) / track.clientHeight;
			pane.scrollTop = frac * (pane.scrollHeight - pane.clientHeight);
		});
	})();

		let queryTimer = null;
		function scheduleQueryApply() {
			if (queryTimer) clearTimeout(queryTimer);
			queryTimer = setTimeout(() => {
				readAndApply();
			}, 200);
		}

		host.querySelectorAll('input,select').forEach(el => {

			if (el.id !== 'anit_query') {
				el.addEventListener('change', readAndApply);
				return;
			}


			const qInput = el;


			qInput.addEventListener('input', () => {
				scheduleQueryApply();
			});


			qInput.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') {
					if (queryTimer) clearTimeout(queryTimer);
					readAndApply();
				}
			});
		});


	// Dynamic type chips - render and use event delegation
	function renderTypeChips() {
		const grid = host.querySelector('#anit_types');
		if (!grid) return;
		const visibleCats = getAllVisibleCats();
		const sel = new Set(Array.isArray(filters.typesSelected) ? filters.typesSelected : []);
		grid.innerHTML = visibleCats.map(c =>
			`<button type="button" class="anit-type-chip${sel.has(c.type) ? ' is-selected' : ''}" data-type="${c.type}" aria-pressed="${sel.has(c.type) ? 'true' : 'false'}">${c.label}</button>`
		).join('');
	}
	if (!isTasksMode) renderTypeChips();

	// Event delegation for dynamically rendered chips
	host.querySelector('#anit_types')?.addEventListener('click', (e) => {
		const btn = e.target.closest('.anit-type-chip');
		if (!btn) return;
		e.preventDefault();
		btn.classList.toggle('is-selected');
		readAndApply();
	});

	// Category management panel logic
	function renderCatManagePanel() {
		const visList = host.querySelector('#anit_cat_vis_list');
		const customList = host.querySelector('#anit_cat_custom_list');
		if (!visList) return;
		const allBuiltin = BUILTIN_CATS;
		const allCustom = loadCustomCats();
		visList.innerHTML = '';
		for (const c of [...allBuiltin, ...allCustom]) {
			const visible = isCatVisible(c.type);
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.textContent = c.label;
			const onStyle  = 'border:1px solid rgba(85,180,255,.5);background:rgba(85,180,255,.14);color:#b8d8ff;border-radius:10px;padding:3px 10px;font-size:11px;cursor:pointer;margin:2px;transition:all .15s;outline:none';
			const offStyle = 'border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:rgba(255,255,255,.28);text-decoration:line-through;border-radius:10px;padding:3px 10px;font-size:11px;cursor:pointer;margin:2px;transition:all .15s;outline:none';
			btn.style.cssText = visible ? onStyle : offStyle;
			btn.addEventListener('click', () => {
				const nowVisible = !isCatVisible(c.type);
				setCatVisible(c.type, nowVisible);
				btn.style.cssText = nowVisible ? onStyle : offStyle;
				renderTypeChips();
				filters.typesSelected = (filters.typesSelected || []).filter(t => isCatVisible(t));
				persistFilters();
				applyFilters();
			});
			visList.appendChild(btn);
		}
		if (customList) {
			customList.innerHTML = '';
			for (const c of allCustom) {
				const row = document.createElement('div');
				row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0;font-size:11px;color:#aaa';
				const info = document.createElement('span');
				info.style.flex = '1';
				info.innerHTML = `<b>${c.label}</b> <span style="opacity:.5">${c.rxPattern ? '('+c.rxPattern+')' : ''}</span>`;
				const rmBtn = document.createElement('button');
				rmBtn.type = 'button';
				rmBtn.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" style="width:9px;height:9px;display:block;fill:currentColor"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg>';
				rmBtn.style.cssText = 'padding:2px 5px;border-radius:10px;border:1px solid rgba(255,0,0,.3);background:rgba(255,0,0,.12);color:#f66;cursor:pointer;font-size:12px';
				rmBtn.addEventListener('click', () => {
					const cats = loadCustomCats().filter(cc => cc.type !== c.type);
					saveCustomCats(cats);
					const vis = loadCatVisibility();
					delete vis[c.type];
					saveCatVisibility(vis);
					renderCatManagePanel();
					renderTypeChips();
					filters.typesSelected = (filters.typesSelected || []).filter(t => t !== c.type);
					persistFilters();
					applyFilters();
				});
				row.appendChild(info);
				row.appendChild(rmBtn);
				customList.appendChild(row);
			}
		}
	}
	// -- Панель управления пресетами ------------------------------------------------
	const presetManageBtn = host.querySelector('#anit_preset_manage_btn');
	const presetManagePanel = host.querySelector('#anit_preset_manage_panel');
	let _presetDismissTimer = null;
	if (presetManageBtn && presetManagePanel) {
		presetManageBtn.addEventListener('click', (e) => {
			e.preventDefault(); e.stopPropagation();
			const nowVisible = presetManagePanel.classList.contains('--show');
			presetManagePanel.classList.toggle('--show', !nowVisible);
			if (!nowVisible) {
				renderPresetManagePanel(host);
				requestAnimationFrame(() => _positionFpop(presetManagePanel, presetManageBtn));
			}
		});
		host.querySelector('#anit_preset_manage_close')?.addEventListener('click', () => { presetManagePanel.classList.remove('--show'); });
		presetManagePanel.addEventListener('mouseenter', () => { if (_presetDismissTimer) { clearTimeout(_presetDismissTimer); _presetDismissTimer = null; } });
		presetManagePanel.addEventListener('mouseleave', () => {
			if (presetManagePanel.contains(document.activeElement)) return;
			_presetDismissTimer = setTimeout(() => { presetManagePanel.classList.remove('--show'); }, 2000);
		});
		document.addEventListener('click', (e) => {
			if (!presetManagePanel || !presetManagePanel.classList.contains('--show')) return;
			if (!presetManagePanel.contains(e.target) && !presetManageBtn.contains(e.target)) {
				presetManagePanel.classList.remove('--show');
			}
		}, true);
		const presetAddBtn = host.querySelector('#anit_preset_add_btn');
		if (presetAddBtn) {
			const doAddPreset = () => {
				const nameInp = host.querySelector('#anit_preset_new_name');
				const label = (nameInp?.value || '').trim();
				if (!label) return;
				const arr = _getPresetsArr();
				arr.push({ id: 'c_' + Date.now(), label, filters: _snapFilters() });
				_saveCustomPresets();
				_setActiveId(arr[arr.length - 1].id);
				if (nameInp) nameInp.value = '';
				renderPresetManagePanel(host);
				renderPresetsUI(host);
			};
			presetAddBtn.addEventListener('click', doAddPreset);
			const presetNameInp = host.querySelector('#anit_preset_new_name');
			if (presetNameInp) {
				presetNameInp.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') { e.preventDefault(); doAddPreset(); }
					e.stopPropagation();
				});
			}
		}
	}

	// -- Кнопка режима отладки пресетов ----------------------------------------
	const presetDebugBtn = host.querySelector('#anit_preset_debug_btn');
	if (presetDebugBtn) {
		presetDebugBtn.addEventListener('click', (e) => {
			e.preventDefault(); e.stopPropagation();
			if (!_getActiveId()) {
				_showPresetToast('Сначала выберите пресет');
				return;
			}
			if (!_debugModeActive) {
				_showPresetConfirm(
					'Войти в режим отладки? Вы сможете изменять фильтры выбранного пресета.',
					'Войти', 'Отмена',
					() => { _debugModeActive = true; _updateDebugUI(host); }
				);
			} else {
				_showPresetConfirm(
					'Выйти из режима отладки? Текущие фильтры будут сохранены в пресет.',
					'Выйти', 'Отмена',
					() => { saveFiltersToActivePreset(); _debugModeActive = false; _updateDebugUI(host); }
				);
			}
		});
	}

	const catManageBtn = host.querySelector('#anit_cat_manage_btn');
	const catManagePanel = host.querySelector('#anit_cat_manage_panel');
	let _catDismissTimer = null;
	if (catManageBtn && catManagePanel) {
		catManageBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const nowVisible = catManagePanel.classList.contains('--show');
			catManagePanel.classList.toggle('--show', !nowVisible);
			if (!nowVisible) {
				renderCatManagePanel();
				requestAnimationFrame(() => _positionFpop(catManagePanel, catManageBtn));
			}
		});
		host.querySelector('#anit_cat_manage_close')?.addEventListener('click', () => { catManagePanel.classList.remove('--show'); });
		catManagePanel.addEventListener('mouseenter', () => { if (_catDismissTimer) { clearTimeout(_catDismissTimer); _catDismissTimer = null; } });
		catManagePanel.addEventListener('mouseleave', () => {
			if (catManagePanel.contains(document.activeElement)) return;
			_catDismissTimer = setTimeout(() => { catManagePanel.classList.remove('--show'); }, 2000);
		});
		document.addEventListener('click', (e) => {
			if (!catManagePanel || !catManagePanel.classList.contains('--show')) return;
			if (!catManagePanel.contains(e.target) && !catManageBtn.contains(e.target)) {
				catManagePanel.classList.remove('--show');
			}
		}, true);
	}

		const categoriesGroup = host.querySelector('#anit_categories_group');
		const categoriesToggle = host.querySelector('#anit_categories_toggle');
		if (categoriesGroup && categoriesToggle && !isTasksMode) {
			const applyCategoryCollapsed = (collapsed) => {
				categoriesGroup.classList.toggle('is-collapsed', !!collapsed);
				try { localStorage.setItem(CAT_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
			};
			try { applyCategoryCollapsed(localStorage.getItem(CAT_COLLAPSED_KEY) === '1'); } catch {}
			categoriesToggle.addEventListener('click', (e) => {
				e.preventDefault();
				const next = !categoriesGroup.classList.contains('is-collapsed');
				applyCategoryCollapsed(next);
			});
		}

		const hiddenGroup = host.querySelector('#anit_hidden_group');
		const hiddenToggle = host.querySelector('#anit_hidden_toggle');
		if (hiddenGroup && hiddenToggle && isTasksMode) {
			const applyHiddenCollapsed = (collapsed) => {
				hiddenGroup.classList.toggle('is-collapsed', !!collapsed);
				try { localStorage.setItem(HIDDEN_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
			};
			try { applyHiddenCollapsed(localStorage.getItem(HIDDEN_COLLAPSED_KEY) === '1'); } catch {}
			hiddenToggle.addEventListener('click', (e) => {
				e.preventDefault();
				applyHiddenCollapsed(!hiddenGroup.classList.contains('is-collapsed'));
			});
		}





	// ---- KEYWORD TAGS ----
	function showTagDeleteConfirm(tag, onConfirm) {
		const pop = document.createElement('div');
		pop.className = 'tag-confirm-pop';
		const safeTag = tag.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
		pop.innerHTML = `<div class="tag-confirm-box">
			<div class="tag-confirm-text">Удалить тег <strong>${safeTag}</strong>?</div>
			<div class="tag-confirm-btns">
				<button class="tag-confirm-cancel">Отмена</button>
				<button class="tag-confirm-ok">Удалить</button>
			</div></div>`;
		pop.querySelector('.tag-confirm-cancel').addEventListener('click', () => pop.remove());
		pop.querySelector('.tag-confirm-ok').addEventListener('click', () => { pop.remove(); onConfirm(); });
		pop.addEventListener('click', (e) => { if (e.target === pop) pop.remove(); });
		host.appendChild(pop);
	}

	function renderTagChips() {
		const chipsEl = host.querySelector('#anit_kwtags_chips');
		if (!chipsEl) return;
		const tags = Array.isArray(filters.keywordTags) ? filters.keywordTags : [];
		const selected = new Set(Array.isArray(filters.selectedTags) ? filters.selectedTags : []);
		chipsEl.innerHTML = '';
		tags.forEach(tag => {
			const chip = document.createElement('span');
			chip.className = 'kw-tag-chip' + (selected.has(tag) ? ' is-active' : '');
			chip.innerHTML = tag + ' <span class="tag-rm" title="Удалить"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg></span>';
			chip.querySelector('.tag-rm').addEventListener('click', (e) => {
				e.stopPropagation();
				showTagDeleteConfirm(tag, () => {
					filters.keywordTags = (filters.keywordTags || []).filter(t => t !== tag);
					filters.selectedTags = (filters.selectedTags || []).filter(t => t !== tag);
					persistFilters();
					renderTagChips();
					applyFilters();
				});
			});
			chip.addEventListener('click', (e) => {
				if (e.target.classList.contains('tag-rm')) return;
				if (!filters.selectedTags) filters.selectedTags = [];
				const i = filters.selectedTags.indexOf(tag);
				if (i >= 0) filters.selectedTags.splice(i, 1);
				else filters.selectedTags.push(tag);
				persistFilters();
				renderTagChips();
				applyFilters();
			});
			chipsEl.appendChild(chip);
		});
	}
	renderTagChips();

	const tagAddInput = host.querySelector('#anit_tag_add_input');
	const tagAddBtn = host.querySelector('#anit_tag_add_btn');
	function doAddTag() {
		if (!tagAddInput) return;
		const val = tagAddInput.value.trim();
		if (!val) return;
		if (!Array.isArray(filters.keywordTags)) filters.keywordTags = [];
		if (!filters.keywordTags.includes(val)) {
			filters.keywordTags.push(val);
			persistFilters();
			renderTagChips();
		}
		tagAddInput.value = '';
	}
	tagAddBtn && tagAddBtn.addEventListener('click', doAddTag);
	tagAddInput && tagAddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddTag(); } });
	// ---- END KEYWORD TAGS ----

	// ---- INTERSECTION TAGS ----
	function renderIntersectionTagChips() {
		const chipsEl = host.querySelector('#anit_itags_chips');
		if (!chipsEl) return;
		const tags = Array.isArray(filters.intersectionTags) ? filters.intersectionTags : [];
		const selected = new Set(Array.isArray(filters.selectedIntersectionTags) ? filters.selectedIntersectionTags : []);
		chipsEl.innerHTML = '';
		tags.forEach(tag => {
			const chip = document.createElement('span');
			chip.className = 'kw-tag-chip' + (selected.has(tag) ? ' is-active' : '');
			chip.innerHTML = tag + ' <span class="tag-rm" title="Удалить"><svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M10.4 2.4 9.6 1.6 6 5.2 2.4 1.6 1.6 2.4 5.2 6 1.6 9.6 2.4 10.4 6 6.8 9.6 10.4 10.4 9.6 6.8 6z"/></svg></span>';
			chip.querySelector('.tag-rm').addEventListener('click', (e) => {
				e.stopPropagation();
				showTagDeleteConfirm(tag, () => {
					filters.intersectionTags = (filters.intersectionTags || []).filter(t => t !== tag);
					filters.selectedIntersectionTags = (filters.selectedIntersectionTags || []).filter(t => t !== tag);
					persistFilters();
					renderIntersectionTagChips();
					applyFilters();
				});
			});
			chip.addEventListener('click', (e) => {
				if (e.target.classList.contains('tag-rm')) return;
				if (!filters.selectedIntersectionTags) filters.selectedIntersectionTags = [];
				const i = filters.selectedIntersectionTags.indexOf(tag);
				if (i >= 0) filters.selectedIntersectionTags.splice(i, 1);
				else filters.selectedIntersectionTags.push(tag);
				persistFilters();
				renderIntersectionTagChips();
				applyFilters();
			});
			chipsEl.appendChild(chip);
		});
	}
	renderIntersectionTagChips();

	const itagAddInput = host.querySelector('#anit_itag_add_input');
	const itagAddBtn = host.querySelector('#anit_itag_add_btn');
	function doAddIntersectionTag() {
		if (!itagAddInput) return;
		const val = itagAddInput.value.trim();
		if (!val) return;
		if (!Array.isArray(filters.intersectionTags)) filters.intersectionTags = [];
		if (!filters.intersectionTags.includes(val)) {
			filters.intersectionTags.push(val);
			persistFilters();
			renderIntersectionTagChips();
		}
		itagAddInput.value = '';
	}
	itagAddBtn && itagAddBtn.addEventListener('click', doAddIntersectionTag);
	itagAddInput && itagAddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddIntersectionTag(); } });
	// ---- END INTERSECTION TAGS ----

	// Загрузка чатов: используется автоматически и по кнопке в?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Р‚
	let _prefetchRunning = false;
	async function runPrefetch() {
		if (IS_OL_FRAME || _prefetchRunning) return;
		_prefetchRunning = true;
		if (!document.body.contains(host)) { _prefetchRunning = false; return; }

		const popup = document.createElement('div');
		popup.className = 'pena-prefetch-popup';
		popup.innerHTML = `
			<div class="pena-prefetch-box">
			<div class="pena-prefetch-handle">Загрузка чатов...</div>
			<div class="pena-prefetch-bar-wrap"><div class="pena-prefetch-bar" id="pena_prefetch_bar"></div></div>
			<div class="pena-prefetch-sub">Прокрутка списка для предзагрузки</div>
			<button class="pena-prefetch-cancel" id="pena_prefetch_cancel">Отмена</button>
			</div>`;
		host.appendChild(popup);

		const bar = popup.querySelector('#pena_prefetch_bar');
		let _cancelled = false;
		let _scrollPromise = null;
		popup.querySelector('#pena_prefetch_cancel').addEventListener('click', () => {
			_cancelled = true;
			if (_scrollPromise) _scrollPromise.cancel();
		});

		const onMove = () => {};
		const onUp = () => {};

		try {
			_prefetchActive = true;
			applyFilters();

			_scrollPromise = autoScrollWithObserver({
				tick: 200, idleLimit: 1500, maxTime: 60000,
				onProgress: (pct) => { if (bar) bar.style.width = pct + '%'; }
			});
			await _scrollPromise;

			// Возврат в начало списка после загрузки
			const _scrollEl = findInternalScrollContainer();
			if (_scrollEl) _scrollEl.scrollTop = 0;

			if (!_cancelled) {
				_prefetchedModes.add(_currentPanelMode);
				try { sessionStorage.setItem('pena.prefetchedModes', JSON.stringify([..._prefetchedModes])); } catch {}
				if (bar) bar.style.width = '100%';
				await new Promise(r => setTimeout(r, 350));
			}
		} catch (e) {
			console.warn('[PENA] runPrefetch error', e);
		} finally {
			_prefetchRunning = false;
			_prefetchActive = false;
			applyFilters(); // восстановить фильтрацию после предзагрузки
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup',   onUp);
			if (document.body.contains(popup)) popup.remove();
		}
	}

	// Автоматически при первом открытии режима
	if (!IS_OL_FRAME && !_prefetchedModes.has(_currentPanelMode)) {
		setTimeout(() => runPrefetch().catch(() => {}), 400);
	}
	// Ручная кнопка «Загрузить чаты»
	host.querySelector('#anit_prefetch_manual')?.addEventListener('click', () => {
		_prefetchedModes.delete(_currentPanelMode);
		runPrefetch().catch(() => {});
	});

	makeDraggable(host, mode);

	// в?Ђв?Р‚ Масштаб панели: отдельная настройка удалена, визуальный размер меняется ресайзом окна.
	const getPanelScale = () => parseFloat(host.dataset.panelScale || '1') || 1;
	const clampPanelScale = (v) => Math.max(0.65, Math.min(1.5, Number.isFinite(v) ? v : 1));
	const applyPanelScale = (value = getPanelScale()) => {
		const scale = clampPanelScale(value);
		host.dataset.panelScale = String(scale);
		host.dataset.externalScale = '1';
		host.dataset.effectivePanelScale = String(scale);
		host.style.setProperty('--panel-icon-counter-scale', String(1 / Math.max(0.1, scale)));
		host.style.zoom = '';
		host.style.transform = scale === 1 ? '' : `scale(${scale})`;
		if (_dialogControlDock) _dialogControlDock.style.zoom = '';
		if (_dialogControlDock) _syncDialogDockAppearance(host);
		const r = host.getBoundingClientRect();
		const left = parseInt(host.style.left || '0', 10) || 0;
		const top = parseInt(host.style.top || '0', 10) || 0;
		host.style.left = Math.max(0, Math.min(left, window.innerWidth - r.width)) + 'px';
		host.style.top = Math.max(0, Math.min(top, window.innerHeight - r.height)) + 'px';
		_syncDialogDockToPanel(host);
		return scale;
	};
	try { localStorage.removeItem('pena.panel.scale'); } catch {}

	// в?Ђв?Р‚ Изменение размера панели в?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Р‚
	const LS_PANEL_SIZE_KEY = `pena.panelSize.${_currentPanelMode}`;
	const PANEL_MIN_WIDTH = 224;
	const PANEL_MAX_WIDTH = 520;
	const PANEL_MIN_HEIGHT = 220;
	let panelHeightAuto = true;
	const getPanelMinWidth = () => Math.min(PANEL_MIN_WIDTH, Math.max(180, window.innerWidth - 16));
	const getPanelResizeScale = () => _getPanelVisualScale(host);
	const getPanelLeft = () => parseFloat(host.style.left || '0') || 0;
	const getPanelMaxWidth = (left = getPanelLeft()) => {
		const availableVisual = Math.max(180, window.innerWidth - Math.max(0, left) - 8);
		return Math.max(getPanelMinWidth(), Math.min(PANEL_MAX_WIDTH, availableVisual / getPanelResizeScale()));
	};
	const clampPanelWidth = (w, left = getPanelLeft()) => {
		const value = Number.isFinite(w) ? w : 260;
		return Math.max(getPanelMinWidth(), Math.min(getPanelMaxWidth(left), value));
	};
	const clampPanelHeight = (h) => _clampLinkedPanelHeight(Math.max(PANEL_MIN_HEIGHT, h), host);
	const autoFitPanelHeight = () => {
		if (!panelHeightAuto || host.classList.contains('anit-hidden')) return;
		const pane = host.querySelector('.pane');
		if (!pane) return;
		const desired = clampPanelHeight((pane.scrollHeight || pane.offsetHeight || PANEL_MIN_HEIGHT) + 2);
		if (Math.abs((parseFloat(pane.style.maxHeight || '') || 0) - desired) > 1) {
			pane.style.maxHeight = desired + 'px';
			_syncLinkedPanelHeights();
		}
	};
	const clampPanelToViewport = () => {
		host.style.width = clampPanelWidth(host.offsetWidth || parseFloat(host.style.width) || 260) + 'px';
		const pane = host.querySelector('.pane');
		if (pane) {
			if (panelHeightAuto) autoFitPanelHeight();
			else pane.style.maxHeight = clampPanelHeight(parseFloat(pane.style.maxHeight || '') || pane.offsetHeight || PANEL_MIN_HEIGHT) + 'px';
		}
		applyPanelScale(getPanelScale());
	};
	const refreshScaleCompensation = () => {
		if (!document.body.contains(host)) {
			if (scaleCompensationTimer) clearInterval(scaleCompensationTimer);
			try { panelAutoHeightObserver.disconnect(); } catch {}
			return;
		}
		applyPanelScale(getPanelScale());
	};
	const persistPanelSize = () => {
		const pane = host.querySelector('.pane');
		try { localStorage.setItem(LS_PANEL_SIZE_KEY, JSON.stringify({ w: host.style.width, h: panelHeightAuto ? null : (pane?.style.maxHeight || ''), scale: getPanelScale() })); } catch {}
	};
	// Восстанавливаем сохранённый размер
	let savedPanelScale = 1;
	try {
		const saved = JSON.parse(localStorage.getItem(LS_PANEL_SIZE_KEY) || '{}');
		if (saved.w) {
			const savedW = parseFloat(String(saved.w));
			host.style.width = Number.isFinite(savedW) ? clampPanelWidth(savedW) + 'px' : saved.w;
		}
		if (saved.h) { const p = host.querySelector('.pane'); if (p) { p.style.maxHeight = saved.h; panelHeightAuto = false; } }
		if (Number.isFinite(saved.scale)) savedPanelScale = saved.scale;
	} catch {}
	applyPanelScale(savedPanelScale);
	clampPanelToViewport();
	window.addEventListener('resize', clampPanelToViewport);
	window.visualViewport?.addEventListener('resize', refreshScaleCompensation);
	window.visualViewport?.addEventListener('scroll', refreshScaleCompensation);
	let scaleCompensationTimer = setInterval(refreshScaleCompensation, 1200);
	const panelAutoHeightObserver = new MutationObserver(() => requestAnimationFrame(autoFitPanelHeight));
	try { panelAutoHeightObserver.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] }); } catch {}
	requestAnimationFrame(autoFitPanelHeight);
	// Ресайз за боковые грани и диагональные нижние углы
	const _EDGE = 12; // px resize hit area
	let _rzActive = false, _rzEdges = {};
	let _rzStartX = 0, _rzStartY = 0, _rzStartW = 0, _rzStartH = 0, _rzStartLeft = 0, _rzStartScale = 1, _rzStartRight = 0;
	const _getEdges = (ev) => {
		const r = host.getBoundingClientRect();
		const l = ev.clientX <= r.left + _EDGE;
		const rEdge = ev.clientX >= r.right - _EDGE;
		const b = ev.clientY >= r.bottom - _EDGE;
		return { l, r: rEdge, b };
	};
	const _RZ_CLASSES = ['rz-e','rz-w','rz-s','rz-se','rz-sw'];
	const _edgeCursorClass = (g) => {
		if (g.r && g.b) return 'rz-se';
		if (g.l && g.b) return 'rz-sw';
		if (g.l) return 'rz-w';
		if (g.r) return 'rz-e';
		if (g.b) return 'rz-s';
		return '';
	};
	const _setRzCursor = (cls) => {
		host.classList.remove(..._RZ_CLASSES);
		if (cls) host.classList.add(cls);
	};
	host.addEventListener('mousemove', (ev) => {
		if (_rzActive) return;
		if (host.classList.contains('anit-hidden')) {
			_setRzCursor('');
			return;
		}
		const edges = _getEdges(ev);
		const overUI = !!ev.target.closest('button,input,select,textarea,a,[contenteditable],.controls-pop');
		_setRzCursor(overUI && !edges.l && !edges.r && !edges.b ? '' : _edgeCursorClass(edges));
	});
	host.addEventListener('mouseleave', () => { if (!_rzActive) _setRzCursor(''); });
	host.addEventListener('mousedown', (ev) => {
		if (ev.button !== 0) return;
		if (host.classList.contains('anit-hidden')) {
			_setRzCursor('');
			return;
		}
		const edges = _getEdges(ev);
		if (!edges.l && !edges.r && !edges.b) return;
		_rzActive = true;
		_rzEdges = edges;
		_rzStartX = ev.clientX; _rzStartY = ev.clientY;
		_rzStartW = host.offsetWidth;
		_rzStartH = parseFloat(host.querySelector('.pane')?.style.maxHeight || '') || host.querySelector('.pane')?.offsetHeight || host.offsetHeight;
		_rzStartLeft = parseInt(host.style.left || '0', 10) || 0;
		_rzStartScale = getPanelResizeScale();
		_rzStartRight = _rzStartLeft + (_rzStartW * _rzStartScale);
		ev.preventDefault();
		ev.stopPropagation();
		const onRzMove = (e) => {
			if (!_rzActive) return;
			const dx = (e.clientX - _rzStartX) / (_rzStartScale || 1);
			const dy = (e.clientY - _rzStartY) / (_rzStartScale || 1);
			const pane = host.querySelector('.pane');
			if ((_rzEdges.r || _rzEdges.l) && _rzEdges.b) {
				const rawDx = _rzEdges.l ? (_rzStartX - e.clientX) : (e.clientX - _rzStartX);
				const rawDy = e.clientY - _rzStartY;
				const delta = Math.abs(rawDx) >= Math.abs(rawDy) ? rawDx : rawDy;
				const nextScale = applyPanelScale(_rzStartScale + (delta / 360));
				if (_rzEdges.l) {
					host.style.left = Math.max(0, Math.min(_rzStartRight - (_rzStartW * nextScale), window.innerWidth - (_rzStartW * nextScale))) + 'px';
				}
				_syncDialogDockToPanel(host, true);
				e.preventDefault();
				return;
			}
			if (_rzEdges.r) {
				const newW = clampPanelWidth(_rzStartW + dx, _rzStartLeft);
				host.style.width = newW + 'px';
				_syncDialogDockToPanel(host, true);
			}
			if (_rzEdges.l) {
				const maxByRightEdge = Math.max(getPanelMinWidth(), Math.min(PANEL_MAX_WIDTH, _rzStartRight / (_rzStartScale || 1)));
				const newW = Math.max(getPanelMinWidth(), Math.min(maxByRightEdge, _rzStartW - dx));
				host.style.width = newW + 'px';
				host.style.left = Math.max(0, Math.min(_rzStartRight - (newW * _rzStartScale), window.innerWidth - (newW * _rzStartScale))) + 'px';
				_syncDialogDockToPanel(host, true);
			}
			if (_rzEdges.b && pane) {
				panelHeightAuto = false;
				const nextH = clampPanelHeight(_rzStartH + dy);
				pane.style.maxHeight = nextH + 'px';
				_syncLinkedPanelHeights();
			}
			e.preventDefault();
		};
		const onRzUp = () => {
			_rzActive = false;
			document.removeEventListener('mousemove', onRzMove);
			document.removeEventListener('mouseup', onRzUp);
			_setRzCursor('');
			persistPanelSize();
		};
		document.addEventListener('mousemove', onRzMove);
		document.addEventListener('mouseup', onRzUp);
	})

	// в?Ђв?Р‚ Прозрачность панели в?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Ђв?Р‚
	const LS_OPACITY_KEY = 'pena.panel.opacity';
	const _opSlider = host.querySelector('#anit_opacity_slider');
	const _opValue = host.querySelector('#anit_opacity_value');
	if (_opSlider) {
		const _applyOp = (v) => {
			const pct = _applyLinkedPanelOpacity(v, false);
			if (_opValue) _opValue.textContent = pct + '%';
		};
		const _savedOp = parseInt(localStorage.getItem(LS_OPACITY_KEY) || '100', 10);
		_opSlider.value = String(isNaN(_savedOp) ? 100 : _savedOp);
		_applyOp(_savedOp);
		_opSlider.addEventListener('input', () => {
			const _v = parseInt(_opSlider.value, 10);
			_applyOp(_v);
			try { localStorage.setItem(LS_OPACITY_KEY, String(_v)); } catch {}
		});
		// Наведение: плавно до 1; уход: 2с задержка, затем плавный возврат (CSS transition)
		host.addEventListener('mouseenter', () => _setLinkedPanelOpacityLift(true));
		host.addEventListener('mouseleave', () => _setLinkedPanelOpacityLift(false));
	}

}


	let obs;
	let rebuildScheduled = false;

	async function rebuildList(reason, opts = {}) {
	const container = findContainer();
	if (!container) { warn('rebuild: контейнер не найден'); return; }

	if (!IS_OL_FRAME) {
		const pane = document.getElementById('anit-filters');
		const needMode = getPanelModeKey();
		if (pane && pane.dataset.mode !== needMode) {
			_setPanelModeSwitching(true);
			_forceCloseDialogControlPalettes();
			_modeFiltersCache[_currentPanelMode] = JSON.parse(JSON.stringify(filters));
			pane.remove();
			filtersHost = null;
			_currentPanelMode = needMode; // фиксируем режим ДО loadFilters/saveFilters
			filters = _modeFiltersCache[needMode] ? JSON.parse(JSON.stringify(_modeFiltersCache[needMode])) : loadFilters();
			await buildFiltersPanel().catch(() => {});
			_setPanelModeSwitching(false);
			if (filtersHost) {
				_renderDialogControlPanel(filtersHost);
				_updateDialogControlUI(filtersHost);
				_syncDialogDockToPanel(filtersHost, true);
			}
		}
		applyFilters();
		return;
	}

	const tsMapLocal = opts.tsMap || tsMapOnce || new Map();
	container.querySelectorAll('.bx-messenger-recent-group').forEach(n => n.remove());

	const items = Array.from(container.querySelectorAll('.bx-messenger-cl-item'));
	if (!items.length) { applyFilters(); return; }

	const ids = items.map(el => normId(el.getAttribute('data-userid') || el.dataset.userid));
	const setSig = currentSetSignature(ids);

	if (rankMap.size && setSig === frozenSetSig) {
		const orderSigNow = currentOrderSignature(ids);
		const shouldBe = Array.from(ids).sort((a, b) => (rankMap.get(a) ?? 1e9) - (rankMap.get(b) ?? 1e9));
		const wantedSig = currentOrderSignature(shouldBe);
		if (orderSigNow !== wantedSig) {
			const mapById = new Map(items.map(el => [normId(el.getAttribute('data-userid') || el.dataset.userid), el]));
			const frag = document.createDocumentFragment();
			for (const id of shouldBe) { const el = mapById.get(id); if (el) frag.appendChild(el); }
			container.appendChild(frag);
			lastOrderSig = wantedSig;
			log('reapply frozen order.', { total: items.length, reason });
		}
		applyFilters();
		rebuildDateGroups(tsMapLocal);
		return;
}

	const currentIndex = new Map(items.map((el, i) => [el, i]));
	items.sort((a, b) => {
		const aId = normId(a.getAttribute('data-userid') || a.dataset.userid);
		const bId = normId(b.getAttribute('data-userid') || b.dataset.userid);
		const ra = rankMap.has(aId) ? rankMap.get(aId) : 1e9;
		const rb = rankMap.has(bId) ? rankMap.get(bId) : 1e9;
		if (ra !== rb) return ra - rb;
		const ta = tsMapLocal.get(aId)   -1;
		const tb = tsMapLocal.get(bId)   -1;
		if (ta !== tb) return tb - ta;
		return (currentIndex.get(a) ?? 0) - (currentIndex.get(b) ?? 0);
	});

	const newIds = items.map(el => normId(el.getAttribute('data-userid') || el.dataset.userid));
	const newOrderSig = currentOrderSignature(newIds);
	if (newOrderSig !== lastOrderSig) {
		const frag = document.createDocumentFragment();
		for (const el of items) frag.appendChild(el);
			container.appendChild(frag);
			lastOrderSig = newOrderSig;
	}

	rankMap = new Map(newIds.map((id, i) => [id, i]));
	frozenSetSig = currentSetSignature(newIds);

	log('rebuild ok.', { total: items.length, source: tsMapLocal.size ? 'rest' : 'dom', reason });
	applyFilters();
	if (_dialogControlActive) _scheduleDialogControlSelectionOutlines();
	rebuildDateGroups(tsMapLocal);
	}

	function armObserver() {
		const container = findContainer();
		if (!container) return;
		if (obs) obs.disconnect();

		const itemSel = IS_OL_FRAME ? '.bx-messenger-cl-item, .bx-messenger-recent-group' : '.bx-im-list-recent-item__wrap';

		obs = new MutationObserver((mutations) => {

		const stillInternal = isInternalChatsDOM();
		if (!IS_OL_FRAME && !stillInternal) {
		_forceCloseDialogControlPalettes();
		document.getElementById('anit-filters')?.remove();
		filtersHost = null;
		return;
	}

	const controlStatusSel = '.bx-im-list-recent-item__counter_number,.bx-messenger-cl-count-digit,[class*="mention" i],[title*="упом" i],[title*="mention" i],[aria-label*="упом" i],[aria-label*="mention" i],[data-id*="mention" i],[data-testid*="mention" i],[data-test-id*="mention" i]';
	let need = false;
	for (const m of mutations) {
		if (
			m.type === 'characterData' ||
			m.type === 'attributes' ||
			(m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].some(n =>
				n.nodeType === 3 ||
				(n.nodeType === 1 && (
					n.matches?.(controlStatusSel) ||
					n.querySelector?.(controlStatusSel)
				))
			))
		) {
			_refreshDialogControlPanel(filtersHost);
		}
		if (m.type === 'childList') {
		if ([...m.addedNodes, ...m.removedNodes].some(n =>
			n.nodeType === 1 &&
			(n.matches?.(itemSel) || n.querySelector?.(itemSel))
			)) { need = true; break; }
		}
	}
	if (!need) return;
	if (rebuildScheduled) return;
	rebuildScheduled = true;
	setTimeout(async () => {
	rebuildScheduled = false;
	await rebuildList('observer');
}, 80);
});

	obs.observe(container, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'title', 'aria-label', 'data-id', 'data-testid', 'data-test-id'] });
	log('observeContainer: подписан на DOM изменения');
}


	let routeObs = null;
	function armRouteObserverIfNeeded() {
	if (IS_OL_FRAME) return;
	if (routeObs) return;
	routeObs = new MutationObserver(() => {
	const onChats = isInternalChatsDOM();
	const havePanel = !!document.getElementById('anit-filters');
	if (onChats && !havePanel) {
	_setPanelModeSwitching(true);
	buildFiltersPanel().then(() => {
		_setPanelModeSwitching(false);
		applyFilters();
		if (filtersHost) {
			_renderDialogControlPanel(filtersHost);
			_updateDialogControlUI(filtersHost);
			_syncDialogDockToPanel(filtersHost, true);
		}
	}).catch(() => { _setPanelModeSwitching(false); });
} else if (onChats && havePanel) {
	const pane = document.getElementById('anit-filters');
	const needMode = getPanelModeKey();
	if (pane && pane.dataset.mode !== needMode) {
		_setPanelModeSwitching(true);
		_forceCloseDialogControlPalettes();
		_modeFiltersCache[_currentPanelMode] = JSON.parse(JSON.stringify(filters));
		pane.remove();
		filtersHost = null;
		_currentPanelMode = needMode; // фиксируем режим ДО loadFilters/saveFilters
		filters = _modeFiltersCache[needMode] ? JSON.parse(JSON.stringify(_modeFiltersCache[needMode])) : loadFilters();
		buildFiltersPanel().then(() => {
			_setPanelModeSwitching(false);
			applyFilters();
			if (filtersHost) {
				_renderDialogControlPanel(filtersHost);
				_updateDialogControlUI(filtersHost);
				_syncDialogDockToPanel(filtersHost, true);
			}
		}).catch(() => { _setPanelModeSwitching(false); });
	}
} else if (!onChats && havePanel) {
	_forceCloseDialogControlPalettes();
	document.getElementById('anit-filters')?.remove();
	filtersHost = null;
}
});
	routeObs.observe(document.documentElement, { childList: true, subtree: true });
}


	async function boot() {
	log('start', { ver: VER, href: location.href, inFrame: IS_FRAME, isOL: IS_OL_FRAME, internal: !IS_OL_FRAME && isInternalChatsDOM() });

	armDomRetroGate();
	if (IS_OL_FRAME) await gatePromise;

	await waitForBody(5000).catch(() => {});

	await waitForContainer(5000).catch(() => {});

	if (IS_OL_FRAME) {
	try { await buildFiltersPanel(); } catch (e) { warn('filters panel build skipped:', e?.message || e); }
} else {
	armRouteObserverIfNeeded();
	try { await buildFiltersPanel(); } catch {}
}

	if (IS_OL_FRAME) tsMapOnce = await getRecentTsMap().catch(() => new Map());

	await rebuildList('boot', { tsMap: tsMapOnce });
	/*if (isInternalChatsDOM){
	autoScrollWithObserver({

			tick: 250,
			idleLimit: 1500,
			maxTime: 60000
	});


	}*/

		function armDialogControlHandlers() {
			document.addEventListener('click', (e) => {
				if (!_dialogControlActive) return;
				const panel = document.getElementById('anit-filters');
				const dock = document.getElementById('anit-dialog-control-dock');
				if (panel?.contains(e.target) || dock?.contains(e.target) || e.target?.closest?.('.dialog-control-palette')) return;
				const el = getChatItemElement(e.target);
				if (!el) {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation?.();
					_showDialogControlMiss();
					return;
				}
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation?.();
				_addDialogToControl(el, !!(e.ctrlKey || e.metaKey));
			}, true);

			document.addEventListener('keydown', (e) => {
				if (!_dialogControlActive) return;
				if (e.key === 'Escape') {
					e.preventDefault();
					_exitDialogControlMode();
				}
			}, true);
		}

		window.addEventListener('message', (e) => {
			if (!e.data || e.data.type !== 'anit-mapping-updated') return;
			if (!e.data.projects && !e.data.users) return;
			window.__anitProjectLookup = {
				projects: Array.isArray(e.data.projects) ? e.data.projects : (window.__anitProjectLookup?.projects || []),
				chatToProject: new Map(Array.isArray(e.data.chatToProject) ? e.data.chatToProject : (window.__anitProjectLookup?.chatToProject || [])),
				users: Array.isArray(e.data.users) ? e.data.users : (window.__anitProjectLookup?.users || []),
				chatToResponsible: new Map(Array.isArray(e.data.chatToResponsible) ? e.data.chatToResponsible : (window.__anitProjectLookup?.chatToResponsible || [])),
				statuses: Array.isArray(e.data.statuses) ? e.data.statuses : (window.__anitProjectLookup?.statuses || []),
				chatToStatus: new Map(Array.isArray(e.data.chatToStatus) ? e.data.chatToStatus : (window.__anitProjectLookup?.chatToStatus || []))
			};
			try { applyFilters(); } catch (err) {}
			try {
				if (filtersHost) {
					document.getElementById('anit-filters')?.remove();
					filtersHost = null;
					buildFiltersPanel().then(() => applyFilters());
				}
			} catch {}
		});

		armObserver();
		armDialogControlHandlers();
	log('boot завершён');
}

	function decodeDeltaMap(dmap) {
		const map = new Map();
		if (!Array.isArray(dmap) || dmap.length < 2) return map;

		let chatId = Number(dmap[0]);
		let idx = Number(dmap[1]);
		if (Number.isFinite(chatId) && Number.isFinite(idx)) map.set(chatId, idx);

		for (let i = 2; i < dmap.length; i += 2) {
			const delta = Number(dmap[i]);
			const nextIdx = Number(dmap[i + 1]);
			if (!Number.isFinite(delta) || !Number.isFinite(nextIdx)) continue;
			chatId += delta;
			map.set(chatId, nextIdx);
		}
		return map;
	}

	window.addEventListener('message', (e) => {
		const d = e.data;
		if (!d || d.type !== 'ANIT_BXCS_MAPPING' || !d.bundle) return;

		const bundle = d.bundle;
		const projects = Array.isArray(bundle.projects) ? bundle.projects : null;
		const dmapArr = Array.isArray(bundle.dmap) ? bundle.dmap : null;
		if (!projects || !dmapArr) return;
		const users = Array.isArray(bundle.users) ? bundle.users : null;
		const dmapUArr = Array.isArray(bundle.dmapu) ? bundle.dmapu : null;
		const statuses = Array.isArray(bundle.statuses) ? bundle.statuses : null;
		const dmapStatusArr = Array.isArray(bundle.dmapStatus) ? bundle.dmapStatus : null;

		window.__anitProjectLookup = {
			projects,
			chatToProject: decodeDeltaMap(dmapArr),
			users: users || [],
			chatToResponsible: decodeDeltaMap(dmapUArr),
			statuses: statuses || [],
			chatToStatus: decodeDeltaMap(dmapStatusArr),
			ts: bundle.ts || Date.now(),
			portal: bundle.portal || d.host || ''
		};

		try { if (typeof applyFilters === 'function') applyFilters(); } catch (_) {}


		try {
			if (!filtersHost) return;
			if (!isTasksChatsModeNow()) return;

			const row = filtersHost.querySelector('#anit_projects_row');
			const hasMapping = !!window.__anitProjectLookup?.projects;


			if (row && row.style.display === 'none' && hasMapping) {
				document.getElementById('anit-filters')?.remove();
				filtersHost = null;
				buildFiltersPanel().then(() => applyFilters());
				return;
			}


			try { uiFromFilters(filtersHost); } catch {}
		} catch {}
	}, true);

	try { boot().catch(e => err('fatal', e)); } catch (e) { err('fatal', e); }
})();

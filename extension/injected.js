

	// URL логотипа: через data-атрибут (обычная инъекция) или через глобал (executeScript-инъекция)
	const _PENA_LOGO_URL = (function() {
		try { return window.__PENA_LOGO_URL_OVERRIDE__ || document.currentScript?.dataset?.logoUrl || ''; } catch(e) { return ''; }
	})();

	(function () {

	if (window.__ANITREC_RUNNING__) { return; }
	window.__ANITREC_RUNNING__ = '1.16.0';

	const VER = '1.16.0';
	const TAG = 'PENA: CHAT SORTER';
	const LBL = `%c[${TAG}]`;
	const CSS_LOG  = 'background:#000;color:#fff;padding:1px 4px;border-radius:3px';
	const CSS_WARN = 'background:#8B5E00;color:#fff;padding:1px 4px;border-radius:3px';
	const CSS_ERR  = 'background:#7F1D1D;color:#fff;padding:1px 4px;border-radius:3px';

	const log  = (...a) => console.log(LBL, CSS_LOG, ...a);
	const warn = (...a) => console.log(LBL, CSS_WARN, ...a);
	const err  = (...a) => console.error(LBL, CSS_ERR, ...a);

	const IS_FRAME = self !== top;
	const qs = new URLSearchParams(location.search || '');
	const IS_OL_FRAME =
	IS_FRAME &&
	/\/desktop_app\/\?/i.test(location.href) &&
	(qs.get('IM_LINES') === 'Y' || /IM_LINES=Y/i.test(location.href));
	let multiSelectMode = false;
	let multiSelectedIds = new Set();
	let multiRmbTimer = null;
	let multiRmbTargetEl = null;
	let multiPanelHost = null;
	let multiEnteredViaRmb = false;
	function isInternalRecentDOM() {
		return !!document.querySelector('.bx-im-list-container-recent__elements .bx-im-list-recent-item__wrap');
	}

	function isInternalTaskDOM() {
		return !!document.querySelector('.bx-im-list-container-task__elements .bx-im-list-recent-item__wrap');
	}

	function isInternalChatsDOM() {
		return isInternalRecentDOM() || isInternalTaskDOM();
	}

	function findContainerInternal() {

		const taskList = document.querySelector('.bx-im-list-container-task__elements');
		if (taskList) return taskList;
		return document.querySelector('.bx-im-list-container-recent__elements');
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

		function getChatItemElement(target) {
			if (!target) return null;

			if (IS_OL_FRAME) {
				const el = target.closest?.('.bx-messenger-cl-item');
				if (el) return el;
			}

			// Внутренние чаты / чаты задач
			const el2 = target.closest?.('.bx-im-list-recent-item__wrap');
			if (el2) return el2;

			return null;
		}

		function getChatIdFromElement(el) {
			if (!el) return '';

			if (IS_OL_FRAME) {

				return normId(el.getAttribute('data-userid') || el.dataset.userid);
			}


			return normId(
				el.getAttribute('data-id') ||
				el.dataset.id ||
				el.querySelector('[data-id]')?.getAttribute('data-id')
			);
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
	const ts = tsMap?.get?.(id) ?? -1;
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
	// Кэш текущего режима панели — устанавливается явно при переключении,
	// чтобы getLSKey/saveFilters не зависели от живого DOM во время переходов.
	// Инициализируется до первого loadFilters().
	let _currentPanelMode = getPanelModeKey();
// Кэш фильтров по режиму — изолирует вкладки браузера друг от друга:
// при переключении режима берём данные из памяти, а не перечитываем localStorage.
const _modeFiltersCache = {};
// Режимы, в которых авто-загрузка чатов уже выполнялась в текущей вкладке
const _prefetchedModes = new Set(JSON.parse((() => { try { return sessionStorage.getItem('pena.prefetchedModes'); } catch { return null; } })() || '[]'));
// Флаг активной предзагрузки — на время прокрутки отключает фильтрацию
let _prefetchActive = false;
// ── Пресеты фильтров (раздельные для "чатов" и "чатов задач") ───────────
const _LS_PRESETS_CHATS = 'pena.presets.chats';
const _LS_PRESETS_TASKS = 'pena.presets.tasks';
// Сбрасываем устаревший ключ (до v2.6)
try { localStorage.removeItem('pena.presets'); } catch {}
// Кеш массивов пресетов — загружаются лениво при первом обращении к режиму
const _presetsData = { chats: null, tasks: null };
// Активный пресет для каждого режима (null = общий режим)
const _activePresetIds = { chats: null, tasks: null };
let _debugModeActive = false;
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
			// Активный пресет мог быть удалён в другой вкладке
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
	withAttach: false,
	query: '',
	typesSelected: [],
	hideCompletedTasks: false,
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
		return { ...defaultFilters(), ...(JSON.parse(raw || '{}')) };
	} catch { return defaultFilters(); }
}
	function saveFilters() {
	_modeFiltersCache[_currentPanelMode] = JSON.parse(JSON.stringify(filters));
	try { localStorage.setItem(getLSKey(), JSON.stringify(filters)); } catch {}
}
	// Универсальное сохранение: в общее хранилище + в активный пресет (если есть)
	function persistFilters() {
		saveFilters();
		saveFiltersToActivePreset();
	}
		function ensureMultiPanel() {
			if (multiPanelHost) return multiPanelHost;

			const host = document.createElement('div');
			host.id = 'anit-multi-panel';
			host.style.cssText = [
				'position:fixed',
				'top:8px',
				'left:50%',
				'transform:translateX(-50%)',
				'z-index:9999',
				'background:#0b0d10',
				'color:#fff',
				'border-radius:10px',
				'padding:6px 10px',
				'font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial',
				'display:none',
				'box-shadow:0 8px 24px rgba(0,0,0,.35)'
			].join(';');

			host.innerHTML = `
	  <span id="anit-multi-count">0</span> выбрано
	  <span style="margin:0 8px;color:rgba(255,255,255,.4)">|</span>
	  <button data-act="later">Посмотреть позже</button>
	  <button data-act="pin">Закрепить</button>
	  <button data-act="unpin">Открепить</button>
	  <button data-act="mute">Выключить звук</button>
	  <button data-act="unmute">Включить звук</button>
	  <button data-act="hide">Скрыть</button>
	  <button data-act="leave">Выйти</button>
	  <span style="margin:0 8px;color:rgba(255,255,255,.4)">|</span>
	  <button data-act="cancel">Отмена</button>
	`;
			host.querySelectorAll('button').forEach(btn => {
				btn.style.cssText = [
					'background:#070809',
					'border:1px solid rgba(255,255,255,.25)',
					'border-radius:6px',
					'padding:2px 6px',
					'color:#fff',
					'cursor:pointer',
					'font-size:11px',
					'margin-right:4px'
				].join(';');
				btn.addEventListener('click', () => {
					const act = btn.getAttribute('data-act');
					if (act === 'cancel') { exitMultiSelectMode(); }
					else { applyMultiAction(act); }
				});
			});

			document.body.appendChild(host);
			multiPanelHost = host;
			return host;
		}

		function updateMultiPanel() {
			const host = ensureMultiPanel();
			const cnt = multiSelectedIds.size;
			const cntSpan = host.querySelector('#anit-multi-count');
			if (cntSpan) cntSpan.textContent = String(cnt);
			host.style.display = cnt > 0 ? 'block' : 'none';
			if (!cnt) exitMultiSelectMode();
		}

		function enterMultiSelectMode(firstEl) {
			if (multiSelectMode) return;
			multiSelectMode = true;
			multiSelectedIds.clear();

			const id = getChatIdFromElement(firstEl);
			if (id) {
				multiSelectedIds.add(id);
				firstEl.classList.add('anit-multi-selected');
			}
			updateMultiPanel();
			log('multi-select: ON', { first: id });
		}

		function exitMultiSelectMode() {
			if (!multiSelectMode) return;
			multiSelectMode = false;
			multiSelectedIds.clear();
			document.querySelectorAll('.anit-multi-selected').forEach(el => el.classList.remove('anit-multi-selected'));
			if (multiPanelHost) multiPanelHost.style.display = 'none';
			multiEnteredViaRmb = false;
			log('multi-select: OFF');
		}

		function toggleChatSelectionFromElement(el) {
			if (!el) return;
			const id = getChatIdFromElement(el);
			if (!id) return;
			if (multiSelectedIds.has(id)) {
				multiSelectedIds.delete(id);
				el.classList.remove('anit-multi-selected');
			} else {
				multiSelectedIds.add(id);
				el.classList.add('anit-multi-selected');
			}
			updateMultiPanel();
		}
		function applyMultiAction(kind) {
			const ids = Array.from(multiSelectedIds);
			if (!ids.length) return;

			const BXNS = window.BX || {};

			log('multiAction', { kind, ids, count: ids.length });

			const tasks = [];

			ids.forEach((dialogId) => {

				if (kind === 'pin') {
					// /bitrix/services/main/ajax.php?action=im.v2.Chat.pin
					if (!BXNS.ajax?.runAction) return;
					tasks.push(
						BXNS.ajax.runAction('im.v2.Chat.pin', {
							data: { dialogId }
						})
					);
				}
				else if (kind === 'unpin') {
					// /bitrix/services/main/ajax.php?action=im.v2.Chat.unpin
					if (!BXNS.ajax?.runAction) return;
					tasks.push(
						BXNS.ajax.runAction('im.v2.Chat.unpin', {
							data: { dialogId }
						}).catch(() => {})
					);
				}
				else if (kind === 'later') {

					// /rest/im.v2.Chat.unread.json
					if (!BXNS.rest?.callMethod) return;
					tasks.push(
						new Promise((resolve) => {
							BXNS.rest.callMethod(
								'im.v2.Chat.unread',
								{ dialogId },
								() => resolve()
							);
						})
					);
				}
				else if (kind === 'mute') {
					// /rest/im.chat.mute.json  action=Y
					if (!BXNS.rest?.callMethod) return;
					tasks.push(
						new Promise((resolve) => {
							BXNS.rest.callMethod(
								'im.chat.mute',
								{ dialog_id: dialogId, action: 'Y' },
								() => resolve()
							);
						})
					);
				}
				else if (kind === 'unmute') {
					// /rest/im.chat.mute.json  action=N
					if (!BXNS.rest?.callMethod) return;
					tasks.push(
						new Promise((resolve) => {
							BXNS.rest.callMethod(
								'im.chat.mute',
								{ dialog_id: dialogId, action: 'N' },
								() => resolve()
							);
						})
					);
				}
				else if (kind === 'hide') {
					// /rest/im.recent.hide.json
					if (!BXNS.rest?.callMethod) return;
					tasks.push(
						new Promise((resolve) => {
							BXNS.rest.callMethod(
								'im.recent.hide',
								{ DIALOG_ID: dialogId },
								() => resolve()
							);
						})
					);
				}
				else if (kind === 'leave') {

					if (!BXNS.rest?.callMethod) return;
					tasks.push(
						new Promise((resolve) => {
							BXNS.rest.callMethod(
								'im.chat.leave',
								{ DIALOG_ID: dialogId },
								() => resolve()
							);
						})
					);
				}
			});


			Promise.allSettled(tasks).finally(() => {
				exitMultiSelectMode();
				setTimeout(() => {
					try { applyFilters(); } catch (e) {}
				}, 300);
			});
		}

		function getItemMetaOL(el) {
	const id = normId(el.getAttribute('data-userid') || el.dataset.userid);
	const status = parseInt(el.getAttribute('data-status') || el.dataset.status || '0', 10) || 0;
	const hasUnread = !!el.querySelector('.bx-messenger-cl-count-digit');
	const lastText = (el.querySelector('.bx-messenger-cl-user-desc')?.textContent || '').trim().toLowerCase();
	const title = (el.querySelector('.bx-messenger-cl-user-title')?.textContent || '').trim().toLowerCase();
	const cls = el.className || '';
	const isWhatsApp = /-wz_whatsapp_/i.test(cls);
	const isTelegram = /-wz_telegram_/i.test(cls);
	const hasAttach = /\[(вложение|файл)\]/i.test(lastText);
	return { id, status, hasUnread, lastText, title, isWhatsApp, isTelegram, hasAttach, type: 'ol' };
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
		const hasUnread = getUnread();
		// «Посмотреть позже» (IM_LIB_MENU_UNREAD) — Битрикс вызывает im.v2.Chat.unread.json,
		// после чего в DOM появляется counter_number с классом --no-counter (пустой элемент,
		// число отсутствует). У обычных прочитанных чатов counter_number не рендерится вовсе.
		const _noCounterEl = el.querySelector('.bx-im-list-recent-item__counter_number');
		const hasLater = !hasUnread && !!_noCounterEl && _noCounterEl.classList.contains('--no-counter');
		const hasSelfAuthor = !!el.querySelector('.bx-im-list-recent-item__self_author-icon');
		const msgText = el.querySelector('.bx-im-list-recent-item__message_text');
		const hasAuthorAvatar = !!(msgText && msgText.querySelector('.bx-im-list-recent-item__author-avatar'));
		// Системное = нет ни стрелочки, ни аватарки (для фильтра «Скрыть системные» — скрывать все такие)
		const isSystemMessage = !hasSelfAuthor && !hasAuthorAvatar;
		// Только если 1 непрочитанное и оно системное — не показывать в «Непрочитанные»; если >1 — показываем
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

	const hasAttach = /\[(вложение|файл)\]/i.test(lastText);

	const meta = { id, hasUnread, hasLater, lastText, title, hasAttach, type: itemType, status: 0, isWhatsApp: false, isTelegram: false, isSystemMessage, isSystemUnreadOnly };

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
			document.querySelector('.bx-im-list-container-task__elements .bx-im-list-recent-item__wrap') ||
			document.querySelector('.bx-im-list-container-task__elements') ||
			document.querySelector('.bx-im-list-task__scroll-container .bx-im-list-recent-item__wrap') ||
			document.querySelector('.bx-im-list-task__scroll-container')
		);
	}

	function isTaskCompletedByLastMessage(meta) {
		const t = (meta?.lastText || '').toLowerCase();
		// Учитываем мужской/женский род и пассивные формы
		return /завершил[аи]?\s+задачу|принял[аи]?\s+задачу|задача\s+завершена|задача\s+принята/.test(t);
	}

	function matchByFilters(meta) {
	if (filters.unreadOnly && !meta.hasUnread && !meta.hasLater) return false;

	if (filters.withAttach && !meta.hasAttach) return false;
	if (filters.hideCompletedTasks && isTasksChatsModeNow()) {
		if (isTaskCompletedByLastMessage(meta)) return false;
	}
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

	// Во время предзагрузки — показываем все чаты без фильтрации
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
			const pa = a.meta.projectIndex ?? -2;
			const pb = b.meta.projectIndex ?? -2;
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
}


	// ── Функции пресетов ─────────────────────────────────────────

	// Снимок фильтров для сохранения (без определений тегов — они глобальны)
	function _snapFilters() {
		// JSON deep copy — гарантирует независимость пресетов друг от друга
		const snap = JSON.parse(JSON.stringify(filters));
		delete snap.keywordTags;      // определения тегов глобальны
		delete snap.intersectionTags;
		return snap;
	}

	// Применить пресет: восстановить фильтры + обновить весь UI
	function applyPreset(presetId) {
		_debugModeActive = false;          // сброс режима отладки при переключении пресета
		const preset = _getPresetsArr().find(p => p.id === presetId);
		if (!preset) return;
		// Всегда сохраняем текущий активный пресет перед переключением
		saveFiltersToActivePreset();
		if (_getActiveId() === presetId) {
			// Повторный клик — деактивируем, возвращаемся в общий режим
			_setActiveId(null);
			filters = loadFilters();
		} else {
			_setActiveId(presetId);
			// Определения тегов глобальны — не перезаписываем из пресета
			const kwTags = filters.keywordTags ? [...filters.keywordTags] : [];
			const ixTags = filters.intersectionTags ? [...filters.intersectionTags] : [];
			// Deep copy — чтобы мутации filters не влияли на сохранённый снимок пресета
			const pf = JSON.parse(JSON.stringify(preset.filters));
			filters = { ...defaultFilters(), ...pf, keywordTags: kwTags, intersectionTags: ixTags };
		}
		uiFromFilters(filtersHost); // обновляет чекбоксы, теги, категории и т.д.
		applyFilters();
		renderPresetsUI(filtersHost);
	}

	// Зафиксировать текущие фильтры в активном пресете
	function saveFiltersToActivePreset() {
		const activeId = _getActiveId();
		if (!activeId) return;
		const preset = _getPresetsArr().find(p => p.id === activeId);
		if (preset) { preset.filters = _snapFilters(); _saveCustomPresets(); }
	}

	// ─── Режим отладки: вспомогательные функции ───────────────────────────────
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
	function _showPresetToast(msg) {
		const toast = filtersHost?.querySelector('#anit_preset_toast');
		if (!toast) return;
		toast.textContent = msg;
		toast.classList.add('--show');
		if (_toastTimer) clearTimeout(_toastTimer);
		_toastTimer = setTimeout(() => toast.classList.remove('--show'), 2400);
	}

	function _showPresetConfirm(msg, okLabel, cancelLabel, onOk) {
		const overlay = filtersHost?.querySelector('#anit_preset_confirm');
		if (!overlay) { onOk(); return; }
		overlay.innerHTML = '';
		const p = document.createElement('p');
		p.textContent = msg;
		const btns = document.createElement('div');
		btns.className = 'confirm-btns';
		const ok = document.createElement('button');
		ok.type = 'button'; ok.className = '--ok'; ok.textContent = okLabel;
		const cancel = document.createElement('button');
		cancel.type = 'button'; cancel.textContent = cancelLabel;
		const hide = () => overlay.classList.remove('--show');
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
				_presetsData[_pMode()] = _getPresetsArr().filter(x => x.id !== p.id);
				if (_getActiveId() === p.id) {
					_setActiveId(null);
					_debugModeActive = false;
					_updateDebugUI(host);
				}
				_saveCustomPresets();
				renderPresetManagePanel(host);
				renderPresetsUI(host);
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
	host.style.top   = (pos.top  ?? 0) + 'px';
	return true;
} catch { return false; }
}
		function uiFromFilters(host){
			host.querySelector('#anit_unread').checked = !!filters.unreadOnly;
			const _attachEl = host.querySelector('#anit_attach');
			if (_attachEl) _attachEl.checked = !!filters.withAttach;
			host.querySelector('#anit_query').value = String(filters.query || '');
			const hc = host.querySelector('#anit_hide_completed');
			if (hc) hc.checked = !!filters.hideCompletedTasks;
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
			// определены внутри buildFiltersPanel и недоступны из этой области видимости — обновляем напрямую)
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
			filters.withAttach = host.querySelector('#anit_attach')?.checked || false;
			filters.query      = host.querySelector('#anit_query').value;
			filters.hideCompletedTasks = host.querySelector('#anit_hide_completed')?.checked || false;
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
	let dragging = false, moved = false, startX=0, startY=0, startLeft=0, startTop=0;

	const keepInsideViewport = () => {
	const r = host.getBoundingClientRect();
	let left = parseInt(host.style.left || '0', 10) || 0;
	let top  = parseInt(host.style.top  || '0', 10) || 0;
	const maxLeft = Math.max(0, window.innerWidth  - r.width);
	const maxTop  = Math.max(0, window.innerHeight - r.height);
	host.style.left = clamp(left, 0, maxLeft) + 'px';
	host.style.top  = clamp(top,  0, maxTop)  + 'px';
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
};

	const onPointerDown = (e) => {
	if (e.type === 'mousedown' && e.button !== 0) return;
	const t = e.target;
	// Запрещаем перетаскивание при клике на интерактивные/скролл элементы
	if (t && (t.closest?.('button, input, select, textarea, a, [contenteditable], #anit_scr_thumb, #anit_scr_track, .pena-resize-handle, .pm-drag') || t.isContentEditable)) return;
	// Запрещаем drag в зонах ресайза (края окна) — там должен работать resize
	{
		const _r = host.getBoundingClientRect(), _E = 6;
		const cx = e.touches?.[0]?.clientX ?? e.clientX ?? 0;
		const cy = e.touches?.[0]?.clientY ?? e.clientY ?? 0;
		if (cx <= _r.left + _E || cx >= _r.right - _E || cy >= _r.bottom - _E) return;
	}
	dragging = true;
	moved = false;
	host.classList.add('anit-dragging');
	startLeft = parseInt(host.style.left || (window.innerWidth - host.offsetWidth - 10) + '', 10) || 0;
	startTop  = parseInt(host.style.top  || '8', 10) || 0;
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


	(host.querySelector('.header') || host).addEventListener('dblclick', () => {
	const listCol = IS_OL_FRAME
	? findContainerOL()
	: document.querySelector('.bx-im-list-container-recent__elements')?.closest('.bx-im-list-container-recent__container')
	|| document.querySelector('.bx-im-list-container-recent__elements');

	const vr = document.documentElement.getBoundingClientRect();
	const rr = listCol?.getBoundingClientRect();
	const currentLeft = parseInt(host.style.left || '0', 10) || 0;
	let top = 8, left = (vr.width - host.offsetWidth - 10);
	if (rr) {
	top  = Math.max(8, rr.top + 8);
	left = Math.min(vr.width - host.offsetWidth - 10, rr.right - host.offsetWidth - 10);
}
	const maxLeft = Math.max(0, vr.width - host.offsetWidth);
	if (left < 8) left = currentLeft > 8 ? currentLeft : 8;
	host.style.left  = `${clamp(left, 8, maxLeft)}px`;
	host.style.top   = `${Math.max(0, top)}px`;
	try { localStorage.removeItem(POS_LS_KEY(mode)); } catch{}
});


		function hotkeyHandler(e){
			// Ctrl+1..9 — быстрый выбор пресета по слоту
			if (e.ctrlKey && !e.altKey && !e.shiftKey) {
				const _d = e.code;
				if (_d >= 'Digit1' && _d <= 'Digit9') {
					// Перехватываем везде — кроме полей ввода внутри самой панели расширения
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

			// Ctrl+Alt+F — показать/скрыть панель
			if (e.ctrlKey && e.altKey && e.code === 'KeyF') {
				const pane = document.getElementById('anit-filters');
				if (!pane) return;
				const mini = pane.querySelector('#anit_mini_toggle');
				const full = pane.querySelector('#anit_toggle_btn');
				(mini || full)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

				e.stopImmediatePropagation();
				e.preventDefault();
				return;
			}

			// Ctrl+Shift+A — сброс всех фильтров
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

			// Ctrl+Q — подавляем нежелательное действие Bitrix24 вне полей ввода
			if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === 'KeyQ') {
				const _ae = document.activeElement;
				const _tag = _ae?.tagName?.toLowerCase();
				if (_tag === 'input' || _tag === 'textarea' || _tag === 'select') return;
				e.stopImmediatePropagation();
				e.preventDefault();
				return;
			}

		}


		document.addEventListener('keydown', hotkeyHandler, true);
		window.addEventListener('keydown', hotkeyHandler, true);


	keepInsideViewport();
	window.addEventListener('resize', keepInsideViewport);
}


	let filtersHost = null;

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
#anit-filters{position:fixed;top:8px;left:8px;z-index:9999;width:360px;min-width:360px;max-width:90vw;transition:opacity .4s ease}
#anit-filters.anit-hidden{max-width:none !important;width:24px !important;height:24px !important}
#anit-filters.anit-hidden .pane{display:none !important}
#anit-filters .mini-toggle{display:none;width:30px;height:30px;border:1px solid rgba(255,255,255,.3);border-radius:9px;background:#0b0d10;color:#fff;align-items:center;justify-content:center;cursor:move;box-shadow:0 4px 18px rgba(0,0,0,.6);transition:border-color .15s,box-shadow .15s}
#anit-filters.anit-hidden .mini-toggle{display:inline-flex}
#anit-filters .mini-toggle:hover{border-color:rgba(255,255,255,.55);box-shadow:0 6px 22px rgba(0,0,0,.7)}
#anit-filters .mini-toggle svg{width:14px;height:14px;display:block;fill:#ffffff;opacity:.9}
#anit-filters .pane{background:#0b0d10;color:#fff;border:1px solid rgba(255,255,255,.15);
  border-radius:12px;padding:10px 12px;font:12px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Arial;
  box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:grab;
  position:relative;width:100%;box-sizing:border-box;overflow-y:scroll;overflow-x:clip;scrollbar-width:none;max-height:90vh;}
#anit-filters .pane::-webkit-scrollbar{display:none}
/* Кастомный скроллбар — позиционируется снаружи .pane, справа от панели */
#anit-filters #anit_scr_track{position:absolute;right:-10px;top:0;bottom:0;width:5px;background:rgba(255,255,255,.06);border-radius:3px;display:none;z-index:10001;cursor:pointer}
#anit-filters #anit_scr_thumb{position:absolute;left:0;right:0;background:rgba(255,255,255,.25);border-radius:3px;min-height:20px;cursor:grab;transition:background .15s}
#anit-filters #anit_scr_thumb:hover,#anit-filters #anit_scr_track:hover #anit_scr_thumb{background:rgba(255,255,255,.42)}
#anit-filters #anit_scr_thumb:active{cursor:grabbing}
#anit-filters .pena-resize-handle{position:absolute;bottom:3px;right:3px;width:18px;height:18px;
  cursor:se-resize;border-right:2px solid rgba(255,255,255,.22);border-bottom:2px solid rgba(255,255,255,.22);
  border-radius:0 0 7px 0;transition:border-color .15s;z-index:5}
#anit-filters .pena-resize-handle:hover{border-color:rgba(255,255,255,.5)}
/* Курсор при ресайзе за края — перекрывает cursor:grab на .pane и других дочерних элементах */
#anit-filters.rz-e,#anit-filters.rz-e *{cursor:e-resize!important}
#anit-filters.rz-w,#anit-filters.rz-w *{cursor:w-resize!important}
#anit-filters.rz-s,#anit-filters.rz-s *{cursor:s-resize!important}
#anit-filters.rz-se,#anit-filters.rz-se *{cursor:se-resize!important}
#anit-filters.rz-sw,#anit-filters.rz-sw *{cursor:sw-resize!important}
#anit-filters .header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px 0;cursor:move}
#anit-filters .header-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto;position:relative}
#anit-filters .icon-btn{width:22px;height:22px;border:1px solid rgba(255,255,255,.25);border-radius:6px;background:#070809;color:#fff;cursor:pointer;line-height:1;display:inline-flex;align-items:center;justify-content:center;padding:0}
#anit-filters .icon-btn svg{width:14px;height:14px;display:block;fill:#ffffff;opacity:.92}
#anit-filters .icon-btn:hover{border-color:rgba(255,255,255,.45)}
#anit-filters .opts-pop{display:none;position:absolute;top:26px;right:0;width:292px;max-width:calc(100vw - 24px);background:#0b0d10;color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:10px;box-shadow:0 12px 34px rgba(0,0,0,.45);z-index:10001}
#anit-filters .opts-pop.show{display:block}
#anit-filters .opts-title{font-size:12px;font-weight:700;margin:0 0 6px 0}
#anit-filters .opts-host{font-size:11px;opacity:.8;margin:0 0 8px 0;word-break:break-word}
#anit-filters .opts-line{display:flex;align-items:center;gap:8px;margin:6px 0}
#anit-filters .opts-field{margin:8px 0}
#anit-filters .opts-field input{width:90%}
#anit-filters .opts-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
#anit-filters .opts-status{margin-top:6px;min-height:14px}
#anit-filters .brand{display:flex;align-items:center;gap:8px;min-width:0}
#anit-filters .brand-icon{width:20px;height:20px;display:inline-flex;flex:0 0 20px}
#anit-filters .brand-logo{height:20px;width:auto;max-width:120px;filter:invert(1);mix-blend-mode:screen;flex-shrink:0;display:block}
#anit-filters .brand-title{font-size:12px;font-weight:700;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#anit-filters .brand-sub{font-size:13px;font-weight:700;opacity:.95;letter-spacing:.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#anit-filters .group{margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1)}
#anit-filters .group-title{font-size:11px;font-weight:700;letter-spacing:.2px;text-transform:uppercase;opacity:.78;margin:0 0 6px 0}
#anit-filters .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:4px 0}
#anit-filters label{display:flex;align-items:center;gap:6px;white-space:nowrap;cursor:pointer}
#anit-filters input[type="checkbox"]{
  -webkit-appearance:none;appearance:none;
  width:14px;height:14px;min-width:14px;
  margin:0;
  border:1px solid rgba(255,255,255,.95);
  border-radius:3px;
  background:#070809;
  display:inline-grid;place-content:center;
  cursor:pointer;
}
#anit-filters input[type="checkbox"]::before{
  content:"";
  width:4px;height:8px;
  border:solid #ffffff;
  border-width:0 2px 2px 0;
  transform:rotate(45deg) scale(0);
  transform-origin:center;
  transition:transform .12s ease;
}
#anit-filters input[type="checkbox"]:checked::before{transform:rotate(45deg) scale(1)}
#anit-filters input[type="text"]{padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#070809;color:#fff;outline:none}
#anit-filters #anit_query{width:100%}
#anit-filters #anit_project_input,#anit-filters #anit_responsible_input{width:90%}
#anit-filters .project-wrap{position:relative;flex:1 1 220px;min-width:0;max-width:100%}
#anit-filters #anit_projects_row{align-items:center}
#anit-filters #anit_projects_row .muted{flex:0 0 auto}
#anit-filters #anit_projects_row #anit_project_suggest{top:34px;left:0;right:0;max-width:100%;box-sizing:border-box}
#anit-filters #anit_responsibles_row{align-items:center}
#anit-filters #anit_responsibles_row .muted{flex:0 0 auto}
#anit-filters #anit_responsibles_row #anit_responsible_suggest{top:34px;left:0;right:0;max-width:100%;box-sizing:border-box}
#anit-filters #anit_status_row{align-items:center}
#anit-filters #anit_status_row .muted{flex:0 0 auto}
#anit-filters #anit_status_row #anit_status_suggest{top:34px;left:0;right:0;max-width:100%;box-sizing:border-box}
#anit-filters select{padding:3px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:#070809;color:#fff}
#anit-filters .muted{opacity:.75}
#anit-filters .actions{display:flex;gap:8px;margin-top:2px;flex-wrap:wrap}
#anit-filters button{padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#070809;color:#fff;cursor:pointer}
#anit-filters .anit-toggle,#anit-filters .category-toggle{padding:0 !important;line-height:1;box-sizing:border-box;flex-shrink:0}
#anit-filters .btn-primary{background:#2b7fff;border-color:#2b7fff;color:#fff}
#anit-filters .btn-secondary{background:#2a2f38;border-color:rgba(255,255,255,.25);color:#fff}
#anit-filters .btn-tertiary{background:transparent;border-color:rgba(255,255,255,.3);color:#d6dce5}
#anit-filters .kbd{padding:1px 4px;border:1px solid rgba(255,255,255,.3);border-radius:4px;font-family:monospace;font-size:11px}
#anit-filters .chips{display:flex;flex-wrap:wrap;gap:6px}
#anit-filters .chip{display:inline-flex;gap:6px;align-items:center;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:3px 8px;background:#070809}
#anit-filters .chip input{accent-color:#5dc}
#anit-filters .kw-tag-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:3px 10px;background:#070809;cursor:pointer;font-size:12px;color:#b8c6dc;transition:all .12s ease;white-space:nowrap}
#anit-filters .kw-tag-chip.is-active{background:rgba(21,135,250,.22);border-color:#1587fa;color:#fff}
#anit-filters .kw-tag-chip .tag-rm{margin-left:2px;opacity:.55;cursor:pointer;font-size:10px;line-height:1}
#anit-filters .kw-tag-chip .tag-rm:hover{opacity:1;color:#f66}
#anit-filters .tag-confirm-pop{position:absolute;inset:0;background:rgba(11,13,16,.88);display:flex;align-items:center;justify-content:center;z-index:999;border-radius:inherit}
#anit-filters .tag-confirm-box{background:#1a1f2a;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:16px 20px;text-align:center;min-width:180px}
#anit-filters .tag-confirm-text{font-size:13px;color:#dce4ef;margin-bottom:12px;line-height:1.4}
#anit-filters .tag-confirm-btns{display:flex;gap:8px;justify-content:center}
#anit-filters .tag-confirm-cancel{padding:5px 14px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#9ab;cursor:pointer;font-size:12px}
#anit-filters .tag-confirm-ok{padding:5px 14px;border-radius:6px;border:1px solid rgba(220,50,50,.5);background:rgba(220,50,50,.15);color:#f88;cursor:pointer;font-size:12px}
#anit-filters #anit_tag_add_input{flex:1;min-width:80px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#070809;color:#fff;outline:none;font-size:12px}
#anit-filters #anit_tag_add_btn{flex-shrink:0;align-self:stretch;display:flex;align-items:center;justify-content:center;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#070809;color:#b8c6dc;cursor:pointer;font-size:14px;line-height:1}
#anit-filters #anit_tag_add_btn:hover{border-color:#1587fa;color:#fff}
#anit-filters #anit_itag_add_input{flex:1;min-width:80px;padding:6px 8px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#070809;color:#fff;outline:none;font-size:12px}
#anit-filters #anit_itag_add_btn{flex-shrink:0;align-self:stretch;display:flex;align-items:center;justify-content:center;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#070809;color:#b8c6dc;cursor:pointer;font-size:14px;line-height:1}
#anit-filters #anit_itag_add_btn:hover{border-color:#1587fa;color:#fff}
/* Help popup */
#anit-filters .help-popup{display:none;position:absolute;top:28px;right:0;background:#0f1117;border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:10px 12px;box-shadow:0 8px 28px rgba(0,0,0,.55);z-index:10001;white-space:nowrap}
#anit-filters .help-popup.--show{display:block}
#anit-filters .help-popup .hp-title{font-size:10px;font-weight:700;color:rgba(255,255,255,.32);text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px}
#anit-filters .help-popup table{border-collapse:collapse;font-size:11px}
#anit-filters .help-popup td{padding:2px 0;color:#b8c6dc;vertical-align:middle}
#anit-filters .help-popup td:first-child{padding-right:10px;white-space:nowrap}
#anit-filters .pena-prefetch-popup{position:absolute;inset:0;z-index:1000;background:rgba(11,13,16,.88);display:flex;align-items:center;justify-content:center;border-radius:12px}
#anit-filters .pena-prefetch-box{background:#1a1f2a;border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:12px 16px;width:190px;box-shadow:0 4px 20px rgba(0,0,0,.55)}
#anit-filters .pena-prefetch-handle{font-size:13px;font-weight:600;color:#fff;margin-bottom:10px;cursor:move;user-select:none}
#anit-filters .pena-prefetch-sub{font-size:11px;color:#7a8ca0;margin-top:6px}
#anit-filters .pena-prefetch-bar-wrap{height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;margin-bottom:2px}
#anit-filters .pena-prefetch-bar{height:100%;width:0%;background:linear-gradient(90deg,#1587fa,#4fb6ff);border-radius:3px;transition:width .15s ease}
#anit-filters .pena-prefetch-cancel{margin-top:8px;width:100%;padding:5px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#9ab;cursor:pointer;font-size:11px;box-sizing:border-box}
#anit-filters .pena-prefetch-cancel:hover{border-color:#f66;color:#f88}
#anit-filters .type-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;width:100%}
#anit-filters .anit-type-chip{display:flex;align-items:center;justify-content:center;width:100%;min-height:26px;padding:4px 6px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.04);color:#bac7da;cursor:pointer;font-size:11px;line-height:1.2;text-align:center;transition:background .12s,border-color .12s,color .12s;box-sizing:border-box}
#anit-filters .anit-type-chip:hover{border-color:rgba(255,255,255,.32);background:rgba(255,255,255,.09);color:#e2eaf5}
#anit-filters .anit-type-chip.is-selected{background:rgba(21,135,250,.22);border-color:#1587fa;color:#fff}
#anit-filters .group{position:relative}
#anit-filters .group-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
#anit-filters .category-toggle{width:22px;height:22px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.04);color:#9ab;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:border-color .15s,background .15s}
#anit-filters .category-toggle:hover{border-color:rgba(255,255,255,.4);background:rgba(255,255,255,.09)}
#anit-filters .category-toggle svg{display:block;width:11px;height:11px;fill:none;stroke:#b8c4d4;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}
#anit-filters .group.is-collapsed .category-toggle svg{transform:rotate(-90deg)}
#anit-filters .group.is-collapsed .group-body{display:none}
#anit-filters .chip-remove:hover{color:#fff}
#anit-filters .anit-hidden-row .project-wrap{position:relative}
#anit-filters #anit_hidden_project_input,#anit-filters #anit_hidden_responsible_input{width:100%;box-sizing:border-box}
.anit-multi-selected {background: rgba(93, 220, 200, 0.15) !important;}
.anit-multi-selected::before {content: '✓';position: absolute;left: 6px;top: 50%;transform: translateY(-50%);font-size: 12px;color: #5dc;z-index: 2;}
.bx-im-list-recent-item__wrap.anit-multi-selected, .bx-messenger-cl-item.anit-multi-selected {position: relative;}
#anit-filters .presets-row{display:flex;flex-wrap:wrap;gap:4px;margin:2px 0}
#anit-filters .preset-btn{padding:3px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#b8c1cf;font-size:11px;cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap;line-height:1.5}
#anit-filters .preset-btn:hover{background:rgba(255,255,255,.15);color:#fff}
#anit-filters .preset-btn.--active{background:rgba(46,95,163,.85);border-color:#4a7fc0;color:#fff}
#anit-filters .pm-header{font-size:10px;font-weight:600;color:rgba(255,255,255,.32);text-transform:uppercase;letter-spacing:.07em;margin-bottom:7px}
#anit-filters .pm-row{display:flex;align-items:center;gap:5px;padding:2px 0;border-radius:6px;transition:background .1s}
#anit-filters .pm-row.drag-over{background:rgba(21,135,250,.1);outline:1px dashed rgba(21,135,250,.35);outline-offset:-1px}
#anit-filters .pm-drag{cursor:grab;padding:0 3px;opacity:.3;flex-shrink:0;display:flex;align-items:center;color:#fff;user-select:none;touch-action:none}
#anit-filters .pm-drag:hover{opacity:.7}
#anit-filters .pm-drag:active{cursor:grabbing}
#anit-filters .pm-inp{flex:1;padding:4px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#e9edf1;font-size:11px;min-width:0;outline:none;transition:border-color .15s,background .15s}
#anit-filters .pm-inp:focus{border-color:rgba(21,135,250,.55);background:rgba(21,135,250,.07)}
#anit-filters .pm-del{flex-shrink:0;width:22px;align-self:stretch;padding:0;box-sizing:border-box;border-radius:5px;border:1px solid rgba(255,80,80,.22);background:rgba(255,80,80,.07);color:rgba(255,110,110,.65);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}
#anit-filters .pm-del:hover{border-color:rgba(255,80,80,.55);background:rgba(255,80,80,.22);color:#f99}
#anit-filters .pm-add-section{border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:6px}
#anit-filters .pm-add-label{font-size:10px;color:rgba(255,255,255,.32);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px}
#anit-filters .pm-add-row{display:flex;gap:4px}
#anit-filters .pm-add-inp{flex:1;min-width:0;padding:5px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:#e9edf1;font-size:11px;outline:none;transition:border-color .15s}
#anit-filters .pm-add-inp:focus{border-color:rgba(21,135,250,.5)}
#anit-filters .pm-add-btn{padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#c8d0dc;cursor:pointer;font-size:11px;white-space:nowrap;transition:all .15s}
#anit-filters .pm-add-btn:hover{background:rgba(255,255,255,.14);color:#fff}
#anit-filters .pm-empty{font-size:11px;color:rgba(255,255,255,.28);padding:4px 2px 6px;text-align:center}
#anit-filters #anit_preset_manage_panel,#anit-filters #anit_cat_manage_panel{position:absolute;left:0;right:0;top:30px;z-index:200;background:#0c0e14;border:1px solid rgba(255,255,255,.18);border-radius:9px;padding:10px;box-shadow:0 10px 30px rgba(0,0,0,.6)}
#anit-filters.anit-debug-mode .pane{outline:4px solid #f59e0b;outline-offset:-2px;border-radius:12px}
#anit-filters.anit-dragging,#anit-filters.anit-dragging .pane{cursor:grabbing !important;user-select:none}
/* debug-badge внутри панели скрыт — индикатор вынесен над окном (#anit_debug_overlay) */
#anit-filters .debug-badge{display:none !important}
/* Overlay «Режим отладки» — над окном расширения */
#anit-filters #anit_debug_overlay{position:absolute;bottom:calc(100% + 5px);left:0;right:0;display:none;justify-content:center;pointer-events:none;z-index:2147483647}
#anit-filters.anit-debug-mode #anit_debug_overlay{display:flex}
#anit-filters .anit-debug-flag{font-size:11px;font-weight:600;color:#f59e0b;background:rgba(11,13,16,.92);border:1px solid rgba(245,158,11,.55);border-radius:7px;padding:3px 11px;white-space:nowrap;letter-spacing:.15px;box-shadow:0 2px 8px rgba(0,0,0,.5)}
/* Тост (уведомления) — над окном расширения, не внутри */
.anit-preset-toast{position:absolute;bottom:calc(100% + 6px);left:0;right:0;text-align:center;background:#1a1d23;border:1px solid rgba(245,158,11,.5);color:#f59e0b;padding:6px 16px;border-radius:10px;font-size:12px;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .25s;white-space:normal;box-shadow:0 4px 14px rgba(0,0,0,.5)}
.anit-preset-toast.--show{opacity:1}
.anit-preset-toast.--ok{border-color:rgba(93,200,126,.5);color:#5dc87e}
/* Update check button */
#anit-filters #anit_update_btn{position:relative}
#anit-filters .update-dot{position:absolute;top:-3px;right:-3px;width:7px;height:7px;background:#ef4444;border-radius:50%;border:1px solid #0b0d10;pointer-events:none;display:none}
#anit-filters #anit_update_btn.--checking svg{animation:anit-spin .7s linear infinite}
@keyframes anit-spin{to{transform:rotate(360deg)}}
/* Update banner — multi-state */
#anit-filters .update-banner{margin-top:4px;margin-left:-12px;margin-right:-12px;padding:8px 22px;background:rgba(230,168,0,.09);border-top:1px solid rgba(230,168,0,.28);border-bottom:1px solid rgba(230,168,0,.28);border-left:none;border-right:none;border-radius:0;font-size:11px;color:#e6a800}
#anit-filters .ubp-top-row{display:flex;align-items:center;gap:6px}
#anit-filters .update-banner-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#anit-filters .ubp-install-btn{flex-shrink:0;padding:3px 9px;border-radius:6px;border:1px solid rgba(230,168,0,.5);background:rgba(230,168,0,.12);color:#f0b820;font-size:11px;cursor:pointer;white-space:nowrap;font-family:inherit;transition:all .15s}
#anit-filters .ubp-install-btn:hover:not(:disabled){background:rgba(230,168,0,.22);color:#fcd34d}
#anit-filters .ubp-install-btn:disabled{opacity:.45;cursor:default}
#anit-filters .update-banner-close{flex-shrink:0;background:none;border:none;color:rgba(255,255,255,.35);font-size:15px;cursor:pointer;line-height:1;padding:0;font-family:inherit}
#anit-filters .update-banner-close:hover{color:rgba(255,255,255,.65)}
#anit-filters .ubp-progress{margin-top:6px}
#anit-filters .ubp-label-row{display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px;opacity:.7}
#anit-filters .ubp-track{height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden}
#anit-filters .ubp-fill{height:100%;background:#f0b820;border-radius:2px;transition:width .3s ease;width:0%}
@keyframes anit-dl-slide{to{background-position:32px 0}}
#anit-filters .ubp-fill.--indet{width:100% !important;transition:none;background:repeating-linear-gradient(90deg,#e6a800 0,#f0b820 16px,#e6a800 32px);background-size:32px 100%;animation:anit-dl-slide .8s linear infinite}
#anit-filters .ubp-done-row{display:flex;align-items:center;justify-content:space-between;margin-top:6px;gap:8px}
#anit-filters .ubp-done-row>span{color:#5dc87e;font-size:11px}
#anit-filters .ubp-restart{padding:3px 10px;border-radius:6px;border:1px solid rgba(93,200,126,.4);background:rgba(93,200,126,.12);color:#5dc87e;font-size:11px;cursor:pointer;font-family:inherit;transition:all .15s}
#anit-filters .ubp-restart:hover{background:rgba(93,200,126,.24);color:#7ddfa0}
#anit-filters .ubp-impossible-row{display:flex;align-items:center;justify-content:space-between;margin-top:6px;gap:8px}
#anit-filters .ubp-imp-text{flex:1;font-size:11px;color:#ef9090}
#anit-filters .ubp-imp-close{flex-shrink:0;background:none;border:none;color:rgba(255,255,255,.35);font-size:15px;cursor:pointer;line-height:1;padding:0;font-family:inherit}
#anit-filters .ubp-imp-close:hover{color:rgba(255,255,255,.65)}
#anit-filters .update-banner.--downloading{border-color:rgba(230,168,0,.45)}
#anit-filters .update-banner.--done{background:rgba(93,200,126,.07);border-color:rgba(93,200,126,.3);color:#5dc87e}
#anit-filters .update-banner.--done .ubp-install-btn{display:none}
#anit-filters .update-banner.--impossible{background:rgba(255,60,60,.07);border-color:rgba(255,60,60,.25);color:#ef9090}
#anit-filters .update-banner.--impossible .ubp-install-btn{display:none}
#anit-filters .update-banner.--error{background:rgba(255,60,60,.08);border-color:rgba(255,60,60,.25);color:#ef9090}
/* Версия — нижний правый угол панели */
#anit-filters .pena-ver-badge{position:sticky;bottom:4px;text-align:right;font-size:9px;color:rgba(255,255,255,.22);pointer-events:none;user-select:none;padding:6px 2px 0;line-height:1;letter-spacing:.2px}
.anit-preset-confirm{position:absolute;inset:0;background:rgba(5,6,9,.92);border-radius:12px;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:10;padding:20px;text-align:center}
.anit-preset-confirm.--show{display:flex}
.anit-preset-confirm p{color:#c8d0dc;font-size:12px;line-height:1.5;margin:0}
.anit-preset-confirm .confirm-btns{display:flex;gap:8px}
.anit-preset-confirm .confirm-btns button{padding:5px 14px;border-radius:7px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;font-size:11px;cursor:pointer;transition:background .15s}
.anit-preset-confirm .confirm-btns button.--ok{background:rgba(245,158,11,.18);border-color:rgba(245,158,11,.5);color:#f59e0b}
.anit-preset-confirm .confirm-btns button.--ok:hover{background:rgba(245,158,11,.32)}
#anit-filters .opacity-wrap{display:inline-flex;align-items:center;gap:3px;cursor:default;opacity:.65;transition:opacity .15s}
#anit-filters .opacity-wrap:hover{opacity:1}
#anit-filters #anit_opacity_slider{-webkit-appearance:none;appearance:none;width:54px;height:2px;border-radius:2px;background:rgba(255,255,255,.2);cursor:pointer;outline:none;border:none;padding:0;margin:0;vertical-align:middle;flex-shrink:0}
#anit-filters #anit_opacity_slider::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#4a90d9;border:2px solid #1d3550;cursor:pointer;transition:background .15s,transform .1s;box-shadow:0 1px 4px rgba(0,0,0,.5)}
#anit-filters #anit_opacity_slider::-webkit-slider-thumb:hover{background:#6ab0ff;transform:scale(1.2)}
#anit-filters #anit_opacity_slider::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#4a90d9;border:2px solid #1d3550;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.5)}
#anit-filters #anit_opacity_slider::-moz-range-track{height:2px;border-radius:2px;background:rgba(255,255,255,.2);border:none}

/* Locked state: пресет активен, режим отладки не включён */
#anit-filters.preset-locked .kw-tag-chip:not(.is-active){opacity:.22;pointer-events:none}
#anit-filters.preset-locked .kw-tag-chip.is-active{pointer-events:none}
#anit-filters.preset-locked .kw-tag-chip .tag-rm{display:none}
#anit-filters.preset-locked .anit-type-chip:not(.is-selected){opacity:.22;pointer-events:none}
#anit-filters.preset-locked .anit-type-chip.is-selected{pointer-events:none}
#anit-filters.preset-locked #anit_query{pointer-events:none;opacity:.45}
#anit-filters.preset-locked #anit_tag_add_btn,
#anit-filters.preset-locked #anit_itag_add_btn,
#anit-filters.preset-locked #anit_tag_add_input,
#anit-filters.preset-locked #anit_itag_add_input{pointer-events:none;opacity:.2}
#anit-filters.preset-locked .chips,
#anit-filters.preset-locked .type-grid{cursor:default}
</style>
<div class="pane">
  <div id="anit_update_notice" style="display:none;align-items:center;gap:8px;background:rgba(93,200,126,.1);border-top:none;border-bottom:1px solid rgba(93,200,126,.25);border-left:none;border-right:none;border-radius:0;padding:6px 22px;margin:-10px -12px 8px -12px">
    <span id="anit_update_notice_text" style="flex:1;font-size:11px;color:#5dc87e"></span>
    <button type="button" id="anit_update_notice_close" style="background:none;border:none;color:rgba(255,255,255,.4);cursor:pointer;font-size:16px;line-height:1;padding:0 2px;flex-shrink:0" title="Закрыть">×</button>
  </div>
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
      <div class="opacity-wrap" title="Прозрачность панели">
        <svg viewBox="0 0 24 24" style="width:11px;height:11px;fill:#aaa;flex-shrink:0" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        <input type="range" id="anit_opacity_slider" min="20" max="100" step="5">
      </div>
      <button id="anit_help_btn" class="icon-btn" type="button" title="Горячие клавиши">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="width:13px;height:13px;fill:#fff;opacity:.65;display:block"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>
      </button>
      <div id="anit_help_popup" class="help-popup">
        <div class="hp-title">Горячие клавиши</div>
        <table>
          <tr><td><span class="kbd">Ctrl</span>+<span class="kbd">Alt</span>+<span class="kbd">F</span></td><td>Показать / скрыть панель</td></tr>
          <tr><td><span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">A</span></td><td>Сброс всех фильтров</td></tr>
          <tr><td><span class="kbd">Ctrl</span>+<span class="kbd">1</span>…<span class="kbd">9</span></td><td>Быстрый выбор пресета</td></tr>
        </table>
      </div>
      <button id="anit_update_btn" class="icon-btn" type="button" title="Проверить обновления">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="width:13px;height:13px;fill:#fff;opacity:.75;display:block"><path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
        <span class="update-dot" id="anit_update_dot"></span>
      </button>
      <button id="anit_toggle_btn" class="anit-toggle icon-btn" type="button" title="Скрыть/показать (Ctrl+Alt+F)"><svg viewBox="0 0 24 24" style="width:12px;height:12px;display:block;fill:#fff" aria-hidden="true"><path d="M19 13H5v-2h14v2z"/></svg></button>
    </div>
  </div>
  <div class="update-banner" id="anit_update_banner" style="display:none">
    <div class="ubp-top-row">
      <span class="update-banner-text" id="anit_update_banner_text">Доступно обновление</span>
      <button type="button" class="ubp-install-btn" id="anit_update_banner_link">Установить</button>
      <button type="button" class="update-banner-close" id="anit_update_banner_close" title="Закрыть">×</button>
    </div>
    <div class="ubp-progress" id="anit_ubp_progress" style="display:none">
      <div class="ubp-label-row">
        <span id="anit_ubp_label">Загрузка...</span>
        <span id="anit_ubp_pct">0%</span>
      </div>
      <div class="ubp-track"><div class="ubp-fill" id="anit_ubp_fill"></div></div>
    </div>
    <div class="ubp-done-row" id="anit_ubp_done" style="display:none">
      <div style="flex:1">
        <div style="color:#5dc87e;font-size:11px;margin-bottom:4px">✓ Загружено</div>
        <div style="font-size:10px;color:rgba(255,255,255,.5);line-height:1.45;margin-bottom:6px">Приложение закроется и автоматически откроется снова</div>
        <button type="button" class="ubp-restart" id="anit_ubp_close_app">Перезапустить</button>
      </div>
    </div>
    <div class="ubp-impossible-row" id="anit_ubp_impossible" style="display:none">
      <span class="ubp-imp-text">Обновление невозможно — обратитесь к администратору</span>
      <button type="button" class="ubp-imp-close" id="anit_ubp_impossible_close" title="Закрыть">×</button>
    </div>
  </div>

  <div class="anit-preset-confirm" id="anit_preset_confirm"></div>
  <div class="group">
    <div class="group-head">
      <div class="group-title">Пресеты</div>
      <div style="display:flex;gap:4px;align-items:center">
        <span class="debug-badge" id="anit_debug_badge">&#9881; Отладка</span>
        <button type="button" id="anit_preset_debug_btn" class="icon-btn" title="Войти в режим отладки (разблокировать фильтры)">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="width:14px;height:14px;fill:#f59e0b;display:block"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
        </button>
        <button type="button" id="anit_preset_manage_btn" class="icon-btn" title="Управление пресетами">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="width:13px;height:13px;display:block;fill:#fff;opacity:.8">
            <path d="M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="presets-row" id="anit_presets_row"></div>
    <div id="anit_preset_manage_panel" style="display:none">
      <div class="pm-header">Управление пресетами</div>
      <div id="anit_preset_list_edit"></div>
      <div class="pm-add-section">
        <div class="pm-add-label">Новый пресет</div>
        <div class="pm-add-row">
          <input type="text" id="anit_preset_new_name" class="pm-add-inp" placeholder="Название..." maxlength="30">
          <button type="button" id="anit_preset_add_btn" class="pm-add-btn">+ Добавить</button>
        </div>
      </div>
    </div>
  </div>

  <div class="group">
    <div class="group-title">Быстрые фильтры</div>
    <div class="row">
    <label><input type="checkbox" id="anit_unread"> Непрочитанные</label>
    ${!isTasksMode ? `<label><input type="checkbox" id="anit_attach"> С вложениями</label>` : ``}
	${isTasksMode ? `
	  <label><input type="checkbox" id="anit_hide_completed"> Скрыть завершённые</label>
	` : ``}
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
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" style="width:13px;height:13px;display:block;fill:#fff;opacity:.8">
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
    <div id="anit_cat_manage_panel" style="display:none">
      <div style="font-size:11px;font-weight:700;margin-bottom:6px;opacity:.9">Показывать категории</div>
      <div id="anit_cat_vis_list" style="display:flex;flex-wrap:wrap;gap:4px"></div>
      <div id="anit_cat_custom_list" style="margin-top:4px"></div>
    </div>
  </div>
  ` : ''}
  <div class="group">
    <div class="group-title">Поиск</div>
    <div class="row">
      <input type="text" id="anit_query" placeholder="Поиск по имени/последнему сообщению">
    </div>
  </div>


  <div class="group" id="anit_kwtags_group">
    <div class="group-title">Теги</div>
    <div id="anit_kwtags_chips" class="chips" style="gap:6px;flex-wrap:wrap"></div>
    <div class="row" style="margin-top:6px;gap:6px;align-items:center">
      <input type="text" id="anit_tag_add_input" placeholder="Новый тег...">
      <button type="button" id="anit_tag_add_btn">+</button>
    </div>
  </div>

  ${isTasksMode ? `
  <div class="group" id="anit_itags_group">
    <div class="group-title">Теги пересечений</div>
    <div id="anit_itags_chips" class="chips" style="gap:6px;flex-wrap:wrap"></div>
    <div class="row" style="margin-top:6px;gap:6px;align-items:center">
      <input type="text" id="anit_itag_add_input" placeholder="Новый тег...">
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
<div class="anit-preset-toast" id="anit_preset_toast"></div>
<div id="anit_debug_overlay"><span class="anit-debug-flag">⚙ Режим отладки</span></div>
<div id="anit_mini_toggle" class="mini-toggle" title="Показать панель (Ctrl+Alt+F)">
  <svg viewBox="0 0 402.577 402.577" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <path d="M400.858,11.427c-3.241-7.421-8.85-11.132-16.854-11.136H18.564c-7.993,0-13.61,3.715-16.846,11.136 c-3.234,7.801-1.903,14.467,3.999,19.985l140.757,140.753v138.755c0,4.955,1.809,9.232,5.424,12.854l73.085,73.083 c3.429,3.614,7.71,5.428,12.851,5.428c2.282,0,4.66-0.479,7.135-1.43c7.426-3.238,11.14-8.851,11.14-16.845V172.166L396.861,31.413 C402.765,25.895,404.093,19.231,400.858,11.427z"/>
  </svg>
</div>`;
	document.body.appendChild(host);
	filtersHost = host;
	host.dataset.mode = _currentPanelMode;
	// Apply saved opacity immediately — prevents flicker on tab switch
	try {
		const _initOp = parseInt(localStorage.getItem('pena.panel.opacity') || '100', 10);
		if (!isNaN(_initOp) && _initOp < 100) {
			host.style.opacity = String(Math.max(0.2, Math.min(1, _initOp / 100)));
		}
	} catch {}
	renderPresetsUI(host);


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
					if (uid === 0) continue; // "Без исполнителя" выводим отдельной системной строкой
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
		function setHidden(hidden) {
			if (hidden) host.classList.add('anit-hidden');
			else host.classList.remove('anit-hidden');
			const mini = host.querySelector('#anit_mini_toggle');
			const full = host.querySelector('#anit_toggle_btn');
			if (mini) mini.title = hidden ? 'Показать панель (Ctrl+Alt+F)' : 'Скрыть панель (Ctrl+Alt+F)';
			if (full) full.innerHTML = hidden
			? '<svg viewBox="0 0 24 24" style="width:12px;height:12px;display:block;fill:#fff" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>'
			: '<svg viewBox="0 0 24 24" style="width:12px;height:12px;display:block;fill:#fff" aria-hidden="true"><path d="M19 13H5v-2h14v2z"/></svg>';
			try { localStorage.setItem(HIDE_LS_KEY, hidden ? '1' : '0'); } catch {}
		}
		function togglePanel() {
			const nowHidden = host.classList.contains('anit-hidden');
			setHidden(!nowHidden);
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

	// --- Проверка обновлений прямо из панели ---
	const _UPD_URL = 'https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/main/update.json';
	const _UPD_CURRENT = '6.4.26';
	const _UPD_LS_KEY  = 'pena.update.info';

	function _semverNewer(remote, local) {
		const p = v => String(v).split('.').map(Number);
		const [ra, rb, rc] = p(remote), [la, lb, lc] = p(local);
		if (ra !== la) return ra > la;
		if (rb !== lb) return rb > lb;
		return rc > lc;
	}
	function _showUpdToast(msg, ok) {
		const toast = host.querySelector('#anit_preset_toast');
		if (!toast) return;
		toast.textContent = msg;
		toast.classList.toggle('--ok', !!ok);
		toast.classList.add('--show');
		if (_toastTimer) clearTimeout(_toastTimer);
		_toastTimer = setTimeout(() => { toast.classList.remove('--show'); setTimeout(() => toast.classList.remove('--ok'), 350); }, 2800);
	}
	function _applyUpdateBanner(version, injected_js_url) {
		const dot    = host.querySelector('#anit_update_dot');
		const banner = host.querySelector('#anit_update_banner');
		const txt    = host.querySelector('#anit_update_banner_text');
		const lnk    = host.querySelector('#anit_update_banner_link');
		if (dot)    dot.style.display = '';
		if (txt)    txt.textContent = `Доступно обновление v${version}`;
		if (lnk)  { lnk.dataset.injectedJsUrl = injected_js_url || ''; lnk.dataset.version = version || ''; lnk.disabled = false; lnk.textContent = 'Обновить'; }
		if (banner) { banner.style.display = ''; banner.className = 'update-banner'; }
		const prog = host.querySelector('#anit_ubp_progress');
		const done = host.querySelector('#anit_ubp_done');
		if (prog) prog.style.display = 'none';
		if (done) done.style.display = 'none';
	}
	function _clearUpdateBanner() {
		const dot    = host.querySelector('#anit_update_dot');
		const banner = host.querySelector('#anit_update_banner');
		if (dot)    dot.style.display = 'none';
		if (banner) banner.style.display = 'none';
	}

	// Восстановить состояние из localStorage
	try {
		const saved = JSON.parse(localStorage.getItem(_UPD_LS_KEY) || 'null');
		if (saved?.hasUpdate && saved.version && saved.injected_js_url) _applyUpdateBanner(saved.version, saved.injected_js_url);
	} catch {}

	let _lastCheckResultTs = 0; // дедупликация дублей по ts

	// Автопроверка при загрузке — content.js делает fetch напрямую (минуя CSP)
	setTimeout(() => {
		const _chkBtn = host.querySelector('#anit_update_btn');
		if (_chkBtn && !_chkBtn.classList.contains('--checking')) {
			_chkBtn.classList.add('--checking');
			_chkBtn.disabled = true;
		}
		window.postMessage({ type: 'PENA_CHECK_UPDATES', silent: true }, '*');
		// Сброс кнопки если ответ не пришёл за 15 сек
		setTimeout(() => {
			const _b = host.querySelector('#anit_update_btn');
			if (_b && _b.classList.contains('--checking')) {
				_b.classList.remove('--checking');
				_b.disabled = false;
			}
		}, 15000);
	}, 3000);

	// Версия в нижнем правом углу
	const _verBadge = host.querySelector('#anit_ver_badge');
	if (_verBadge) _verBadge.textContent = 'v' + _UPD_CURRENT;

	// Уведомление о первом запуске после обновления
	try {
		const _LAST_VER_KEY = 'pena.last_seen_ver';
		const _lastSeen = localStorage.getItem(_LAST_VER_KEY); // null если ключа нет
		const _notice      = host.querySelector('#anit_update_notice');
		const _noticeText  = host.querySelector('#anit_update_notice_text');
		// Показываем если: ключ уже был (не первая установка) И версия изменилась
		// _lastSeen === null → первая установка → не показываем
		// _lastSeen === '' → не должно быть, но на всякий случай пропускаем
		if (_notice && _noticeText && _lastSeen !== null && _lastSeen !== _UPD_CURRENT) {
			_noticeText.textContent = `✓ Расширение обновлено до v${_UPD_CURRENT}`;
			_notice.style.display = 'flex';
		}
		host.querySelector('#anit_update_notice_close')?.addEventListener('click', () => {
			const n = host.querySelector('#anit_update_notice');
			if (n) n.style.display = 'none';
		});
		localStorage.setItem(_LAST_VER_KEY, _UPD_CURRENT);
	} catch (_) {}

	// --- Seamless update download flow ---
	const _ubpBanner  = host.querySelector('#anit_update_banner');
	const _ubpInstBtn = host.querySelector('#anit_update_banner_link');
	const _ubpProg    = host.querySelector('#anit_ubp_progress');
	const _ubpLabel   = host.querySelector('#anit_ubp_label');
	const _ubpPct     = host.querySelector('#anit_ubp_pct');
	const _ubpFill    = host.querySelector('#anit_ubp_fill');
	const _ubpDone     = host.querySelector('#anit_ubp_done');
	const _ubpCloseApp = host.querySelector('#anit_ubp_close_app');

	_ubpInstBtn?.addEventListener('click', () => {
		const injected_js_url = _ubpInstBtn.dataset.injectedJsUrl;
		const version         = _ubpInstBtn.dataset.version;
		if (!injected_js_url) return;
		_ubpInstBtn.disabled = true;
		if (_ubpLabel) _ubpLabel.textContent = 'Загрузка обновления...';
		if (_ubpProg)  _ubpProg.style.display = '';
		if (_ubpPct)   _ubpPct.textContent = '0%';
		if (_ubpFill)  { _ubpFill.classList.remove('--indet'); _ubpFill.style.width = '0%'; }
		if (_ubpBanner) _ubpBanner.classList.add('--downloading');
		window.postMessage({ type: 'PENA_APPLY_UPDATE', injected_js_url, version }, '*');
	});

	function _showRestartInstruction() {
		if (_ubpProg) _ubpProg.style.display = 'none';
		if (_ubpDone) _ubpDone.style.display = '';
		if (_ubpBanner) { _ubpBanner.classList.remove('--downloading', '--error', '--impossible'); _ubpBanner.classList.add('--done'); }
	}

	// «Перезапустить Bitrix24» — многоуровневое закрытие + перезапуск через ярлык
	_ubpCloseApp?.addEventListener('click', () => {
		// Визуальный фидбек: сразу показываем что кнопка сработала
		if (_ubpCloseApp) {
			_ubpCloseApp.textContent = 'Закрываем...';
			_ubpCloseApp.disabled = true;
		}

		// ── Уровень 1: Node.js child_process ─────────────────────────────────────
		// Запускаем updater.ps1 -LaunchWithUpdate ДО закрытия
		let _relaunching = false;
		try {
			let _req;
			try { _req = (0, eval)('require'); } catch (_) {}
			if (typeof _req === 'function') {
				_req('child_process').exec(
					'powershell.exe -WindowStyle Hidden -File "%LOCALAPPDATA%\\PENA Agency\\Extension\\updater.ps1" -LaunchWithUpdate'
				);
				_relaunching = true;
			}
		} catch (_) {}

		const _delay = _relaunching ? 1500 : 0;

		// ── Уровень 2: Bitrix24 Desktop API ──────────────────────────────────────
		setTimeout(() => {
			try { window.BXDesktopSystem?.ExecAction?.('quit'); } catch (_) {}
			try { window.BXDesktopSystem?.ExecAction?.('exit'); } catch (_) {}
			try { window.BXDesktopSystem?.ExecAction?.('close'); } catch (_) {}
		}, _delay);

		// ── Уровень 3: Electron remote / process.exit ────────────────────────────
		setTimeout(() => {
			try {
				let _req;
				try { _req = (0, eval)('require'); } catch (_) {}
				if (typeof _req === 'function') {
					try { _req('electron').remote.app.quit(); } catch (_) {}
					try { _req('process').exit(0); } catch (_) {}
				}
			} catch (_) {}
		}, _delay);

		// ── Уровень 4: Native Messaging Host → taskkill (основной метод) ──────────
		// background.js пробует com.pena.agency.helper; если хост не установлен —
		// возвращает PENA_NATIVE_UNAVAILABLE и восстанавливает кнопку
		setTimeout(() => {
			window.postMessage({ type: 'PENA_CLOSE_APP', _pena_dl: true }, '*');
		}, _delay);
	});

	// Ответы от content.js: прогресс обновления + результат проверки
	window.addEventListener('message', (ev) => {
		if (!ev.data || !ev.data._pena_dl) return;
		const msg = ev.data;

		if (msg.type === 'UPDATE_PROGRESS') {
			// Прогресс загрузки нового injected.js
			const pct = Math.min(99, msg.pct >= 0 ? msg.pct : 0);
			if (_ubpPct)  _ubpPct.textContent  = pct + '%';
			if (_ubpFill) { _ubpFill.classList.remove('--indet'); _ubpFill.style.width = pct + '%'; }

		} else if (msg.type === 'UPDATE_DONE') {
			// Обновление сохранено — сразу показываем инструкцию (без промежуточной кнопки)
			if (_ubpPct)  _ubpPct.textContent  = '100%';
			if (_ubpFill) { _ubpFill.classList.remove('--indet'); _ubpFill.style.width = '100%'; }
			setTimeout(_showRestartInstruction, 300);

		} else if (msg.type === 'PENA_NATIVE_UNAVAILABLE') {
			// Нативный хост не установлен — восстанавливаем кнопку, показываем подсказку
			if (_ubpCloseApp) {
				_ubpCloseApp.textContent = 'Перезапустить';
				_ubpCloseApp.disabled = false;
			}
			_showUpdToast('Установите PENA Agency полностью (запустите установщик)', false);

		} else if (msg.type === 'PENA_NEED_MANUAL_RESTART') {
			_showRestartInstruction();

		} else if (msg.type === 'PENA_UPDATE_IMPOSSIBLE') {
			// Инжект нового injected.js не удался — просим обратиться к администратору
			if (_ubpProg) _ubpProg.style.display = 'none';
			if (_ubpDone) _ubpDone.style.display = 'none';
			const impRow = host.querySelector('#anit_ubp_impossible');
			if (impRow) {
				impRow.style.display = '';
				const t = impRow.querySelector('.ubp-imp-text');
				if (t) t.textContent = 'Обновление невозможно — обратитесь к администратору';
			}
			if (_ubpBanner) { _ubpBanner.style.display = ''; _ubpBanner.classList.remove('--downloading', '--done', '--error'); _ubpBanner.classList.add('--impossible'); }

		} else if (msg.type === 'UPDATE_ERROR') {
			if (_ubpBanner)  { _ubpBanner.classList.remove('--downloading', '--done'); _ubpBanner.classList.add('--error'); }
			if (_ubpProg)    _ubpProg.style.display = 'none';
			if (_ubpInstBtn) { _ubpInstBtn.disabled = false; _ubpInstBtn.textContent = 'Повторить'; }
			_showUpdToast('Ошибка загрузки обновления');

		} else if (msg.type === 'PENA_UPDATE_AVAILABLE') {
			// Пришло от content.js: в chrome.storage найдена информация об обновлении
			if (msg.version && msg.injected_js_url) _applyUpdateBanner(msg.version, msg.injected_js_url);

		} else if (msg.type === 'CHECK_RESULT') {
			// Дедупликация: оба канала могут доставить один и тот же результат
			if (msg.ts && msg.ts === _lastCheckResultTs) return;
			if (msg.ts) _lastCheckResultTs = msg.ts;
			const btn = host.querySelector('#anit_update_btn');
			if (btn) { btn.classList.remove('--checking'); btn.disabled = false; }
			if (msg.hasUpdate && msg.version && msg.injected_js_url && _semverNewer(msg.version, _UPD_CURRENT)) {
				// Обновление доступно и его версия новее той, что сейчас запущена
				try { localStorage.setItem(_UPD_LS_KEY, JSON.stringify({ hasUpdate: true, version: msg.version, injected_js_url: msg.injected_js_url })); } catch {}
				_applyUpdateBanner(msg.version, msg.injected_js_url);
				if (!msg.silent) _showUpdToast('⬆ Обновление v' + msg.version + ' доступно — нажмите «Обновить»');
			} else if (msg.ok || (msg.hasUpdate && !_semverNewer(msg.version, _UPD_CURRENT))) {
				// Актуальная версия уже запущена
				try { localStorage.setItem(_UPD_LS_KEY, JSON.stringify({ hasUpdate: false })); } catch {}
				_clearUpdateBanner();
				if (!msg.silent) _showUpdToast('✓ Установлена актуальная версия', true);
			} else {
				if (!msg.silent) _showUpdToast('Нет соединения — проверьте позже');
			}
		}
	});

	host.querySelector('#anit_update_banner_close')?.addEventListener('click', () => {
		if (_ubpBanner) _ubpBanner.style.display = 'none';
	});
	host.querySelector('#anit_ubp_impossible_close')?.addEventListener('click', () => {
		if (_ubpBanner) _ubpBanner.style.display = 'none';
	});
	host.querySelector('#anit_update_btn')?.addEventListener('click', () => {
		const btn = host.querySelector('#anit_update_btn');
		if (!btn || btn.classList.contains('--checking')) return;
		btn.classList.add('--checking');
		btn.disabled = true;
		// Запрос идёт через content.js → background.js (CSP не мешает)
		window.postMessage({ type: 'PENA_CHECK_UPDATES', silent: false }, '*');
		// Таймаут: если результат не пришёл за 15 сек — сбрасываем кнопку
		setTimeout(() => {
			if (btn.classList.contains('--checking')) {
				btn.classList.remove('--checking');
				btn.disabled = false;
				_showUpdToast('Нет соединения — проверьте позже');
			}
		}, 15000);
	});
	// --- конец блока проверки обновлений ---

	// --- Help popup (горячие клавиши) ---
	const _helpBtn = host.querySelector('#anit_help_btn');
	const _helpPop = host.querySelector('#anit_help_popup');
	if (_helpBtn && _helpPop) {
		_helpBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			_helpPop.classList.toggle('--show');
		});
		document.addEventListener('click', (e) => {
			if (!_helpPop.classList.contains('--show')) return;
			if (!_helpPop.contains(e.target) && e.target !== _helpBtn) {
				_helpPop.classList.remove('--show');
			}
		}, true);
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
	const _atEl = host.querySelector('#anit_attach'); if(_atEl) _atEl.checked = !!filters.withAttach;
	host.querySelector('#anit_query').value = String(filters.query || '');
	const hc = host.querySelector('#anit_hide_completed');
	if (hc) hc.checked = !!filters.hideCompletedTasks;

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
	// hideCompletedTasks и сброс; остальные изменения отклоняем
	const _presetLocked = _getActiveId() && !_debugModeActive;
	if (_presetLocked) {
		// Разрешённые быстрые фильтры — применяем немедленно
		filters.unreadOnly        = host.querySelector('#anit_unread')?.checked || false;
		filters.hideCompletedTasks = host.querySelector('#anit_hide_completed')?.checked || false;
		persistFilters();
		applyFilters();
		return;
	}
	filters.unreadOnly = host.querySelector('#anit_unread').checked;
	filters.withAttach = host.querySelector('#anit_attach')?.checked || false;
	filters.query      = host.querySelector('#anit_query').value;
	filters.hideCompletedTasks = host.querySelector('#anit_hide_completed')?.checked || false;

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
			// если вручную введено значение, но не выбрано из списка — не меняем текущее состояние
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
					// если вручную введено значение, но не выбрано из списка — не меняем текущее состояние
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
	// Сохраняем теги — сброс только снимает выбор, не удаляет теги
	const savedTags = Array.isArray(filters.keywordTags) ? [...filters.keywordTags] : [];
	const savedIntersectionTags = Array.isArray(filters.intersectionTags) ? [...filters.intersectionTags] : [];
	filters = defaultFilters();
	filters.keywordTags = savedTags;
	filters.selectedTags = [];
	filters.intersectionTags = savedIntersectionTags;
	filters.selectedIntersectionTags = [];
	persistFilters();
	// Визуально снимаем все активные теги (renderTagChips/renderIntersectionTagChips
	// определены внутри buildFiltersPanel и недоступны здесь — обновляем напрямую)
	const _kwChipsR = host.querySelector('#anit_kwtags_chips');
	if (_kwChipsR) _kwChipsR.querySelectorAll('.kw-tag-chip').forEach(c => c.classList.remove('is-active'));
	const _ixChipsR = host.querySelector('#anit_itags_chips');
	if (_ixChipsR) _ixChipsR.querySelectorAll('.kw-tag-chip').forEach(c => c.classList.remove('is-active'));
	try { renderTypeChips(); } catch(e){}
	host.querySelector('#anit_unread').checked = false;
	const _atReset = host.querySelector('#anit_attach'); if(_atReset) _atReset.checked = false;
	const hc = host.querySelector('#anit_hide_completed');
	if (hc) hc.checked = false;
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
		host.appendChild(track); // в #anit-filters, не в .pane — выходит за правый край

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

		// Клик по треку — прыжок к позиции
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
			const onStyle  = 'border:1px solid rgba(85,180,255,.5);background:rgba(85,180,255,.14);color:#b8d8ff;border-radius:14px;padding:3px 10px;font-size:11px;cursor:pointer;margin:2px;transition:all .15s;outline:none';
			const offStyle = 'border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:rgba(255,255,255,.28);text-decoration:line-through;border-radius:14px;padding:3px 10px;font-size:11px;cursor:pointer;margin:2px;transition:all .15s;outline:none';
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
				rmBtn.textContent = '×';
				rmBtn.style.cssText = 'padding:2px 5px;border-radius:4px;border:1px solid rgba(255,0,0,.3);background:rgba(255,0,0,.12);color:#f66;cursor:pointer;font-size:12px';
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
	if (presetManageBtn && presetManagePanel) {
		presetManageBtn.addEventListener('click', (e) => {
			e.preventDefault(); e.stopPropagation();
			const nowVisible = presetManagePanel.style.display !== 'none';
			presetManagePanel.style.display = nowVisible ? 'none' : 'block';
			if (!nowVisible) renderPresetManagePanel(host);
		});
		document.addEventListener('click', (e) => {
			if (!presetManagePanel || presetManagePanel.style.display === 'none') return;
			if (!presetManagePanel.contains(e.target) && !presetManageBtn.contains(e.target)) {
				presetManagePanel.style.display = 'none';
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
	if (catManageBtn && catManagePanel) {
		catManageBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const nowVisible = catManagePanel.style.display !== 'none';
			catManagePanel.style.display = nowVisible ? 'none' : 'block';
			if (!nowVisible) renderCatManagePanel();
		});
		document.addEventListener('click', (e) => {
			if (!catManagePanel || catManagePanel.style.display === 'none') return;
			if (!catManagePanel.contains(e.target) && !catManageBtn.contains(e.target)) {
				catManagePanel.style.display = 'none';
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
			chip.innerHTML = tag + ' <span class="tag-rm" title="Удалить">×</span>';
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
			chip.innerHTML = tag + ' <span class="tag-rm" title="Удалить">×</span>';
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

	// Загрузка чатов: используется автоматически и по кнопке ──────────────
	let _prefetchRunning = false;
	async function runPrefetch() {
		if (IS_OL_FRAME || _prefetchRunning) return;
		_prefetchRunning = true;
		if (!document.body.contains(host)) { _prefetchRunning = false; return; }

		const popup = document.createElement('div');
		popup.className = 'pena-prefetch-popup';
		popup.innerHTML = `
			<div class="pena-prefetch-box">
			<div class="pena-prefetch-handle">⠇ Загрузка чатов…</div>
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

		// Перетаскивание всего окна за хэндл попапа
		let _drag = false, _startX = 0, _startY = 0, _startLeft = 0, _startTop = 0;
		const onMove = (e) => {
			if (!_drag) return;
			const dx = e.clientX - _startX, dy = e.clientY - _startY;
			const r = host.getBoundingClientRect();
			host.style.left = Math.max(0, Math.min(window.innerWidth  - r.width,  _startLeft + dx)) + 'px';
			host.style.top  = Math.max(0, Math.min(window.innerHeight - r.height, _startTop  + dy)) + 'px';
		};
		const onUp = () => { _drag = false; };
		popup.querySelector('.pena-prefetch-handle').addEventListener('mousedown', (e) => {
			_drag = true;
			_startX = e.clientX; _startY = e.clientY;
			_startLeft = parseInt(host.style.left || '0', 10) || 0;
			_startTop  = parseInt(host.style.top  || '0', 10) || 0;
			e.preventDefault();
		});
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup',   onUp);

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

	// ── Изменение размера панели ────────────────────────────────
	const LS_PANEL_SIZE_KEY = 'pena.panelSize';
	// Восстанавливаем сохранённый размер
	try {
		const saved = JSON.parse(localStorage.getItem(LS_PANEL_SIZE_KEY) || '{}');
		if (saved.w) host.style.width = saved.w;
		if (saved.h) { const p = host.querySelector('.pane'); if (p) p.style.maxHeight = saved.h; }
	} catch {}
	// Ресайз за боковые грани (левая, правая, нижняя)
	const _EDGE = 6; // px — ширина зоны захвата края
	let _rzActive = false, _rzEdges = {};
	let _rzStartX = 0, _rzStartY = 0, _rzStartW = 0, _rzStartH = 0, _rzStartLeft = 0;
	const _getEdges = (ev) => {
		const r = host.getBoundingClientRect();
		return { l: ev.clientX <= r.left + _EDGE, r: ev.clientX >= r.right - _EDGE, b: ev.clientY >= r.bottom - _EDGE };
	};
	const _RZ_CLASSES = ['rz-e','rz-w','rz-s','rz-se','rz-sw'];
	const _edgeCursorClass = (g) => {
		if (g.b && g.l) return 'rz-sw';
		if (g.b && g.r) return 'rz-se';
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
		const overUI = !!ev.target.closest('button,input,select,textarea,a,[contenteditable]');
		_setRzCursor(overUI ? '' : _edgeCursorClass(_getEdges(ev)));
	});
	host.addEventListener('mouseleave', () => { if (!_rzActive) _setRzCursor(''); });
	host.addEventListener('mousedown', (ev) => {
		if (ev.button !== 0) return;
		if (ev.target.closest('button,input,select,textarea,a,[contenteditable]')) return;
		const edges = _getEdges(ev);
		if (!edges.l && !edges.r && !edges.b) return;
		_rzActive = true;
		_rzEdges = edges;
		_rzStartX = ev.clientX; _rzStartY = ev.clientY;
		_rzStartW = host.offsetWidth;
		_rzStartH = host.querySelector('.pane')?.offsetHeight || host.offsetHeight;
		_rzStartLeft = parseInt(host.style.left || '0', 10) || 0;
		ev.preventDefault();
		ev.stopPropagation();
		const onRzMove = (e) => {
			if (!_rzActive) return;
			const dx = e.clientX - _rzStartX, dy = e.clientY - _rzStartY;
			const pane = host.querySelector('.pane');
			if (_rzEdges.r) {
				host.style.width = Math.max(360, Math.min(window.innerWidth * 0.9, _rzStartW + dx)) + 'px';
			}
			if (_rzEdges.l) {
				const newW = Math.max(360, Math.min(window.innerWidth * 0.9, _rzStartW - dx));
				host.style.width = newW + 'px';
				host.style.left = Math.max(0, _rzStartLeft + (_rzStartW - newW)) + 'px';
			}
			if (_rzEdges.b && pane) {
				pane.style.maxHeight = Math.max(220, Math.min(window.innerHeight * 0.95, _rzStartH + dy)) + 'px';
			}
		};
		const onRzUp = () => {
			_rzActive = false;
			document.removeEventListener('mousemove', onRzMove);
			document.removeEventListener('mouseup', onRzUp);
			_setRzCursor('');
			const pane = host.querySelector('.pane');
			try { localStorage.setItem(LS_PANEL_SIZE_KEY, JSON.stringify({ w: host.style.width, h: pane?.style.maxHeight || '' })); } catch {}
		};
		document.addEventListener('mousemove', onRzMove);
		document.addEventListener('mouseup', onRzUp);
	})

	// ── Прозрачность панели ─────────────────────────────
	const LS_OPACITY_KEY = 'pena.panel.opacity';
	const _opSlider = host.querySelector('#anit_opacity_slider');
	if (_opSlider) {
		let _opTimer = null;
		const _applyOp = (v) => {
			host.style.opacity = String(Math.max(0.2, Math.min(1, v / 100)));
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
		host.addEventListener('mouseenter', () => {
			clearTimeout(_opTimer);
			if (parseInt(_opSlider.value, 10) < 100) host.style.opacity = '1';
		});
		host.addEventListener('mouseleave', () => {
			clearTimeout(_opTimer);
			if (parseInt(_opSlider.value, 10) < 100) {
				_opTimer = setTimeout(() => { _applyOp(parseInt(_opSlider.value, 10)); }, 2000);
			}
		});
	}

	// Сигнал: панель построена (content.js → background.js → авто-инжект обновления)
	try { window.postMessage({ type: 'PENA_PANEL_BUILT', _pena_dl: true }, '*'); } catch (_) {}
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
			_modeFiltersCache[_currentPanelMode] = JSON.parse(JSON.stringify(filters));
			pane.remove();
			filtersHost = null;
			_currentPanelMode = needMode; // фиксируем режим ДО loadFilters/saveFilters
			filters = _modeFiltersCache[needMode] ? JSON.parse(JSON.stringify(_modeFiltersCache[needMode])) : loadFilters();
			await buildFiltersPanel().catch(() => {});
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
		const ta = tsMapLocal.get(aId) ?? -1;
		const tb = tsMapLocal.get(bId) ?? -1;
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
		document.getElementById('anit-filters')?.remove();
		filtersHost = null;
		return;
	}

	let need = false;
	for (const m of mutations) {
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

	obs.observe(container, { childList: true, subtree: true });
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
	buildFiltersPanel().then(applyFilters);
} else if (onChats && havePanel) {
	const pane = document.getElementById('anit-filters');
	const needMode = getPanelModeKey();
	if (pane && pane.dataset.mode !== needMode) {
		_modeFiltersCache[_currentPanelMode] = JSON.parse(JSON.stringify(filters));
		pane.remove();
		filtersHost = null;
		_currentPanelMode = needMode; // фиксируем режим ДО loadFilters/saveFilters
		filters = _modeFiltersCache[needMode] ? JSON.parse(JSON.stringify(_modeFiltersCache[needMode])) : loadFilters();
		buildFiltersPanel().then(applyFilters);
	}
} else if (!onChats && havePanel) {
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

		function armMultiSelectHandlers() {

			document.addEventListener('mousedown', (e) => {
				if (e.button !== 2) return;
				const el = getChatItemElement(e.target);
				if (!el) return;


				if (multiSelectMode) return;

				multiRmbTargetEl = el;
				if (multiRmbTimer) clearTimeout(multiRmbTimer);
				multiRmbTimer = setTimeout(() => {
					multiRmbTimer = null;

					enterMultiSelectMode(multiRmbTargetEl);
					multiEnteredViaRmb = true;
				}, 600); // длительность клика ПКМ
			}, true);


			document.addEventListener('mouseup', (e) => {
				if (e.button === 2 && multiRmbTimer) {
					clearTimeout(multiRmbTimer);
					multiRmbTimer = null;
				}

			}, true);

			document.addEventListener('mouseleave', () => {
				if (multiRmbTimer) {
					clearTimeout(multiRmbTimer);
					multiRmbTimer = null;
				}
			}, true);


			document.addEventListener('contextmenu', (e) => {
				if (!multiSelectMode) return;
				const el = getChatItemElement(e.target);
				if (!el) return;

				e.preventDefault();
				e.stopPropagation();
				const id = getChatIdFromElement(el);
				if (
					multiEnteredViaRmb &&
					id &&
					multiSelectedIds.size === 1 &&
					multiSelectedIds.has(id)
				) {
					multiEnteredViaRmb = false;
					return;
				}

				multiEnteredViaRmb = false;
				toggleChatSelectionFromElement(el);
			}, true);


			document.addEventListener('click', (e) => {
				if (!multiSelectMode) return;
				const el = getChatItemElement(e.target);
				if (!el) return;

				e.preventDefault();
				e.stopPropagation();
				toggleChatSelectionFromElement(el);
			}, true);


			document.addEventListener('keydown', (e) => {
				if (!multiSelectMode) return;
				if (e.key === 'Escape') {
					exitMultiSelectMode();
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
		armMultiSelectHandlers();
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


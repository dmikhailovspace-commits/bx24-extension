(function attachPenaTimeControl(root, factory) {
	'use strict';

	const api = factory();
	if (root && typeof root === 'object') root.__PENA_TIME_CONTROL__ = api;
	if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function createPenaTimeControlModule() {
	'use strict';

	const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
	const DEFAULT_PAGE_SIZE = 50;
	const DEFAULT_MAX_PAGES = 100;
	const DEFAULT_TOUCH_DEDUPE_MS = 15000;
	const DEFAULT_IDLE_CAP_SECONDS = 15 * 60;
	const DEFAULT_QUALIFICATION_SECONDS = 60;

	function pad2(value) {
		return String(value).padStart(2, '0');
	}

	function toDateKey(value = new Date()) {
		const date = value instanceof Date ? value : new Date(value);
		if (!Number.isFinite(date.getTime())) return '';
		return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
	}

	function parseDateKey(value) {
		const match = DATE_KEY_RE.exec(String(value || '').trim());
		if (!match) return null;
		const year = Number(match[1]);
		const month = Number(match[2]);
		const day = Number(match[3]);
		const date = new Date(year, month - 1, day, 12, 0, 0, 0);
		if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
		return date;
	}

	function addDays(dateKey, days) {
		const date = parseDateKey(dateKey);
		if (!date) return '';
		date.setDate(date.getDate() + Number(days || 0));
		return toDateKey(date);
	}

	function normalizeRange(from, to, fallbackDate = new Date()) {
		const today = toDateKey(fallbackDate);
		let start = parseDateKey(from) ? String(from) : today;
		let finish = parseDateKey(to) ? String(to) : start;
		if (start > finish) [start, finish] = [finish, start];
		return { from: start, to: finish, key: `${start}:${finish}` };
	}

	function getQuickRange(kind, now = new Date()) {
		const today = typeof now === 'string' && parseDateKey(now) ? now : toDateKey(now);
		if (kind === 'yesterday') {
			const yesterday = addDays(today, -1);
			return normalizeRange(yesterday, yesterday, now);
		}
		if (kind === 'week') return normalizeRange(addDays(today, -6), today, now);
		if (kind === 'month') return normalizeRange(`${today.slice(0, 8)}01`, today, now);
		return normalizeRange(today, today, now);
	}

	function countRangeDays(from, to) {
		const range = normalizeRange(from, to);
		const start = parseDateKey(range.from);
		const finish = parseDateKey(range.to);
		return Math.round((finish.getTime() - start.getTime()) / 86400000) + 1;
	}

	function buildElapsedRequestParams({ taskId, from, to, userId, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
		const normalizedTaskId = String(taskId || '').trim();
		if (!/^\d+$/.test(normalizedTaskId)) throw new TypeError('taskId is required');
		const range = normalizeRange(from, to);
		const filter = {
			'>=CREATED_DATE': `${range.from}T00:00:00`,
			'<CREATED_DATE': `${addDays(range.to, 1)}T00:00:00`
		};
		if (/^\d+$/.test(String(userId || ''))) filter.USER_ID = Number(userId);
		return [
			Number(normalizedTaskId),
			{ CREATED_DATE: 'desc', ID: 'desc' },
			filter,
			['ID', 'TASK_ID', 'USER_ID', 'SECONDS', 'MINUTES', 'CREATED_DATE', 'DATE_START', 'DATE_STOP', 'COMMENT_TEXT', 'SOURCE'],
			{ NAV_PARAMS: { nPageSize: Math.min(DEFAULT_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE)), iNumPage: Math.max(1, Number(page) || 1) } }
		];
	}

	function extractElapsedItems(data) {
		if (Array.isArray(data)) return data;
		if (Array.isArray(data?.result)) return data.result;
		if (Array.isArray(data?.items)) return data.items;
		return [];
	}

	function extractDateKey(value) {
		const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || '').trim());
		return match && parseDateKey(match[1]) ? match[1] : '';
	}

	function normalizeElapsedItem(item = {}) {
		const rawSeconds = item.SECONDS ?? item.seconds;
		const rawMinutes = item.MINUTES ?? item.minutes;
		const directSeconds = Number(rawSeconds);
		const minutes = Number(rawMinutes);
		const seconds = rawSeconds !== '' && rawSeconds != null && Number.isFinite(directSeconds) && directSeconds >= 0
			? directSeconds
			: (rawMinutes !== '' && rawMinutes != null && Number.isFinite(minutes) && minutes >= 0 ? minutes * 60 : 0);
		const createdAt = String(item.CREATED_DATE ?? item.createdDate ?? item.createdAt ?? item.DATE_START ?? item.dateStart ?? '');
		return {
			id: String(item.ID ?? item.id ?? ''),
			taskId: String(item.TASK_ID ?? item.taskId ?? ''),
			userId: String(item.USER_ID ?? item.userId ?? ''),
			seconds: Math.max(0, Math.round(seconds)),
			createdAt,
			dateKey: extractDateKey(createdAt),
			dateStart: String(item.DATE_START ?? item.dateStart ?? ''),
			dateStop: String(item.DATE_STOP ?? item.dateStop ?? ''),
			commentText: String(item.COMMENT_TEXT ?? item.commentText ?? ''),
			source: String(item.SOURCE ?? item.source ?? '')
		};
	}

	function aggregateElapsedItems(items = []) {
		const normalized = items.map(normalizeElapsedItem);
		const days = new Map();
		const tasks = new Map();
		let totalSeconds = 0;
		for (const item of normalized) {
			totalSeconds += item.seconds;
			const dayKey = item.dateKey || 'unknown';
			const day = days.get(dayKey) || { dateKey: dayKey, seconds: 0, entries: 0 };
			day.seconds += item.seconds;
			day.entries += 1;
			days.set(dayKey, day);
			const taskKey = item.taskId || 'unknown';
			const task = tasks.get(taskKey) || { taskId: taskKey, seconds: 0, entries: 0, entryIds: [], lastTrackedAt: '' };
			task.seconds += item.seconds;
			task.entries += 1;
			if (item.id) task.entryIds.push(item.id);
			if (item.createdAt && item.createdAt > task.lastTrackedAt) task.lastTrackedAt = item.createdAt;
			tasks.set(taskKey, task);
		}
		normalized.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.id || '').localeCompare(String(a.id || '')));
		return {
			items: normalized,
			totalSeconds,
			entryCount: normalized.length,
			taskCount: Array.from(tasks.keys()).filter(key => key !== 'unknown').length,
			days: Array.from(days.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
			tasks: Array.from(tasks.values()).sort((a, b) => b.seconds - a.seconds || b.entries - a.entries)
		};
	}

	function normalizeVisitedTask(task = {}) {
		const rawTaskId = String(task.taskId ?? task.id ?? '').trim();
		const taskId = /^\d+$/.test(rawTaskId) ? rawTaskId : '';
		const dialogId = String(task.dialogId || '').trim();
		// Time can only be written to a Bitrix task. Legacy dialog-only activity
		// is discarded here so ordinary chats never enter activity or history.
		if (!taskId) return null;
		const visitedAt = Math.max(0, Number(task.visitedAt) || 0);
		const firstVisitedAt = Math.max(0, Number(task.firstVisitedAt) || visitedAt);
		const activeSeconds = Math.max(0, Math.round(Number(task.activeSeconds) || 0));
		const explicitVisits = task.visits != null ? Math.max(0, Number(task.visits) || 0) : null;
		const visits = explicitVisits != null ? explicitVisits : (activeSeconds >= DEFAULT_QUALIFICATION_SECONDS ? 1 : 0);
		const legacyQualifiedAt = visits > 0 && activeSeconds >= DEFAULT_QUALIFICATION_SECONDS ? visitedAt : 0;
		return {
			taskId,
			activityId: `task:${taskId}`,
			kind: 'task',
			title: String(task.title || '').replace(/\s+/g, ' ').trim(),
			dialogId,
			visitedAt,
			firstVisitedAt,
			lastAccountedAt: Math.max(0, Number(task.lastAccountedAt) || visitedAt),
			activeSeconds,
			accountedActiveSeconds: Math.max(0, Math.round(Number(task.accountedActiveSeconds) || 0)),
			sessionActive: task.sessionActive === true,
			sessionQualified: task.sessionQualified === true,
			sessionStartedActiveSeconds: Math.max(0, Math.round(Number(task.sessionStartedActiveSeconds) || 0)),
			lastQualifiedAt: Math.max(0, Number(task.lastQualifiedAt) || legacyQualifiedAt),
			lastQualificationReason: String(task.lastQualificationReason || ''),
			accountedAt: Math.max(0, Number(task.accountedAt) || 0),
			visits
		};
	}

	function mergeVisitedTasks(items = [], next = null, limit = 40) {
		const byActivity = new Map();
		for (const raw of [...(Array.isArray(items) ? items : []), ...(next ? [next] : [])]) {
			const task = normalizeVisitedTask(raw);
			if (!task) continue;
			const previous = byActivity.get(task.activityId);
			if (!previous) {
				byActivity.set(task.activityId, task);
				continue;
			}
			const newest = task.visitedAt >= previous.visitedAt ? task : previous;
			byActivity.set(task.activityId, {
				...newest,
				title: newest.title || previous.title || task.title,
				dialogId: newest.dialogId || previous.dialogId || task.dialogId,
				firstVisitedAt: Math.min(previous.firstVisitedAt || previous.visitedAt, task.firstVisitedAt || task.visitedAt),
				lastAccountedAt: Math.max(previous.lastAccountedAt || 0, task.lastAccountedAt || 0),
				activeSeconds: Math.max(previous.activeSeconds || 0, task.activeSeconds || 0),
				accountedActiveSeconds: Math.max(previous.accountedActiveSeconds || 0, task.accountedActiveSeconds || 0),
				sessionActive: newest.sessionActive === true,
				accountedAt: Math.max(previous.accountedAt || 0, task.accountedAt || 0),
				visits: raw === next ? previous.visits + Math.max(1, task.visits) : Math.max(previous.visits, task.visits),
				lastQualifiedAt: Math.max(previous.lastQualifiedAt || 0, task.lastQualifiedAt || 0),
				lastQualificationReason: newest.lastQualificationReason || previous.lastQualificationReason || task.lastQualificationReason,
				sessionQualified: newest.sessionQualified === true,
				sessionStartedActiveSeconds: Math.max(0, Number(newest.sessionStartedActiveSeconds) || 0)
			});
		}
		return Array.from(byActivity.values())
			.sort((a, b) => b.visitedAt - a.visitedAt || a.activityId.localeCompare(b.activityId))
			.slice(0, Math.max(1, Number(limit) || 40));
	}

	function accountActiveActivity(items, now, idleCapSeconds = DEFAULT_IDLE_CAP_SECONDS, activityId = '') {
		const active = activityId
			? items.find(item => item.activityId === activityId && item.sessionActive)
			: items.find(item => item.sessionActive);
		if (!active) return;
		const from = Math.max(active.visitedAt || 0, active.lastAccountedAt || 0);
		const elapsed = Math.max(0, (now - from) / 1000);
		if (elapsed > 0) active.activeSeconds += Math.min(elapsed, Math.max(1, Number(idleCapSeconds) || DEFAULT_IDLE_CAP_SECONDS));
		active.activeSeconds = Math.max(0, Math.round(active.activeSeconds));
		active.lastAccountedAt = Math.max(active.lastAccountedAt || 0, now);
		active.visitedAt = Math.max(active.visitedAt || 0, now);
	}

	function qualifyActiveSession(items, now, qualificationSeconds = DEFAULT_QUALIFICATION_SECONDS) {
		const threshold = Math.max(1, Number(qualificationSeconds) || DEFAULT_QUALIFICATION_SECONDS);
		items.forEach(item => {
			if (!item.sessionActive || item.sessionQualified) return;
			const sessionSeconds = Math.max(0, item.activeSeconds - (item.sessionStartedActiveSeconds || 0));
			if (sessionSeconds < threshold) return;
			item.sessionQualified = true;
			item.visits = Math.max(0, Number(item.visits) || 0) + 1;
			item.lastQualifiedAt = Math.max(item.lastQualifiedAt || 0, now);
			item.lastQualificationReason = 'duration';
		});
	}

	function beginActivitySession(items = [], next = null, options = {}) {
		const activity = normalizeVisitedTask({ ...(next || {}), visits: Math.max(0, Number(next?.visits) || 0) });
		if (!activity) return mergeVisitedTasks(items, null, options.limit);
		const now = activity.visitedAt || Date.now();
		const limit = Math.max(1, Number(options.limit) || 40);
		const merged = mergeVisitedTasks(items, null, limit);
		let previous = merged.find(item => item.activityId === activity.activityId) || null;
		const duplicate = !!previous && previous.sessionActive && now >= previous.visitedAt &&
			now - previous.visitedAt < Math.max(0, Number(options.dedupeMs) || DEFAULT_TOUCH_DEDUPE_MS);
		if (duplicate) {
			return merged.map(item => item.activityId === activity.activityId ? {
				...item,
				title: activity.title || item.title,
				dialogId: activity.dialogId || item.dialogId,
				lastAccountedAt: Math.max(item.lastAccountedAt || 0, now)
			} : item);
		}
		accountActiveActivity(merged, now, options.idleCapSeconds);
		qualifyActiveSession(merged, now, options.qualificationSeconds);
		merged.forEach(item => { item.sessionActive = false; });
		previous = merged.find(item => item.activityId === activity.activityId) || null;
		const updated = previous ? {
			...previous,
			title: activity.title || previous.title,
			dialogId: activity.dialogId || previous.dialogId,
			firstVisitedAt: Math.min(previous.firstVisitedAt || previous.visitedAt, activity.firstVisitedAt || now),
			visitedAt: Math.max(previous.visitedAt || 0, now),
			lastAccountedAt: now,
			sessionActive: true,
			sessionQualified: false,
			sessionStartedActiveSeconds: Math.max(0, Number(previous.activeSeconds) || 0)
		} : {
			...activity,
			visitedAt: now,
			firstVisitedAt: now,
			lastAccountedAt: now,
			sessionActive: true,
			sessionQualified: false,
			sessionStartedActiveSeconds: Math.max(0, Number(activity.activeSeconds) || 0),
			visits: 0
		};
		const result = previous
			? merged.map(item => item.activityId === updated.activityId ? updated : item)
			: [...merged, updated];
		return result
			.sort((a, b) => b.visitedAt - a.visitedAt || a.activityId.localeCompare(b.activityId))
			.slice(0, limit);
	}

	function qualifyActivityTouch(items = [], next = null, options = {}) {
		const activity = normalizeVisitedTask({ ...(next || {}), visits: 0 });
		if (!activity) return mergeVisitedTasks(items, null, options.limit);
		const now = activity.visitedAt || Date.now();
		let merged = beginActivitySession(items, activity, options);
		const dedupeMs = Math.max(0, Number(options.dedupeMs) || DEFAULT_TOUCH_DEDUPE_MS);
		return merged.map(item => {
			if (item.activityId !== activity.activityId) return item;
			if (item.lastQualifiedAt && now >= item.lastQualifiedAt && now - item.lastQualifiedAt < dedupeMs) return item;
			return {
				...item,
				title: activity.title || item.title,
				dialogId: activity.dialogId || item.dialogId,
				visitedAt: Math.max(item.visitedAt || 0, now),
				visits: Math.max(0, Number(item.visits) || 0) + 1,
				sessionQualified: true,
				lastQualifiedAt: now,
				lastQualificationReason: String(options.reason || 'message')
			};
		});
	}

	function recordActivityTouch(items = [], next = null, options = {}) {
		if (options.qualify === false) return beginActivitySession(items, next, options);
		return qualifyActivityTouch(items, next, { ...options, reason: options.reason || 'explicit' });
	}

	function closeActivitySession(items = [], now = Date.now(), options = {}) {
		const merged = mergeVisitedTasks(items, null, options.limit);
		accountActiveActivity(merged, Math.max(0, Number(now) || Date.now()), options.idleCapSeconds);
		qualifyActiveSession(merged, Math.max(0, Number(now) || Date.now()), options.qualificationSeconds);
		merged.forEach(item => { item.sessionActive = false; });
		return merged.sort((a, b) => b.visitedAt - a.visitedAt || a.activityId.localeCompare(b.activityId));
	}

	function syncActivitySession(items = [], activityId = '', now = Date.now(), options = {}) {
		const id = String(activityId || '');
		const merged = mergeVisitedTasks(items, null, options.limit);
		const at = Math.max(0, Number(now) || Date.now());
		accountActiveActivity(merged, at, options.idleCapSeconds, id);
		qualifyActiveSession(merged, at, options.qualificationSeconds);
		return merged.sort((a, b) => b.visitedAt - a.visitedAt || a.activityId.localeCompare(b.activityId));
	}

	function markActivityAccounted(items = [], activityId = '', accountedAt = Date.now()) {
		const id = String(activityId || '');
		const at = Math.max(0, Number(accountedAt) || Date.now());
		return mergeVisitedTasks(items).map(item => item.activityId === id ? {
			...item,
			accountedAt: Math.max(item.accountedAt || 0, at),
			accountedActiveSeconds: Math.max(item.accountedActiveSeconds || 0, item.activeSeconds || 0)
		} : item);
	}

	function selectUntrackedVisits(visits = [], trackedTasks = []) {
		const trackedById = new Map((Array.isArray(trackedTasks) ? trackedTasks : [])
			.map(task => [String(task?.taskId || ''), task])
			.filter(([taskId]) => taskId));
		return mergeVisitedTasks(visits).filter(task => {
			if (!task.lastQualifiedAt || task.visits <= 0 || task.lastQualifiedAt <= (task.accountedAt || 0)) return false;
			if ((task.accountedAt || 0) >= task.visitedAt) return false;
			if (!task.taskId) return true;
			const tracked = trackedById.get(task.taskId);
			if (!tracked) return true;
			const trackedAt = Date.parse(String(tracked.lastTrackedAt || ''));
			return Number.isFinite(trackedAt) ? task.visitedAt > trackedAt : false;
		});
	}

	function formatDurationCompact(seconds) {
		const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
		return `${Math.floor(totalMinutes / 60)}:${pad2(totalMinutes % 60)}`;
	}

	function formatDuration(seconds) {
		const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (!hours) return `${minutes} мин`;
		return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`;
	}

	function normalizeManualDuration(hours, minutes) {
		const rawHours = String(hours ?? '').trim();
		const rawMinutes = String(minutes ?? '').trim();
		if (!/^\d+$/.test(rawHours || '0') || !/^\d+$/.test(rawMinutes || '0')) {
			throw new RangeError('Укажите часы и минуты целыми числами');
		}
		const normalizedHours = Number(rawHours || 0);
		const normalizedMinutes = Number(rawMinutes || 0);
		if (normalizedMinutes > 59) throw new RangeError('Минуты должны быть от 0 до 59');
		const seconds = normalizedHours * 3600 + normalizedMinutes * 60;
		if (seconds < 60) throw new RangeError('Укажите хотя бы одну минуту');
		if (seconds > 24 * 3600) throw new RangeError('За один раз можно добавить не больше 24 часов');
		return { hours: normalizedHours, minutes: normalizedMinutes, seconds };
	}

	function formatPortalOffset(offsetMinutes) {
		const offset = Number(offsetMinutes);
		if (!Number.isFinite(offset)) return '';
		const absolute = Math.abs(Math.round(offset));
		return `${offset < 0 ? '-' : '+'}${pad2(Math.floor(absolute / 60))}:${pad2(absolute % 60)}`;
	}

	function buildElapsedWriteFields({ seconds, dateKey, offsetMinutes, commentText = '' } = {}) {
		const normalizedSeconds = Math.round(Number(seconds) || 0);
		if (normalizedSeconds < 60) throw new RangeError('Укажите хотя бы одну минуту');
		if (normalizedSeconds > 24 * 3600) throw new RangeError('За один раз можно добавить не больше 24 часов');
		const normalizedDate = String(dateKey || '').trim();
		if (!parseDateKey(normalizedDate)) throw new RangeError('Выберите корректную дату');
		// Noon is intentional: it is safely inside the selected portal day even when
		// the browser and portal use different time zones.
		return {
			SECONDS: normalizedSeconds,
			COMMENT_TEXT: String(commentText || ''),
			CREATED_DATE: `${normalizedDate}T12:00:00${formatPortalOffset(offsetMinutes)}`
		};
	}

	async function loadElapsedItems({
		callPage,
		callPages,
		taskIds = [],
		from,
		to,
		userId,
		pageSize = DEFAULT_PAGE_SIZE,
		maxPages = DEFAULT_MAX_PAGES,
		maxRangeDays = 366
	} = {}) {
		if (typeof callPages !== 'function' && typeof callPage !== 'function') throw new TypeError('callPages or callPage is required');
		const range = normalizeRange(from, to);
		if (countRangeDays(range.from, range.to) > Math.max(1, Number(maxRangeDays) || 366)) {
			throw new RangeError(`Выберите период не больше ${Math.max(1, Number(maxRangeDays) || 366)} дней`);
		}
		const requestedTaskIds = Array.from(new Set((Array.isArray(taskIds) ? taskIds : [])
			.map(value => String(value || '').trim())
			.filter(value => /^\d+$/.test(value))));
		if (!requestedTaskIds.length) {
			return { ...aggregateElapsedItems([]), range, pages: 0, totalAvailable: 0 };
		}
		const safePageSize = Math.min(DEFAULT_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
		const safeMaxPages = Math.max(1, Number(maxPages) || DEFAULT_MAX_PAGES);
		const collected = [];
		const seen = new Set();
		const totals = new Map();
		let pages = 0;
		let queue = requestedTaskIds.map(taskId => ({ taskId, page: 1 }));
		const runPages = async (paramsList, jobs) => {
			if (typeof callPages === 'function') return callPages(paramsList, jobs);
			return Promise.all(paramsList.map((params, index) => callPage(params, jobs[index])));
		};
		while (queue.length) {
			const wave = queue.splice(0, 50);
			const paramsList = wave.map(job => buildElapsedRequestParams({
				taskId: job.taskId,
				...range,
				userId,
				page: job.page,
				pageSize: safePageSize
			}));
			const responses = await runPages(paramsList, wave);
			if (!Array.isArray(responses) || responses.length !== wave.length) {
				throw new Error('Bitrix24 вернул неполный пакет записей времени');
			}
			const nextWave = [];
			responses.forEach((response, index) => {
				const job = wave[index];
				const batch = extractElapsedItems(response?.data ?? response);
				const expectedTotal = Number.isFinite(Number(response?.total)) && Number(response.total) >= 0
					? Number(response.total)
					: null;
				if (job.page === 1) totals.set(job.taskId, expectedTotal);
				for (const raw of batch) {
					const item = normalizeElapsedItem(raw);
					if (!item.taskId) item.taskId = job.taskId;
					const identity = item.id
						? `${job.taskId}:${item.id}`
						: `${job.taskId}:${item.userId}:${item.createdAt}:${item.seconds}`;
					if (seen.has(identity)) continue;
					seen.add(identity);
					collected.push(item);
				}
				pages += 1;
				const explicitNext = response?.next != null && response.next !== false;
				const totalHasMore = expectedTotal != null && job.page * safePageSize < expectedTotal;
				const fullPageMayHaveMore = batch.length >= safePageSize;
				const hasMore = explicitNext || totalHasMore || fullPageMayHaveMore;
				if (!hasMore) return;
				if (job.page >= safeMaxPages) throw new Error(`Слишком много записей времени в задаче #${job.taskId}: уточните даты`);
				nextWave.push({ taskId: job.taskId, page: job.page + 1 });
			});
			queue.push(...nextWave);
		}
		const requestedUserId = /^\d+$/.test(String(userId || '')) ? String(userId) : '';
		const requestedTaskIdSet = new Set(requestedTaskIds);
		const inRange = collected.filter(item =>
			requestedTaskIdSet.has(item.taskId) &&
			item.dateKey && item.dateKey >= range.from && item.dateKey <= range.to &&
			(!requestedUserId || !item.userId || item.userId === requestedUserId)
		);
		const knownTotals = Array.from(totals.values());
		const totalAvailable = knownTotals.every(value => value != null)
			? knownTotals.reduce((sum, value) => sum + value, 0)
			: null;
		return { ...aggregateElapsedItems(inRange), range, pages, totalAvailable };
	}

	// Shared by all extension REST producers. Diagnostics contain timings and method
	// names only; never task titles, messages, parameters or tokens.
	function createRequestQueue({ concurrency = 2, spacingMs = 80, timeoutMs = 12000, cooldownMs = 15000, burst = 16, refillMs = 500 } = {}) {
		const queue = [], pending = new Map(), samples = [];
		let active = 0, peak = 0, lastStart = 0, blockedUntil = 0, wake = null, deduplicated = 0;
		let tokens = burst, replenishedAt = Date.now();
		const pump = () => {
			if (wake || active >= concurrency || !queue.length) return;
			const now = Date.now();
			tokens = Math.min(burst, tokens + Math.max(0, now - replenishedAt) / refillMs);
			replenishedAt = now;
			const delay = Math.max(lastStart + spacingMs, blockedUntil, now + Math.max(0, 1 - tokens) * refillMs) - now;
			if (delay > 0) { wake = setTimeout(() => { wake = null; pump(); }, delay); return; }
			const job = queue.shift();
			if (job.isCurrent && !job.isCurrent()) {
				pending.delete(job.key); job.reject(Object.assign(new Error('Request superseded'), { code: 'SUPERSEDED' })); pump(); return;
			}
			tokens -= 1;
			active++; peak = Math.max(peak, active); lastStart = Date.now();
			const sample = { method: job.method, queuedMs: lastStart - job.queuedAt, startedAt: lastStart, durationMs: 0, status: 'pending' };
			samples.push(sample); if (samples.length > 200) samples.shift();
			let settled = false;
			const finish = (error, value) => {
				if (settled) return; settled = true; clearTimeout(timer);
				sample.durationMs = Date.now() - sample.startedAt;
				sample.status = error ? 'error' : 'ok';
				if (error) sample.code = String(error.code || 'REST_ERROR');
				if (error && /TIMEOUT|QUERY_LIMIT|TOO_MANY|429|время ожидания/i.test(String(error.code || '') + ' ' + error.message)) blockedUntil = Date.now() + cooldownMs;
				active--; pending.delete(job.key);
				if (error) job.reject(error); else job.resolve(value);
				pump();
			};
			const timer = setTimeout(() => finish(Object.assign(new Error(`${job.method}: превышено время ожидания`), { code: 'TIMEOUT' })), job.timeoutMs || timeoutMs);
			Promise.resolve().then(job.run).then(value => finish(null, value), error => finish(error));
			pump();
		};
		return {
			run(method, key, run, options = {}) {
				if (key && pending.has(key)) { deduplicated++; return pending.get(key); }
				const promise = new Promise((resolve, reject) => queue.push({ method, key, run, resolve, reject, queuedAt: Date.now(), ...options }));
				if (key) pending.set(key, promise);
				pump(); return promise;
			},
			snapshot: () => ({ active, queued: queue.length, peak, deduplicated, cooldownMs: Math.max(0, blockedUntil - Date.now()), samples: samples.map(sample => ({ ...sample })) })
		};
	}

	return Object.freeze({
		createRequestQueue,
		DEFAULT_PAGE_SIZE,
		DEFAULT_MAX_PAGES,
		DEFAULT_TOUCH_DEDUPE_MS,
		DEFAULT_IDLE_CAP_SECONDS,
		DEFAULT_QUALIFICATION_SECONDS,
		toDateKey,
		parseDateKey,
		addDays,
		normalizeRange,
		getQuickRange,
		countRangeDays,
		buildElapsedRequestParams,
		extractElapsedItems,
		normalizeElapsedItem,
		aggregateElapsedItems,
		normalizeVisitedTask,
		mergeVisitedTasks,
		beginActivitySession,
		qualifyActivityTouch,
		recordActivityTouch,
		syncActivitySession,
		closeActivitySession,
		markActivityAccounted,
		selectUntrackedVisits,
		formatDurationCompact,
		formatDuration,
		normalizeManualDuration,
		formatPortalOffset,
		buildElapsedWriteFields,
		loadElapsedItems
	});
});

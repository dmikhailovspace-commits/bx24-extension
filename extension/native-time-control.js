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
	// Touches explain the estimate, but do not add invented time. The estimate is
	// based on the active session only.
	const DEFAULT_TOUCH_WEIGHT_SECONDS = 0;
	const DEFAULT_ESTIMATE_STEP_SECONDS = 5 * 60;

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

	function buildElapsedRequestParams({ from, to, userId, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
		const range = normalizeRange(from, to);
		const filter = {
			'>=CREATED_DATE': `${range.from}T00:00:00`,
			'<CREATED_DATE': `${addDays(range.to, 1)}T00:00:00`
		};
		if (/^\d+$/.test(String(userId || ''))) filter.USER_ID = Number(userId);
		return [
			{ CREATED_DATE: 'desc', ID: 'desc' },
			filter,
			['ID', 'TASK_ID', 'USER_ID', 'SECONDS', 'MINUTES', 'CREATED_DATE', 'DATE_START', 'DATE_STOP'],
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
		const createdAt = String(item.CREATED_DATE ?? item.createdDate ?? item.DATE_START ?? item.dateStart ?? '');
		return {
			id: String(item.ID ?? item.id ?? ''),
			taskId: String(item.TASK_ID ?? item.taskId ?? ''),
			userId: String(item.USER_ID ?? item.userId ?? ''),
			seconds: Math.max(0, Math.round(seconds)),
			createdAt,
			dateKey: extractDateKey(createdAt),
			dateStart: String(item.DATE_START ?? item.dateStart ?? ''),
			dateStop: String(item.DATE_STOP ?? item.dateStop ?? '')
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
		// is discarded here so ordinary chats never enter estimates or history.
		if (!taskId) return null;
		const visitedAt = Math.max(0, Number(task.visitedAt) || 0);
		const firstVisitedAt = Math.max(0, Number(task.firstVisitedAt) || visitedAt);
		return {
			taskId,
			activityId: `task:${taskId}`,
			kind: 'task',
			title: String(task.title || '').replace(/\s+/g, ' ').trim(),
			dialogId,
			visitedAt,
			firstVisitedAt,
			lastAccountedAt: Math.max(0, Number(task.lastAccountedAt) || visitedAt),
			activeSeconds: Math.max(0, Math.round(Number(task.activeSeconds) || 0)),
			sessionActive: task.sessionActive === true,
			accountedAt: Math.max(0, Number(task.accountedAt) || 0),
			visits: Math.max(1, Number(task.visits) || 1)
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
				sessionActive: newest.sessionActive === true,
				accountedAt: Math.max(previous.accountedAt || 0, task.accountedAt || 0),
				visits: raw === next ? previous.visits + 1 : Math.max(previous.visits, task.visits)
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

	function recordActivityTouch(items = [], next = null, options = {}) {
		const activity = normalizeVisitedTask(next || {});
		if (!activity) return mergeVisitedTasks(items, null, options.limit);
		const now = activity.visitedAt || Date.now();
		const limit = Math.max(1, Number(options.limit) || 40);
		const merged = mergeVisitedTasks(items, null, limit);
		let previous = merged.find(item => item.activityId === activity.activityId) || null;
		const dedupeMs = Math.max(0, Number(options.dedupeMs) || DEFAULT_TOUCH_DEDUPE_MS);
		const duplicate = !!previous && now >= previous.visitedAt && now - previous.visitedAt < dedupeMs;
		if (duplicate) {
			return merged.map(item => item.activityId === activity.activityId ? {
				...item,
				title: activity.title || item.title,
				dialogId: activity.dialogId || item.dialogId,
				sessionActive: true,
				lastAccountedAt: Math.max(item.lastAccountedAt || 0, now)
			} : { ...item, sessionActive: false });
		}
		accountActiveActivity(merged, now, options.idleCapSeconds);
		merged.forEach(item => { item.sessionActive = false; });
		previous = merged.find(item => item.activityId === activity.activityId) || null;
		const updated = previous ? {
			...previous,
			...activity,
			title: activity.title || previous.title,
			dialogId: activity.dialogId || previous.dialogId,
			firstVisitedAt: Math.min(previous.firstVisitedAt || previous.visitedAt, activity.firstVisitedAt || now),
			lastAccountedAt: Math.max(previous.lastAccountedAt || 0, now),
			activeSeconds: Math.max(0, Number(previous.activeSeconds) || 0),
			accountedAt: Math.max(previous.accountedAt || 0, activity.accountedAt || 0),
			visitedAt: Math.max(previous.visitedAt || 0, now),
			sessionActive: true,
			visits: previous.visits + 1
		} : { ...activity, visitedAt: now, firstVisitedAt: now, lastAccountedAt: now, sessionActive: true };
		const result = previous
			? merged.map(item => item.activityId === updated.activityId ? updated : item)
			: [...merged, updated];
		return result
			.sort((a, b) => b.visitedAt - a.visitedAt || a.activityId.localeCompare(b.activityId))
			.slice(0, limit);
	}

	function closeActivitySession(items = [], now = Date.now(), options = {}) {
		const merged = mergeVisitedTasks(items, null, options.limit);
		accountActiveActivity(merged, Math.max(0, Number(now) || Date.now()), options.idleCapSeconds);
		merged.forEach(item => { item.sessionActive = false; });
		return merged.sort((a, b) => b.visitedAt - a.visitedAt || a.activityId.localeCompare(b.activityId));
	}

	function syncActivitySession(items = [], activityId = '', now = Date.now(), options = {}) {
		const id = String(activityId || '');
		const merged = mergeVisitedTasks(items, null, options.limit);
		accountActiveActivity(merged, Math.max(0, Number(now) || Date.now()), options.idleCapSeconds, id);
		return merged.sort((a, b) => b.visitedAt - a.visitedAt || a.activityId.localeCompare(b.activityId));
	}

	function estimateActivitySeconds(activity = {}, options = {}) {
		const normalized = normalizeVisitedTask(activity);
		if (!normalized) return 0;
		const touchWeight = options.touchWeightSeconds == null
			? DEFAULT_TOUCH_WEIGHT_SECONDS
			: Math.max(0, Number(options.touchWeightSeconds) || 0);
		const step = Math.max(60, Number(options.stepSeconds) || DEFAULT_ESTIMATE_STEP_SECONDS);
		const maximum = Math.max(step, Number(options.maxSeconds) || 8 * 3600);
		const raw = normalized.activeSeconds + normalized.visits * touchWeight;
		return Math.min(maximum, Math.max(step, Math.ceil(raw / step) * step));
	}

	function markActivityAccounted(items = [], activityId = '', accountedAt = Date.now()) {
		const id = String(activityId || '');
		const at = Math.max(0, Number(accountedAt) || Date.now());
		return mergeVisitedTasks(items).map(item => item.activityId === id ? { ...item, accountedAt: Math.max(item.accountedAt || 0, at) } : item);
	}

	function selectUntrackedVisits(visits = [], trackedTasks = []) {
		const trackedById = new Map((Array.isArray(trackedTasks) ? trackedTasks : [])
			.map(task => [String(task?.taskId || ''), task])
			.filter(([taskId]) => taskId));
		return mergeVisitedTasks(visits).filter(task => {
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

	async function loadElapsedItems({ callPage, from, to, userId, pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES, maxRangeDays = 366 } = {}) {
		if (typeof callPage !== 'function') throw new TypeError('callPage is required');
		const range = normalizeRange(from, to);
		if (countRangeDays(range.from, range.to) > Math.max(1, Number(maxRangeDays) || 366)) {
			throw new RangeError(`Выберите период не больше ${Math.max(1, Number(maxRangeDays) || 366)} дней`);
		}
		const safePageSize = Math.min(DEFAULT_PAGE_SIZE, Math.max(1, Number(pageSize) || DEFAULT_PAGE_SIZE));
		const safeMaxPages = Math.max(1, Number(maxPages) || DEFAULT_MAX_PAGES);
		const collected = [];
		const seen = new Set();
		let expectedTotal = null;
		let pages = 0;
		let lastBatchSize = 0;
		for (let page = 1; page <= safeMaxPages; page += 1) {
			const response = await callPage(buildElapsedRequestParams({ ...range, userId, page, pageSize: safePageSize }));
			const batch = extractElapsedItems(response?.data ?? response);
			lastBatchSize = batch.length;
			if (Number.isFinite(Number(response?.total)) && Number(response.total) >= 0) expectedTotal = Number(response.total);
			for (const raw of batch) {
				const item = normalizeElapsedItem(raw);
				const identity = item.id || `${item.taskId}:${item.userId}:${item.createdAt}:${item.seconds}`;
				if (seen.has(identity)) continue;
				seen.add(identity);
				collected.push(raw);
			}
			pages = page;
			if (!batch.length || batch.length < safePageSize || (expectedTotal != null && collected.length >= expectedTotal)) break;
		}
		if (pages >= safeMaxPages && lastBatchSize >= safePageSize && (expectedTotal == null || collected.length < expectedTotal)) {
			throw new Error('Слишком большой диапазон: уточните даты');
		}
		return { ...aggregateElapsedItems(collected), range, pages, totalAvailable: expectedTotal };
	}

	return Object.freeze({
		DEFAULT_PAGE_SIZE,
		DEFAULT_MAX_PAGES,
		DEFAULT_TOUCH_DEDUPE_MS,
		DEFAULT_IDLE_CAP_SECONDS,
		DEFAULT_TOUCH_WEIGHT_SECONDS,
		DEFAULT_ESTIMATE_STEP_SECONDS,
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
		recordActivityTouch,
		syncActivitySession,
		closeActivitySession,
		estimateActivitySeconds,
		markActivityAccounted,
		selectUntrackedVisits,
		formatDurationCompact,
		formatDuration,
		normalizeManualDuration,
		loadElapsedItems
	});
});

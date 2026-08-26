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
		const taskId = String(task.taskId ?? task.id ?? '').trim();
		if (!/^\d+$/.test(taskId)) return null;
		const visitedAt = Math.max(0, Number(task.visitedAt) || 0);
		return {
			taskId,
			title: String(task.title || '').replace(/\s+/g, ' ').trim(),
			dialogId: String(task.dialogId || '').trim(),
			visitedAt,
			visits: Math.max(1, Number(task.visits) || 1)
		};
	}

	function mergeVisitedTasks(items = [], next = null, limit = 40) {
		const byTask = new Map();
		for (const raw of [...(Array.isArray(items) ? items : []), ...(next ? [next] : [])]) {
			const task = normalizeVisitedTask(raw);
			if (!task) continue;
			const previous = byTask.get(task.taskId);
			if (!previous) {
				byTask.set(task.taskId, task);
				continue;
			}
			const newest = task.visitedAt >= previous.visitedAt ? task : previous;
			byTask.set(task.taskId, {
				...newest,
				title: newest.title || previous.title || task.title,
				dialogId: newest.dialogId || previous.dialogId || task.dialogId,
				visits: Math.max(1, previous.visits + (raw === next ? 1 : 0))
			});
		}
		return Array.from(byTask.values())
			.sort((a, b) => b.visitedAt - a.visitedAt || a.taskId.localeCompare(b.taskId))
			.slice(0, Math.max(1, Number(limit) || 40));
	}

	function selectUntrackedVisits(visits = [], trackedTasks = []) {
		const trackedIds = new Set((Array.isArray(trackedTasks) ? trackedTasks : []).map(task => String(task?.taskId || '')).filter(Boolean));
		return mergeVisitedTasks(visits).filter(task => !trackedIds.has(task.taskId));
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
		selectUntrackedVisits,
		formatDurationCompact,
		formatDuration,
		loadElapsedItems
	});
});

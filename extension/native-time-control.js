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
		const dateStart = String(item.DATE_START ?? item.dateStart ?? '');
		const recordedAt = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateStart) ? Date.parse(dateStart) : NaN;
		return {
			id: String(item.ID ?? item.id ?? ''),
			taskId: String(item.TASK_ID ?? item.taskId ?? ''),
			userId: String(item.USER_ID ?? item.userId ?? ''),
			seconds: Math.max(0, Math.round(seconds)),
			createdAt,
			dateKey: extractDateKey(createdAt),
			dateStart,
			recordedAt: Number.isFinite(recordedAt) && recordedAt > 0 ? recordedAt : 0,
			contactCutoffAt: Math.max(0, Number(item.contactCutoffAt) || 0),
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
			const task = tasks.get(taskKey) || { taskId: taskKey, seconds: 0, entries: 0, entryIds: [], lastTrackedAt: '', recordedEntries: [] };
			task.seconds += item.seconds;
			task.entries += 1;
			if (item.id) task.entryIds.push(item.id);
			if (item.id) task.recordedEntries.push({ id: item.id, recordedAt: item.recordedAt, contactCutoffAt: item.contactCutoffAt });
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

	// Inputs are already validated, normalized aggregates. Replace only accepted
	// tasks; unchanged records retain their identity and are not parsed/sorted again.
	function replaceElapsedTasks(previous, replacement, taskIds) {
		const accepted = new Set(Array.from(taskIds || [], String));
		const days = new Map((previous.days || []).map(day => [day.dateKey, { ...day }]));
		const tasks = new Map((previous.tasks || []).filter(task => !accepted.has(task.taskId)).map(task => [task.taskId, task]));
		let totalSeconds = previous.totalSeconds || 0;
		const adjust = (entry, direction) => {
			const key = entry.dateKey || 'unknown';
			const day = days.get(key) || { dateKey:key, seconds:0, entries:0 };
			day.seconds += direction * entry.seconds;
			day.entries += direction;
			totalSeconds += direction * entry.seconds;
			if (day.entries) days.set(key, day); else days.delete(key);
		};
		const kept = (previous.items || []).filter(entry => {
			if (!accepted.has(entry.taskId)) return true;
			adjust(entry, -1); return false;
		});
		const added = (replacement.items || []).filter(entry => accepted.has(entry.taskId));
		added.forEach(entry => adjust(entry, 1));
		for (const task of replacement.tasks || []) if (accepted.has(task.taskId)) tasks.set(task.taskId, task);
		const compare = (a,b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || String(b.id || '').localeCompare(String(a.id || ''));
		const items = [];
		let left = 0, right = 0;
		while (left < kept.length && right < added.length) items.push(compare(kept[left], added[right]) <= 0 ? kept[left++] : added[right++]);
		while (left < kept.length) items.push(kept[left++]);
		while (right < added.length) items.push(added[right++]);
		return {
			items, totalSeconds, entryCount:items.length,
			taskCount:Array.from(tasks.keys()).filter(key => key !== 'unknown').length,
			days:Array.from(days.values()).sort((a,b) => b.dateKey.localeCompare(a.dateKey)),
			tasks:Array.from(tasks.values()).sort((a,b) => b.seconds - a.seconds || b.entries - a.entries)
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
		const activeSeconds = Math.max(0, Number(task.activeSeconds) || 0);
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
			accountedActiveSeconds: Math.max(0, Number(task.accountedActiveSeconds) || 0),
			sessionActive: task.sessionActive === true,
			sessionQualified: task.sessionQualified === true,
			sessionStartedActiveSeconds: Math.max(0, Number(task.sessionStartedActiveSeconds) || 0),
			lastQualifiedAt: Math.max(0, Number(task.lastQualifiedAt) || legacyQualifiedAt),
			lastQualificationReason: String(task.lastQualificationReason || ''),
			accountedAt: Math.max(0, Number(task.accountedAt) || 0),
			accountedVisits: Math.max(0, Number(task.accountedVisits) || 0),
			accountedEntries: Array.isArray(task.accountedEntries) ? task.accountedEntries.filter(entry => /^[1-9]\d*$/.test(String(entry?.id || '')) && Number(entry.cutoffAt) > 0).map(entry => ({ id: String(entry.id), cutoffAt: Number(entry.cutoffAt) })) : [],
			contactEvents: Array.isArray(task.contactEvents) ? task.contactEvents.filter(event => event && typeof event.id === 'string' && Number.isFinite(Number(event.at))).map(event => ({ id: event.id, at: Number(event.at), reason: String(event.reason || '') })) : [],
			contactBaseVisits: Math.max(0, Number(task.contactBaseVisits) || 0),
			contactBaseQualifiedAt: Math.max(0, Number(task.contactBaseQualifiedAt) || 0),
			visits
		};
	}

	function mergeVisitedTasks(items = [], next = null, limit = Infinity) {
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
				accountedVisits: Math.max(previous.accountedVisits, task.accountedVisits),
				accountedEntries: Array.from(new Map([...previous.accountedEntries, ...task.accountedEntries].map(entry => [entry.id, entry])).values()),
				contactEvents: Array.from(new Map([...previous.contactEvents, ...task.contactEvents].map(event => [event.id, event])).values()),
				contactBaseVisits: Math.max(previous.contactBaseVisits, task.contactBaseVisits),
				contactBaseQualifiedAt: Math.max(previous.contactBaseQualifiedAt, task.contactBaseQualifiedAt),
				visits: raw === next ? previous.visits + Math.max(1, task.visits) : Math.max(previous.visits, task.visits),
				lastQualifiedAt: Math.max(previous.lastQualifiedAt || 0, task.lastQualifiedAt || 0),
				lastQualificationReason: newest.lastQualificationReason || previous.lastQualificationReason || task.lastQualificationReason,
				sessionQualified: newest.sessionQualified === true,
				sessionStartedActiveSeconds: Math.max(0, Number(newest.sessionStartedActiveSeconds) || 0)
			});
		}
		return Array.from(byActivity.values())
			.sort((a, b) => b.visitedAt - a.visitedAt || a.activityId.localeCompare(b.activityId))
			.slice(0, Math.max(1, Number(limit) || Infinity));
	}

	// Qualified events and their count are committed in the same daily ledger
	// record. Replaying an unacknowledged outbox event is therefore harmless.
	function applyQualifiedContact(items = [], event = {}) {
		const merged = mergeVisitedTasks(items);
		const task = normalizeVisitedTask({ ...event, visitedAt: event.qualifiedAt, visits: 0 });
		if (!task || !event.eventId || !(Number(event.qualifiedAt) > 0)) return merged;
		const previous = merged.find(item => item.taskId === task.taskId);
		if (previous?.contactEvents.some(item => item.id === event.eventId)) return merged;
		const baseVisits = previous?.contactEvents.length ? previous.contactBaseVisits : previous?.visits || 0;
		const baseAt = previous?.contactEvents.length ? previous.contactBaseQualifiedAt : previous?.lastQualifiedAt || 0;
		const events = [...(previous?.contactEvents || []), { id: String(event.eventId), at: Number(event.qualifiedAt), reason: String(event.reason || 'message') }]
			.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
		let visits = baseVisits, lastAt = 0, lastReason = '';
		for (const item of events) {
			if (baseAt && Math.abs(item.at - baseAt) < DEFAULT_TOUCH_DEDUPE_MS) continue;
			if (lastAt && item.at - lastAt < DEFAULT_TOUCH_DEDUPE_MS) continue;
			visits++; lastAt = item.at; lastReason = item.reason;
		}
		const updated = { ...(previous || task), title: task.title || previous?.title || '', dialogId: task.dialogId || previous?.dialogId || '',
			visitedAt: Math.max(previous?.visitedAt || 0, task.visitedAt), firstVisitedAt: Math.min(previous?.firstVisitedAt || task.visitedAt, task.visitedAt),
			lastQualifiedAt: Math.max(baseAt, lastAt), lastQualificationReason: lastAt >= baseAt ? lastReason : previous?.lastQualificationReason || '',
			sessionActive: false, sessionQualified: true, visits, contactEvents: events, contactBaseVisits: baseVisits, contactBaseQualifiedAt: baseAt };
		return mergeVisitedTasks([...merged.filter(item => item.taskId !== task.taskId), updated]);
	}

	function accountActiveActivity(items, now, idleCapSeconds = DEFAULT_IDLE_CAP_SECONDS, activityId = '') {
		const active = activityId
			? items.find(item => item.activityId === activityId && item.sessionActive)
			: items.find(item => item.sessionActive);
		if (!active) return;
		const from = Math.max(active.visitedAt || 0, active.lastAccountedAt || 0);
		const elapsed = Math.max(0, (now - from) / 1000);
		if (elapsed > 0) active.activeSeconds += Math.min(elapsed, Math.max(1, Number(idleCapSeconds) || DEFAULT_IDLE_CAP_SECONDS));
		active.activeSeconds = Math.max(0, active.activeSeconds);
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
		const limit = Math.max(1, Number(options.limit) || Infinity);
		const merged = mergeVisitedTasks(items, null, limit);
		let previous = merged.find(item => item.activityId === activity.activityId) || null;
		const duplicate = !!previous && previous.sessionActive && now >= previous.visitedAt &&
			now - previous.visitedAt < Math.max(0, Number(options.dedupeMs) || DEFAULT_TOUCH_DEDUPE_MS);
		if (duplicate) {
			accountActiveActivity(merged, now, options.idleCapSeconds, activity.activityId);
			qualifyActiveSession(merged, now, options.qualificationSeconds);
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

	function countPendingContacts(task, cutoffAt = task.accountedAt || 0) {
		if (!task.contactEvents.length) {
			if (!task.lastQualifiedAt || task.lastQualifiedAt <= cutoffAt) return 0;
			return Math.max(0, task.visits - task.accountedVisits);
		}
		const baseAt = task.contactBaseQualifiedAt;
		let pending = baseAt > cutoffAt ? Math.max(0, task.contactBaseVisits - task.accountedVisits) : 0;
		let lastAt = 0;
		for (const event of [...task.contactEvents].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
			if (baseAt && Math.abs(event.at - baseAt) < DEFAULT_TOUCH_DEDUPE_MS) continue;
			if (lastAt && event.at - lastAt < DEFAULT_TOUCH_DEDUPE_MS) continue;
			lastAt = event.at;
			if (event.at > cutoffAt) pending++;
		}
		return pending;
	}

	function markActivityAccounted(items = [], activityId = '', accountedAt = Date.now(), options = {}) {
		const id = String(activityId || '');
		const at = Math.max(0, Number(accountedAt) || Date.now());
		const merged = mergeVisitedTasks(items);
		if (!merged.some(item => item.activityId === id) && /^task:\d+$/.test(id)) {
			// The qualified contact may still be in the durable outbox at ACK time.
			// Keep its cutoff even when there is no visible visit row yet.
			merged.push(normalizeVisitedTask({ taskId: id.slice(5), visitedAt: at, visits: 0 }));
		}
		const itemId = /^[1-9]\d*$/.test(String(options.itemId || '')) ? String(options.itemId) : '';
		return merged.map(item => {
			if (item.activityId !== id) return item;
			const cutoffAt = itemId ? item.accountedEntries.find(entry => entry.id === itemId)?.cutoffAt || at : at;
			return {
			...item,
			accountedAt: Math.max(item.accountedAt || 0, cutoffAt),
			accountedVisits: Math.max(item.accountedVisits, item.visits - countPendingContacts(item, cutoffAt)),
			accountedEntries: itemId && !item.accountedEntries.some(entry => entry.id === itemId)
				? [...item.accountedEntries, { id: itemId, cutoffAt }] : item.accountedEntries,
			accountedActiveSeconds: Math.max(item.accountedActiveSeconds || 0, item.activeSeconds || 0)
			};
		});
	}

	function selectUntrackedVisits(visits = [], trackedTasks = [], { localReceipts = [] } = {}) {
		const trackedById = new Map((Array.isArray(trackedTasks) ? trackedTasks : [])
			.map(task => [String(task?.taskId || ''), task])
			.filter(([taskId]) => taskId));
		return mergeVisitedTasks(visits).map(task => {
			const tracked = trackedById.get(task.taskId);
			const localEntries = new Map(task.accountedEntries.map(entry => [entry.id, entry.cutoffAt]));
			for (const entry of localReceipts) if (String(entry.taskId) === task.taskId && !localEntries.has(String(entry.id))) localEntries.set(String(entry.id), Number(entry.cutoffAt) || 0);
			let cutoffAt = task.accountedAt;
			for (const entry of tracked?.recordedEntries || []) {
				cutoffAt = Math.max(cutoffAt, localEntries.get(String(entry.id)) || Number(entry.contactCutoffAt) || Number(entry.recordedAt) || 0);
			}
			return { ...task, pendingContacts: countPendingContacts(task, cutoffAt), trackedSeconds: Math.max(0, Number(tracked?.seconds) || 0), contactCutoffAt: cutoffAt };
		}).filter(task => task.pendingContacts > 0).sort((a, b) =>
			b.pendingContacts - a.pendingContacts ||
			(Number(b.lastQualifiedAt) || Number(b.visitedAt) || 0) - (Number(a.lastQualifiedAt) || Number(a.visitedAt) || 0) ||
			String(a.taskId).localeCompare(String(b.taskId), 'en', {numeric:true}));
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

	function buildElapsedWriteFields({ seconds, dateKey, offsetMinutes, commentText = '', allowSubMinute = false } = {}) {
		const normalizedSeconds = Math.floor(Number(seconds) || 0);
		if (normalizedSeconds < (allowSubMinute ? 1 : 60)) throw new RangeError(allowSubMinute ? 'Нет прошедшего времени' : 'Укажите хотя бы одну минуту');
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

	function segmentTimerByPortalDay({ startedAt, stoppedAt, seconds, utcOffsetMinutes } = {}) {
		const start = Number(startedAt), stop = Number(stoppedAt);
		if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return [];
		const total = Math.max(0, Math.floor(seconds == null ? (stop - start) / 1000 : Number(seconds) || 0));
		if (!total) return [];
		const offset = Number.isFinite(Number(utcOffsetMinutes)) && utcOffsetMinutes != null ? Number(utcOffsetMinutes) : -new Date(start).getTimezoneOffset();
		const segments = []; let cursor = start, assigned = 0;
		while (cursor < stop) {
			const portal = new Date(cursor + offset * 60000);
			const dateKey = portal.toISOString().slice(0, 10);
			const midnight = Date.UTC(portal.getUTCFullYear(), portal.getUTCMonth(), portal.getUTCDate() + 1) - offset * 60000;
			const end = Math.min(stop, midnight);
			const cumulative = end === stop ? total : Math.min(total, Math.floor((end - start) / 1000));
			if (cumulative > assigned) segments.push({ dateKey, seconds: cumulative - assigned });
			assigned = cumulative; cursor = end;
		}
		return segments;
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
				if (response == null) throw new Error(`Bitrix24 не вернул записи времени задачи #${job.taskId}`);
				const payload = response?.data ?? response;
				if (!Array.isArray(payload) && !Array.isArray(payload?.result) && !Array.isArray(payload?.items)) {
					throw Object.assign(new Error(`Bitrix24 вернул некорректный список времени задачи #${job.taskId}`), { code: 'TIME_RESPONSE_INVALID' });
				}
				const batch = extractElapsedItems(payload);
				const expectedTotal = Number.isFinite(Number(response?.total)) && Number(response.total) >= 0
					? Number(response.total)
					: null;
				if (job.page === 1) totals.set(job.taskId, expectedTotal);
				let newItems = 0;
				for (const raw of batch) {
					const item = normalizeElapsedItem(raw);
					const amount = raw?.SECONDS ?? raw?.seconds ?? raw?.MINUTES ?? raw?.minutes;
					if ((/^\d+$/.test(String(userId || '')) && !/^[1-9]\d*$/.test(item.userId)) ||
						!item.dateKey || amount == null || String(amount).trim() === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) {
						throw Object.assign(new Error(`Bitrix24 вернул неполную запись времени задачи #${job.taskId}`), { code: 'TIME_RESPONSE_INVALID' });
					}
					if (!item.taskId) item.taskId = job.taskId;
					const identity = item.id
						? `${job.taskId}:${item.id}`
						: `${job.taskId}:${item.userId}:${item.createdAt}:${item.seconds}`;
					if (seen.has(identity)) continue;
					seen.add(identity);
					newItems++;
					collected.push(item);
				}
				pages += 1;
				const explicitNext = response?.next != null && response.next !== false;
				const totalHasMore = expectedTotal != null && job.page * safePageSize < expectedTotal;
				const fullPageMayHaveMore = batch.length >= safePageSize;
				const hasMore = explicitNext || totalHasMore || fullPageMayHaveMore;
				if (job.page > 1 && batch.length && newItems === 0 && hasMore) throw new Error(`Bitrix24 повторил страницу записей времени задачи #${job.taskId}`);
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
			(!requestedUserId || item.userId === requestedUserId)
		);
		const knownTotals = Array.from(totals.values());
		const totalAvailable = knownTotals.every(value => value != null)
			? knownTotals.reduce((sum, value) => sum + value, 0)
			: null;
		return { ...aggregateElapsedItems(inRange), range, pages, totalAvailable };
	}

	// tasks/classes/general/elapseditem.php has an explicit taskId === 0 global
	// branch (observed in 23.675.0). Empty responses need independent evidence:
	// older portals can silently interpret the sentinel as an ordinary task ID.
	async function loadGlobalElapsedItems({ callPage, from, to, userId, knownItems = [], probeTaskId = '', supported = false, isCurrent = () => true, maxPages = 2000 } = {}) {
		if (typeof callPage !== 'function') throw new TypeError('callPage is required');
		if (!/^[1-9]\d*$/.test(String(userId || ''))) throw new TypeError('Current user ID is required');
		const range = normalizeRange(from, to);
		if (countRangeDays(range.from, range.to) > 366) throw new RangeError('Выберите период не больше 366 дней');
		const select = ['ID','TASK_ID','USER_ID','SECONDS','MINUTES','CREATED_DATE','DATE_START','DATE_STOP','COMMENT_TEXT','SOURCE'];
		const dateFilter = { USER_ID:Number(userId), '>=CREATED_DATE':`${range.from}T00:00:00`, '<CREATED_DATE':`${addDays(range.to, 1)}T00:00:00` };
		const invalid = message => Object.assign(new Error(message), { code:'GLOBAL_TIME_RESPONSE_INVALID', globalFallback:true });
		let pages = 0;
		const request = async (filter, order = { ID:'ASC' }, size = 50, taskId = 0) => {
			if (!isCurrent()) throw Object.assign(new Error('Request superseded'), { code:'SUPERSEDED' });
			const response = await callPage([taskId, order, filter, select, { NAV_PARAMS:{ nPageSize:size, iNumPage:1 } }]);
			if (!isCurrent()) throw Object.assign(new Error('Request superseded'), { code:'SUPERSEDED' });
			pages++;
			if (response?.error || response?.partial || response?.complete === false) throw Object.assign(new Error('Битрикс24 вернул неполный общий журнал'), { code:response?.error?.code || 'GLOBAL_TIME_RESPONSE_INCOMPLETE' });
			const payload = response?.data ?? response;
			if (response == null || (!Array.isArray(payload) && !Array.isArray(payload?.result) && !Array.isArray(payload?.items))) throw invalid('Битрикс24 вернул некорректный общий журнал');
			const rows = extractElapsedItems(payload);
			if (rows.length > size) throw invalid('Битрикс24 проигнорировал размер страницы журнала');
			const items = rows.map(raw => {
				const item = normalizeElapsedItem(raw), seconds = raw?.SECONDS ?? raw?.seconds;
				const created = raw?.CREATED_DATE ?? raw?.createdDate ?? raw?.createdAt;
				if (!/^[1-9]\d*$/.test(item.id) || !Number.isSafeInteger(Number(item.id)) || !/^[1-9]\d*$/.test(item.taskId) || !Number.isSafeInteger(Number(item.taskId)) ||
					item.userId !== String(userId) || !item.dateKey || !created || !Number.isFinite(Date.parse(created)) ||
					!['number','string'].includes(typeof seconds) || String(seconds).trim() === '' || !Number.isSafeInteger(Number(seconds)) || Number(seconds) < 0) throw invalid('Битрикс24 вернул неполную или чужую запись времени');
				return item;
			});
			return { items, response };
		};
		try {
			const collected = [];
			let cursor = 0;
			for (let page = 0; page < Math.max(1, maxPages); page++) {
				const { items, response } = await request({ ...dateFilter, '>ID':cursor });
				for (const item of items) {
					if (Number(item.id) <= cursor || item.dateKey < range.from || item.dateKey > range.to) throw invalid('Битрикс24 проигнорировал курсор или даты общего журнала');
					cursor = Number(item.id); collected.push(item);
				}
				if (!collected.length) {
					const known = knownItems.find(item => /^[1-9]\d*$/.test(String(item?.id || '')) && String(item.userId) === String(userId));
					if (!supported || known) {
						const witness = await request({ USER_ID:Number(userId), ...(known ? { ID:Number(known.id) } : {}) }, { ID:'DESC' }, 1);
						if (!witness.items.length) return { supported:false, reason:'empty-unverified', pages };
						const item = witness.items[0];
						if ((known && (item.id !== String(known.id) || item.taskId !== String(known.taskId))) ||
							(item.dateKey >= range.from && item.dateKey <= range.to)) throw invalid('Пустой общий журнал противоречит подтверждённой записи');
					}
				}
				const explicitMore = response?.next === true || Number(response?.next) > 0;
				const totalMore = Number.isFinite(Number(response?.total)) && Number(response.total) > items.length;
				if (items.length < 50 && !explicitMore && !totalMore) return { ...aggregateElapsedItems(collected), range, pages, totalAvailable:collected.length, supported:true };
				if (!items.length) throw invalid('Битрикс24 не вернул ожидаемый хвост журнала');
			}
			throw invalid('Превышен предел страниц общего журнала');
		} catch (error) {
			// Network/quota failures must not fan out into a portal-wide legacy scan.
			const detail = `${error?.code || ''} ${error?.message || ''} ${error?.description || ''}`.toUpperCase();
			if (/TIMEOUT|QUERY_LIMIT|OPERATION_TIME_LIMIT|OVERLOAD|429|NETWORK|CONNECTION|INTERNAL_SERVER|SERVICE_UNAVAILABLE|SUPERSEDED|STALE_REQUEST/.test(detail)) throw error;
			// Some portals reject the undocumented zero task sentinel with the same
			// numeric/core errors used for real access failures. A successful ordinary
			// task read distinguishes sentinel incompatibility from a broken method.
			// This one-page probe never supplies totals or freshness, including []:
			// the bounded legacy reader must still establish complete task coverage.
			const ambiguous = /(?:^|[^A-Z0-9_])(?:0X000001|0X000004|0X000100|0X100002|ERROR_CORE|ACTION_NOT_ALLOWED|ACCESS_DENIED)(?:$|[^A-Z0-9_])/.test(detail);
			if (ambiguous) {
				if (pages > 0) throw error;
				const id = Number(probeTaskId);
				if (!/^[1-9]\d*$/.test(String(probeTaskId)) || !Number.isSafeInteger(id)) throw error;
				try {
					const probe = await request(dateFilter, { ID:'ASC' }, 1, id);
					if (probe.items.some(item => item.taskId !== String(id) || item.dateKey < range.from || item.dateKey > range.to)) throw error;
				} catch (probeError) {
					if (probeError?.code === 'SUPERSEDED' || probeError?.code === 'STALE_REQUEST') throw probeError;
					// Do not leak a validation error's globalFallback flag: a failed probe
					// is never permission to dispatch thousands of per-task requests.
					throw error;
				}
				return { supported:false, reason:'unsupported-confirmed-by-task', pages };
			}
			if (/UNKNOWN_METHOD|METHOD_NOT_FOUND|ERROR_METHOD_NOT_FOUND|WRONG_ARGUMENTS|INVALID_PARAMETERS|ERROR_ARGUMENT|TASK_NOT_FOUND/.test(detail)) return { supported:false, reason:'unsupported', pages };
			throw error;
		}
	}

	// Parallel, disjoint ID ranges retain keyset safety without serial network
	// round trips. The high watermark belongs to this read; later IDs are picked
	// up by the next delta whose cursor is the start of the full read.
	async function loadTaskCatalogPartitions({ afterId, upperId, filter = {}, select, callPages, isCurrent = () => true, maxPages = 2000 } = {}) {
		if (!Number.isSafeInteger(afterId) || !Number.isSafeInteger(upperId) || afterId < 0 || upperId < afterId) throw new TypeError('Invalid task ID bounds');
		let pending = upperId > afterId ? [{ after: afterId, upper: upperId, empty: false }] : [];
		const rows = []; let pages = 0;
		while (pending.length) {
			if (!isCurrent()) throw Object.assign(new Error('Task catalog superseded'), { code:'STALE_REQUEST' });
			while (pending.length < 16) {
				let index = -1, width = 1;
				pending.forEach((job, i) => { if (!job.empty && job.upper - job.after > width) { index = i; width = job.upper - job.after; } });
				if (index < 0) break;
				const job = pending[index], mid = job.after + Math.floor(width / 2);
				pending.splice(index, 1, { after:job.after, upper:mid, empty:false }, { after:mid, upper:job.upper, empty:false });
			}
			const wave = pending.splice(0, 16);
			if (pages + wave.length > maxPages) throw new Error('Слишком большой список задач');
			const responses = await callPages(wave.map(job => ({ method:'tasks.task.list', params:{ filter:{ ...filter, '>ID':job.after, '<=ID':job.upper }, select, order:{ ID:'asc' }, start:0 } })));
			if (!isCurrent()) throw Object.assign(new Error('Task catalog superseded'), { code:'STALE_REQUEST' });
			if (!Array.isArray(responses) || responses.length !== wave.length || wave.some((_,i) => !responses[i] || responses[i].error || responses[i].partial || responses[i].complete === false)) throw new Error('Неполный пакет задач');
			responses.forEach((page, index) => {
				const job = wave[index], payload = page?.data?.result ?? page?.data;
				const batch = Array.isArray(payload) ? payload : payload?.tasks ?? payload?.items;
				if (!Array.isArray(batch)) throw new Error('Некорректная страница задач');
				let cursor = job.after;
				for (const row of batch) {
					const id = Number(row?.ID ?? row?.id);
					if (!Number.isSafeInteger(id) || id <= cursor || id > job.upper) throw new Error('Битрикс24 нарушил границы списка задач');
					cursor = id;
				}
				rows.push(...batch); pages++;
				if (!batch.length) { if (!job.empty) pending.push({ ...job, empty:true }); return; }
				const more = page.next != null && page.next !== false || payload?.hasMore === true || payload?.hasMorePages === true;
				const noMore = payload?.hasMore === false || payload?.hasMorePages === false;
				if (cursor < job.upper && !noMore && (more || batch.length >= 50)) pending.push({ after:cursor, upper:job.upper, empty:false });
			});
		}
		rows.sort((a,b) => Number(a.ID ?? a.id) - Number(b.ID ?? b.id));
		return { rows, pages };
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
				if (error && /TIMEOUT|QUERY_LIMIT|OPERATION_TIME_LIMIT|TOO_MANY|429|время ожидания/i.test(String(error.code || '') + ' ' + error.message)) blockedUntil = Date.now() + cooldownMs;
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
		applyQualifiedContact,
		segmentTimerByPortalDay,
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
		replaceElapsedTasks,
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
		loadTaskCatalogPartitions,
		loadElapsedItems,
		loadGlobalElapsedItems
	});
});

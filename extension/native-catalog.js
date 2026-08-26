(function attachPenaNativeCatalog(root, factory) {
	'use strict';

	const api = factory();
	if (root && typeof root === 'object') {
		root.__PENA_NATIVE_CATALOG__ = api;
	}
	if (typeof module === 'object' && module && module.exports) {
		module.exports = api;
	}
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function createPenaNativeCatalog() {
	'use strict';

	const ALL_SEGMENTS = new Set(['', '__all__']);
	const ALL_FOLDERS = new Set(['', '__all__', '__all_folders__']);
	const USER_FIELDS = ['folderId', 'segmentId', 'color', 'colorMode', 'icon'];

	function hasOwn(value, key) {
		return Object.prototype.hasOwnProperty.call(value, key);
	}

	function normalizeText(value) {
		let text = String(value == null ? '' : value);
		if (typeof text.normalize === 'function') text = text.normalize('NFKC');
		return text.replace(/\s+/g, ' ').trim().toLowerCase();
	}

	function normalizeId(value) {
		const id = normalizeText(value);
		if (!id) return '';
		if (/^(?:chat|user)\d+$/.test(id)) return id;
		if (/^\d+$/.test(id)) return `user${id}`;
		return id;
	}

	function itemIdCandidates(item, fallbackId) {
		if (!item || typeof item !== 'object') return [];
		const values = [item.id, item.dialogId, item.restDialogId, fallbackId];
		const result = [];
		const seen = new Set();
		for (const value of values) {
			const id = normalizeId(value);
			if (!id || seen.has(id)) continue;
			seen.add(id);
			result.push(id);
		}
		return result;
	}

	function primaryItemId(item, fallbackId) {
		return itemIdCandidates(item, fallbackId)[0] || '';
	}

	function itemTitle(item) {
		return String(item?.displayTitle || item?.title || '').replace(/\s+/g, ' ').trim();
	}

	function buildIndex(items) {
		const byId = new Map();
		const byTitle = new Map();
		const list = Array.isArray(items) ? items : [];

		for (const item of list) {
			if (!item || typeof item !== 'object') continue;
			for (const id of itemIdCandidates(item)) byId.set(id, item);

			const title = normalizeText(itemTitle(item));
			if (!title) continue;
			const matches = byTitle.get(title);
			if (matches) matches.push(item);
			else byTitle.set(title, [item]);
		}

		return { byId, byTitle };
	}

	function recentEntries(recentMeta) {
		if (recentMeta instanceof Map) {
			const entries = [];
			recentMeta.forEach((value, key) => entries.push([key, value]));
			return entries;
		}
		if (Array.isArray(recentMeta)) return recentMeta.map(value => ['', value]);
		if (recentMeta && typeof recentMeta === 'object') return Object.entries(recentMeta);
		return [];
	}

	function mergeDefined(target, source) {
		for (const key of Object.keys(source || {})) {
			if (source[key] !== undefined && source[key] !== null) target[key] = source[key];
		}
		return target;
	}

	function buildRecentIndex(recentMeta) {
		const byId = new Map();
		const uniqueById = new Map();

		for (const [fallbackId, value] of recentEntries(recentMeta)) {
			if (!value || typeof value !== 'object') continue;
			const ids = itemIdCandidates(value, fallbackId);
			if (!ids.length) continue;

			let record = null;
			for (const id of ids) {
				if (byId.has(id)) {
					record = byId.get(id);
					break;
				}
			}
			if (!record) {
				const id = ids[0];
				record = { id, meta: {}, order: uniqueById.size };
				uniqueById.set(id, record);
			}

			mergeDefined(record.meta, value);
			if (!record.meta.id) record.meta.id = record.id;
			for (const id of ids) byId.set(id, record);
			for (const id of itemIdCandidates(record.meta, record.id)) byId.set(id, record);
		}

		return { byId, records: Array.from(uniqueById.values()) };
	}

	function normalizeMode(mode) {
		return String(mode || '').toLowerCase() === 'tasks' ? 'tasks' : 'chats';
	}

	function explicitMode(value) {
		if (!value || typeof value !== 'object') return '';
		const mode = String(value.mode || value.catalogMode || '').toLowerCase();
		if (mode === 'tasks' || mode === 'task') return 'tasks';
		if (mode === 'chats' || mode === 'chat') return 'chats';
		if (value.isTask === true) return 'tasks';
		if (value.isTask === false) return 'chats';
		return '';
	}

	function recentBelongsToMode(meta, mode) {
		const declared = explicitMode(meta);
		if (declared) return declared === mode;
		return mode === 'chats';
	}

	function resolvedBelongsToMode(item, meta, mode) {
		const itemMode = explicitMode(item);
		if (itemMode) return itemMode === mode;
		const hasUserPlacement = item?.recentManaged !== true || !!(
			item?.folderId || item?.segmentId || item?.controlled === true || item?.color || item?.colorMode === 'none'
		);
		if (hasUserPlacement) return true;
		const recentMode = explicitMode(meta);
		return !recentMode || recentMode === mode;
	}

	function firstNonEmpty(values) {
		for (const value of values) {
			if (value !== undefined && value !== null && String(value).trim() !== '') return value;
		}
		return '';
	}

	function finiteTimestamp(value) {
		if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
		if (value instanceof Date) {
			const timestamp = value.getTime();
			return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
		}
		if (typeof value !== 'string' || !value.trim()) return 0;
		const numeric = Number(value);
		if (Number.isFinite(numeric) && numeric > 0) return numeric;
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
	}

	function updateFromRecent(item, meta, canonicalId) {
		const next = { ...item };
		const preserved = {};
		for (const field of USER_FIELDS) {
			if (hasOwn(item, field)) preserved[field] = item[field];
		}

		const title = firstNonEmpty([meta.displayTitle, meta.title]);
		const lastText = firstNonEmpty([meta.displayLastText, meta.lastText]);
		const lastMessageTs = finiteTimestamp(meta.lastMessageTs || meta.lastMessageDate || meta.date);
		const restDialogId = firstNonEmpty([meta.restDialogId, meta.dialogId, meta.id, canonicalId]);

		if (!next.id) next.id = canonicalId;
		if (title) next.title = String(title).replace(/\s+/g, ' ').trim();
		if (meta.displayTitle !== undefined) next.displayTitle = meta.displayTitle;
		if (hasOwn(meta, 'avatarUrl')) next.avatarUrl = String(meta.avatarUrl || '');
		if (hasOwn(meta, 'avatarColor')) next.avatarColor = String(meta.avatarColor || '');
		if (lastText || hasOwn(meta, 'lastText') || hasOwn(meta, 'displayLastText')) next.lastText = String(lastText || '');
		if (meta.displayLastText !== undefined) next.displayLastText = meta.displayLastText;
		if (restDialogId) next.dialogId = String(restDialogId);
		if (meta.restDialogId !== undefined) next.restDialogId = String(meta.restDialogId || '');
		if (lastMessageTs) {
			next.lastMessageTs = lastMessageTs;
			next.addedAt = lastMessageTs;
		} else if (hasOwn(meta, 'lastMessageTs')) {
			next.lastMessageTs = 0;
		}
		if (hasOwn(meta, 'lastMessageId')) next.lastMessageId = Number(meta.lastMessageId) || 0;
		if (hasOwn(meta, 'lastReadMessageId')) next.lastReadMessageId = Number(meta.lastReadMessageId) || 0;
		if (hasOwn(meta, 'unreadCount')) next.unreadCount = Math.max(0, Number(meta.unreadCount) || 0);
		if (hasOwn(meta, 'hasUnread')) next.hasUnread = !!meta.hasUnread;
		else if (hasOwn(meta, 'unreadCount')) next.hasUnread = next.unreadCount > 0;
		if (hasOwn(meta, 'hasLater')) next.hasLater = !!meta.hasLater;
		if (hasOwn(meta, 'hasMention')) next.hasMention = !!meta.hasMention;
		if (hasOwn(meta, 'isTask')) next.isTask = meta.isTask;
		if (hasOwn(meta, 'taskId')) next.taskId = meta.taskId || '';
		if (hasOwn(meta, 'taskUrl')) next.taskUrl = meta.taskUrl || '';
		if (hasOwn(meta, 'fetchedAt')) next.fetchedAt = meta.fetchedAt;
		if (hasOwn(meta, 'counterFetchedAt')) next.counterFetchedAt = meta.counterFetchedAt;
		if (hasOwn(meta, 'detailFetchedAt')) next.detailFetchedAt = meta.detailFetchedAt;
		next.recentManaged = true;

		for (const field of USER_FIELDS) {
			if (hasOwn(preserved, field)) next[field] = preserved[field];
			else delete next[field];
		}
		return next;
	}

	function mergeDuplicateUserFields(target, duplicate) {
		for (const field of USER_FIELDS) {
			if ((!hasOwn(target, field) || target[field] === '') && hasOwn(duplicate, field)) {
				target[field] = duplicate[field];
			}
		}
	}

	function mergeRecentItems(existingItems, recentMeta, mode) {
		const targetMode = normalizeMode(mode);
		const result = [];
		const existingById = new Map();

		for (const source of Array.isArray(existingItems) ? existingItems : []) {
			if (!source || typeof source !== 'object') continue;
			const item = { ...source };
			if (item.type === 'folder') {
				result.push(item);
				continue;
			}

			const ids = itemIdCandidates(item);
			let duplicateSlot = null;
			for (const id of ids) {
				if (existingById.has(id)) {
					duplicateSlot = existingById.get(id);
					break;
				}
			}
			if (duplicateSlot) {
				mergeDuplicateUserFields(duplicateSlot.item, item);
				continue;
			}

			const slot = { index: result.length, item };
			result.push(item);
			for (const id of ids) existingById.set(id, slot);
		}

		const recent = buildRecentIndex(recentMeta);
		for (const record of recent.records) {
			if (!recentBelongsToMode(record.meta, targetMode)) continue;
			const ids = itemIdCandidates(record.meta, record.id);
			let existingSlot = null;
			for (const id of ids) {
				if (existingById.has(id)) {
					existingSlot = existingById.get(id);
					break;
				}
			}

			const updated = updateFromRecent(existingSlot?.item || { id: record.id }, record.meta, record.id);
			let slot = existingSlot;
			if (slot) {
				result[slot.index] = updated;
				slot.item = updated;
			} else {
				slot = { index: result.length, item: updated };
				result.push(updated);
			}
			for (const id of itemIdCandidates(updated, record.id)) existingById.set(id, slot);
		}

		return result;
	}

	function findRecentRecord(index, item) {
		for (const id of itemIdCandidates(item)) {
			if (index.byId.has(id)) return index.byId.get(id);
		}
		return null;
	}

	function assignedColor(item) {
		return normalizeText(item?.color || '');
	}

	function rowDate(item) {
		if (item && hasOwn(item, 'lastMessageTs')) return finiteTimestamp(item.lastMessageTs);
		return item?.recentManaged ? finiteTimestamp(item.addedAt) : 0;
	}

	function selectRows(options) {
		const settings = options && typeof options === 'object' ? options : {};
		const items = Array.isArray(settings.items) ? settings.items : [];
		const recent = buildRecentIndex(settings.recentById);
		const mode = normalizeMode(settings.mode);
		const query = normalizeText(settings.query);
		const targetSegmentId = String(settings.segmentId || '');
		const targetFolderId = String(settings.folderId || '');
		const filterSegment = !ALL_SEGMENTS.has(targetSegmentId);
		const filterFolder = !ALL_FOLDERS.has(targetFolderId);
		const unreadOnly = !!settings.unreadOnly;
		const sortMode = String(settings.sortMode || 'date').toLowerCase();
		const direction = String(settings.sortDirection || 'desc').toLowerCase() === 'asc' ? 1 : -1;
		const folderSegments = new Map();
		const selected = [];
		const seen = new Set();

		for (const item of items) {
			if (item?.type !== 'folder') continue;
			const id = String(item.id || '');
			if (id) folderSegments.set(id, String(item.segmentId || ''));
		}

		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			if (!item || typeof item !== 'object' || item.type === 'folder') continue;
			const id = primaryItemId(item);
			if (!id || seen.has(id)) continue;
			seen.add(id);

			const recentRecord = findRecentRecord(recent, item);
			const meta = recentRecord?.meta || null;
			if (!resolvedBelongsToMode(item, meta, mode)) continue;
			const row = meta ? updateFromRecent(item, meta, id) : { ...item };
			const effectiveSegmentId = String(row.segmentId || folderSegments.get(String(row.folderId || '')) || '');
			if (filterSegment && effectiveSegmentId !== targetSegmentId) continue;
			if (filterFolder && String(row.folderId || '') !== targetFolderId) continue;

			const unread = !!row.hasUnread || !!row.hasLater || Math.max(0, Number(row.unreadCount) || 0) > 0;
			if (unreadOnly && !unread) continue;
			if (query) {
				const haystack = `${normalizeText(itemTitle(row))} ${normalizeText(row.displayLastText || row.lastText || '')}`.trim();
				if (!haystack.includes(query)) continue;
			}

			selected.push({ row, index, date: rowDate(row), color: assignedColor(row) });
		}

		if (sortMode === 'date') {
			selected.sort((left, right) => {
				if (!left.date && !right.date) return left.index - right.index;
				if (!left.date) return 1;
				if (!right.date) return -1;
				if (left.date !== right.date) return (left.date - right.date) * direction;
				return left.index - right.index;
			});
		} else if (sortMode === 'color') {
			selected.sort((left, right) => {
				if (!left.color && !right.color) return left.index - right.index;
				if (!left.color) return 1;
				if (!right.color) return -1;
				const compared = left.color.localeCompare(right.color);
				return compared ? compared * direction : left.index - right.index;
			});
		}

		return selected.map(entry => entry.row);
	}

	function nonNegativeNumber(value, fallback) {
		const number = Number(value);
		return Number.isFinite(number) && number >= 0 ? number : fallback;
	}

	function getVirtualWindow(options) {
		const settings = options && typeof options === 'object' ? options : {};
		const count = Math.max(0, Math.floor(nonNegativeNumber(settings.count, 0)));
		const rowHeight = Math.max(1, nonNegativeNumber(settings.rowHeight, 1));
		const viewportHeight = nonNegativeNumber(settings.viewportHeight, 0);
		const overscan = Math.max(0, Math.floor(nonNegativeNumber(settings.overscan, 0)));
		const totalHeight = count * rowHeight;

		if (!count) {
			return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0, totalHeight: 0 };
		}

		const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
		const scrollTop = Math.min(nonNegativeNumber(settings.scrollTop, 0), maxScrollTop);
		const firstVisible = Math.min(count - 1, Math.floor(scrollTop / rowHeight));
		const visibleEnd = Math.min(count, Math.max(firstVisible + 1, Math.ceil((scrollTop + viewportHeight) / rowHeight)));
		const start = Math.max(0, firstVisible - overscan);
		const end = Math.min(count, visibleEnd + overscan);

		return {
			start,
			end,
			topSpacer: start * rowHeight,
			bottomSpacer: (count - end) * rowHeight,
			totalHeight
		};
	}

	function captureAnchor(options) {
		const settings = options && typeof options === 'object' ? options : {};
		const rows = Array.isArray(settings.rows) ? settings.rows : [];
		if (!rows.length) return null;
		const rowHeight = Math.max(1, nonNegativeNumber(settings.rowHeight, 1));
		const scrollTop = Math.min(nonNegativeNumber(settings.scrollTop, 0), Math.max(0, rows.length * rowHeight - 1));
		const index = Math.min(rows.length - 1, Math.floor(scrollTop / rowHeight));
		const id = primaryItemId(rows[index]);
		if (!id) return null;
		return { id, offset: scrollTop - index * rowHeight, index };
	}

	function restoreAnchor(options) {
		const settings = options && typeof options === 'object' ? options : {};
		const rows = Array.isArray(settings.rows) ? settings.rows : [];
		const anchor = settings.anchor;
		const rowHeight = Math.max(1, nonNegativeNumber(settings.rowHeight, 1));
		const fallback = nonNegativeNumber(settings.fallbackScrollTop, NaN);
		if (!anchor || !rows.length) return Number.isFinite(fallback) ? fallback : 0;

		const id = normalizeId(anchor.id);
		let index = -1;
		for (let cursor = 0; cursor < rows.length; cursor += 1) {
			if (primaryItemId(rows[cursor]) === id) {
				index = cursor;
				break;
			}
		}
		if (index < 0) {
			if (Number.isFinite(fallback)) return fallback;
			index = Math.min(rows.length - 1, Math.max(0, Math.floor(nonNegativeNumber(anchor.index, 0))));
		}

		const offset = Math.min(rowHeight - Number.EPSILON, nonNegativeNumber(anchor.offset, 0));
		return index * rowHeight + offset;
	}

	return Object.freeze({
		buildIndex,
		mergeRecentItems,
		selectRows,
		getVirtualWindow,
		captureAnchor,
		restoreAnchor,
		normalizeId,
		normalizeText
	});
});

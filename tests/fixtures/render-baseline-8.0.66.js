// Frozen comparison reference from original v8.0.66 (5b7bcc8). Test-only.
	function _getDialogControlItemsForView(items, visibleChatIndex = buildChatElementIndex()) {
		const source = (Array.isArray(items) ? items : []).filter(item =>
			_isDialogControlFolder(item) || !_isDialogControlItemUnavailable(item)
		);
		const prefs = _getDialogControlViewPrefs();
		const direction = prefs.sortDirection === 'asc' ? 1 : -1;
		const sourceIndex = new Map(source.map((item, index) => [item, index]));
		const liveOrder = new Map();
		let liveRank = 0;
		visibleChatIndex?.forEach?.((_el, id) => {
			const key = normId(id);
			if (key && !liveOrder.has(key)) liveOrder.set(key, liveRank++);
		});
		const folders = source.filter(_isDialogControlFolder);
		const folderUnits = new Map(folders.map(folder => [String(folder.id || ''), { root: folder, children: [], index: sourceIndex.get(folder) || 0 }]));
		const units = [];
		source.forEach(item => {
			if (_isDialogControlFolder(item)) {
				units.push(folderUnits.get(String(item.id || '')));
				return;
			}
			const meta = _getDialogControlItemLiveMeta(item, visibleChatIndex);
			if (prefs.unreadOnly && !_isDialogControlUnreadMeta(meta)) return;
			const parent = item.folderId ? folderUnits.get(String(item.folderId)) : null;
			if (parent) parent.children.push(item);
			else units.push({ root: item, children: [], index: sourceIndex.get(item) || 0 });
		});
		const filteredUnits = prefs.unreadOnly
			? units.filter(unit => !_isDialogControlFolder(unit.root) || unit.children.length > 0)
			: units;
		const dialogDate = (item) => Number(_getDialogControlItemLiveMeta(item, visibleChatIndex)?.lastMessageTs) || 0;
		const dialogRank = (item) => liveOrder.get(normId(item?.id)) ?? (1000000 + (sourceIndex.get(item) || 0));
		const unitRank = (unit) => _isDialogControlFolder(unit.root)
			? Math.min(...unit.children.map(dialogRank), 1000000 + unit.index)
			: dialogRank(unit.root);
		const colorRank = (item) => _getDialogControlAssignedColor(item, source);
		const folderDate = (unit) => {
			const dates = unit.children.map(dialogDate).filter(value => value > 0);
			if (!dates.length) return 0;
			return prefs.sortDirection === 'asc' ? Math.min(...dates) : Math.max(...dates);
		};
		const compareDates = (aDate, bDate) => {
			if (!aDate && !bDate) return 0;
			if (!aDate) return 1;
			if (!bDate) return -1;
			return (aDate - bDate) * direction;
		};
		const compareColors = (aColor, bColor) => {
			if (!aColor && !bColor) return 0;
			if (!aColor) return 1;
			if (!bColor) return -1;
			return aColor.localeCompare(bColor) * direction;
		};
		const compare = (a, b) => {
			if (prefs.sortMode === 'date') {
				const aDate = _isDialogControlFolder(a.root) ? folderDate(a) : dialogDate(a.root);
				const bDate = _isDialogControlFolder(b.root) ? folderDate(b) : dialogDate(b.root);
				return compareDates(aDate, bDate) || ((unitRank(a) - unitRank(b)) * direction) || (a.index - b.index);
			}
			if (prefs.sortMode === 'color') return compareColors(colorRank(a.root), colorRank(b.root)) || (a.index - b.index);
			return a.index - b.index;
		};
		filteredUnits.sort(compare);
		filteredUnits.forEach(unit => unit.children.sort((a, b) => {
			if (prefs.sortMode === 'date') return compareDates(dialogDate(a), dialogDate(b)) || ((dialogRank(a) - dialogRank(b)) * direction);
			return compareColors(colorRank(a), colorRank(b)) || ((sourceIndex.get(a) || 0) - (sourceIndex.get(b) || 0));
		}));
		return filteredUnits.flatMap(unit => _isDialogControlFolder(unit.root) ? [unit.root, ...unit.children] : [unit.root]);
	}

	function _getDialogControlNativeDialogItemsForSegment(items, segmentId = '') {
		const source = Array.isArray(items) ? items : [];
		const id = String(segmentId || '');
		const dialogs = source.filter(item => !_isDialogControlFolder(item));
		if (_getDialogControlUniqueOnly()) {
			const placement = _getDialogControlPlacementIndex(source);
			return dialogs.filter(item => placement.segmentOf(item) === id);
		}
		if (!id) return dialogs;
		const folderIdsInSegment = new Set(source
			.filter(item => _isDialogControlFolder(item) && String(item.segmentId || '') === id)
			.map(item => String(item.id || ''))
			.filter(Boolean));
		return dialogs.filter(item =>
			String(item.segmentId || '') === id ||
			(item.folderId && folderIdsInSegment.has(String(item.folderId)))
		);
	}

	function _getDialogControlNativeFoldersForSegment(items, segmentId = '') {
		const source = Array.isArray(items) ? items : [];
		const id = String(segmentId || '');
		const folders = source.filter(_isDialogControlFolder);
		if (_getDialogControlUniqueOnly()) {
			const placement = _getDialogControlPlacementIndex(source);
			return folders.filter(folder => placement.segmentOf(folder) === id);
		}
		if (!id) return folders;
		const dialogItems = _getDialogControlNativeDialogItemsForSegment(source, id);
		const folderIds = new Set(dialogItems.map(item => String(item.folderId || '')).filter(Boolean));
		return folders.filter(folder =>
			String(folder.segmentId || '') === id ||
			folderIds.has(String(folder.id || ''))
		);
	}

function baselineCounters(counterSource, groupTabs, activeSegmentId, segmentFolders, visibleChatIndex, searching, uniqueOnly) {
const source=counterSource, viewPrefs={uniqueOnly};
const segmentDialogItems=_getDialogControlNativeDialogItemsForSegment(counterSource,activeSegmentId);
		const allDialogItems = counterSource.filter(item => !_isDialogControlFolder(item));
		const filteredDialogItems = allDialogItems.filter(item => searching
			? !_isDialogControlItemUnavailable(item) : _matchesDialogControlGlobalFilters(item, visibleChatIndex));
		// Segment helpers retain source object references. Reuse this render's filter
		// result for all tabs; the next render reads fresh filters and live metadata.
		const filteredDialogSet = new Set(filteredDialogItems);
		const groupStatuses = new Map();
		groupTabs.forEach(group => {
			const id = String(group.id || '');
			const dialogs = group.isAll && !viewPrefs.uniqueOnly
				? filteredDialogItems
				: _getDialogControlNativeDialogItemsForSegment(counterSource, id)
					.filter(item => filteredDialogSet.has(item));
			groupStatuses.set(id, _getDialogControlNotificationStatus(dialogs, visibleChatIndex));
		});
		const filteredSegmentDialogItems = segmentDialogItems
			.filter(item => filteredDialogSet.has(item));
		const placement = viewPrefs.uniqueOnly ? _getDialogControlPlacementIndex(source) : null;
		const segmentStatus = _getDialogControlNotificationStatus(placement
			? filteredSegmentDialogItems.filter(item => !placement.folderOf(item))
			: filteredSegmentDialogItems, visibleChatIndex);
		const folderStatuses = new Map(), folderChildren = new Map();
		for (const item of filteredSegmentDialogItems) {
			const id = String(item.folderId || '');
			if (!folderChildren.has(id)) folderChildren.set(id, []);
			folderChildren.get(id).push(item);
		}
		segmentFolders.forEach(folder => {
			const id = String(folder.id || '');
			const children = folderChildren.get(id) || [];
			folderStatuses.set(id, _getDialogControlNotificationStatus(children, visibleChatIndex));
		});

return {groupStatuses,folderStatuses,segmentStatus};
}

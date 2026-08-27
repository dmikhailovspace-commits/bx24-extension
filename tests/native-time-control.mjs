import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const time = require('../extension/native-time-control.js');

function makeItem(id, dateKey, seconds = 600, taskId = '10', userId = '7') {
	return {
		ID: String(id),
		TASK_ID: String(taskId),
		USER_ID: String(userId),
		SECONDS: String(seconds),
		CREATED_DATE: `${dateKey}T12:00:00+03:00`
	};
}

function testRanges() {
	assert.deepEqual(time.normalizeRange('2026-08-23', '2026-08-20'), {
		from: '2026-08-20',
		to: '2026-08-23',
		key: '2026-08-20:2026-08-23'
	});
	assert.equal(time.parseDateKey('2026-02-29'), null);
	assert.equal(time.addDays('2024-02-28', 1), '2024-02-29');
	const now = new Date(2026, 7, 23, 14, 30);
	assert.equal(time.getQuickRange('today', '2026-08-24').from, '2026-08-24');
	assert.deepEqual(time.getQuickRange('week', now), {
		from: '2026-08-17',
		to: '2026-08-23',
		key: '2026-08-17:2026-08-23'
	});
	assert.equal(time.getQuickRange('month', now).from, '2026-08-01');
}

function testOrderedRequestParams() {
	const params = time.buildElapsedRequestParams({
		from: '2026-08-22',
		to: '2026-08-23',
		userId: '42',
		page: 3
	});
	assert.equal(Array.isArray(params), true, 'legacy elapsed method requires positional arguments');
	assert.deepEqual(params[0], { CREATED_DATE: 'desc', ID: 'desc' });
	assert.deepEqual(params[1], {
		'>=CREATED_DATE': '2026-08-22T00:00:00',
		'<CREATED_DATE': '2026-08-24T00:00:00',
		USER_ID: 42
	});
	assert.equal(params[3].NAV_PARAMS.nPageSize, 50);
	assert.equal(params[3].NAV_PARAMS.iNumPage, 3);
}

function testAggregation() {
	const result = time.aggregateElapsedItems([
		makeItem(1, '2026-08-23', 3600, 10),
		makeItem(2, '2026-08-23', 1800, 11),
		{ ...makeItem(3, '2026-08-22', 0, 10), SECONDS: '', MINUTES: '30' }
	]);
	assert.equal(result.totalSeconds, 7200);
	assert.equal(result.entryCount, 3);
	assert.equal(result.taskCount, 2);
	assert.deepEqual(result.days.map(day => [day.dateKey, day.seconds]), [
		['2026-08-23', 5400],
		['2026-08-22', 1800]
	]);
	assert.equal(time.formatDurationCompact(result.totalSeconds), '2:00');
	assert.equal(time.formatDuration(5400), '1 ч 30 мин');
	assert.deepEqual(result.tasks.map(task => [task.taskId, task.seconds, task.entries]), [
		['10', 5400, 2],
		['11', 1800, 1]
	]);
	assert.deepEqual(result.tasks[0].entryIds, ['1', '3']);
}

function testDailyTaskVisits() {
	const merged = time.mergeVisitedTasks([
		{ taskId: '10', title: 'Первая задача', visitedAt: 1000, visits: 2 },
		{ taskId: '11', title: 'Вторая задача', visitedAt: 2000 }
	], { taskId: '10', title: 'Первая задача — обновлено', dialogId: 'chat10', visitedAt: 3000 });
	assert.deepEqual(merged.map(task => [task.taskId, task.visits, task.title]), [
		['10', 3, 'Первая задача — обновлено'],
		['11', 1, 'Вторая задача']
	]);
	assert.deepEqual(time.selectUntrackedVisits(merged, [{ taskId: '10' }]).map(task => task.taskId), ['11']);
	assert.equal(time.normalizeVisitedTask({ taskId: 'not-a-task' }), null);
	const withDialog = time.mergeVisitedTasks(merged, { dialogId: 'chat77', title: 'Клиентский диалог', visitedAt: 4000 });
	assert.deepEqual(withDialog.map(item => item.activityId), ['dialog:chat77', 'task:10', 'task:11']);
	assert.equal(withDialog[0].kind, 'dialog');
	assert.equal(time.selectUntrackedVisits(withDialog, [{ taskId: '10' }]).some(item => item.dialogId === 'chat77'), true);
}

function testManualDuration() {
	assert.deepEqual(time.normalizeManualDuration('2', '15'), { hours: 2, minutes: 15, seconds: 8100 });
	assert.deepEqual(time.normalizeManualDuration('', '30'), { hours: 0, minutes: 30, seconds: 1800 });
	assert.throws(() => time.normalizeManualDuration('0', '0'), /хотя бы одну минуту/i);
	assert.throws(() => time.normalizeManualDuration('1', '60'), /от 0 до 59/i);
	assert.throws(() => time.normalizeManualDuration('24', '1'), /не больше 24 часов/i);
}

async function testPaginationAndDedupe() {
	const all = Array.from({ length: 120 }, (_, index) => makeItem(index + 1, index < 60 ? '2026-08-23' : '2026-08-22', 60, (index % 4) + 1));
	const pages = [];
	const result = await time.loadElapsedItems({
		from: '2026-08-22',
		to: '2026-08-23',
		userId: '7',
		callPage: async params => {
			const page = params[3].NAV_PARAMS.iNumPage;
			pages.push(page);
			const start = (page - 1) * 50;
			return { data: all.slice(start, start + 50), total: all.length };
		}
	});
	assert.deepEqual(pages, [1, 2, 3]);
	assert.equal(result.pages, 3);
	assert.equal(result.entryCount, 120);
	assert.equal(result.totalSeconds, 7200);
	assert.equal(result.taskCount, 4);

	const duplicate = makeItem(1, '2026-08-23', 60, 1);
	const deduped = await time.loadElapsedItems({
		from: '2026-08-23',
		to: '2026-08-23',
		userId: '7',
		pageSize: 2,
		callPage: async params => params[3].NAV_PARAMS.iNumPage === 1
			? { data: [duplicate, makeItem(2, '2026-08-23', 60, 2)], total: 3 }
			: { data: [duplicate], total: 3 }
	});
	assert.equal(deduped.entryCount, 2);

	let oversizedCalls = 0;
	await assert.rejects(
		time.loadElapsedItems({
			from: '2025-08-01',
			to: '2026-08-23',
			callPage: async () => { oversizedCalls += 1; return { data: [] }; }
		}),
		/период не больше 366 дней/i
	);
	assert.equal(oversizedCalls, 0, 'oversized ranges must fail before REST calls');

	await assert.rejects(
		time.loadElapsedItems({
			from: '2026-08-23',
			to: '2026-08-23',
			pageSize: 2,
			maxPages: 2,
			callPage: async params => ({
				data: [makeItem(params[3].NAV_PARAMS.iNumPage * 10, '2026-08-23'), makeItem(params[3].NAV_PARAMS.iNumPage * 10 + 1, '2026-08-23')]
			})
		}),
		/слишком большой диапазон/i
	);
}

testRanges();
testOrderedRequestParams();
testAggregation();
testDailyTaskVisits();
testManualDuration();
await testPaginationAndDedupe();
console.log('native time control: all checks passed');

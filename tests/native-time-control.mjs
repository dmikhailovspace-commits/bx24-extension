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
		taskId: '17',
		from: '2026-08-22',
		to: '2026-08-23',
		userId: '42',
		page: 3
	});
	assert.equal(Array.isArray(params), true, 'legacy elapsed method requires positional arguments');
	assert.equal(params[0], 17, 'task.elapseditem.getlist requires TASKID as its first positional argument');
	assert.deepEqual(params[1], { CREATED_DATE: 'desc', ID: 'desc' });
	assert.deepEqual(params[2], {
		'>=CREATED_DATE': '2026-08-22T00:00:00',
		'<CREATED_DATE': '2026-08-24T00:00:00',
		USER_ID: 42
	});
	assert.equal(params[4].NAV_PARAMS.nPageSize, 50);
	assert.equal(params[4].NAV_PARAMS.iNumPage, 3);
	assert.equal(params[3].includes('COMMENT_TEXT'), true);
	assert.equal(params[3].includes('SOURCE'), true);
	assert.throws(() => time.buildElapsedRequestParams({ from: '2026-08-22', to: '2026-08-23' }), /taskId is required/i);
	assert.deepEqual(time.buildElapsedWriteFields({
		seconds: 4500,
		dateKey: '2026-08-21',
		offsetMinutes: 180,
		commentText: 'Ручная запись'
	}), {
		SECONDS: 4500,
		COMMENT_TEXT: 'Ручная запись',
		CREATED_DATE: '2026-08-21T12:00:00+03:00'
	});
	assert.equal(time.buildElapsedWriteFields({ seconds: 60, dateKey: '2026-08-21', offsetMinutes: -210 }).CREATED_DATE, '2026-08-21T12:00:00-03:30');
	assert.throws(() => time.buildElapsedWriteFields({ seconds: 59, dateKey: '2026-08-21' }), /хотя бы одну минуту/i);
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
		{ taskId: '10', title: 'Первая задача', visitedAt: 1000, lastQualifiedAt: 1000, visits: 2 },
		{ taskId: '11', title: 'Вторая задача', visitedAt: 2000, lastQualifiedAt: 2000, visits: 1 }
	], { taskId: '10', title: 'Первая задача — обновлено', dialogId: 'chat10', visitedAt: 3000, lastQualifiedAt: 3000 });
	assert.deepEqual(merged.map(task => [task.taskId, task.visits, task.title]), [
		['10', 3, 'Первая задача — обновлено'],
		['11', 1, 'Вторая задача']
	]);
	assert.deepEqual(time.selectUntrackedVisits(merged, [{ taskId: '10' }]).map(task => task.taskId), ['11']);
	assert.equal(time.normalizeVisitedTask({ taskId: 'not-a-task' }), null);
	const withDialog = time.mergeVisitedTasks(merged, { dialogId: 'chat77', title: 'Клиентский диалог', visitedAt: 4000 });
	assert.deepEqual(withDialog.map(item => item.activityId), ['task:10', 'task:11']);
	assert.equal(withDialog.every(item => item.kind === 'task'), true);
	assert.equal(time.selectUntrackedVisits(withDialog, [{ taskId: '10' }]).some(item => !item.taskId), false);
}

function testActivityEstimation() {
	const start = Date.parse('2026-08-27T09:00:00+03:00');
	let activities = time.beginActivitySession([], { taskId: '10', title: 'Задача 10', visitedAt: start });
	assert.equal(activities[0].visits, 0, 'opening a task must not count as work');
	assert.equal(time.selectUntrackedVisits(activities, []).length, 0, 'a quick open must not enter suggestions');
	activities = time.beginActivitySession(activities, { taskId: '10', title: 'Задача 10', visitedAt: start + 500 });
	assert.equal(activities[0].visits, 0, 'duplicate SidePanel events must stay unqualified');
	activities = time.syncActivitySession(activities, 'task:10', start + 59000);
	assert.equal(activities[0].visits, 0, 'a sub-minute view must not count as work');
	activities = time.syncActivitySession(activities, 'task:10', start + 61000);
	assert.equal(activities[0].visits, 1, 'one active minute must qualify the session');
	assert.equal(activities[0].lastQualificationReason, 'duration');
	activities = time.beginActivitySession(activities, { taskId: '11', title: 'Задача 11', visitedAt: start + 120000 });
	const task10 = activities.find(item => item.taskId === '10');
	assert.equal(task10.activeSeconds, 120, 'active dwell before switching tasks was not accumulated');
	activities = time.closeActivitySession(activities, start + 30 * 60000);
	assert.equal(activities.find(item => item.taskId === '11').activeSeconds, 900, 'idle dwell must be capped');
	assert.equal(activities.find(item => item.taskId === '11').visits, 1, 'a long active session must qualify once');
	const closedAgain = time.closeActivitySession(activities, start + 31 * 60000);
	assert.equal(closedAgain.find(item => item.taskId === '11').activeSeconds, 900, 'closing an inactive session twice must not add time');
	let live = time.beginActivitySession([], { taskId: '21', visitedAt: start });
	live = time.syncActivitySession(live, 'task:21', start + 125000);
	assert.equal(live[0].activeSeconds, 125, 'live task dwell must be accumulated without extra touches');
	assert.equal(live[0].visits, 1);
	let message = time.beginActivitySession([], { taskId: '22', visitedAt: start });
	message = time.qualifyActivityTouch(message, { taskId: '22', visitedAt: start + 1000 }, { reason: 'message' });
	assert.equal(message[0].visits, 1, 'an outgoing task message must qualify immediately');
	assert.equal(message[0].lastQualificationReason, 'message');

	const accounted = time.markActivityAccounted(activities, 'task:10', start + 121000);
	assert.equal(time.selectUntrackedVisits(accounted, []).some(item => item.taskId === '10'), false);
	assert.equal(accounted.find(item => item.taskId === '10').accountedActiveSeconds, 120);
	const reopened = time.beginActivitySession(accounted, { taskId: '10', visitedAt: start + 31 * 60000 });
	assert.equal(time.selectUntrackedVisits(reopened, []).some(item => item.taskId === '10'), false, 'reopening after accounting must not suggest work');
	let continued = time.syncActivitySession(reopened, 'task:10', start + 32 * 60000);
	const continuedTask = continued.find(item => item.taskId === '10');
	assert.equal(time.selectUntrackedVisits(continued, []).some(item => item.taskId === '10'), true, 'a qualified minute after accounting must be suggested');
	assert.equal(continuedTask.activeSeconds, 180);
	continued = time.markActivityAccounted(continued, 'task:10', start + 32 * 60000);
	continued = time.syncActivitySession(continued, 'task:10', start + 37 * 60000 + 1000);
	assert.equal(continued.find(item => item.taskId === '10').visits, 2, 'a new qualified contact must be counted without suggesting a duration');

	const visitAt = Date.parse('2026-08-27T12:00:00+03:00');
	const visit = [{ taskId: '30', visitedAt: visitAt, lastQualifiedAt: visitAt, visits: 1 }];
	assert.equal(time.selectUntrackedVisits(visit, [{ taskId: '30', lastTrackedAt: '2026-08-27T11:00:00+03:00' }]).length, 1);
	assert.equal(time.selectUntrackedVisits(visit, [{ taskId: '30', lastTrackedAt: '2026-08-27T13:00:00+03:00' }]).length, 0);
}

function testManualDuration() {
	assert.deepEqual(time.normalizeManualDuration('2', '15'), { hours: 2, minutes: 15, seconds: 8100 });
	assert.deepEqual(time.normalizeManualDuration('', '30'), { hours: 0, minutes: 30, seconds: 1800 });
	assert.throws(() => time.normalizeManualDuration('0', '0'), /хотя бы одну минуту/i);
	assert.throws(() => time.normalizeManualDuration('1', '60'), /от 0 до 59/i);
	assert.throws(() => time.normalizeManualDuration('24', '1'), /не больше 24 часов/i);
}

async function testPaginationAndDedupe() {
	const task1 = Array.from({ length: 55 }, (_, index) => makeItem(index + 1, index < 50 ? '2026-08-23' : '2026-08-22', 60, 1));
	const task2 = [
		makeItem(1, '2026-08-23', 120, 2),
		makeItem(2, '2026-08-22', 120, 2),
		makeItem(3, '2026-08-23', 120, 2)
	];
	const task3 = [
		makeItem(1, '2026-08-23', 600, 3, 8),
		makeItem(2, '2026-08-21', 600, 3, 7)
	];
	const byTask = new Map([['1', task1], ['2', task2], ['3', task3]]);
	const waves = [];
	const result = await time.loadElapsedItems({
		taskIds: ['1', '2', '3', '2', 'not-a-task'],
		from: '2026-08-22',
		to: '2026-08-23',
		userId: '7',
		callPages: async paramsList => {
			waves.push(paramsList.map(params => [String(params[0]), params[4].NAV_PARAMS.iNumPage]));
			return paramsList.map(params => {
				const taskId = String(params[0]);
				const page = params[4].NAV_PARAMS.iNumPage;
				const items = byTask.get(taskId) || [];
				const start = (page - 1) * 50;
				const data = items.slice(start, start + 50);
				if (taskId === '1' && page === 2) data.unshift(items[0]);
				return { data, total: items.length };
			});
		}
	});
	assert.deepEqual(waves, [[['1', 1], ['2', 1], ['3', 1]], [['1', 2]]]);
	assert.equal(result.pages, 4);
	assert.equal(result.entryCount, 58);
	assert.equal(result.totalSeconds, 3660);
	assert.equal(result.taskCount, 2);
	assert.deepEqual(result.days.map(day => day.dateKey), ['2026-08-23', '2026-08-22']);
	assert.equal(result.items.filter(item => item.taskId === '1' && item.id === '1').length, 1, 'pagination duplicate was not removed');
	assert.equal(result.items.some(item => item.taskId === '2' && item.id === '1'), true, 'same item ID from another task was incorrectly deduplicated');

	const empty = await time.loadElapsedItems({
		taskIds: [],
		from: '2026-08-23',
		to: '2026-08-23',
		callPages: async () => { throw new Error('must not run'); }
	});
	assert.equal(empty.entryCount, 0);
	assert.equal(empty.pages, 0);

	let oversizedCalls = 0;
	await assert.rejects(
		time.loadElapsedItems({
			taskIds: ['1'],
			from: '2025-08-01',
			to: '2026-08-23',
			callPages: async () => { oversizedCalls += 1; return []; }
		}),
		/период не больше 366 дней/i
	);
	assert.equal(oversizedCalls, 0, 'oversized ranges must fail before REST calls');

	await assert.rejects(
		time.loadElapsedItems({
			taskIds: ['1'],
			from: '2026-08-23',
			to: '2026-08-23',
			pageSize: 2,
			maxPages: 2,
			callPage: async params => ({
				data: [makeItem(params[4].NAV_PARAMS.iNumPage * 10, '2026-08-23', 60, params[0]), makeItem(params[4].NAV_PARAMS.iNumPage * 10 + 1, '2026-08-23', 60, params[0])]
			})
		}),
		/слишком много записей времени/i
	);
}

testRanges();
testOrderedRequestParams();
testAggregation();
testDailyTaskVisits();
testActivityEstimation();
testManualDuration();
await testPaginationAndDedupe();
console.log('native time control: all checks passed');

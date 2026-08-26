import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const interactions = require('../extension/native-interaction-state.js');
const { createInteractionState } = interactions;

function identity(kind, mode, dialogId, pointerId) {
	return { kind, mode, dialogId, pointerId };
}

function testBrowserAndNodePublication() {
	assert.equal(typeof interactions.createInteractionState, 'function');
	assert.deepEqual(interactions.GESTURE_KINDS, ['context', 'eyedropper', 'drag', 'multiselect']);

	const source = readFileSync(new URL('../extension/native-interaction-state.js', import.meta.url), 'utf8');
	const sandbox = { window: {} };
	vm.runInNewContext(source, sandbox, { filename: 'native-interaction-state.js' });
	assert.equal(typeof sandbox.window.__PENA_INTERACTIONS__?.begin, 'function');
	assert.equal(typeof sandbox.window.__PENA_INTERACTIONS__?.createInteractionState, 'function');
}

function testScopedConsumption() {
	const state = createInteractionState();
	const token = state.begin('context', { mode: 'chats', dialogId: 'CHAT42', pointerId: 8 });

	assert.equal(state.snapshot().state, 'context');
	assert.equal(state.consumeClick(identity('context', 'chats', 'chat42', 9)), false, 'another pointer must not be consumed');
	assert.equal(state.consumeClick(identity('drag', 'chats', 'chat42', 8)), false, 'another gesture must not be consumed');
	assert.equal(state.consumeClick(identity('context', 'tasks', 'chat42', 8)), false, 'another mode must not be consumed');
	assert.equal(state.consumeClick(identity('context', 'chats', 'chat99', 8)), false, 'another dialog must not be consumed');
	assert.equal(state.consumeClick(token), true);
	assert.equal(state.consumeClick(token), false, 'one token must consume at most one click');
	assert.equal(state.end('drag'), false, 'ending another gesture must not clear the current one');
	assert.equal(state.end('context'), true);
	assert.equal(state.snapshot().state, 'idle');
}

function testOverlappingGesturesCannotCrossSuppress() {
	const state = createInteractionState();
	const drag = state.begin('drag', { mode: 'chats', dialogId: 'chat1', pointerId: 1 });
	const eyedropper = state.begin('eyedropper', { mode: 'chats', dialogId: 'chat2', pointerId: 2 });

	assert.equal(state.consumeClick(drag), false, 'a superseded drag token must be inert');
	assert.equal(state.end('drag'), false, 'stale drag cleanup must not close the eyedropper');
	assert.equal(state.snapshot().state, 'eyedropper');
	assert.equal(state.consumeClick(eyedropper), true);
	assert.equal(state.snapshot().state, 'idle', 'eyedropper must finish after exactly one target');
	assert.equal(state.consumeClick(eyedropper), false);
}

function testEyedropperDoesNotOpenDialog() {
	const state = createInteractionState();
	const destination = state.begin('eyedropper', { mode: 'chats', dialogId: 'chat-destination', pointerId: 12 });
	let openedDialogs = 0;
	const sourceClick = identity('eyedropper', 'chats', 'chat-source', 77);

	if (!state.consumeClick(sourceClick)) openedDialogs += 1;
	assert.equal(openedDialogs, 0, 'the selected eyedropper source must not reach dialog opening');
	assert.equal(destination.dialogId, 'chat-destination', 'a reused source row must not replace the destination identity');
	assert.equal(state.snapshot().state, 'idle');
	assert.equal(state.consumeClick(sourceClick), false, 'the same source cannot be consumed twice');

	state.begin('eyedropper', { mode: 'chats', dialogId: 'chat-destination', pointerId: 15 });
	assert.equal(state.consumeClick(identity('eyedropper', 'tasks', 'chat-source', 77)), false);
	assert.equal(state.snapshot().state, 'eyedropper', 'a source from another mode must not finish the eyedropper');
	assert.equal(state.end('eyedropper'), true);
}

function testReusedRowCannotConsumeAnotherDialogGesture() {
	const state = createInteractionState();
	state.begin('drag', { mode: 'chats', dialogId: 'chat-original', pointerId: 31 });

	assert.equal(state.consumeClick(identity('drag', 'chats', 'chat-reused', 31)), false);
	assert.equal(state.snapshot().state, 'drag');
	assert.equal(state.consumeClick(identity('drag', 'chats', 'chat-original', 31)), true);
}

function testModeChangeInvalidatesOldGesture() {
	const state = createInteractionState();
	const oldToken = state.begin('multiselect', { mode: 'chats', dialogId: 'chat5', pointerId: 4 });

	assert.equal(state.consumeClick(identity('multiselect', 'tasks', 'chat5', 4)), false);
	assert.equal(state.reset('route'), true);
	assert.equal(state.consumeClick(oldToken), false, 'route reset must invalidate tokens from the previous mode');

	const taskToken = state.begin('multiselect', { mode: 'tasks', dialogId: 'chat5', pointerId: 4 });
	assert.equal(state.consumeClick(identity('multiselect', 'chats', 'chat5', 4)), false);
	assert.equal(state.consumeClick(taskToken), true);
	assert.equal(state.end('multiselect'), true);
}

function testDragLifecycleCleanup() {
	for (const reason of ['drop', 'pointercancel', 'blur', 'route']) {
		const state = createInteractionState();
		const token = state.begin('drag', { mode: 'chats', dialogId: `chat-${reason}`, pointerId: 3 });
		assert.equal(state.reset(reason), true);
		assert.equal(state.snapshot().state, 'idle');
		assert.equal(state.snapshot().lastResetReason, reason);
		assert.equal(state.consumeClick(token), false, `${reason} must invalidate the drag token`);
	}
}

function testExpiredToken() {
	let clock = 1000;
	const state = createInteractionState({ now: () => clock, tokenTtlMs: 50 });
	const expired = state.begin('context', { mode: 'chats', dialogId: 'chat-old', pointerId: 6 });

	clock = 1051;
	assert.equal(state.consumeClick(expired), false);
	assert.equal(state.snapshot().state, 'idle');
	assert.equal(state.snapshot().lastResetReason, 'expired');

	const fresh = state.begin('context', { mode: 'chats', dialogId: 'chat-old', pointerId: 6 });
	assert.notEqual(fresh.id, expired.id);
	assert.equal(state.consumeClick(expired), false, 'an expired generation must not suppress a fresh gesture');
	assert.equal(state.consumeClick(fresh.id), true, 'the opaque token id is also accepted');
}

function testWrappedEventIdentity() {
	const state = createInteractionState();
	state.begin('eyedropper', { mode: 'tasks', dialogId: 'task9', pointerId: 22 });
	const event = {
		pointerId: 999,
		penaInteractionIdentity: identity('eyedropper', 'tasks', 'task9', 22)
	};
	assert.equal(state.consumeClick(event), true);
	assert.equal(state.snapshot().state, 'idle');
}

const tests = [
	['browser and Node publication', testBrowserAndNodePublication],
	['scoped click consumption', testScopedConsumption],
	['overlapping gestures', testOverlappingGesturesCannotCrossSuppress],
	['eyedropper and reused row', testEyedropperDoesNotOpenDialog],
	['reused row identity', testReusedRowCannotConsumeAnotherDialogGesture],
	['mode change', testModeChangeInvalidatesOldGesture],
	['drag lifecycle cleanup', testDragLifecycleCleanup],
	['expired token', testExpiredToken],
	['wrapped event identity', testWrappedEventIdentity]
];

for (const [name, test] of tests) {
	test();
	console.log(`ok - ${name}`);
}

console.log('native interaction state: all checks passed');

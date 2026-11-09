import assert from 'node:assert/strict';
import vm from 'node:vm';

export async function checkVisibleReadRecovery(source) {
  const start = source.indexOf('\n\tfunction _bindDialogVisibleReadRecovery(');
  assert(start >= 0, 'Viewport read recovery must exist');
  const end = source.indexOf('\n\tfunction _getDialogNativeCounterMeta(', start);
  const code = source.slice(start, end);
  const phases = [];
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  function fixture() {
    let time = 100000, sequence = 0;
    const timers = new Map(), listeners = new Map(), events = new Map(), calls = [];
    const flags = { focus: true, hidden: false, enabled: true, readable: true, visible: true, user: '7' };
    const anchors = [{ chatId: 1, messageId: 10, type: 'mention', fromUserId: 2 },
      { chatId: 1, messageId: 90, type: 'mention', fromUserId: 2 },
      { chatId: 2, messageId: 8, type: 'mention', fromUserId: 2 }];
    const messages = new Map([10, 40, 50, 90].map(id => [id, { id, chatId: 1, viewed: true, unread: id === 10 || id === 90 }]));
    const state = { counter: 2, manualUnread: true, visible: [40, 50], layout: { entityId: 'chat1' } };
    const emitter = { subscribe: (name, fn) => events.set(name, fn), unsubscribe: name => events.delete(name) };
    const proxy = { dialogId: 'chat1', dialog: { chatId: 1, lastReadId: 5 },
      $el: { isConnected: true, getClientRects: () => flags.visible ? [{}] : [] },
      messagesCanBeRead: () => flags.readable,
      getVisibleMessagesManager: () => ({ getVisibleMessages: () => state.visible }), getEmitter: () => emitter };
    const instance = { proxy, isUnmounted: false };
    const store = { state: { messages: { anchors: { anchors } } }, getters: {
      'application/getLayout': state.layout, 'messages/getById': id => messages.get(id),
      'messages/getChatUnreadMessages': chatId => [...messages.values()].filter(m => m.chatId === chatId && m.unread),
      'counters/getCounterByChatId': () => state.counter
    }, async dispatch(type, payload) {
      calls.push({ type, payload: structuredClone(payload) });
      if (type === 'counters/setCounter') { state.counter = payload.counter; context.readRevision++; }
      if (type === 'messages/readMessages') for (const m of messages.values()) if (m.chatId === payload.chatId && m.id <= payload.messageIds[0]) m.unread = false;
      if (type === 'chats/update') proxy.dialog.lastReadId = payload.fields.lastId;
      if (type === 'messages/anchors/removeAnchor') {
        const list = store.state.messages.anchors.anchors;
        const index = list.indexOf(payload.anchor); if (index >= 0) list.splice(index, 1);
        context.readRevision++;
      }
    } };
    const context = { userId: '7', host: 'portal', store, readRevision: 0,
      core: { getUserId: () => flags.user, getStore: () => store },
      BXNS: { Messenger: { v2: { Const: { EventType: { dialog: { onMessageIsVisible: 'visible' } }, RestMethod: { imV2AnchorRead: 'anchor.read' } },
        Lib: { runAction: async (method, payload) => { calls.push({ type: method, payload }); return {}; } }
      } } } };
    const doc = { get hidden() { return flags.hidden; }, hasFocus: () => flags.focus, querySelector: () => ({}),
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
    const sandbox = { console, Map, Set, Number, Math, String, JSON, Date: { now: () => time },
      document: doc, window: doc, location: { host: 'portal' },
      setTimeout: fn => { timers.set(++sequence, fn); return sequence; }, clearTimeout: id => timers.delete(id),
      _isPenaExtensionEnabled: () => flags.enabled, isInternalChatsDOM: () => true,
      _findDialogNativeVueInstance: (_root, accept) => accept(instance),
      _assertDialogControlRestSuccess: value => { if (value === false) throw Error('Rejected'); },
      _scheduleBxRest: (_method, _payload, run, options) => { assert(options.isCurrent()); return run(); },
      _callBxRestMethod: async (method, payload, options) => {
        assert(options.isCurrent()); calls.push({ type: method, payload });
        return { dialogId: 'chat1', lastId: payload.MESSAGE_ID, counter: 1 };
      }
    };
    vm.createContext(sandbox); vm.runInContext(code, sandbox);
    const recovery = sandbox._bindDialogVisibleReadRecovery(context);
    const tick = async () => { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); await flush(); };
    return { sandbox, state, flags, calls, anchors, messages, instance, proxy, context, store, timers, listeners, events, recovery, tick,
      advance: () => { time += 31000; } };
  }
  async function phase(name, run) { await run(); phases.push(name); }
  await phase('Viewed messages repair old unread and anchor only through the visible boundary', async () => {
    const f = fixture(); await f.tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), { type: 'im.dialog.read', payload: { DIALOG_ID: 'chat1', MESSAGE_ID: 50 } });
    assert.equal(f.state.counter, 1); assert.equal(f.messages.get(10).unread, false); assert.equal(f.messages.get(90).unread, true);
    assert.equal(f.proxy.dialog.lastReadId, 50); assert.equal(f.state.manualUnread, true);
    assert.deepEqual(f.anchors.map(a => a.messageId), [90, 8]);
    assert(!f.calls.some(c => c.type === 'im.recent.unread'));
    assert.equal(f.timers.size, 0, 'No polling loop'); f.recovery.dispose();
    assert.equal(f.events.size + f.listeners.size, 0);
  });
  for (const flag of ['hidden', 'focus', 'enabled', 'readable', 'visible', 'user']) await phase(`No read when ${flag} invalidates the viewport`, async () => {
    const f = fixture(); f.flags[flag] = flag === 'hidden' ? true : flag === 'user' ? '8' : false;
    await f.tick(); assert.equal(f.calls.length, 0); f.recovery.dispose();
  });
  await phase('Foreign, temporary or absent messages never become a read boundary', async () => {
    const f = fixture(); f.state.visible = [0, -1, 'temp-id', 999]; await f.tick(); assert.equal(f.calls.length, 0);
    f.state.visible = [50]; f.messages.get(50).chatId = 2; f.recovery.schedule(); await f.tick(); assert.equal(f.calls.length, 0); f.recovery.dispose();
  });
  await phase('An anchor-only dialog is repaired without reading later messages', async () => {
    const f = fixture(); f.state.counter = 0; await f.tick();
    assert.equal(f.calls[0].type, 'anchor.read'); assert.deepEqual([...f.calls[0].payload.data.messageIds], [10]);
    assert.equal(f.messages.get(90).unread, true); f.recovery.dispose();
  });
  await phase('A healthy read dialog sends no request', async () => {
    const f = fixture(); f.state.counter = 0; f.anchors.splice(0, 1); await f.tick(); assert.equal(f.calls.length, 0); f.recovery.dispose();
  });
  await phase('New messages below a read viewport do not cause repeated read requests', async () => {
    const f = fixture(); f.proxy.dialog.lastReadId = 50; f.proxy.dialog.lastMessageId = 90;
    f.messages.get(10).unread = false; f.anchors.splice(0, 1);
    for (let i = 0; i < 10; i++) { f.state.counter++; f.recovery.schedule(); await f.tick(); f.advance(); }
    assert.equal(f.calls.length, 0); f.recovery.dispose();
  });
  await phase('A stale counter at the latest visible message still gets reconciled', async () => {
    const f = fixture(); f.proxy.dialog.lastReadId = 50; f.proxy.dialog.lastMessageId = 50;
    f.messages.get(10).unread = false; f.anchors.splice(0, 1); await f.tick();
    assert.equal(f.calls[0].type, 'im.dialog.read'); f.recovery.dispose();
  });
  await phase('Failed anchor acknowledgements preserve the local anchors', async () => {
    const f = fixture(); f.state.counter = 0;
    f.context.BXNS.Messenger.v2.Lib.runAction = async () => { throw Error('offline'); };
    await f.tick(); assert.equal(f.anchors.length, 3); f.recovery.dispose();
  });
  for (const mutation of ['new-counter', 'switch-dialog', 'switch-user', 'unmount', 'dispose']) await phase(`Late acknowledgement preserves ${mutation}`, async () => {
    const f = fixture(); let resolve;
    f.sandbox._callBxRestMethod = () => new Promise(done => { resolve = done; });
    await f.tick();
    if (mutation === 'new-counter') { f.state.counter = 3; f.context.readRevision++; }
    if (mutation === 'switch-dialog') f.state.layout.entityId = 'chat2';
    if (mutation === 'switch-user') f.flags.user = '8';
    if (mutation === 'unmount') f.instance.isUnmounted = true;
    if (mutation === 'dispose') f.recovery.dispose();
    resolve({ dialogId: 'chat1', lastId: 50, counter: 0 }); await flush();
    assert(!f.calls.some(c => c.type === 'counters/setCounter'));
    assert.equal(f.messages.get(90).unread, true);
    if (mutation !== 'new-counter') assert.equal(f.calls.length, 0);
    f.recovery.dispose();
  });
  await phase('Failed writes keep unread state and retry only on a later event', async () => {
    const f = fixture(); let count = 0;
    f.sandbox._callBxRestMethod = async () => { count++; throw Error('offline'); };
    await f.tick(); assert.equal(f.state.counter, 2); assert.equal(f.anchors.length, 3);
    f.recovery.schedule(); await f.tick(); assert.equal(count, 1);
    f.advance(); f.recovery.schedule(); await f.tick(); assert.equal(count, 2); f.recovery.dispose();
  });
  await phase('New anchors arriving during the request survive acknowledgement of the old set', async () => {
    const f = fixture(); f.state.counter = 0; let resolve;
    f.context.BXNS.Messenger.v2.Lib.runAction = () => new Promise(done => { resolve = done; });
    await f.tick(); const replacement = { ...f.anchors[0] };
    f.store.state.messages.anchors.anchors = [replacement, ...f.anchors.slice(1)];
    resolve({}); await flush(); assert(f.store.state.messages.anchors.anchors.includes(replacement)); f.recovery.dispose();
  });
  await phase('Viewport events coalesce and an already acknowledged boundary is throttled', async () => {
    const f = fixture(); await f.tick(); f.calls.length = 0;
    for (let i = 0; i < 100; i++) f.events.get('visible')?.();
    assert.equal(f.timers.size, 1); await f.tick();
    f.calls.length = 0; f.events.get('visible')(); await f.tick(); assert.equal(f.calls.length, 0); f.recovery.dispose();
  });
  return { scenarios: phases.length, phases };
}

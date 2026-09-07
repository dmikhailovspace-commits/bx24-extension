import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(process.env.PENA_TIME_CLOCK_SOURCE || new URL('../extension/injected.js', import.meta.url), 'utf8');
const timeModule = readFileSync(new URL('../extension/native-time-control.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`\tfunction ${name}(`);
  if (start < 0) return '';
  const next = /\n\t(?:async )?function /.exec(source.slice(start + 1));
  return source.slice(start, next ? start + 1 + next.index : undefined);
}
function fixture() {
  const state = { now: 1000000, day: '2026-09-07', scope: 'portal~1', syncs: 0, queries: 0, writes: 0, intervals: 0, clears: 0,
    tracker: { taskId: '17', startedAt: 1000000 }, tick: null };
  const node = initial => {
    let value = initial;
    return { get textContent() { return value; }, set textContent(next) { state.writes++; value = next; } };
  };
  const label = node('Сейчас 0:00'), duration = node('0:00');
  const switcher = { isConnected: true, querySelector(selector) {
    state.queries++;
    assert.ok(['.pena-native-time-button-label', '.pena-native-time-tracker-duration'].includes(selector), `Unexpected timer DOM work: ${selector}`);
    return selector.endsWith('button-label') ? label : duration;
  } };
  const sandbox = {
    Date: class extends Date { static now() { return state.now; } },
    document: { visibilityState: 'visible' },
    _dialogTimeTrackerTick: null, _dialogControlNativeSwitcherNode: switcher, _dialogControlNativeWorkspaceTab: 'time',
    _readDialogTimeTracker: () => state.tracker,
    _getDialogTimeTodayKey: () => state.day, _getDialogNativeSharedAuditScopeKey: () => state.scope,
    _queueDialogTimeUiSync: () => { state.syncs++; },
    setInterval: callback => { state.intervals++; state.tick = callback; return 1; },
    clearInterval: () => { state.clears++; state.tick = null; }
  };
  vm.createContext(sandbox);
  vm.runInContext(timeModule, sandbox);
  sandbox._PENA_TIME_CONTROL = sandbox.__PENA_TIME_CONTROL__;
  for (const name of ['_getDialogTimeTrackerSeconds', '_syncDialogTimeTrackerClock', '_ensureDialogTimeTrackerTick']) vm.runInContext(extract(name), sandbox);
  sandbox._ensureDialogTimeTrackerTick();
  return { state, sandbox, label, duration, switcher, tick: (seconds = 1) => { state.now += seconds * 1000; state.tick?.(); } };
}
const phases = [];
function phase(name, run) {
  const started = performance.now();
  try { phases.push({ name, status: 'PASS', ...run(), ms: performance.now() - started }); }
  catch (error) { phases.push({ name, status: 'FAIL', error: error.message, ms: performance.now() - started }); }
}
phase('120 timer ticks update current values without rebuilding catalog, history or form', () => {
  const f = fixture();
  for (let i = 0; i < 120; i++) f.tick();
  assert.equal(f.state.syncs, 0, `Clock triggered ${f.state.syncs} full panel synchronizations`);
  assert.equal(f.label.textContent, 'Сейчас 0:02');
  assert.equal(f.duration.textContent, '0:02');
  assert.equal(f.state.queries, 240);
  assert.equal(f.state.writes, 4, 'Unchanged minute labels must not be rewritten every second');
  f.sandbox._ensureDialogTimeTrackerTick();
  assert.equal(f.state.intervals, 1);
  return { ticks: 120, fullPanelSynchronizations: f.state.syncs, boundedQueries: f.state.queries, textWrites: f.state.writes };
});
phase('hidden and closed panels do no panel work; resume uses wall-clock elapsed time', () => {
  const f = fixture();
  f.sandbox.document.visibilityState = 'hidden';
  f.tick(180);
  assert.equal(f.state.syncs + f.state.queries + f.state.writes, 0);
  f.sandbox.document.visibilityState = 'visible';
  f.sandbox._dialogControlNativeWorkspaceTab = 'folders';
  f.tick();
  assert.equal(f.state.queries, 1);
  assert.equal(f.label.textContent, 'Сейчас 0:03');
  assert.equal(f.duration.textContent, '0:00');
  f.sandbox._dialogControlNativeWorkspaceTab = 'time';
  f.tick();
  assert.equal(f.duration.textContent, '0:03');
  f.switcher.isConnected = false;
  const before = f.state.queries;
  f.tick();
  assert.equal(f.state.queries, before);
  return { hiddenDomWork: 0, closedPanelQueriesPerTick: 1, resumedDuration: f.duration.textContent };
});
phase('day, scope and task boundaries each schedule one full synchronization', () => {
  const f = fixture();
  for (const change of [() => { f.state.day = '2026-09-08'; }, () => { f.state.scope = 'portal~2'; }, () => { f.state.tracker = { taskId: '18', startedAt: f.state.now }; }]) {
    const before = f.state.syncs;
    change(); f.tick();
    assert.equal(f.state.syncs, before + 1);
    f.tick();
    assert.equal(f.state.syncs, before + 1, 'Stable boundary must not schedule more full renders');
  }
  return { boundarySynchronizations: f.state.syncs };
});
phase('external stop, pending write and deletion stop the timer and synchronize controls', () => {
  for (const mutate of [f => { f.state.tracker.stoppedAt = f.state.now; }, f => { f.state.tracker.pendingSeconds = 10; }, f => { f.state.tracker = null; }]) {
    const f = fixture(); mutate(f); f.tick();
    assert.equal(f.state.clears, 1);
    assert.equal(f.state.tick, null);
    assert.equal(f.state.syncs, 1);
    assert.equal(f.sandbox._dialogTimeTrackerTick, null);
  }
  return { stopVariants: 3 };
});
mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
writeFileSync(process.env.PENA_TIME_CLOCK_REPORT || new URL('./artifacts/time-clock-performance.json', import.meta.url), JSON.stringify({ sourceSha256: createHash('sha256').update(source).digest('hex'), phases }, null, 2));
for (const item of phases) console.log(`${item.status} time clock: ${item.name}${item.error ? `: ${item.error}` : ''}`);
if (phases.some(item => item.status !== 'PASS')) process.exitCode = 1;

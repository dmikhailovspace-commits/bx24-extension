export const timingSummary = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { count: sorted.length, p50: sorted[Math.ceil(sorted.length * .5) - 1] || 0,
    p95: sorted[Math.ceil(sorted.length * .95) - 1] || 0, max: Math.max(0, ...sorted) };
};

// HTTP/paint use the same paired relative allowance as mention acceptance.
// Absolute ceilings leave margin over both measured corrected runs and reject
// the frozen101 evidence. They do not permit losing task coverage.
export function evaluateStartupTimeBudget(snapshot, off, browserMetrics = []) {
  const measure = (name, actual, limit) => ({ name, actual, limit, pass: Number.isFinite(actual) && actual <= limit });
  const relativeLimit = values => { const p95 = timingSummary(values).p95; return Math.max(p95 * 1.35, p95 + 50); };
  const metric = name => browserMetrics.find(metric => metric.name === name)?.value;
  return [
    measure('native HTTP completion p95', timingSummary(snapshot.samples.map(s => s.http)).p95, relativeLimit(off.samples.map(s => s.http))),
    measure('native next paint p95', timingSummary(snapshot.samples.map(s => s.paint)).p95, relativeLimit(off.samples.map(s => s.paint))),
    measure('frame interval p95', timingSummary(snapshot.frames).p95, 50),
    measure('frame interval maximum', timingSummary(snapshot.frames).max, 1000),
    measure('panel synchronous CPU total', snapshot.work._syncDialogTimeUi?.ms, 3000),
    measure('panel synchronous CPU maximum', snapshot.work._syncDialogTimeUi?.max, 150),
    measure('long-task duration total', snapshot.longtasks.reduce((sum, task) => sum + task.ms, 0), 3000),
    measure('browser layout plus style total', (metric('LayoutDuration') + metric('RecalcStyleDuration')) * 1000, 8000)
  ];
}

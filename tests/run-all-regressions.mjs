import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const testsRoot = dirname(currentFile);
const minimumNodeMajor = 20;
const nodeMajor = executable => {
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return 0;
  return Number.parseInt(String(result.stdout || '').trim().replace(/^v/, '').split('.')[0], 10) || 0;
};

if (Number.parseInt(process.versions.node.split('.')[0], 10) < minimumNodeMajor && !process.env.PENA_TEST_NODE_REEXEC) {
  const bundledRelative = join('.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'bin');
  const candidates = [
    process.env.PENA_NODE20,
    process.env.CODEX_BUNDLED_NODE,
    process.env.NODE20,
    join(homedir(), bundledRelative, process.platform === 'win32' ? 'node.exe' : 'node')
  ].filter(Boolean);
  const bundledNode = candidates.find(candidate => existsSync(candidate) && nodeMajor(candidate) >= minimumNodeMajor);
  if (!bundledNode) {
    console.error(`Node.js ${minimumNodeMajor}+ is required. Set PENA_NODE20 to a compatible executable.`);
    process.exit(1);
  }
  const result = spawnSync(bundledNode, [currentFile], {
    cwd: process.cwd(),
    env: { ...process.env, PENA_TEST_NODE_REEXEC: '1' },
    stdio: 'inherit',
    windowsHide: true
  });
  process.exit(result.status ?? 1);
}

const suites = [
  'extension-enable-state.mjs',
  'content-frame-scope-regression.mjs',
  'native-catalog-model.mjs',
  'native-interaction-state.mjs',
  'native-time-control.mjs',
  'native-rest-queue.mjs',
  'time-functional-regression.mjs',
  'time-panel-layout-regression.mjs',
  'native-lifecycle-controller.mjs',
  'native-preservation-regression.mjs',
  'native-status-isolation-regression.mjs',
	'native-progress-performance-regression.mjs',
	'native-message-performance-regression.mjs',
	'native-cold-task-interaction-performance-regression.mjs',
	'native-dual-catalog-regression.mjs',
  'native-loading-race-regression.mjs',
	'native-folder-dnd-regression.mjs',
	'native-prefetch-cleanup-regression.mjs',
  'run-native-regressions.mjs',
  'sort-anchor-regression.mjs',
  'recent-sync-regression.mjs',
  'dialog-repository-regression.mjs',
  'native-cold-start-layout-regression.mjs',
  'native-lifecycle-stress-regression.mjs',
  'native-virtualization-regression.mjs',
  'native-resume-recovery-regression.mjs',
  'release-integrity.mjs'
];
const requested = new Set(String(process.env.PENA_TEST_SUITES || '').split(',').map(value => value.trim()).filter(Boolean));
const selected = requested.size ? suites.filter(file => requested.has(file) || requested.has(file.replace(/\.mjs$/, ''))) : suites;
if (!selected.length) {
  console.error(`No matching suites. Available: ${suites.join(', ')}`);
  process.exit(1);
}

const startedAt = Date.now();
const failed = [];
const measurements = [];
const sourceSha256 = Object.fromEntries(['injected.js','injected.css','native-time-control.js','manifest.json'].map(file => [file,createHash('sha256').update(readFileSync(join(testsRoot,'../extension',file))).digest('hex')]));
const artifacts = join(testsRoot, 'artifacts');
mkdirSync(artifacts, { recursive: true });
const saveReport = state => writeFileSync(join(artifacts, 'regression-summary.json'), JSON.stringify({ state, startedAt: new Date(startedAt).toISOString(), node: process.versions.node, sourceSha256, durationMs: Date.now() - startedAt, suites: measurements, slowest: measurements.toSorted((a,b) => b.durationMs-a.durationMs).slice(0, 5) }, null, 2));
saveReport('running');
for (const suite of selected) {
  console.log(`\n[tests] ${suite}`);
  const suiteStartedAt = Date.now();
  const result = spawnSync(process.execPath, [join(testsRoot, suite)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  measurements.push({ suite, durationMs: Date.now() - suiteStartedAt, status: result.status === 0 ? 'PASS' : 'FAIL', exitCode: result.status });
  saveReport('running');
  if (result.status !== 0) {
    console.error(`[tests] FAILED: ${suite}`);
    failed.push(suite);
  }
}
saveReport(failed.length ? 'failed' : 'passed');
const passed = selected.length - failed.length;
if (failed.length) {
  console.error(`\n[tests] FAIL ${passed}/${selected.length} suites in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (Node ${process.versions.node})`);
  console.error(`[tests] Failed suites: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\n[tests] PASS ${passed}/${selected.length} suites in ${((Date.now() - startedAt) / 1000).toFixed(1)}s (Node ${process.versions.node})`);

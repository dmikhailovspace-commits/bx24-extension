import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromeFiles, zipFiles } from './build-chrome.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path));
const json = path => JSON.parse(read(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { files, manifest, sourceHashes } = chromeFiles();
const expectedSuites = [...read('tests/run-all-regressions.mjs').toString().match(/const suites = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+\.mjs)'/g)].map(match => match[1]).sort();
const full = json('tests/artifacts/regression-summary.json');
assert.equal(full.state, 'passed', 'Full pnpm test gate must finish successfully');
assert.deepEqual(full.suites.map(suite => suite.suite).sort(), expectedSuites, 'No selected/partial gate can certify a release');
assert.ok(full.suites.every(suite => suite.status === 'PASS'));
assert.deepEqual(full.sourceSha256, sourceHashes, 'Desktop source changed since full gate');
const directory = json('chrome-release/build-manifest.json');
assert.deepEqual(directory.sourceHashes, sourceHashes);
assert.deepEqual(Object.keys(directory.files).sort(), [...files.keys()].sort());
const list = (dir, prefix = '') => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? list(`${dir}/${entry.name}`, `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]);
assert.deepEqual(list('chrome-release/unpacked').sort(), [...files.keys()].sort(), 'No extra files in unpacked release');
for (const [path, bytes] of files) {
  assert.equal(directory.files[path].sha256, hash(bytes), path);
  assert.deepEqual(read(`chrome-release/unpacked/${path}`), bytes, path);
}
const zip = read(`chrome-release/${directory.zip}`);
assert.deepEqual(zip, zipFiles(files), 'Upload ZIP must match current tested source byte for byte');
assert.equal(directory.sha256, hash(zip));
assert.equal(read(`chrome-release/${directory.zip}.sha256`).toString().split(/\s/)[0], hash(zip));
const browser = json('tests/artifacts/chrome-browser-regression.json');
const packaged = json('tests/artifacts/chrome-package-regression.json');
for (const result of [browser, packaged]) assert.equal(result.packageSha256, hash(zip), 'Final Chrome package must receive targeted verification');
assert.ok(browser.phases.length >= 5 && browser.phases.every(phase => phase.status === 'PASS'));
assert.deepEqual(browser.errors, []); assert.deepEqual(browser.consoleErrors, []);
assert.equal(packaged.status, 'PASS');
const popup = json('tests/artifacts/chrome-popup-report.json');
assert.ok(popup.phases.length >= 9 && popup.phases.every(phase => phase.status === 'PASS'));
assert.deepEqual(popup.errors, []);
for (const [path, sha] of Object.entries(popup.sourceHashes)) assert.equal(hash(files.get(path)), sha, `Popup tested source: ${path}`);
const worker = json('tests/artifacts/chrome-portal-worker-regression.json');
assert.equal(worker.sourceSha, hash(files.get('portal-worker.js')));
assert.ok(worker.phases.length >= 10 && worker.phases.every(phase => phase.status === 'PASS'));
const screenshots = json('tests/artifacts/chrome-screenshots-report.json');
assert.equal(screenshots.version, manifest.version);
assert.equal(screenshots.screenshots.length, 2);
assert.deepEqual(screenshots.errors, []); assert.deepEqual(screenshots.consoleErrors, []);
for (const image of screenshots.screenshots) {
  const bytes = read(`chrome/assets/${image.name}`);
  assert.equal(hash(bytes), image.sha256);
  assert.equal(bytes.readUInt32BE(16), 1280); assert.equal(bytes.readUInt32BE(20), 800);
  assert.deepEqual(read(`chrome-release/publishing/assets/${image.name}`), bytes);
}
const result = {
  status: 'PASS', version: manifest.version, checkedAt: new Date().toISOString(),
  zip: directory.zip, bytes: zip.length, sha256: hash(zip), files: files.size,
  fullGate: { suites: full.suites.length, durationMs: full.durationMs, startedAt: full.startedAt, sourceSha256: full.sourceSha256, verificationSource: full.verificationSource || { kind: 'local' } },
  chrome: { workerScenarios: worker.phases.length, popupScenarios: popup.phases.length, browserScenarios: browser.phases.length },
  screenshots: screenshots.screenshots,
  limitations: { liveBitrixTested: false, nativeChromePermissionDialogTested: false, storeSubmitted: false },
  publishingNeeds: ['Developer account and contact', 'Public HTTPS privacy policy URL', 'Reviewer test portal credentials and live acceptance']
};
writeFileSync(join(root, 'chrome-release/verification.json'), JSON.stringify(result, null, 2) + '\n');
writeFileSync(join(root, 'tests/artifacts/chrome-release-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`PASS Chrome release ${manifest.version}: ${full.suites.length} suites, ${files.size} files, ${hash(zip)}`);

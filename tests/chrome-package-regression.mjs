import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { chromeFiles, zipFiles } from '../tools/build-chrome.mjs';

const { files, manifest, sourceHashes } = chromeFiles();
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
assert.deepEqual(manifest.permissions, ['storage', 'unlimitedStorage', 'activeTab', 'scripting']);
for (const forbidden of ['key', 'host_permissions', 'content_scripts', 'update_url', 'externally_connectable']) assert.equal(manifest[forbidden], undefined, forbidden);
assert.equal(manifest.minimum_chrome_version, '106');
assert.deepEqual(manifest.web_accessible_resources[0].resources, ['manifest.json', 'icons/*', 'fonts/*']);
assert.ok(manifest.description.length <= 132);
assert.ok(!JSON.stringify(manifest).includes('PENA'));
assert.ok(!files.get('popup.js').toString().includes('fetch('));
assert.ok(!files.get('injected.js').toString().includes('https://bx24.id-pr.ru'));
assert.ok(!files.get('injected.js').toString().includes('append(projectSettings, fullReport'));
assert.ok(!files.get('content.js').toString().includes('script.src ='));
for (const name of ['Onest', 'Unbounded']) assert.ok(files.get(`licenses/${name}-OFL.txt`).toString().includes('SIL OPEN FONT LICENSE Version 1.1'));
assert.ok(files.get('privacy.html').toString().includes('<h1>Политика конфиденциальности</h1>'));
const originalFiles = JSON.parse(readFileSync(new URL('../update.json', import.meta.url))).extension_files;
assert.equal(Object.keys(sourceHashes).length, originalFiles.length);
const changed = new Set(['manifest.json', 'content.js', 'injected.js', 'injected.css', 'popup.html', 'popup.js', manifest.background.service_worker, 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png', 'icons/logo.png']);
for (const name of originalFiles.filter(name => !changed.has(name))) assert.deepEqual(files.get(name), readFileSync(new URL(`../extension/${name}`, import.meta.url)), `Shared file unchanged: ${name}`);
for (const [name, data] of files) if (name.endsWith('.js')) new Script(data.toString(), { filename: name });
for (const size of [16, 48, 128]) {
  const png = files.get(`icons/icon${size}.png`);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size);
}
// Decode actual ZIP local headers and compressed payload, not a build success flag.
const zip = zipFiles(files), again = zipFiles(files);
assert.deepEqual(zip, again, 'reproducible ZIP bytes');
let offset = 0;
const archive = new Map();
while (zip.readUInt32LE(offset) === 0x04034b50) {
  const size = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
  const name = zip.subarray(offset + 30, offset + 30 + length).toString();
  const start = offset + 30 + length + extra;
  archive.set(name, inflateRawSync(zip.subarray(start, start + size)));
  offset = start + size;
}
assert.equal(archive.size, files.size);
assert.ok(archive.has('manifest.json'), 'manifest is at ZIP root');
for (const [name, bytes] of files) assert.deepEqual(archive.get(name), bytes, name);
assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
assert.equal(zip.readUInt16LE(zip.length - 14), files.size);
assert.equal(zip.readUInt32LE(zip.length - 6), offset, 'central directory offset');
mkdirSync('tests/artifacts', { recursive: true });
writeFileSync('tests/artifacts/chrome-package-regression.json', JSON.stringify({ status: 'PASS', version: manifest.version, files: files.size, zipBytes: zip.length, packageSha256: createHash('sha256').update(zip).digest('hex'), checks: ['MV3 minimal grants', 'neutral metadata', 'no remote updater/report', 'shared runtime identity', 'JS parsing', 'PNG dimensions', 'deterministic ZIP exact payload', 'bundled font licenses'] }, null, 2));
console.log(`PASS Chrome package: ${files.size} files, ${zip.length} bytes, exact ZIP payload and permissions`);

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { transformChromeContent } from '../chrome/content-transform.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exactReplace = (source, from, to) => {
  if (source.split(from).length !== 2) throw new Error(`Chrome transform anchor changed: ${from}`);
  return source.replace(from, to);
};

// Standard ZIP32, fixed timestamp and sorted entries for reproducible Store uploads.
// No platform shell, credentials, symlinks or developer files enter the archive.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = bytes => {
  let n = 0xffffffff;
  for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
};
export function zipFiles(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [path, input] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const name = Buffer.from(path), data = Buffer.from(input), compressed = deflateRawSync(data, { level: 9 });
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42); central.push(entry, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function chromeFiles() {
  const release = JSON.parse(readFileSync(join(root, 'update.json'), 'utf8'));
  const originalManifest = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'));
  if (release.version !== originalManifest.version) throw new Error('Mixed source release');
  const files = new Map();
  const sourceHashes = {};
  for (const path of release.extension_files) {
    if (path.includes('..') || isAbsolute(path)) throw new Error('Unsafe runtime path');
    const bytes = readFileSync(join(root, 'extension', path));
    sourceHashes[path] = hash(bytes);
    files.set(path, bytes);
  }
  const manifest = structuredClone(originalManifest);
  delete manifest.key; // Store assigns its own identity; never impersonate the desktop extension.
  delete manifest.host_permissions;
  delete manifest.content_scripts;
  manifest.name = 'Сортировщик чатов Bitrix24';
  manifest.description = 'Папки, фильтры и цветовые метки для чатов Bitrix24. Учёт времени по задачам выбранных проектов.';
  manifest.minimum_chrome_version = '106';
  manifest.permissions = ['storage', 'unlimitedStorage', 'activeTab', 'scripting'];
  manifest.optional_host_permissions = ['https://*/*'];
  manifest.action.default_title = manifest.name;
  manifest.content_security_policy = { extension_pages: "script-src 'self'; object-src 'none'" };
  manifest.web_accessible_resources = [{ resources: ['manifest.json', 'icons/*', 'fonts/*'], matches: ['https://*/*'] }];
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  files.set('content.js', Buffer.from(transformChromeContent(files.get('content.js').toString())));
  files.set(manifest.background.service_worker, Buffer.from(files.get(manifest.background.service_worker).toString() + "\nimportScripts('portal-worker.js');\n"));
  for (const name of ['popup.html', 'popup.css', 'popup.js', 'portal-worker.js']) files.set(name, readFileSync(join(root, 'chrome', name)));
  for (const name of ['icon16.png', 'icon48.png', 'icon128.png', 'logo.png']) files.set(`icons/${name}`, readFileSync(join(root, 'chrome/assets', name)));
  for (const name of ['Onest-OFL.txt', 'Unbounded-OFL.txt']) files.set(`licenses/${name}`, readFileSync(join(root, 'chrome/licenses', name)));
  let injected = files.get('injected.js').toString();
  injected = exactReplace(injected, "const _PENA_TIME_REPORT_URL = 'https://bx24.id-pr.ru/services/timecontrol-new/?login=yes';", "const _PENA_TIME_REPORT_URL = ''; // No portal-specific external report in Chrome.");
  injected = exactReplace(injected, "headerActions.append(projectSettings, fullReport, _createDialogControlPopoverClose('Закрыть учёт времени'));", "headerActions.append(projectSettings, _createDialogControlPopoverClose('Закрыть учёт времени'));");
  injected = exactReplace(injected, 'version.textContent = `PENA v${VER}`;', 'version.textContent = `v${VER}`;');
  injected = injected.replaceAll('Выключить расширение PENA', 'Выключить сортировщик чатов').replaceAll('Включить расширение PENA', 'Включить сортировщик чатов').replaceAll('PENA Agency', 'Сортировщик чатов');
  files.set('injected.js', Buffer.from(injected));
  let css = files.get('injected.css').toString();
  for (const font of ['Onest-Variable.ttf', 'Unbounded-Variable.ttf']) {
    css = exactReplace(css, `url("fonts/${font}")`, `url("chrome-extension://__MSG_@@extension_id__/fonts/${font}")`);
  }
  files.set('injected.css', Buffer.from(css));
  const privacy = readFileSync(join(root, 'docs/chrome/PRIVACY.md'), 'utf8');
  const escaped = privacy.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const paragraphs = escaped.split(/\r?\n\r?\n/).map(part => {
    part = part.replace(/`([^`]+)`/g, '<code>$1</code>');
    if (part.startsWith('## ')) return `<h2>${part.slice(3)}</h2>`;
    if (part.startsWith('# ')) return `<h1>${part.slice(2)}</h1>`;
    if (part.startsWith('- ')) return `<ul>${part.split(/\r?\n/).map(line => `<li>${line.replace(/^- /, '')}</li>`).join('')}</ul>`;
    return `<p>${part}</p>`;
  }).join('\n');
  files.set('privacy.html', Buffer.from(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Конфиденциальность — Сортировщик чатов Bitrix24</title><style>body{max-width:760px;margin:40px auto;padding:0 24px;font:15px/1.65 system-ui;color:#19263c}h1{font-size:28px;line-height:1.25}h2{font-size:20px;margin-top:32px}code{font-size:.9em;background:#f1f4fa}article{overflow-wrap:anywhere}</style><article>${paragraphs}</article></html>`));
  return { files, manifest, sourceHashes };
}

export function buildChrome(output = join(root, 'chrome-release')) {
  output = resolve(output);
  // Only replace this task's designated unpacked output, never desktop dist or sources.
  const rel = relative(root, output);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || (!rel.startsWith('tests/artifacts/') && !rel.startsWith('tests\\artifacts\\') && rel !== 'chrome-release')) throw new Error('Chrome output must be chrome-release or tests/artifacts child');
  const { files, manifest, sourceHashes } = chromeFiles();
  mkdirSync(output, { recursive: true });
  const zipName = `BX24_Chat_Sorter_Chrome_v${manifest.version}.zip`;
  const materialsName = `Chrome_Web_Store_Materials_v${manifest.version}.zip`;
  const currentArchives = new Set([zipName, `${zipName}.sha256`, materialsName, `${materialsName}.sha256`]);
  const stale = readdirSync(output).filter(name => /^(?:BX24_Chat_Sorter_Chrome|Chrome_Web_Store_Materials)_v.*\.zip(?:\.sha256)?$/.test(name) && !currentArchives.has(name));
  if (stale.length) throw new Error(`Archive previous Chrome releases before building: ${stale.join(', ')}`);
  const unpacked = join(output, 'unpacked');
  if (existsSync(unpacked)) rmSync(unpacked, { recursive: true });
  mkdirSync(unpacked);
  for (const [path, bytes] of files) { mkdirSync(dirname(join(unpacked, path)), { recursive: true }); writeFileSync(join(unpacked, path), bytes); }
  const zip = zipFiles(files);
  writeFileSync(join(output, zipName), zip);
  writeFileSync(join(output, `${zipName}.sha256`), `${hash(zip)}  ${zipName}\n`);
  cpSync(join(root, 'docs/chrome'), join(output, 'publishing'), { recursive: true });
  cpSync(join(root, 'chrome/assets'), join(output, 'publishing/assets'), { recursive: true });
  writeFileSync(join(output, 'publishing/privacy.html'), files.get('privacy.html'));
  const materials = new Map([['privacy.html', files.get('privacy.html')]]);
  for (const name of ['README.md', 'STORE-LISTING.ru.md', 'PRIVACY.md', 'REVIEWER-NOTES.md']) materials.set(name, readFileSync(join(root, 'docs/chrome', name)));
  for (const name of readdirSync(join(root, 'chrome/assets')).filter(name => /\.(?:png|svg)$/.test(name))) materials.set(`assets/${name}`, readFileSync(join(root, 'chrome/assets', name)));
  const materialsZip = zipFiles(materials);
  writeFileSync(join(output, materialsName), materialsZip);
  writeFileSync(join(output, `${materialsName}.sha256`), `${hash(materialsZip)}  ${materialsName}\n`);
  writeFileSync(join(output, 'build-manifest.json'), JSON.stringify({ version: manifest.version, channel: 'chrome', zip: zipName, sha256: hash(zip), sourceHashes, files: Object.fromEntries([...files].map(([path, bytes]) => [path, { bytes: bytes.length, sha256: hash(bytes) }])) }, null, 2) + '\n');
  return { output, unpacked, zip: join(output, zipName), materials: join(output, materialsName), version: manifest.version, fileCount: files.size, sha256: hash(zip) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildChrome(), null, 2));

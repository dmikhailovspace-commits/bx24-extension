import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, cpSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const manifest = JSON.parse(read('extension/manifest.json'));
const update = JSON.parse(read('update.json'));
const setup = read('installers/windows/setup.iss');
const content = read('extension/content.js');
const injected = read('extension/injected.js');
const injectedCss = read('extension/injected.css');
const windowsUpdater = join(root, 'installers/windows/updater.ps1');
const macInstaller = read('installers/macos/install-gui.sh');
const macUpdater = read('installers/macos/updater.sh');
const macBuilder = read('installers/macos/build.sh');
const macLauncher = read('installers/macos/launcher/main.go');

const requiredRuntime = [
  'background.js',
  'content.js',
  'native-catalog.js',
  'native-interaction-state.js',
  'native-time-control.js',
  'native-lifecycle.js',
  'dialog-repository.js',
  'injected.js',
  'injected.css',
  'manifest.json',
  'popup.html',
  'popup.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'icons/logo.png'
];

const setupVersion = setup.match(/#define\s+AppVersion\s+"([^"]+)"/)?.[1];
const injectedVersion = injected.match(/const\s+VER\s*=\s*'([^']+)'/)?.[1];
assert.equal(update.schema_version, 2);
assert.equal(update.version, manifest.version);
assert.equal(setupVersion, manifest.version);
assert.equal(injectedVersion, manifest.version);
const nativeRowCssBlock = source => {
  const start = source.indexOf('.bx-im-list-recent-item__wrap.pena-native-chat-row');
  const endRule = '.pena-native-chat-row.--native-multi-selected .pena-native-chat-row-paint';
  const endStart = source.indexOf(endRule, start);
  const end = source.indexOf('\n', endStart);
  return start >= 0 && endStart >= 0 ? source.slice(start, end >= 0 ? end : source.length).trim() : '';
};
assert.ok(nativeRowCssBlock(injectedCss), 'native row CSS contract is missing');
assert.equal(nativeRowCssBlock(injected), nativeRowCssBlock(injectedCss), 'inline and manifest native row CSS diverged');
assert.equal(
  update.raw_base_url,
  `https://raw.githubusercontent.com/dmikhailovspace-commits/bx24-extension/v${manifest.version}`
);
assert.equal(
  update.injected_js_url,
  `${update.raw_base_url}/extension/injected.js`
);

assert.deepEqual(update.extension_files, requiredRuntime);
for (const path of requiredRuntime) {
  assert.ok(existsSync(join(root, 'extension', path)), `missing runtime file: ${path}`);
}
const listFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const absolute = join(directory, entry.name);
  return entry.isDirectory()
    ? listFiles(absolute)
    : [absolute.slice(join(root, 'extension').length + 1).replaceAll('\\', '/')];
});
assert.deepEqual(
  listFiles(join(root, 'extension')).sort(),
  requiredRuntime.slice().sort(),
  'extension/ must contain only files shipped in update.json'
);
assert.deepEqual(
  readdirSync(join(root, 'installers'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort(),
  ['macos', 'windows'],
  'installers/ must contain only macos/ and windows/'
);
assert.deepEqual(
	 readdirSync(join(root, 'installers', 'macos')).sort(),
	['build.sh', 'install-gui.sh', 'launcher', 'launcher-Info.plist', 'updater.sh'],
  'macOS installer folder has unexpected files'
);
assert.deepEqual(
  readdirSync(join(root, 'installers', 'macos', 'launcher')).sort(),
  ['main.go'],
  'macOS native launcher source has unexpected files'
);
assert.deepEqual(
  readdirSync(join(root, 'installers', 'windows')).sort(),
  ['build.bat', 'pena_host.bat', 'pena_host.ps1', 'setup.iss', 'updater.ps1'],
  'Windows installer folder has unexpected files'
);
for (const module of ['native-catalog.js', 'native-interaction-state.js', 'native-time-control.js', 'native-lifecycle.js', 'dialog-repository.js', 'injected.js']) {
  const resources = manifest.web_accessible_resources.flatMap(entry => entry.resources || []);
  assert.ok(resources.includes(module), `manifest does not expose ${module}`);
  assert.match(setup, new RegExp(module.replaceAll('.', '\\.')));
}
assert.ok(
  manifest.web_accessible_resources.flatMap(entry => entry.resources || []).includes('manifest.json'),
  'content loader cannot verify the on-disk release manifest'
);
for (const sourcePath of update.windows_files) {
  assert.ok(existsSync(join(root, sourcePath)), `missing Windows release file: ${sourcePath}`);
  assert.match(setup, new RegExp(sourcePath.split('/').at(-1).replaceAll('.', '\\.')));
}
for (const sourcePath of update.macos_files) {
  assert.ok(existsSync(join(root, sourcePath)), `missing macOS release file: ${sourcePath}`);
}
assert.ok(!existsSync(join(root, 'installers/macos/install_bundle.command')), 'legacy macOS installer must stay removed');
assert.ok(!existsSync(join(root, 'installers/macos/install.command')), 'terminal-based macOS installer must stay removed');
assert.ok(!existsSync(join(root, 'installers/build')), 'legacy installer build folder must stay removed');
assert.match(macInstaller, /VERSION=.*manifest\.json/);
assert.match(macInstaller, /pena_updater\.sh/);
assert.match(macInstaller, /display alert "Установить PENA BX24\?"/);
assert.doesNotMatch(macInstaller, /tell application "Terminal"/);
assert.doesNotMatch(macInstaller, /printf\s+'[^']*%q/);
assert.doesNotMatch(macInstaller, /launcher-template\.sh/);
assert.match(macInstaller, /pena-launcher/);
assert.match(macInstaller, /bitrix-executable\.path/);
assert.match(macInstaller, /extension-directory\.path/);
assert.match(macUpdater, /PENA_LAUNCHER=/);
assert.match(macBuilder, /hdiutil create/);
assert.match(macBuilder, /hdiutil verify/);
assert.match(macBuilder, /PENA_Agency_macOS_Universal_v\$\{VERSION\}\.dmg/);
assert.match(macBuilder, /PENA BX24 Installer\.app/);
assert.match(macBuilder, /install-gui\.sh/);
assert.match(macBuilder, /GOARCH=amd64/);
assert.match(macBuilder, /GOARCH=arm64/);
assert.match(macBuilder, /lipo -create/);
assert.match(macBuilder, /pena-launcher-universal/);
assert.match(macLauncher, /syscall\.Exec/);
assert.match(macLauncher, /install-gui\.sh/);
assert.match(macLauncher, /bitrix-executable\.path/);
assert.match(setup, /Extension\.staged-installer/);
assert.match(setup, /-InstallFrom/);

async function runLoader({ diskVersion = manifest.version, failAt = '' } = {}) {
  const appended = [];
  const errors = [];
  const scope = {
    location: { pathname: '/online/' },
    chrome: {
      runtime: {
        getManifest: () => ({ version: manifest.version }),
        getURL: path => `chrome-extension://pena/${path}`
      },
      storage: {
        local: {
          get: (_keys, callback) => callback({}),
          set: (_values, callback) => callback?.()
        },
        onChanged: { addListener() {} }
      }
    },
    fetch: async () => ({ ok: true, json: async () => ({ version: diskVersion }) }),
    console: { error: (...args) => errors.push(args) },
    setTimeout: callback => callback(),
    encodeURIComponent,
    Promise,
    Error
  };
  scope.self = scope;
  scope.top = scope;
  scope.window = scope;
  scope.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
  scope.document = {
    head: null,
    body: null,
    addEventListener() {},
    dispatchEvent() { return true; },
    createElement: () => ({ dataset: {}, remove() {} }),
    documentElement: {
      dataset: {},
      appendChild(script) {
        const path = new URL(script.src).pathname.split('/').at(-1);
        appended.push(path);
        queueMicrotask(() => path === failAt ? script.onerror() : script.onload());
      }
    }
  };
  vm.runInNewContext(content, scope, { filename: 'content.js' });
  await new Promise(resolvePromise => setTimeout(resolvePromise, 20));
  return { appended, errors };
}

assert.deepEqual(
  (await runLoader()).appended,
  ['native-catalog.js', 'native-interaction-state.js', 'native-time-control.js', 'native-lifecycle.js', 'dialog-repository.js', 'injected.js']
);
const failedLoader = await runLoader({ failAt: 'native-interaction-state.js' });
assert.deepEqual(failedLoader.appended, ['native-catalog.js', 'native-interaction-state.js']);
assert.equal(failedLoader.errors.length, 1);
const mixedLoader = await runLoader({ diskVersion: '0.0.0' });
assert.deepEqual(mixedLoader.appended, []);
assert.equal(mixedLoader.errors.length, 1);

function copyReleaseTo(stageDir) {
  mkdirSync(stageDir, { recursive: true });
  for (const relativePath of update.extension_files) {
    const source = join(root, 'extension', relativePath);
    const target = join(stageDir, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
  for (const sourcePath of update.windows_files) {
    cpSync(join(root, sourcePath), join(stageDir, sourcePath.split('/').at(-1)));
  }
}

function runWindowsInstall(localAppData, stageDir, scriptPath) {
  return spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-InstallFrom', stageDir],
    {
      cwd: root,
      env: { ...process.env, LOCALAPPDATA: localAppData },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000
    }
  );
}

const tempRoot = mkdtempSync(join(tmpdir(), 'pena-release-test-'));
try {
  const localAppData = join(tempRoot, 'LocalAppData');
  const installDir = join(localAppData, 'PENA Agency', 'Extension');
  const validStage = join(localAppData, 'PENA Agency', 'Extension.staged-valid');
  mkdirSync(installDir, { recursive: true });
  writeFileSync(join(installDir, 'old-release.marker'), 'must-be-replaced');
  copyReleaseTo(validStage);
  const validInstall = runWindowsInstall(localAppData, validStage, join(validStage, 'updater.ps1'));
  assert.equal(validInstall.status, 0, validInstall.stderr || validInstall.stdout);
  for (const path of requiredRuntime) {
    assert.ok(existsSync(join(installDir, path)), `atomic install omitted ${path}`);
  }
  assert.ok(!existsSync(validStage), 'published staging directory still exists');
  assert.ok(!existsSync(join(installDir, 'old-release.marker')), 'previous release was not replaced');

  const replacementStage = join(localAppData, 'PENA Agency', 'Extension.staged-replacement');
  copyReleaseTo(replacementStage);
  writeFileSync(join(replacementStage, 'replacement-release.marker'), 'installed-from-running-updater');
  const replacementInstall = runWindowsInstall(
    localAppData,
    replacementStage,
    join(installDir, 'updater.ps1')
  );
  assert.equal(replacementInstall.status, 0, replacementInstall.stderr || replacementInstall.stdout);
  assert.ok(
    existsSync(join(installDir, 'replacement-release.marker')),
    'updater could not replace the directory it was running from'
  );

  writeFileSync(join(installDir, 'previous-release.marker'), 'keep-on-failure');
  const invalidStage = join(localAppData, 'PENA Agency', 'Extension.staged-invalid');
  copyReleaseTo(invalidStage);
  rmSync(join(invalidStage, 'native-lifecycle.js'));
  const invalidInstall = runWindowsInstall(localAppData, invalidStage, join(installDir, 'updater.ps1'));
  assert.notEqual(invalidInstall.status, 0, 'incomplete staging release was accepted');
  assert.ok(existsSync(join(installDir, 'previous-release.marker')), 'failed update damaged current release');
  assert.ok(existsSync(join(installDir, 'native-lifecycle.js')), 'failed update left a mixed release');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('PASS release metadata, fail-closed loader, atomic Windows install and rollback');

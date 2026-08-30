import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, cpSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const manifest = JSON.parse(read('extension/manifest.json'));
const update = JSON.parse(read('update.json'));
const setup = read('installers/windows/setup.iss');
const content = read('extension/content.js');
const injected = read('extension/injected.js');
const injectedCss = read('extension/injected.css');
const distDir = join(root, 'dist');
const windowsUpdater = join(root, 'installers/windows/updater.ps1');
const macInstaller = read('installers/macos/install-gui.sh');
const macUpdater = read('installers/macos/updater.sh');
const macBuilder = read('installers/macos/build.sh');
const macLauncher = read('installers/macos/launcher/main.go');
const macLauncherInfo = read('installers/macos/launcher-Info.plist');
const releaseWorkflow = read('.github/workflows/build-macos.yml');

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
  'fonts/Onest-Variable.ttf',
  'fonts/Unbounded-Variable.ttf',
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

const expectedReleaseArtifacts = [
  `PENA_Agency_Windows_v${manifest.version}.exe`,
  `PENA_Agency_Windows_v${manifest.version}.exe.sha256`,
  `PENA_Agency_macOS_Universal_v${manifest.version}.dmg`,
  `PENA_Agency_macOS_Universal_v${manifest.version}.dmg.sha256`
];
const presentReleaseArtifacts = existsSync(distDir)
  ? readdirSync(distDir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort()
  : [];
assert.deepEqual(
  presentReleaseArtifacts,
  presentReleaseArtifacts.filter(name => expectedReleaseArtifacts.includes(name)),
  'dist/ contains stale or unexpected release artifacts'
);
if (process.env.PENA_REQUIRE_RELEASE_ARTIFACTS === '1') {
  assert.deepEqual(
    presentReleaseArtifacts,
    expectedReleaseArtifacts.slice().sort(),
    'current Windows and macOS installers with SHA-256 sidecars are required'
  );
  for (const artifactName of expectedReleaseArtifacts.filter(name => !name.endsWith('.sha256'))) {
    const artifactPath = join(distDir, artifactName);
    const sidecarPath = `${artifactPath}.sha256`;
    const expectedHash = readFileSync(sidecarPath, 'utf8').trim().split(/\s+/)[0]?.toLowerCase();
    assert.match(expectedHash || '', /^[a-f0-9]{64}$/, `invalid SHA-256 sidecar: ${artifactName}.sha256`);
    const actualHash = createHash('sha256').update(readFileSync(artifactPath)).digest('hex');
    assert.equal(actualHash, expectedHash, `SHA-256 mismatch: ${artifactName}`);
  }
}
assert.match(setup, /extension\\fonts\\\*";\s+DestDir:\s+"\{#StageDir\}\\fonts"/i, 'Windows installer omits bundled fonts');
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
assert.match(macBuilder, /LSMinimumSystemVersion<\/key><string>12\.0<\/string>/);
assert.match(macLauncher, /syscall\.Exec/);
assert.match(macLauncher, /install-gui\.sh/);
assert.match(macLauncher, /bitrix-executable\.path/);
assert.match(macLauncherInfo, /LSMinimumSystemVersion<\/key><string>12\.0<\/string>/);
assert.match(setup, /Extension\.staged-installer/);
assert.match(setup, /-InstallFrom/);
assert.match(releaseWorkflow, /push:\s*\n\s*tags:\s*\n\s*- 'v\*'/, 'tag push does not start the installer release');
assert.match(releaseWorkflow, /runs-on:\s*windows-2025/, 'release workflow does not build Windows on Windows');
assert.match(releaseWorkflow, /runs-on:\s*macos-15/, 'release workflow does not build macOS on macOS');
assert.equal((releaseWorkflow.match(/actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/g) || []).length, 3, 'all release jobs must checkout the tagged source with pinned checkout v7.0.1');
assert.match(releaseWorkflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
assert.match(releaseWorkflow, /node-version:\s*24\.19\.0/);
assert.match(releaseWorkflow, /pnpm install --frozen-lockfile/);
assert.match(releaseWorkflow, /playwright install chromium/);
assert.match(releaseWorkflow, /pnpm test/);
assert.match(releaseWorkflow, /update-project-context\.ps1 -Check/);
assert.equal((releaseWorkflow.match(/needs:\s*verify-source/g) || []).length, 2, 'both installer builds must depend on the source gate');
assert.match(releaseWorkflow, /needs:\s*\[build-windows, build-macos\]/, 'publication must depend on both installer builds');
assert.match(releaseWorkflow, /actions\/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e/);
assert.match(releaseWorkflow, /go-version:\s*1\.26\.7/, 'macOS launcher toolchain is not pinned');
assert.equal((releaseWorkflow.match(/actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/g) || []).length, 2, 'both installers must be uploaded with pinned upload-artifact v7.0.1');
assert.match(releaseWorkflow, /hdiutil verify/);
assert.match(releaseWorkflow, /hdiutil attach/);
assert.match(releaseWorkflow, /plutil -lint "\$launcher_info"/);
assert.match(releaseWorkflow, /Print :CFBundleShortVersionString/);
assert.equal((releaseWorkflow.match(/Print :LSMinimumSystemVersion/g) || []).length, 2, 'both macOS application plists must verify minimum OS');
assert.match(releaseWorkflow, /= "12\.0"/);
assert.match(releaseWorkflow, /= "__VERSION__"/);
assert.match(releaseWorkflow, /lipo -archs/);
assert.match(releaseWorkflow, /launcher_archs/);
assert.match(releaseWorkflow, /x86_64/);
assert.match(releaseWorkflow, /arm64/);
assert.match(releaseWorkflow, /LSMinimumSystemVersion/);
assert.match(releaseWorkflow, /CRLF found in macOS runtime files/);
assert.match(releaseWorkflow, /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c/);
assert.match(releaseWorkflow, /merge-multiple:\s*true/);
assert.match(releaseWorkflow, /GITHUB_REF_NAME.*v\$version/, 'Windows tag/version gate is missing');
assert.match(releaseWorkflow, /GITHUB_REF_NAME.*v\$\{version\}/, 'macOS tag/version gate is missing');
assert.match(releaseWorkflow, /choco install innosetup/);
assert.match(releaseWorkflow, /ProgramFiles\(x86\)/);
assert.match(releaseWorkflow, /Inno Setup 6\\ISCC\.exe/);
assert.match(releaseWorkflow, /Get-FileHash[^\n]*SHA256/);
assert.match(releaseWorkflow, /find dist -maxdepth 1 -type f/);
assert.match(releaseWorkflow, /find dist[^\n]*\n?[^\n]*= "4"/);
assert.match(releaseWorkflow, /expected=.*awk[^\n]*artifact\.sha256/);
assert.match(releaseWorkflow, /actual=.*sha256sum/);
assert.match(releaseWorkflow, /permissions:\s*\n\s*contents:\s*write/, 'release job cannot publish assets');
assert.match(releaseWorkflow, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/);
assert.match(releaseWorkflow, /gh release upload[^\n]*--clobber/);
assert.match(releaseWorkflow, /gh release create[^\n]*--verify-tag/);
assert.match(releaseWorkflow, /PENA_Agency_Windows_v/);
assert.match(releaseWorkflow, /PENA_Agency_macOS_Universal_v/);
const publishStep = releaseWorkflow.split('- name: Publish installers')[1] || '';
for (const artifact of [
  'PENA_Agency_Windows_v${GITHUB_REF_NAME#v}.exe',
  'PENA_Agency_Windows_v${GITHUB_REF_NAME#v}.exe.sha256',
  'PENA_Agency_macOS_Universal_v${GITHUB_REF_NAME#v}.dmg',
  'PENA_Agency_macOS_Universal_v${GITHUB_REF_NAME#v}.dmg.sha256'
]) {
  assert.equal(publishStep.split(`${artifact}"`).length - 1, 2, `publish step must upload and create exact artifact: ${artifact}`);
}
assert.doesNotMatch(publishStep, /dist\/\*/);

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
  const contextProject = join(tempRoot, 'context-lf');
  for (const relativePath of [
    'PROJECT_CONTEXT.md',
    'update.json',
    'extension/manifest.json',
    'extension/injected.js',
    'installers/windows/setup.iss',
    'tests/run-all-regressions.mjs',
    'tools/update-project-context.ps1'
  ]) {
    const source = join(root, relativePath);
    const target = join(contextProject, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
  writeFileSync(
    join(contextProject, 'PROJECT_CONTEXT.md'),
    read('PROJECT_CONTEXT.md').replace(/\r\n/g, '\n'),
    'utf8'
  );
  const contextCheck = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(contextProject, 'tools/update-project-context.ps1'),
      '-Check'
    ],
    {
      cwd: contextProject,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000
    }
  );
  assert.equal(
    contextCheck.status,
    0,
    `LF checkout makes PROJECT_CONTEXT.md stale: ${contextCheck.stderr || contextCheck.stdout}`
  );

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

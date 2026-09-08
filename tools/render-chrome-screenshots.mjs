import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildChrome } from './build-chrome.mjs';

// Store illustrations use the actual installed MV3 package. Only the mock
// portal's data and surrounding page are styled; no extension DOM/CSS is rewritten.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'chrome/assets');
const runtimeVersion = JSON.parse(readFileSync(join(root,'extension/manifest.json'),'utf8')).version;
const artifactDir = join(root, `tests/artifacts/chrome-screenshot-package-v${runtimeVersion}`);
const reportPath = join(root, 'tests/artifacts/chrome-screenshots-report.json');
const origin = 'https://demo.chrome.test';
const build = buildChrome(artifactDir);
const granted = join(artifactDir, 'granted-demo');
mkdirSync(granted, { recursive:true });
cpSync(build.unpacked, granted, { recursive:true });
const manifest = JSON.parse(readFileSync(join(granted, 'manifest.json'), 'utf8'));
manifest.host_permissions = [`${origin}/*`];
writeFileSync(join(granted, 'manifest.json'), JSON.stringify(manifest,null,2));

let fixture = readFileSync(join(root, 'tests/native-consistency-harness.html'), 'utf8');
fixture = fixture.replace(/<link[^>]+injected\.css[^>]*>/g, '')
  .replace(/<script src="\.\.\/extension\/[^>]+><\/script>/g, '')
  .replace(/<output id="test-output"[\s\S]*?<\/script>/, '')
  .replace('<title>PENA native consistency harness</title>', '<title>Демонстрация сортировщика чатов Bitrix24</title>');
assert(!/<script[^>]+src=.*extension|<link[^>]+injected\.css/.test(fixture));
for (const [from,to] of [
  ['Тестовая папка','Проекты'], ['Диалог 225','Запуск сайта'], ['Чат 225','Запуск сайта'],
  ['Диалог 5','Команда проекта'], ['Чат 5','Команда проекта'], ['Прямая строка','Контент и дизайн'],
  ['Проект 1','Развитие сайта'], ['Проект 2','Контент'],
  ['`Заполнитель ${index + 1}`',"['Планирование','Дизайн интерфейса','Редактура','Разработка','Контент-план','Поддержка','Аналитика','Материалы проекта'][index % 8]"],
  ['`Каталожная задача ${index + 1}`', '`Этап проекта ${index + 1}`'],
  [': `Задача ${taskId}`', ": ({'5':'Обсудить следующий этап','101':'Подготовить структуру сайта','102':'Проверить макет страницы','303':'Собрать материалы проекта'}[taskId] || `Задача ${taskId}`)"]
]) {
  assert(fixture.includes(from), `Demo fixture text anchor missing: ${from}`);
  fixture = fixture.replaceAll(from,to);
}
const demoStyle = `<style>
html,body{margin:0;width:1280px;height:800px;overflow:hidden}
body{font:14px/1.45 'Onest Variable',Arial,sans-serif;color:#233a35;background:#eaf1ee}
body>button{display:none}#test-output{display:none}
.demo-heading{position:absolute;top:28px;left:28px;margin:0;font-size:24px;font-weight:650;letter-spacing:-.6px}
.demo-subtitle{position:absolute;top:68px;left:29px;margin:0;color:#60756e;font-size:14px}
.test-host{position:absolute;top:110px;left:28px;width:376px;height:658px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px #173e400a}
.bx-im-list-container-recent__header_container,.bx-im-list-container-task__header_container{padding:14px 12px 8px}
.test-host input[type=search]{width:100%;height:34px;box-sizing:border-box;border:1px solid #dce7e1;border-radius:8px;padding:0 10px;font:13px 'Onest Variable',Arial,sans-serif;background:#f7f9f8;color:#29473d}
.bx-im-list-container-recent__container,.bx-im-list-container-task__container{width:376px;height:600px}
.bx-im-list-container-recent__scroll-container,.bx-im-list-container-task__scroll-container{width:376px;height:570px}
.bx-im-list-container-recent__elements,.bx-im-list-container-task__elements{width:376px;min-height:570px}
.bx-im-list-recent-item__wrap,.bx-im-list-item{width:364px;height:64px;color:#263b35;font:14px/1.4 'Onest Variable',Arial,sans-serif}
.bx-im-list-recent-item__container,.bx-im-list-item__container{padding-left:12px;gap:2px}
.bx-im-chat-title__text{font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bx-im-list-recent-item__counter_number{margin-left:auto;margin-right:14px;border-radius:9px;background:#267c70;color:#fff;padding:1px 6px;font-size:11px}
.test-avatar{background:#d9e9e0}
.demo-thread{position:absolute;top:110px;left:424px;right:28px;height:658px;box-sizing:border-box;background:#f8fbf9;border-radius:14px;overflow:hidden}
.demo-thread h2{margin:0;padding:23px 28px 7px;background:#fff;font-size:17px;font-weight:600}
.demo-thread .hint{margin:0;background:#fff;padding:0 28px 22px;color:#6b8078;font-size:12px;border-bottom:1px solid #e7eeea}
.demo-day{display:block;margin:26px auto;text-align:center;color:#7c8e86;font-size:12px}
.demo-bubble{margin:0 100px 18px 28px;padding:16px 19px;border-radius:12px;background:#fff;color:#385249;line-height:1.6;max-width:450px}
.demo-bubble.outgoing{margin:0 28px 18px auto;background:#e0eee7}
.demo-compose{position:absolute;left:24px;right:24px;bottom:24px;padding:18px;background:#fff;border:1px solid #e0e9e3;border-radius:10px;color:#90a197}
</style>`;
fixture = fixture.replace('</head>', `${demoStyle}</head>`).replace('<body>', `<body>
<h1 class="demo-heading">Чаты и задачи Bitrix24</h1><p class="demo-subtitle">Папки, цветовые метки и учёт времени в одном окне</p>
<main class="demo-thread"><h2>Команда проекта</h2><p class="hint">Рабочее обсуждение · демонстрационный пример</p>
<span class="demo-day">Сегодня</span><p class="demo-bubble">Структура сайта готова. Следующий шаг — проверить макет страницы.</p>
<p class="demo-bubble outgoing">Материалы собраны в папке проекта. Вернёмся к ним на следующем этапе.</p>
<div class="demo-compose">Написать сообщение…</div></main>`);
fixture = fixture.replaceAll('<script>', '<script nonce="demo">');

const profile = mkdtempSync(join(tmpdir(),'bx24-store-screenshots-'));
const report = { version:build.version, liveBitrixTested:false, nativePermissionPromptTested:false, grantedHostFixture:true, mockedPortalSdk:true,
  data:'Synthetic fixture data; real Chrome extension UI', errors:[], consoleErrors:[], screenshots:[] };
let context;
try {
  context = await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:800},deviceScaleFactor:1,
    args:[`--disable-extensions-except=${granted}`,`--load-extension=${granted}`]});
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  assert.equal((await popup.evaluate(()=>chrome.runtime.sendMessage({channel:'pena.chrome.portal.v1',action:'sync'}))).ok,true);
  await popup.close();
  assert.deepEqual((await worker.evaluate(()=>chrome.scripting.getRegisteredContentScripts()))[0].matches,[`${origin}/*`]);
  await context.route('https://**/*',route=>{
    const url = new URL(route.request().url());
    if(url.hostname==='cdn.example.test') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="20" fill="#dcece3"/><path d="M13 15h14M13 21h10M13 27h6" stroke="#568772" stroke-width="2" stroke-linecap="round"/></svg>'});
    if(url.origin!==origin || url.pathname!=='/online/') return route.abort();
    return route.fulfill({contentType:'text/html',headers:{'content-security-policy':"script-src 'nonce-demo'; object-src 'none'; style-src 'unsafe-inline'; img-src data: https://cdn.example.test chrome-extension:; font-src chrome-extension:"},body:fixture});
  });
  const page = await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  await page.goto(`${origin}/online/?mode=tasks&passThrough=1&nativeCatalog=1&nativeFirst=1&catalogRows=8`);
  await page.waitForFunction(version=>window.__ANITREC_RUNNING__===version,build.version,{timeout:20000});
  await page.locator('.task-host .pena-native-folder-switcher').waitFor({state:'visible',timeout:20000});
  await page.waitForFunction(()=>{const s=window.__PENA_TIME_LOAD_DIAGNOSTICS__?.snapshot();return s?.phase==='ready'&&!s.active;},null,{timeout:20000});
  await page.locator('.pena-native-load-guard,.pena-native-original-load-guard').waitFor({state:'hidden',timeout:30000});
  assert.equal(await page.locator('.task-host .pena-native-time-button').innerText(),'Сегодня 1:30');
  assert.equal(await page.locator('script[src*="chrome-extension"],link[href*="injected.css"]').count(),0);
  await page.evaluate(async()=>{await document.fonts.load('14px "Onest Variable"');await document.fonts.ready;});
  const labelDemo = () => page.evaluate(()=>{
    let badge=document.getElementById('store-demo-badge');
    if(!badge){badge=document.createElement('div');badge.id='store-demo-badge';badge.textContent='Демонстрационные данные';badge.setAttribute('popover','manual');document.body.append(badge);}
    badge.style.cssText='position:fixed;inset:18px 24px auto auto;margin:0;padding:7px 11px;border:1px solid #ccdcd2;border-radius:7px;background:#f5faf6;color:#4a695c;font:12px Arial,sans-serif;pointer-events:none';
    if(badge.matches(':popover-open'))badge.hidePopover();
    badge.showPopover();
  });
  const capture = async(name,checks)=>{
    await labelDemo();
    assert(await page.locator('#store-demo-badge').isVisible());
    const bytes=await page.screenshot({animations:'disabled'});
    assert.equal(bytes.readUInt32BE(16),1280);assert.equal(bytes.readUInt32BE(20),800);
    mkdirSync(output,{recursive:true});writeFileSync(join(output,name),bytes);
    report.screenshots.push({name,width:1280,height:800,sha256:createHash('sha256').update(bytes).digest('hex'),checks});
  };
  const folders=page.locator('.task-host .pena-native-folder-tab');
  assert(await folders.count()>0,'Real folder controls must be present');
  await capture('screenshot-chats.png',{runtimeVersion:build.version,folderTabs:await folders.count(),toolbar:'Сегодня 1:30'});
  await page.locator('.task-host .pena-native-time-button').click();
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-total-value')?.textContent==='1 ч 30 мин',null,{timeout:12000});
  await page.evaluate(()=>window.dispatchNativeTaskMessage('chat5'));
  await page.waitForFunction(()=>document.querySelector('.pena-native-time-suggestions .pena-native-time-section-copy strong')?.textContent==='Контакты · 1',null,{timeout:12000});
  assert.equal(await page.locator('.pena-native-time-entry-row').count(),2);
  await capture('screenshot-time.png',{total:'1 ч 30 мин',entries:2,qualifiedContacts:1});
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
} finally {
  await context?.close();
  // Only the resolved mkdtemp child belonging to this renderer can be removed.
  const rel=relative(resolve(tmpdir()),resolve(profile));
  if(!isAbsolute(rel)&&!rel.startsWith('..')&&rel.startsWith('bx24-store-screenshots-'))rmSync(profile,{recursive:true,force:true});
  mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report,null,2));

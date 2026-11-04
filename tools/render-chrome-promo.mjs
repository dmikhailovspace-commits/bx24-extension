import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [art, headingFont, bodyFont] = await Promise.all([
  readFile(resolve(root, 'chrome/marketing/promo-art.png')),
  readFile(resolve(root, 'extension/fonts/Unbounded-Variable.ttf')),
  readFile(resolve(root, 'extension/fonts/Onest-Variable.ttf'))
]);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.route('**/*', route => route.abort());
  await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
    @font-face{font-family:Unbounded;src:url(data:font/ttf;base64,${headingFont.toString('base64')});font-weight:100 900}
    @font-face{font-family:Onest;src:url(data:font/ttf;base64,${bodyFont.toString('base64')});font-weight:100 900}
    *{box-sizing:border-box}html,body{margin:0;width:440px;height:280px;overflow:hidden}
    body{position:relative;background:#111216;color:#f7f7f7;font-family:Onest,Arial,sans-serif}
    .art{position:absolute;inset:0;background:url(data:image/png;base64,${art.toString('base64')}) center/cover no-repeat}
    .shade{position:absolute;inset:0;background:linear-gradient(90deg,#111216 0%,#111216ed 31%,#1112169c 52%,transparent 83%)}
    .frame{position:absolute;inset:9px;border:1px solid #ffffff57;border-radius:3px;pointer-events:none}
    .label{position:absolute;top:27px;left:25px;border:1px solid #ffffff80;border-radius:3px;padding:6px 8px;font-size:9px;line-height:1;letter-spacing:.055em;font-weight:650}
    h1{position:absolute;top:77px;left:24px;margin:0;font:650 29px/1.2 Unbounded,Arial,sans-serif;letter-spacing:-.065em;text-shadow:0 2px 15px #0008}
    p{position:absolute;top:174px;left:25px;width:217px;margin:0;font-size:13px;line-height:1.4;color:#dedede}
    .features{position:absolute;left:25px;bottom:25px;display:flex;gap:5px}
    .features span{border:1px solid #ffffff75;border-radius:3px;padding:5px 6px;font-size:9px;font-weight:650;line-height:1;letter-spacing:.02em}
  </style><div class="art"></div><div class="shade"></div><div class="frame"></div>
  <div class="label">BITRIX24 · СОРТИРОВЩИК ЧАТОВ</div>
  <h1>Чаты —<br>по папкам.</h1>
  <p>Новые диалоги попадают на свои места по вашим правилам.</p>
  <div class="features"><span>ПАПКИ</span><span>ПРАВИЛА</span><span>ПОИСК</span></div></html>`);
  await page.evaluate(() => document.fonts.ready);
  const image = await page.screenshot();
  assert.equal(image.readUInt32BE(16), 440);
  assert.equal(image.readUInt32BE(20), 280);
  await writeFile(resolve(root, 'chrome/assets/promo.png'), image);
} finally {
  await browser.close();
}

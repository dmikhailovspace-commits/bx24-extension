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
  for (const { name, width, height, className } of [
    { name: 'promo-wide.png', width: 1400, height: 560, className: 'wide' },
    { name: 'promo.png', width: 440, height: 280, className: 'small' }
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.route('**/*', route => route.abort());
    await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>
      @font-face{font-family:Unbounded;src:url(data:font/ttf;base64,${headingFont.toString('base64')});font-weight:100 900}
      @font-face{font-family:Onest;src:url(data:font/ttf;base64,${bodyFont.toString('base64')});font-weight:100 900}
      *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
      body{position:relative;background:#08090b;color:#fff;font-family:Onest,Arial,sans-serif}
      .art{position:absolute;inset:0;background:url(data:image/png;base64,${art.toString('base64')}) center/cover no-repeat}
      .shade{position:absolute;inset:0;background:linear-gradient(90deg,#08090b 0%,#08090bf2 25%,#08090bd9 40%,#08090b55 61%,transparent 79%)}
      .frame{position:absolute;pointer-events:none;border:1px solid #ffffff78;border-radius:2px}
      .eyebrow{position:absolute;font-weight:700;letter-spacing:.12em;color:#e9e9e9}
      .line{position:absolute;background:#ffffff8a;height:1px}
      h1{position:absolute;margin:0;font-family:Unbounded,Arial,sans-serif;font-weight:650;letter-spacing:-.065em}
      p{position:absolute;margin:0;color:#e8e8e8;font-weight:470}
      .footer{position:absolute;color:#b7b9bd;font-weight:600;letter-spacing:.06em}
      .wide .frame{inset:22px}.wide .eyebrow{top:76px;left:80px;font-size:15px}.wide .line{left:80px;top:122px;width:472px}
      .wide h1{top:172px;left:76px;font-size:60px;line-height:1.13}.wide p{top:347px;left:80px;width:570px;font-size:22px;line-height:1.35}
      .wide .footer{bottom:58px;left:80px;font-size:13px}
      .small .art{background-position:60% center}.small .shade{background:linear-gradient(90deg,#08090b 0%,#08090bf5 29%,#08090bce 54%,#08090b40 79%,transparent 100%)}
      .small .frame{inset:9px}.small .eyebrow{top:28px;left:24px;font-size:9px}.small .line{left:24px;top:49px;width:225px}
      .small h1{top:80px;left:22px;font-size:26px;line-height:1.16}.small p{top:171px;left:24px;width:265px;font-size:12px;line-height:1.42}
      .small .footer{bottom:26px;left:24px;font-size:9px}
      .gallery .frame{inset:24px}.gallery .eyebrow{top:110px;left:76px;font-size:17px}.gallery .line{top:160px;left:76px;width:470px}
      .gallery h1{top:245px;left:72px;font-size:60px;line-height:1.18}.gallery p{top:445px;left:76px;width:590px;font-size:25px;line-height:1.45}
      .gallery .footer{bottom:90px;left:76px;font-size:15px}
      .small.gallery .art{background-position:70% center}.small.gallery .shade{background:linear-gradient(90deg,#08090bf5 0%,#08090bee 28%,#08090b9c 58%,#08090b10 100%)}
    </style><body class="${className}"><div class="art"></div><div class="shade"></div><div class="frame"></div>
    <div class="eyebrow">СОРТИРОВЩИК ЧАТОВ ДЛЯ BITRIX24</div><div class="line"></div>
    <h1>Каждому чату —<br>своё место.</h1>
    <p>Настройте правила один раз: новые диалоги распределятся по папкам. Спорные переносы останутся под вашим контролем.</p>
    <div class="footer">ПАПКИ / ПРАВИЛА / КОНТРОЛЬ</div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const image = await page.screenshot();
    assert.equal(image.readUInt32BE(16), width);
    assert.equal(image.readUInt32BE(20), height);
    await writeFile(resolve(root, 'chrome/assets', name), image);
    await page.close();
  }
} finally {
  await browser.close();
}

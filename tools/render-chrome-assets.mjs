import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = resolve(root, 'chrome/assets');
await mkdir(assets, { recursive:true });
const icon = await readFile(resolve(assets, 'icon.svg'), 'utf8');
const promo = await readFile(resolve(assets, 'promo.svg'), 'utf8');
const font = await readFile(resolve(root, 'extension/fonts/Onest-Variable.ttf'));
assert(!/https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(icon + promo), 'Assets must not load remote resources');
const browser = await chromium.launch({ headless:true });
const results = [];
try {
  for (const [name, width, height, svg] of [
    ['icon16.png',16,16,icon], ['icon48.png',48,48,icon],
    ['icon128.png',128,128,icon], ['logo.png',256,256,icon],
    ['promo.png',440,280,promo]
  ]) {
    const page = await browser.newPage({ viewport:{width,height}, deviceScaleFactor:1 });
    await page.route('**/*', route => route.abort());
    await page.setContent(`<style>@font-face{font-family:Onest;src:url(data:font/ttf;base64,${font.toString('base64')});font-weight:100 900}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ omitBackground:true });
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    await writeFile(resolve(assets,name),png);
    results.push({name,width,height,bytes:png.length,sha256:createHash('sha256').update(png).digest('hex')});
    await page.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({renderer:'Playwright Chromium',assets:results},null,2));

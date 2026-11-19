import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startHarnessServer } from './lib/harness-server.mjs';

const server = await startHarnessServer();
const browser = await chromium.launch();
const results = {};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const cdp = await page.context().newCDPSession(page);
  await page.addInitScript(() => {
    let phase, lastFrame;
    let inWheel = false;
    const query = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function(...args) {
      if (inWheel && phase) phase.pageScans++;
      return query.apply(this,args);
    };
    const listen = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, fn, options) {
      if (type !== 'wheel' || typeof fn !== 'function' || fn.name === '_noteDialogCatalogUserActivity' || !new Error().stack.includes('/extension/injected.js')) {
        return listen.call(this, type, fn, options);
      }
      return listen.call(this, type, function(event) {
        const start = performance.now();
        inWheel = true;
        try { return fn.call(this, event); }
        finally { inWheel = false; if (phase) phase.callbacks.push(performance.now() - start); }
      }, options);
    };
    function frame(now) {
      if (phase && lastFrame) phase.frames.push(now - lastFrame);
      lastFrame = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.wheelProbe = {
      start() { phase = { callbacks: [], frames: [], pageScans: 0 }; lastFrame = 0; },
      stop() { const out = phase; phase = null; return out; }
    };
  });
  await page.goto(server.baseUrl + '/tests/native-consistency-harness.html?mode=chats&nativeCatalog=1&lazyNative=1&nativeFirst=1&passThrough=1&many=1&catalogRows=350');
  await page.locator('.recent-host .pena-native-rules-button').waitFor();
  await page.evaluate(() => {
    const pane = document.createElement('div');
    pane.className = 'bx-im-dialog-chat__scroll-container';
    pane.id = 'wheel-conversation';
    pane.style.cssText = 'position:fixed;right:0;top:0;width:38vw;height:90vh;overflow:auto;background:white';
    for (let i=0; i<800; i++) {
      const msg = document.createElement('p');
      msg.textContent = 'Сообщение ' + i;
      pane.append(msg);
    }
    document.body.append(pane);
    // Bitrix recycles list rows and materializes older messages during a gesture.
    // Keep the scroll range fixed so measured movement comes from wheel input.
    const viewport = document.querySelector('.recent-host .bx-im-list-container-recent__scroll-container');
    const pool = [...viewport.querySelectorAll('.bx-im-list-recent-item__wrap[data-id]')].slice(-24);
    let generation = 0;
    viewport.addEventListener('scroll', () => {
      const row = pool[generation % pool.length];
      row.dataset.id = 'chat' + (500000 + generation++);
      row.querySelector('.bx-im-chat-title__text').textContent = 'Диалог ' + generation;
    }, {passive:true});
    pane.addEventListener('scroll', () => {
      const start = Math.floor(pane.scrollTop / 40);
      for (let i = 0; i < 12; i++) {
        const line = document.createElement('span');
        line.textContent = 'Сообщение ' + (start + i);
        pane.children[(start + i) % pane.children.length].replaceChildren(line);
      }
    }, {passive:true});
  });
  assert.equal(await page.evaluate(() => window.__PENA_TEST_LEGACY_CATALOG__ || window.__PENA_TEST_API_CATALOG__ || window.__PENA_TEST_NATIVE_SCROLL__), false);
  await page.waitForTimeout(1800);
  await page.waitForFunction(() => !window.__PENA_NATIVE_PREFETCH__?.status()?.originalActive);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  for (const [name, selector] of Object.entries({ list: '.recent-host .bx-im-list-container-recent__scroll-container', conversation: '#wheel-conversation' })) {
    const pane = page.locator(selector);
    await pane.evaluate(el => { el.scrollTop = 0; });
    const box = await pane.boundingBox();
    assert.ok(box && box.height > 20);
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 180));
    const initial = await pane.evaluate(el => el.scrollTop);
    await page.evaluate(() => window.wheelProbe.start());
    for (let i=0; i<48; i++) await page.mouse.wheel(0, 40);
    await page.waitForTimeout(80);
    const { callbacks, frames, pageScans } = await page.evaluate(() => window.wheelProbe.stop());
    const distance = await pane.evaluate(el => el.scrollTop) - initial;
    assert.ok(distance > 120, name + ' must physically scroll, distance ' + distance);
    const p95 = a => a.slice().sort((x,y)=>x-y)[Math.ceil(a.length * .95)-1] || 0;
    results[name] = { distance, handlers: callbacks.length, pageScans, handlerMs: Math.round(callbacks.reduce((a,b)=>a+b,0)), frameP95Ms: +p95(frames).toFixed(1), framesOver50Ms: frames.filter(v=>v>50.5).length };
  }
  console.log(JSON.stringify(results));
  if (process.env.PENA_WHEEL_REPORT) {
    mkdirSync('tests/artifacts',{recursive:true});
    writeFileSync('tests/artifacts/'+process.env.PENA_WHEEL_REPORT+'.json',JSON.stringify(results,null,2));
  }
  if (!process.env.PENA_WHEEL_BASELINE) {
    assert.equal(results.conversation.handlers,0,'Wheel over messages must not invoke list handlers');
    assert.ok(results.list.handlers > 0, 'The active list owner received the wheel events');
    assert.equal(results.list.pageScans,0,'List wheel must not search the document for scroll owners');
    const repaired = await page.locator('.recent-host .bx-im-list-container-recent__scroll-container').evaluate(async viewport => {
      const before = viewport.scrollTop;
      const row = viewport.querySelector('[data-id]');
      for (let i=0; i<2; i++) {
        document.addEventListener('wheel', e => e.preventDefault(), {once:true,passive:false});
        row.dispatchEvent(new WheelEvent('wheel',{deltaY:25,bubbles:true,cancelable:true}));
      }
      await new Promise(requestAnimationFrame);
      return viewport.scrollTop - before;
    });
    assert.equal(repaired,50,'Two cancelled inputs in one frame are restored exactly once');
  }
} finally { await browser.close(); await server.close(); }

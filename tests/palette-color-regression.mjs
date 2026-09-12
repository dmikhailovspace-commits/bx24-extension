import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {startHarnessServer} from './lib/harness-server.mjs';
const server=await startHarnessServer();
const browser=await chromium.launch({headless:true});
const report={phases:[]},failures=[];
const hue=color=>{
 const [r,g,b]=color.match(/[a-f\d]{2}/gi).map(value=>parseInt(value,16));
 const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
 if(!d||d/max<.15||max/255<.15)return null;
 return ((max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360;
};
const assertDifferentHue=(before,after)=>{
 const first=hue(before),second=hue(after);
 if(first!==null&&second!==null){const gap=Math.abs(first-second);assert(Math.min(gap,360-gap)>=90,`${before} -> ${after} kept the hue family`);}
};
try{
 for(const width of [1000,360])for(const kind of ['dialog','folder']){
  const page=await browser.newPage({viewport:{width,height:760}});
  try{
   await page.goto(server.baseUrl+'/tests/native-consistency-harness.html?mode=chats&passThrough=1');
   const target=kind==='dialog'?page.locator('.recent-host .pena-native-chat-row[data-id="chat225"]'):page.locator('.recent-host .pena-native-folder-tab').filter({hasText:'Тестовая папка'});
   await target.waitFor();await page.waitForTimeout(250);
   const before=await page.evaluate(()=>({left:document.querySelector('.recent-host').getBoundingClientRect().left,scrollX,scrollY,clientWidth:document.documentElement.clientWidth}));
   await target.click({button:'right'});
   const button=page.locator(kind==='dialog'?'.dialog-control-context-color-marker':'.dialog-control-context-folder-color');
   await button.waitFor();
   await page.evaluate(()=>{
    window.paletteFrames=[];const end=performance.now()+700;
    const sample=()=>{const p=document.querySelector('.dialog-control-palette.--open');if(p){const r=p.getBoundingClientRect();paletteFrames.push({at:performance.now(),left:r.left,right:r.right,top:r.top,width:r.width,opacity:Number(getComputedStyle(p).opacity)});}if(performance.now()<end)requestAnimationFrame(sample);};requestAnimationFrame(sample);
   });
   await button.click();
   const palette=page.locator('.dialog-control-palette.--open');await palette.waitFor();await page.waitForTimeout(250);
   const after=await page.evaluate(()=>{const p=document.querySelector('.dialog-control-palette.--open'),r=p.getBoundingClientRect();return{left:document.querySelector('.recent-host').getBoundingClientRect().left,scrollX,scrollY,clientWidth:document.documentElement.clientWidth,palette:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},frames:paletteFrames.filter(frame=>frame.opacity>0)};});
   const colorBefore=await palette.evaluate(p=>p.querySelector('.dialog-control-preview').style.getPropertyValue('--dialog-chip-color'));
   const savedBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('pena.dialogControlColors.v1')||'[]'));
   await palette.locator('.dialog-control-palette-tool.--random').click();await page.waitForTimeout(100);
   const random=await palette.evaluate(p=>{const r=p.getBoundingClientRect();return{left:r.left,width:r.width,color:p.querySelector('.dialog-control-preview')?.style.getPropertyValue('--dialog-chip-color')};});
   const drift=Math.max(...after.frames.map(frame=>frame.left))-Math.min(...after.frames.map(frame=>frame.left));
   assert.deepEqual({left:after.left,scrollX:after.scrollX,scrollY:after.scrollY,clientWidth:after.clientWidth},before,'Opening the palette moved the native interface');
   assert(after.palette.left>=11&&after.palette.right<=width-11&&after.palette.top>=11&&after.palette.bottom<=749,'Palette escaped viewport');
   assert(Math.abs(random.left-after.palette.left)<.5,'Random color moved palette horizontally');
   assert.match(random.color,/^#[0-9a-f]{6}$/);assert.notEqual(random.color,colorBefore);
   assertDifferentHue(colorBefore,random.color);
   const assigned=await page.evaluate(({kind})=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')||'[]').find(item=>item.id===(kind==='dialog'?'chat225':'folder:test'))?.color,{kind});
   assert.equal(assigned,random.color,'Random picker did not persist the selected marker');
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pena.dialogControlColors.v1')||'[]')),savedBefore,'Random click saved a swatch without Plus');
   let next=random.color;
   for(let click=0;click<6;click++){
    const previous=next;
    await palette.locator('.dialog-control-palette-tool.--random').click();await page.waitForTimeout(80);
    next=await palette.evaluate(p=>p.querySelector('.dialog-control-preview').style.getPropertyValue('--dialog-chip-color'));
    assertDifferentHue(previous,next);
    const persisted=await page.evaluate(({kind})=>JSON.parse(localStorage.getItem('pena.dialogControl.v1.chats')||'[]').find(item=>item.id===(kind==='dialog'?'chat225':'folder:test'))?.color,{kind});
    assert.equal(persisted,next);
   }
   await palette.locator('.dialog-control-swatch.--add').click();
   assert((await page.evaluate(()=>JSON.parse(localStorage.getItem('pena.dialogControlColors.v1')||'[]'))).includes(next),'Plus did not save the chosen random color');
   if(drift>.5)failures.push(`${kind}/${width}: palette moved left ${drift.toFixed(2)}px during its opening animation`);
   report.phases.push({kind,width,status:drift<=.5?'PASS':'FAIL',drift,before,after,random});
   await page.screenshot({path:`tests/artifacts/palette-${kind}-${width}.png`});
   await page.keyboard.press('Escape');await page.waitForTimeout(220);assert.equal(await page.locator('.dialog-control-palette').count(),0);
  }finally{await page.close();}
 }
 assert.deepEqual(failures,[]);console.log('PASS palette browser: four native anchor/animation/random scenarios');
}finally{writeFileSync('tests/artifacts/palette-color-report.json',JSON.stringify(report,null,2));await browser.close();await server.close();}

import assert from 'node:assert/strict';

// Sanitized Bitrix CSS observed on bx24.id-pr.ru. The native selected rules
// deliberately follow the ordinary rules, as they do in the live portal.
export const nativeCounterCss = `
.test-host {
 --im-color-palette-white-base:#fff; --ui-color-white-base:#fff;
 --im-color-accent-blue:#00ade3; --ui-color-accent-main-primary:#2875d9;
 --ui-color-gray-40:#a8adb4; --im-chat-title__font-color:#1f2937;
 --im-chat-title-collab-color:#00a94e; --im-chat-title-bot-color:#9d56a9;
 --im-chat-title-extranet-color:#ca8600; --im-chat-title-network-color:#0a962f;
 --im-chat-title-support24-color:#005390;
 --im-list-recent-item__color_date:#a4adba;
}
.bx-im-list-recent-item__counters_wrap {
 --im-list-recent-item__background-color_counter:#00ade3;
 --im-list-recent-item__background-color_muted:#a8adb4;
 --im-list-recent-item__background-color_comments:#9dcf00;
 --im-list-recent-item__color_counter:#fff;
 --im-list-recent-item__border-color_unread:#fff;
 --im-list-recent-item__border-color_unread-hover:#f5f7f8;
 display:flex; gap:3px; margin-left:8px;
}
.bx-im-list-recent-item__content_bottom {display:flex;justify-content:space-between}
.bx-im-list-recent-item__counter_number,.bx-im-list-recent-item__mention {
 color:var(--im-list-recent-item__color_counter);
 background-color:var(--im-list-recent-item__background-color_counter);
 height:18px;min-width:18px;border-radius:30px;padding:0 5px;position:relative;font-size:11px;
}
.bx-im-list-recent-item__mention-icon {background-color:var(--im-list-recent-item__color_counter)}
.bx-im-list-recent-item__counters_wrap.--with-children .bx-im-list-recent-item__counter_number::before {content:"";background-color:#fff}
.bx-im-list-recent-item__counters_wrap.--with-children .bx-im-list-recent-item__counter_number::after {content:"";background-color:var(--im-list-recent-item__background-color_comments)}
.bx-im-list-recent-item__counters_wrap.--children-only .bx-im-list-recent-item__counter_number {background-color:var(--im-list-recent-item__background-color_comments)}
.bx-im-list-recent-item__counters_wrap.--muted .bx-im-list-recent-item__counter_number,
.bx-im-list-recent-item__counters_wrap.--with-children.--muted .bx-im-list-recent-item__counter_number::after {background-color:var(--im-list-recent-item__background-color_muted)}
.bx-im-list-recent-item__counter_number.--with-unread::before,
.bx-im-list-recent-item__counters_wrap.--with-children .bx-im-list-recent-item__counter_number.--with-unread::before {
 content:"";border:2px solid var(--im-list-recent-item__border-color_unread);
 background-color:var(--im-list-recent-item__background-color_counter)
}
.bx-im-list-recent-item__wrap:hover .bx-im-list-recent-item__counter_number.--with-unread::before {border-color:var(--im-list-recent-item__border-color_unread-hover)}
.bx-im-list-recent-item__counters_wrap.--muted .bx-im-list-recent-item__counter_number.--with-unread::before {background-color:var(--im-list-recent-item__background-color_muted)}
.bx-im-list-recent-item__avatar_counter {color:#fff;background-color:var(--im-color-accent-blue)}
.bx-im-list-recent-item__avatar_counter.--muted {background-color:var(--ui-color-gray-40)}
.bx-im-list-recent-item__avatar_counter.--with-unread::before {content:"";border:2px solid #fff;background-color:var(--im-color-accent-blue)}
.bx-im-list-recent-item__avatar_counter.--muted.--with-unread::before {background-color:var(--ui-color-gray-40)}
.bx-im-chat-title__text.--collaber,.bx-im-chat-title__text.--guest {color:var(--im-chat-title-collab-color)}
.bx-im-chat-title__text.--bot,.bx-im-chat-title__text.--copilot {color:var(--im-chat-title-bot-color)}
.bx-im-chat-title__text.--extranet {color:var(--im-chat-title-extranet-color)}
.bx-im-chat-title__text.--network {color:var(--im-chat-title-network-color)}
.bx-im-chat-title__text.--support24 {color:var(--im-chat-title-support24-color)}
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__counter_number,.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__mention {background-color:#fff;color:#00ace3}
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__mention-icon {background-color:#00ace3}
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__counter_number.--with-unread::before,
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__counters_wrap.--with-children .bx-im-list-recent-item__counter_number.--with-unread::before {border-color:#00ace3;background-color:#fff}
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__counters_wrap.--children-only .bx-im-list-recent-item__counter_number {background-color:#fff}
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__counters_wrap.--with-children .bx-im-list-recent-item__counter_number::before {background-color:#00ace3}
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__counters_wrap.--with-children .bx-im-list-recent-item__counter_number::after {background-color:#fff}
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__avatar_counter {color:#00ade3;background-color:#fff}
.bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__avatar_counter.--with-unread::before {border-color:#00ade3;background-color:#fff}
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__counters_wrap {--im-list-recent-item__background-color_counter:var(--ui-color-accent-main-primary)}
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__counter_number,
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__mention {color:var(--ui-color-accent-main-primary)}
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__avatar_counter,
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__avatar_counter.--with-unread::before {background-color:var(--ui-color-accent-main-primary)}
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__avatar_counter.--muted,
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__avatar_counter.--muted.--with-unread::before {background-color:var(--ui-color-gray-40)}
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__avatar_counter {color:var(--ui-color-accent-main-primary);background-color:#fff}
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__wrap.--selected .bx-im-list-recent-item__avatar_counter.--with-unread::before {border-color:var(--ui-color-accent-main-primary);background-color:#fff}
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__wrap .bx-im-list-recent-item__counter_number.--air-counter,
.bx-im-messenger__scope.--air-design .bx-im-list-recent-item__wrap .bx-im-list-recent-item__avatar_counter.--air-counter {background-color:transparent}
`;

export const counterMarkup = '<div class="bx-im-list-recent-item__counters_wrap"><span class="bx-im-list-recent-item__counter_number">7</span><span class="bx-im-list-recent-item__mention"><i class="bx-im-list-recent-item__mention-icon"></i></span></div>';

export async function counterAppearance(row) {
 return row.evaluate(el => {
   const style = (node, pseudo) => {
     const s = getComputedStyle(node, pseudo);
     return { color:s.color, bg:s.backgroundColor, border:s.borderTopColor };
   };
   return [...el.querySelectorAll('[class*="__counter_number"],[class*="__mention"],[class*="__avatar_counter"]')]
     .map(node => ({normal:style(node), before:style(node,'::before'), after:style(node,'::after')}));
 });
}

export async function checkCounterVariants(page, host, active, other, mode) {
 // Move the cursor off both cards so :hover does not make the comparison false.
 await page.mouse.move(439, 759);
 for (const air of [false,true]) {
   await host.evaluate((el,air) => {
     el.classList.add('bx-im-messenger__scope'); el.classList.toggle('--air-design',air);
   }, air);
   for (const variant of ['', '--muted','--children-only','--children-only --muted','--with-children','--with-children --muted']) {
     for (const unread of [false,true]) {
       await host.locator('[data-id="chat225"],[data-id="chat5"]').evaluateAll((rows,{variant,unread,air})=>rows.forEach(el=>{
         el.querySelector('.bx-im-list-recent-item__counters_wrap').className='bx-im-list-recent-item__counters_wrap '+variant;
         el.querySelector('.bx-im-list-recent-item__counter_number').className='bx-im-list-recent-item__counter_number'+(unread?' --with-unread':'');
         let avatar=el.querySelector('.bx-im-list-recent-item__avatar_counter');
         if(!avatar){avatar=document.createElement('span');el.querySelector('.bx-im-list-recent-item__avatar_container').append(avatar)}
         avatar.className='bx-im-list-recent-item__avatar_counter'+(variant.includes('--muted')?' --muted':'')+(unread?' --with-unread':'');
       }),{variant,unread,air});
       // Baseline is an actual ordinary row, not another overridden selection.
       await other.evaluate(el=>{
         el.removeAttribute('data-pena-native-multi-selected');
       });
       const expected = await counterAppearance(other);
       await other.evaluate(el=>el.dataset.penaNativeMultiSelected='1');
       assert.deepEqual(await counterAppearance(other),expected,`${mode}/${air}/${variant}/${unread}: multiselect must preserve ordinary counters`);
       assert.deepEqual(await counterAppearance(active),expected,`${mode}/${air}/${variant}/${unread}: open counter must match ordinary counter`);
       if(unread){
         await other.hover();
         await other.evaluate(el=>el.removeAttribute('data-pena-native-multi-selected'));
         const hovered=await counterAppearance(other);
         await other.evaluate(el=>el.dataset.penaNativeMultiSelected='1');
         await active.hover();
         assert.deepEqual(await counterAppearance(active),hovered,'Unread reminder border also follows ordinary hover');
         await page.mouse.move(439,759);
       }
     }
   }
   if(air){
     await host.locator('[data-id="chat225"],[data-id="chat5"]').evaluateAll(rows=>rows.forEach(el=>el.querySelectorAll('[class*="__counter_number"],[class*="__avatar_counter"]').forEach(n=>n.classList.add('--air-counter'))));
     assert.deepEqual(await counterAppearance(active),await counterAppearance(other),'Air counters remain transparent');
   }
 }
 await host.evaluate(el=>el.classList.remove('--air-design'));
 for(const variant of ['--collaber','--guest','--bot','--copilot','--extranet','--network','--support24','inline']){
   await host.locator('[data-id="chat225"],[data-id="chat5"]').evaluateAll((rows,variant)=>rows.forEach(el=>{
     const title=el.querySelector('.bx-im-chat-title__text');
     title.className='bx-im-chat-title__text'+(variant==='inline'?'':' '+variant);
     title.style.color=variant==='inline'?'rgb(0, 169, 78)':'';
   }),variant);
   const color=row=>row.locator('.bx-im-chat-title__text').evaluate(el=>getComputedStyle(el).color);
   assert.deepEqual(await color(active),await color(other),`${mode}: preserve title ${variant}`);
   assert.notEqual(await color(other),'rgb(31, 41, 55)',`${variant} must not turn black`);
 }
 await host.locator('[data-id="chat225"],[data-id="chat5"]').evaluateAll(rows=>rows.forEach(el=>{
   const title=el.querySelector('.bx-im-chat-title__text');title.className='bx-im-chat-title__text';title.style.color='';
   el.querySelector('.bx-im-list-recent-item__counters_wrap').className='bx-im-list-recent-item__counters_wrap';
   el.querySelector('.bx-im-list-recent-item__counter_number').className='bx-im-list-recent-item__counter_number';
   el.querySelector('.bx-im-list-recent-item__avatar_counter')?.remove();
 }));
}

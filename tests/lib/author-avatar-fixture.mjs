import assert from 'node:assert/strict';

// Native author components from the portal, with synthetic portraits only.
export async function checkAuthorAvatars(page, host, active, other) {
  await page.addStyleTag({content:`
    .bx-im-list-recent-item__message_container {font:14px/19px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
    .bx-im-list-recent-item__message_text {display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
    .bx-im-list-recent-item__author-avatar {position:relative;display:inline-block;vertical-align:text-bottom;margin-right:4px;margin-bottom:1px;width:14px;height:14px;max-height:14px}
    .bx-im-legacy-avatar__content {width:100%;height:100%;border-radius:50%;object-fit:cover}
    .bx-im-base-ui-avatar__container .ui-avatar {position:relative;display:inline-flex;width:14px;height:14px}
  `});
  const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><rect width="14" height="14" fill="#208bc4"/><circle cx="7" cy="5" r="3" fill="#f5c79d"/><path d="M2 14v-2a5 5 0 0 1 10 0v2" fill="#fff"/></svg>');
  await active.locator('.bx-im-list-recent-item__message_text').evaluate((el,src)=>{
    el.innerHTML='<span class="bx-im-legacy-avatar__container bx-im-list-recent-item__author-avatar"><img class="bx-im-legacy-avatar__content" alt=""></span>Пример сообщения автора';
    el.querySelector('img').src=src;
  },picture);
  await other.locator('.bx-im-list-recent-item__message_text').evaluate(el=>{
    el.innerHTML='<span class="bx-im-base-ui-avatar__container bx-im-list-recent-item__author-avatar"><span class="ui-avatar"><svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="7" fill="#00a94e"/></svg></span></span>Пример сообщения автора';
  });
  for(const zoom of [1,1.25,1.5]) {
    await host.evaluate((el,z)=>el.style.zoom=z,zoom);
    for(const row of [active,other]) {
      const bounds=await row.locator('.bx-im-list-recent-item__author-avatar').evaluate(el=>{
        const r=el.getBoundingClientRect(),c=el.firstElementChild.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();
        return {host:{width:r.width,height:r.height},child:{width:c.width,height:c.height},offset:c.top-r.top,bottom:c.bottom-r.bottom,clipTop:p.top-c.top,clipBottom:c.bottom-p.bottom,ring:el.querySelector('.pena-native-avatar-ring')!==null};
      });
      assert.ok(Math.abs(bounds.offset)<.1&&Math.abs(bounds.bottom)<.1,`Author portrait must fill its host without a baseline shift: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.clipTop<=.1&&bounds.clipBottom<=.1,'The preview must not clip the portrait');
      assert.deepEqual(bounds.child,bounds.host);assert.equal(bounds.ring,false,'Main portrait rings must not be applied to message authors');
    }
  }
  await host.evaluate(el=>el.style.removeProperty('zoom'));
}

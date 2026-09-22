// The native portrait is square; its parent clips it to a circle. Test the
// painted hit region, not just border-radius (which does not clip children).
export async function checkNativeAvatarTransitions(page) {
 return page.evaluate(async () => {
  const states = [];
  const row = document.createElement('div');
  row.style.cssText = 'position:fixed;left:600px;top:100px;width:100px;height:100px;z-index:2147483647;background:white';
  row.innerHTML = '<span class="bx-im-list-recent-item__avatar" style="display:block;position:relative;width:40px;height:40px"><span class="bx-im-component-avatar__content" style="display:block;position:relative;width:40px;height:40px;border-radius:50%;overflow:hidden;background:#94a3b8"></span><span class="bx-im-avatar__typing" style="position:absolute;left:33px;top:33px;width:16px;height:16px;border-radius:50%;background:blue;z-index:3"></span></span>';
  document.body.append(row);
  const outer = row.firstElementChild;
  let content = outer.firstElementChild;
  let typing = outer.lastElementChild;
  const baseline = content.getBoundingClientRect().toJSON();
  const paint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const color = value => window.__PENA_DOM_AUDIT__.colorAvatar(row, value);
  const capture = async phase => {
   await paint();
   const rect = content.getBoundingClientRect();
   const photo = content.querySelector('img');
   const ring = row.querySelector('.pena-native-avatar-ring');
   states.push({ phase,
    cornerExposesPhoto: !!photo && document.elementsFromPoint(rect.left + 1, rect.top + 1).includes(photo),
    geometryPreserved: ['x','y','width','height'].every(key => Math.abs(rect[key] - baseline[key]) < .1),
    typingVisible: document.elementFromPoint(rect.right + 4, rect.bottom + 4) === typing,
    staleHosts: [...row.querySelectorAll('.pena-native-avatar-ring-host')].filter(host => host !== ring?.parentElement).length,
    overflow: getComputedStyle(content).overflow, imageLoaded: !!photo?.naturalWidth
   });
  };
  try {
   await capture('native placeholder');
   color('#ce3370');
   await capture('folder color before photo');
   const photo = document.createElement('img');
   photo.style.cssText = 'display:block;width:40px;height:40px;border-radius:0;background:red';
   content.prepend(photo);
   await capture('photo element inserted before load');
   photo.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path fill="red" d="M0 0h40v40H0z"/></svg>');
   await photo.decode();
   color('#ce3370');
   await capture('photo loaded');
   // Bitrix can mount a new inner portrait before removing its old shell.
   const previous = content;
   content = document.createElement('span');
   content.className = 'bx-im-avatar__content';
   content.style.cssText = previous.style.cssText;
   content.style.removeProperty('--pena-native-color');
   content.append(photo);
   previous.append(content);
   color('#ce3370');
   await capture('inner portrait replaced');
   typing.replaceWith(typing.cloneNode(true));
   typing = outer.lastElementChild;
   color('#ce3370');
   await capture('typing overlay recreated');
   color('');
   await capture('moved to uncolored folder');
   color('#397ae0');
   await capture('moved back to colored folder');
   // Background avatars and images with their own clipping must also survive.
   photo.style.borderRadius = '50%';
   content.style.overflow = 'visible';
   color('#397ae0');
   await capture('native photo clips itself');
   photo.remove();
   content.style.backgroundImage = 'linear-gradient(red,red)';
   color('#397ae0');
   await capture('native background portrait');
  } finally { row.remove(); }
  return states;
 });
}

// Current Bitrix Avatar puts __content on the IMG itself, rather than on a
// wrapper. Task/chat initials use a DIV with the very same class.
export async function checkNativeImageRing(page) {
 return page.evaluate(async () => {
  const states = [];
  const row = document.createElement('div');
  row.style.cssText = 'position:fixed;left:600px;top:100px;width:100px;height:100px;z-index:2147483647;background:white';
  document.body.append(row);
  try {
   for (const prefix of ['bx-im-avatar', 'bx-im-component-avatar']) {
    row.innerHTML = '<div class="bx-im-list-recent-item__avatar_container" style="position:relative;width:48px;height:64px;display:flex;align-items:center"><div class="bx-im-list-recent-item__avatar_content" style="position:relative;width:48px;height:48px"><div class="' + prefix + '__container" style="position:relative;width:48px;height:48px"></div><span class="bx-im-avatar__typing" style="position:absolute;left:39px;top:39px;width:16px;height:16px;border-radius:50%;background:blue"></span></div></div>';
    const container = row.querySelector('.' + prefix + '__container');
    const typing = row.querySelector('.bx-im-avatar__typing');
    let portrait = null;
    for (const kind of ['initials', 'photo', 'fallback initials', 'replacement photo']) {
     const next = document.createElement(kind.includes('photo') ? 'img' : 'div');
     next.className = prefix + '__content ' + (next.tagName === 'IMG' ? '--image' : '--text');
     next.style.cssText = 'display:block;width:100%;height:100%;border-radius:50%;background:#94a3b8;object-fit:cover';
     if (next.tagName === 'IMG') {
      next.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><path fill="red" d="M0 0h48v48H0z"/></svg>');
      await next.decode();
     } else next.textContent = 'SC';
     if (portrait) portrait.replaceWith(next); else container.append(next);
     portrait = next;
     window.__PENA_DOM_AUDIT__.colorAvatar(row, '#ce3370');
     await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
     const ring = row.querySelector('.pena-native-avatar-ring');
     const ringRect = ring?.getBoundingClientRect();
     const rect = portrait.getBoundingClientRect();
     states.push({ prefix, kind,
      ringRendered: !!ring?.getClientRects().length && ringRect.width > 0 && ringRect.height > 0,
      ringInsideImage: !!ring?.closest('img'),
      geometryPreserved: !!ringRect && ['x','y','width','height'].every(key => Math.abs(ringRect[key] - rect[key]) < .1),
      photoRounded: getComputedStyle(portrait).borderRadius === '50%',
      typingVisible: document.elementFromPoint(rect.right + 4, rect.bottom + 4) === typing,
      nativePortraitPreserved: container.contains(portrait) && (portrait.tagName !== 'IMG' || portrait.naturalWidth === 48)
     });
    }
   }
  } finally { row.remove(); }
  return states;
 });
}

// Bitrix BaseUiAvatar renders collab users as AvatarRoundGuest: an HTML
// .ui-avatar containing SVG/image + a circular mask, not an HTML IMG.
export async function checkCollabAvatarRing(page) {
 return page.evaluate(async () => {
  const states = [];
  const row = document.createElement('div');
  row.style.cssText = 'position:fixed;left:600px;top:100px;width:140px;height:100px;z-index:2147483647;background:white';
  row.innerHTML = '<div class="bx-im-list-recent-item__avatar_container" style="width:48px;height:64px;display:flex;align-items:center"><div class="bx-im-list-recent-item__avatar_content" style="position:relative"><div class="bx-im-base-ui-avatar__container"></div><span class="bx-im-avatar__typing" style="position:absolute;left:39px;top:39px;width:16px;height:16px;border-radius:50%;background:blue"></span></div></div><div class="bx-im-list-recent-item__message_text"><div class="bx-im-base-ui-avatar__container"><div class="ui-avatar" style="width:18px;height:18px"></div></div></div>';
  document.body.append(row);
  const wrapper = row.querySelector('.bx-im-base-ui-avatar__container');
  let avatar;
  const mount = () => {
   wrapper.innerHTML = '<div class="ui-avatar --round --guest" style="display:inline-flex;position:relative;width:48px;height:48px"><svg viewBox="0 0 102 102" style="width:48px;height:48px"><mask id="pena-collab-mask"><circle cx="51" cy="51" r="42.5" fill="white"/></mask><circle class="ui-avatar-border-inner" cx="51" cy="51" r="51" fill="white"/><circle class="ui-avatar-base" cx="51" cy="51" r="42.5" fill="#19cc45"/><circle class="ui-avatar-border" cx="51" cy="51" r="49" fill="none" stroke="#19cc45" stroke-width="3.74"/></svg><div class="ui-avatar__text" style="position:absolute;inset:0;display:grid;place-items:center">МЕ</div></div>';
   avatar = wrapper.firstElementChild;
  };
  const capture = async (phase, color = '#ce3370') => {
   const svg = avatar.querySelector('svg');
   const nativeSvg = svg.outerHTML;
   const baseline = avatar.getBoundingClientRect();
   window.__PENA_DOM_AUDIT__.colorAvatar(row, color);
   await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
   const rings = row.querySelectorAll('.pena-native-avatar-ring');
   const ring = rings[0];
   const rect = ring?.getBoundingClientRect();
   const typing = row.querySelector('.bx-im-avatar__typing');
   states.push({ phase, ringCount: rings.length,
    correctHost: !color || ring?.parentElement === avatar,
    geometryPreserved: !color || !!rect && ['x','y','width','height'].every(key => Math.abs(rect[key] - baseline[key]) < .1),
    nativeSvgPreserved: svg === avatar.querySelector('svg') && svg.outerHTML === nativeSvg,
    typingVisible: document.elementFromPoint(baseline.right + 4, baseline.bottom + 4) === typing,
    staleHosts: [...row.querySelectorAll('.pena-native-avatar-ring-host')].filter(host => host !== ring?.parentElement).length
   });
  };
  try {
   // A color applied before Vue mounts the UI avatar must migrate off the tall shell.
   window.__PENA_DOM_AUDIT__.colorAvatar(row, '#ce3370');
   mount();
   await capture('late guest initials');
   avatar.querySelector('.ui-avatar__text').remove();
   const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
   image.setAttribute('width', '102'); image.setAttribute('height', '102');
   image.setAttribute('mask', 'url(#pena-collab-mask)');
   image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
   avatar.querySelector('svg').append(image);
   await capture('SVG photo before load');
   image.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="102" height="102"><path fill="red" d="M0 0h102v102H0z"/></svg>'));
   await capture('SVG photo loaded');
   const typing = row.querySelector('.bx-im-avatar__typing');
   typing.replaceWith(typing.cloneNode(true));
   await capture('typing recreated');
   mount();
   await capture('guest component recreated');
   await capture('uncolored folder', '');
   await capture('colored folder again', '#397ae0');
  } finally { row.remove(); }
  return states;
 });
}

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

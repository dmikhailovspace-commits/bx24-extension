// Pure build-time transformation: no desktop file is modified.
export function transformChromeContent(source) {
  if (typeof source !== 'string') throw new TypeError('Content source must be a string');
  let result = source.replace(/\r\n/g, '\n');
  const replaceOnce = (pattern, replacement, label) => {
    const matches = [...result.matchAll(new RegExp(pattern.source, 'g'))];
    if (matches.length !== 1) throw new Error(`Chrome content transform: ${label} expected once, found ${matches.length}`);
    result = result.replace(pattern, replacement);
  };
  replaceOnce(/  const inject = \(path, configure\) => new Promise\(\(resolve, reject\) => \{[\s\S]*?\n  const verifyRelease = async \(\) => \{/, `  const injectChromeRuntime = () => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ channel: 'pena.chrome.portal.v1', action: 'inject' }, response => {
      const error = chrome.runtime.lastError;
      if (error || !response?.ok) reject(new Error(error?.message || response?.error || 'Chrome runtime injection failed'));
      else resolve(response);
    });
  });

  const verifyRelease = async () => {`, 'DOM injection block');
  replaceOnce(/      await injectStylesheet\(\);\n      await inject\('native-catalog\.js'\);\n      await inject\('native-interaction-state\.js'\);\n\s*await inject\('native-time-control\.js'\);\n      await inject\('native-lifecycle\.js'\);\n      await inject\('dialog-repository\.js'\);\n      await inject\('injected\.js', script => \{ script\.dataset\.logoUrl = _logoUrl; \}\);/, '      await injectChromeRuntime();', 'ordered runtime launch');
  if (/script\.src\s*=|link\.href\s*=/.test(result)) throw new Error('Chrome content transform retained DOM resource injection');
  return result;
}

export default transformChromeContent;

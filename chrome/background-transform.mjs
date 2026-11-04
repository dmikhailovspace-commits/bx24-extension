// The Chrome Web Store distributes updates itself. Drop the desktop updater
// before packaging so it cannot fetch GitHub metadata or suggest sideloading.
export function transformChromeBackground(source) {
  if (typeof source !== 'string') throw new TypeError('Background source must be a string');
  const normalized = source.replace(/\r\n/g, '\n');
  const startAnchor = "const UPDATE_CHANNEL = 'pena.update.v1';";
  const listenerAnchor = 'chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {';
  const updaterBranch = `  if (message?.channel === UPDATE_CHANNEL) {
    handleUpdateMessage(message, sender).then(result => sendResponse({ok:true,result})).catch(error => sendResponse({ok:false,error:error.message}));
    return true;
  }
`;
  const start = normalized.indexOf(startAnchor);
  const listener = normalized.indexOf(listenerAnchor, start);
  if (start < 0 || listener < 0 || normalized.indexOf(startAnchor, start + 1) >= 0 || normalized.indexOf(listenerAnchor, listener + 1) >= 0) {
    throw new Error('Chrome background transform: desktop updater anchors changed');
  }
  const remainder = normalized.slice(listener);
  if (remainder.split(updaterBranch).length !== 2) throw new Error('Chrome background transform: desktop updater listener changed');
  const result = normalized.slice(0, start) + remainder.replace(updaterBranch, '');
  if (/pena\.update\.v1|raw\.githubusercontent\.com|sendNativeMessage/.test(result)) throw new Error('Chrome background transform retained desktop updater');
  return result;
}

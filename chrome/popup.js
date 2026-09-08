(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const channel = 'pena.chrome.portal.v1';
  let tab = null;
  let originPattern = null;
  let busy = false;
  const status = (message, error = false) => {
    $('status').textContent = message;
    $('status').dataset.error = String(error);
  };
  const sync = async () => {
    const result = await chrome.runtime.sendMessage({ channel, action: 'sync' });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось подключить портал');
  };
  async function renderPermissions() {
    const { origins = [] } = await chrome.permissions.getAll();
    const portals = origins.filter(origin => /^https:\/\/[^*/]+\/\*$/.test(origin)).sort();
    $('portals').replaceChildren();
    $('portals-section').hidden = portals.length === 0;
    for (const origin of portals) {
      const row = document.createElement('li');
      const host = document.createElement('span');
      host.textContent = new URL(origin.slice(0, -1)).hostname;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Отключить';
      remove.setAttribute('aria-label', `Отключить ${host.textContent}`);
      remove.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        remove.disabled = true;
        try {
          const removed = await chrome.permissions.remove({ origins: [origin] });
          if (!removed) throw new Error('Chrome не отозвал разрешение');
          await sync();
          await renderPermissions();
          status('Портал отключён. Обновите его открытые вкладки, чтобы завершить работу расширения.');
          $('reload').hidden = origin !== originPattern;
        } catch { status('Не удалось отключить портал. Повторите попытку.', true); }
        finally { busy = false; remove.disabled = false; }
      });
      row.append(host, remove);
      $('portals').appendChild(row);
    }
    const connected = !!originPattern && await chrome.permissions.contains({ origins: [originPattern] });
    $('connect').hidden = connected;
    $('connect').disabled = !originPattern;
    $('portal-heading').textContent = connected ? 'Портал подключён' : 'Подключите ваш Bitrix24';
    $('intro').textContent = connected
      ? 'Откройте чаты Bitrix24. Если вкладка была открыта до подключения, обновите её после сохранения черновиков.'
      : 'Откройте портал в этой вкладке и разрешите расширению работать на нём.';
    if (connected) $('reload').hidden = false;
  }
  $('connect').addEventListener('click', async () => {
    if (!originPattern || busy) return;
    busy = true;
    $('connect').disabled = true;
    try {
      // Keep request directly inside the click handler: Chrome requires a user gesture.
      const granted = await chrome.permissions.request({ origins: [originPattern] });
      if (!granted) { status('Доступ не выдан. Подключить портал можно позже.'); return; }
      await sync();
      await renderPermissions();
      status('Готово. Сохраните черновики и обновите вкладку Bitrix24.');
    } catch { status('Не удалось подключить портал. Повторите попытку.', true); }
    finally { busy = false; $('connect').disabled = !originPattern; }
  });
  $('reload').addEventListener('click', async () => {
    if (!Number.isInteger(tab?.id)) return;
    try {
      // Never reload a tab that navigated away while this popup was open.
      const current = await chrome.tabs.get(tab.id);
      if (new URL(current.url).origin !== new URL(tab.url).origin) {
        status('Адрес вкладки изменился. Откройте окно расширения снова.', true);
        return;
      }
      await chrome.tabs.reload(tab.id);
      window.close();
    } catch { status('Вкладка недоступна. Обновите Bitrix24 вручную.', true); }
  });
  async function init() {
    $('version').textContent = `v${chrome.runtime.getManifest().version}`;
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      const url = new URL(tab?.url);
      if (url.protocol === 'https:' && !url.username && !url.password) {
        originPattern = `https://${url.hostname}/*`;
        $('host').textContent = url.host;
        $('host').hidden = false;
      }
    } catch { /* Internal Chrome pages do not expose a supported portal URL. */ }
    await sync();
    await renderPermissions();
    if (!originPattern) status('Откройте Bitrix24 по адресу https:// и снова нажмите значок расширения.');
  }
  init().catch(() => status('Не удалось прочитать настройки Chrome. Закройте это окно и откройте снова.', true));
})();

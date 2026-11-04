(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const channel = 'pena.chrome.portal.v1';
  let tab = null;
  let busy = false;
  const parsePortal = value => {
    const input = String(value || '').trim();
    if (!input) return null;
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || url.hostname.includes('*')) return null;
      return { pattern: `https://${url.hostname}/*`, url: `https://${url.hostname}/`, host: url.hostname };
    } catch { return null; }
  };
  const selectedPortal = () => parsePortal($('portal-url').value);
  const activePortal = () => {
    try { return parsePortal(tab?.url)?.pattern || null; } catch { return null; }
  };
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
    const selected = selectedPortal();
    const connected = !!selected && portals.includes(selected.pattern);
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
          $('reload').hidden = origin !== activePortal();
        } catch { status('Не удалось отключить портал. Повторите попытку.', true); }
        finally { busy = false; remove.disabled = false; }
      });
      row.append(host, remove);
      $('portals').appendChild(row);
    }
    $('host').textContent = selected ? `Доступ только к ${selected.host}` : '';
    $('host').hidden = !selected;
    $('connect').hidden = connected;
    $('connect').disabled = !selected || busy;
    $('portal-heading').textContent = connected ? 'Портал подключён' : portals.length ? 'Добавить портал' : 'Подключите ваш Bitrix24';
    $('intro').textContent = connected
      ? 'Откройте чаты Bitrix24. Если вкладка была открыта до подключения, обновите её после сохранения черновиков.'
      : 'Укажите адрес вашего портала. Расширение попросит доступ только к нему.';
    $('reload').hidden = !connected || activePortal() !== selected.pattern;
    $('open').hidden = !connected || activePortal() === selected.pattern;
    if (connected) $('open').href = selected.url;
    else $('open').removeAttribute('href');
  }
  $('portal-url').addEventListener('input', () => {
    status($('portal-url').value.trim() && !selectedPortal() ? 'Укажите адрес портала с HTTPS без логина и нестандартного порта.' : '', !!$('portal-url').value.trim() && !selectedPortal());
    void renderPermissions().catch(() => status('Не удалось прочитать настройки Chrome.', true));
  });
  $('connect').addEventListener('click', async () => {
    const selected = selectedPortal();
    if (!selected || busy) return;
    busy = true;
    $('connect').disabled = true;
    try {
      // Keep request directly inside the click handler: Chrome requires a user gesture.
      const granted = await chrome.permissions.request({ origins: [selected.pattern] });
      if (!granted) { status('Доступ не выдан. Подключить портал можно позже.'); return; }
      $('portal-url').value = selected.url;
      await sync();
      await renderPermissions();
      status(activePortal() === selected.pattern
        ? 'Готово. Сохраните черновики и обновите вкладку Bitrix24.'
        : 'Готово. Откройте портал, чтобы начать работу.');
    } catch { status('Не удалось подключить портал. Повторите попытку.', true); }
    finally { busy = false; $('connect').disabled = !selectedPortal(); }
  });
  $('reload').addEventListener('click', async () => {
    if (!Number.isInteger(tab?.id)) return;
    try {
      // Never reload a tab that navigated away while this popup was open.
      const current = await chrome.tabs.get(tab.id);
      if (parsePortal(current.url)?.pattern !== selectedPortal()?.pattern || activePortal() !== selectedPortal()?.pattern) {
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
    await sync();
    const { origins = [] } = await chrome.permissions.getAll();
    const portals = origins.filter(origin => /^https:\/\/[^*/]+\/\*$/.test(origin));
    const current = activePortal();
    if (current && portals.includes(current)) $('portal-url').value = current.slice(0, -1);
    else if (portals.length === 1) $('portal-url').value = portals[0].slice(0, -1);
    await renderPermissions();
    if (!portals.length) $('portal-url').focus();
  }
  init().catch(() => status('Не удалось прочитать настройки Chrome. Закройте это окно и откройте снова.', true));
})();

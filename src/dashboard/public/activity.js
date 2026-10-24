// "Logs" tab: history of what happened on the server (dashboard changes, commands used on Discord, automatic actions
// of the bot, tickets), with filters by source, author, action and dates. Relies on common.js and app.js (state).
(() => {
  $('#view-guild .content').insertAdjacentHTML(
    'beforeend',
    `<div id="tab-logs" class="tab-panel hidden">
      <div class="card-head"><h1>📜 Logs</h1><button type="button" class="btn ghost small" id="logs-refresh">🔄 Actualiser</button></div>
      <p class="muted">L’historique des actions sur ce serveur : réglages du dashboard, commandes utilisées sur Discord, actions automatiques du bot et tickets. 90 jours gardés.</p>
      <div class="card logs-filters">
        <div class="segmented" id="logs-source">
          <button type="button" data-source="" class="on">Tous</button><button type="button" data-source="dashboard">Dashboard</button><button type="button" data-source="discord">Discord</button><button type="button" data-source="bot">Bot</button><button type="button" data-source="tickets">Tickets</button>
        </div>
        <div class="logs-grid">
          <label>Auteur<input id="logs-author" placeholder="Nom ou ID" autocomplete="off" spellcheck="false"></label>
          <label>Action<select id="logs-action"></select></label>
          <label>Du<input id="logs-from" type="date"></label>
          <label>Au<input id="logs-to" type="date"></label>
        </div>
      </div>
      <div class="card logs-list" id="logs-list"><div class="list-empty">Chargement…</div></div>
      <div class="logs-pages"><span id="logs-count" class="muted small"></span>
        <div><button type="button" class="btn ghost small" id="logs-prev">← Précédent</button><button type="button" class="btn ghost small" id="logs-next">Suivant →</button></div>
      </div>
    </div>`,
  );

  const SOURCES = { dashboard: 'Dashboard', discord: 'Discord', bot: 'Bot', tickets: 'Tickets' };
  const filters = { source: '', author: '', action: '', from: '', to: '', page: 1 };
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
  let pages = 1;

  // Day chosen in a date field → start (or end) of that day, in the browser's time zone
  const dayStart = (value) => (value ? new Date(`${value}T00:00:00`).getTime() : '');
  const dayEnd = (value) => (value ? new Date(`${value}T23:59:59.999`).getTime() : '');

  async function load() {
    const list = $('#logs-list');
    const params = new URLSearchParams({
      source: filters.source, author: filters.author, action: filters.action, from: dayStart(filters.from), to: dayEnd(filters.to), page: filters.page,
    });
    let data;
    try {
      data = await api('GET', `/api/guilds/${state.guildId}/activity?${params}`);
    } catch (error) {
      list.innerHTML = `<div class="alert">${esc(error.message)}</div>`;
      return;
    }
    pages = data.pages;
    filters.page = data.page;

    // Actions seen for this source (the chosen one stays in the menu)
    const select = $('#logs-action');
    const actions = data.actions.includes(filters.action) || !filters.action ? data.actions : [...data.actions, filters.action];
    select.innerHTML = `<option value="">Toutes</option>${actions.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}`;
    select.value = filters.action;

    const filtered = filters.author || filters.action || filters.from || filters.to;
    list.innerHTML = data.entries.length
      ? data.entries.map(row).join('')
      : `<div class="list-empty">${filtered ? 'Aucun log ne correspond aux filtres.' : 'Aucun log pour le moment.'}</div>`;
    $('#logs-count').textContent = `${data.total} entrée${data.total > 1 ? 's' : ''} · Page ${data.page} / ${data.pages}`;
    $('#logs-prev').disabled = data.page <= 1;
    $('#logs-next').disabled = data.page >= data.pages;
  }

  function row(e) {
    const details = e.details ?? '';
    const long = details.length > 110;
    return `<div class="log-row">
      <span class="log-source ${e.source}">${SOURCES[e.source]}</span>
      <div class="log-main">
        <div class="log-title" translate="no">${esc(tr(e.title))}</div>
        <div class="log-meta"><code>${esc(e.action)}</code>${details ? ` <code class="log-details${long ? ' clipped' : ''}" translate="no">${esc(details)}</code>` : ''}</div>
        ${long ? '<button type="button" class="log-more">Voir plus</button>' : ''}
      </div>
      <time class="muted small">${dateFmt.format(e.at)}</time>
    </div>`;
  }

  $('#logs-source').addEventListener('click', (e) => {
    const b = e.target.closest('[data-source]');
    if (!b) return;
    $$('#logs-source button').forEach((x) => x.classList.toggle('on', x === b));
    Object.assign(filters, { source: b.dataset.source, action: '', page: 1 });
    load();
  });
  // Author: searched a little after the last key typed
  let typing = 0;
  $('#logs-author').addEventListener('input', (e) => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      Object.assign(filters, { author: e.target.value.trim(), page: 1 });
      load();
    }, 300);
  });
  for (const [id, key] of [['logs-action', 'action'], ['logs-from', 'from'], ['logs-to', 'to']]) {
    $(`#${id}`).addEventListener('change', (e) => {
      Object.assign(filters, { [key]: e.target.value, page: 1 });
      load();
    });
  }
  $('#logs-prev').addEventListener('click', () => filters.page > 1 && (filters.page--, load()));
  $('#logs-next').addEventListener('click', () => filters.page < pages && (filters.page++, load()));
  $('#logs-refresh').addEventListener('click', load);
  $('#logs-list').addEventListener('click', (e) => {
    if (!e.target.matches('.log-more')) return;
    const details = e.target.closest('.log-main').querySelector('.log-details');
    const open = details.classList.toggle('clipped');
    e.target.textContent = open ? 'Voir plus' : 'Voir moins';
  });

  // Each server starts with its whole history, without the previous server's filters
  function open() {
    if (filters.guildId !== state.guildId) {
      Object.assign(filters, { guildId: state.guildId, source: '', author: '', action: '', from: '', to: '', page: 1 });
      $$('#logs-source button').forEach((x) => x.classList.toggle('on', !x.dataset.source));
      for (const id of ['logs-author', 'logs-from', 'logs-to']) $(`#${id}`).value = '';
    }
    load();
  }

  Object.assign(window.moduleTabs, { logs: open });
})();

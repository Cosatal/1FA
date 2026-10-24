// Tickets tab: settings, ticket types, staff panel access, Discord-like preview of the panel and of a ticket.
// Relies on app.js (state, changed…), app-ai.js (renderTicketAiUsed) and common.js.

// ---------- Tickets ----------

const T_FIELDS = ['title', 'description', 'image', 'placeholder', 'received', 'closed'];

for (const field of T_FIELDS) {
  $(`#t-${field}`).addEventListener('input', (e) => {
    state.edit.tickets[field] = e.target.value;
    changed('tickets');
  });
}

$('#t-enabled').addEventListener('change', (e) => {
  state.edit.tickets.enabled = e.target.checked;
  changed('tickets');
});
for (const [id, key] of [['t-staff', 'staffId'], ['t-panel-channel', 'panelChannelId'], ['t-category', 'categoryId'], ['t-notify', 'notifyChannelId']]) {
  $(`#${id}`).addEventListener('change', (e) => {
    state.edit.tickets[key] = e.target.value;
    changed('tickets');
  });
}

$('#t-ai-enabled').addEventListener('change', (e) => {
  state.edit.tickets.ai.enabled = e.target.checked;
  changed('tickets');
});
function renderTicketsForm() {
  const t = state.edit.tickets;
  for (const field of T_FIELDS) $(`#t-${field}`).value = t[field];
  $('#t-enabled').checked = t.enabled;
  $('#t-staff').value = t.staffId;
  $('#t-panel-channel').value = t.panelChannelId ?? '';
  $('#t-category').value = t.categoryId ?? '';
  $('#t-notify').value = t.notifyChannelId ?? '';
  $('#t-ai-enabled').checked = t.ai.enabled;
  $('#t-ai-instructions').value = t.ai.instructions;
  renderOptions();
  renderTicketAiUsed();
  renderPanelAccess();
}

// ---------- Staff panel access: allowed roles and members ----------

const memberNames = new Map(); // id → { name, tag, avatar }, filled by the searches

function renderPanelAccess() {
  const access = (state.edit.tickets.panelAccess ??= { roles: [], members: [] });
  chips($('#t-access-roles'), state.data.roles, access.roles, '@', () => changed('tickets'));
  renderAccessMembers();
  // Names of members already in the list (only their id is saved)
  const unknown = access.members.filter((id) => !memberNames.has(id));
  if (unknown.length) {
    api('GET', `/api/guilds/${state.guildId}/members?ids=${unknown.join(',')}`)
      .then(({ members }) => {
        for (const m of members) memberNames.set(m.id, m);
        renderAccessMembers();
      })
      .catch(() => {});
  }
}

function renderAccessMembers() {
  const { members } = state.edit.tickets.panelAccess;
  $('#t-access-members').innerHTML =
    members
      .map((id) => {
        const m = memberNames.get(id);
        return `<span class="chip"><span translate="no">${esc(m?.name ?? id)}</span>${m?.tag ? ` <small${m.avatar ? ' translate="no"' : ''}>${esc(m.tag)}</small>` : ''}<button type="button" data-id="${id}">✕</button></span>`;
      })
      .join('') || '<span class="muted small">Aucun membre</span>';
}

$('#t-access-members').addEventListener('click', (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  const list = state.edit.tickets.panelAccess.members;
  list.splice(list.indexOf(id), 1);
  renderAccessMembers();
  changed('tickets');
});

// Search by name, a little after the last key typed
let accessSearch = 0;
$('#t-access-search').addEventListener('input', (e) => {
  clearTimeout(accessSearch);
  const q = e.target.value.trim();
  const results = $('#t-access-results');
  if (q.length < 2) return results.classList.add('hidden');
  accessSearch = setTimeout(async () => {
    const { members } = await api('GET', `/api/guilds/${state.guildId}/members?q=${encodeURIComponent(q)}`).catch(() => ({ members: [] }));
    const already = state.edit.tickets.panelAccess.members;
    const list = members.filter((m) => !already.includes(m.id));
    results.innerHTML = list.length
      ? list
          .map((m) => `<button type="button" data-id="${m.id}" translate="no">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : ''}<span>${esc(m.name)}</span><small>${esc(m.tag)}</small></button>`)
          .join('')
      : '<span class="muted small">Aucun membre trouvé</span>';
    for (const m of list) memberNames.set(m.id, m);
    results.classList.remove('hidden');
  }, 300);
});

$('#t-access-results').addEventListener('click', (e) => {
  const id = e.target.closest('[data-id]')?.dataset.id;
  if (!id) return;
  state.edit.tickets.panelAccess.members.push(id);
  $('#t-access-search').value = '';
  $('#t-access-results').classList.add('hidden');
  renderAccessMembers();
  changed('tickets');
});

function renderOptions() {
  const opts = state.edit.tickets.options;
  const list = $('#t-options');
  list.replaceChildren();
  $('#t-count').textContent = `${opts.length}/25`;
  $('#t-add').disabled = opts.length >= 25;

  opts.forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'option';
    row.innerHTML = `
      ${dragHandle}
      <input class="emoji" maxlength="64" placeholder="🙂" title="Emoji">
      <div class="option-fields">
        <input class="label" maxlength="100" placeholder="Nom (ex : Support)">
        <input class="desc" maxlength="100" placeholder="Description (optionnel)">
      </div>
      <div class="option-actions">
        <button class="icon danger" data-act="del" title="Supprimer">✕</button>
      </div>`;
    const bind = (sel, key) => {
      const input = $(sel, row);
      input.value = o[key];
      input.addEventListener('input', () => {
        o[key] = input.value;
        changed('tickets');
      });
    };
    bind('.emoji', 'emoji');
    bind('.label', 'label');
    bind('.desc', 'description');
    row.addEventListener('click', (e) => {
      if (e.target.dataset?.act !== 'del') return;
      opts.splice(i, 1);
      renderOptions();
      changed('tickets');
    });
    list.append(row);
  });
  dragSort(list, (from, to) => {
    moveItem(opts, from, to);
    renderOptions();
    changed('tickets');
  });
}

// "Envoyer le panneau": unsaved edits are saved first (saving already posts the panel)
$('#t-send-panel').addEventListener('click', async (e) => {
  const t = state.edit.tickets;
  if (!t.panelChannelId) return toast('Choisis d’abord le salon du bouton « Ouvrir un ticket ».', 'error');
  if (!t.enabled) return toast('Active d’abord les tickets avec l’interrupteur en haut de la carte.', 'error');
  e.target.disabled = true;
  try {
    if (isDirty('tickets')) {
      if (!(await save())) return;
    }
    const { url, tickets } = await api('POST', `/api/guilds/${state.guildId}/tickets/panel`);
    state.saved.tickets = clone(tickets);
    state.edit.tickets.panelMessageId = tickets.panelMessageId;
    $('#t-panel-link').innerHTML = `<a href="${esc(url)}" target="_blank" rel="noopener">Voir le panneau sur Discord</a>`;
    toast('Panneau des tickets envoyé ✅');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    e.target.disabled = false;
  }
});

$('#t-add').addEventListener('click', () => {
  state.edit.tickets.options.push({ id: '', label: '', description: '', emoji: '' });
  renderOptions();
  changed('tickets');
  $$('#t-options .label').at(-1).focus();
});

function renderTicketPreview() {
  const t = state.edit.tickets;
  const { guild } = state.data;
  const color = PANEL_COLOR;
  const opts = t.options.filter((o) => o.label.trim());

  // Like the bot: the panel has the ticket types menu if there are any, otherwise the "Ouvrir un ticket" button
  const withAi = t.ai.enabled && aiUsable();
  const component = opts.length
    ? `<div class="dc-select"><span>${esc(t.placeholder)}</span><span>▾</span></div>
       <div class="dc-menu hidden">${opts
         .map(
           (o) => `<div class="dc-opt">
             ${o.emoji ? `<span class="dc-opt-emoji">${emojiHtml(o.emoji.trim())}</span>` : ''}
             <div><div class="dc-opt-label">${esc(o.label)}</div>${o.description ? `<div class="dc-opt-desc">${esc(o.description)}</div>` : ''}</div>
           </div>`,
         )
         .join('')}</div>`
    : '<div class="dc-buttons"><button class="dc-button">📩 Ouvrir un ticket</button></div>';

  const bot = (body) => `
    <div class="dc-msg">
      <img class="dc-avatar" src="${esc(state.me.bot.avatar)}" alt="">
      <div class="dc-body">
        <div class="dc-head"><span class="dc-name">${esc(state.me.bot.name)}</span><span class="dc-bot">BOT</span></div>
        ${body}
      </div>
    </div>`;
  // Confirmation and closing message: embed signed by the bot
  const botEmbed = (text) => `
    <div class="dc-embed" style="border-color:${color}">
      <div class="dc-author"><img src="${esc(state.me.bot.avatar)}" alt=""><span>${esc(state.me.bot.name)}</span></div>
      <div class="dc-desc">${markdown(text.trim().replaceAll('{server}', guild.name))}</div>
    </div>`;

  // What members will see: the panel, the ticket channel (opening, AI or staff), then the closing message in DMs
  const parts = [
    bot(`
      <div class="dc-embed" style="border-color:${color}">
        <div class="dc-embed-main">
          <div class="dc-embed-text">
            <div class="dc-title">${esc(t.title)}</div>
            <div class="dc-desc">${markdown(t.description)}</div>
          </div>
          ${guild.icon ? `<img class="dc-thumb" src="${esc(guild.icon)}" alt="">` : ''}
        </div>
        ${/^https?:\/\/\S+$/.test(t.image.trim()) ? `<img class="dc-image" src="${esc(t.image.trim())}" alt="" data-hide-broken>` : ''}
        <div class="dc-footer">${guild.icon ? `<img src="${esc(guild.icon)}" alt="">` : ''}<span>${esc(guild.name)}</span></div>
      </div>
      <div class="dc-component">${component}</div>`),
  ];
  // Ticket opening: with the AI, staff is only mentioned if the member asks for the team
  const aiField = withAi
    ? '<div class="dc-field"><div class="dc-field-name">🤖 Assistant IA</div>Pose ta question ici : l’assistant IA te répond tout de suite. Clique sur « Parler à l’équipe » si tu préfères un humain.</div>'
    : '';
  parts.push(bot(`<div class="dc-content"><span class="dc-mention">@Membre</span>${t.staffId && !withAi ? ' <span class="dc-mention">@Staff</span>' : ''}</div>
    <div class="dc-embed" style="border-color:${color}">
      <div class="dc-author"><img src="${esc(state.me.bot.avatar)}" alt=""><span>${esc(state.me.bot.name)}</span></div>
      <div class="dc-desc">${markdown((t.received.trim() || 'Ton ticket est ouvert : explique ta demande ici, l’équipe va te répondre.').replaceAll('{server}', guild.name))}</div>
      ${aiField}
    </div>
    <div class="dc-component"><div class="dc-buttons">${withAi ? '<button class="dc-button grey">👤 Parler à l’équipe</button>' : ''}<button class="dc-button" style="background:#da373c">🔒 Fermer le ticket</button></div></div>`));
  parts.push(
    bot(withAi
      ? '<div class="dc-content">Bonjour ! Je suis l’assistant du serveur, comment puis-je t’aider ?</div>'
      : '<div class="dc-content"><strong>(Modérateur) Pseudo:</strong> Salut, voici la réponse de l’équipe…</div>'),
  );
  if (t.closed.trim()) parts.push(bot(botEmbed(t.closed)));

  $('#t-preview').innerHTML = parts.join('<div class="dc-gap"></div>');

  // Click on the preview's dropdown: opens / closes it
  const select = $('#t-preview .dc-select');
  select?.addEventListener('click', () => {
    select.classList.toggle('open');
    $('#t-preview .dc-menu').classList.toggle('hidden');
  });
}

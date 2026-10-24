// Shared helpers ($, api, toast, esc, markdown): common.js

// One conversation per member, with all their tickets one after another.
// URLs: #<server>  ·  #<server>/u/<member>  ·  #<server>/<ticket> (link to a specific ticket: opens the member's conversation on it)
const state = { me: null, guildId: null, userId: null, tickets: null, focus: null, query: '', status: 'waiting', list: [] };

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' });

function shortDate(ms) {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? timeFmt.format(d) : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function duration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} j`;
}

function show(view) {
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
}

// ---------- Startup and navigation ----------

async function init() {
  try {
    state.me = await api('GET', '/api/staff/guilds');
  } catch {
    return show('login');
  }
  $('#user').classList.remove('hidden');
  $('#brand-logo').src = state.me.bot.avatar;
  $('#user-avatar').src = state.me.user.avatarUrl;
  $('#user-name').textContent = state.me.user.username;
  if (!state.me.guilds.length) return show('denied');

  const select = $('#guild');
  select.innerHTML = state.me.guilds.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  select.classList.toggle('hidden', state.me.guilds.length < 2);
  select.addEventListener('change', () => (location.hash = select.value));
  show('panel');
  route();
  // New tickets and messages arrive on their own
  setInterval(refresh, 5000);
}

async function route() {
  if (!state.me) return;
  const [guildId, a, b] = location.hash.slice(1).split('/');
  const known = (id) => state.me.guilds.some((g) => g.id === id);
  if (!known(guildId)) {
    // No server in the URL: the last one viewed, otherwise the first
    let last = null;
    try {
      last = localStorage.getItem('staffGuild');
    } catch {}
    location.replace(`#${known(last) ? last : state.me.guilds[0].id}`);
    return;
  }
  try {
    localStorage.setItem('staffGuild', guildId);
  } catch {}

  // Link to a specific ticket: find its member and open their conversation on that ticket
  if (a && a !== 'u') {
    try {
      const { userId } = await api('GET', `/api/staff/${guildId}/tickets/${a}`);
      state.focus = a;
      location.replace(`#${guildId}/u/${userId}`);
    } catch (error) {
      toast(error.message, 'error');
      location.replace(`#${guildId}`);
    }
    return;
  }

  if (guildId !== state.guildId) {
    state.guildId = guildId;
    $('#guild').value = guildId;
    await loadList();
  }
  openConversation(a === 'u' ? b : null);
}

window.addEventListener('hashchange', route);

async function refresh() {
  if (document.hidden || !state.guildId) return;
  await loadList(true);
  if (state.userId && state.tickets) {
    const { tickets } = await api('GET', `/api/staff/${state.guildId}/users/${state.userId}`).catch(() => ({}));
    if (tickets && state.userId === tickets[0].user.id && signature(tickets) !== signature(state.tickets)) renderConversation(tickets);
  }
}

// Changes when a message arrives or a ticket is opened / closed
const signature = (tickets) => tickets.map((t) => `${t.id}:${t.messages.length}:${t.closedAt ?? ''}`).join('|');

// ---------- List (one row per member) ----------

let searchTimer;
$('#q').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = $('#q').value;
    loadList();
  }, 200);
});

$$('#status button').forEach((b) =>
  b.addEventListener('click', () => {
    state.status = b.dataset.status;
    $$('#status button').forEach((x) => x.classList.toggle('on', x === b));
    loadList();
  }),
);

async function loadList(silent = false) {
  const params = new URLSearchParams({ q: state.query, status: state.status });
  try {
    const { total, conversations, counts } = await api('GET', `/api/staff/${state.guildId}/conversations?${params}`);
    // Auto-refresh: only redraw if something changed
    if (silent && JSON.stringify(conversations) === JSON.stringify(state.list)) return;
    state.list = conversations;
    $('#count').textContent = `${total} membre${total > 1 ? 's' : ''}${total > conversations.length ? ` (les ${conversations.length} plus récents affichés)` : ''}`;
    $('#n-waiting').textContent = counts.waiting || '';
    $('#n-open').textContent = counts.open || '';
    document.title = counts.waiting ? `(${counts.waiting}) Tickets staff` : 'Tickets staff';
  } catch (error) {
    if (silent) return;
    state.list = [];
    toast(error.message, 'error');
  }
  renderList();
}

function renderList() {
  const list = $('#list');
  if (!state.list.length) {
    const empty = state.status === 'waiting' && !state.query ? 'Aucun ticket en attente de réponse 🎉' : 'Aucun membre ne correspond.';
    list.innerHTML = `<div class="list-empty">${empty}</div>`;
    return;
  }
  list.innerHTML = state.list
    .map((c) => {
      const status = !c.open
        ? '<span class="tag">Fermé</span>'
        : c.open.lastFrom === 'staff'
        ? '<span class="tag open">● Répondu</span>'
        : '<span class="tag waiting">● En attente</span>';
      return `<a class="ticket-item${c.user.id === state.userId ? ' active' : ''}" href="#${state.guildId}/u/${c.user.id}" data-id="${c.user.id}">
        <img src="${esc(c.user.avatar)}" alt="">
        <div class="body">
          <div class="row1"><span class="name">${esc(c.user.tag)}</span><span class="date">${shortDate(c.lastAt)}</span></div>
          <div class="preview"${c.preview ? ' translate="no"' : ''}>${esc(c.preview || 'Pas de texte')}</div>
          <div class="tags">${status}${c.type ? `<span class="tag">${esc(c.type)}</span>` : ''}<span class="tag">${c.tickets} ticket${c.tickets > 1 ? 's' : ''}</span></div>
        </div>
      </a>`;
    })
    .join('');
}

// ---------- A member's conversation ----------

async function openConversation(userId) {
  state.userId = userId;
  $$('.ticket-item').forEach((el) => el.classList.toggle('active', el.dataset.id === userId));
  $('#view-panel').classList.toggle('reading', Boolean(userId));
  $('#empty').classList.toggle('hidden', Boolean(userId));
  $('#ticket').classList.toggle('hidden', !userId);
  if (!userId) {
    state.tickets = null;
    return;
  }

  let tickets;
  try {
    ({ tickets } = await api('GET', `/api/staff/${state.guildId}/users/${userId}`));
  } catch (error) {
    toast(error.message, 'error');
    location.hash = state.guildId;
    return;
  }
  if (state.userId !== userId) return; // another member was opened in the meantime
  state.tickets = null; // new conversation: scroll to the bottom (or to the requested ticket)
  renderConversation(tickets);
}

// The member's current ticket, if they have one
const openTicketOf = (tickets) => tickets.find((t) => !t.closedAt) ?? null;

function renderConversation(tickets) {
  const col = $('.ticket-col');
  const first = !state.tickets;
  const atBottom = col.scrollHeight - col.scrollTop - col.clientHeight < 80;
  state.tickets = tickets;

  const latest = tickets.at(-1);
  const user = latest.user;
  const open = openTicketOf(tickets);
  $('#t-avatar').src = user.avatar;
  $('#t-user').textContent = user.tag;
  const status = open ? '<span class="tag open">● Ticket ouvert</span>' : `Dernier ticket fermé le ${dateFmt.format(latest.closedAt)} par ${esc(latest.closedBy)}`;
  $('#t-meta').innerHTML = `<span class="id" title="Copier l’ID">${user.id}</span> · ${tickets.length} ticket${tickets.length > 1 ? 's' : ''} depuis le ${dateFmt.format(tickets[0].openedAt)}<br>${status}`;
  $('#t-meta .id').addEventListener('click', () => copy(user.id, 'ID copié'));
  $('#t-copy').onclick = () => copy(location.href, 'Lien copié');
  $('#t-close').classList.toggle('hidden', !open);
  // Open ticket: shortcut to its channel on Discord, where the staff reply
  $('#reply-hint').classList.toggle('hidden', !open?.channelId);
  if (open?.channelId) $('#t-goto').href = `https://discord.com/channels/${state.guildId}/${open.channelId}`;

  const html = [];
  tickets.forEach((t, i) => {
    html.push(
      `<div class="ticket-sep" id="tk-${t.id}">📬 Ticket ${tickets.length > 1 ? `#${i + 1} ` : ''}ouvert le ${dateFmt.format(t.openedAt)}${t.type ? ` · ${esc(t.type)}` : ''}</div>`,
    );
    let lastDay = '';
    for (const m of t.messages) {
      const day = dayFmt.format(m.at);
      // The first day is already shown by the ticket marker
      if (day !== lastDay && lastDay) html.push(`<div class="day">${day}</div>`);
      lastDay = day;
      html.push(messageHtml(t, m));
    }
    if (!t.messages.length) html.push('<div class="system">Aucun message pour l’instant.</div>');
    if (t.closedAt) html.push(`<div class="system">🔒 Fermé par ${esc(t.closedBy)} · ${dateFmt.format(t.closedAt)} · durée ${duration(t.closedAt - t.openedAt)}</div>`);
  });
  $('#t-messages').innerHTML = html.join('');

  // Link to a specific ticket: scroll to it and highlight it
  const focus = state.focus && $(`#tk-${state.focus}`);
  state.focus = null;
  if (focus) {
    focus.classList.add('focus');
    focus.scrollIntoView();
  } else if (first || atBottom) {
    // Like a messaging app: at the bottom when opened, and follow new messages if already at the bottom
    col.scrollTop = col.scrollHeight;
  }
}

function messageHtml(t, m) {
  const fileUrl = (f) => `/api/staff/${state.guildId}/tickets/${t.id}/files/${encodeURIComponent(f.file)}`;
  const files = m.files.length
    ? `<div class="files">${m.files
        .map((f) => {
          if (f.file && f.image) return `<a href="${fileUrl(f)}" target="_blank"><img src="${fileUrl(f)}" alt="${esc(f.name)}" loading="lazy"></a>`;
          if (f.file) return `<a class="file" href="${fileUrl(f)}">📎 ${esc(f.name)}</a>`;
          if (f.url) return `<a class="file expired" href="${esc(f.url)}" target="_blank" rel="noopener" title="Fichier non sauvegardé : le lien Discord a peut-être expiré">📎 ${esc(f.name)}</a>`;
          return `<span class="file expired">📎 ${esc(f.name)} (non sauvegardé)</span>`;
        })
        .join('')}</div>`
    : '';
  const avatar =
    m.from === 'member'
      ? `<img class="av" src="${esc(t.user.avatar)}" alt="">`
      : m.from === 'ai'
      ? `<img class="av" src="${esc(state.me.bot.avatar)}" alt="">`
      : '<span class="av">🛡️</span>';
  const badge = m.from === 'staff' ? '<span class="badge staff">STAFF</span>' : m.from === 'ai' ? '<span class="badge ai">IA</span>' : '';
  return `<div class="msg from-${m.from}">
    ${avatar}
    <div class="msg-body">
      <div class="msg-head"><span class="author">${esc(m.author || t.user.tag)}</span>${badge}<span class="time">${timeFmt.format(m.at)}</span></div>
      ${m.content ? `<div class="text" translate="no">${markdown(m.content)}</div>` : ''}
      ${files}
    </div>
  </div>`;
}

async function reloadConversation() {
  const { tickets } = await api('GET', `/api/staff/${state.guildId}/users/${state.userId}`);
  renderConversation(tickets);
}

$('#back').addEventListener('click', () => (location.hash = state.guildId));

$('#t-close').addEventListener('click', async () => {
  const open = state.tickets && openTicketOf(state.tickets);
  if (!open || !confirm(`Fermer le ticket de ${open.user.tag} ? Son salon sera supprimé et il recevra le message de fin en MP.`)) return;
  try {
    await api('POST', `/api/staff/${state.guildId}/tickets/${open.id}/close`);
    await reloadConversation();
    loadList();
    toast('Ticket fermé ✅');
  } catch (error) {
    toast(error.message, 'error');
  }
});

async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Copie impossible.', 'error');
  }
}

init();

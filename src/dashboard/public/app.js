// Dashboard core: startup, navigation between servers and tabs, home page, saving bar, shared form helpers.
// The tabs live in their own files (classic scripts sharing these globals, loaded after this one):
//   app-ai.js (Server AI) · app-tickets.js · app-announce.js · app-welcome.js (messages + image editor)
//   modules.js · features.js · insights.js · activity.js · captcha.js
// Shared helpers ($, api, toast, esc, markdown): common.js
const clone = (value) => structuredClone(value);
const HEX = /^#[0-9a-f]{6}$/i;

// saved = what is saved on the bot side, edit = what is being edited
const state = { me: null, guildId: null, data: null, tab: 'tickets', saved: {}, edit: {} };

// Custom emoji <:name:id> → image, otherwise the emoji as is
function emojiHtml(emoji) {
  const custom = /^<(a?):\w+:(\d+)>$/.exec(emoji);
  if (custom) return `<img src="https://cdn.discordapp.com/emojis/${custom[2]}.${custom[1] ? 'gif' : 'webp'}?size=48" alt="">`;
  return esc(emoji);
}

function show(view) {
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  if (view !== 'guild') $('#savebar').classList.add('hidden');
}

// ---------- Startup and navigation ----------
// URLs: #  (server list)  ·  #<id> (dashboard home)  ·  #<id>/tickets  ·  #<id>/welcome  ·  #<id>/announce

// Credit, bot invite link and numbers (login page, server list, menu)
function showAbout({ bot, creator, official, invite, servers, members }) {
  $$('.creator-name').forEach((el) => (el.textContent = creator));
  $$('.official-link').forEach((el) => (el.href = official));
  if (servers) {
    $('#about-servers').textContent = servers.toLocaleString('fr-FR');
    $('#about-members').textContent = members.toLocaleString('fr-FR');
    $('.landing-stats').classList.remove('hidden');
  }
  $$('.invite-link').forEach((a) => (a.href = invite));
  $$('.bot-avatar').forEach((img) => (img.src = bot.avatar));
  $$('.bot-name').forEach((el) => (el.textContent = bot.name));
}

async function init() {
  try {
    state.me = await api('GET', '/api/me');
  } catch {
    fetch('/api/about').then((r) => r.json()).then(showAbout).catch(() => {});
    return show('login');
  }
  showAbout(state.me);
  $('#user').classList.remove('hidden');
  $('#user-avatar').src = state.me.user.avatarUrl;
  $('#user-name').textContent = state.me.user.username;
  $$('.owner-only').forEach((el) => el.classList.toggle('hidden', !state.me.isOwner));
  loadImg(state.me.user.avatarUrl).then((img) => {
    editor.avatar = img;
    redraw();
  });
  route();
}

async function route() {
  if (!state.me) return;
  const [guildId, tab] = location.hash.slice(1).split('/');
  if (!guildId) {
    state.guildId = null;
    return showGuilds();
  }
  if (guildId !== state.guildId && !(await loadGuild(guildId))) return;
  selectTab(TABS.includes(tab) ? tab : 'home');
}

const TABS = [
  'tickets', 'welcome', 'announce', 'roles', 'moderation', 'botCommands', 'polls', 'giveaways', 'alerts', 'stats', 'backup', 'logs', 'captcha', 'ai',
  // Schema-based modules (features.js)
  'levels', 'commands', 'autoMessages', 'tempVoice', 'counters', 'suggestions', 'starboard', 'birthdays', 'antiRaid', 'cases', 'aiModeration', 'invites', 'aiTools', 'gameServers',
];

window.addEventListener('hashchange', route);

function showGuilds() {
  const list = $('#guild-list');
  const { guilds, invitable = [] } = state.me;
  const card = (g, href, extra, info, button) => `<a class="guild-card${extra}" href="${esc(href)}"${extra ? ' target="_blank" rel="noopener"' : ''}>
      <div class="guild-banner"${g.icon ? ` style="background-image:url('${esc(g.icon)}')"` : ''}></div>
      ${g.icon ? `<img src="${esc(g.icon)}" alt="">` : `<span class="initials">${esc(g.name.slice(0, 2).toUpperCase())}</span>`}
      <strong>${esc(g.name)}</strong>
      <span class="muted small">${info}</span>
      ${button}
    </a>`;
  list.innerHTML =
    guilds.map((g) => card(g, `#${g.id}`, '', `${g.members} membres`, '<span class="btn primary small">Configurer</span>')).join('') +
    invitable.map((g) => card(g, g.invite, ' invite', 'Bot absent', '<span class="btn ghost small">➕ Ajouter le bot</span>')).join('');
  if (!list.innerHTML) list.innerHTML = `<div class="empty">Aucun serveur : il faut que tu aies la permission <b>Gérer le serveur</b>.</div>`;
  show('guilds');
}

async function loadGuild(id) {
  try {
    state.data = await api('GET', `/api/guilds/${id}`);
  } catch (error) {
    toast(error.message, 'error');
    location.hash = '';
    return false;
  }
  state.guildId = id;
  aiDraft = null; // the "IA du serveur" tab starts again from this server's settings
  aiModels.clear();
  editor.selected = 'background';
  editor.bannerSrc = null;
  state.saved = { tickets: clone(state.data.tickets), welcome: clone(state.data.welcome) };
  state.edit = clone(state.saved);

  const { guild } = state.data;
  $('#guild-name').textContent = guild.name;
  $('#guild-icon').src = guild.icon || state.me.bot.avatar;
  $('#bot-lang').value = state.data.language;
  renderGuildMenu();
  fillSelects();
  renderTicketsForm();
  renderWelcomeForm();
  announce = newAnnounce();
  $('#a-last').textContent = '';
  renderAnnounceForm();
  renderHome();
  // Links to the staff panel open this server's tickets (otherwise the panel picks the first server)
  $$('a[href^="/staff"]').forEach((a) => (a.href = `/staff#${id}`));
  updateSavebar();
  show('guild');
  return true;
}

function selectTab(tab) {
  state.tab = tab;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== `tab-${tab}`));
  if (tab === 'welcome') redraw();
  if (tab === 'home') renderHome();
  // Module tabs (modules.js): loaded every time they are opened
  window.moduleTabs?.[tab]?.();
  if (tab === 'announce') loadScheduled();
  if (tab === 'ai') renderAiTab();
}

const tabHash = (tab) => `${state.guildId}${tab === 'home' ? '' : `/${tab}`}`;
$$('.tab[data-tab]').forEach((t) => t.addEventListener('click', () => (location.hash = tabHash(t.dataset.tab))));

// ---------- Server switcher (sidebar) ----------

function renderGuildMenu() {
  $('#guild-menu').innerHTML =
    state.me.guilds
      .map(
        (g) => `<a href="#${g.id}" class="${g.id === state.guildId ? 'current' : ''}">
          ${g.icon ? `<img src="${esc(g.icon)}" alt="">` : `<span class="initials">${esc(g.name.slice(0, 2).toUpperCase())}</span>`}
          <span>${esc(g.name)}</span>
        </a>`,
      )
      .join('') + '<a href="#" class="all">← Tous mes serveurs</a>';
}

$('#guild-switch').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#guild-menu').classList.toggle('hidden');
});
document.addEventListener('click', () => $('#guild-menu').classList.add('hidden'));

// ---------- Dashboard home ----------

// toggle: config that can be switched on in one click from the home · badge: small status shown on the card · on: blue dot in the sidebar
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
// Schema-based module: active (switch) or with items (list)
const feature = (name, word) => ({
  badge: (s, f) => (f[name]?.count ? plural(f[name].count, word) : f[name]?.enabled ? 'Actif' : ''),
  on: (s, f) => Boolean(f[name]?.enabled || f[name]?.count),
});
const MODULES = [
  { group: 'Essentiels', tab: 'welcome', icon: '👋', title: 'Bienvenue', toggle: 'welcome', text: 'Accueille chaque nouveau membre avec un message et une image personnalisée à son nom.' },
  { group: 'Essentiels', tab: 'levels', icon: '🏆', title: 'Niveaux', text: 'XP en discutant et en vocal, rôles débloqués aux paliers, carte /rank et classement public.', ...feature('levels') },
  {
    group: 'Essentiels', tab: 'roles', icon: '🎭', title: 'Rôles-réactions', text: 'Les membres se donnent eux-mêmes des rôles avec des boutons, un menu ou des réactions.',
    badge: (s) => s.rolePanels && plural(s.rolePanels, 'panneau'), on: (s) => s.rolePanels > 0,
  },
  {
    group: 'Essentiels', tab: 'moderation', icon: '🛡️', title: 'Modération', text: 'Filtres automatiques (mots, liens, spam…), avertissements et logs des sanctions.',
    badge: (s) => s.moderationFilters && `${plural(s.moderationFilters, 'filtre')} actif${s.moderationFilters > 1 ? 's' : ''}`, on: (s) => s.moderationFilters > 0,
  },
  {
    group: 'Sécurité', tab: 'captcha', icon: '🔐', title: 'Captcha', text: 'Vérifie que chaque nouveau membre est humain avant de lui ouvrir le serveur : 4 niveaux de sécurité.',
    badge: () => state.data.captcha.enabled && 'Actif', on: () => state.data.captcha.enabled,
  },
  { group: 'Sécurité', tab: 'antiRaid', icon: '🚨', title: 'Anti-raid', text: 'Verrouille le serveur si trop de comptes arrivent d’un coup, et bloque les comptes trop récents.', ...feature('antiRaid') },
  { group: 'Sécurité', tab: 'cases', icon: '⚖️', title: 'Cas et appels', text: 'Chaque sanction a un numéro, et le membre sanctionné peut faire appel avec un formulaire.', ...feature('cases') },
  { group: 'Sécurité', tab: 'aiModeration', icon: '🤖', title: 'Modération IA', text: 'L’IA repère les messages toxiques et les signale au staff, même sans mot interdit.', ...feature('aiModeration') },
  { group: 'Sécurité', tab: 'invites', icon: '📨', title: 'Invitations', text: 'Découvre qui a invité chaque nouveau membre et affiche le classement des inviteurs.', ...feature('invites') },
  { group: 'Gestion du serveur', tab: 'tickets', icon: '🎫', title: 'Tickets', toggle: 'tickets', text: 'Un bouton « Ouvrir un ticket » crée un salon privé entre le membre et le staff, avec l’IA en option.' },
  { group: 'Gestion du serveur', tab: 'commands', icon: '⌨️', title: 'Commandes perso', text: 'Crée tes propres commandes slash avec leur réponse, en texte ou en embed.', ...feature('commands', 'commande') },
  { group: 'Gestion du serveur', tab: 'autoMessages', icon: '⏰', title: 'Messages auto', text: 'Un message posté à intervalle régulier : rappel des règles, liens utiles…', ...feature('autoMessages', 'message') },
  { group: 'Gestion du serveur', tab: 'announce', icon: '📢', title: 'Annonces', text: 'Rédige une annonce (embed ou Components V2) et publie-la dans le salon de ton choix.', on: () => true },
  { group: 'Gestion du serveur', tab: 'polls', icon: '📊', title: 'Sondages', text: 'Des sondages natifs Discord, avec vote dans le message et résultats en direct.', on: () => true },
  { group: 'Communauté', tab: 'suggestions', icon: '💡', title: 'Suggestions', text: 'Les membres proposent des idées, tout le monde vote, le staff accepte ou refuse.', ...feature('suggestions') },
  { group: 'Communauté', tab: 'starboard', icon: '⭐', title: 'Starboard', text: 'Les messages qui reçoivent le plus d’étoiles sont mis en avant dans un salon.', ...feature('starboard') },
  { group: 'Communauté', tab: 'birthdays', icon: '🎂', title: 'Anniversaires', text: 'Le bot souhaite les anniversaires et donne un rôle pour la journée.', ...feature('birthdays') },
  {
    group: 'Communauté', tab: 'giveaways', icon: '🎉', title: 'Giveaways', text: 'Fais gagner des lots : participation en un clic, tirage au sort automatique.',
    badge: (s) => s.giveawaysActive && `${plural(s.giveawaysActive, 'giveaway')} en cours`, on: (s) => s.giveawaysActive > 0,
  },
  { group: 'Utilitaires', tab: 'tempVoice', icon: '🔊', title: 'Vocaux temporaires', text: 'Chacun crée son propre salon vocal en un clic, supprimé quand il se vide.', ...feature('tempVoice') },
  { group: 'Utilitaires', tab: 'aiTools', icon: '✨', title: 'Outils IA', text: '/resume, /traduire, traduction par drapeau et création d’images avec /image.', ...feature('aiTools') },
  { group: 'Utilitaires', tab: 'gameServers', icon: '🎮', title: 'Serveurs de jeu', text: 'Statut en direct, alerte de crash, redémarrages annoncés et commandes RCON (/serveur).', ...feature('gameServers') },
  { group: 'Utilitaires', tab: 'counters', icon: '📈', title: 'Compteurs', text: 'Des salons qui affichent le nombre de membres, de boosts… mis à jour tout seuls.', ...feature('counters', 'compteur') },
  {
    group: 'Utilitaires', tab: 'alerts', icon: '🔔', title: 'Alertes réseaux', text: 'Twitch, YouTube, Reddit, X, Instagram, TikTok : préviens ton serveur à chaque nouveauté.',
    badge: (s) => s.alerts && plural(s.alerts, 'alerte'), on: (s) => s.alerts > 0,
  },
];

function renderHome() {
  if (!state.data) return;
  const { guild, stats, features = {} } = state.data;
  $('#home-title').textContent = `Salut ${state.me.user.username} 👋`;
  $('#stat-members').textContent = guild.members.toLocaleString('fr-FR');
  $('#stat-open').textContent = stats.openTickets;
  $('#stat-waiting').textContent = stats.waitingTickets;

  const card = (m) => {
    const action = m.toggle
      ? state.saved[m.toggle].enabled
        ? `<button class="mod-btn on" data-toggle="${m.toggle}" title="Cliquer pour désactiver">✓ Actif</button>`
        : `<button class="mod-btn off" data-toggle="${m.toggle}">+ Activer</button>`
      : `<button class="mod-btn open">Configurer</button>`;
    const badge = m.badge?.(stats, features);
    return `<div class="module" data-open="${m.tab}">
      <div class="mod-top"><div class="mod-icon">${m.icon}</div>${badge ? `<span class="mod-badge blue">${badge}</span>` : ''}</div>
      <h3>${m.title}</h3>
      <p>${m.text}</p>
      <div class="mod-foot">${action}<span class="mod-link">Ouvrir →</span></div>
    </div>`;
  };
  const groups = [...new Set(MODULES.map((m) => m.group))];
  const tools = `<a class="module" href="/staff" target="_blank">
      <div class="mod-top"><div class="mod-icon">🗂️</div>${stats.waitingTickets ? `<span class="mod-badge">${stats.waitingTickets} en attente</span>` : ''}</div>
      <h3>Panel des tickets</h3>
      <p>Lis les tickets, réponds aux membres et retrouve l’historique de chacun. Accessible à tout le staff.</p>
      <div class="mod-foot"><span class="mod-btn open">Ouvrir ↗</span></div>
    </a>`;
  $('#home-sections').innerHTML =
    groups
      .map((g) => `<h2 class="section-title">${g}</h2><div class="module-grid">${MODULES.filter((m) => m.group === g).map(card).join('')}${g === 'Gestion du serveur' ? tools : ''}</div>`)
      .join('');

  // Blue dots in the sidebar: module active or in use
  for (const m of MODULES) {
    const on = m.toggle ? state.saved[m.toggle].enabled : Boolean(m.on?.(stats, features));
    $(`.tab[data-tab="${m.tab}"] .dot`)?.classList.toggle('on', on);
  }
}

// Module tabs update the dashboard home numbers after an action
window.setModuleStat = (key, value) => {
  if (!state.data) return;
  state.data.stats[key] = value;
  renderHome();
};

$('#home-sections').addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) return toggleModule(toggle.dataset.toggle, toggle);
  const card = e.target.closest('[data-open]');
  if (card) location.hash = tabHash(card.dataset.open);
});

// Turns a module on / off directly from the dashboard home (without touching unsaved edits)
async function toggleModule(key, button) {
  button.disabled = true;
  try {
    const result = await api('PUT', `/api/guilds/${state.guildId}/${key}`, { ...state.saved[key], enabled: !state.saved[key].enabled });
    state.saved[key] = clone(result[key]);
    state.edit[key].enabled = result[key].enabled;
    if (key === 'tickets') $('#t-enabled').checked = result[key].enabled;
    else $('#w-enabled').checked = result[key].enabled;
    toast(`${key === 'tickets' ? 'Tickets' : 'Bienvenue'} ${result[key].enabled ? 'activé' : 'désactivé'} ✅`);
  } catch (error) {
    toast(error.message, 'error');
  }
  renderHome();
  updateSavebar();
}

// Bot language on this server: everything it sends on Discord
$('#bot-lang').addEventListener('change', async (e) => {
  try {
    const { language } = await api('PUT', `/api/guilds/${state.guildId}/language`, { lang: e.target.value });
    state.data.language = language;
    redraw(); // default texts of the welcome image follow the server language
    toast('Langue du bot enregistrée ✅');
  } catch (error) {
    e.target.value = state.data.language;
    toast(error.message, 'error');
  }
});

$('#logout').addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' });
  location.hash = '';
  location.reload();
});

// ---------- Saving ----------

const isDirty = (tab) => JSON.stringify(state.edit[tab]) !== JSON.stringify(state.saved[tab]);

function updateSavebar() {
  $('#savebar').classList.toggle('hidden', !state.guildId || (!isDirty('tickets') && !isDirty('welcome')));
}

function changed(tab) {
  updateSavebar();
  if (tab === 'tickets') return renderTicketPreview();
  redraw(); // redraws the image, then the message preview
}

async function save() {
  const button = $('#save');
  button.disabled = true;
  let ok = true;
  for (const tab of ['tickets', 'welcome']) {
    if (!isDirty(tab)) continue;
    try {
      const result = await api('PUT', `/api/guilds/${state.guildId}/${tab}`, state.edit[tab]);
      state.saved[tab] = clone(result[tab]);
      state.edit[tab] = clone(result[tab]);
    } catch (error) {
      toast(`${tab === 'tickets' ? 'Tickets' : 'Bienvenue'} : ${error.message}`, 'error');
      ok = false;
    }
  }
  button.disabled = false;
  if (ok) {
    toast('Modifications enregistrées ✅');
    renderTicketsForm();
    renderWelcomeForm();
  }
  renderHome();
  updateSavebar();
  return ok;
}

$('#save').addEventListener('click', save);
$('#reset').addEventListener('click', () => {
  state.edit = clone(state.saved);
  renderTicketsForm();
  renderWelcomeForm();
  updateSavebar();
});

window.addEventListener('beforeunload', (e) => {
  if (state.guildId && (isDirty('tickets') || isDirty('welcome'))) e.preventDefault();
});

// Color: the picker and the text field stay in sync
function bindColor(id, onChange) {
  const text = $(`#${id}`);
  const picker = $(`#${id}-picker`);
  picker.addEventListener('input', () => {
    text.value = picker.value;
    onChange(picker.value);
  });
  text.addEventListener('input', () => {
    const value = text.value.trim();
    if (HEX.test(value)) picker.value = value;
    onChange(value);
  });
}

function setColor(id, value) {
  $(`#${id}`).value = value;
  if (HEX.test(value)) $(`#${id}-picker`).value = value;
}

function fillSelects() {
  const { channels, roles } = state.data;
  const options = (list, empty, prefix = '') =>
    `<option value="">${esc(empty)}</option>` + list.map((c) => `<option value="${c.id}">${prefix}${esc(c.name)}</option>`).join('');

  $('#t-staff').innerHTML = options(roles, 'Aucun', '@');
  $('#t-panel-channel').innerHTML = options(channels, 'Choisis un salon…', '# ');
  $('#t-category').innerHTML = options(state.data.categories, 'Celle du salon du bouton', '📁 ');
  $('#t-notify').innerHTML = options(channels, 'Aucun (pas de notification)', '# ');
  $('#w-channel').innerHTML = options(channels, 'Salon système du serveur', '# ');
  $('#w-bye-channel').innerHTML = options(channels, 'Choisis un salon…', '# ');
  $('#a-channel').innerHTML = options(channels, 'Choisis un salon…', '# ');
  $('#a-mention').innerHTML =
    '<option value="">Personne</option><option value="everyone">@everyone</option><option value="here">@here</option>' +
    roles.map((r) => `<option value="${r.id}">@${esc(r.name)}</option>`).join('');
}

// Started once every script of the page is loaded (the tabs are in app-*.js)
document.addEventListener('DOMContentLoaded', init);

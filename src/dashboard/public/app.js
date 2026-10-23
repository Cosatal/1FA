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
  'levels', 'commands', 'autoMessages', 'tempVoice', 'counters', 'suggestions', 'starboard', 'birthdays', 'antiRaid', 'invites', 'aiTools', 'gameServers',
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
// ---------- Server AI ("IA du serveur" tab) ----------
// A single setting for the whole bot: the AI, the model and the key (or the local AI). The ticket assistant and the AI tools use it

const aiProvider = (id) => state.data.aiProviders.find((p) => p.id === id);
// An AI has a key on this server: the ticket assistant and the AI tools work
const aiUsable = () => state.data.aiProviders.some((p) => p.ready);
let aiDraft = null; // { provider, model } being edited

// Models offered by the chosen AI, loaded once per provider
const aiModels = new Map();
async function loadAiModels(provider) {
  if (!aiProvider(provider)?.ready) return;
  if (!aiModels.has(provider)) {
    aiModels.set(provider, api('GET', `/api/guilds/${state.guildId}/ai-models?provider=${provider}`).then((d) => d.models).catch(() => []));
  }
  const models = await aiModels.get(provider);
  if (aiDraft?.provider === provider) $('#ai-models').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
}

function renderAiTab() {
  aiDraft ??= { ...state.data.ai };
  $('#ai-provider').innerHTML = state.data.aiProviders
    .map((p) => `<option value="${p.id}">${esc(p.name)}${p.own ? (p.local ? ' — ton IA' : ' — ta clé') : p.ready ? ' — clé du bot' : p.local ? ' — non branchée' : ' — clé manquante'}</option>`)
    .join('');
  $('#ai-provider').value = aiDraft.provider;
  $('#ai-model').value = aiDraft.model ?? '';
  renderAiDirty();
  renderAiStatus();
}
const renderAiDirty = () => $('#ai-dirty').classList.toggle('hidden', JSON.stringify(aiDraft) === JSON.stringify(state.data.ai));

function renderAiStatus() {
  const { provider } = aiDraft;
  const p = aiProvider(provider);
  // Server's own key: shown masked with "Supprimer", otherwise a field to paste it
  $('#ai-key').innerHTML = !p
    ? ''
    : p.local
      ? localAiForm(p)
    : p.own
      ? `<div class="ai-key-row"><span>🔑 Clé ${esc(p.name)} du serveur : <b>•••• ${esc(p.ending)}</b></span>
          <button class="btn danger small" type="button" data-ai-key="delete">Supprimer</button></div>`
      : `<div class="ai-key-head"><strong>🔑 Clé ${esc(p.name)} de ton serveur</strong><a href="${esc(p.site)}" target="_blank" rel="noopener" class="small">Obtenir une clé ↗</a></div>
        <div class="ai-key-row">
          <input type="password" id="ai-key-input" autocomplete="new-password" spellcheck="false" placeholder="Colle ta clé API">
          <button class="btn primary small" type="button" data-ai-key="save">Enregistrer</button>
        </div>
        <small>${p.shared ? 'Facultatif : sans clé, le serveur utilise celle du bot.' : 'Les réponses de l’IA sont facturées sur ce compte. La clé est testée puis gardée secrète (personne ne peut la revoir).'}</small>`;
  // The chosen AI has no key: the bot uses another one that has a key, otherwise the AI features don't work
  const fallback = !p?.ready && state.data.aiProviders.find((x) => x.ready);
  const status = p?.ready
    ? ''
    : `⚠️ ${p?.local ? 'L’IA locale n’est pas branchée' : `Pas de clé ${p?.name ?? ''}`} : ${fallback ? `en attendant, le bot utilise ${fallback.name}.` : 'en attendant, l’assistant des tickets et les outils IA ne fonctionnent pas.'}`;
  $('#ai-status').textContent = status;
  $('#ai-status').classList.toggle('hidden', !status);
  $('#ai-model').placeholder = provider === 'anthropic' ? 'Par défaut (recommandé)' : 'Automatique, ou choisis un modèle…';
  $('#ai-models').innerHTML = '';
  loadAiModels(provider);
}

$('#ai-provider').addEventListener('change', (e) => {
  aiDraft = { provider: e.target.value, model: '' };
  $('#ai-model').value = '';
  renderAiDirty();
  renderAiStatus();
});
$('#ai-model').addEventListener('input', (e) => {
  aiDraft.model = e.target.value.trim();
  renderAiDirty();
});
$('#ai-save').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const { ai } = await api('PUT', `/api/guilds/${state.guildId}/ai`, aiDraft);
    state.data.ai = ai;
    aiDraft = { ...ai };
    toast('IA du serveur enregistrée ✅');
    renderAiTab();
    renderTicketAiUsed();
  } catch (error) {
    toast(error.message, 'error');
  }
  e.target.disabled = false;
});

// Server's local AI: it runs on their side (their PC), the bot hosted on a VPS reaches it through an https tunnel
function localAiForm(p) {
  if (p.own) {
    return `<div class="ai-key-row"><span>🖥️ IA locale du serveur : <b translate="no">${esc(p.url)}</b>${p.hasKey ? ' (avec clé)' : ''}</span>
      <button class="btn danger small" type="button" data-ai-key="delete">Supprimer</button></div>`;
  }
  return `<div class="ai-key-head"><strong>🖥️ Brancher ton IA locale</strong><a href="${esc(p.site)}" target="_blank" rel="noopener" class="small">Installer Ollama ↗</a></div>
    <small class="ai-local-help">Gratuit et privé : l’IA tourne sur <b>ton</b> PC, et le bot la joint par Internet grâce à un tunnel gratuit.<br>
      1. Installe Ollama, puis lance <code>ollama pull llama3.2</code><br>
      2. Ouvre un tunnel : <code>cloudflared tunnel --url http://localhost:11434 --http-host-header localhost:11434</code>
      (ou <code>ngrok http 11434 --host-header=rewrite</code>)<br>
      3. Colle ci-dessous l’adresse https donnée, suivie de <code>/v1</code><br>
      Ton PC doit rester allumé pour que l’IA réponde. Garde cette adresse pour toi : elle donne accès à ton IA.</small>
    <div class="ai-key-row">
      <input id="ai-local-url" spellcheck="false" placeholder="https://xxxx.trycloudflare.com/v1">
      <input type="password" id="ai-key-input" autocomplete="new-password" spellcheck="false" placeholder="Clé (facultative)">
      <button class="btn primary small" type="button" data-ai-key="save">Tester et enregistrer</button>
    </div>
    ${p.shared ? '<small>Facultatif : sans adresse, le serveur utilise l’IA locale du bot.</small>' : ''}`;
}

// Save (after a test on the bot side) or delete the key of the chosen AI
$('#ai-key').addEventListener('click', async (e) => {
  const action = e.target.dataset.aiKey;
  if (!action) return;
  const { provider } = aiDraft;
  const local = aiProvider(provider)?.local;
  const url = `/api/guilds/${state.guildId}/ai-keys/${provider}`;
  const key = $('#ai-key-input')?.value.trim() ?? '';
  const localUrl = $('#ai-local-url')?.value.trim() ?? '';
  if (action === 'save' && local && !localUrl) return toast('Colle d’abord l’adresse https de ton IA locale.', 'error');
  if (action === 'save' && !local && !key) return toast('Colle d’abord la clé.', 'error');
  if (action === 'delete' && !confirm(local ? 'Débrancher l’IA locale de ce serveur ?' : 'Supprimer la clé IA de ce serveur ?')) return;
  e.target.disabled = true;
  if (action === 'save' && local) e.target.textContent = 'Test en cours…';
  try {
    const result = action === 'save' ? await api('PUT', url, local ? { url: localUrl, key } : { key }) : await api('DELETE', url);
    state.data.aiProviders = result.providers;
    aiModels.delete(provider);
    // Key added for another AI than the saved one: it becomes the server's AI
    if (action === 'save' && state.data.ai.provider !== provider) {
      const { ai } = await api('PUT', `/api/guilds/${state.guildId}/ai`, aiDraft);
      state.data.ai = ai;
      aiDraft = { ...ai };
    }
    toast(
      action === 'save'
        ? `${local ? 'IA locale branchée' : 'Clé enregistrée'} ✅ (${result.models} modèles disponibles)`
        : local ? 'IA locale débranchée' : 'Clé supprimée',
    );
    renderAiTab();
    renderTicketAiUsed();
  } catch (error) {
    toast(error.message, 'error');
    e.target.disabled = false;
  }
});

// Tickets tab: the AI that will answer (set in "IA du serveur")
function renderTicketAiUsed() {
  const choice = aiProvider(state.data.ai.provider);
  const used = choice?.ready ? choice : state.data.aiProviders.find((p) => p.ready);
  const model = used && used === choice && state.data.ai.model ? ` · ${esc(state.data.ai.model)}` : '';
  $('#t-ai-used').innerHTML = used
    ? `<div class="ai-used-row"><span>🧠 IA utilisée : <b>${esc(used.name)}</b>${model}</span><a class="btn ghost small" href="#${state.guildId}/ai">Changer l’IA ou la clé</a></div>`
    : `<div class="alert">⚠️ Aucune IA n’a de clé sur ce serveur : l’assistant ne répondra pas. <a href="#${state.guildId}/ai">Ajouter une clé dans 🧠 IA du serveur</a></div>`;
  renderTicketPreview();
}

$('#t-ai-instructions').addEventListener('input', (e) => {
  state.edit.tickets.ai.instructions = e.target.value;
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
        ${/^https?:\/\/\S+$/.test(t.image.trim()) ? `<img class="dc-image" src="${esc(t.image.trim())}" alt="" onerror="this.remove()">` : ''}
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

// ---------- Announcements ----------
// Draft kept while the page is open (nothing is saved on the bot side, the announcement is just sent)

const newAnnounce = () => ({
  channelId: '',
  mention: '',
  content: '',
  embed: { enabled: true, title: '', description: '', color: '#9b4dff', image: '', footer: true },
  mode: 'embed',
  v2: { accent: true, color: '#9b4dff', blocks: [newBlock('text')] },
});

function newBlock(type) {
  return {
    text: { type, content: '## Titre de l’annonce\nÉcris ton message ici.' },
    section: { type, content: '', thumbnail: '' },
    gallery: { type, urls: [] },
    separator: { type, divider: true, spacing: 'small' },
    buttons: { type, buttons: [{ label: '', url: '' }] },
  }[type];
}
let announce = newAnnounce();

const BLOCK_NAMES = { text: '📝 Texte', section: '🖼️ Texte avec miniature', gallery: '🗂️ Images', separator: '➖ Séparateur', buttons: '🔗 Boutons-liens' };
const MODE_HINTS = {
  embed: 'Le format habituel : un cadre avec titre, description, une image et un pied de page.',
  v2: 'Le nouveau format de Discord : empile librement textes, images, séparateurs et boutons dans un cadre. Titres avec # / ## / ###, petit texte gris avec -#.',
};

for (const field of ['channelId', 'mention', 'content']) {
  const id = { channelId: 'a-channel', mention: 'a-mention', content: 'a-content' }[field];
  $(`#${id}`).addEventListener('input', (e) => {
    announce[field] = e.target.value;
    renderAnnouncePreview();
  });
}
for (const field of ['title', 'description', 'image']) {
  $(`#a-${field}`).addEventListener('input', (e) => {
    announce.embed[field] = e.target.value;
    renderAnnouncePreview();
  });
}
bindColor('a-color', (value) => {
  announce.embed.color = value;
  renderAnnouncePreview();
});
$('#a-embed').addEventListener('change', (e) => {
  announce.embed.enabled = e.target.checked;
  renderAnnounceForm();
});
$('#a-footer').addEventListener('change', (e) => {
  announce.embed.footer = e.target.checked;
  renderAnnouncePreview();
});

$$('#a-mode button').forEach((b) =>
  b.addEventListener('click', () => {
    announce.mode = b.dataset.mode;
    renderAnnounceForm();
  }),
);
$('#a-v2-accent').addEventListener('change', (e) => {
  announce.v2.accent = e.target.checked;
  renderAnnouncePreview();
});
bindColor('a-v2-color', (value) => {
  announce.v2.color = value;
  renderAnnouncePreview();
});
$$('[data-add]').forEach((b) =>
  b.addEventListener('click', () => {
    announce.v2.blocks.push(newBlock(b.dataset.add));
    renderBlocks();
    renderAnnouncePreview();
    $$('#a-blocks .block').at(-1).querySelector('input, textarea')?.focus();
  }),
);

// ---------- Components V2 blocks ----------

function renderBlocks() {
  const blocks = announce.v2.blocks;
  const list = $('#a-blocks');
  list.replaceChildren();
  $('#a-v2-count').textContent = `${blocks.length}/30`;
  $$('[data-add]').forEach((b) => (b.disabled = blocks.length >= 30));

  blocks.forEach((block, i) => {
    const row = document.createElement('div');
    row.className = 'block';
    row.innerHTML = `
      <div class="block-head">
        <strong>${dragHandle}${BLOCK_NAMES[block.type]}</strong>
        <button class="icon danger" data-act="del" title="Supprimer">✕</button>
      </div>
      <div class="block-fields"></div>`;
    $('.block-head', row).addEventListener('click', (e) => {
      if (e.target.dataset?.act !== 'del') return;
      blocks.splice(i, 1);
      renderBlocks();
      renderAnnouncePreview();
    });
    $('.block-fields', row).append(...blockFields(block));
    list.append(row);
  });
  dragSort(list, (from, to) => {
    moveItem(blocks, from, to);
    renderBlocks();
    renderAnnouncePreview();
  });
}

function field(tag, value, onInput, { ai, ...attrs } = {}) {
  const el = Object.assign(document.createElement(tag), attrs, { value });
  if (ai) el.dataset.ai = ai; // "✨ Rédiger" button (ai-write.js)
  el.addEventListener('input', () => {
    onInput(el.value);
    renderAnnouncePreview();
  });
  return el;
}

function blockFields(block) {
  if (block.type === 'text') {
    return [field('textarea', block.content, (v) => (block.content = v), { rows: 5, maxLength: 4000, placeholder: '## Titre\nTon texte…', ai: 'announce' })];
  }
  if (block.type === 'section') {
    return [
      field('textarea', block.content, (v) => (block.content = v), { rows: 4, maxLength: 4000, placeholder: 'Texte affiché à gauche de la miniature' }),
      field('input', block.thumbnail, (v) => (block.thumbnail = v), { placeholder: 'Lien de la miniature (https://…)' }),
    ];
  }
  if (block.type === 'gallery') {
    const hint = Object.assign(document.createElement('small'), { textContent: 'Un lien https par ligne, 10 images maximum.' });
    return [
      field('textarea', block.urls.join('\n'), (v) => (block.urls = v.split('\n').map((u) => u.trim()).filter(Boolean)), {
        rows: 3,
        placeholder: 'https://…\nhttps://…',
      }),
      hint,
    ];
  }
  if (block.type === 'separator') {
    const divider = document.createElement('label');
    divider.className = 'check';
    const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: block.divider });
    input.addEventListener('change', () => {
      block.divider = input.checked;
      renderAnnouncePreview();
    });
    divider.append(input, 'Afficher une ligne');
    const spacing = document.createElement('div');
    spacing.className = 'segmented';
    for (const [value, text] of [['small', 'Petit espace'], ['large', 'Grand espace']]) {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
      b.classList.toggle('on', block.spacing === value);
      b.addEventListener('click', () => {
        block.spacing = value;
        $$('button', spacing).forEach((x) => x.classList.toggle('on', x === b));
        renderAnnouncePreview();
      });
      spacing.append(b);
    }
    return [divider, spacing];
  }
  // Link buttons
  const rows = block.buttons.map((btn, j) => {
    const row = document.createElement('div');
    row.className = 'link-row';
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'icon danger', textContent: '✕', title: 'Supprimer' });
    del.disabled = block.buttons.length === 1;
    del.addEventListener('click', () => {
      block.buttons.splice(j, 1);
      renderBlocks();
      renderAnnouncePreview();
    });
    row.append(
      field('input', btn.label, (v) => (btn.label = v), { maxLength: 80, placeholder: 'Nom du bouton' }),
      field('input', btn.url, (v) => (btn.url = v), { placeholder: 'https://…' }),
      del,
    );
    return row;
  });
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small', textContent: '+ Bouton' });
  add.disabled = block.buttons.length >= 5;
  add.addEventListener('click', () => {
    block.buttons.push({ label: '', url: '' });
    renderBlocks();
    renderAnnouncePreview();
  });
  return [...rows, add];
}

// Components V2 markdown: on top of the rest, # / ## / ### headings and -# small text
function markdownV2(text) {
  return text
    .split('\n')
    .map((line) => {
      const heading = /^(#{1,3}) (.+)$/.exec(line);
      if (heading) return `<div class="dc-h${heading[1].length}">${markdown(heading[2])}</div>`;
      if (line.startsWith('-# ')) return `<div class="dc-subtext">${markdown(line.slice(3))}</div>`;
      return `${markdown(line)}<br>`;
    })
    .join('');
}

function v2BlockHtml(block) {
  if (block.type === 'text') return `<div class="dc-v2-text">${markdownV2(block.content)}</div>`;
  if (block.type === 'section') {
    const thumb = /^https?:\/\/\S+$/.test(block.thumbnail.trim()) ? `<img class="dc-thumb" src="${esc(block.thumbnail.trim())}" alt="" onerror="this.remove()">` : '';
    return `<div class="dc-section"><div class="dc-v2-text">${markdownV2(block.content)}</div>${thumb}</div>`;
  }
  if (block.type === 'gallery') {
    const urls = block.urls.filter((u) => /^https?:\/\/\S+$/.test(u)).slice(0, 10);
    if (!urls.length) return '';
    return `<div class="dc-gallery n${Math.min(urls.length, 4)}">${urls.map((u) => `<img src="${esc(u)}" alt="" onerror="this.remove()">`).join('')}</div>`;
  }
  if (block.type === 'separator') return `<div class="dc-sep ${block.spacing}${block.divider ? ' line' : ''}"></div>`;
  return `<div class="dc-links">${block.buttons
    .filter((b) => b.label.trim())
    .map((b) => `<span class="dc-link-btn">${esc(b.label)} <span>↗</span></span>`)
    .join('')}</div>`;
}

function renderAnnounceForm() {
  const a = announce;
  $$('#a-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === a.mode));
  $('#a-mode-hint').textContent = MODE_HINTS[a.mode];
  $('#a-embed-card').classList.toggle('hidden', a.mode !== 'embed');
  $('#a-v2-card').classList.toggle('hidden', a.mode !== 'v2');
  $('#a-v2-accent').checked = a.v2.accent;
  setColor('a-v2-color', a.v2.color);
  renderBlocks();
  $('#a-channel').value = a.channelId;
  $('#a-mention').value = a.mention;
  $('#a-content').value = a.content;
  $('#a-embed').checked = a.embed.enabled;
  $('#a-embed-fields').classList.toggle('hidden', !a.embed.enabled);
  for (const field of ['title', 'description', 'image']) $(`#a-${field}`).value = a.embed[field];
  setColor('a-color', a.embed.color);
  $('#a-footer').checked = a.embed.footer;
  renderAnnouncePreview();
}

function mentionLabel(mention) {
  if (mention === 'everyone' || mention === 'here') return `@${mention}`;
  const role = state.data.roles.find((r) => r.id === mention);
  return role ? `@${role.name}` : '';
}

function renderAnnouncePreview() {
  const a = announce;
  const e = a.embed;
  const { guild } = state.data;
  const color = HEX.test(e.color) ? e.color : '#9b4dff';
  const image = e.image.trim();
  const ping = a.mention ? `<span class="dc-mention">${esc(mentionLabel(a.mention))}</span><br>` : '';
  const content = a.content.trim() ? markdown(a.content.trim()) : '';
  const text = ping || content ? `<div class="dc-content">${ping}${content}</div>` : '';
  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const v2Color = HEX.test(a.v2.color) ? a.v2.color : '#9b4dff';
  const container = `<div class="dc-container"${a.v2.accent ? ` style="border-left: 4px solid ${v2Color}"` : ''}>${a.v2.blocks.map(v2BlockHtml).join('')}</div>`;

  const embed = a.mode === 'v2'
    ? container
    : e.enabled
    ? `<div class="dc-embed" style="border-color:${color}">
        <div class="dc-embed-text">
          ${e.title.trim() ? `<div class="dc-title">${esc(e.title)}</div>` : ''}
          ${e.description.trim() ? `<div class="dc-desc">${markdown(e.description)}</div>` : ''}
        </div>
        ${/^https?:\/\/\S+$/.test(image) ? `<img class="dc-image" src="${esc(image)}" alt="" onerror="this.remove()">` : ''}
        ${e.footer ? `<div class="dc-footer">${guild.icon ? `<img src="${esc(guild.icon)}" alt="">` : ''}<span>${esc(guild.name)} • Aujourd’hui à ${now}</span></div>` : ''}
      </div>`
    : '';

  $('#a-preview').innerHTML = `
    <div class="dc-msg">
      <img class="dc-avatar" src="${esc(state.me.bot.avatar)}" alt="">
      <div class="dc-body">
        <div class="dc-head"><span class="dc-name">${esc(state.me.bot.name)}</span><span class="dc-bot">BOT</span></div>
        ${text}${embed}
      </div>
    </div>`;
}

$('#a-send').addEventListener('click', async () => {
  const a = announce;
  if (!a.channelId) return toast('Choisis le salon où poster l’annonce.', 'error');
  const channel = state.data.channels.find((c) => c.id === a.channelId);
  const ping = a.mention ? ` en mentionnant ${mentionLabel(a.mention)}` : '';
  if (!confirm(`Publier l’annonce dans #${channel?.name}${ping} ?`)) return;

  const button = $('#a-send');
  button.disabled = true;
  try {
    const body = { ...a, v2: { color: a.v2.accent ? a.v2.color : '', blocks: a.v2.blocks } };
    const { url } = await api('POST', `/api/guilds/${state.guildId}/announce`, body);
    $('#a-last').innerHTML = `Dernière annonce : <a href="${esc(url)}" target="_blank" rel="noopener">voir sur Discord</a>`;
    toast('Annonce publiée ✅');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

// ---------- Scheduled announcements ----------
// The same announcement, sent by the bot at the chosen date (time of the computer of the person scheduling it)

async function loadScheduled() {
  const box = $('#a-scheduled');
  const { list } = await api('GET', `/api/guilds/${state.guildId}/announce/scheduled`).catch(() => ({ list: [] }));
  const date = (at) => new Date(at).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  box.innerHTML = list.length
    ? list
        .map(
          (s) => `<div class="item"><div class="item-icon">📅</div>
            <div class="item-main"><strong>${esc(date(s.at))} · #${esc(s.channel)}</strong><span class="muted small">${esc(s.preview)} · par ${esc(s.by)}</span></div>
            <button class="btn small danger" data-unschedule="${esc(s.id)}">Annuler</button></div>`,
        )
        .join('')
    : '<div class="list-empty">Aucune annonce programmée.</div>';
}

$('#a-schedule').addEventListener('click', async () => {
  const a = announce;
  if (!a.channelId) return toast('Choisis le salon où poster l’annonce.', 'error');
  const at = new Date($('#a-when').value).getTime();
  if (!at) return toast('Choisis la date et l’heure d’envoi.', 'error');
  const button = $('#a-schedule');
  button.disabled = true;
  try {
    const body = { ...a, v2: { color: a.v2.accent ? a.v2.color : '', blocks: a.v2.blocks }, scheduleAt: at };
    await api('POST', `/api/guilds/${state.guildId}/announce`, body);
    toast('Annonce programmée ✅');
    $('#a-when').value = '';
    loadScheduled();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('#a-scheduled').addEventListener('click', async (e) => {
  const id = e.target.dataset.unschedule;
  if (!id || !confirm('Annuler cette annonce programmée ?')) return;
  try {
    await api('DELETE', `/api/guilds/${state.guildId}/announce/scheduled/${id}`);
    toast('Annonce annulée');
    loadScheduled();
  } catch (error) {
    toast(error.message, 'error');
  }
});

// ---------- Welcome: visual editor ----------
// Drawing uses card-renderer.js, the same code as the bot: the preview is the final image.

const R = window.CardRenderer;
const canvas = $('#w-canvas');
const ctx = canvas.getContext('2d');
const editor = { selected: 'background', boxes: {}, banner: null, bannerSrc: null, bannerVersion: Date.now(), avatar: null, drag: null, snapX: false, snapY: false, updaters: [] };
const loadedFonts = new Set();

const welcome = () => state.edit.welcome;
const findEl = (id) => welcome().elements.find((e) => e.id === id);
const newId = () => `t${Date.now().toString(36)}`;

// Images from another site (the Discord avatar) are asked with CORS: otherwise the browser "taints" the canvas they are
// drawn on, and the preview can no longer be exported from it
function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    if (/^https?:/.test(src) && new URL(src).origin !== location.origin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadBanner() {
  // Custom banner, otherwise none: plain background (the old "Par défaut" setting means "Aucune")
  const src = welcome().banner === 'custom' ? `/api/guilds/${state.guildId}/welcome/banner?v=${editor.bannerVersion}` : '';
  if (src === editor.bannerSrc) return;
  editor.bannerSrc = src;
  const img = src ? await loadImg(src) : null;
  if (editor.bannerSrc !== src) return; // another banner was chosen in the meantime
  editor.banner = img;
  redraw();
}

function loadFonts() {
  return Promise.all(
    state.data.fonts
      .filter((f) => !loadedFonts.has(f.family))
      .map(async (f) => {
        try {
          const face = await new FontFace(f.family, `url(/fonts/${encodeURIComponent(f.file)})`).load();
          document.fonts.add(face);
          loadedFonts.add(f.family);
          redraw();
        } catch {
          // font the browser can't read: the preview will use the fallback font
        }
      }),
  );
}

// ---------- Drawing ----------

// Like the bot: the default texts of the image (unchanged) are drawn in the server language
const defaultsToEnglish = I18N.createTranslator(I18N_EN.DEFAULTS, { whole: true });
const cardTranslate = () => (state.data.language === 'en' ? defaultsToEnglish : (text) => text);

let frame = 0;
function redraw() {
  if (!frame) frame = requestAnimationFrame(draw);
}

function draw() {
  frame = 0;
  if (!state.data) return;
  const { user } = state.me;
  const vars = { user: user.username, name: user.username, server: state.data.guild.name, count: state.data.guild.members };
  ctx.clearRect(0, 0, R.W, R.H);
  editor.boxes = R.drawCard(ctx, welcome(), { banner: editor.banner, avatar: editor.avatar }, vars, cardTranslate());
  scheduleWelcomePreview(); // the message preview follows the image (banner loaded, element moved…)

  ctx.save();
  ctx.setLineDash([14, 10]);
  if (editor.drag) {
    // Snapping guides at the center
    ctx.strokeStyle = '#ff4dd2';
    ctx.lineWidth = 3;
    if (editor.snapX) ctx.strokeRect(R.W / 2, -10, 0, R.H + 20);
    if (editor.snapY) ctx.strokeRect(-10, R.H / 2, R.W + 20, 0);
  }
  const box = editor.boxes[editor.selected];
  if (box) {
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(box.x - 10, box.y - 10, box.w + 20, box.h + 20);
    ctx.strokeStyle = PANEL_COLOR;
    ctx.lineDashOffset = 12;
    ctx.strokeRect(box.x - 10, box.y - 10, box.w + 20, box.h + 20);
  }
  ctx.restore();
}

// ---------- Mouse selection and dragging ----------

const toCanvas = (e) => {
  const rect = canvas.getBoundingClientRect();
  return { x: ((e.clientX - rect.left) * R.W) / rect.width, y: ((e.clientY - rect.top) * R.H) / rect.height };
};

// The topmost element under the cursor
function hit(p) {
  const els = welcome().elements;
  for (let i = els.length - 1; i >= 0; i--) {
    const b = editor.boxes[els[i].id];
    if (b && p.x >= b.x - 10 && p.x <= b.x + b.w + 10 && p.y >= b.y - 10 && p.y <= b.y + b.h + 10) return els[i];
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.focus();
  const p = toCanvas(e);
  const el = hit(p);
  select(el ? el.id : 'background');
  if (el) {
    editor.drag = { el, dx: p.x - el.x, dy: p.y - el.y, moved: false };
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e);
  if (!editor.drag) {
    canvas.style.cursor = hit(p) ? 'move' : 'default';
    return;
  }
  const { el } = editor.drag;
  let x = Math.round(p.x - editor.drag.dx);
  let y = Math.round(p.y - editor.drag.dy);
  // Snap to center (horizontal: centered avatar and texts)
  editor.snapX = (el.type === 'avatar' || el.align === 'center') && Math.abs(x - R.W / 2) < 15;
  editor.snapY = Math.abs(y - R.H / 2) < 15;
  if (editor.snapX) x = R.W / 2;
  if (editor.snapY) y = R.H / 2;
  el.x = x;
  el.y = y;
  editor.drag.moved = true;
  syncProps();
  redraw();
});

function endDrag() {
  if (!editor.drag) return;
  const { moved } = editor.drag;
  editor.drag = null;
  editor.snapX = editor.snapY = false;
  if (moved) changed('welcome');
  else redraw();
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('keydown', (e) => {
  const el = findEl(editor.selected);
  if (!el) return;
  if (e.key === 'Delete' && el.type === 'text') {
    e.preventDefault();
    return removeElement(el);
  }
  const step = e.shiftKey ? 10 : 1;
  const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!move) return;
  e.preventDefault();
  el.x += move[0];
  el.y += move[1];
  syncProps();
  changed('welcome');
});

function select(id) {
  editor.selected = id;
  renderLayers();
  renderProps();
  redraw();
}

// ---------- Layers ----------

const layerName = (el) => (el.type === 'avatar' ? '🖼️ Avatar' : `🔤 ${el.text.trim() || 'Texte vide'}`);

function renderLayers() {
  const list = $('#w-layers');
  list.replaceChildren();
  const els = welcome().elements;
  // Top layer first, like in a drawing app
  [...els].reverse().forEach((el) => {
    const row = document.createElement('div');
    row.className = `layer${el.id === editor.selected ? ' active' : ''}${el.visible ? '' : ' hidden-layer'}`;
    row.innerHTML = `
      ${dragHandle}
      <button class="icon" data-act="eye" title="Afficher / masquer">${el.visible ? '👁' : '◌'}</button>
      <span class="name"></span>`;
    $('.name', row).textContent = layerName(el);
    row.addEventListener('click', (e) => {
      if (e.target.closest('.drag-handle')) return;
      if (e.target.dataset?.act !== 'eye') return select(el.id);
      el.visible = !el.visible;
      renderLayers();
      changed('welcome');
    });
    list.append(row);
  });
  // The list is shown in reverse (top layer first)
  dragSort(list, (from, to) => {
    moveItem(els, els.length - 1 - from, els.length - 1 - to);
    renderLayers();
    changed('welcome');
  });

  const bg = document.createElement('div');
  bg.className = `layer${editor.selected === 'background' ? ' active' : ''}`;
  bg.innerHTML = '<span class="icon">🎨</span><span class="name">Fond et dégradé</span>';
  bg.addEventListener('click', () => select('background'));
  list.append(bg);
}

// ---------- Settings of the selected element ----------

function wrap(label, control, wide = false) {
  const el = document.createElement('label');
  if (wide) el.className = 'wide';
  el.append(label, control);
  return el;
}

// Slider + number field. percent: the value goes from 0 to 1 but is shown from 0 to 100
function slider(target, key, label, min, max, { percent = false, wide = false } = {}) {
  const box = document.createElement('div');
  box.className = 'slider';
  const range = Object.assign(document.createElement('input'), { type: 'range', min, max, step: 1 });
  const number = Object.assign(document.createElement('input'), { type: 'number', min, max, step: 1 });
  const sync = () => (range.value = number.value = Math.round(percent ? target[key] * 100 : target[key]));
  const set = (raw) => {
    const value = Math.min(max, Math.max(min, Number(raw)));
    if (!Number.isFinite(value)) return;
    target[key] = percent ? value / 100 : value;
    changed('welcome');
  };
  range.addEventListener('input', () => {
    number.value = range.value;
    set(range.value);
  });
  number.addEventListener('input', () => {
    if (number.value === '') return;
    range.value = number.value;
    set(number.value);
  });
  number.addEventListener('blur', sync);
  sync();
  editor.updaters.push(sync);
  box.append(range, number);
  return wrap(label, box, wide);
}

function colorField(target, key, label) {
  const box = document.createElement('span');
  box.className = 'color';
  const picker = Object.assign(document.createElement('input'), { type: 'color', value: target[key] });
  const text = Object.assign(document.createElement('input'), { value: target[key], maxLength: 7 });
  picker.addEventListener('input', () => {
    text.value = target[key] = picker.value;
    changed('welcome');
  });
  text.addEventListener('input', () => {
    const value = text.value.trim();
    if (!HEX.test(value)) return;
    picker.value = target[key] = value;
    changed('welcome');
  });
  box.append(picker, text);
  return wrap(label, box);
}

function segmented(target, key, label, options, onChange) {
  const box = document.createElement('div');
  box.className = 'segmented';
  for (const [value, text, disabled] of options) {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: text, disabled: Boolean(disabled) });
    button.classList.toggle('on', target[key] === value);
    button.addEventListener('click', (e) => {
      e.preventDefault();
      target[key] = value;
      $$('button', box).forEach((b) => b.classList.toggle('on', b === button));
      onChange?.();
      changed('welcome');
    });
    box.append(button);
  }
  return wrap(label, box);
}

function checkbox(target, key, label, onChange) {
  const el = document.createElement('label');
  el.className = 'check';
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: target[key] });
  input.addEventListener('change', () => {
    target[key] = input.checked;
    onChange?.();
    changed('welcome');
  });
  el.append(input, label);
  return el;
}

function button(text, onClick, className = 'btn ghost small') {
  const b = Object.assign(document.createElement('button'), { type: 'button', className, textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

function section(title, ...nodes) {
  const head = document.createElement('div');
  head.className = 'head';
  head.innerHTML = `<h3>${esc(title)}</h3>`;
  const fields = document.createElement('div');
  fields.className = 'fields';
  fields.append(...nodes.filter(Boolean));
  return [head, fields];
}

function syncProps() {
  editor.updaters.forEach((fn) => fn());
}

function renderProps() {
  const box = $('#w-props');
  box.replaceChildren();
  editor.updaters = [];
  const el = findEl(editor.selected);
  if (!el) return renderBackgroundProps(box);

  const position = [slider(el, 'x', 'Position X', 0, R.W), slider(el, 'y', 'Position Y', 0, R.H), slider(el, 'opacity', 'Opacité (%)', 0, 100, { percent: true })];
  const actions = document.createElement('div');
  actions.className = 'actions wide';
  actions.append(
    button('Centrer horizontalement', () => {
      el.x = R.W / 2;
      if (el.type === 'text') el.align = 'center';
      renderProps();
      changed('welcome');
    }),
    button('Centrer verticalement', () => {
      el.y = R.H / 2;
      syncProps();
      changed('welcome');
    }),
  );

  if (el.type === 'avatar') {
    box.append(
      ...section(
        'Avatar du membre',
        slider(el, 'size', 'Taille', 20, 1000),
        segmented(el, 'shape', 'Forme', [['circle', 'Rond'], ['rounded', 'Arrondi'], ['square', 'Carré']]),
        slider(el, 'borderWidth', 'Épaisseur de la bordure', 0, 80),
        colorField(el, 'borderColor', 'Couleur de la bordure'),
        slider(el, 'glow', 'Lueur', 0, 150),
        ...position,
        actions,
      ),
    );
    return;
  }

  // Text
  const textInput = Object.assign(document.createElement('input'), { value: el.text, maxLength: 200 });
  textInput.addEventListener('input', () => {
    el.text = textInput.value;
    renderLayers();
    changed('welcome');
  });
  const hint = Object.assign(document.createElement('small'), { textContent: 'Variables : {name} (pseudo) · {server} · {count} (nombre de membres)' });
  const textField = wrap('Texte', textInput, true);
  textField.append(hint);

  const fontSelect = document.createElement('select');
  const custom = state.data.fonts.map((f) => f.family);
  fontSelect.innerHTML =
    (custom.length ? `<optgroup label="Polices importées">${custom.map((f) => `<option>${esc(f)}</option>`).join('')}</optgroup>` : '') +
    `<optgroup label="Polices de base">${R.SYSTEM_FONTS.map((f) => `<option>${esc(f)}</option>`).join('')}</optgroup>`;
  fontSelect.value = el.font;
  fontSelect.addEventListener('change', () => {
    el.font = fontSelect.value;
    changed('welcome');
  });
  const fontField = wrap('Police', fontSelect);
  const fontActions = document.createElement('div');
  fontActions.className = 'actions';
  fontActions.append(button('Importer une police (.ttf / .otf)', () => importFont(el)));
  if (custom.includes(el.font)) fontActions.append(button('Supprimer cette police', () => deleteFont(el.font), 'btn danger small'));
  fontField.append(fontActions);

  actions.append(
    button('Dupliquer', () => {
      const copy = { ...clone(el), id: newId(), x: el.x + 30, y: el.y + 30 };
      welcome().elements.splice(welcome().elements.indexOf(el) + 1, 0, copy);
      select(copy.id);
      changed('welcome');
    }),
    button('Supprimer', () => removeElement(el), 'btn danger small'),
  );

  box.append(
    ...section(
      'Texte',
      textField,
      fontField,
      segmented(el, 'weight', 'Épaisseur', [[400, 'Normal'], [700, 'Gras'], [900, 'Très gras']]),
      slider(el, 'size', 'Taille', 8, 400),
      colorField(el, 'color', 'Couleur'),
      segmented(el, 'align', 'Alignement', [['left', 'Gauche'], ['center', 'Centre'], ['right', 'Droite']]),
      checkbox(el, 'uppercase', 'Tout en majuscules'),
      slider(el, 'shadow', 'Ombre', 0, 60),
      slider(el, 'strokeWidth', 'Contour', 0, 20),
      colorField(el, 'strokeColor', 'Couleur du contour'),
      slider(el, 'maxWidth', 'Largeur max (0 = illimitée)', 0, R.W),
      ...position,
      actions,
    ),
  );
}

function renderBackgroundProps(box) {
  const w = welcome();
  const bannerActions = document.createElement('div');
  bannerActions.className = 'actions wide';
  const upload = Object.assign(document.createElement('label'), { className: 'btn ghost small file', textContent: 'Envoyer une bannière' });
  const file = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  file.addEventListener('change', () => uploadBanner(file));
  upload.append(file);
  bannerActions.append(upload);
  if (state.data.customBanner) bannerActions.append(button('Supprimer la bannière perso', deleteBanner, 'btn danger small'));
  const bannerHint = Object.assign(document.createElement('small'), {
    className: 'wide',
    textContent: 'Idéal : 1920 × 1080 px (16:9), sinon l’image est recadrée pour remplir la carte. PNG, JPG ou WEBP, 8 Mo max.',
  });

  const o = w.overlay;
  box.append(
    ...section(
      'Bannière',
      segmented(w, 'banner', 'Image de fond', [['none', 'Aucune'], ['custom', 'Perso', !state.data.customBanner]], loadBanner),
      colorField(w, 'background', 'Couleur de fond (sans bannière)'),
      bannerActions,
      bannerHint,
    ),
    ...section(
      'Dégradé',
      checkbox(o, 'enabled', 'Afficher un dégradé par-dessus la bannière'),
      segmented(o, 'mode', 'Direction', [['bottom', 'Bas'], ['top', 'Haut'], ['left', 'Gauche'], ['right', 'Droite'], ['full', 'Plein']]),
      colorField(o, 'color', 'Couleur'),
      slider(o, 'opacity', 'Opacité (%)', 0, 100, { percent: true }),
      slider(o, 'start', 'Début du dégradé (%)', 0, 100, { percent: true }),
    ),
  );
}

function removeElement(el) {
  const els = welcome().elements;
  els.splice(els.indexOf(el), 1);
  select('background');
  changed('welcome');
}

$('#w-add-text').addEventListener('click', () => {
  const el = R.newText(newId(), { text: 'Nouveau texte', x: R.W / 2, y: R.H / 2, size: 72, color: '#ffffff', align: 'center', maxWidth: 0 });
  welcome().elements.push(el);
  select(el.id);
  changed('welcome');
});

$('#w-reset-layout').addEventListener('click', () => {
  if (!confirm('Remettre l’image par défaut ? Les textes, positions, couleurs et le dégradé seront réinitialisés (non enregistré tant que tu ne cliques pas sur Enregistrer).')) return;
  Object.assign(welcome(), clone(R.DEFAULT_LAYOUT));
  select('background');
  changed('welcome');
});

$('#w-render').addEventListener('click', async () => {
  const b = $('#w-render');
  b.disabled = true;
  try {
    const res = await fetch(`/api/guilds/${state.guildId}/welcome/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(welcome()),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Rendu impossible.');
    const img = $('#w-final-img');
    if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(await res.blob());
    $('#w-final').showModal();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    b.disabled = false;
  }
});
$('#w-final-close').addEventListener('click', () => $('#w-final').close());

// ---------- Banner and fonts ----------

function setBannerMode(mode) {
  state.saved.welcome.banner = mode;
  welcome().banner = mode;
  editor.bannerVersion = Date.now();
  loadBanner();
  renderProps();
  updateSavebar();
}

async function uploadBanner(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast('Image trop lourde (8 Mo max).', 'error');
  try {
    await api('POST', `/api/guilds/${state.guildId}/welcome/banner`, { image: await readAsDataUrl(file) });
    state.data.customBanner = true;
    setBannerMode('custom');
    toast('Bannière envoyée ✅');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function deleteBanner() {
  if (!confirm('Supprimer la bannière perso ?')) return;
  try {
    await api('DELETE', `/api/guilds/${state.guildId}/welcome/banner`);
    state.data.customBanner = false;
    setBannerMode('none');
    toast('Bannière perso supprimée');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function importFont(el) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.ttf,.otf' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Police trop lourde (5 Mo max).', 'error');
    try {
      const { font } = await api('POST', `/api/guilds/${state.guildId}/fonts`, {
        name: file.name.replace(/\.[^.]+$/, ''),
        data: await readAsDataUrl(file),
      });
      if (!state.data.fonts.some((f) => f.family === font.family)) state.data.fonts.push(font);
      await loadFonts();
      el.font = font.family;
      renderProps();
      changed('welcome');
      toast(`Police « ${font.family} » importée ✅`);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  input.click();
}

async function deleteFont(family) {
  if (!confirm(`Supprimer la police « ${family} » ? Les textes qui l’utilisent passeront en Impact.`)) return;
  try {
    await api('DELETE', `/api/guilds/${state.guildId}/fonts/${encodeURIComponent(family)}`);
    state.data.fonts = state.data.fonts.filter((f) => f.family !== family);
    for (const config of [welcome(), state.saved.welcome]) {
      for (const e of config.elements) if (e.font === family) e.font = 'Impact';
    }
    renderProps();
    changed('welcome');
  } catch (error) {
    toast(error.message, 'error');
  }
}

// ---------- Message settings (welcome, DM, roles, goodbye) ----------

// Form field ↔ config setting ("object.key" path)
const W_FIELDS = [
  ['w-enabled', 'enabled', 'checked'],
  ['w-channel', 'channelId'],
  ['w-message', 'message'],
  ['w-card', 'card', 'checked'],
  ['w-embed-author', 'embed.author'],
  ['w-embed-title', 'embed.title'],
  ['w-embed-description', 'embed.description'],
  ['w-embed-footer', 'embed.footer'],
  ['w-embed-thumbnail', 'embed.thumbnail', 'checked'],
  ['w-dm-on', 'dm.enabled', 'checked'],
  ['w-dm', 'dm.message'],
  ['w-autoroles-on', 'autoroles.enabled', 'checked'],
  ['w-bye-on', 'goodbye.enabled', 'checked'],
  ['w-bye-channel', 'goodbye.channelId'],
  ['w-bye', 'goodbye.message'],
];
const wPath = (path) => {
  const keys = path.split('.');
  const last = keys.pop();
  return [keys.reduce((obj, k) => obj[k], welcome()), last];
};
for (const [id, path, prop = 'value'] of W_FIELDS) {
  $(`#${id}`).addEventListener(prop === 'checked' ? 'change' : 'input', (e) => {
    const [obj, key] = wPath(path);
    obj[key] = e.target[prop];
    renderWelcomeSections();
    changed('welcome');
  });
}
bindColor('w-embed-color', (value) => {
  if (!HEX.test(value)) return;
  welcome().embed.color = value;
  changed('welcome');
});
$$('#w-format button').forEach((b) =>
  b.addEventListener('click', () => {
    welcome().format = b.dataset.format;
    renderWelcomeSections();
    changed('welcome');
  }),
);

// Cards collapsed when their switch is off, embed and image editors depending on the choices
function renderWelcomeSections() {
  const w = welcome();
  $$('#tab-welcome .w-section').forEach((s) => s.classList.toggle('hidden', !$(`#${s.dataset.for}`).checked));
  $$('#w-format button').forEach((b) => b.classList.toggle('on', b.dataset.format === w.format));
  $('#w-embed').classList.toggle('hidden', w.format !== 'embed');
  $('#w-message-label').textContent = {
    embed: 'Texte au-dessus de l’embed (optionnel)',
    canvas: 'Texte au-dessus de l’image (optionnel)',
  }[w.format] ?? 'Texte du message';
  $('#w-format-help').textContent = {
    embed: 'Un cadre avec titre, description et champs, l’image de bienvenue à l’intérieur.',
    canvas: 'Seulement l’image de bienvenue, dessinée au nom du membre (éditeur ci-dessous).',
  }[w.format] ?? 'Un message texte, avec l’image de bienvenue en dessous si elle est cochée.';
  // Canvas = the image itself: always attached
  $('#w-card-row').classList.toggle('hidden', w.format === 'canvas');
  $('#w-image-card').classList.toggle('hidden', !w.card && w.format !== 'canvas');
}

// Additional embed fields
function renderEmbedFields() {
  const fields = welcome().embed.fields;
  const list = $('#w-embed-fields');
  list.replaceChildren();
  fields.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'option';
    row.innerHTML = `<div class="option-fields"><input class="label" maxlength="256" placeholder="Nom du champ"><input class="desc" maxlength="1024" placeholder="Valeur du champ"></div>
      <label class="check inline-check" title="Afficher sur la même ligne que le champ voisin"><input type="checkbox"> Côte à côte</label>
      <div class="option-actions"><button class="icon danger" type="button" title="Supprimer">✕</button></div>`;
    const [name, value] = $$('input:not([type])', row);
    const inline = $('input[type=checkbox]', row);
    name.value = f.name;
    value.value = f.value;
    inline.checked = f.inline;
    name.addEventListener('input', () => ((f.name = name.value), changed('welcome')));
    value.addEventListener('input', () => ((f.value = value.value), changed('welcome')));
    inline.addEventListener('change', () => ((f.inline = inline.checked), changed('welcome')));
    $('.icon', row).addEventListener('click', () => {
      fields.splice(i, 1);
      renderEmbedFields();
      changed('welcome');
    });
    list.append(row);
  });
  $('#w-embed-add-field').disabled = fields.length >= 10;
}
$('#w-embed-add-field').addEventListener('click', () => {
  welcome().embed.fields.push({ name: '', value: '', inline: false });
  renderEmbedFields();
  changed('welcome');
});

// ---------- Welcome message preview ----------

let previewTimer = 0;
function scheduleWelcomePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderWelcomePreview, 150);
}

// The welcome image, small, drawn separately (without the editor's selection frames).
// An image that the browser refuses to export (avatar without permission from its site) is left out instead of breaking the preview
function smallCard() {
  const { user } = state.me;
  const draw = (assets) => {
    const small = Object.assign(document.createElement('canvas'), { width: 480, height: 270 });
    const c = small.getContext('2d');
    c.scale(480 / R.W, 270 / R.H);
    R.drawCard(c, welcome(), assets, { user: user.username, name: user.username, server: state.data.guild.name, count: state.data.guild.members }, cardTranslate());
    return small.toDataURL('image/jpeg', 0.8);
  };
  try {
    return draw({ banner: editor.banner, avatar: editor.avatar });
  } catch {
    return draw({ banner: editor.banner, avatar: null });
  }
}

function renderWelcomePreview() {
  if (!state.data || state.tab !== 'welcome') return;
  const w = welcome();
  const { user } = state.me;
  const { guild } = state.data;
  // {user} becomes a blue mention in the preview
  const fill = (text) =>
    markdown(R.fillVars(text, { user: '\u0001', name: user.username, server: guild.name, count: guild.members })).replaceAll('\u0001', `<span class="dc-mention">@${esc(user.username)}</span>`);
  const card = w.card || w.format === 'canvas' ? smallCard() : null;
  const image = card ? `<img class="dc-image" src="${card}" alt="">` : '';
  let body = w.message.trim() ? `<div class="dc-content">${fill(w.message)}</div>` : '';

  if (w.format === 'embed') {
    const e = w.embed;
    body += `<div class="dc-embed" style="border-color:${HEX.test(e.color) ? e.color : '#2f7ff0'}">
      <div class="dc-embed-main">
        <div class="dc-embed-text">
          ${e.author ? `<div class="dc-author">${guild.icon ? `<img src="${esc(guild.icon)}" alt="">` : ''}<span>${fill(e.author)}</span></div>` : ''}
          ${e.title ? `<div class="dc-title">${fill(e.title)}</div>` : ''}
          ${e.description ? `<div class="dc-desc">${fill(e.description)}</div>` : ''}
          ${e.fields.length ? `<div class="dc-fields">${e.fields.map((f) => `<div class="dc-field${f.inline ? ' inline' : ''}"><div class="dc-field-name">${fill(f.name)}</div>${fill(f.value)}</div>`).join('')}</div>` : ''}
        </div>
        ${e.thumbnail ? `<img class="dc-thumb" src="${esc(user.avatarUrl)}" alt="">` : ''}
      </div>
      ${image}
      ${e.footer ? `<div class="dc-footer"><span>${fill(e.footer)}</span></div>` : ''}
    </div>`;
  } else {
    body += image;
  }
  $('#w-preview').innerHTML = `<div class="dc-msg">
    <img class="dc-avatar" src="${esc(state.me.bot.avatar)}" alt="">
    <div class="dc-body"><div class="dc-head"><span class="dc-name">${esc(state.me.bot.name)}</span><span class="dc-bot">BOT</span></div>${body || '<div class="muted small">Message vide</div>'}</div>
  </div>`;
}

function renderWelcomeForm() {
  const w = welcome();
  for (const [id, path, prop = 'value'] of W_FIELDS) {
    const [obj, key] = wPath(path);
    $(`#${id}`)[prop] = obj[key];
  }
  setColor('w-embed-color', w.embed.color);
  chips($('#w-autoroles'), state.data.roles.filter((r) => r.editable), w.autoroles.roles, '@', () => changed('welcome'));
  renderEmbedFields();
  renderWelcomeSections();
  scheduleWelcomePreview();
  $('#w-intent').classList.toggle('hidden', state.data.welcomeIntent);
  if (editor.selected !== 'background' && !findEl(editor.selected)) editor.selected = 'background';
  loadBanner();
  loadFonts();
  renderLayers();
  renderProps();
  redraw();
}

init();

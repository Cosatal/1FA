const { ChannelType, SnowflakeUtil } = require('discord.js');
const { createStore } = require('./store');

// Module settings described by a schema: the dashboard builds its forms from the schema,
// and the bot validates what it receives with that same schema. data/features.json = { <guildId>: { levels: {…}, starboard: {…}… } }
//
// Field types: bool, int, text, textarea, color, select, channel (text), voice, category, role, roles, channels,
// list (list of objects, fields in "fields"), hidden (kept on the bot side, never editable from the dashboard), section (heading).
// when: [key, value] = field shown only if the other field has that value. assignable: a role the bot can give.

const VARS_MEMBER = 'Variables : {user} (mention) · {name} (pseudo) · {server}';

const FEATURES = {
  levels: {
    icon: '🏆', title: 'Niveaux', toggle: true,
    intro: 'Les membres gagnent de l’XP en discutant (et en vocal), montent de niveau et débloquent des rôles. /rank affiche leur carte, /leaderboard le classement.',
    fields: [
      { type: 'section', label: 'Gain d’XP' },
      { key: 'xpMin', type: 'int', label: 'XP minimum par message', min: 1, max: 100, default: 15 },
      { key: 'xpMax', type: 'int', label: 'XP maximum par message', min: 1, max: 200, default: 25 },
      { key: 'cooldown', type: 'int', label: 'Délai entre deux gains (secondes)', min: 0, max: 3600, default: 60, help: 'Évite que le spam rapporte de l’XP.' },
      { key: 'voiceXp', type: 'int', label: 'XP par minute en vocal (0 = désactivé)', min: 0, max: 100, default: 10, help: 'Seulement à partir de 2 personnes dans le salon, et pas en sourdine.' },
      { type: 'section', label: 'Passage de niveau' },
      { key: 'announce', type: 'select', label: 'Annonce', default: 'channel', options: [['channel', 'Dans le salon du message'], ['custom', 'Dans un salon précis'], ['dm', 'En message privé'], ['off', 'Pas d’annonce']] },
      { key: 'announceChannel', type: 'channel', label: 'Salon des annonces', when: ['announce', 'custom'] },
      { key: 'message', type: 'textarea', label: 'Message', max: 1000, default: '🎉 GG {user}, tu passes au **niveau {level}** !', help: `${VARS_MEMBER} · {level}`, ai: 'levelup' },
      { key: 'rewards', type: 'list', label: 'Récompenses', itemLabel: 'Récompense', max: 50, add: '+ Ajouter une récompense', fields: [
        { key: 'level', type: 'int', label: 'Niveau', min: 1, max: 1000, default: 5 },
        { key: 'roleId', type: 'role', label: 'Rôle donné', assignable: true, required: true },
      ] },
      { key: 'stackRewards', type: 'bool', label: 'Garder les anciennes récompenses', default: true, help: 'Désactivé : seul le rôle du plus haut palier atteint est gardé.' },
      { type: 'section', label: 'Exceptions et classement' },
      { key: 'noXpRoles', type: 'roles', label: 'Rôles qui ne gagnent pas d’XP' },
      { key: 'noXpChannels', type: 'channels', label: 'Salons sans XP' },
      { key: 'publicLeaderboard', type: 'bool', label: 'Classement public sur le site', default: true },
    ],
  },

  commands: {
    icon: '⌨️', title: 'Commandes personnalisées',
    intro: 'Crée tes propres commandes slash : elles apparaissent dans le menu « / » de ton serveur quelques secondes après l’enregistrement.',
    fields: [
      { key: 'list', type: 'list', label: 'Commandes', itemLabel: 'Commande', max: 50, add: '+ Nouvelle commande', fields: [
        { key: 'name', type: 'text', label: 'Nom (sans /)', max: 32, required: true, pattern: '^[a-z0-9_-]{1,32}$', patternError: 'minuscules, chiffres, - et _ seulement, sans espace.', placeholder: 'regles' },
        { key: 'description', type: 'text', label: 'Description', max: 100, default: 'Commande personnalisée' },
        { key: 'response', type: 'textarea', label: 'Réponse', max: 2000, required: true, help: `${VARS_MEMBER} · {channel}`, ai: 'command' },
        { key: 'embed', type: 'bool', label: 'Réponse dans un embed' },
        { key: 'color', type: 'color', label: 'Couleur de l’embed', default: '#2f7ff0', when: ['embed', true] },
        { key: 'roleId', type: 'role', label: 'Rôle donné / retiré (optionnel)', assignable: true },
        { key: 'ephemeral', type: 'bool', label: 'Réponse visible seulement par la personne' },
      ] },
    ],
  },

  autoMessages: {
    icon: '⏰', title: 'Messages automatiques', toggle: true,
    intro: 'Le bot poste un message à intervalle régulier (rappel des règles, liens utiles…). Premier envoi un intervalle après l’enregistrement.',
    fields: [
      { key: 'list', type: 'list', label: 'Messages', itemLabel: 'Message', max: 25, add: '+ Nouveau message', fields: [
        { key: 'channelId', type: 'channel', label: 'Salon', required: true },
        { key: 'interval', type: 'int', label: 'Toutes les (minutes)', min: 10, max: 10080, default: 60 },
        { key: 'content', type: 'textarea', label: 'Message', max: 2000, required: true, help: 'Variable : {server}', ai: 'auto' },
        { key: 'embed', type: 'bool', label: 'Dans un embed' },
        { key: 'color', type: 'color', label: 'Couleur', default: '#2f7ff0', when: ['embed', true] },
      ] },
    ],
  },

  tempVoice: {
    icon: '🔊', title: 'Salons vocaux temporaires', toggle: true,
    intro: 'Un membre rejoint le salon « créateur » : le bot lui crée son propre salon vocal et l’y déplace. Le salon est supprimé quand il est vide.',
    fields: [
      { key: 'hubId', type: 'voice', label: 'Salon « créateur » (ex : ➕ Créer un salon)' },
      { key: 'categoryId', type: 'category', label: 'Catégorie des salons créés', help: 'Vide = la catégorie du salon créateur.' },
      { key: 'name', type: 'text', label: 'Nom des salons', max: 100, default: '🔊 Salon de {name}', help: 'Variable : {name} (pseudo)' },
      { key: 'limit', type: 'int', label: 'Places maximum (0 = illimité)', min: 0, max: 99, default: 0 },
    ],
  },

  counters: {
    icon: '📈', title: 'Compteurs',
    intro: 'Des salons vocaux verrouillés dont le nom affiche une statistique du serveur, mise à jour toutes les 10 minutes (limite de Discord).',
    fields: [
      { key: 'categoryId', type: 'category', label: 'Catégorie des compteurs', help: 'Vide = en haut de la liste des salons.' },
      { key: 'list', type: 'list', label: 'Compteurs', itemLabel: 'Compteur', max: 10, add: '+ Nouveau compteur', fields: [
        { key: 'type', type: 'select', label: 'Statistique', default: 'members', options: [['members', '👥 Membres'], ['humans', '🧑 Humains'], ['bots', '🤖 Bots'], ['boosts', '💎 Boosts'], ['channels', '💬 Salons'], ['roles', '🎭 Rôles']] },
        { key: 'name', type: 'text', label: 'Nom du salon', max: 90, default: '👥 Membres : {count}', required: true, help: 'Variable : {count}' },
        { key: 'channelId', type: 'hidden' },
      ] },
    ],
  },

  suggestions: {
    icon: '💡', title: 'Suggestions', toggle: true,
    intro: 'Les membres proposent des idées avec /suggestion. Tout le monde vote, le staff (permission « Gérer les messages ») accepte ou refuse.',
    fields: [
      { key: 'channelId', type: 'channel', label: 'Salon des suggestions' },
      { key: 'thread', type: 'bool', label: 'Ouvrir un fil de discussion sous chaque suggestion', default: true },
      { key: 'dm', type: 'bool', label: 'Prévenir l’auteur en MP quand le staff répond', default: true },
    ],
  },

  starboard: {
    icon: '⭐', title: 'Starboard', toggle: true,
    intro: 'Les messages qui reçoivent assez de réactions sont recopiés dans un salon « meilleurs messages ».',
    fields: [
      { key: 'channelId', type: 'channel', label: 'Salon du starboard' },
      { key: 'emoji', type: 'text', label: 'Emoji', max: 64, default: '⭐', emoji: true },
      { key: 'threshold', type: 'int', label: 'Réactions nécessaires', min: 1, max: 100, default: 3 },
      { key: 'selfStar', type: 'bool', label: 'Compter la réaction de l’auteur du message' },
      { key: 'ignoredChannels', type: 'channels', label: 'Salons ignorés' },
    ],
  },

  birthdays: {
    icon: '🎂', title: 'Anniversaires', toggle: true,
    intro: 'Les membres enregistrent leur date avec /anniversaire. Le jour J, le bot leur souhaite et peut leur donner un rôle pour la journée.',
    fields: [
      { key: 'channelId', type: 'channel', label: 'Salon des annonces' },
      { key: 'message', type: 'textarea', label: 'Message', max: 1000, default: '🎂 Joyeux anniversaire {user} ! Passe une super journée 🎉', help: VARS_MEMBER },
      { key: 'roleId', type: 'role', label: 'Rôle du jour (optionnel)', assignable: true },
      { key: 'hour', type: 'int', label: 'Heure de l’annonce (heure de Paris)', min: 0, max: 23, default: 9 },
    ],
  },

  antiRaid: {
    icon: '🚨', title: 'Anti-raid', toggle: true,
    intro: 'Si trop de comptes rejoignent d’un coup, le bot verrouille le serveur (vérification maximale) et prévient le staff.',
    fields: [
      { type: 'section', label: 'Détection' },
      { key: 'joins', type: 'int', label: 'Arrivées', min: 3, max: 100, default: 10 },
      { key: 'seconds', type: 'int', label: 'En moins de (secondes)', min: 5, max: 300, default: 10 },
      { key: 'action', type: 'select', label: 'Réaction', default: 'lock', options: [['lock', 'Verrouiller le serveur'], ['kick', 'Verrouiller et expulser les comptes du raid']] },
      { key: 'lockMinutes', type: 'int', label: 'Durée du verrouillage (minutes)', min: 1, max: 1440, default: 15 },
      { key: 'alertChannel', type: 'channel', label: 'Salon d’alerte' },
      { key: 'alertRole', type: 'role', label: 'Rôle à mentionner' },
      { type: 'section', label: 'Comptes récents' },
      { key: 'minAge', type: 'int', label: 'Âge minimum du compte (jours, 0 = désactivé)', min: 0, max: 365, default: 0, help: 'Les comptes plus récents sont expulsés à leur arrivée (avec un MP d’explication).' },
    ],
  },

  aiTools: {
    icon: '✨', title: 'Outils IA', toggle: true,
    intro: '/resume, /traduire, traduction par réaction drapeau et /image. Les outils utilisent l’IA réglée dans l’onglet 🧠 IA du serveur (la même que l’assistant des tickets).',
    fields: [
      { type: 'section', label: 'Limites' },
      { key: 'perHour', type: 'int', label: 'Utilisations par membre et par heure', min: 1, max: 100, default: 10, help: 'Résumés et traductions confondus.' },
      { type: 'section', label: 'Outils' },
      { key: 'summary', type: 'bool', label: '/resume : résumer les derniers messages d’un salon', default: true },
      { key: 'translate', type: 'bool', label: '/traduire et clic droit sur un message → Applications → Traduire', default: true },
      { key: 'reactions', type: 'bool', label: 'Traduire un message quand on réagit avec un drapeau (🇬🇧 🇫🇷 🇪🇸 🇩🇪…)', default: true },
      { type: 'section', label: 'Images' },
      { key: 'images', type: 'bool', label: '/image : générer des images', help: 'Plus cher que le texte : chaque image coûte quelques centimes sur la clé utilisée.' },
      { key: 'imageProvider', type: 'select', label: 'IA des images', default: 'openai', options: [['openai', 'OpenAI (GPT Image)'], ['gemini', 'Gemini (Google)']], when: ['images', true] },
      { key: 'imageModel', type: 'text', label: 'Modèle d’image (optionnel)', max: 100, placeholder: 'Automatique', when: ['images', true] },
      { key: 'imagesPerDay', type: 'int', label: 'Images par membre et par jour', min: 1, max: 50, default: 3, when: ['images', true] },
    ],
  },

  gameServers: {
    icon: '🎮', title: 'Serveurs de jeu', toggle: true,
    intro: 'Un message mis à jour automatiquement montre si tes serveurs sont en ligne (joueurs, map, ping, mods), avec une alerte quand un serveur tombe ou revient. Redémarrages avec compte à rebours en jeu, à heures fixes ou depuis le dashboard (RCON).',
    fields: [
      { key: 'interval', type: 'int', label: 'Mise à jour du statut (minutes)', min: 1, max: 30, default: 2 },
      { key: 'whitelistRole', type: 'role', label: 'Rôle ajouté à la whitelist',
        help: 'Les membres qui ont ce rôle et ont lié leur pseudo (/pseudo-jeu lier) sont ajoutés à la whitelist des serveurs où elle est cochée, et retirés s’ils perdent le rôle ou quittent le Discord.' },
      { key: 'servers', type: 'list', label: 'Serveurs', itemLabel: 'Serveur', max: 5, add: '+ Ajouter un serveur', fields: [
        { key: 'name', type: 'text', label: 'Nom', max: 50, required: true, placeholder: 'Mon serveur Zomboid' },
        { key: 'game', type: 'select', label: 'Jeu', default: 'zomboid', options: [
          ['zomboid', 'Project Zomboid'], ['minecraft', 'Minecraft (Java)'], ['ark', 'ARK'], ['palworld', 'Palworld'], ['rust', 'Rust'], ['valheim', 'Valheim'],
          ['cs2', 'Counter-Strike 2'], ['gmod', 'Garry’s Mod'], ['dayz', 'DayZ'], ['7dtd', '7 Days to Die'], ['fivem', 'FiveM (GTA RP)'], ['other', 'Autre jeu Steam'],
        ] },
        { key: 'host', type: 'text', label: 'Adresse du serveur', max: 100, required: true, placeholder: 'play.monserveur.fr ou 51.38.12.34',
          pattern: '^[A-Za-z0-9.-]+$', patternError: 'nom de domaine ou adresse IP, sans http:// ni port.' },
        { key: 'port', type: 'int', label: 'Port de requête', min: 1, max: 65535, default: 16261,
          help: 'Le port qui répond aux requêtes de statut. Zomboid : 16261 · Minecraft : 25565 · FiveM : 30120 · ARK : 27015 · autres jeux Steam : souvent le port de requête Steam.' },
        { key: 'statusChannel', type: 'channel', label: 'Salon du statut en direct', help: 'Un message mis à jour automatiquement. Vide = pas de message de statut.' },
        { key: 'alertChannel', type: 'channel', label: 'Salon des alertes', help: 'Un message quand le serveur tombe ou revient. Vide = pas d’alerte.' },
        { key: 'alertRole', type: 'role', label: 'Rôle à mentionner quand le serveur tombe' },
        { key: 'showPlayers', type: 'bool', label: 'Afficher les pseudos des joueurs connectés', default: true },
        { type: 'section', label: 'Mods' },
        { key: 'mods', type: 'textarea', label: 'Liste des mods (un par ligne)', max: 4000, help: 'Affichée dans le message de statut.' },
        { type: 'section', label: 'Redémarrages (RCON)' },
        { key: 'rconPort', type: 'int', label: 'Port RCON (0 = pas de redémarrage)', min: 0, max: 65535, default: 0,
          help: 'Protocole RCON Source : Zomboid, Minecraft, ARK, Palworld, CS2, Garry’s Mod… (Rust : seulement avec rcon.web 0).' },
        { key: 'rconPassword', type: 'secret', label: 'Mot de passe RCON', max: 200, help: 'Gardé secret : il n’est jamais réaffiché.' },
        { key: 'restartTimes', type: 'text', label: 'Heures des redémarrages (heure de Paris)', max: 100, placeholder: '06:00, 18:00',
          pattern: '^\\s*([01]?\\d|2[0-3]):[0-5]\\d(\\s*,\\s*([01]?\\d|2[0-3]):[0-5]\\d)*\\s*$', patternError: 'heures au format 06:00, séparées par des virgules.',
          help: 'Vide = seulement avec le bouton « Redémarrer » du dashboard.' },
        { key: 'countdown', type: 'int', label: 'Prévenir les joueurs (minutes avant)', min: 1, max: 60, default: 5 },
        { key: 'announceCmd', type: 'text', label: 'Commande d’annonce en jeu', max: 200, placeholder: 'Automatique selon le jeu', help: 'Variable : {message}' },
        { key: 'restartCmd', type: 'text', label: 'Commande de redémarrage', max: 200, placeholder: 'Automatique selon le jeu',
          help: 'Souvent un arrêt du serveur : ton hébergeur ou ton script doit le relancer automatiquement.' },
        { type: 'section', label: 'Whitelist automatique (RCON)' },
        { key: 'whitelist', type: 'bool', label: 'Gérer la whitelist de ce serveur', help: 'Avec le « Rôle ajouté à la whitelist » choisi en haut.' },
        { key: 'whitelistAddCmd', type: 'text', label: 'Commande d’ajout à la whitelist', max: 200, placeholder: 'Automatique (Zomboid, Minecraft)', help: 'Variable : {player}', when: ['whitelist', true] },
        { key: 'whitelistRemoveCmd', type: 'text', label: 'Commande de retrait de la whitelist', max: 200, placeholder: 'Automatique (Zomboid, Minecraft)', help: 'Variable : {player}', when: ['whitelist', true] },
      ] },
    ],
  },

  invites: {
    icon: '📨', title: 'Suivi des invitations', toggle: true,
    intro: 'Le bot retrouve qui a invité chaque nouveau membre et tient le classement des inviteurs (/invites). Il a besoin de la permission « Gérer le serveur ».',
    fields: [
      { key: 'channelId', type: 'channel', label: 'Salon des arrivées (optionnel)' },
      { key: 'message', type: 'textarea', label: 'Message', max: 1000, default: '📥 {user} a rejoint, invité par **{inviter}** ({invites} invitations).', help: `${VARS_MEMBER} · {inviter} · {invites}` },
    ],
  },
};

// Prototype-less table: FEATURES['constructor'] (module name coming from the URL) is undefined
Object.setPrototypeOf(FEATURES, null);

const VOICE = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

function defaultsOf(fields) {
  const empty = { bool: false, int: 0, roles: [], channels: [], list: [], color: '#2f7ff0' };
  return Object.fromEntries(
    fields
      .filter((f) => f.key)
      .map((f) => [f.key, structuredClone(f.default ?? (f.type === 'select' ? f.options[0][0] : empty[f.type] ?? ''))]),
  );
}

const store = createStore('features', {});
// Default values computed once per module. getFeature is called on every message, reaction or voice update:
// only the requested module is copied (not the whole server config)
const DEFAULTS = Object.fromEntries(Object.entries(FEATURES).map(([name, f]) => [name, { ...(f.toggle && { enabled: false }), ...defaultsOf(f.fields) }]));
const getFeature = (guildId, name) => structuredClone({ ...DEFAULTS[name], ...store.peek(guildId)[name] });
function saveFeature(guildId, name, config) {
  store.save(guildId, { ...store.peek(guildId), [name]: config });
}

function fail(message) {
  throw new Error(message);
}

// Validates a field; prev = previous value (for hidden fields)
function parseField(f, value, guild, label, prev) {
  const str = typeof value === 'string' ? value.trim() : '';
  const id = /^\d{17,20}$/.test(str) ? str : '';
  const need = (ok, message) => (ok ? null : fail(`${label} : ${message}`));
  switch (f.type) {
    case 'bool':
      return value === true;
    case 'int': {
      const n = value === '' || value == null ? f.default ?? f.min : Number(value);
      need(Number.isInteger(n) && n >= f.min && n <= f.max, `nombre entre ${f.min} et ${f.max}.`);
      return n;
    }
    case 'text':
    case 'textarea':
      // Short field left empty: its default value (an empty channel name would be refused by Discord)
      if (!str && f.type === 'text' && f.default) return f.default;
      if (/\s/.test(str) && f.key?.toLowerCase().includes('model')) fail(`${label} : pas d’espace dans un nom de modèle.`);
      need(str.length <= f.max, `${f.max} caractères maximum.`);
      need(!f.required || str, 'obligatoire.');
      if (str && f.pattern) need(new RegExp(f.pattern).test(str), f.patternError);
      if (str && f.emoji) need(require('../features/tickets/tickets').isEmoji(str), 'un seul emoji.');
      return str;
    case 'color':
      return /^#[0-9a-f]{6}$/i.test(str) ? str : f.default ?? '#2f7ff0';
    case 'select':
      return f.options.some(([v]) => v === value) ? value : f.default ?? f.options[0][0];
    case 'channel':
    case 'voice':
    case 'category': {
      const types = { channel: TEXT, voice: VOICE, category: [ChannelType.GuildCategory] }[f.type];
      if (!id) return need(!f.required, 'choisis un salon.') ?? '';
      need(types.includes(guild.channels.cache.get(id)?.type), 'salon introuvable.');
      return id;
    }
    case 'role': {
      if (!id) return need(!f.required, 'choisis un rôle.') ?? '';
      const role = guild.roles.cache.get(id);
      need(role && role.id !== guild.id, 'rôle introuvable.');
      if (f.assignable) need(role.editable && !role.managed, `le bot ne peut pas donner @${role.name} (place son rôle au-dessus).`);
      return id;
    }
    case 'roles':
      return [...new Set(Array.isArray(value) ? value : [])].filter((r) => guild.roles.cache.has(r)).slice(0, 50);
    case 'channels':
      return [...new Set(Array.isArray(value) ? value : [])].filter((c) => guild.channels.cache.has(c)).slice(0, 100);
    case 'hidden':
      return prev ?? '';
    // Secret (password): never sent back to the dashboard, which receives SECRET_MASK instead.
    // SECRET_MASK received = unchanged · empty = cleared · any other value = new secret
    case 'secret':
      if (value === SECRET_MASK) return prev ?? '';
      need(str.length <= f.max, `${f.max} caractères maximum.`);
      return str;
    case 'list': {
      const items = Array.isArray(value) ? value : [];
      need(items.length <= f.max, `${f.max} maximum.`);
      const before = new Map((Array.isArray(prev) ? prev : []).map((item) => [item.id, item]));
      return items.map((item, i) => {
        const itemId = typeof item?.id === 'string' && before.has(item.id) ? item.id : SnowflakeUtil.generate().toString();
        return { id: itemId, ...parseFields(f.fields, item ?? {}, guild, `${f.itemLabel} ${i + 1}`, before.get(itemId) ?? {}) };
      });
    }
    default:
      return undefined;
  }
}

function parseFields(fields, body, guild, prefix, prev) {
  const out = {};
  for (const f of fields) {
    if (!f.key) continue;
    out[f.key] = parseField(f, body[f.key], guild, prefix ? `${prefix} · ${f.label}` : f.label ?? f.key, prev[f.key]);
  }
  return out;
}

function parseFeature(name, body, guild) {
  const def = FEATURES[name];
  const prev = getFeature(guild.id, name);
  const config = parseFields(def.fields, body ?? {}, guild, '', prev);
  if (def.toggle) config.enabled = body?.enabled === true;
  return config;
}

// The schema sent to the dashboard (without anything secret)
const schemaOf = (name) => {
  const { icon, title, intro, toggle, fields } = FEATURES[name];
  return { icon, title, intro, toggle: Boolean(toggle), fields };
};

// The config as sent to the dashboard: secrets that are set are replaced by SECRET_MASK
const SECRET_MASK = '••••••••';
function maskSecrets(fields, config) {
  const out = { ...config };
  for (const f of fields) {
    if (f.type === 'secret') out[f.key] = config[f.key] ? SECRET_MASK : '';
    if (f.type === 'list' && Array.isArray(config[f.key])) out[f.key] = config[f.key].map((item) => maskSecrets(f.fields, item));
  }
  return out;
}
const publicConfig = (name, config) => maskSecrets(FEATURES[name].fields, config);

// Replaces {variables} in a text
const fillVars = (text, vars) => text.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? String(vars[key]) : all));

module.exports = { FEATURES, getFeature, saveFeature, parseFeature, schemaOf, publicConfig, fillVars };

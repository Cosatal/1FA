// Dashboard routes for the modules that have their own screen: reaction roles, moderation, bot commands,
// polls, giveaways, social alerts, and the bot settings (API keys, reserved for the bot owner).
const { GatewayIntentBits, PermissionFlagsBits, SnowflakeUtil } = require('discord.js');
const { LOG_EVENTS } = require('../features/moderation/logs');
const { str, isText, int, fail } = require('./util');
const { isEmoji } = require('../features/tickets/tickets');
const moderation = require('../features/moderation/moderation');
const reactionRoles = require('../features/reaction-roles');
const giveaways = require('../features/giveaways');
const alerts = require('../features/alerts');
const { getSetting, updateSettings, settingSource } = require('../core/settings');

// Bot owner (or member of the owning team in the Developer Portal): the only one who can set API keys
async function isBotOwner(client, userId) {
  const { owner } = client.application.owner ? client.application : await client.application.fetch();
  return owner?.members ? owner.members.has(userId) : owner?.id === userId;
}

// Name of the Discord permission a command requires by default (null: everyone can use it)
const PERMISSION_NAMES = {
  Administrator: 'Administrateur', ManageGuild: 'Gérer le serveur', ManageMessages: 'Gérer les messages', ManageChannels: 'Gérer les salons',
  BanMembers: 'Bannir des membres', KickMembers: 'Expulser des membres', ModerateMembers: 'Exclure temporairement des membres',
};
function permissionName(bits) {
  if (bits == null) return null;
  const value = BigInt(bits);
  const name = Object.keys(PERMISSION_NAMES).find((key) => (value & PermissionFlagsBits[key]) !== 0n);
  return name ? PERMISSION_NAMES[name] : 'Staff';
}

// Moderation config sent to the dashboard: checked languages always as a list (older configs included)
const withLanguages = (config) => ({ ...config, presets: { ...config.presets, languages: moderation.presetLanguages(config.presets) } });

// Dashboard routes for the modules: reaction roles, moderation, polls, giveaways, alerts

// Roles the bot can give (below its own role, not managed by an integration)
const assignableRoles = (guild) =>
  guild.roles.cache
    .filter((r) => r.id !== guild.id && !r.managed && r.editable)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));

// Small numbers shown on the dashboard home cards
function moduleStats(guildId) {
  const mod = moderation.getModeration(guildId);
  return {
    rolePanels: reactionRoles.getPanels(guildId).length,
    moderationFilters: ['words', 'presets', 'invites', 'links', 'mentions', 'spam'].filter((k) => mod[k].enabled).length,
    giveawaysActive: giveaways.getGiveaways(guildId).filter((g) => !g.ended).length,
    alerts: alerts.getFeeds(guildId).length,
  };
}

function moduleRoutes(app, client, auth, guildAccess) {
  const route = (method, path, handler) =>
    app[method](`/api/guilds/:id/${path}`, auth, guildAccess, async (req, res) => {
      try {
        res.json(await handler(req, req.guild));
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

  // ---------- Moderation ----------

  route('get', 'moderation', (req, guild) => ({
    config: withLanguages(moderation.getModeration(guild.id)),
    // The bot's insult lists, one checkbox per language
    insultLanguages: moderation.INSULT_LANGUAGES,
    warnings: moderation.recentWarnings(guild.id).map((w) => ({ ...w, user: client.users.cache.get(w.userId)?.tag ?? w.userId })),
    canManage: guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild),
    logEvents: LOG_EVENTS,
    // Privileged intents enabled: some logs need them
    intents: { members: client.options.intents.has(GatewayIntentBits.GuildMembers), content: client.options.intents.has(GatewayIntentBits.MessageContent) },
  }));

  // Bot commands, with who can use them: staff = Discord permission required by default (null = everyone)
  route('get', 'commands', (req, guild) => {
    const rules = moderation.getCommandRules(guild.id);
    return {
      commands: [...client.commands.values()]
        .map((c) => ({
          name: c.data.name,
          description: c.data.description || 'Clic droit sur un message → Applications',
          menu: !c.data.description,
          staff: c.staff ?? permissionName(c.data.default_member_permissions),
          enabled: true,
          roles: [],
          channels: [],
          ...rules[c.data.name],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  route('put', 'moderation', async (req, guild) => {
    const config = { ...parseModeration(req.body ?? {}, guild), rules: moderation.getModeration(guild.id).rules };
    const { ids, errors } = await moderation.syncRules(guild, config);
    config.rules = ids;
    moderation.saveModeration(guild.id, config);
    return { config: withLanguages(config), errors };
  });

  // Settings of a command: enabled or not, allowed channels and roles (empty = everywhere / everyone)
  route('put', 'commands/:name', (req, guild) => {
    const { name } = req.params;
    if (!client.commands.has(name)) fail('Commande inconnue.');
    const ids = (list, has, max) => (Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && has(id)).slice(0, max);
    const rule = {
      enabled: req.body?.enabled !== false,
      roles: ids(req.body?.roles, (id) => guild.roles.cache.has(id), 25),
      channels: ids(req.body?.channels, (id) => guild.channels.cache.has(id), 50),
    };
    moderation.saveCommandRules(guild.id, { ...moderation.getCommandRules(guild.id), [name]: rule });
    return { command: { name, ...rule } };
  });

  // ---------- Reaction roles ----------

  route('get', 'roles-panels', (req, guild) => ({
    panels: reactionRoles.getPanels(guild.id),
    roles: assignableRoles(guild),
    canManageRoles: guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles),
  }));

  // Creates (id "new") or edits a panel, then publishes it in its channel
  route('put', 'roles-panels/:panelId', async (req, guild) => {
    const panels = reactionRoles.getPanels(guild.id);
    const existing = panels.find((p) => p.id === req.params.panelId);
    const panel = { ...parsePanel(req.body ?? {}, guild), id: existing?.id ?? SnowflakeUtil.generate().toString(), messageId: null };
    // Same channel: the message already posted is edited. Other channel: the old message is deleted
    if (existing) {
      if (existing.channelId === panel.channelId) panel.messageId = existing.messageId;
      else await reactionRoles.deletePanel(guild, existing);
    }
    panel.messageId = await reactionRoles.publishPanel(guild, panel);
    reactionRoles.savePanels(guild.id, existing ? panels.map((p) => (p.id === panel.id ? panel : p)) : [...panels, panel]);
    return { panel };
  });

  route('delete', 'roles-panels/:panelId', async (req, guild) => {
    const panels = reactionRoles.getPanels(guild.id);
    const panel = panels.find((p) => p.id === req.params.panelId);
    if (!panel) throw new Error('Panneau introuvable.');
    await reactionRoles.deletePanel(guild, panel);
    reactionRoles.savePanels(guild.id, panels.filter((p) => p.id !== panel.id));
    return { ok: true };
  });

  // ---------- Polls (Discord native polls) ----------

  route('post', 'polls', async (req, guild) => {
    const poll = parsePoll(req.body ?? {}, guild);
    const ping = poll.mention === 'everyone' ? '@everyone' : poll.mention === 'here' ? '@here' : poll.mention ? `<@&${poll.mention}>` : undefined;
    try {
      const message = await guild.channels.cache.get(poll.channelId).send({
        content: ping,
        poll: {
          question: { text: poll.question },
          answers: poll.answers.map((a) => ({ text: a.text, ...(a.emoji && { emoji: a.emoji }) })),
          duration: poll.duration,
          allowMultiselect: poll.multi,
        },
        allowedMentions: { parse: ['everyone', 'here'].includes(poll.mention) ? ['everyone'] : [], roles: /^\d+$/.test(poll.mention) ? [poll.mention] : [] },
      });
      return { url: message.url };
    } catch (error) {
      throw new Error(`Envoi impossible : ${error.message}. Vérifie que le bot peut écrire dans ce salon.`);
    }
  });

  // ---------- Giveaways ----------

  route('get', 'giveaways', (req, guild) => ({ list: giveaways.getGiveaways(guild.id).sort((a, b) => b.endsAt - a.endsAt) }));

  route('post', 'giveaways', async (req, guild) => {
    const data = parseGiveaway(req.body ?? {}, guild);
    return { giveaway: await giveaways.createGiveaway(guild, { ...data, host: req.session.user.username }) };
  });

  route('post', 'giveaways/:gid/end', async (req, guild) => ({ giveaway: await giveaways.endGiveaway(guild, req.params.gid) }));
  route('post', 'giveaways/:gid/reroll', async (req, guild) => ({ giveaway: await giveaways.rerollGiveaway(guild, req.params.gid) }));
  route('delete', 'giveaways/:gid', async (req, guild) => {
    await giveaways.deleteGiveaway(guild, req.params.gid);
    return { ok: true };
  });

  // ---------- Alerts ----------

  route('get', 'alerts', (req, guild) => ({
    feeds: alerts.getFeeds(guild.id).map(({ seen, ...f }) => f),
    twitchReady: alerts.twitchReady(),
    defaults: alerts.DEFAULT_MESSAGES,
  }));

  route('post', 'alerts', async (req, guild) => {
    if (alerts.getFeeds(guild.id).length >= 30) throw new Error('30 alertes maximum par serveur.');
    const data = parseAlert(req.body ?? {}, guild);
    try {
      const { seen, ...feed } = await alerts.addFeed(guild.id, data);
      return { feed };
    } catch (error) {
      throw new Error(`Impossible d’ajouter l’alerte : ${error.message}.`);
    }
  });

  route('post', 'alerts/:fid/test', async (req, guild) => {
    try {
      await alerts.testFeed(guild, req.params.fid);
    } catch (error) {
      throw new Error(`Test impossible : ${error.message}`);
    }
    return { ok: true };
  });

  route('delete', 'alerts/:fid', (req, guild) => {
    alerts.removeFeed(guild.id, req.params.fid);
    return { ok: true };
  });

  // ---------- Twitch credentials (bot owner only, alerts tab): shared by every server ----------
  // AI keys are set per server in the "IA du serveur" tab (or in .env for the owner's own servers)

  const ownerOnly = async (req, res, next) =>
    (await isBotOwner(client, req.session.user.id).catch(() => false)) ? next() : res.status(403).json({ error: 'Réservé au propriétaire du bot.' });

  // Secrets are never sent back: only whether they are set, and where they come from
  const settingsView = () => ({
    twitch: { clientId: getSetting('twitchClientId'), clientIdSource: settingSource('twitchClientId'), secretSource: settingSource('twitchClientSecret') },
  });

  app.get('/api/bot-settings', auth, ownerOnly, (req, res) => res.json(settingsView()));

  // Missing field = unchanged, empty string = cleared (back to the .env value). Only known settings are accepted
  app.put('/api/bot-settings', auth, ownerOnly, (req, res) => {
    const changes = {};
    for (const name of ['twitchClientId', 'twitchClientSecret']) {
      const value = req.body?.[name];
      if (value === undefined) continue;
      const s = str(value);
      if (s.length > 300 || /\s/.test(s)) return res.status(400).json({ error: 'Valeur invalide (pas d’espaces).' });
      changes[name] = s || null;
    }
    updateSettings(changes);
    res.json(settingsView());
  });

  app.post('/api/bot-settings/test/:service', auth, ownerOnly, async (req, res) => {
    if (req.params.service !== 'twitch') return res.status(404).json({ error: 'Service inconnu.' });
    try {
      await alerts.testTwitch();
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: `Échec : ${error.message}.` });
    }
  });
}

// ---------- Validation of what the dashboard sends ----------

function parseModeration(body, guild) {
  const logsId = str(body.logsId);
  if (logsId && !isText(guild, logsId)) fail('Salon des logs introuvable.');
  const words = [...new Set((Array.isArray(body.words?.list) ? body.words.list : []).map(str).filter(Boolean))];
  if (words.length > 1000) fail('1000 mots interdits maximum.');
  if (words.some((w) => w.length > 60)) fail('Chaque mot interdit fait 60 caractères max.');
  const allow = [...new Set((Array.isArray(body.links?.allow) ? body.links.allow : []).map((d) => str(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean))];
  if (allow.length > 100) fail('100 domaines autorisés maximum.');
  const minutes = (value, label) => int(value, 0, 40320) ?? fail(`${label} : durée invalide (0 à 40320 minutes).`);

  // Only known events are kept
  const keys = LOG_EVENTS.flatMap((g) => g.items.map(([key]) => key));
  const logEvents = Object.fromEntries(keys.map((key) => [key, body.logEvents?.[key] === true]));

  return {
    logsId,
    logEvents,
    words: { enabled: body.words?.enabled === true, list: words, timeout: minutes(body.words?.timeout ?? 0, 'Mots interdits') },
    presets: {
      enabled: body.presets?.enabled === true,
      profanity: body.presets?.profanity !== false,
      sexual: body.presets?.sexual !== false,
      slurs: body.presets?.slurs !== false,
      // Languages of the bot's insult lists (only known languages are kept)
      languages: [...new Set(Array.isArray(body.presets?.languages) ? body.presets.languages : ['fr'])].filter((id) => moderation.INSULT_LANGUAGES.some((l) => l.id === id)),
    },
    invites: { enabled: body.invites?.enabled === true },
    links: { enabled: body.links?.enabled === true, allow },
    mentions: {
      enabled: body.mentions?.enabled === true,
      limit: int(body.mentions?.limit, 1, 50) ?? fail('Mentions : limite entre 1 et 50.'),
      timeout: minutes(body.mentions?.timeout ?? 0, 'Mentions'),
    },
    spam: { enabled: body.spam?.enabled === true },
    exemptRoles: (Array.isArray(body.exemptRoles) ? body.exemptRoles : []).filter((id) => guild.roles.cache.has(id)).slice(0, 20),
    exemptChannels: (Array.isArray(body.exemptChannels) ? body.exemptChannels : []).filter((id) => guild.channels.cache.has(id)).slice(0, 50),
  };
}

const PANEL_LIMITS = { buttons: 25, select: 25, reactions: 20 };

function parsePanel(body, guild) {
  const channelId = str(body.channelId);
  if (!isText(guild, channelId)) fail('Choisis un salon texte.');
  const mode = Object.keys(PANEL_LIMITS).includes(body.mode) ? body.mode : fail('Format invalide.');
  const title = str(body.title);
  const description = str(body.description);
  if (!title || title.length > 256) fail('Le titre doit faire entre 1 et 256 caractères.');
  if (description.length > 2000) fail('La description fait 2000 caractères max.');
  if (!Array.isArray(body.roles) || !body.roles.length) fail('Ajoute au moins un rôle.');
  if (body.roles.length > PANEL_LIMITS[mode]) fail(`${PANEL_LIMITS[mode]} rôles maximum dans ce format.`);

  const editable = new Set(assignableRoles(guild).map((r) => r.id));
  const seen = new Set();
  const roles = body.roles.map((r, i) => {
    const roleId = str(r?.roleId);
    const emoji = str(r?.emoji);
    const label = str(r?.label);
    if (!editable.has(roleId)) fail(`Rôle ${i + 1} : choisis un rôle que le bot peut donner.`);
    if (seen.has(roleId)) fail(`Rôle ${i + 1} : ce rôle est déjà dans le panneau.`);
    seen.add(roleId);
    if (emoji && !isEmoji(emoji)) fail(`Rôle ${i + 1} : emoji invalide (un seul emoji).`);
    if (mode === 'reactions' && !emoji) fail(`Rôle ${i + 1} : un emoji est obligatoire pour le format réactions.`);
    if (label.length > 80) fail(`Rôle ${i + 1} : le texte fait 80 caractères max.`);
    return { roleId, emoji, label };
  });
  return { channelId, mode, title, description, unique: body.unique === true, roles };
}

function parsePoll(body, guild) {
  const channelId = str(body.channelId);
  if (!isText(guild, channelId)) fail('Choisis un salon texte.');
  const question = str(body.question);
  if (!question || question.length > 300) fail('La question doit faire entre 1 et 300 caractères.');
  const answers = (Array.isArray(body.answers) ? body.answers : []).map((a) => ({ text: str(a?.text), emoji: str(a?.emoji) })).filter((a) => a.text);
  if (answers.length < 2 || answers.length > 10) fail('Mets entre 2 et 10 réponses.');
  for (const [i, a] of answers.entries()) {
    if (a.text.length > 55) fail(`Réponse ${i + 1} : 55 caractères max.`);
    if (a.emoji && !isEmoji(a.emoji)) fail(`Réponse ${i + 1} : emoji invalide.`);
  }
  const mention = str(body.mention);
  if (mention && !['everyone', 'here'].includes(mention) && !guild.roles.cache.has(mention)) fail('Rôle à mentionner introuvable.');
  return {
    channelId,
    question,
    answers,
    duration: int(body.duration, 1, 768) ?? fail('Durée invalide (1 heure à 32 jours).'),
    multi: body.multi === true,
    mention,
  };
}

function parseGiveaway(body, guild) {
  const channelId = str(body.channelId);
  if (!isText(guild, channelId)) fail('Choisis un salon texte.');
  const prize = str(body.prize);
  if (!prize || prize.length > 200) fail('Le lot doit faire entre 1 et 200 caractères.');
  const description = str(body.description);
  if (description.length > 1000) fail('La description fait 1000 caractères max.');
  const requiredRoleId = str(body.requiredRoleId);
  if (requiredRoleId && !guild.roles.cache.has(requiredRoleId)) fail('Rôle requis introuvable.');
  return {
    channelId,
    prize,
    description,
    winners: int(body.winners, 1, 20) ?? fail('Entre 1 et 20 gagnants.'),
    durationMs: (int(body.minutes, 1, 60 * 24 * 60) ?? fail('Durée invalide (1 minute à 60 jours).')) * 60000,
    requiredRoleId,
  };
}

function parseAlert(body, guild) {
  const platforms = Object.keys(alerts.DEFAULT_MESSAGES);
  const platform = platforms.includes(body.platform) ? body.platform : fail('Plateforme invalide.');
  const source = str(body.source);
  if (!source || source.length > 300) fail('Indique la chaîne, le compte ou le lien du flux.');
  const channelId = str(body.channelId);
  if (!isText(guild, channelId)) fail('Choisis le salon où poster les alertes.');
  const roleId = str(body.roleId);
  if (roleId && !guild.roles.cache.has(roleId)) fail('Rôle à mentionner introuvable.');
  const message = str(body.message);
  if (message.length > 1000) fail('Le message fait 1000 caractères max.');
  return { platform, source, channelId, roleId, message };
}

module.exports = { moduleRoutes, moduleStats, isBotOwner, parseModeration };

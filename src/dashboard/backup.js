const { FEATURES, getFeature, saveFeature, parseFeature, publicConfig } = require('../core/feature-config');
const { getTicketConfig, saveTicketConfig } = require('../features/tickets/ticket-store');
const welcomeStore = require('../features/welcome/welcome-store');
const moderation = require('../features/moderation/moderation');
const { guildLang, setGuildLang } = require('../core/language');
const { PROVIDERS, guildAi, setGuildAi } = require('../features/ai/ai-support');

// Backup of a server's settings: a JSON file to download, to import later or on another server.
// Never any secret inside (AI keys, RCON passwords). On import, each part is validated like in the dashboard;
// a refused part (e.g. a channel that doesn't exist on this server) doesn't prevent the others from being imported.

const VERSION = 1;

function exportBackup(guild) {
  return {
    format: '1fa-backup',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    guild: { id: guild.id, name: guild.name },
    language: guildLang(guild),
    ai: guildAi(guild.id), // the chosen AI and model (never the keys)
    tickets: getTicketConfig(guild.id),
    welcome: welcomeStore.get(guild.id),
    moderation: { ...moderation.getModeration(guild.id), rules: {} },
    commandRules: moderation.getCommandRules(guild.id),
    features: Object.fromEntries(Object.keys(FEATURES).map((name) => [name, publicConfig(name, getFeature(guild.id, name))])),
  };
}

// parsers: the dashboard's validators (server.js and modules.js), to accept exactly what the dashboard accepts
async function importBackup(guild, data, { parseTickets, parseWelcome, parseModeration, commandNames }) {
  if (data?.format !== '1fa-backup') throw new Error('Ce fichier n’est pas une sauvegarde du bot.');
  const results = [];
  const step = async (label, run) => {
    try {
      await run();
      results.push({ label, ok: true });
    } catch (error) {
      results.push({ label, ok: false, error: error.message });
    }
  };

  if (data.language) await step('Langue', () => {
    if (!['fr', 'en'].includes(data.language)) throw new Error('langue inconnue.');
    setGuildLang(guild.id, data.language);
  });
  if (data.ai) await step('IA du serveur', () => {
    const model = typeof data.ai.model === 'string' ? data.ai.model.trim() : '';
    if (!PROVIDERS[data.ai.provider] || model.length > 150 || /\s/.test(model)) throw new Error('IA ou modèle invalide.');
    setGuildAi(guild.id, { provider: data.ai.provider, model });
  });
  if (data.tickets) await step('Tickets', () => {
    const parsed = parseTickets(data.tickets, guild);
    if (parsed.error) throw new Error(parsed.error);
    // Same channel: the panel already posted will be updated on the next save (otherwise it would be posted a second time)
    const current = getTicketConfig(guild.id);
    const panelMessageId = current.panelChannelId === parsed.value.panelChannelId ? current.panelMessageId : '';
    saveTicketConfig(guild.id, { ...current, ...parsed.value, panelMessageId });
  });
  if (data.welcome) await step('Bienvenue', () => {
    const parsed = parseWelcome(data.welcome, guild);
    if (parsed.error) throw new Error(parsed.error);
    const { captcha } = welcomeStore.get(guild.id);
    const messageId = captcha.channelId === parsed.value.captcha.channelId ? captcha.messageId : '';
    welcomeStore.save(guild.id, { ...parsed.value, captcha: { ...parsed.value.captcha, messageId } });
  });
  if (data.moderation) await step('Modération', async () => {
    const config = { ...parseModeration(data.moderation, guild), rules: moderation.getModeration(guild.id).rules };
    // Discord's AutoMod rules are updated right away
    const { ids } = await moderation.syncRules(guild, config);
    moderation.saveModeration(guild.id, { ...config, rules: ids });
  });
  if (data.commandRules && typeof data.commandRules === 'object') await step('Commandes du bot', () => {
    const ids = (list, has) => (Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && has(id));
    const rules = {};
    for (const [name, rule] of Object.entries(data.commandRules)) {
      if (!commandNames.has(name)) continue;
      rules[name] = { enabled: rule?.enabled !== false, roles: ids(rule?.roles, (id) => guild.roles.cache.has(id)), channels: ids(rule?.channels, (id) => guild.channels.cache.has(id)) };
    }
    moderation.saveCommandRules(guild.id, rules);
  });
  for (const [name, config] of Object.entries(data.features ?? {})) {
    if (!FEATURES[name]) continue;
    // Secrets masked in the backup: those already set on this server are kept
    await step(FEATURES[name].title, () => saveFeature(guild.id, name, parseFeature(name, config, guild)));
  }
  return results;
}

function backupRoutes(app, auth, guildAccess, parsers) {
  app.get('/api/guilds/:id/backup', auth, guildAccess, (req, res) => {
    const name = req.guild.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'serveur';
    res.set('Content-Disposition', `attachment; filename="sauvegarde-${name}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(exportBackup(req.guild));
  });

  app.post('/api/guilds/:id/backup', auth, guildAccess, async (req, res) => {
    try {
      res.json({ results: await importBackup(req.guild, req.body, parsers) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });
}

module.exports = { backupRoutes };

const path = require('node:path');
const { GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { listProviders } = require('../features/ai/ai-support');
const { takeQuota, writeText } = require('../features/ai/ai-tools');
const { resolveAi } = require('../features/ai/ai-support');
const { FEATURES, getFeature, saveFeature, parseFeature, schemaOf, publicConfig } = require('../core/feature-config');
const games = require('../features/game-servers/game-servers');
const levels = require('../features/levels');
const { syncCustomCommands, checkCustomCommands } = require('../features/custom-commands');
const { applyCounters } = require('../features/server-tools');
const { upcoming, formatDate, recentSuggestions } = require('../features/community');
const { endRaid, raidStatus, quarantineCount, cacheInvites, inviteTop } = require('../features/moderation/guard');
const { lockedCount, unlockServer } = require('../features/moderation/lockdown');
const { recentCases, pendingAppeals, ICONS: CASE_ICONS } = require('../features/moderation/cases');
const { aiModerationStatus } = require('../features/moderation/ai-moderation');

// Dashboard routes for the schema-based modules (feature-config.js), and the public level leaderboard.
// Each module can have: check (validation on top of the schema), onSave (action on Discord), view (info under the form), actions (buttons).

const missing = (guild, perms) => perms.filter(([flag]) => !guild.members.me.permissions.has(flag)).map(([, name]) => name);
// One note per missing permission (each one is a whole text for the translation)
const permNote = (guild, perms) => missing(guild, perms).map((p) => `⚠️ Il manque au bot la permission « ${p} » pour ce module.`);
const avatarOf = (guild, id) => (guild.members.cache.get(id) ?? guild.client.users.cache.get(id))?.displayAvatarURL({ size: 64 }) ?? 'https://cdn.discordapp.com/embed/avatars/0.png';
const nameOf = (guild, id) => guild.members.cache.get(id)?.displayName ?? guild.client.users.cache.get(id)?.username ?? 'Ancien membre';

function hooks(client) {
  return {
    levels: {
      async view(guild, config) {
        const top = await levels.leaderboard(guild, 10);
        return {
          list: { title: '🏆 Top 10', empty: 'Personne n’a encore gagné d’XP.', rows: top.map((u) => ({ avatar: u.avatar, main: `#${u.rank} ${u.name}`, sub: `Niveau ${u.level} · ${u.xp.toLocaleString('fr-FR')} XP` })) },
          links: config.publicLeaderboard ? [{ label: '🌐 Voir le classement public', url: `/leaderboard/${guild.id}` }] : [],
          actions: [{ id: 'reset', label: 'Remettre tout l’XP à zéro', danger: true, confirm: 'Remettre l’XP de TOUS les membres à zéro ? (les rôles déjà donnés restent)' }],
          notes: permNote(guild, [[PermissionFlagsBits.ManageRoles, 'Gérer les rôles']]).filter(() => config.rewards.length),
        };
      },
      actions: {
        reset: (guild) => {
          levels.resetGuild(guild.id);
          return 'XP remise à zéro.';
        },
      },
    },
    commands: {
      check: (guild, config) => checkCustomCommands(config.list, client.commands),
      async onSave(guild, config) {
        try {
          await syncCustomCommands(guild, config.list);
        } catch (error) {
          throw new Error(`Discord a refusé les commandes : ${error.message}`);
        }
      },
      view: () => ({ notes: ['Les commandes apparaissent dans le menu « / » du serveur. Sur PC, fais Ctrl+R dans Discord si elles ne s’affichent pas.'] }),
    },
    counters: {
      onSave: (guild, config, previous) => applyCounters(guild, config, previous),
      view: (guild) => ({ notes: permNote(guild, [[PermissionFlagsBits.ManageChannels, 'Gérer les salons']]) }),
    },
    tempVoice: {
      view: (guild) => ({ notes: permNote(guild, [[PermissionFlagsBits.ManageChannels, 'Gérer les salons'], [PermissionFlagsBits.MoveMembers, 'Déplacer des membres']]) }),
    },
    suggestions: {
      view: (guild) => ({
        list: {
          title: '💡 Dernières suggestions',
          empty: 'Aucune suggestion pour l’instant. Les membres utilisent /suggestion.',
          rows: recentSuggestions(guild.id).map((s) => ({
            icon: { pending: '🕓', accepted: '✅', refused: '❌' }[s.status],
            main: `n°${s.n} · ${s.text.slice(0, 100)}`,
            sub: `${s.author} · 👍 ${s.up.length} · 👎 ${s.down.length}`,
          })),
        },
      }),
    },
    birthdays: {
      view: (guild) => ({
        list: {
          title: '🎂 Prochains anniversaires',
          empty: 'Personne n’a encore enregistré sa date (/anniversaire definir).',
          rows: upcoming(guild.id).map((b) => ({ avatar: avatarOf(guild, b.userId), main: nameOf(guild, b.userId), sub: `${formatDate(b)} · ${b.in === 0 ? 'aujourd’hui 🎉' : `dans ${b.in} jour${b.in > 1 ? 's' : ''}`}` })),
        },
        notes: permNote(guild, [[PermissionFlagsBits.ManageRoles, 'Gérer les rôles']]).filter(() => getFeature(guild.id, 'birthdays').roleId),
      }),
    },
    antiRaid: {
      check(guild, config) {
        if (config.minAge && config.minAgeAction === 'quarantine' && !config.quarantineRole) throw new Error('Rôle de quarantaine : choisis un rôle (ou une autre action pour les comptes trop récents).');
      },
      view: (guild, config) => {
        const until = raidStatus(guild.id);
        const active = until > Date.now();
        const locked = lockedCount(guild.id);
        const quarantined = quarantineCount(guild.id);
        return {
          notes: [
            ...(active ? [`🔒 Serveur verrouillé jusqu’à ${new Date(until).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}.`] : []),
            ...(locked ? [`🔒 ${locked} salon(s) verrouillé(s) (/lockdown ou anti-raid). /unlock serveur pour tout rouvrir.`] : []),
            ...(quarantined ? [`🛡️ ${quarantined} membre(s) en quarantaine : ils sont libérés tout seuls quand leur compte atteint l’âge minimum.`] : []),
            ...(config.minAge && !config.alertChannel ? ['⚠️ Choisis un salon d’alerte : le staff y reçoit les comptes récents, avec les boutons Libérer et Expulser.'] : []),
            ...permNote(guild, [
              [PermissionFlagsBits.ManageGuild, 'Gérer le serveur'],
              [PermissionFlagsBits.KickMembers, 'Expulser des membres'],
              ...(config.minAgeAction === 'timeout' ? [[PermissionFlagsBits.ModerateMembers, 'Exclure temporairement des membres']] : []),
              ...(config.minAgeAction === 'quarantine' ? [[PermissionFlagsBits.ManageRoles, 'Gérer les rôles']] : []),
              ...(config.lockChannels ? [[PermissionFlagsBits.ManageChannels, 'Gérer les salons'], [PermissionFlagsBits.ManageRoles, 'Gérer les rôles']] : []),
            ].filter(([flag], i, all) => all.findIndex(([other]) => other === flag) === i)),
          ],
          actions: [
            ...(active ? [{ id: 'endRaid', label: '🔓 Terminer le verrouillage maintenant' }] : []),
            ...(locked ? [{ id: 'unlockAll', label: '🔓 Déverrouiller tous les salons', confirm: 'Déverrouiller tous les salons verrouillés ? Leurs permissions d’avant sont restaurées.' }] : []),
          ],
        };
      },
      actions: {
        endRaid: async (guild) => ((await endRaid(guild)) ? 'Verrouillage terminé.' : 'Aucun verrouillage en cours.'),
        unlockAll: async (guild) => `${await unlockServer(guild)} salon(s) déverrouillé(s).`,
      },
    },
    cases: {
      check(guild, config) {
        if (config.enabled && !config.channelId) throw new Error('Salon des appels : choisis un salon pour activer les appels.');
      },
      view(guild) {
        const STATUS = { pending: '🕓 appel en attente', accepted: '✅ appel accepté', refused: '❌ appel refusé' };
        const NAMES = { ban: 'Bannissement', tempban: 'Bannissement temporaire', kick: 'Expulsion', mute: 'Mute', tempmute: 'Mute temporaire', warn: 'Avertissement', unban: 'Débannissement', unmute: 'Fin du mute' };
        const pending = pendingAppeals(guild.id);
        return {
          list: {
            title: '⚖️ Derniers cas',
            empty: 'Aucune sanction pour l’instant. Les sanctions du bot (/ban, /mute, /warn…) apparaissent ici avec leur numéro.',
            rows: recentCases(guild.id).map((c) => ({
              icon: CASE_ICONS[c.type],
              main: `n°${c.n} · ${NAMES[c.type]} · ${c.userTag}`,
              sub: `par ${c.modTag} · ${new Date(c.at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}${c.reason ? ` · ${c.reason.slice(0, 80)}` : ''}${c.appeal ? ` · ${STATUS[c.appeal.status]}` : ''}`,
            })),
          },
          notes: [
            ...(pending ? [`🕓 ${pending} appel(s) en attente dans le salon des appels.`] : []),
            'Les sanctions faites avec le clic droit de Discord (et pas avec les commandes du bot) n’ont pas de numéro de cas.',
            ...permNote(guild, [[PermissionFlagsBits.BanMembers, 'Bannir des membres'], [PermissionFlagsBits.ModerateMembers, 'Exclure temporairement des membres']]),
          ],
        };
      },
    },
    aiModeration: {
      check(guild, config) {
        if (config.enabled && !config.channelId) throw new Error('Salon des signalements : choisis un salon pour activer la modération IA.');
      },
      view(guild, config) {
        const notes = [];
        const used = resolveAi(guild);
        const usedName = used && listProviders(guild).find((x) => x.id === used.provider)?.name;
        if (!used) notes.push('⚠️ Aucune IA n’a de clé sur ce serveur : ajoute-en une dans l’onglet 🧠 IA du serveur.');
        else notes.push(`✅ La modération utilise ${usedName}${used.model ? ` (modèle ${used.model})` : ''} : à changer dans l’onglet 🧠 IA du serveur.`);
        if (!client.options.intents.has(GatewayIntentBits.MessageContent)) notes.push('⚠️ La modération IA a besoin de « Message Content Intent » (Developer Portal → Bot) pour lire les messages.');
        const state = aiModerationStatus(guild.id);
        if (config.enabled) notes.push(`📊 ${state.analyses} analyse(s) dans la dernière heure (limite : ${config.perHour}) · ${state.flagged} signalement(s) depuis le démarrage du bot.`);
        if (state.limited) notes.push('⚠️ Limite d’analyses atteinte : les messages ne sont plus analysés jusqu’à l’heure suivante.');
        if (state.lastError && state.lastError !== 'no-ai') notes.push(`⚠️ Dernière erreur de l’IA : ${state.lastError}`);
        notes.push(...permNote(guild, [[PermissionFlagsBits.ManageMessages, 'Gérer les messages'], [PermissionFlagsBits.ModerateMembers, 'Exclure temporairement des membres']]));
        return { notes };
      },
    },
    aiTools: {
      view(guild, config) {
        const notes = [];
        const missingKey = (provider) => {
          const p = listProviders(guild).find((x) => x.id === provider);
          if (p && !p.ready) {
            notes.push(p.local
              ? '⚠️ L’IA locale n’est pas branchée : indique son adresse dans l’onglet 🧠 IA du serveur.'
              : `⚠️ Images : aucune clé ${p.name} pour ce serveur. Ajoute-la dans l’onglet 🧠 IA du serveur (choisis ${p.name} → colle ta clé).`);
          }
        };
        // The AI actually used (set in the "IA du serveur" tab)
        const used = resolveAi(guild);
        const usedName = used && listProviders(guild).find((x) => x.id === used.provider)?.name;
        if (!used) notes.push('⚠️ Aucune IA n’a de clé sur ce serveur : ajoute-en une dans l’onglet 🧠 IA du serveur.');
        else notes.push(`✅ Les outils utilisent ${usedName}${used.model ? ` (modèle ${used.model})` : ''} : à changer dans l’onglet 🧠 IA du serveur.`);
        if (config.images) missingKey(config.imageProvider);
        if (!client.options.intents.has(GatewayIntentBits.MessageContent) && (config.summary || config.reactions)) {
          notes.push('⚠️ /resume et la traduction par réaction ont besoin de « Message Content Intent » (Developer Portal → Bot).');
        }
        return { notes };
      },
    },
    gameServers: {
      // After saving: check right away (and post the status message), without making the dashboard wait
      onSave(guild, config) {
        if (config.enabled) for (const server of config.servers) games.refresh(guild, server).catch(() => {});
      },
      view(guild, config) {
        const icon = (state) => (state.online === true ? '🟢' : state.online === false ? '🔴' : '⏳');
        const sub = (server, state) =>
          state.online === true && state.info
            ? `${state.info.players}/${state.info.maxPlayers} joueurs${state.info.map ? ` · ${state.info.map}` : ''} · ${state.info.ping} ms`
            : state.error
              ? `Ne répond pas : ${state.error}`
              : 'Pas encore vérifié';
        return {
          list: {
            title: '📡 Statut en direct',
            empty: 'Ajoute un serveur ci-dessus puis enregistre.',
            // Buttons of each server: restart (or cancel the planned restart) and delete, right away
            rows: config.servers.map((s) => {
              const state = games.stateOf(guild, s);
              const restart = games.plannedRestart(guild, s);
              const when = restart && new Date(restart).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
              return {
                icon: icon(state),
                main: `${s.name} · ${s.host}:${s.port}`,
                sub: `${sub(s, state)}${s.rconPort ? ` · RCON ${s.rconPassword ? 'configuré' : 'sans mot de passe'}` : ''}${restart ? ` · 🔄 redémarrage à ${when}` : ''}`,
                actions: [
                  ...(s.rconPort && s.rconPassword
                    ? [restart
                      ? { id: `cancel:${s.id}`, label: '❎ Annuler le redémarrage' }
                      : { id: `restart:${s.id}`, label: '🔄 Redémarrer', confirm: `Redémarrer ${s.name} ? Les joueurs sont prévenus ${s.countdown} min avant en jeu.` }]
                    : []),
                  { id: `remove:${s.id}`, label: '🗑️ Supprimer', danger: true, confirm: `Supprimer ${s.name} ? Son message de statut sera effacé.` },
                ],
              };
            }),
          },
          // Player history (chart, 24 h or 7 days, chosen in the dashboard)
          charts: config.servers.map((s) => ({ title: `👥 Joueurs connectés · ${s.name}`, points: games.playerHistory(guild, s) })),
          actions: config.servers.length ? [{ id: 'refresh', label: '🔄 Vérifier maintenant' }] : [],
          notes: [
            'Les adresses du réseau local (127.0.0.1, 192.168.x…) ne sont acceptées que sur les serveurs Discord du propriétaire du bot.',
            ...(config.whitelistRole
              ? [`🎮 ${games.linkCount(guild.id)} membre(s) ont lié leur pseudo en jeu (/pseudo-jeu lier). Whitelist gérée sur : ${config.servers.filter((s) => s.whitelist).map((s) => s.name).join(', ') || 'aucun serveur (coche « Gérer la whitelist »)'}.`]
              : []),
          ],
        };
      },
      // id = the server's identifier (button on its row)
      actions: {
        async refresh(guild) {
          const { servers } = getFeature(guild.id, 'gameServers');
          await Promise.all(servers.map((s) => games.refresh(guild, s).catch(() => null)));
          return 'Statut mis à jour.';
        },
        async remove(guild, id) {
          const server = await games.removeServer(guild, id);
          return `${server.name} supprimé.`;
        },
        restart(guild, id) {
          const server = getFeature(guild.id, 'gameServers').servers.find((s) => s.id === id);
          if (!server) throw new Error('Serveur introuvable.');
          games.scheduleRestart(guild, server, server.countdown, 'demandé depuis le dashboard');
          return `Redémarrage de ${server.name} dans ${server.countdown} min : les joueurs sont prévenus en jeu.`;
        },
        cancel(guild, id) {
          const server = getFeature(guild.id, 'gameServers').servers.find((s) => s.id === id);
          if (!server || !games.cancelRestart(guild, server)) throw new Error('Aucun redémarrage prévu.');
          return 'Redémarrage annulé.';
        },
      },
    },
    invites: {
      onSave: (guild, config) => config.enabled && cacheInvites(guild),
      async view(guild) {
        const top = inviteTop(guild.id);
        const ids = top.map((s) => s.userId).filter((id) => !guild.members.cache.has(id));
        if (ids.length) await guild.members.fetch({ user: ids }).catch(() => null);
        return {
          list: {
            title: '📨 Meilleurs inviteurs',
            empty: 'Aucune invitation suivie pour l’instant.',
            rows: top.map((s, i) => ({ avatar: avatarOf(guild, s.userId), main: `#${i + 1} ${nameOf(guild, s.userId)}`, sub: `${s.total} invitation${s.total > 1 ? 's' : ''} · ${s.joins} arrivées · ${s.leaves} départs` })),
          },
          notes: permNote(guild, [[PermissionFlagsBits.ManageGuild, 'Gérer le serveur']]),
        };
      },
    },
  };
}

// Small numbers on the dashboard home and dots in the sidebar
function featureStats(guildId) {
  return Object.fromEntries(
    Object.keys(FEATURES).map((name) => {
      const config = getFeature(guildId, name);
      return [name, { enabled: Boolean(config.enabled), count: (config.list ?? config.servers)?.length ?? 0 }];
    }),
  );
}

function featureRoutes(app, client, auth, guildAccess) {
  const HOOKS = hooks(client);
  const known = (req, res, next) => (FEATURES[req.params.name] ? next() : res.status(404).json({ error: 'Module inconnu.' }));
  const view = async (guild, name, config) => (await HOOKS[name]?.view?.(guild, config)) ?? {};
  const handle = (handler) => async (req, res) => {
    try {
      res.json(await handler(req, req.guild, req.params.name));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  };

  // The config sent back to the dashboard never contains secrets (RCON password…): publicConfig masks them
  app.get('/api/guilds/:id/features/:name', auth, guildAccess, known, handle(async (req, guild, name) => {
    const config = getFeature(guild.id, name);
    return { schema: schemaOf(name), config: publicConfig(name, config), extra: await view(guild, name, config) };
  }));

  app.put('/api/guilds/:id/features/:name', auth, guildAccess, known, handle(async (req, guild, name) => {
    const previous = getFeature(guild.id, name);
    const config = parseFeature(name, req.body, guild);
    await HOOKS[name]?.check?.(guild, config);
    await HOOKS[name]?.onSave?.(guild, config, previous);
    saveFeature(guild.id, name, config);
    return { config: publicConfig(name, config), extra: await view(guild, name, config) };
  }));

  app.post('/api/guilds/:id/features/:name/actions/:action', auth, guildAccess, known, handle(async (req, guild, name) => {
    // "action:id": button on a row of the list (e.g. remove:<server id>)
    const [actionName, id] = req.params.action.split(':');
    // Only declared actions (not "constructor", "toString"… inherited by every object)
    const actions = HOOKS[name]?.actions;
    if (!actions || !Object.hasOwn(actions, actionName)) throw new Error('Action inconnue.');
    const action = actions[actionName];
    const message = await action(guild, id);
    const config = getFeature(guild.id, name);
    return { message, config: publicConfig(name, config), extra: await view(guild, name, config) };
  }));

  // ---------- "✨ Rédiger" button: the AI writes or improves a dashboard text ----------

  app.post('/api/guilds/:id/ai/write', auth, guildAccess, handle(async (req, guild) => {
    const prompt = String(req.body?.prompt ?? '').trim().slice(0, 1000);
    const current = String(req.body?.current ?? '').trim().slice(0, 4000);
    const max = Math.min(4000, Math.max(50, Number.parseInt(req.body?.max, 10) || 1000));
    if (!prompt && !current) throw new Error('Dis à l’IA ce que le texte doit contenir.');
    if (takeQuota(guild.id, req.session.user.id, 'write', 30, 3600000)) throw new Error('Limite atteinte (30 textes par heure). Réessaie plus tard.');
    return { text: await writeText(guild, { kind: String(req.body?.kind ?? 'generic'), prompt, current, max }) };
  }));

  // ---------- Public leaderboard (no login) ----------

  app.get('/leaderboard/:guildId', (req, res) => res.sendFile(path.join(__dirname, 'public', 'leaderboard.html')));

  // Page open to everyone without login: each page is cached for 30 seconds, so that repeated reloads
  // don't trigger member requests to Discord
  const publicPages = new Map(); // guildId:page → { body, at }
  app.get('/api/public/leaderboard/:guildId', async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    const config = guild && getFeature(guild.id, 'levels');
    if (!config?.enabled || !config.publicLeaderboard) return res.status(404).json({ error: 'Ce classement n’existe pas ou n’est pas public.' });
    const page = Math.max(0, Math.min(99, Number.parseInt(req.query.page, 10) || 0));
    const key = `${guild.id}:${page}`;
    const hit = publicPages.get(key);
    if (hit && Date.now() - hit.at < 30_000) return res.json(hit.body);
    const body = {
      guild: { name: guild.name, icon: guild.iconURL({ size: 128 }), members: guild.memberCount },
      bot: { name: client.user.username, avatar: client.user.displayAvatarURL({ size: 64 }) },
      users: (await levels.leaderboard(guild, 50, page * 50)).map(({ id, ...u }) => u),
      total: levels.ranking(guild.id).length,
      page,
    };
    if (publicPages.size > 1000) publicPages.clear();
    publicPages.set(key, { body, at: Date.now() });
    res.json(body);
  });
}

module.exports = { featureRoutes, featureStats };

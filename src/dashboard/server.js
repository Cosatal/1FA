// Web server of the dashboard (Express), started by index.js once the bot is connected.
// Here: Discord login (OAuth2), page security, server access, and the routes for welcome,
// tickets, AI, fonts, language and settings. The other routes live in separate files:
//   modules.js (reaction roles, moderation, polls, giveaways, alerts) · features.js (schema-based modules)
//   announce.js (announcements) · backup.js (backup) · staff.js (ticket staff panel)
// The pages themselves (HTML, CSS, browser JavaScript) are in public/.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { loadImage } = require('@napi-rs/canvas');
const { ChannelType, GatewayIntentBits, PermissionFlagsBits } = require('discord.js');
const { getTicketConfig, saveTicketConfig } = require('../features/tickets/ticket-store');
const welcomeStore = require('../features/welcome/welcome-store');
const { isEmoji } = require('../features/tickets/tickets');
const { renderForGuild, bannerFile, BANNERS_DIR } = require('../features/welcome/welcome-card');
const { publishCaptcha, captchaConfig, CAPTCHA_LEVELS } = require('../features/welcome/captcha');
const { publishTicketPanel } = require('../features/tickets/ticket-channels');
const { FONTS_DIR, listFonts, addFont, removeFont } = require('../core/fonts');
const { PROVIDERS, listProviders, listModels, testProvider, guildLocalCred, guildAi, setGuildAi } = require('../features/ai/ai-support');
const { setGuildKey } = require('../core/settings');
const { W, H, SYSTEM_FONTS } = require('./public/card-renderer');
const { staffRoutes, forgetPanelAccess } = require('./staff');
const { moduleRoutes, moduleStats, isBotOwner, parseModeration } = require('./modules');
const transcripts = require('../features/tickets/transcripts');
const { CREATOR, OFFICIAL_URL, inviteUrl } = require('../core/credits');
const { featureRoutes, featureStats } = require('./features');
const { announceRoutes } = require('./announce');
const { backupRoutes } = require('./backup');
const { guildStats } = require('../features/stats');
const { guildLang, setGuildLang } = require('../core/language');
const { FEATURES } = require('../core/feature-config');
const { logActivity, queryActivity, SOURCES } = require('../core/activity');
const { HEX, str, isUrl, isText } = require('./util');
const { securityHeaders, sameOrigin, rateLimit } = require('./security');
const { every } = require('../core/scheduler');

const API = 'https://discord.com/api/v10';

// AIs offered to a server, without any secret
const aiProvidersOf = (guild) =>
  listProviders(guild).map(({ id, name, site, ready, own, ending, shared, local, url, hasKey }) => ({ id, name, site, ready, own, ending, shared, local, url, hasKey }));
const MAX_BANNER = 8 * 1024 * 1024;
const MAX_FONT = 5 * 1024 * 1024;

// Dashboard sessions in memory. express-session's default store never deletes expired sessions
// (memory grows with every visit): this one cleans up every hour
class SessionStore extends session.Store {
  constructor() {
    super();
    this.sessions = new Map(); // id → { json, expires }
    every('sessions-cleanup', 3600000, () => {
      for (const [id, s] of this.sessions) if (s.expires < Date.now()) this.sessions.delete(id);
    });
  }
  get(id, callback) {
    const s = this.sessions.get(id);
    if (s && s.expires < Date.now()) this.sessions.delete(id);
    callback(null, s && s.expires >= Date.now() ? JSON.parse(s.json) : null);
  }
  set(id, data, callback) {
    const expires = data.cookie?.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 86400000;
    this.sessions.set(id, { json: JSON.stringify(data), expires });
    callback?.(null);
  }
  destroy(id, callback) {
    this.sessions.delete(id);
    callback?.(null);
  }
  touch(id, data, callback) {
    const s = this.sessions.get(id);
    if (s && data.cookie?.expires) s.expires = new Date(data.cookie.expires).getTime();
    callback?.(null);
  }
}

function startDashboard(client) {
  const { CLIENT_ID, CLIENT_SECRET } = process.env;
  if (!CLIENT_SECRET) {
    console.log('Dashboard disabled: add CLIENT_SECRET to .env to enable it.');
    return;
  }
  const port = Number(process.env.DASHBOARD_PORT) || 3000;
  const baseUrl = process.env.DASHBOARD_URL || `http://localhost:${port}`;
  const redirectUri = `${baseUrl}/callback`;

  const app = express();
  // Hosted over HTTPS, the site usually goes through the host's proxy: required for the secure cookie
  if (baseUrl.startsWith('https://')) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Security headers on every page and file (security.js)
  app.use(securityHeaders(baseUrl));
  app.use(express.json({ limit: '12mb' }));
  app.use(
    session({
      // Without SESSION_SECRET, sessions are lost on every restart (you have to log in again)
      secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
      store: new SessionStore(),
      resave: false,
      saveUninitialized: false,
      // Over HTTPS (hosted), the login cookie never travels in clear text
      cookie: { httpOnly: true, sameSite: 'lax', secure: baseUrl.startsWith('https://'), maxAge: 7 * 24 * 3600 * 1000 },
    }),
  );
  // Request limits (per person and per minute) and changes only accepted from the dashboard's own pages (security.js)
  app.use(['/login', '/callback'], rateLimit({ max: 20, windowMs: 10 * 60_000, name: 'connexion' }));
  app.use('/api', sameOrigin(baseUrl), rateLimit({ max: 300, name: 'dashboard' }));
  // Routes that call an AI or draw an image: slower and sometimes paid, so more limited
  app.use(
    ['/api/guilds/:id/ai-keys', '/api/guilds/:id/ai-models', '/api/guilds/:id/ai/write', '/api/guilds/:id/welcome/preview', '/api/bot-settings/test'],
    rateLimit({ max: 30, name: 'IA et aperçus' }),
  );
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/fonts', express.static(FONTS_DIR));

  // ---------- Discord login (OAuth2) ----------

  app.get('/login', (req, res) => {
    req.session.oauthState = crypto.randomBytes(16).toString('hex');
    // Page to come back to after login (e.g. /staff), only on this site
    req.session.next = /^\/[\w-]*$/.test(req.query.next ?? '') ? req.query.next : '/';
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state: req.session.oauthState,
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) return res.redirect('/');
    delete req.session.oauthState;

    try {
      const token = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
      }).then((r) => r.json());
      if (!token.access_token) throw new Error(JSON.stringify(token));

      const headers = { Authorization: `Bearer ${token.access_token}` };
      const [user, guilds] = await Promise.all([
        fetch(`${API}/users/@me`, { headers }).then((r) => r.json()),
        fetch(`${API}/users/@me/guilds`, { headers }).then((r) => r.json()),
      ]);

      // Servers where the user can "Manage Server" (or is admin / owner)
      const canManage = (g) => {
        const perms = BigInt(g.permissions);
        return g.owner || (perms & PermissionFlagsBits.Administrator) !== 0n || (perms & PermissionFlagsBits.ManageGuild) !== 0n;
      };

      const sessionUser = {
        id: user.id,
        username: user.global_name ?? user.username,
        avatarUrl: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`
          : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`,
      };
      const manageable = guilds.filter(canManage);
      const next = req.session.next || '/';
      // New session id at login: an id planted before the login (session fixation) is worthless afterwards
      await new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
      req.session.user = sessionUser;
      req.session.guildIds = manageable.map((g) => g.id);
      // To offer adding the bot to the servers where it isn't yet
      req.session.guildInfos = manageable.map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
      }));
      res.redirect(next);
    } catch (error) {
      console.error('Dashboard login failed:', error.message);
      res.status(500).send('Connexion impossible. Vérifie CLIENT_SECRET et l’adresse de redirection, puis regarde la console du bot.');
    }
  });

  app.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

  // ---------- Security ----------

  const auth = (req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'Non connecté.' }));

  // The server list comes from the login (valid for 7 days): Discord is asked again, at most once
  // per minute, whether the person can still manage the server (otherwise a removed admin would keep dashboard access)
  const managers = new Map(); // <guildId>:<userId> → { ok, at }
  async function canManage(guild, userId) {
    const key = `${guild.id}:${userId}`;
    const hit = managers.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.ok;
    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    const ok = Boolean(member?.permissions.has(PermissionFlagsBits.ManageGuild));
    if (managers.size > 10_000) managers.clear();
    managers.set(key, { ok, at: Date.now() });
    return ok;
  }
  const guildAccess = async (req, res, next) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild || !req.session.guildIds?.includes(guild.id) || !(await canManage(guild, req.session.user.id))) {
      return res.status(403).json({ error: 'Accès refusé à ce serveur.' });
    }
    req.guild = guild;
    next();
  };

  // ---------- Activity log of the dashboard (Logs tab) ----------
  // Every change made on a server (PUT, POST, DELETE) that succeeded is logged, with what was sent (secrets hidden)
  app.use('/api/guilds/:id', (req, res, next) => {
    const entry = req.method !== 'GET' && dashboardActivity(req);
    if (entry) {
      res.on('finish', () => {
        if (res.statusCode >= 400 || !req.guild) return;
        const { action, title, data = req.body } = entry;
        logActivity(req.guild.id, { source: 'dashboard', action, title: `${req.session.user.username} ${title}`, author: req.session.user, data });
      });
    }
    next();
  });

  // ---------- API ----------

  app.get('/api/me', auth, async (req, res) => {
    const guilds = req.session.guildIds
      .map((id) => client.guilds.cache.get(id))
      .filter(Boolean)
      .map((g) => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 128 }), members: g.memberCount }));
    res.json({
      user: req.session.user,
      bot: { name: client.user.username, avatar: client.user.displayAvatarURL({ size: 128 }) },
      guilds,
      // The bot owner sees the Twitch credentials box (alerts tab)
      isOwner: await isBotOwner(client, req.session.user.id).catch(() => false),
      invitable: (req.session.guildInfos ?? [])
        .filter((g) => !client.guilds.cache.has(g.id))
        .map((g) => ({ ...g, invite: inviteUrl(client, g.id) })),
      ...about(),
    });
  });

  // Credit (a name, with no link to an account), invite link and bot numbers, also shown on the login page
  const about = () => ({
    creator: CREATOR,
    official: OFFICIAL_URL,
    invite: inviteUrl(client),
    servers: client.guilds.cache.size,
    members: client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0),
  });
  app.get('/api/about', (req, res) => res.json({ bot: { name: client.user.username, avatar: client.user.displayAvatarURL({ size: 128 }) }, ...about() }));

  app.get('/api/guilds/:id', auth, guildAccess, (req, res) => {
    const g = req.guild;
    const byPosition = (a, b) => a.rawPosition - b.rawPosition;
    const open = transcripts.listConversations(g.id, { status: 'open' });
    res.json({
      guild: { id: g.id, name: g.name, icon: g.iconURL({ size: 128 }), members: g.memberCount },
      // Dashboard home numbers
      stats: { openTickets: open.length, waitingTickets: open.filter((c) => c.open.lastFrom !== 'staff').length, ...moduleStats(g.id) },
      features: featureStats(g.id),
      language: guildLang(g),
      tickets: getTicketConfig(g.id),
      welcome: welcomeStore.get(g.id),
      captcha: captchaConfig(g.id),
      welcomeIntent: client.options.intents.has(GatewayIntentBits.GuildMembers),
      customBanner: fs.existsSync(bannerFile(g.id)),
      // AIs available for the ticket assistant (ready = server's or owner's key usable)
      aiProviders: aiProvidersOf(g),
      // The server's AI (a single setting for the ticket assistant and the AI tools)
      ai: guildAi(g.id),
      fonts: listFonts(),
      channels: g.channels.cache.filter((c) => c.type === ChannelType.GuildText).sort(byPosition).map((c) => ({ id: c.id, name: c.name })),
      voiceChannels: g.channels.cache.filter((c) => c.isVoiceBased()).sort(byPosition).map((c) => ({ id: c.id, name: c.name })),
      categories: g.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).sort(byPosition).map((c) => ({ id: c.id, name: c.name })),
      // Server's custom emojis, for the dashboard emoji picker
      emojis: g.emojis.cache.filter((e) => e.available !== false).map((e) => ({ id: e.id, name: e.name, animated: e.animated, url: e.imageURL({ size: 64 }) })),
      roles: g.roles.cache
        .filter((r) => r.id !== g.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        // editable: the bot can give this role (it is below its own)
        .map((r) => ({ id: r.id, name: r.name, editable: r.editable, color: r.color ? r.hexColor : null })),
    });
  });

  // Models offered by an AI, according to the key used by this server
  app.get('/api/guilds/:id/ai-models', auth, guildAccess, async (req, res) => {
    try {
      res.json({ models: await listModels(str(req.query.provider), req.guild) });
    } catch (error) {
      res.status(400).json({ error: `Impossible de lister les modèles : ${error.message}` });
    }
  });

  // Bot language on this server (messages, embeds, buttons…)
  app.put('/api/guilds/:id/language', auth, guildAccess, (req, res) => {
    const lang = req.body?.lang;
    if (!['fr', 'en'].includes(lang)) return res.status(400).json({ error: 'Langue inconnue.' });
    setGuildLang(req.guild.id, lang);
    res.json({ language: lang });
  });

  // Server's AI keys: never sent back, only their last 4 characters
  app.get('/api/guilds/:id/ai-keys', auth, guildAccess, (req, res) => res.json({ providers: aiProvidersOf(req.guild) }));

  // The server's AI: which one and which model (empty = automatic). Used for everything: ticket assistant and AI tools
  app.put('/api/guilds/:id/ai', auth, guildAccess, (req, res) => {
    const provider = str(req.body?.provider);
    const model = str(req.body?.model);
    if (!PROVIDERS[provider]) return res.status(400).json({ error: 'IA inconnue.' });
    if (model.length > 150 || /\s/.test(model)) return res.status(400).json({ error: 'Nom de modèle invalide (150 caractères max, sans espace).' });
    setGuildAi(req.guild.id, { provider, model });
    res.json({ ai: guildAi(req.guild.id) });
  });

  // The key is tested before being saved
  app.put('/api/guilds/:id/ai-keys/:provider', auth, guildAccess, async (req, res) => {
    const { provider } = req.params;
    const key = str(req.body?.key);
    if (!PROVIDERS[provider]) return res.status(404).json({ error: 'IA inconnue.' });
    // Server's local AI: it runs on their side, the bot reaches it through a public https address (tunnel)
    if (PROVIDERS[provider].local) {
      const url = str(req.body?.url).replace(/\/+$/, '');
      if (!/^https:\/\/[^\s/]+(\/\S*)?$/.test(url) || url.length > 300) {
        return res.status(400).json({ error: 'Adresse invalide : il faut une adresse publique en https://, par exemple celle d’un tunnel Cloudflare ou ngrok (…/v1).' });
      }
      if (key.length > 300 || /\s/.test(key)) return res.status(400).json({ error: 'Clé invalide.' });
      try {
        const models = await testProvider(provider, req.guild, guildLocalCred(url, key));
        setGuildKey(req.guild.id, 'localUrl', url);
        setGuildKey(req.guild.id, PROVIDERS[provider].key, key);
        return res.json({ models, providers: aiProvidersOf(req.guild) });
      } catch (error) {
        return res.status(400).json({ error: `IA locale non enregistrée : ${error.message}.` });
      }
    }
    if (!key || key.length > 300 || /\s/.test(key)) return res.status(400).json({ error: 'Clé invalide.' });
    try {
      const models = await testProvider(provider, req.guild, key);
      setGuildKey(req.guild.id, PROVIDERS[provider].key, key);
      res.json({ models, providers: aiProvidersOf(req.guild) });
    } catch (error) {
      res.status(400).json({ error: `Clé ${PROVIDERS[provider].name} non enregistrée : ${error.message}.` });
    }
  });

  app.delete('/api/guilds/:id/ai-keys/:provider', auth, guildAccess, (req, res) => {
    const p = PROVIDERS[req.params.provider];
    if (!p) return res.status(404).json({ error: 'IA inconnue.' });
    setGuildKey(req.guild.id, p.key, '');
    if (p.local) setGuildKey(req.guild.id, 'localUrl', '');
    res.json({ providers: aiProvidersOf(req.guild) });
  });

  app.put('/api/guilds/:id/tickets', auth, guildAccess, async (req, res) => {
    const parsed = parseTickets(req.body ?? {}, req.guild);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const old = getTicketConfig(req.guild.id);
    // mode and notifyId: settings of the old DM tickets, removed
    const { mode, notifyId, ...rest } = { ...old, ...parsed.value };
    const config = rest;
    // The "Ouvrir un ticket" panel is posted (or updated if it's already in the same channel)
    config.panelMessageId = old.panelChannelId === config.panelChannelId ? old.panelMessageId : '';
    if (config.enabled) {
      try {
        config.panelMessageId = await publishTicketPanel(req.guild, config);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }
    saveTicketConfig(req.guild.id, config);
    forgetPanelAccess(req.guild.id); // removed people lose access to the staff panel right away
    res.json({ tickets: config });
  });

  // Activity log of the server (Logs tab): filters by source, author (name or id), action and dates, 50 per page
  app.get('/api/guilds/:id/activity', auth, guildAccess, (req, res) => {
    const q = req.query;
    const date = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
    res.json(
      queryActivity(req.guild.id, {
        source: SOURCES.includes(q.source) ? q.source : '',
        author: str(q.author).slice(0, 64),
        action: str(q.action).slice(0, 64),
        from: date(q.from),
        to: date(q.to),
        page: Math.max(1, parseInt(q.page, 10) || 1),
      }),
    );
  });

  // Members of the server, for the staff panel access list: search by name (?q=) or names of known ids (?ids=a,b)
  app.get('/api/guilds/:id/members', auth, guildAccess, async (req, res) => {
    const view = (m) => ({ id: m.id, name: m.displayName, tag: m.user.username, avatar: m.displayAvatarURL({ size: 64 }) });
    const q = str(req.query.q).slice(0, 32);
    if (q) {
      const found = await req.guild.members.search({ query: q, limit: 10 }).catch(() => null);
      return res.json({ members: found ? [...found.values()].map(view) : [] });
    }
    const wanted = str(req.query.ids).split(',').filter((id) => /^\d{17,20}$/.test(id)).slice(0, 50);
    const members = await Promise.all(wanted.map((id) => req.guild.members.fetch(id).catch(() => null)));
    // Members who left the server: shown with their id, so they can still be removed from the list
    res.json({ members: wanted.map((id, i) => (members[i] ? view(members[i]) : { id, name: id, tag: 'a quitté le serveur', avatar: null })) });
  });

  // Announcements (sent right away or scheduled): dashboard/announce.js
  announceRoutes(app, auth, guildAccess);

  app.put('/api/guilds/:id/welcome', auth, guildAccess, async (req, res) => {
    const parsed = parseWelcome(req.body ?? {}, req.guild);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    // The captcha has its own tab (PUT …/captcha): kept as it is
    const config = { ...parsed.value, captcha: welcomeStore.get(req.guild.id).captcha };
    welcomeStore.save(req.guild.id, config);
    res.json({ welcome: config });
  });

  // Captcha (own tab): when enabled, the verification message is posted (or updated). Same channel = same message
  app.put('/api/guilds/:id/captcha', auth, guildAccess, async (req, res) => {
    const parsed = parseCaptcha(req.body ?? {}, req.guild);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const welcome = welcomeStore.get(req.guild.id);
    const captcha = parsed.value;
    captcha.messageId = welcome.captcha.channelId === captcha.channelId ? welcome.captcha.messageId : '';
    if (captcha.enabled) {
      try {
        captcha.messageId = await publishCaptcha(req.guild, captcha);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }
    welcomeStore.save(req.guild.id, { ...welcome, captcha });
    res.json({ captcha });
  });

  // Final render by the bot, with the settings being edited (not saved yet) and the logged-in person's avatar
  // "Envoyer le panneau" button: posts (or updates, or reposts if it was deleted) the "Ouvrir un ticket" message
  app.post('/api/guilds/:id/tickets/panel', auth, guildAccess, async (req, res) => {
    const config = getTicketConfig(req.guild.id);
    if (!config.enabled) return res.status(400).json({ error: 'Active d’abord les tickets (interrupteur en haut de l’onglet), puis enregistre.' });
    try {
      config.panelMessageId = await publishTicketPanel(req.guild, config);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    saveTicketConfig(req.guild.id, config);
    res.json({ url: `https://discord.com/channels/${req.guild.id}/${config.panelChannelId}/${config.panelMessageId}`, tickets: config });
  });

  app.post('/api/guilds/:id/welcome/preview', auth, guildAccess, async (req, res) => {
    const parsed = parseWelcome(req.body ?? {}, req.guild);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const config = parsed.value;
    const { user } = req.session;
    const member = await req.guild.members.fetch(user.id).catch(() => null);
    const card = await renderForGuild(req.guild, config, {
      avatarUrl: member?.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }) ?? user.avatarUrl,
      name: member?.displayName ?? user.username,
    });
    res.type('image/jpeg').send(card);
  });

  app.post('/api/guilds/:id/welcome/banner', auth, guildAccess, async (req, res) => {
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(req.body?.image ?? '');
    if (!match) return res.status(400).json({ error: 'Formats acceptés : PNG, JPG ou WEBP.' });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > MAX_BANNER) return res.status(400).json({ error: 'Image trop lourde (8 Mo max).' });
    try {
      await loadImage(buffer);
    } catch {
      return res.status(400).json({ error: 'Image illisible.' });
    }
    fs.mkdirSync(BANNERS_DIR, { recursive: true });
    fs.writeFileSync(bannerFile(req.guild.id), buffer);
    welcomeStore.save(req.guild.id, { ...welcomeStore.get(req.guild.id), banner: 'custom' });
    res.json({ ok: true });
  });

  app.get('/api/guilds/:id/welcome/banner', auth, guildAccess, (req, res) => {
    const file = bannerFile(req.guild.id);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Aucune bannière perso.' });
    // The file is stored without an extension: the type is guessed from its first bytes
    const head = fs.readFileSync(file).subarray(0, 12);
    const type = head[0] === 0x89 ? 'image/png' : head.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : 'image/jpeg';
    res.type(type).sendFile(file);
  });

  app.delete('/api/guilds/:id/welcome/banner', auth, guildAccess, (req, res) => {
    fs.rmSync(bannerFile(req.guild.id), { force: true });
    welcomeStore.save(req.guild.id, { ...welcomeStore.get(req.guild.id), banner: 'none' });
    res.json({ ok: true });
  });

  // ---------- Uploaded fonts (shared by every server) ----------

  app.post('/api/guilds/:id/fonts', auth, guildAccess, (req, res) => {
    const match = /^data:[^;]*;base64,(.+)$/.exec(req.body?.data ?? '');
    if (!match) return res.status(400).json({ error: 'Fichier de police manquant.' });
    const buffer = Buffer.from(match[1], 'base64');
    if (buffer.length > MAX_FONT) return res.status(400).json({ error: 'Police trop lourde (5 Mo max).' });
    let font;
    try {
      font = addFont(str(req.body?.name), buffer);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    if (!font) return res.status(400).json({ error: 'Ce fichier n’est pas une police TTF ou OTF valide.' });
    res.json({ font });
  });

  // A font may be used by other servers' welcome images: only the bot owner can delete it
  app.delete('/api/guilds/:id/fonts/:family', auth, guildAccess, async (req, res) => {
    if (!(await isBotOwner(client, req.session.user.id).catch(() => false))) {
      return res.status(403).json({ error: 'Les polices sont partagées entre tous les serveurs : seul le propriétaire du bot peut en supprimer.' });
    }
    if (!removeFont(req.params.family)) return res.status(404).json({ error: 'Police introuvable.' });
    res.json({ ok: true });
  });

  staffRoutes(app, client, auth);
  moduleRoutes(app, client, auth, guildAccess);
  featureRoutes(app, client, auth, guildAccess);
  // Backup: the same validation as the dashboard forms
  backupRoutes(app, auth, guildAccess, { parseTickets, parseWelcome, parseCaptcha, parseModeration, commandNames: new Set(client.commands.keys()) });

  // Statistics: joins, leaves, messages per day, peak hours, most active members (7, 30 or 90 days)
  app.get('/api/guilds/:id/stats', auth, guildAccess, async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const stats = guildStats(req.guild.id, Math.min(days, 90));
    // The per-member ranking only covers the last 30 days (beyond that, the details are erased)
    const missing = stats.top.map((t) => t.userId).filter((id) => !req.guild.members.cache.has(id));
    if (missing.length) await req.guild.members.fetch({ user: missing }).catch(() => null);
    res.json({
      ...stats,
      members: req.guild.memberCount,
      intents: { members: client.options.intents.has(GatewayIntentBits.GuildMembers), content: client.options.intents.has(GatewayIntentBits.MessageContent) },
      top: stats.top.map((t) => {
        const member = req.guild.members.cache.get(t.userId);
        const user = member?.user ?? client.users.cache.get(t.userId);
        return { ...t, name: member?.displayName ?? user?.username ?? 'Ancien membre', avatar: (member ?? user)?.displayAvatarURL({ size: 64 }) ?? 'https://cdn.discordapp.com/embed/avatars/0.png' };
      }),
    });
  });

  app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Fichier trop lourd.' });
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Erreur interne du bot.' });
  });

  app.listen(port, () => console.log(`Dashboard online: ${baseUrl}`));
}

// Captcha settings sent by its tab (messageId is set by the route)
function parseCaptcha(body, guild) {
  const channelId = str(body.channelId);
  const roleId = str(body.roleId);
  const enabled = body.enabled === true;
  if (enabled && !isText(guild, channelId)) return { error: 'Captcha : choisis le salon de vérification.' };
  if (enabled && !guild.roles.cache.get(roleId)?.editable) return { error: 'Captcha : choisis un rôle d’accès placé sous celui du bot.' };
  if (!CAPTCHA_LEVELS.includes(body.level)) return { error: 'Captcha : niveau de sécurité inconnu.' };
  const int = (value, min, max, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Captcha : ${label} entre ${min} et ${max}.`);
    return n;
  };
  try {
    return {
      value: {
        enabled, channelId, roleId, messageId: '', level: body.level,
        maxFails: int(body.maxFails, 1, 10, 'échecs avant sanction'),
        kick: body.kick === true,
        cooldown: int(body.cooldown, 1, 60, 'délai entre deux tentatives (secondes)'),
        ttl: int(body.ttl, 60, 3600, 'durée de vie d’un code (secondes)'),
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

// Buttons of the schema-based modules (features.js → actions)
const ACTION_NAMES = { refresh: 'Vérifier maintenant', restart: 'Redémarrer', cancel: 'Annuler le redémarrage', remove: 'Supprimer' };

// What a dashboard request changes: { action, title (after the person's name), data? }, or null if it's not logged
// (previews, AI writing help…). path = the part after /api/guilds/<id>/
const DASHBOARD_ACTIONS = [
  ['PUT', /^tickets$/, () => ({ action: 'tickets.updated', title: 'a mis à jour les tickets' })],
  ['POST', /^tickets\/panel$/, () => ({ action: 'tickets.panel_sent', title: 'a envoyé le panneau des tickets', data: null })],
  ['PUT', /^welcome$/, () => ({ action: 'welcome.updated', title: 'a mis à jour la bienvenue' })],
  ['PUT', /^captcha$/, () => ({ action: 'captcha.updated', title: 'a mis à jour le captcha' })],
  ['POST', /^welcome\/banner$/, () => ({ action: 'welcome.banner_added', title: 'a importé une bannière de bienvenue', data: null })],
  ['DELETE', /^welcome\/banner$/, () => ({ action: 'welcome.banner_removed', title: 'a supprimé la bannière de bienvenue', data: null })],
  ['POST', /^fonts$/, () => ({ action: 'fonts.added', title: 'a importé une police', data: null })],
  ['DELETE', /^fonts\/(.+)$/, (m) => ({ action: 'fonts.removed', title: `a supprimé la police ${decodeURIComponent(m[1])}`, data: null })],
  ['PUT', /^language$/, (m, req) => ({ action: 'language.changed', title: `a mis le bot en ${req.body?.lang === 'fr' ? 'français' : 'anglais'}` })],
  ['PUT', /^ai$/, () => ({ action: 'ai.updated', title: 'a changé l’IA du serveur' })],
  ['PUT', /^ai-keys\/(\w+)$/, (m) => ({ action: 'ai.key_saved', title: `a enregistré une clé IA (${m[1]})` })],
  ['DELETE', /^ai-keys\/(\w+)$/, (m) => ({ action: 'ai.key_removed', title: `a supprimé une clé IA (${m[1]})`, data: null })],
  ['PUT', /^features\/(\w+)$/, (m) => ({ action: 'module.updated', title: `a mis à jour le module ${FEATURES[m[1]]?.title ?? m[1]}` })],
  ['POST', /^features\/(\w+)\/actions\/(\w+)/, (m) => ({ action: 'module.action', title: `a utilisé « ${ACTION_NAMES[m[2]] ?? m[2]} » (${FEATURES[m[1]]?.title ?? m[1]})`, data: null })],
  ['POST', /^backup$/, () => ({ action: 'backup.imported', title: 'a importé une sauvegarde des réglages', data: null })],
  ['POST', /^announce$/, (m, req) => (req.body?.scheduleAt != null
    ? { action: 'announce.scheduled', title: 'a programmé une annonce' }
    : { action: 'announce.sent', title: 'a envoyé une annonce' })],
  ['DELETE', /^announce\/scheduled\//, () => ({ action: 'announce.cancelled', title: 'a annulé une annonce programmée', data: null })],
  ['PUT', /^moderation$/, () => ({ action: 'moderation.updated', title: 'a mis à jour la modération' })],
  ['PUT', /^commands\/(.+)$/, (m) => ({ action: 'commands.updated', title: `a modifié la commande /${decodeURIComponent(m[1])}` })],
  ['PUT', /^roles-panels\//, () => ({ action: 'reaction_roles.saved', title: 'a enregistré un panneau de rôles-réactions' })],
  ['DELETE', /^roles-panels\//, () => ({ action: 'reaction_roles.deleted', title: 'a supprimé un panneau de rôles-réactions', data: null })],
  ['POST', /^polls$/, () => ({ action: 'poll.created', title: 'a créé un sondage' })],
  ['POST', /^giveaways$/, () => ({ action: 'giveaway.created', title: 'a lancé un giveaway' })],
  ['POST', /^giveaways\/\w+\/end$/, () => ({ action: 'giveaway.ended', title: 'a terminé un giveaway', data: null })],
  ['POST', /^giveaways\/\w+\/reroll$/, () => ({ action: 'giveaway.rerolled', title: 'a relancé le tirage d’un giveaway', data: null })],
  ['DELETE', /^giveaways\//, () => ({ action: 'giveaway.deleted', title: 'a supprimé un giveaway', data: null })],
  ['POST', /^alerts$/, () => ({ action: 'alert.added', title: 'a ajouté une alerte réseaux' })],
  ['POST', /^alerts\/\w+\/test$/, () => ({ action: 'alert.tested', title: 'a testé une alerte réseaux', data: null })],
  ['DELETE', /^alerts\//, () => ({ action: 'alert.removed', title: 'a supprimé une alerte réseaux', data: null })],
];
function dashboardActivity(req) {
  const sub = req.path.replace(/^\/+|\/+$/g, '');
  for (const [method, pattern, describe] of DASHBOARD_ACTIONS) {
    const m = method === req.method && pattern.exec(sub);
    if (m) return describe(m, req);
  }
  return null;
}

function parseTickets(body, guild) {
  const staffId = str(body.staffId);
  const received = str(body.received);
  const closed = str(body.closed);
  if (staffId && !guild.roles.cache.has(staffId)) return { error: 'Rôle staff introuvable.' };
  const panelChannelId = str(body.panelChannelId);
  const categoryId = str(body.categoryId);
  if (panelChannelId && !isText(guild, panelChannelId)) return { error: 'Salon du bouton « Ouvrir un ticket » introuvable.' };
  if (body.enabled === true && !panelChannelId) return { error: 'Choisis le salon où poster le bouton « Ouvrir un ticket ».' };
  if (categoryId && guild.channels.cache.get(categoryId)?.type !== ChannelType.GuildCategory) return { error: 'Catégorie des tickets introuvable.' };
  const notifyChannelId = str(body.notifyChannelId);
  if (notifyChannelId && !isText(guild, notifyChannelId)) return { error: 'Salon des notifications du staff introuvable.' };

  // Staff panel access: roles of the server (not @everyone) and member ids
  const idList = (list) => [...new Set((Array.isArray(list) ? list : []).map(str))];
  const accessRoles = idList(body.panelAccess?.roles);
  const accessMembers = idList(body.panelAccess?.members);
  if (accessRoles.some((id) => id === guild.id || !guild.roles.cache.has(id))) return { error: 'Accès au panel staff : rôle introuvable.' };
  if (accessMembers.some((id) => !/^\d{17,20}$/.test(id))) return { error: 'Accès au panel staff : membre invalide.' };
  if (accessRoles.length > 25 || accessMembers.length > 50) return { error: 'Accès au panel staff : 25 rôles et 50 membres maximum.' };
  const panelAccess = { roles: accessRoles, members: accessMembers };
  if (received.length > 4000) return { error: 'Le message de confirmation fait 4000 caractères max.' };
  if (closed.length > 4000) return { error: 'Le message de fin fait 4000 caractères max.' };

  const title = str(body.title);
  const description = str(body.description);
  const image = str(body.image);
  const placeholder = str(body.placeholder);

  if (!title || title.length > 256) return { error: 'Le titre doit faire entre 1 et 256 caractères.' };
  if (!description || description.length > 4000) return { error: 'La description doit faire entre 1 et 4000 caractères.' };
  if (image && !isUrl(image)) return { error: 'Le lien de l’image doit commencer par https://' };
  if (!placeholder || placeholder.length > 150) return { error: 'Le texte du menu doit faire entre 1 et 150 caractères.' };
  if (!Array.isArray(body.options) || body.options.length > 25) return { error: '25 options maximum.' };

  const options = [];
  const ids = new Set();
  for (const [i, o] of body.options.entries()) {
    const label = str(o?.label);
    const description = str(o?.description);
    const emoji = str(o?.emoji);
    if (!label || label.length > 100) return { error: `Option ${i + 1} : le nom doit faire entre 1 et 100 caractères.` };
    if (description.length > 100) return { error: `Option ${i + 1} : la description fait 100 caractères max.` };
    if (emoji && !isEmoji(emoji)) return { error: `Option ${i + 1} : emoji invalide (mets un seul emoji).` };
    // New options get a unique id (used as the value in the dropdown)
    let id = /^[a-z0-9]{1,20}$/.test(o?.id) ? o.id : `${Date.now().toString(36)}${i}`;
    while (ids.has(id)) id += 'x';
    ids.add(id);
    options.push({ id, label, description, emoji });
  }

  const instructions = typeof body.ai?.instructions === 'string' ? body.ai.instructions.trim() : '';
  if (instructions.length > 8000) return { error: 'Les infos pour l’IA font 8000 caractères max.' };
  // The AI and model are set in the "IA du serveur" tab (ai-guild); these are only kept as a legacy setting
  const provider = PROVIDERS[str(body.ai?.provider)] ? str(body.ai.provider) : 'anthropic';
  const model = str(body.ai?.model).slice(0, 150);
  const ai = { enabled: body.ai?.enabled === true, instructions, provider, model };

  return { value: { enabled: body.enabled === true, staffId, panelChannelId, categoryId, notifyChannelId, received, closed, title, description, image, placeholder, options, ai, panelAccess } };
}


// Validates the whole welcome config sent by the editor (out-of-range numbers are clamped)
function parseWelcome(body, guild) {
  const fail = (message) => {
    throw new Error(message);
  };
  const color = (value, label) => (HEX.test(str(value)) ? str(value) : fail(`${label} : couleur invalide.`));
  const num = (value, min, max, label) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fail(`${label} : nombre invalide.`);
  const pick = (value, allowed, label) => (allowed.includes(value) ? value : fail(`${label} : valeur invalide.`));
  const fonts = [...SYSTEM_FONTS, ...listFonts().map((f) => f.family)];

  try {
    const channelId = str(body.channelId);
    if (channelId && !isText(guild, channelId)) fail('Salon de bienvenue introuvable.');
    const message = str(body.message);
    if (message.length > 2000) fail('Le texte du message fait 2000 caractères max.');
    // text: simple message (+ image) · embed: embed with the image inside · canvas: the welcome image alone
    const format = pick(body.format, ['text', 'embed', 'canvas'], 'Format du message');
    const card = format === 'canvas' || body.card !== false;
    const text = (value, max, label) => (str(value).length <= max ? str(value) : fail(`${label} : ${max} caractères max.`));

    const e = body.embed ?? {};
    if (!Array.isArray(e.fields ?? []) || (e.fields ?? []).length > 10) fail('Embed : 10 champs maximum.');
    const embed = {
      color: color(e.color, 'Embed'),
      author: text(e.author, 256, 'Auteur de l’embed'),
      title: text(e.title, 256, 'Titre de l’embed'),
      description: text(e.description, 4000, 'Description de l’embed'),
      fields: (e.fields ?? [])
        .map((f, i) => ({ name: text(f?.name, 256, `Champ ${i + 1}`), value: text(f?.value, 1024, `Champ ${i + 1}`), inline: f?.inline === true }))
        .filter((f) => f.name || f.value),
      thumbnail: e.thumbnail !== false,
      footer: text(e.footer, 2048, 'Bas de page de l’embed'),
    };
    // Discord refuses an empty message
    if (body.enabled === true) {
      if (format === 'text' && !message && !card) fail('Le message de bienvenue est vide : ajoute un texte ou l’image.');
      if (format === 'embed' && !embed.title && !embed.description && !embed.fields.length && !card) fail('L’embed est vide : ajoute un titre, une description ou l’image.');
    }
    // Embed fields can't be empty: the missing side is filled in
    embed.fields = embed.fields.map((f) => ({ ...f, name: f.name || '​', value: f.value || '​' }));

    const editable = (id) => guild.roles.cache.get(id)?.editable;
    const dm = { enabled: body.dm?.enabled === true, message: text(body.dm?.message, 2000, 'Message privé') };
    if (dm.enabled && !dm.message) fail('Le message privé est vide.');

    const roles = [...new Set(Array.isArray(body.autoroles?.roles) ? body.autoroles.roles : [])];
    if (roles.length > 10) fail('10 rôles automatiques maximum.');
    if (roles.some((id) => !editable(id))) fail('Rôles automatiques : choisis des rôles placés sous celui du bot.');
    const autoroles = { enabled: body.autoroles?.enabled === true, roles };

    const goodbye = { enabled: body.goodbye?.enabled === true, channelId: str(body.goodbye?.channelId), message: text(body.goodbye?.message, 2000, 'Message d’au revoir') };
    if (goodbye.enabled && !isText(guild, goodbye.channelId)) fail('Choisis le salon du message d’au revoir.');
    if (goodbye.enabled && !goodbye.message) fail('Le message d’au revoir est vide.');

    // No default banner anymore: the old "default" becomes "none" (plain background)
    const banner = pick(body.banner === 'default' ? 'none' : body.banner, ['custom', 'none'], 'Bannière');
    if (banner === 'custom' && !fs.existsSync(bannerFile(guild.id))) fail('Aucune bannière perso envoyée.');

    const o = body.overlay ?? {};
    const overlay = {
      enabled: o.enabled === true,
      mode: pick(o.mode, ['bottom', 'top', 'left', 'right', 'full'], 'Dégradé'),
      color: color(o.color, 'Dégradé'),
      opacity: num(o.opacity, 0, 1, 'Dégradé'),
      start: num(o.start, 0, 1, 'Dégradé'),
    };

    if (!Array.isArray(body.elements) || body.elements.length > 20) fail('20 éléments maximum sur l’image.');
    const ids = new Set();
    const elements = body.elements.map((e, i) => {
      const label = `Élément ${i + 1}`;
      const id = str(e?.id);
      if (!/^[\w-]{1,24}$/.test(id) || ids.has(id)) fail(`${label} : identifiant invalide.`);
      ids.add(id);
      const base = {
        id,
        visible: e.visible !== false,
        opacity: num(e.opacity, 0, 1, label),
        x: num(e.x, -1000, W + 1000, label),
        y: num(e.y, -1000, H + 1000, label),
      };
      if (e.type === 'avatar') {
        return {
          ...base,
          type: 'avatar',
          size: num(e.size, 20, 1000, label),
          shape: pick(e.shape, ['circle', 'rounded', 'square'], label),
          borderWidth: num(e.borderWidth, 0, 80, label),
          borderColor: color(e.borderColor, label),
          glow: num(e.glow, 0, 150, label),
        };
      }
      if (e.type === 'text') {
        const text = typeof e.text === 'string' ? e.text : '';
        if (text.length > 200) fail(`${label} : 200 caractères max.`);
        return {
          ...base,
          type: 'text',
          text,
          font: pick(e.font, fonts, `${label} (police)`),
          weight: pick(e.weight, [400, 700, 900], label),
          size: num(e.size, 8, 400, label),
          color: color(e.color, label),
          align: pick(e.align, ['left', 'center', 'right'], label),
          uppercase: e.uppercase === true,
          shadow: num(e.shadow, 0, 60, label),
          strokeWidth: num(e.strokeWidth, 0, 20, label),
          strokeColor: color(e.strokeColor, label),
          maxWidth: num(e.maxWidth, 0, W, label),
        };
      }
      return fail(`${label} : type inconnu.`);
    });
    if (elements.filter((e) => e.type === 'avatar').length > 1) fail('Un seul avatar possible.');

    return {
      value: {
        enabled: body.enabled === true,
        channelId,
        format,
        message,
        card,
        embed,
        dm,
        autoroles,
        goodbye,
        banner,
        background: color(body.background, 'Fond'),
        overlay,
        elements,
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}

module.exports = { startDashboard };

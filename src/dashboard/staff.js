const path = require('node:path');
const transcripts = require('../features/tickets/transcripts');
const { closeFromPanel } = require('../features/tickets/tickets');
const { peekTicketConfig, panelRestricted, canUsePanel } = require('../features/tickets/ticket-store');

// Staff panel (/staff): this is where staff read tickets, reply to members and close tickets.
// Tickets are shown per member: one conversation per person, with all their tickets one after another.
// Access: Discord login + the roles and members chosen in the dashboard (Tickets → Staff panel access),
// or by default the server's staff role and the "Manage Server" permission.

const { str } = require('./util');

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

// Checking roles requires a call to Discord: the member is cached for 1 minute
const checked = new Map(); // <guildId>:<userId> → { member (null if no access), at }
// The access list of a server changed (dashboard): its members are checked again right away
function forgetPanelAccess(guildId) {
  for (const key of checked.keys()) if (key.startsWith(`${guildId}:`)) checked.delete(key);
}

function staffRoutes(app, client, auth) {
  async function staffMember(guild, userId) {
    const key = `${guild.id}:${userId}`;
    const hit = checked.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.member;
    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    const result = canUsePanel(member) ? member : null;
    if (checked.size > 10_000) checked.clear();
    checked.set(key, { member: result, at: Date.now() });
    return result;
  }

  const staffAccess = async (req, res, next) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    const member = guild && (await staffMember(guild, req.session.user.id));
    if (!member) return res.status(403).json({ error: 'Accès réservé au staff de ce serveur.' });
    req.guild = guild;
    req.member = member;
    next();
  };

  app.get('/staff', (req, res) => res.sendFile(path.join(__dirname, 'public', 'staff.html')));

  app.get('/api/staff/guilds', auth, async (req, res) => {
    // Possible access: "Manage Server" (these servers are known from the login), a staff role or a restricted access list.
    // Discord is only asked for those servers, not for every server of the bot
    const all = [...client.guilds.cache.values()].filter((g) => req.session.guildIds?.includes(g.id) || peekTicketConfig(g.id).staffId || panelRestricted(g.id));
    const members = await Promise.all(all.map((g) => staffMember(g, req.session.user.id)));
    res.json({
      user: req.session.user,
      bot: { name: client.user.username, avatar: client.user.displayAvatarURL({ size: 128 }) },
      guilds: all.filter((g, i) => members[i]).map((g) => ({ id: g.id, name: g.name, icon: g.iconURL({ size: 128 }) })),
    });
  });

  // One row per member, all their tickets grouped
  app.get('/api/staff/:guildId/conversations', auth, staffAccess, (req, res) => {
    const status = ['open', 'closed', 'waiting'].includes(req.query.status) ? req.query.status : '';
    const list = transcripts.listConversations(req.guild.id, { query: str(req.query.q), status });
    const open = transcripts.listConversations(req.guild.id, { status: 'open' });
    res.json({
      total: list.length,
      conversations: list.slice(0, 200),
      counts: { open: open.length, waiting: open.filter((c) => c.open.lastFrom !== 'staff').length },
    });
  });

  // A member's whole conversation: their tickets from oldest to newest
  app.get('/api/staff/:guildId/users/:userId', auth, staffAccess, (req, res) => {
    const tickets = transcripts.userTickets(req.guild.id, req.params.userId);
    if (!tickets.length) return res.status(404).json({ error: 'Aucun ticket pour ce membre.' });
    res.json({ tickets });
  });

  // Used by links to a specific ticket (notifications, /tickets): the panel then opens the member's conversation
  app.get('/api/staff/:guildId/tickets/:ticketId', auth, staffAccess, (req, res) => {
    const ticket = transcripts.getTicket(req.guild.id, req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket introuvable.' });
    res.json({ userId: ticket.user.id });
  });

  // The staff reply directly in the ticket channel on Discord: the panel is for reading and closing
  app.post('/api/staff/:guildId/tickets/:ticketId/close', auth, staffAccess, async (req, res) => {
    try {
      await closeFromPanel(req.guild, req.params.ticketId, req.member);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/staff/:guildId/tickets/:ticketId/files/:name', auth, staffAccess, (req, res) => {
    const file = transcripts.filePath(req.guild.id, req.params.ticketId, req.params.name);
    if (!file) return res.status(404).json({ error: 'Fichier introuvable.' });
    // Files sent by members: never executed in the page (a booby-trapped HTML page or SVG can't do anything)
    res.set({ 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' });
    if (IMAGE.test(file)) return res.sendFile(file);
    res.download(file, req.params.name.replace(/^[a-z0-9]+-/, ''));
  });
}

module.exports = { staffRoutes, forgetPanelAccess };

const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getTicketConfig, isStaff, staffPanelUrl } = require('./ticket-store');
const ticketChannels = require('./ticket-channels');
const transcripts = require('./transcripts');
const { PANEL_COLOR } = require('../../core/credits');
const { logActivity } = require('../../core/activity');

// Tickets: each ticket is a private channel on the server (ticket-channels.js), also tracked in the staff panel (/staff).
// Here: staff panel actions, the /tickets command and the reply to DMs (tickets are no longer done in DMs).
// Settings are in data/tickets.json (dashboard).

const panelUrl = staffPanelUrl;

const isEmoji = (text) => /^<a?:\w{2,32}:\d{17,20}>$/.test(text) || (!/[\w\s]/.test(text) && [...text].length <= 8);

// ---------- DMs: tickets are done on the server ----------

// A single reply per person every 10 minutes (no spam if they write several messages)
const answered = new Map(); // userId → date
async function handleDm(message) {
  const last = answered.get(message.author.id) ?? 0;
  if (Date.now() - last < 10 * 60000) return;
  for (const [id, at] of answered) if (Date.now() - at > 10 * 60000) answered.delete(id);
  answered.set(message.author.id, Date.now());
  await message.channel
    .send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription('📬 Pour contacter l’équipe d’un serveur, utilise le bouton **Ouvrir un ticket** sur ce serveur : un salon privé est créé pour toi.')] })
    .catch(() => {});
}

// Buttons and menus of old messages (DM tickets, old panel) still shown on Discord
function handleTicketComponent(interaction) {
  return interaction.reply({
    content: '📬 Les tickets se font maintenant sur le serveur : utilise le bouton **Ouvrir un ticket** dans le salon prévu.',
    flags: MessageFlags.Ephemeral,
  });
}

// ---------- Staff panel actions ----------
// The staff reply directly in the ticket channel on Discord (the panel is for reading and closing)

// Closing from the panel: closing message in DMs, channel deleted
async function closeFromPanel(guild, ticketId, member) {
  const ticket = transcripts.getTicket(guild.id, ticketId);
  if (!ticket) throw new Error('Ticket introuvable.');
  if (ticket.closedAt) throw new Error('Ce ticket est déjà fermé.');
  if (ticket.channelId) return ticketChannels.closeChannelTicket(guild, ticketId, member.displayName, member, 'panel staff');
  // Old DM ticket: simply marked as closed
  transcripts.updateTicket(guild.id, ticketId, { closedAt: Date.now(), closedBy: member.displayName });
  logActivity(guild.id, { source: 'tickets', action: 'ticket.closed', title: `Ticket de ${ticket.user.tag} fermé par ${member.displayName} (panel staff)`, author: member });
}

// ---------- /tickets: find a member's tickets ----------

async function listUserTickets(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: 'Réservé au staff.', flags: MessageFlags.Ephemeral });
  const target = interaction.options.getUser('membre');
  const { guild } = interaction;
  const list = transcripts.listTickets(guild.id, { userId: target.id });
  const date = (ms) => `<t:${Math.floor(ms / 1000)}:d>`;

  const lines = list.slice(0, 15).map((t) => {
    const status = t.closedAt ? `fermé par ${t.closedBy}` : `🟢 ouvert${t.channelId ? ` <#${t.channelId}>` : ''}`;
    return `[${date(t.openedAt)}${t.type ? ` · ${t.type}` : ''}](${panelUrl(`${guild.id}/${t.id}`)}) — ${t.count} messages, ${status}`;
  });
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setTitle(`📂 ${list.length} ticket${list.length > 1 ? 's' : ''}`)
    .setDescription(
      list.length
        ? `${lines.join('\n')}\n\n📂 [Tout l’historique dans le panel staff](${panelUrl(`${guild.id}/u/${target.id}`)})`
        : 'Aucun ticket pour ce membre.',
    )
    .setFooter({ text: list.length > 15 ? 'Les 15 plus récents' : 'Clique sur une date pour ouvrir le ticket' });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { handleDm, handleTicketComponent, closeFromPanel, listUserTickets, isStaff, isEmoji };

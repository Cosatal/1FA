const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getTicketConfig, isStaff, staffPanelUrl } = require('./ticket-store');
const ticketChannels = require('./ticket-channels');
const transcripts = require('./transcripts');
const { PANEL_COLOR } = require('../../core/credits');
const { logActivity } = require('../../core/activity');
const { t } = require('../../core/i18n');

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
    .send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription(t('tickets.contact_server_team_use_open'))] })
    .catch(() => {});
}

// Buttons and menus of old messages (DM tickets, old panel) still shown on Discord
function handleTicketComponent(interaction) {
  return interaction.reply({
    content: t('tickets.tickets_now_happen_server_use'),
    flags: MessageFlags.Ephemeral,
  });
}

// ---------- Staff panel actions ----------
// The staff reply directly in the ticket channel on Discord (the panel is for reading and closing)

// Closing from the panel: closing message in DMs, channel deleted
async function closeFromPanel(guild, ticketId, member) {
  const ticket = transcripts.getTicket(guild.id, ticketId);
  if (!ticket) throw new Error(t('tickets.ticket_not_found'));
  if (ticket.closedAt) throw new Error(t('tickets.this_ticket_already_closed'));
  if (ticket.channelId) return ticketChannels.closeChannelTicket(guild, ticketId, member.displayName, member, t('tickets.staff_panel'));
  // Old DM ticket: simply marked as closed
  transcripts.updateTicket(guild.id, ticketId, { closedAt: Date.now(), closedBy: member.displayName });
  logActivity(guild.id, { source: 'tickets', action: 'ticket.closed', title: `Ticket de ${ticket.user.tag} fermé par ${member.displayName} (panel staff)`, author: member });
}

// ---------- /tickets: find a member's tickets ----------

async function listUserTickets(interaction) {
  if (!isStaff(interaction.member)) return interaction.reply({ content: t('tickets.staff_only'), flags: MessageFlags.Ephemeral });
  const target = interaction.options.getUser('membre');
  const { guild } = interaction;
  const list = transcripts.listTickets(guild.id, { userId: target.id });
  const date = (ms) => `<t:${Math.floor(ms / 1000)}:d>`;

  const lines = list.slice(0, 15).map((ticket) => {
    const status = ticket.closedAt ? t('tickets.closed_by_2', { closedBy: ticket.closedBy }) : `🟢 ouvert${ticket.channelId ? ` <#${ticket.channelId}>` : ''}`;
    return `[${date(ticket.openedAt)}${ticket.type ? ` · ${ticket.type}` : ''}](${panelUrl(`${guild.id}/${ticket.id}`)}) — ${ticket.count} messages, ${status}`;
  });
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setTitle(`📂 ${list.length} ticket${list.length > 1 ? 's' : ''}`)
    .setDescription(
      list.length
        ? t('tickets.full_history_staff_panel', { join: lines.join('\n'), panelUrl: panelUrl(`${guild.id}/u/${target.id}`) })
        : t('tickets.no_tickets_for_this_member'),
    )
    .setFooter({ text: list.length > 15 ? t('tickets.15_most_recent') : t('tickets.click_date_open_ticket') });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = { handleDm, handleTicketComponent, closeFromPanel, listUserTickets, isStaff, isEmoji };

const { PermissionFlagsBits } = require('discord.js');
const { createStore } = require('../../core/store');

// Per-server ticket config, saved in data/tickets.json
// Each ticket is a private channel on the server (ticket-channels.js)
const store = createStore('tickets', {
  enabled: false, // enabled in the dashboard, once the button's channel is chosen
  staffId: '', // role mentioned on each new ticket, which sees the ticket channels and has access to the staff panel
  // Channel of the message with the "Ouvrir un ticket" button, and category where ticket channels are created
  panelChannelId: '',
  panelMessageId: '',
  categoryId: '',
  // Sent to the member when their ticket is opened then closed (empty = no message). {server} = server name
  received: 'Salut !\nMerci pour ton message.\nCelui-ci a été transféré au Staff, s’il contient des informations manquantes, merci de les compléter.',
  closed: 'En espérant que ta demande a correctement été traitée.\nSi tel est le cas, __**merci de ne pas répondre à ce message**__.\nBon courage et bon jeu sur {server} !',
  // Panel message, posted with the "Ouvrir un ticket" button (or the ticket types menu)
  title: '📬 Contacter l’équipe',
  description: 'Salut ! Ton message va être transmis à l’équipe du serveur.\nChoisis le type de demande ci-dessous.',
  image: '',
  placeholder: '📩 Choisis le type de demande…',
  options: [], // [{ id, label, description, emoji }]
  // AI assistant: it answers first in the ticket channel, until staff writes or the member asks for the team.
  // instructions = what the AI should know about the server
  // provider: the AI used (see ai-support.js) · model: empty = default model (Claude only)
  ai: { enabled: false, instructions: '', provider: 'anthropic', model: '' },
});

// Staff = the configured staff role, or anyone who can manage the server
const isStaff = (member) =>
  Boolean(member) && (member.permissions.has(PermissionFlagsBits.ManageGuild) || member.roles.cache.has(store.peek(member.guild.id).staffId));

// peekTicketConfig: fast read without copy, must not be modified
module.exports = { getTicketConfig: store.get, peekTicketConfig: store.peek, saveTicketConfig: store.save, isStaff };

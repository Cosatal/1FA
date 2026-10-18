const { SlashCommandBuilder } = require('discord.js');
const { listUserTickets } = require('../features/tickets/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Liste les tickets d’un membre (staff)')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true)),
  // No Discord permission (the ticket staff role doesn't necessarily have one): the bot does the check itself
  staff: 'Rôle staff des tickets',
  execute: listUserTickets,
};

const { SlashCommandBuilder } = require('discord.js');
const { createSuggestion } = require('../features/community');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestion')
    .setDescription('Proposer une idée pour le serveur')
    .addStringOption((opt) => opt.setName('idee').setDescription('Ton idée').setRequired(true).setMaxLength(1000)),
  execute: (interaction) => createSuggestion(interaction, interaction.options.getString('idee')),
};

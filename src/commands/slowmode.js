const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { parseDuration } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Activer/désactiver le mode lent dans un salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((opt) => opt.setName('durée').setDescription('Délai entre deux messages, ex : 5s, 1m, 1h (0 ou off pour désactiver)').setRequired(true)),
  async execute(interaction) {
    const text = interaction.options.getString('durée').trim().toLowerCase();
    const seconds = ['0', 'off', 'non'].includes(text) ? 0 : (parseDuration(text) ?? -1000) / 1000;
    if (seconds < 0 || seconds > 21600) {
      return interaction.reply({ content: 'Durée illisible ou trop longue (6 heures max). Exemples : `5s`, `1m`, `off`.', flags: MessageFlags.Ephemeral });
    }
    try {
      await interaction.channel.setRateLimitPerUser(seconds, `Mode lent par ${interaction.user.tag}`);
    } catch {
      return interaction.reply({ content: 'Je ne peux pas modifier ce salon (permission « Gérer les salons » manquante).', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply(seconds ? `🐢 Mode lent activé : un message toutes les **${text}**.` : '🐇 Mode lent désactivé.');
  },
};

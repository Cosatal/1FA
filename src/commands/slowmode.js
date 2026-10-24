const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { parseDuration } = require('../features/moderation/moderation');
const { t } = require('../core/i18n');

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
      return interaction.reply({ content: t('commands.slowmode.unreadable_or_too_long_duration'), flags: MessageFlags.Ephemeral });
    }
    try {
      await interaction.channel.setRateLimitPerUser(seconds, t('commands.slowmode.slow_mode_by', { tag: interaction.user.tag }));
    } catch {
      return interaction.reply({ content: t('commands.slowmode.can_edit_this_channel_missing'), flags: MessageFlags.Ephemeral });
    }
    await interaction.reply(seconds ? t('commands.slowmode.slow_mode_one_message_every', { text }) : t('commands.slowmode.slow_mode_off'));
  },
};

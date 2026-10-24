const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog } = require('../features/moderation/moderation');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Supprimer les messages d’un salon')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((opt) =>
      opt.setName('nombre').setDescription('Nombre de messages (1 à 100)').setRequired(true).setMinValue(1).setMaxValue(100),
    ),
  async execute(interaction) {
    const amount = interaction.options.getInteger('nombre');
    // true = skips messages older than 14 days (Discord refuses to bulk-delete them)
    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    if (!deleted) {
      return interaction.reply({ content: t('commands.clear.can_delete_messages_here_need'), flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({ content: t('commands.clear.message_deleted', { size: deleted.size }), flags: MessageFlags.Ephemeral });
    await modLog(interaction.guild, {
      event: 'modClear',
      action: t('commands.clear.messages_deleted'),
      color: 0x5865f2,
      moderator: interaction.user,
      extra: [
        { name: t('commands.clear.channel'), value: `${interaction.channel}`, inline: true },
        { name: t('commands.clear.number'), value: `${deleted.size}`, inline: true },
      ],
    });
  },
};

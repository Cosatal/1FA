const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { clearWarnings, modLog } = require('../features/moderation/moderation');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear-all-infractions')
    .setDescription('Supprimer toutes les infractions de tous les membres du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((opt) => opt.setName('confirmer').setDescription('Coche « True » pour confirmer : c’est définitif').setRequired(true)),
  async execute(interaction) {
    if (!interaction.options.getBoolean('confirmer')) {
      return interaction.reply({ content: t('commands.clearAllInfractions.nothing_was_cleared_confirmation_declined'), flags: MessageFlags.Ephemeral });
    }
    const count = clearWarnings(interaction.guild.id);
    await interaction.reply({ content: t('commands.clearAllInfractions.infraction_cleared_across_server', { count }), flags: MessageFlags.Ephemeral });
    await modLog(interaction.guild, {
      event: 'modWarn',
      action: t('commands.clearAllInfractions.all_infractions_cleared'),
      color: 0x3ba55c,
      moderator: interaction.user,
      extra: [{ name: t('commands.clearAllInfractions.number'), value: `${count}`, inline: true }],
    });
  },
};

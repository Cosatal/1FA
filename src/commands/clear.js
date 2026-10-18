const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog } = require('../features/moderation/moderation');

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
      return interaction.reply({ content: 'Je ne peux pas supprimer les messages ici (il me faut « Gérer les messages » et « Voir l’historique »).', flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({ content: `🧹 ${deleted.size} message(s) supprimé(s).`, flags: MessageFlags.Ephemeral });
    await modLog(interaction.guild, {
      event: 'modClear',
      action: 'Messages supprimés',
      color: 0x5865f2,
      moderator: interaction.user,
      extra: [
        { name: 'Salon', value: `${interaction.channel}`, inline: true },
        { name: 'Nombre', value: `${deleted.size}`, inline: true },
      ],
    });
  },
};

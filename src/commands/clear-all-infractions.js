const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { clearWarnings, modLog } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear-all-infractions')
    .setDescription('Supprimer toutes les infractions de tous les membres du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((opt) => opt.setName('confirmer').setDescription('Coche « True » pour confirmer : c’est définitif').setRequired(true)),
  async execute(interaction) {
    if (!interaction.options.getBoolean('confirmer')) {
      return interaction.reply({ content: 'Rien n’a été effacé (confirmation refusée).', flags: MessageFlags.Ephemeral });
    }
    const count = clearWarnings(interaction.guild.id);
    await interaction.reply({ content: `🧽 ${count} infraction(s) effacée(s) sur tout le serveur.`, flags: MessageFlags.Ephemeral });
    await modLog(interaction.guild, {
      event: 'modWarn',
      action: 'Toutes les infractions effacées',
      color: 0x3ba55c,
      moderator: interaction.user,
      extra: [{ name: 'Nombre', value: `${count}`, inline: true }],
    });
  },
};

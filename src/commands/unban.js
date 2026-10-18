const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, removeTempban } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannir un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((opt) => opt.setName('id').setDescription('L’ID du membre banni').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const id = interaction.options.getString('id').replace(/\D/g, '');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';
    const user = await interaction.guild.members.unban(id, reason).catch(() => null);
    if (!user) return interaction.reply({ content: 'Aucun membre banni avec cet ID.', flags: MessageFlags.Ephemeral });

    removeTempban(interaction.guild.id, user.id);
    await interaction.reply(`🕊️ ${user.tag} a été débanni.`);
    await modLog(interaction.guild, { event: 'modUnban', action: 'Débannissement', color: 0x3ba55c, target: user, moderator: interaction.user, reason });
  },
};

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError, removeTempban } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const user = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';
    const error = targetError(interaction, interaction.options.getMember('membre'), (m) => m.bannable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    await interaction.guild.members.ban(user, { reason });
    removeTempban(interaction.guild.id, user.id); // a permanent ban replaces a temporary ban
    await interaction.reply(`🔨 ${user.tag} a été banni. Raison : ${reason}`);
    await modLog(interaction.guild, { event: 'modBan', action: 'Bannissement', target: user, moderator: interaction.user, reason });
  },
};

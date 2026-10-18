const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulser un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à expulser').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';
    if (!member) return interaction.reply({ content: 'Ce membre n’est pas sur le serveur.', flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, member, (m) => m.kickable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    await member.kick(reason);
    await interaction.reply(`👢 ${member.user.tag} a été expulsé. Raison : ${reason}`);
    await modLog(interaction.guild, { event: 'modKick', action: 'Expulsion', color: 0xf26522, target: member.user, moderator: interaction.user, reason });
  },
};

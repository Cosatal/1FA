const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Réactive un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    if (!member?.isCommunicationDisabled()) return interaction.reply({ content: 'Ce membre n’est pas muet.', flags: MessageFlags.Ephemeral });
    if (!member.moderatable) return interaction.reply({ content: 'Je ne peux pas modifier ce membre : son rôle est au-dessus du mien.', flags: MessageFlags.Ephemeral });

    await member.timeout(null);
    await interaction.reply(`🔊 ${member.user.tag} peut de nouveau parler.`);
    await modLog(interaction.guild, { event: 'modUnmute', action: 'Membre dé-mute', color: 0x3ba55c, target: member.user, moderator: interaction.user });
  },
};

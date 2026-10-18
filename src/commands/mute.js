const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError } = require('../features/moderation/moderation');

// Discord doesn't allow timeouts longer than 28 days: this is the length of an "endless" mute
const MAX = 28 * 24 * 3600 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Rend muet un membre du serveur (28 jours, le maximum de Discord)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';
    if (!member) return interaction.reply({ content: 'Ce membre n’est pas sur le serveur.', flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, member, (m) => m.moderatable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    await member.timeout(MAX, reason);
    await interaction.reply(`🔇 ${member.user.tag} est muet (jusqu’à /unmute, 28 jours max). Raison : ${reason}`);
    await modLog(interaction.guild, { event: 'modMute', action: 'Membre rendu muet', color: 0xf5a524, target: member.user, moderator: interaction.user, reason });
  },
};

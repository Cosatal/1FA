const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError, parseDuration } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempmute')
    .setDescription('Rendre temporairement muet un utilisateur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((opt) => opt.setName('durée').setDescription('Ex : 10m, 2h, 3j (28 jours max)').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';
    const ms = parseDuration(interaction.options.getString('durée'));
    if (!ms || ms > 28 * 24 * 3600 * 1000) {
      return interaction.reply({ content: 'Durée illisible ou trop longue (28 jours max). Exemples : `10m`, `2h`, `3j`.', flags: MessageFlags.Ephemeral });
    }
    if (!member) return interaction.reply({ content: 'Ce membre n’est pas sur le serveur.', flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, member, (m) => m.moderatable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    await member.timeout(ms, reason);
    const until = `<t:${Math.floor((Date.now() + ms) / 1000)}:R>`;
    await interaction.reply(`🔇 ${member.user.tag} est muet, fin ${until}. Raison : ${reason}`);
    await modLog(interaction.guild, {
      event: 'modMute',
      action: 'Membre rendu muet (temporaire)',
      color: 0xf5a524,
      target: member.user,
      moderator: interaction.user,
      reason,
      extra: [{ name: 'Fin', value: until, inline: true }],
    });
  },
};

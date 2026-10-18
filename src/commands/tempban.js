const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError, parseDuration, addTempban } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Bannir temporairement un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption((opt) => opt.setName('durée').setDescription('Ex : 30m, 12h, 7j, 2sem').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const user = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison';
    const ms = parseDuration(interaction.options.getString('durée'));
    if (!ms) return interaction.reply({ content: 'Durée illisible. Exemples : `30m`, `12h`, `7j`, `2sem`.', flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, interaction.options.getMember('membre'), (m) => m.bannable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    const until = Date.now() + ms;
    await interaction.guild.members.ban(user, { reason: `${reason} (temporaire)` });
    addTempban(interaction.guild.id, user.id, until);
    await interaction.reply(`⏳ ${user.tag} est banni jusqu’à <t:${Math.floor(until / 1000)}:f>. Raison : ${reason}`);
    await modLog(interaction.guild, {
      event: 'modBan',
      action: 'Ban temporaire',
      target: user,
      moderator: interaction.user,
      reason,
      extra: [{ name: 'Fin', value: `<t:${Math.floor(until / 1000)}:R>`, inline: true }],
    });
  },
};

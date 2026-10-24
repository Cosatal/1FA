const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { inviteCount, inviteTop } = require('../features/moderation/guard');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invitations des membres')
    .addSubcommand((sub) =>
      sub.setName('voir').setDescription('Nombre d’invitations d’un membre').addUserOption((opt) => opt.setName('membre').setDescription('Le membre (toi par défaut)')))
    .addSubcommand((sub) => sub.setName('classement').setDescription('Les meilleurs inviteurs du serveur')),
  async execute(interaction) {
    const { guild } = interaction;
    if (interaction.options.getSubcommand() === 'voir') {
      const user = interaction.options.getUser('membre') ?? interaction.user;
      const c = inviteCount(guild.id, user.id);
      return interaction.reply({
        content: t('commands.invites.has_invite_join_leave', { user, total: c.total, v2: c.total > 1 ? 's' : '', joins: c.joins, v4: c.joins > 1 ? 's' : '', leaves: c.leaves, v6: c.leaves > 1 ? 's' : '' }),
        allowedMentions: { parse: [] },
      });
    }
    const top = inviteTop(guild.id);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(t('commands.invites.top_inviters', { name: guild.name }))
      .setDescription(top.map((s, i) => t('commands.invites.joins_leaves', { v0: i + 1, userId: s.userId, total: s.total, joins: s.joins, leaves: s.leaves })).join('\n') || t('commands.invites.no_invites_tracked_yet'));
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

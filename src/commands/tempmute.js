const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError, parseDuration } = require('../features/moderation/moderation');
const { addCase, notifySanction, caseLine } = require('../features/moderation/cases');
const { t } = require('../core/i18n');

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
    const reason = interaction.options.getString('raison') ?? t('commands.tempmute.no_reason');
    const ms = parseDuration(interaction.options.getString('durée'));
    if (!ms || ms > 28 * 24 * 3600 * 1000) {
      return interaction.reply({ content: t('commands.tempmute.unreadable_or_too_long_duration'), flags: MessageFlags.Ephemeral });
    }
    if (!member) return interaction.reply({ content: t('commands.tempmute.this_member_isn_server'), flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, member, (m) => m.moderatable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    await member.timeout(ms, reason);
    const entry = addCase(interaction.guild, { type: 'tempmute', user: member.user, moderator: interaction.user, reason, until: Date.now() + ms });
    const until = `<t:${Math.floor(entry.until / 1000)}:R>`;
    await interaction.reply(t('commands.tempmute.muted_ends_reason', { tag: member.user.tag, until, reason }) + caseLine(entry));
    await notifySanction(interaction.guild, entry, member.user);
    await modLog(interaction.guild, {
      event: 'modMute',
      action: t('commands.tempmute.member_muted_temporary'),
      color: 0xf5a524,
      target: member.user,
      moderator: interaction.user,
      reason,
      extra: [{ name: t('commands.tempmute.end'), value: until, inline: true }],
      caseN: entry.n,
    });
  },
};

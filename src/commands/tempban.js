const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError, parseDuration, addTempban } = require('../features/moderation/moderation');
const { addCase, discardCase, notifySanction, caseLine } = require('../features/moderation/cases');
const { t } = require('../core/i18n');

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
    const reason = interaction.options.getString('raison') ?? t('commands.tempban.no_reason');
    const ms = parseDuration(interaction.options.getString('durée'));
    if (!ms) return interaction.reply({ content: t('commands.tempban.unreadable_duration_examples_30m_12h'), flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, interaction.options.getMember('membre'), (m) => m.bannable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    const until = Date.now() + ms;
    // The DM (case, appeal button) goes before the ban: afterwards, the bot can no longer write to the member
    const entry = addCase(interaction.guild, { type: 'tempban', user, moderator: interaction.user, reason, until });
    await notifySanction(interaction.guild, entry, user);
    try {
      await interaction.guild.members.ban(user, { reason: `${reason} (temporaire)` });
    } catch (banError) {
      discardCase(interaction.guild.id, entry.n);
      throw banError;
    }
    addTempban(interaction.guild.id, user.id, until);
    await interaction.reply(t('commands.tempban.banned_until_reason', { tag: user.tag, floor: Math.floor(until / 1000), reason }) + caseLine(entry));
    await modLog(interaction.guild, {
      event: 'modBan',
      action: t('commands.tempban.temporary_ban'),
      target: user,
      moderator: interaction.user,
      reason,
      extra: [{ name: t('commands.tempban.end'), value: `<t:${Math.floor(until / 1000)}:R>`, inline: true }],
      caseN: entry.n,
    });
  },
};

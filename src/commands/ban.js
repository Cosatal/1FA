const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError, removeTempban } = require('../features/moderation/moderation');
const { addCase, discardCase, notifySanction, caseLine } = require('../features/moderation/cases');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const user = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison') ?? t('commands.ban.no_reason');
    const error = targetError(interaction, interaction.options.getMember('membre'), (m) => m.bannable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    // The DM (case, appeal button) goes before the ban: afterwards, the bot can no longer write to the member
    const entry = addCase(interaction.guild, { type: 'ban', user, moderator: interaction.user, reason });
    await notifySanction(interaction.guild, entry, user);
    try {
      await interaction.guild.members.ban(user, { reason });
    } catch (banError) {
      discardCase(interaction.guild.id, entry.n);
      throw banError;
    }
    removeTempban(interaction.guild.id, user.id); // a permanent ban replaces a temporary ban
    await interaction.reply(t('commands.ban.was_banned_reason', { tag: user.tag, reason }) + caseLine(entry));
    await modLog(interaction.guild, { event: 'modBan', action: t('commands.ban.ban'), target: user, moderator: interaction.user, reason, caseN: entry.n });
  },
};

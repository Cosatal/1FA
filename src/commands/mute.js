const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError } = require('../features/moderation/moderation');
const { addCase, notifySanction, caseLine } = require('../features/moderation/cases');
const { t } = require('../core/i18n');

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
    const reason = interaction.options.getString('raison') ?? t('commands.mute.no_reason');
    if (!member) return interaction.reply({ content: t('commands.mute.this_member_isn_server'), flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, member, (m) => m.moderatable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    await member.timeout(MAX, reason);
    const entry = addCase(interaction.guild, { type: 'mute', user: member.user, moderator: interaction.user, reason });
    await interaction.reply(t('commands.mute.muted_until_unmute_28_days', { tag: member.user.tag, reason }) + caseLine(entry));
    await notifySanction(interaction.guild, entry, member.user);
    await modLog(interaction.guild, { event: 'modMute', action: t('commands.mute.member_muted'), color: 0xf5a524, target: member.user, moderator: interaction.user, reason, caseN: entry.n });
  },
};

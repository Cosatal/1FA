const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog } = require('../features/moderation/moderation');
const { addCase, caseLine } = require('../features/moderation/cases');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Réactive un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true)),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    if (!member?.isCommunicationDisabled()) return interaction.reply({ content: t('commands.unmute.this_member_isn_muted'), flags: MessageFlags.Ephemeral });
    if (!member.moderatable) return interaction.reply({ content: t('commands.unmute.can_edit_this_member_their'), flags: MessageFlags.Ephemeral });

    await member.timeout(null);
    const entry = addCase(interaction.guild, { type: 'unmute', user: member.user, moderator: interaction.user, reason: '' });
    await interaction.reply(t('commands.unmute.can_speak_again', { tag: member.user.tag }) + caseLine(entry));
    await modLog(interaction.guild, { event: 'modUnmute', action: t('commands.unmute.member_unmuted'), color: 0x3ba55c, target: member.user, moderator: interaction.user, caseN: entry.n });
  },
};

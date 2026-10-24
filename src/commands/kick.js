const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, targetError } = require('../features/moderation/moderation');
const { addCase, discardCase, notifySanction, caseLine } = require('../features/moderation/cases');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulser un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à expulser').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const reason = interaction.options.getString('raison') ?? t('commands.kick.no_reason');
    if (!member) return interaction.reply({ content: t('commands.kick.this_member_isn_server'), flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, member, (m) => m.kickable);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    // DM before the kick: afterwards, the bot can no longer write to the member
    const entry = addCase(interaction.guild, { type: 'kick', user: member.user, moderator: interaction.user, reason });
    await notifySanction(interaction.guild, entry, member.user);
    try {
      await member.kick(reason);
    } catch (kickError) {
      discardCase(interaction.guild.id, entry.n);
      throw kickError;
    }
    await interaction.reply(t('commands.kick.was_kicked_reason', { tag: member.user.tag, reason }) + caseLine(entry));
    await modLog(interaction.guild, { event: 'modKick', action: t('commands.kick.kick'), color: 0xf26522, target: member.user, moderator: interaction.user, reason, caseN: entry.n });
  },
};

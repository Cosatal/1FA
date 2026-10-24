const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog, removeTempban } = require('../features/moderation/moderation');
const { addCase, caseLine } = require('../features/moderation/cases');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannir un membre du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((opt) => opt.setName('id').setDescription('L’ID du membre banni').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison')),
  async execute(interaction) {
    const id = interaction.options.getString('id').replace(/\D/g, '');
    const reason = interaction.options.getString('raison') ?? t('commands.unban.no_reason');
    const user = await interaction.guild.members.unban(id, reason).catch(() => null);
    if (!user) return interaction.reply({ content: t('commands.unban.no_banned_member_with_this'), flags: MessageFlags.Ephemeral });

    removeTempban(interaction.guild.id, user.id);
    const entry = addCase(interaction.guild, { type: 'unban', user, moderator: interaction.user, reason });
    await interaction.reply(t('commands.unban.was_unbanned', { tag: user.tag }) + caseLine(entry));
    await modLog(interaction.guild, { event: 'modUnban', action: t('commands.unban.unban'), color: 0x3ba55c, target: user, moderator: interaction.user, reason, caseN: entry.n });
  },
};

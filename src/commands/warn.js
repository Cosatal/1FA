const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { addWarning, modLog, targetError } = require('../features/moderation/moderation');
const { addCase, notifySanction, caseLine } = require('../features/moderation/cases');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Avertir un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const user = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison');
    if (user.bot) return interaction.reply({ content: t('commands.warn.can_warn_bot'), flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, interaction.options.getMember('membre'), () => true);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    const entry = addCase(interaction.guild, { type: 'warn', user, moderator: interaction.user, reason });
    const count = addWarning(interaction.guild.id, user.id, { reason, by: interaction.user.username, at: entry.at, case: entry.n });
    // Reply first (Discord gives 3 seconds), then the DM: DMs may be closed, the error is ignored
    await interaction.reply(t('commands.warn.received_warning_total_reason', { user, count, reason }) + caseLine(entry));
    await notifySanction(interaction.guild, entry, user);
    await modLog(interaction.guild, { event: 'modWarn', action: t('commands.warn.warning', { count }), color: 0xf5a524, target: user, moderator: interaction.user, reason, caseN: entry.n });
  },
};

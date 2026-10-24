const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { getWarnings, clearWarnings, modLog } = require('../features/moderation/moderation');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('infractions')
    .setDescription('Afficher les infractions d’un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
    .addBooleanOption((opt) => opt.setName('effacer').setDescription('Effacer toutes ses infractions')),
  async execute(interaction) {
    const user = interaction.options.getUser('membre');

    if (interaction.options.getBoolean('effacer')) {
      const count = clearWarnings(interaction.guild.id, user.id);
      // Reply first: Discord gives 3 seconds to answer, the log can wait
      await interaction.reply({ content: t('commands.infractions.infraction_cleared', { count, user }), flags: MessageFlags.Ephemeral });
      return modLog(interaction.guild, { event: 'modWarn', action: t('commands.infractions.infractions_cleared'), color: 0x3ba55c, target: user, moderator: interaction.user });
    }

    const list = getWarnings(interaction.guild.id, user.id);
    const embed = new EmbedBuilder()
      .setColor(0xf5a524)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setTitle(`⚠️ ${list.length} infraction${list.length > 1 ? 's' : ''}`)
      .setDescription(
        list.length
          ? list.map((w, i) => t('commands.infractions.entry', { v0: i + 1, reason: w.reason, floor: Math.floor(w.at / 1000), by: w.by })).join('\n\n').slice(0, 4000)
          : t('commands.infractions.no_infractions'),
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { getWarnings, clearWarnings, modLog } = require('../features/moderation/moderation');

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
      await interaction.reply({ content: `🧽 ${count} infraction(s) de ${user} effacée(s).`, flags: MessageFlags.Ephemeral });
      return modLog(interaction.guild, { event: 'modWarn', action: 'Infractions effacées', color: 0x3ba55c, target: user, moderator: interaction.user });
    }

    const list = getWarnings(interaction.guild.id, user.id);
    const embed = new EmbedBuilder()
      .setColor(0xf5a524)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setTitle(`⚠️ ${list.length} infraction${list.length > 1 ? 's' : ''}`)
      .setDescription(
        list.length
          ? list.map((w, i) => `**${i + 1}.** ${w.reason}\n<t:${Math.floor(w.at / 1000)}:d> · par ${w.by}`).join('\n\n').slice(0, 4000)
          : 'Aucune infraction.',
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

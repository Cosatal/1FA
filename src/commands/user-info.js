const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getWarnings } = require('../features/moderation/moderation');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('user-info')
    .setDescription('Obtenir des informations sur un membre')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre (toi par défaut)')),
  async execute(interaction) {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    // Member chosen but not on the server: no roles or join date (and above all not those of the command's author)
    const member = interaction.options.getUser('membre') ? interaction.options.getMember('membre') : interaction.member;

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || 0x2f7ff0)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot', value: user.bot ? t('commands.userInfo.yes') : t('commands.userInfo.no'), inline: true },
        { name: t('commands.userInfo.account_created'), value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Infractions', value: `${getWarnings(interaction.guild.id, user.id).length}`, inline: true },
      );

    if (member) {
      const roles = member.roles.cache
        .filter((r) => r.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => r.toString());
      embed.addFields(
        { name: t('commands.userInfo.joined_server'), value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: t('commands.userInfo.roles', { length: roles.length }), value: roles.slice(0, 15).join(' ') || t('commands.userInfo.none') },
      );
    }

    await interaction.reply({ embeds: [embed] });
  },
};

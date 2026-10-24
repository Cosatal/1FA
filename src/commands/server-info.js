const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('server-info').setDescription('Obtenir des informations sur le serveur'),
  async execute(interaction) {
    const { guild } = interaction;

    const embed = new EmbedBuilder()
      .setColor(0x2f7ff0)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: t('commands.serverInfo.owner'), value: `<@${guild.ownerId}>`, inline: true },
        { name: t('commands.serverInfo.members'), value: `${guild.memberCount}`, inline: true },
        { name: t('commands.serverInfo.created'), value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: t('commands.serverInfo.channels'), value: `${guild.channels.cache.size}`, inline: true },
        { name: t('commands.serverInfo.roles'), value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Boosts', value: `${guild.premiumSubscriptionCount ?? 0}`, inline: true },
      )
      .setFooter({ text: `ID : ${guild.id}` });

    await interaction.reply({ embeds: [embed] });
  },
};

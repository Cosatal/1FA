const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { CREATOR, OFFICIAL_URL, inviteUrl } = require('../core/credits');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('bot-info').setDescription('Informations sur le bot'),
  async execute(interaction) {
    const { client } = interaction;
    const members = client.guilds.cache.reduce((sum, g) => sum + g.memberCount, 0);

    // Written in French: automatically translated into English on English servers (language.js)
    const embed = new EmbedBuilder()
      .setColor(0x2f7ff0)
      .setAuthor({ name: client.user.username, iconURL: client.user.displayAvatarURL() })
      .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
      .setDescription(t('commands.botInfo.one_for_all_powerful_100'))
      .addFields(
        { name: t('commands.botInfo.creator'), value: CREATOR, inline: true }, // a plain-text name: no mention linking to an account
        { name: t('commands.botInfo.servers'), value: `${client.guilds.cache.size}`, inline: true },
        { name: t('commands.botInfo.members'), value: `${members}`, inline: true },
        { name: t('commands.botInfo.online_since'), value: `<t:${Math.floor((Date.now() - client.uptime) / 1000)}:R>`, inline: true },
        { name: t('commands.botInfo.100_free'), value: t('commands.botInfo.if_paid_for_this_bot', { OFFICIAL_URL }) },
      )
      .setFooter({ text: `Made by ${CREATOR}` });

    const buttons = [
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('commands.botInfo.add_bot')).setURL(inviteUrl(client)),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('commands.botInfo.official_version')).setURL(OFFICIAL_URL),
    ];
    // Only once the dashboard is hosted (a localhost address only works on your own PC)
    if (/^https:\/\//.test(process.env.DASHBOARD_URL ?? '')) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Dashboard').setURL(process.env.DASHBOARD_URL));

    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] });
  },
};

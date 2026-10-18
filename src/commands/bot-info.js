const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { CREATOR, OFFICIAL_URL, inviteUrl } = require('../core/credits');

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
      .setDescription(`⚡ **One For All** : le bot puissant et 100 % gratuit pour tout le monde !\nBienvenue, modération, tickets, rôles-réactions, sondages, giveaways et alertes réseaux, le tout réglable depuis un dashboard.`)
      .addFields(
        { name: '👑 Créateur', value: CREATOR, inline: true }, // a plain-text name: no mention linking to an account
        { name: '🌐 Serveurs', value: `${client.guilds.cache.size}`, inline: true },
        { name: '👥 Membres', value: `${members}`, inline: true },
        { name: '⏱️ En ligne depuis', value: `<t:${Math.floor((Date.now() - client.uptime) / 1000)}:R>`, inline: true },
        { name: '💚 100 % gratuit', value: `Si tu as payé pour ce bot, tu t’es fait arnaquer.\nVersion officielle : ${OFFICIAL_URL}` },
      )
      .setFooter({ text: `Made by ${CREATOR}` });

    const buttons = [
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ajouter le bot').setURL(inviteUrl(client)),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Version officielle').setURL(OFFICIAL_URL),
    ];
    // Only once the dashboard is hosted (a localhost address only works on your own PC)
    if (/^https:\/\//.test(process.env.DASHBOARD_URL ?? '')) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Dashboard').setURL(process.env.DASHBOARD_URL));

    await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] });
  },
};

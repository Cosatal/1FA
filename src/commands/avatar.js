const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Affiche l’avatar d’un membre en grand')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre (toi par défaut)')),
  async execute(interaction) {
    // force: true to fetch the profile banner and color
    const user = await (interaction.options.getUser('membre') ?? interaction.user).fetch(true);
    // Member chosen but not on the server: their global avatar (not the server avatar of the command's author)
    const member = interaction.options.getUser('membre') ? interaction.options.getMember('membre') : interaction.member;

    const globalUrl = user.displayAvatarURL({ size: 4096 });
    const serverUrl = member?.avatar ? member.displayAvatarURL({ size: 4096 }) : null;
    const mainUrl = serverUrl ?? globalUrl;
    const animated = (member?.avatar ?? user.avatar)?.startsWith('a_');

    const formats = ['png', 'jpg', 'webp', ...(animated ? ['gif'] : [])];
    const links = formats
      .map((ext) => `[**${ext.toUpperCase()}**](${(serverUrl ? member : user).displayAvatarURL({ size: 4096, extension: ext, forceStatic: ext !== 'gif' })})`)
      .join(' • ');

    const embed = new EmbedBuilder()
      .setColor(user.accentColor ?? (member?.displayColor || 0x5865f2))
      .setAuthor({ name: member?.displayName ?? user.username, iconURL: user.displayAvatarURL() })
      .setTitle(`🖼️ Avatar de ${user.username}`)
      .setURL(mainUrl)
      .setDescription(`📥 Télécharger : ${links}${animated ? '\n✨ Avatar animé' : ''}`)
      .setImage(mainUrl)
      .setFooter({ text: `Demandé par ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    if (serverUrl) {
      embed.setThumbnail(globalUrl).addFields({ name: '🌐 Avatar global', value: `[Voir](${globalUrl}) (en miniature)`, inline: true });
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Ouvrir l’avatar').setEmoji('🖼️').setURL(mainUrl),
    );
    if (serverUrl) {
      buttons.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Avatar global').setEmoji('🌐').setURL(globalUrl));
    }
    const bannerUrl = user.bannerURL({ size: 4096 });
    if (bannerUrl) {
      buttons.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Bannière').setEmoji('🎨').setURL(bannerUrl));
    }

    await interaction.reply({ embeds: [embed], components: [buttons] });
  },
};

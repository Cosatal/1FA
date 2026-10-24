const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { t } = require('../core/i18n');

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
      .setTitle(t('commands.avatar.avatar', { username: user.username }))
      .setURL(mainUrl)
      .setDescription(t('commands.avatar.download', { links, v1: animated ? t('commands.avatar.animated_avatar') : '' }))
      .setImage(mainUrl)
      .setFooter({ text: t('commands.avatar.requested_by', { username: interaction.user.username }), iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();

    if (serverUrl) {
      embed.setThumbnail(globalUrl).addFields({ name: t('commands.avatar.global_avatar'), value: t('commands.avatar.view_as_thumbnail', { globalUrl }), inline: true });
    }

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('commands.avatar.open_avatar')).setEmoji('🖼️').setURL(mainUrl),
    );
    if (serverUrl) {
      buttons.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('commands.avatar.global_avatar_2')).setEmoji('🌐').setURL(globalUrl));
    }
    const bannerUrl = user.bannerURL({ size: 4096 });
    if (bannerUrl) {
      buttons.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t('commands.avatar.banner')).setEmoji('🎨').setURL(bannerUrl));
    }

    await interaction.reply({ embeds: [embed], components: [buttons] });
  },
};

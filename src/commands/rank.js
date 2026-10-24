const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { getFeature } = require('../core/feature-config');
const { stats, rankCard } = require('../features/levels');
const { translatorFor } = require('../core/language');
const { t } = require('../core/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Voir son niveau et son XP')
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre (toi par défaut)')),
  async execute(interaction) {
    if (!getFeature(interaction.guild.id, 'levels').enabled) {
      return interaction.reply({ content: t('commands.rank.levels_aren_enabled_this_server'), flags: MessageFlags.Ephemeral });
    }
    const user = interaction.options.getUser('membre') ?? interaction.user;
    if (user.bot) return interaction.reply({ content: t('commands.rank.bots_don_earn_xp'), flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    const member = interaction.options.getMember('membre') ?? (user.id === interaction.user.id ? interaction.member : null);
    const s = stats(interaction.guild.id, user.id);
    const image = await rankCard({
      name: member?.displayName ?? user.username,
      avatarUrl: (member ?? user).displayAvatarURL({ extension: 'png', size: 256 }),
      ...s,
      color: member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : '#2f7ff0',
      tr: translatorFor(interaction.guild),
    });
    await interaction.editReply({ files: [new AttachmentBuilder(image, { name: 'rank.png' })] });
  },
};

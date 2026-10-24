const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getFeature } = require('../core/feature-config');
const { leaderboard } = require('../features/levels');
const { t } = require('../core/i18n');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Classement des membres les plus actifs')
    .addIntegerOption((opt) => opt.setName('page').setDescription('Page du classement').setMinValue(1)),
  async execute(interaction) {
    const { guild } = interaction;
    const config = getFeature(guild.id, 'levels');
    if (!config.enabled) return interaction.reply({ content: t('commands.leaderboard.levels_aren_enabled_this_server'), flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    const page = interaction.options.getInteger('page') ?? 1;
    const list = await leaderboard(guild, 10, (page - 1) * 10);
    const lines = list.map((u) => t('commands.leaderboard.level_xp', { v0: MEDALS[u.rank - 1] ?? `**#${u.rank}**`, name: u.name, level: u.level, toLocaleString: u.xp.toLocaleString('fr-FR') }));
    const site = process.env.DASHBOARD_URL;
    const embed = new EmbedBuilder()
      .setColor(0xf5a524)
      .setTitle(t('commands.leaderboard.leaderboard', { name: guild.name }))
      .setThumbnail(guild.iconURL())
      .setDescription(lines.join('\n') || t('commands.leaderboard.nobody_has_xp_this_page'))
      .setFooter({ text: `Page ${page}` });
    if (site && config.publicLeaderboard) embed.addFields({ name: t('commands.leaderboard.full_leaderboard'), value: `${site}/leaderboard/${guild.id}` });
    await interaction.editReply({ embeds: [embed] });
  },
};

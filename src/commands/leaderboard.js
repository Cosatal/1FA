const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { getFeature } = require('../core/feature-config');
const { leaderboard } = require('../features/levels');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Classement des membres les plus actifs')
    .addIntegerOption((opt) => opt.setName('page').setDescription('Page du classement').setMinValue(1)),
  async execute(interaction) {
    const { guild } = interaction;
    const config = getFeature(guild.id, 'levels');
    if (!config.enabled) return interaction.reply({ content: 'Les niveaux ne sont pas activés sur ce serveur.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    const page = interaction.options.getInteger('page') ?? 1;
    const list = await leaderboard(guild, 10, (page - 1) * 10);
    const lines = list.map((u) => `${MEDALS[u.rank - 1] ?? `**#${u.rank}**`} ${u.name} · niveau **${u.level}** · ${u.xp.toLocaleString('fr-FR')} XP`);
    const site = process.env.DASHBOARD_URL;
    const embed = new EmbedBuilder()
      .setColor(0xf5a524)
      .setTitle(`🏆 Classement de ${guild.name}`)
      .setThumbnail(guild.iconURL())
      .setDescription(lines.join('\n') || 'Personne n’a encore d’XP sur cette page.')
      .setFooter({ text: `Page ${page}` });
    if (site && config.publicLeaderboard) embed.addFields({ name: 'Classement complet', value: `${site}/leaderboard/${guild.id}` });
    await interaction.editReply({ embeds: [embed] });
  },
};

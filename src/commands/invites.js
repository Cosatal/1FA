const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { inviteCount, inviteTop } = require('../features/moderation/guard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invitations des membres')
    .addSubcommand((sub) =>
      sub.setName('voir').setDescription('Nombre d’invitations d’un membre').addUserOption((opt) => opt.setName('membre').setDescription('Le membre (toi par défaut)')))
    .addSubcommand((sub) => sub.setName('classement').setDescription('Les meilleurs inviteurs du serveur')),
  async execute(interaction) {
    const { guild } = interaction;
    if (interaction.options.getSubcommand() === 'voir') {
      const user = interaction.options.getUser('membre') ?? interaction.user;
      const c = inviteCount(guild.id, user.id);
      return interaction.reply({
        content: `📨 ${user} a **${c.total}** invitation${c.total > 1 ? 's' : ''} (${c.joins} arrivée${c.joins > 1 ? 's' : ''}, ${c.leaves} départ${c.leaves > 1 ? 's' : ''}).`,
        allowedMentions: { parse: [] },
      });
    }
    const top = inviteTop(guild.id);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`📨 Meilleurs inviteurs de ${guild.name}`)
      .setDescription(top.map((s, i) => `**#${i + 1}** <@${s.userId}> · **${s.total}** (${s.joins} arrivées, ${s.leaves} départs)`).join('\n') || 'Aucune invitation suivie pour l’instant.');
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

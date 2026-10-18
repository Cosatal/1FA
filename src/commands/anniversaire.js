const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { setBirthday, removeBirthday, getBirthday, upcoming, validDate, formatDate } = require('../features/community');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('anniversaire')
    .setDescription('Ton anniversaire sur le serveur')
    .addSubcommand((sub) =>
      sub.setName('definir').setDescription('Enregistrer ta date d’anniversaire')
        .addIntegerOption((opt) => opt.setName('jour').setDescription('Jour (1 à 31)').setRequired(true).setMinValue(1).setMaxValue(31))
        .addIntegerOption((opt) => opt.setName('mois').setDescription('Mois (1 à 12)').setRequired(true).setMinValue(1).setMaxValue(12)))
    .addSubcommand((sub) =>
      sub.setName('voir').setDescription('Voir l’anniversaire d’un membre').addUserOption((opt) => opt.setName('membre').setDescription('Le membre (toi par défaut)')))
    .addSubcommand((sub) => sub.setName('supprimer').setDescription('Retirer ta date d’anniversaire'))
    .addSubcommand((sub) => sub.setName('prochains').setDescription('Les prochains anniversaires du serveur')),
  async execute(interaction) {
    const { guild, user } = interaction;
    const sub = interaction.options.getSubcommand();
    const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (sub === 'definir') {
      const day = interaction.options.getInteger('jour');
      const month = interaction.options.getInteger('mois');
      if (!validDate(day, month)) return ephemeral('Cette date n’existe pas.');
      setBirthday(guild.id, user.id, day, month);
      return ephemeral(`🎂 C’est noté : ton anniversaire est le **${formatDate({ day, month })}**.`);
    }
    if (sub === 'supprimer') return ephemeral(removeBirthday(guild.id, user.id) ? 'Ta date d’anniversaire a été retirée.' : 'Tu n’avais pas enregistré de date.');
    if (sub === 'voir') {
      const target = interaction.options.getUser('membre') ?? user;
      const date = getBirthday(guild.id, target.id);
      return interaction.reply({
        content: date ? `🎂 L’anniversaire de ${target} est le **${formatDate(date)}**.` : `${target} n’a pas enregistré sa date (/anniversaire definir).`,
        allowedMentions: { parse: [] },
      });
    }

    const list = upcoming(guild.id);
    const when = (n) => (n === 0 ? '**aujourd’hui** 🎉' : n === 1 ? 'demain' : `dans ${n} jours`);
    const embed = new EmbedBuilder()
      .setColor(0xeb459e)
      .setTitle('🎂 Prochains anniversaires')
      .setDescription(list.map((b) => `<@${b.userId}> · ${formatDate(b)} · ${when(b.in)}`).join('\n') || 'Personne n’a encore enregistré sa date. Utilise /anniversaire definir !');
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

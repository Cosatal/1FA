const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const { setBirthday, removeBirthday, getBirthday, upcoming, validDate, formatDate } = require('../features/community');
const { t } = require('../core/i18n');

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
      if (!validDate(day, month)) return ephemeral(t('commands.anniversaire.this_date_doesn_exist'));
      setBirthday(guild.id, user.id, day, month);
      return ephemeral(t('commands.anniversaire.got_it_birthday', { formatDate: formatDate({ day, month }) }));
    }
    if (sub === 'supprimer') return ephemeral(removeBirthday(guild.id, user.id) ? t('commands.anniversaire.birthday_has_been_removed') : t('commands.anniversaire.hadn_saved_date'));
    if (sub === 'voir') {
      const target = interaction.options.getUser('membre') ?? user;
      const date = getBirthday(guild.id, target.id);
      return interaction.reply({
        content: date ? t('commands.anniversaire.birthday', { target, formatDate: formatDate(date) }) : t('commands.anniversaire.hasn_saved_their_date_birthday', { target }),
        allowedMentions: { parse: [] },
      });
    }

    const list = upcoming(guild.id);
    const when = (n) => (n === 0 ? '**aujourd’hui** 🎉' : n === 1 ? 'demain' : t('commands.anniversaire.days', { n }));
    const embed = new EmbedBuilder()
      .setColor(0xeb459e)
      .setTitle(t('commands.anniversaire.upcoming_birthdays'))
      .setDescription(list.map((b) => `<@${b.userId}> · ${formatDate(b)} · ${when(b.in)}`).join('\n') || t('commands.anniversaire.nobody_has_saved_their_date'));
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

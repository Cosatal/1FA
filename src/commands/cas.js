const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const { getCase, userCases, caseField } = require('../features/moderation/cases');
const { PANEL_COLOR } = require('../core/credits');
const { keep } = require('../dashboard/public/i18n');
const { t } = require('../core/i18n');

// /cas voir <numéro>: one case in detail · /cas membre <membre>: a member's latest cases
module.exports = {
  data: new SlashCommandBuilder()
    .setName('cas')
    .setDescription('Voir les cas de modération (sanctions numérotées)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((sub) =>
      sub
        .setName('voir')
        .setDescription('Voir un cas')
        .addIntegerOption((opt) => opt.setName('numero').setDescription('Le numéro du cas').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('membre')
        .setDescription('Les derniers cas d’un membre')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true)),
    ),
  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'voir') {
      const entry = getCase(interaction.guild.id, interaction.options.getInteger('numero'));
      if (!entry) return interaction.reply({ content: t('commands.cas.not_found'), flags: MessageFlags.Ephemeral });
      const embed = new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setDescription(`<@${entry.userId}> · \`${entry.userTag}\``)
        .addFields(caseField(entry));
      if (entry.until) embed.addFields({ name: t('cases.field_end'), value: `<t:${Math.floor(entry.until / 1000)}:f>`, inline: true });
      if (entry.appeal) {
        embed.addFields({ name: t(`cases.appeal_status.${entry.appeal.status}`), value: keep(entry.appeal.text, 1024) });
        if (entry.appeal.answer) embed.addFields({ name: t('cases.staff_answer'), value: keep(entry.appeal.answer, 1024) });
      }
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const user = interaction.options.getUser('membre');
    const list = userCases(interaction.guild.id, user.id);
    const embed = new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setTitle(t('commands.cas.member_title', { count: list.length }))
      .addFields(list.slice(-10).reverse().map(caseField));
    if (!list.length) embed.setDescription(t('commands.cas.no_cases'));
    else if (list.length > 10) embed.setFooter({ text: t('commands.cas.latest_ten') });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { addXp, setXp, resetUser, stats, totalFor, syncRewards } = require('../features/levels');
const { getFeature } = require('../core/feature-config');

const member = (opt) => opt.setName('membre').setDescription('Le membre').setRequired(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Gérer l’XP des membres')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName('ajouter').setDescription('Donner de l’XP').addUserOption(member)
        .addIntegerOption((opt) => opt.setName('montant').setDescription('XP à donner').setRequired(true).setMinValue(1).setMaxValue(1000000)))
    .addSubcommand((sub) =>
      sub.setName('retirer').setDescription('Retirer de l’XP').addUserOption(member)
        .addIntegerOption((opt) => opt.setName('montant').setDescription('XP à retirer').setRequired(true).setMinValue(1).setMaxValue(1000000)))
    .addSubcommand((sub) =>
      sub.setName('niveau').setDescription('Mettre un membre à un niveau précis').addUserOption(member)
        .addIntegerOption((opt) => opt.setName('niveau').setDescription('Le niveau').setRequired(true).setMinValue(0).setMaxValue(1000)))
    .addSubcommand((sub) => sub.setName('reset').setDescription('Remettre l’XP d’un membre à zéro').addUserOption(member)),
  async execute(interaction) {
    const target = interaction.options.getMember('membre');
    if (!target || target.user.bot) return interaction.reply({ content: 'Choisis un membre du serveur (pas un bot).', flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();
    const amount = interaction.options.getInteger('montant');

    if (sub === 'ajouter') await addXp(target, amount);
    if (sub === 'retirer') await addXp(target, -amount);
    if (sub === 'niveau') await setXp(target, totalFor(interaction.options.getInteger('niveau')));
    if (sub === 'reset') {
      resetUser(interaction.guild.id, target.id);
      await syncRewards(target, 0, getFeature(interaction.guild.id, 'levels'));
    }

    const s = stats(interaction.guild.id, target.id);
    await interaction.reply({ content: `✅ ${target} : niveau **${s.level}** · ${s.xp.toLocaleString('fr-FR')} XP.`, allowedMentions: { parse: [] } });
  },
};

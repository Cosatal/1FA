const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { addWarning, modLog, targetError } = require('../features/moderation/moderation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Avertir un membre')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((opt) => opt.setName('raison').setDescription('La raison').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const user = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison');
    if (user.bot) return interaction.reply({ content: 'On ne peut pas avertir un bot.', flags: MessageFlags.Ephemeral });
    const error = targetError(interaction, interaction.options.getMember('membre'), () => true);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

    const count = addWarning(interaction.guild.id, user.id, { reason, by: interaction.user.username, at: Date.now() });
    // Reply first (Discord gives 3 seconds), then the DM: DMs may be closed, the error is ignored
    await interaction.reply(`⚠️ ${user} a reçu un avertissement (${count} au total). Raison : ${reason}`);
    await user.send(`⚠️ Tu as reçu un avertissement sur **${interaction.guild.name}** : ${reason}`).catch(() => {});
    await modLog(interaction.guild, { event: 'modWarn', action: `Avertissement n°${count}`, color: 0xf5a524, target: user, moderator: interaction.user, reason });
  },
};

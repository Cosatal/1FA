const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role-info')
    .setDescription('Obtenir des informations sur un rôle')
    .addRoleOption((opt) => opt.setName('rôle').setDescription('Le rôle').setRequired(true)),
  async execute(interaction) {
    const role = interaction.options.getRole('rôle');
    const perms = role.permissions.toArray();
    const embed = new EmbedBuilder()
      .setColor(role.color || 0x2f7ff0)
      .setTitle(`🎭 ${role.name}`)
      .addFields(
        { name: 'Mention', value: `${role}`, inline: true },
        { name: 'Couleur', value: role.hexColor, inline: true },
        // Without the Server Members Intent, only members already seen by the bot are counted
        { name: 'Membres', value: `${role.members.size}`, inline: true },
        { name: 'Position', value: `${role.position}`, inline: true },
        { name: 'Affiché à part', value: role.hoist ? 'Oui' : 'Non', inline: true },
        { name: 'Mentionnable', value: role.mentionable ? 'Oui' : 'Non', inline: true },
        { name: 'Créé', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true },
        { name: `Permissions (${perms.length})`, value: perms.includes('Administrator') ? 'Administrateur (toutes)' : perms.join(', ').slice(0, 1024) || 'Aucune' },
      )
      .setFooter({ text: `ID : ${role.id}` });
    await interaction.reply({ embeds: [embed] });
  },
};

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { t } = require('../core/i18n');

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
        { name: t('commands.roleInfo.color'), value: role.hexColor, inline: true },
        // Without the Server Members Intent, only members already seen by the bot are counted
        { name: t('commands.roleInfo.members'), value: `${role.members.size}`, inline: true },
        { name: 'Position', value: `${role.position}`, inline: true },
        { name: t('commands.roleInfo.displayed_separately'), value: role.hoist ? t('commands.roleInfo.yes') : t('commands.roleInfo.no'), inline: true },
        { name: t('commands.roleInfo.mentionable'), value: role.mentionable ? t('commands.roleInfo.yes') : t('commands.roleInfo.no'), inline: true },
        { name: t('commands.roleInfo.created'), value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: true },
        { name: `Permissions (${perms.length})`, value: perms.includes('Administrator') ? t('commands.roleInfo.administrator_all') : perms.join(', ').slice(0, 1024) || t('commands.roleInfo.none') },
      )
      .setFooter({ text: `ID : ${role.id}` });
    await interaction.reply({ embeds: [embed] });
  },
};

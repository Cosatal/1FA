const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { modLog } = require('../features/moderation/moderation');
const { unlockChannel, unlockServer, lockEmbed, isLocked } = require('../features/moderation/lockdown');
const { logActivity } = require('../core/activity');
const { t } = require('../core/i18n');

// /unlock salon or /unlock serveur: ends a lockdown, the previous permissions are restored exactly
module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Déverrouiller un salon ou tout le serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('salon')
        .setDescription('Déverrouiller un salon')
        .addChannelOption((opt) => opt.setName('salon').setDescription('Le salon (celui-ci par défaut)')),
    )
    .addSubcommand((sub) => sub.setName('serveur').setDescription('Déverrouiller tous les salons verrouillés')),
  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'salon') {
      const channel = interaction.options.getChannel('salon') ?? interaction.channel;
      if (!isLocked(interaction.guild.id, channel.id)) return interaction.reply({ content: t('commands.unlock.not_locked', { channel: `${channel}` }), flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: channel.id === interaction.channelId ? undefined : MessageFlags.Ephemeral });
      await unlockChannel(interaction.guild, channel.id);
      if (channel.id === interaction.channelId) await interaction.editReply({ embeds: [lockEmbed(false, {})] });
      else {
        await channel.send({ embeds: [lockEmbed(false, {})] }).catch(() => {});
        await interaction.editReply(t('commands.unlock.channel_done', { channel: `${channel}` }));
      }
      logActivity(interaction.guild.id, { source: 'discord', action: 'unlock.channel', title: `${interaction.member.displayName} a déverrouillé #${channel.name}`, author: interaction.member, data: null });
      return modLog(interaction.guild, { event: 'modUnmute', action: t('commands.unlock.log_channel', { channel: channel.name }), color: 0x3ba55c, moderator: interaction.user });
    }

    await interaction.deferReply();
    const count = await unlockServer(interaction.guild);
    if (!count) return interaction.editReply(t('commands.unlock.nothing_locked'));
    await interaction.editReply({ content: t('commands.unlock.server_done', { count }), embeds: [lockEmbed(false, {})] });
    logActivity(interaction.guild.id, { source: 'discord', action: 'unlock.server', title: `${interaction.member.displayName} a déverrouillé le serveur (${count} salons)`, author: interaction.member, data: null });
    await modLog(interaction.guild, { event: 'modUnmute', action: t('commands.unlock.log_server'), color: 0x3ba55c, moderator: interaction.user });
  },
};

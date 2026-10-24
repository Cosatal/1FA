const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { parseDuration, modLog } = require('../features/moderation/moderation');
const { lockChannel, lockServer, lockEmbed } = require('../features/moderation/lockdown');
const { logActivity } = require('../core/activity');
const { t } = require('../core/i18n');

const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice];

// /lockdown salon: nobody (except the staff) can write in a channel anymore · /lockdown serveur: in every channel
module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription('Verrouiller un salon ou tout le serveur : plus personne n’y écrit, sauf le staff')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) =>
      sub
        .setName('salon')
        .setDescription('Verrouiller un salon')
        .addChannelOption((opt) => opt.setName('salon').setDescription('Le salon (celui-ci par défaut)').addChannelTypes(...CHANNEL_TYPES))
        .addStringOption((opt) => opt.setName('durée').setDescription('Ex : 10m, 2h, 1j (vide = jusqu’à /unlock)'))
        .addStringOption((opt) => opt.setName('raison').setDescription('La raison').setMaxLength(500)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('serveur')
        .setDescription('Verrouiller tous les salons du serveur')
        .addStringOption((opt) => opt.setName('durée').setDescription('Ex : 10m, 2h, 1j (vide = jusqu’à /unlock)'))
        .addStringOption((opt) => opt.setName('raison').setDescription('La raison').setMaxLength(500)),
    ),
  async execute(interaction) {
    const reason = interaction.options.getString('raison') ?? t('commands.lockdown.no_reason');
    const durationText = interaction.options.getString('durée');
    const ms = durationText ? parseDuration(durationText) : null;
    if (durationText && !ms) return interaction.reply({ content: t('commands.lockdown.unreadable_duration'), flags: MessageFlags.Ephemeral });
    const info = { until: ms ? Date.now() + ms : null, by: interaction.user.id, reason };

    if (interaction.options.getSubcommand() === 'salon') {
      const channel = interaction.options.getChannel('salon') ?? interaction.channel;
      const result = await lockChannel(channel, info);
      if (result === 'already') return interaction.reply({ content: t('commands.lockdown.already_locked', { channel: `${channel}` }), flags: MessageFlags.Ephemeral });
      if (result === 'forbidden') return interaction.reply({ content: t('commands.lockdown.missing_permissions', { channel: `${channel}` }), flags: MessageFlags.Ephemeral });
      // The message goes in the locked channel: the members there see why they can no longer write
      if (channel.id === interaction.channelId) await interaction.reply({ embeds: [lockEmbed(true, info)] });
      else {
        await channel.send({ embeds: [lockEmbed(true, info)] }).catch(() => {});
        await interaction.reply({ content: t('commands.lockdown.channel_done', { channel: `${channel}` }), flags: MessageFlags.Ephemeral });
      }
      logActivity(interaction.guild.id, { source: 'discord', action: 'lockdown.channel', title: `${interaction.member.displayName} a verrouillé #${channel.name}`, author: interaction.member, data: { raison: reason } });
      return modLog(interaction.guild, { event: 'modMute', action: t('commands.lockdown.log_channel', { channel: channel.name }), moderator: interaction.user, reason });
    }

    // Whole server: one change per channel, which can take a while on big servers
    await interaction.deferReply();
    const result = await lockServer(interaction.guild, info);
    const lines = [t('commands.lockdown.server_done', { count: result.locked })];
    if (result.already) lines.push(t('commands.lockdown.server_already', { count: result.already }));
    if (result.forbidden) lines.push(t('commands.lockdown.server_forbidden', { count: result.forbidden }));
    await interaction.editReply({ content: lines.join('\n'), embeds: [lockEmbed(true, info)] });
    logActivity(interaction.guild.id, { source: 'discord', action: 'lockdown.server', title: `${interaction.member.displayName} a verrouillé le serveur (${result.locked} salons)`, author: interaction.member, data: { raison: reason } });
    await modLog(interaction.guild, { event: 'modMute', action: t('commands.lockdown.log_server'), moderator: interaction.user, reason });
  },
};

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SnowflakeUtil, StringSelectMenuBuilder, UserSelectMenuBuilder, parseEmoji,
} = require('discord.js');
const { getTicketConfig, isStaff, staffPanelUrl } = require('./ticket-store');
const transcripts = require('./transcripts');
const { resolveAi, askAi } = require('../ai/ai-support');
const { KEEP, keep } = require('../../dashboard/public/i18n');
const { PANEL_COLOR } = require('../../core/credits');
const { logActivity } = require('../../core/activity');

// Tickets: a message with a button, or the ticket types menu, is posted in a channel of the server.
// Each open ticket is a private channel, visible only to the member, the staff role and the bot.
// The channel's messages are also saved in the staff panel (/staff).
// AI assistant (if enabled): it answers first in the channel, until a staff member writes
// or the member clicks "Parler à l'équipe" (staff is then mentioned).

const open = new Map(); // channel id of an open ticket → { guildId, ticketId, userId, type, ai (the AI still answers) }
const byMember = new Map(); // guildId:userId → channel id of their open ticket
const opening = new Set(); // guildId:userId whose channel is being created
function track(channelId, entry) {
  open.set(channelId, entry);
  byMember.set(`${entry.guildId}:${entry.userId}`, channelId);
}
function untrack(channelId) {
  const entry = open.get(channelId);
  if (!entry) return null;
  open.delete(channelId);
  webhooks.delete(channelId);
  if (byMember.get(`${entry.guildId}:${entry.userId}`) === channelId) byMember.delete(`${entry.guildId}:${entry.userId}`);
  return entry;
}
// Assistant enabled, and an AI usable on the server ("IA du serveur" tab)
const withAi = (config, guild) => config.ai.enabled && Boolean(resolveAi(guild));
// Texts written in the dashboard: sent as is, never translated (keep)
const fill = (text, guild) => keep(text.replaceAll('{server}', guild.name), 4096);

// ---------- The "Ouvrir un ticket" panel ----------

function panelMessage(guild, config) {
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(keep(config.title, 256))
    .setDescription(keep(config.description, 4096))
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined });
  if (config.image) embed.setImage(config.image);

  const row = new ActionRowBuilder();
  if (config.options.length) {
    row.addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('tk:open')
        .setPlaceholder(keep(config.placeholder, 150))
        .addOptions(config.options.map((o) => ({ label: keep(o.label, 100), value: o.id, ...(o.description && { description: keep(o.description, 100) }), ...(o.emoji && { emoji: parseEmoji(o.emoji) }) }))),
    );
  } else {
    row.addComponents(new ButtonBuilder().setCustomId('tk:open').setStyle(ButtonStyle.Primary).setLabel('Ouvrir un ticket').setEmoji('📩'));
  }
  return { embeds: [embed], components: [row] };
}

// Posts the panel, or updates the one already posted in the same channel. Returns the message id
async function publishTicketPanel(guild, config) {
  const channel = guild.channels.cache.get(config.panelChannelId);
  if (!channel?.isTextBased()) throw new Error('Choisis le salon où poster le bouton « Ouvrir un ticket ».');
  const old = config.panelMessageId ? await channel.messages.fetch(config.panelMessageId).catch(() => null) : null;
  try {
    return (old ? await old.edit(panelMessage(guild, config)) : await channel.send(panelMessage(guild, config))).id;
  } catch (error) {
    throw new Error(`Envoi du panneau des tickets impossible : ${error.message}. Vérifie que le bot peut écrire dans ce salon.`);
  }
}

// ---------- Opening ----------

// Buttons under the opening message: close, claim (or who claimed it), add a member, and "talk to the team" while the AI answers
function ticketButtons({ ai = false, claimedBy = null } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tk:close').setStyle(ButtonStyle.Danger).setLabel('Fermer').setEmoji('🔒'),
    claimedBy
      ? new ButtonBuilder().setCustomId('tk:claim').setStyle(ButtonStyle.Success).setLabel(keep(`Pris en charge par ${claimedBy}`, 80)).setEmoji('🙋').setDisabled(true)
      : new ButtonBuilder().setCustomId('tk:claim').setStyle(ButtonStyle.Secondary).setLabel('Prendre en charge').setEmoji('🙋'),
    new ButtonBuilder().setCustomId('tk:adduser').setStyle(ButtonStyle.Secondary).setLabel('Ajouter un membre').setEmoji('👤'),
    ...(ai ? [new ButtonBuilder().setCustomId('tk:staff').setStyle(ButtonStyle.Primary).setLabel('Parler à l’équipe').setEmoji('💬')] : []),
  );
}

// How a staff member appears in a ticket: "(Role) Name", the role shown separately in the member list, otherwise the highest
function staffSignature(member) {
  const role = member.roles.hoist ?? member.roles.highest;
  return `${role && role.id !== member.guild.id ? `(${role.name}) ` : ''}${member.displayName}`;
}

async function openChannelTicket(interaction) {
  const { guild, user } = interaction;
  const config = getTicketConfig(guild.id);
  if (!config.enabled) {
    return interaction.reply({ content: 'Les tickets ne sont pas ouverts sur ce serveur pour le moment.', flags: MessageFlags.Ephemeral });
  }
  // Only one open ticket per member and per server (and not two creations at once on a double-click)
  const key = `${guild.id}:${user.id}`;
  const existing = byMember.get(key);
  if (existing && guild.channels.cache.has(existing)) {
    return interaction.reply({ content: `Tu as déjà un ticket ouvert : <#${existing}>`, flags: MessageFlags.Ephemeral });
  }
  if (opening.has(key)) return interaction.reply({ content: 'Ton ticket est en cours de création…', flags: MessageFlags.Ephemeral });
  opening.add(key);
  try {
    await createTicketChannel(interaction, config);
  } finally {
    opening.delete(key);
  }
}

async function createTicketChannel(interaction, config) {
  const { guild, member, user } = interaction;
  const option = interaction.isStringSelectMenu() ? config.options.find((o) => o.id === interaction.values[0]) : null;
  const type = option ? `${option.emoji} ${option.label}`.trim() : '';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Private channel: invisible to @everyone, open to the member, the staff role and the bot
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];
  const staffRole = config.staffId && guild.roles.cache.get(config.staffId);
  const panel = guild.channels.cache.get(config.panelChannelId);
  let channel;
  try {
    channel = await guild.channels.create({
      name: `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 90) || 'ticket',
      type: ChannelType.GuildText,
      parent: config.categoryId || panel?.parentId || undefined,
      topic: `Ticket de ${user.tag}${type ? ` · ${type}` : ''}`,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow },
        ...(staffRole ? [{ id: staffRole.id, allow: [...allow, PermissionFlagsBits.ManageMessages] }] : []),
        // The bot also deletes the staff's messages to post them again with their role (see relayStaffMessage).
        // A permission can only be given in a channel if the bot has it on the server: otherwise the channel couldn't be created
        { id: guild.client.user.id, allow: [...allow, PermissionFlagsBits.ManageChannels, ...(guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages) ? [PermissionFlagsBits.ManageMessages] : [])] },
      ],
      reason: `Ticket de ${user.tag}`,
    });
  } catch (error) {
    console.error(`Ticket (${guild.name}):`, error.message);
    return interaction.editReply('❌ Je n’ai pas pu créer le salon du ticket : il me faut la permission « Gérer les salons » (et « Gérer les rôles »).');
  }

  const ai = withAi(config, guild);
  const id = SnowflakeUtil.generate().toString();
  transcripts.createTicket({ guildId: guild.id, id, user: { id: user.id, tag: user.tag, avatar: user.displayAvatarURL({ size: 64 }) }, type, channelId: channel.id });
  if (ai) transcripts.updateTicket(guild.id, id, { ai: true });
  track(channel.id, { guildId: guild.id, ticketId: id, userId: user.id, type, ai });
  logActivity(guild.id, { source: 'tickets', action: 'ticket.opened', title: `${member.displayName} a ouvert un ticket${type ? ` (${type})` : ''}`, author: member, data: { salon: channel.name } });

  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(type ? `🎫 Ticket — ${type}` : '🎫 Ticket')
    // Dashboard message as is; without a message, the bot's text (translated according to the server language)
    .setDescription(config.received.trim() ? fill(config.received.trim(), guild) : 'Merci d’avoir ouvert un ticket. Un membre du staff arrivera bientôt.')
    .addFields(
      { name: 'Ouvert par', value: `${member}`, inline: true },
      { name: 'Date', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
    )
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp();
  if (ai) {
    embed.addFields({ name: '🤖 Assistant IA', value: 'Pose ta question ici : l’assistant IA te répond tout de suite. Clique sur « Parler à l’équipe » si tu préfères un humain.' });
  }
  // With the AI, staff is only mentioned if the member asks for the team
  const ping = staffRole && !ai;
  const opening = await channel
    .send({
      content: `${member}${ping ? ` ${staffRole}` : ''}`,
      embeds: [embed],
      components: [ticketButtons({ ai })],
      allowedMentions: { users: [user.id], roles: ping ? [staffRole.id] : [] },
    })
    .catch(() => null);
  // Kept to update its buttons later ("Pris en charge par…", end of the AI)
  if (opening) transcripts.updateTicket(guild.id, id, { openingMessageId: opening.id });
  await interaction.editReply(`✅ Ton ticket est ouvert : ${channel}`);
  await notifyStaff(guild, id);
}

// ---------- Staff notifications ----------

// Each new ticket is announced in the staff channel chosen in the dashboard (staff role mentioned). When the ticket is closed,
// the same message becomes "Ticket fermé" (or a new one is posted if it was deleted). No channel chosen: nothing is sent.
// The id of the message is kept in the ticket (notifyMessageId).
async function notifyStaff(guild, ticketId, closedBy = null) {
  const config = getTicketConfig(guild.id);
  const channel = config.notifyChannelId && guild.channels.cache.get(config.notifyChannelId);
  const ticket = transcripts.getTicket(guild.id, ticketId);
  if (!channel?.isTextBased() || !ticket) return;

  const previous = transcripts.userTickets(guild.id, ticket.user.id).filter((t) => t.id !== ticket.id).length;
  const preview = ticket.messages.find((m) => m.from === 'member' && m.content)?.content;
  const link = `📂 **[Ouvrir le ticket dans le panel](${staffPanelUrl(`${guild.id}/${ticket.id}`)})**`;
  const embed = new EmbedBuilder()
    .setColor(closedBy ? 0x3ba55c : PANEL_COLOR)
    .setAuthor({ name: ticket.user.tag, iconURL: ticket.user.avatar ?? undefined })
    .setTitle(`${closedBy ? '✅ Ticket fermé' : '📬 Nouveau ticket'}${ticket.type ? ` — ${ticket.type}` : ''}`)
    // First message of the member, as a quote
    .setDescription(preview ? `> ${preview.slice(0, 300).replace(/\n/g, ' ')}\n\n${link}` : link)
    .addFields(
      { name: 'Membre', value: `<@${ticket.user.id}> · \`${ticket.user.id}\``, inline: true },
      { name: 'Tickets précédents', value: previous ? `[${previous}](${staffPanelUrl(`${guild.id}/u/${ticket.user.id}`)})` : '0', inline: true },
      closedBy ? { name: 'Fermé par', value: closedBy.slice(0, 1024), inline: true } : { name: 'Salon', value: `<#${ticket.channelId}>`, inline: true },
      ...(ticket.claimedBy ? [{ name: 'Pris en charge par', value: `<@${ticket.claimedBy.id}>`, inline: true }] : []),
    )
    .setTimestamp(closedBy ? ticket.closedAt ?? Date.now() : ticket.openedAt);
  const staffId = config.staffId && guild.roles.cache.has(config.staffId) ? config.staffId : '';
  const payload = { content: staffId ? `<@&${staffId}>` : undefined, embeds: [embed], allowedMentions: { roles: staffId && !closedBy ? [staffId] : [] } };

  const old = ticket.notifyMessageId ? await channel.messages.fetch(ticket.notifyMessageId).catch(() => null) : null;
  const message = old ? await old.edit(payload).catch(() => null) : await channel.send(payload).catch(() => null);
  if (message && message.id !== ticket.notifyMessageId) transcripts.updateTicket(guild.id, ticket.id, { notifyMessageId: message.id });
}

// ---------- AI assistant ----------

// What the AI needs to know to answer in this channel, or null if it must stop answering
function aiContext(channel) {
  const entry = open.get(channel.id);
  if (!entry?.ai) return null;
  const guild = channel.guild;
  return {
    userId: entry.userId,
    since: channel.id, // the channel id is older than all its messages
    guild,
    config: getTicketConfig(guild.id),
    type: entry.type,
    // AI replies are also saved in the staff panel
    onReply: (text) => transcripts.addMessage(entry.guildId, entry.ticketId, { from: 'ai', author: 'Assistant IA', content: text }).catch(() => {}),
  };
}

// The AI stops answering (staff wrote, or the member asked for the team)
function stopAi(channelId) {
  const entry = open.get(channelId);
  if (!entry?.ai) return false;
  entry.ai = false;
  transcripts.updateTicket(entry.guildId, entry.ticketId, { ai: false });
  return true;
}

// ---------- Closing ----------

// Closing (channel button or staff panel): saved, the member gets the closing message in DMs, the channel is deleted.
// by: the member who closed it (for the Logs tab), from: where ("Discord" or "panel staff")
async function closeChannelTicket(guild, ticketId, closedBy, by = null, from = 'Discord') {
  const ticket = transcripts.getTicket(guild.id, ticketId);
  if (!ticket || ticket.closedAt) return;
  transcripts.updateTicket(guild.id, ticketId, { closedAt: Date.now(), closedBy });
  untrack(ticket.channelId);
  logActivity(guild.id, { source: 'tickets', action: 'ticket.closed', title: `Ticket de ${ticket.user.tag} fermé par ${closedBy} (${from})`, author: by });
  notifyStaff(guild, ticketId, closedBy).catch(() => {});

  const config = getTicketConfig(guild.id);
  if (config.closed.trim()) {
    const embed = new EmbedBuilder()
      .setColor(PANEL_COLOR)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() ?? undefined })
      .setDescription(fill(config.closed, guild));
    const user = await guild.client.users.fetch(ticket.user.id).catch(() => null);
    await user?.send({ embeds: [embed] }).catch(() => {}); // DMs may be closed
  }
  const channel = guild.channels.cache.get(ticket.channelId);
  await channel?.send(`🔒 Ticket fermé par **${closedBy}**. Ce salon sera supprimé dans 5 secondes.`).catch(() => {});
  setTimeout(() => channel?.delete(`Ticket fermé par ${closedBy}`).catch(() => {}), 5000);
}

// ---------- Buttons and menu ("tk:" prefix) ----------

// The opening message's buttons follow the ticket: AI still answering, claimed by someone
async function refreshButtons(channel, ticketId) {
  const ticket = transcripts.getTicket(channel.guild.id, ticketId);
  const message = ticket?.openingMessageId && (await channel.messages.fetch(ticket.openingMessageId).catch(() => null));
  const entry = open.get(channel.id);
  await message?.edit({ components: [ticketButtons({ ai: entry?.ai, claimedBy: ticket.claimedBy?.name })] }).catch(() => {});
}

async function handleTicketPanel(interaction) {
  if (interaction.customId === 'tk:open') return openChannelTicket(interaction);
  const entry = open.get(interaction.channelId);
  if (!entry) return interaction.reply({ content: 'Ce ticket est déjà fermé.', flags: MessageFlags.Ephemeral });
  const { guild, member, channel } = interaction;
  const staff = isStaff(member);
  // Staff or the ticket's author can use its buttons; claiming and adding members are for the staff
  if (interaction.user.id !== entry.userId && !staff) {
    return interaction.reply({ content: 'Seuls le staff et l’auteur du ticket peuvent utiliser ces boutons.', flags: MessageFlags.Ephemeral });
  }
  if (['tk:claim', 'tk:adduser', 'tk:adduser:pick'].includes(interaction.customId) && !staff) {
    return interaction.reply({ content: 'Réservé au staff.', flags: MessageFlags.Ephemeral });
  }

  // A staff member takes the ticket: everyone sees who handles it, the AI goes quiet
  if (interaction.customId === 'tk:claim') {
    const ticket = transcripts.getTicket(guild.id, entry.ticketId);
    if (ticket?.claimedBy) return interaction.reply({ content: `Ce ticket est déjà pris en charge par **${ticket.claimedBy.name}**.`, flags: MessageFlags.Ephemeral });
    const signature = staffSignature(member);
    stopAi(channel.id);
    transcripts.updateTicket(guild.id, entry.ticketId, { claimedBy: { id: member.id, name: member.displayName } });
    await interaction.update({ components: [ticketButtons({ claimedBy: member.displayName })] });
    await channel.send({ content: `🙋 **${keep(signature)}** prend en charge ce ticket.`, allowedMentions: { parse: [] } }).catch(() => {});
    logActivity(guild.id, { source: 'tickets', action: 'ticket.claimed', title: `${member.displayName} a pris en charge le ticket de ${ticket.user.tag}`, author: member });
    return notifyStaff(guild, entry.ticketId).catch(() => {});
  }

  // Add a member: a menu to pick them, only visible to the staff member who clicked
  if (interaction.customId === 'tk:adduser') {
    return interaction.reply({
      content: 'Qui veux-tu ajouter à ce ticket ?',
      components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('tk:adduser:pick').setPlaceholder('Choisis un ou plusieurs membres…').setMinValues(1).setMaxValues(5))],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (interaction.customId === 'tk:adduser:pick') {
    const added = [];
    for (const user of interaction.users.values()) {
      if (user.bot || user.id === entry.userId) continue;
      const ok = await channel.permissionOverwrites
        .edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true }, { reason: `Ajouté au ticket par ${member.user.tag}` })
        .then(() => true, () => false);
      if (ok) added.push(user);
    }
    if (!added.length) return interaction.update({ content: '❌ Personne n’a été ajouté (il me faut la permission « Gérer les rôles »).', components: [] });
    await interaction.update({ content: `✅ ${added.map((u) => `${u}`).join(', ')} ajouté${added.length > 1 ? 's' : ''} au ticket.`, components: [] });
    await channel.send({ content: `➕ ${member} a ajouté ${added.map((u) => `${u}`).join(', ')} au ticket.`, allowedMentions: { users: added.map((u) => u.id) } }).catch(() => {});
    logActivity(guild.id, { source: 'tickets', action: 'ticket.member_added', title: `${member.displayName} a ajouté ${added.map((u) => u.username).join(', ')} à un ticket`, author: member, data: { salon: channel.name } });
    return;
  }

  if (interaction.customId === 'tk:staff') {
    stopAi(interaction.channelId);
    logActivity(interaction.guild.id, { source: 'tickets', action: 'ticket.team_requested', title: `${interaction.member.displayName} a demandé à parler à l’équipe`, author: interaction.member, data: { salon: interaction.channel.name } });
    // The "talk to the team" button disappears
    const ticket = transcripts.getTicket(guild.id, entry.ticketId);
    await interaction.update({ components: [ticketButtons({ claimedBy: ticket?.claimedBy?.name })] });
    const staffId = getTicketConfig(interaction.guild.id).staffId;
    await interaction.channel
      .send({
        content: `👤 ${interaction.member} demande à parler à l’équipe${staffId ? ` <@&${staffId}>` : ''}. L’assistant IA ne répond plus dans ce ticket.`,
        allowedMentions: { roles: staffId ? [staffId] : [] },
      })
      .catch(() => {});
    return;
  }
  if (interaction.customId !== 'tk:close') return;
  await interaction.deferUpdate();
  await closeChannelTicket(interaction.guild, entry.ticketId, interaction.member.displayName, interaction.member);
}

// ---------- Messages written in a ticket channel: copied to the staff panel ----------

async function handleTicketChannelMessage(message) {
  const entry = open.get(message.channelId);
  if (!entry || message.author.bot || message.webhookId) return;
  const fromMember = message.author.id === entry.userId;
  const staff = !fromMember && message.member && isStaff(message.member);
  // A staff member takes over: the AI goes quiet (and its "talk to the team" button disappears)
  if (!fromMember && stopAi(message.channelId)) refreshButtons(message.channel, entry.ticketId).catch(() => {});
  // Saved (files copied) before the staff message is posted again, while its attachments still exist
  await transcripts.addMessage(entry.guildId, entry.ticketId, {
    from: fromMember ? 'member' : 'staff',
    author: fromMember ? message.author.tag : staff ? staffSignature(message.member) : message.member?.displayName ?? message.author.username,
    content: message.content,
    attachments: message.attachments,
    mid: message.id,
  });
  if (staff) await relayStaffMessage(message).catch(() => {});
  if (fromMember && entry.ai) askAi(message.channel, () => aiContext(message.channel));
}

// ---------- Staff messages shown with their role ----------
// A staff member writes in a ticket: the bot posts the message again as "(Role) Name", with their avatar (webhook of the
// channel), then deletes the original. Without "Gérer les webhooks", the bot posts it itself as "**(Role) Name :** message".
// Nothing is changed if the bot can't delete the original (the message just stays as it is).
const webhooks = new Map(); // channelId → webhook
async function webhookFor(channel) {
  if (webhooks.has(channel.id)) return webhooks.get(channel.id);
  if (!channel.guild.members.me.permissionsIn(channel).has(PermissionFlagsBits.ManageWebhooks)) return null;
  const existing = (await channel.fetchWebhooks().catch(() => null))?.find((w) => w.owner?.id === channel.client.user.id);
  const webhook = existing ?? (await channel.createWebhook({ name: 'Tickets', reason: 'Messages du staff dans les tickets' }).catch(() => null));
  if (webhook) webhooks.set(channel.id, webhook);
  return webhook;
}

async function relayStaffMessage(message) {
  const { channel, member } = message;
  if (!channel.guild.members.me.permissionsIn(channel).has(PermissionFlagsBits.ManageMessages)) return;
  const signature = staffSignature(member);
  const files = [...message.attachments.values()].map((a) => ({ attachment: a.url, name: a.name }));
  const webhook = await webhookFor(channel);
  // Texts written by the staff: never translated (KEEP), and nobody is pinged twice
  const sent = webhook
    ? await webhook.send({ username: signature.slice(0, 80), avatarURL: member.displayAvatarURL({ size: 128 }), content: message.content ? `${KEEP}${message.content}` : undefined, files, allowedMentions: { parse: [] } }).catch(() => null)
    : await channel.send({ content: `${KEEP}**${signature} :**${message.content ? ` ${message.content}` : ''}`, files, allowedMentions: { parse: [] } }).catch(() => null);
  if (sent) await message.delete().catch(() => {});
}

// Ticket channel deleted by hand: the ticket is closed
function handleTicketChannelDelete(channel) {
  const entry = untrack(channel.id);
  if (!entry) return;
  transcripts.updateTicket(entry.guildId, entry.ticketId, { closedAt: Date.now(), closedBy: 'Salon supprimé' });
  logActivity(entry.guildId, { source: 'tickets', action: 'ticket.channel_deleted', title: `Le salon du ticket #${channel.name} a été supprimé : ticket fermé` });
  notifyStaff(channel.guild, entry.ticketId, 'Salon supprimé').catch(() => {});
}

// On startup: finds the channels of open tickets (those deleted while the bot was off are closed)
function restoreTicketChannels(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const t of transcripts.listTickets(guild.id, { status: 'open' })) {
      if (!t.channelId) continue;
      if (guild.channels.cache.has(t.channelId)) {
        track(t.channelId, { guildId: guild.id, ticketId: t.id, userId: t.user.id, type: t.type, ai: transcripts.getTicket(guild.id, t.id)?.ai === true });
      } else transcripts.updateTicket(guild.id, t.id, { closedAt: Date.now(), closedBy: 'Salon supprimé' });
    }
  }
}

module.exports = { publishTicketPanel, handleTicketPanel, closeChannelTicket, notifyStaff, handleTicketChannelMessage, handleTicketChannelDelete, restoreTicketChannels };

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SnowflakeUtil, StringSelectMenuBuilder, parseEmoji,
} = require('discord.js');
const { getTicketConfig, isStaff } = require('./ticket-store');
const transcripts = require('./transcripts');
const { resolveAi, askAi } = require('../ai/ai-support');
const { KEEP, keep } = require('../../dashboard/public/i18n');
const { PANEL_COLOR } = require('../../core/credits');

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

const closeButton = () => new ButtonBuilder().setCustomId('tk:close').setStyle(ButtonStyle.Danger).setLabel('Fermer le ticket').setEmoji('🔒');
const staffButton = () => new ButtonBuilder().setCustomId('tk:staff').setStyle(ButtonStyle.Secondary).setLabel('Parler à l’équipe').setEmoji('👤');

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
        { id: guild.client.user.id, allow: [...allow, PermissionFlagsBits.ManageChannels] },
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

  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setAuthor({ name: guild.client.user.username, iconURL: guild.client.user.displayAvatarURL() })
    // Dashboard message as is; without a message, the bot's text (translated according to the server language)
    .setDescription(config.received.trim() ? fill(config.received.trim(), guild) : 'Ton ticket est ouvert : explique ta demande ici, l’équipe va te répondre.');
  if (type) embed.addFields({ name: 'Type de demande', value: keep(type, 1024) });
  if (ai) {
    embed.addFields({ name: '🤖 Assistant IA', value: 'Pose ta question ici : l’assistant IA te répond tout de suite. Clique sur « Parler à l’équipe » si tu préfères un humain.' });
  }
  // With the AI, staff is only mentioned if the member asks for the team
  const ping = staffRole && !ai;
  await channel
    .send({
      content: `${member}${ping ? ` ${staffRole}` : ''}`,
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(...(ai ? [staffButton()] : []), closeButton())],
      allowedMentions: { users: [user.id], roles: ping ? [staffRole.id] : [] },
    })
    .catch(() => {});
  await interaction.editReply(`✅ Ton ticket est ouvert : ${channel}`);
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

// Closing (channel button or staff panel): saved, the member gets the closing message in DMs, the channel is deleted
async function closeChannelTicket(guild, ticketId, closedBy) {
  const ticket = transcripts.getTicket(guild.id, ticketId);
  if (!ticket || ticket.closedAt) return;
  transcripts.updateTicket(guild.id, ticketId, { closedAt: Date.now(), closedBy });
  untrack(ticket.channelId);

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

async function handleTicketPanel(interaction) {
  if (interaction.customId === 'tk:open') return openChannelTicket(interaction);
  const entry = open.get(interaction.channelId);
  if (!entry) return interaction.reply({ content: 'Ce ticket est déjà fermé.', flags: MessageFlags.Ephemeral });
  // Staff or the ticket's author can use its buttons
  if (interaction.user.id !== entry.userId && !isStaff(interaction.member)) {
    return interaction.reply({ content: 'Seuls le staff et l’auteur du ticket peuvent utiliser ces boutons.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'tk:staff') {
    stopAi(interaction.channelId);
    // The button disappears, only "Fermer" remains
    await interaction.update({ components: [new ActionRowBuilder().addComponents(closeButton())] });
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
  await closeChannelTicket(interaction.guild, entry.ticketId, interaction.member.displayName);
}

// ---------- Messages written in a ticket channel: copied to the staff panel ----------

async function handleTicketChannelMessage(message) {
  const entry = open.get(message.channelId);
  if (!entry || message.author.bot) return;
  const fromMember = message.author.id === entry.userId;
  // A staff member takes over: the AI goes quiet
  if (!fromMember) stopAi(message.channelId);
  await transcripts.addMessage(entry.guildId, entry.ticketId, {
    from: fromMember ? 'member' : 'staff',
    author: fromMember ? message.author.tag : message.member?.displayName ?? message.author.username,
    content: message.content,
    attachments: message.attachments,
    mid: message.id,
  });
  if (fromMember && entry.ai) askAi(message.channel, () => aiContext(message.channel));
}

// Reply written from the staff panel: posted in the ticket channel
async function replyInChannel(guild, ticket, signature, { content, file }) {
  const channel = guild.channels.cache.get(ticket.channelId);
  if (!channel) throw new Error('Le salon de ce ticket n’existe plus.');
  stopAi(ticket.channelId); // staff replies: the AI goes quiet
  await channel.send({
    content: `${KEEP}**${signature}:**${content ? ` ${content}` : ''}`,
    files: file ? [{ attachment: file.buffer, name: file.name }] : [],
    allowedMentions: { parse: [] },
  });
}

// Ticket channel deleted by hand: the ticket is closed
function handleTicketChannelDelete(channel) {
  const entry = untrack(channel.id);
  if (!entry) return;
  transcripts.updateTicket(entry.guildId, entry.ticketId, { closedAt: Date.now(), closedBy: 'Salon supprimé' });
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

module.exports = { publishTicketPanel, handleTicketPanel, closeChannelTicket, handleTicketChannelMessage, replyInChannel, handleTicketChannelDelete, restoreTicketChannels };

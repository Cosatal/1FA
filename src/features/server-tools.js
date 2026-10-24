const { ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { createStore } = require('../core/store');
const { getFeature, fillVars } = require('../core/feature-config');
const { keep } = require('../dashboard/public/i18n');
const { every } = require('../core/scheduler');
const { t } = require('../core/i18n');

// Small automatic modules: auto messages, temporary voice channels, counters.

// ---------- Auto messages ----------
// data/auto-messages.json = { <guildId>: { <messageId>: date of the last send } }

const sent = createStore('auto-messages', {});

function startAutoMessages(client) {
  every('auto-messages', 60000, async () => {
    for (const guild of client.guilds.cache.values()) {
      const config = getFeature(guild.id, 'autoMessages');
      if (!config.enabled || !config.list.length) continue;
      const last = sent.get(guild.id);
      let changed = false;
      for (const item of config.list) {
        // New message: first send within one interval
        if (!last[item.id]) {
          last[item.id] = Date.now();
          changed = true;
          continue;
        }
        if (Date.now() - last[item.id] < item.interval * 60000) continue;
        last[item.id] = Date.now();
        changed = true;
        // Message written in the dashboard: sent as is, never translated (keep)
        const content = fillVars(item.content, { server: guild.name });
        const payload = item.embed
          ? { embeds: [new EmbedBuilder().setColor(parseInt(item.color.slice(1), 16)).setDescription(keep(content, 4096))] }
          : { content: keep(content, 2000) };
        await guild.channels.cache.get(item.channelId)?.send(payload).catch((e) => console.error(`Auto message (${guild.name}):`, e.message));
      }
      if (changed) sent.save(guild.id, last);
    }
  });
}

// ---------- Temporary voice channels ----------
// data/temp-voice.json = { <guildId>: { channels: [ids of the created channels] } }

const temps = createStore('temp-voice', { channels: [] });

async function handleTempVoice(oldState, newState) {
  const guild = newState.guild;
  const config = getFeature(guild.id, 'tempVoice');

  // Temporary channel left and empty: deleted
  const left = oldState.channel;
  if (left && left.id !== newState.channelId && left.members.size === 0 && temps.peek(guild.id).channels.includes(left.id)) {
    await left.delete('Salon temporaire vide').catch(() => {});
    temps.save(guild.id, { channels: temps.get(guild.id).channels.filter((id) => id !== left.id) });
  }

  // "Creator" channel joined: new channel for this member
  if (!config.enabled || !config.hubId || newState.channelId !== config.hubId || oldState.channelId === newState.channelId) return;
  const { member } = newState;
  const hub = newState.channel;
  const options = {
    name: fillVars(config.name, { name: member.displayName }).slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: config.categoryId || hub.parentId || undefined,
    userLimit: config.limit,
    reason: t('serverTools.temporary_channel', { tag: member.user.tag }),
  };
  // The creator can rename, limit and kick in their channel (if the bot can grant those rights)
  const owner = { id: member.id, allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect] };
  const channel =
    (await guild.channels.create({ ...options, permissionOverwrites: [...hub.permissionOverwrites.cache.values(), owner] }).catch(() => null)) ??
    (await guild.channels.create(options).catch((e) => console.error(`Temporary channel (${guild.name}):`, e.message)));
  if (!channel) return;
  temps.save(guild.id, { channels: [...temps.get(guild.id).channels, channel.id] });
  await member.voice.setChannel(channel).catch(() => channel.delete().catch(() => {}));
}

// On startup: deletes the temporary channels that emptied while the bot was off
async function cleanTempVoice(client) {
  for (const guild of client.guilds.cache.values()) {
    const { channels } = temps.get(guild.id);
    if (!channels.length) continue;
    const keep = [];
    for (const id of channels) {
      const channel = guild.channels.cache.get(id);
      if (!channel) continue;
      if (channel.members.size === 0) await channel.delete('Salon temporaire vide').catch(() => keep.push(id));
      else keep.push(id);
    }
    temps.save(guild.id, { channels: keep });
  }
}

// ---------- Counters ----------

async function counterValue(guild, type) {
  if (type === 'members') return guild.memberCount;
  if (type === 'boosts') return guild.premiumSubscriptionCount ?? 0;
  if (type === 'channels') return guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size;
  if (type === 'roles') return guild.roles.cache.size - 1;
  // Humans / bots: requires the member list (Server Members intent)
  const members = guild.members.cache.size >= guild.memberCount ? guild.members.cache : await guild.members.fetch().catch(() => guild.members.cache);
  return members.filter((m) => m.user.bot === (type === 'bots')).size;
}

const counterName = async (guild, counter) => fillVars(counter.name, { count: (await counterValue(guild, counter.type)).toLocaleString('fr-FR') }).slice(0, 100);

// On save: creates the channels of new counters, deletes those of removed counters
async function applyCounters(guild, config, previous) {
  const keptIds = new Set(config.list.map((c) => c.channelId).filter(Boolean));
  for (const old of previous.list) {
    if (old.channelId && !keptIds.has(old.channelId)) await guild.channels.cache.get(old.channelId)?.delete(t('serverTools.counter_removed')).catch(() => {});
  }
  for (const counter of config.list) {
    const existing = guild.channels.cache.get(counter.channelId);
    if (existing) {
      if (config.categoryId && existing.parentId !== config.categoryId) await existing.setParent(config.categoryId, { lockPermissions: false }).catch(() => {});
      await existing.setName(await counterName(guild, counter)).catch(() => {});
      continue;
    }
    try {
      const channel = await guild.channels.create({
        name: await counterName(guild, counter),
        type: ChannelType.GuildVoice,
        parent: config.categoryId || undefined,
        position: 0,
        permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.Connect] }],
        reason: t('serverTools.counter'),
      });
      counter.channelId = channel.id;
    } catch (error) {
      throw new Error(t('serverTools.couldn_create_counter_channel_bot', { message: error.message }));
    }
  }
  return config;
}

// Every 10 minutes (Discord limits renames to 2 per channel every 10 minutes)
function startCounters(client) {
  every('counters', 10 * 60000, async () => {
    for (const guild of client.guilds.cache.values()) {
      const config = getFeature(guild.id, 'counters');
      for (const counter of config.list) {
        const channel = guild.channels.cache.get(counter.channelId);
        if (!channel) continue;
        const name = await counterName(guild, counter).catch(() => null);
        if (name && channel.name !== name) await channel.setName(name).catch(() => {});
      }
    }
  });
}

module.exports = { startAutoMessages, handleTempVoice, cleanTempVoice, applyCounters, startCounters };

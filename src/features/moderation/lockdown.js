const { ChannelType, EmbedBuilder, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { createStore } = require('../../core/store');
const { logActivity } = require('../../core/activity');
const { PANEL_COLOR } = require('../../core/credits');
const { keep } = require('../../dashboard/public/i18n');
const { every } = require('../../core/scheduler');
const { t } = require('../../core/i18n');

// Lockdown: members can no longer write in a channel, or in every channel of the server (/lockdown, /unlock, anti-raid).
// The bot denies "Send messages" (and threads) to @everyone and to the non-staff roles that were allowed to write there,
// after saving their previous permissions: unlocking restores them exactly, also after a restart.
// data/lockdowns.json = { <guildId>: { channels: { <channelId>: { saved: { <roleId>: { <permission>: true|false|null } }, until, by, reason, source } } } }
// source: 'command' or 'antiraid' (the end of the raid only unlocks the channels it locked)

const store = createStore('lockdowns', { channels: {} });
const PERMISSIONS = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];
// Channels where members write (the text chat of voice channels included)
const LOCKABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia, ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const STAFF = [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers];

const isLocked = (guildId, channelId) => Boolean(store.peek(guildId).channels[channelId]);
const lockedCount = (guildId) => Object.keys(store.peek(guildId).channels).length;

function canLock(channel) {
  if (!LOCKABLE.includes(channel.type)) return false;
  return Boolean(channel.permissionsFor(channel.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles]));
}

// @everyone, and the roles allowed to write in this channel that aren't staff (they would still be able to write otherwise)
function targetsOf(channel) {
  const { guild } = channel;
  const roles = channel.permissionOverwrites.cache
    .filter((o) => o.type === OverwriteType.Role && o.id !== guild.id && o.allow.has(PermissionFlagsBits.SendMessages))
    .filter((o) => !guild.roles.cache.get(o.id)?.permissions.any(STAFF))
    .map((o) => o.id);
  return [guild.id, ...roles];
}

const stateOf = (overwrite) => Object.fromEntries(PERMISSIONS.map((p) => [p, overwrite?.allow.has(p) ? true : overwrite?.deny.has(p) ? false : null]));

// Returns 'locked', 'already' (already locked) or 'forbidden' (the bot lacks permissions there)
// scope: 'channel' (/lockdown salon) or 'server' (every channel at once)
async function lockChannel(channel, { until = null, by, reason, source = 'command', scope = 'channel' }) {
  const { guild } = channel;
  if (isLocked(guild.id, channel.id)) return 'already';
  if (!canLock(channel)) return 'forbidden';
  const targets = targetsOf(channel);
  // Saved before changing anything: a crash midway can still be undone
  const data = store.get(guild.id);
  data.channels[channel.id] = { saved: Object.fromEntries(targets.map((id) => [id, stateOf(channel.permissionOverwrites.cache.get(id))])), until, by, reason, source, scope };
  store.save(guild.id, data);
  const deny = Object.fromEntries(PERMISSIONS.map((p) => [p, false]));
  try {
    for (const id of targets) await channel.permissionOverwrites.edit(id, deny, { reason: `Lockdown : ${reason}`, type: OverwriteType.Role });
  } catch (error) {
    await unlockChannel(guild, channel.id);
    console.error(`Lockdown #${channel.name}:`, error.message);
    return 'forbidden';
  }
  return 'locked';
}

// Restores the saved permissions. Returns false if the channel wasn't locked
async function unlockChannel(guild, channelId) {
  const data = store.get(guild.id);
  const entry = data.channels[channelId];
  if (!entry) return false;
  delete data.channels[channelId];
  store.save(guild.id, data);
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return true; // deleted in the meantime
  for (const [id, saved] of Object.entries(entry.saved)) {
    try {
      await channel.permissionOverwrites.edit(id, saved, { reason: t('lockdown.unlock_reason'), type: OverwriteType.Role });
      // An overwrite that didn't exist before (all null now) is removed: the channel can be synced with its category again
      const now = channel.permissionOverwrites.cache.get(id);
      if (now && now.allow.bitfield === 0n && now.deny.bitfield === 0n) await channel.permissionOverwrites.delete(id, t('lockdown.unlock_reason'));
    } catch (error) {
      console.error(`Unlock #${channel.name}:`, error.message);
    }
  }
  return true;
}

// Every channel of the server. Returns { locked, already, forbidden } (numbers of channels)
async function lockServer(guild, info) {
  const result = { locked: 0, already: 0, forbidden: 0 };
  for (const channel of guild.channels.cache.filter((c) => LOCKABLE.includes(c.type)).values()) result[await lockChannel(channel, { ...info, scope: 'server' })]++;
  return result;
}

// filter: which locks to lift (all by default). Returns the number of channels unlocked
async function unlockServer(guild, filter = () => true) {
  let count = 0;
  for (const [channelId, entry] of Object.entries(store.peek(guild.id).channels)) {
    if (filter(entry) && (await unlockChannel(guild, channelId))) count++;
  }
  return count;
}

// Message posted in a channel that has just been locked or unlocked
function lockEmbed(locked, { reason, until, by }) {
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(locked ? t('lockdown.channel_locked') : t('lockdown.channel_unlocked'))
    .setTimestamp();
  if (locked) {
    embed.setDescription(t('lockdown.locked_description'));
    if (reason) embed.addFields({ name: t('lockdown.reason'), value: keep(reason, 1024) });
    if (until) embed.addFields({ name: t('lockdown.end'), value: `<t:${Math.floor(until / 1000)}:R>`, inline: true });
    if (by) embed.addFields({ name: t('lockdown.by'), value: `<@${by}>`, inline: true });
  }
  return embed;
}

// Locks whose time is up are lifted (checked every 30 seconds, also after a restart)
function startLockdowns(client) {
  every('lockdown-end', 30000, async () => {
    for (const guild of client.guilds.cache.values()) {
      const due = Object.entries(store.peek(guild.id).channels).filter(([, entry]) => entry.until && entry.until <= Date.now());
      if (!due.length) continue;
      for (const [channelId, entry] of due) {
        await unlockChannel(guild, channelId);
        // Server lockdowns end silently in each channel (a message in every channel would be spam)
        if (entry.scope === 'channel') await guild.channels.cache.get(channelId)?.send({ embeds: [lockEmbed(false, {})] }).catch(() => {});
      }
      logActivity(guild.id, { source: 'bot', action: 'lockdown.ended', title: `Fin du verrouillage : ${due.length} salon${due.length > 1 ? 's' : ''} déverrouillé${due.length > 1 ? 's' : ''}`, data: null });
    }
  });
}

module.exports = { lockChannel, unlockChannel, lockServer, unlockServer, lockEmbed, isLocked, lockedCount, canLock, startLockdowns };

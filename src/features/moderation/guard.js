const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, GuildVerificationLevel, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createStore } = require('../../core/store');
const { logActivity } = require('../../core/activity');
const { getFeature, fillVars } = require('../../core/feature-config');
const { PANEL_COLOR } = require('../../core/credits');
const { keep } = require('../../dashboard/public/i18n');
const { translatorFor } = require('../../core/language');
const { every } = require('../../core/scheduler');
const { lockServer, unlockServer } = require('./lockdown');
const { t } = require('../../core/i18n');

// Security and arrivals: anti-raid (automatic lockdown), account age check (kick or quarantine) and invite tracking.

// =====================================================================
// Anti-raid
// data/anti-raid.json = { <guildId>: { until (end of lockdown), previousLevel (verification level to restore) } }
// =====================================================================

const raids = createStore('anti-raid', { until: 0, previousLevel: null });
const recentJoins = new Map(); // guildId → [{ member, at }]

async function raidAlert(guild, config, text) {
  // Logs tab: the first line as title, the whole alert in the details
  const [first, ...rest] = text.replaceAll('**', '').split('\n');
  logActivity(guild.id, { source: 'bot', action: 'antiraid.alert', title: first, data: rest.length ? { détails: rest.join(' ') } : null });
  const channel = guild.channels.cache.get(config.alertChannel);
  const ping = config.alertRole ? `<@&${config.alertRole}> ` : '';
  await channel?.send({ content: `${ping}${text}`, allowedMentions: { roles: config.alertRole ? [config.alertRole] : [] } }).catch(() => {});
}

const kick = (member, reason) => member.kickable && member.kick(reason).catch(() => {});

// =====================================================================
// Account age: accounts created less than X days ago are kicked, or put in quarantine (role or timeout)
// until they reach that age. The staff can release or kick them with the buttons of the alert.
// data/quarantine.json = { <guildId>: { members: { <userId>: { until, mode: 'role' | 'timeout', roleId } } } }
// =====================================================================

const quarantine = createStore('quarantine', { members: {} });
const MAX_TIMEOUT = 28 * 86400000; // Discord's limit: renewed by the scheduler if the account needs longer

function quarantineButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`qr:release:${userId}`).setLabel(t('guard.quarantine_release')).setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`qr:kick:${userId}`).setLabel(t('guard.quarantine_kick')).setEmoji('👢').setStyle(ButtonStyle.Danger),
  );
}

// Returns true if the member was quarantined (false: the bot couldn't, they are kicked instead)
async function quarantineMember(member, config) {
  const { guild } = member;
  const until = member.user.createdTimestamp + config.minAge * 86400000;
  const role = config.minAgeAction === 'quarantine' ? guild.roles.cache.get(config.quarantineRole) : null;
  let mode;
  if (role?.editable && (await member.roles.add(role, t('guard.quarantine_reason', { minAge: config.minAge })).then(() => true).catch(() => false))) mode = 'role';
  else if (member.moderatable && (await member.timeout(Math.min(until - Date.now(), MAX_TIMEOUT), t('guard.quarantine_reason', { minAge: config.minAge })).then(() => true).catch(() => false))) mode = 'timeout';
  else return false;

  const data = quarantine.get(guild.id);
  data.members[member.id] = { until, mode, roleId: mode === 'role' ? role.id : '' };
  quarantine.save(guild.id, data);

  const time = `<t:${Math.floor(until / 1000)}:R>`;
  await member.send(t('guard.quarantine_dm', { name: guild.name, minAge: config.minAge, v2: config.minAge > 1 ? 's' : '', time: `<t:${Math.floor(until / 1000)}:f>` })).catch(() => {});
  logActivity(guild.id, { source: 'bot', action: 'quarantine.added', title: `${member.user.tag} mis en quarantaine (compte créé il y a moins de ${config.minAge} jours)`, data: { id: member.id } });
  const channel = guild.channels.cache.get(config.alertChannel);
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setAuthor({ name: member.user.tag, iconURL: member.displayAvatarURL() })
    .setTitle(t('guard.quarantine_title'))
    .setDescription(`${member} · \`${member.id}\``)
    .addFields(
      { name: t('guard.account_created'), value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: t('guard.automatic_release'), value: time, inline: true },
      { name: t('guard.quarantine_mode'), value: mode === 'role' ? `<@&${role.id}>` : t('guard.quarantine_mode_timeout'), inline: true },
    )
    .setTimestamp();
  await channel?.send({ embeds: [embed], components: [quarantineButtons(member.id)] }).catch(() => {});
  return true;
}

// Releases a member from quarantine (role removed or timeout lifted). Returns false if they weren't in quarantine
async function releaseMember(guild, userId, reason) {
  const data = quarantine.get(guild.id);
  const entry = data.members[userId];
  if (!entry) return false;
  delete data.members[userId];
  quarantine.save(guild.id, data);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return true;
  if (entry.mode === 'role') await member.roles.remove(entry.roleId, reason).catch(() => {});
  else if (member.isCommunicationDisabled()) await member.timeout(null, reason).catch(() => {});
  return true;
}

const quarantineCount = (guildId) => Object.keys(quarantine.peek(guildId).members).length;

// Accounts that reached the required age are released; timeouts that end too early (28 days max) are renewed
function startQuarantine(client) {
  every('quarantine-release', 10 * 60000, async () => {
    for (const guild of client.guilds.cache.values()) {
      for (const [userId, entry] of Object.entries(quarantine.peek(guild.id).members)) {
        if (entry.until <= Date.now()) {
          await releaseMember(guild, userId, t('guard.quarantine_over'));
          logActivity(guild.id, { source: 'bot', action: 'quarantine.released', title: `Fin de la quarantaine de ${userId} : le compte a atteint l’âge requis`, data: { id: userId } });
          continue;
        }
        if (entry.mode !== 'timeout') continue;
        const member = guild.members.cache.get(userId);
        if (member && member.communicationDisabledUntilTimestamp - Date.now() < 3600000) {
          await member.timeout(Math.min(entry.until - Date.now(), MAX_TIMEOUT), t('guard.quarantine_over')).catch(() => {});
        }
      }
    }
  });
}

// Buttons of the quarantine alert: release or kick
async function handleQuarantineButton(interaction) {
  if (!interaction.inCachedGuild()) return;
  const [, action, userId] = interaction.customId.split(':');
  const permission = action === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.ModerateMembers;
  if (!interaction.memberPermissions.has(permission)) return interaction.reply({ content: t('guard.quarantine_no_permission'), flags: MessageFlags.Ephemeral });
  const { guild } = interaction;
  let done;
  if (action === 'release') {
    if (!(await releaseMember(guild, userId, t('guard.quarantine_released_by', { name: interaction.user.username })))) {
      return interaction.reply({ content: t('guard.quarantine_not_found'), flags: MessageFlags.Ephemeral });
    }
    done = t('guard.quarantine_released_line', { mod: `${interaction.user}` });
  } else {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member?.kickable) return interaction.reply({ content: t('guard.quarantine_cant_kick'), flags: MessageFlags.Ephemeral });
    const reason = t('guard.quarantine_kicked_reason', { name: interaction.user.username });
    await releaseMember(guild, userId, reason);
    await member.kick(reason);
    done = t('guard.quarantine_kicked_line', { mod: `${interaction.user}` });
  }
  const embed = EmbedBuilder.from(interaction.message.embeds[0]).addFields({ name: t('guard.quarantine_decision'), value: done });
  await interaction.update({ embeds: [embed], components: [] });
  logActivity(guild.id, { source: 'discord', action: `quarantine.${action}`, title: `${interaction.member.displayName} a ${action === 'kick' ? 'expulsé' : 'libéré'} ${userId} de la quarantaine`, author: interaction.member, data: { id: userId } });
}

// Returns true if the member was kicked (no welcome message in that case)
async function guardJoin(member) {
  const { guild } = member;
  const config = getFeature(guild.id, 'antiRaid');
  if (!config.enabled || member.user.bot) return false;

  // Account too new: quarantine (if chosen and possible), otherwise kick
  if (config.minAge && Date.now() - member.user.createdTimestamp < config.minAge * 86400000) {
    if (config.minAgeAction !== 'kick' && (await quarantineMember(member, config))) return false;
    await member.send(t('guard.discord_account_too_new_join', { name: guild.name, minAge: config.minAge, v2: config.minAge > 1 ? 's' : '' })).catch(() => {});
    await kick(member, t('guard.anti_raid_account_created_less', { minAge: config.minAge }));
    return true;
  }

  // Raid in progress: newcomers are kicked if requested
  if (raids.peek(guild.id).until > Date.now()) {
    if (config.action !== 'kick') return false;
    await kick(member, t('guard.anti_raid_server_locked'));
    return true;
  }

  const now = Date.now();
  const list = (recentJoins.get(guild.id) ?? []).filter((j) => now - j.at < config.seconds * 1000);
  list.push({ member, at: now });
  recentJoins.set(guild.id, list);
  if (list.length < config.joins) return false;

  // Raid detected: maximum verification (verified phone) for the chosen duration
  recentJoins.set(guild.id, []);
  raids.save(guild.id, { until: now + config.lockMinutes * 60000, previousLevel: guild.verificationLevel });
  const locked = await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, 'Anti-raid').then(() => true).catch(() => false);
  await raidAlert(
    guild,
    config,
    t('guard.raid_detected_joins_under_seconds', { length: list.length, seconds: config.seconds }) +
      (locked ? t('guard.server_locked_highest_verification_for', { lockMinutes: config.lockMinutes }) : t('guard.couldn_lock_need_manage_server')) +
      (config.lockChannels ? t('guard.raid_channels_locking') : '') +
      (config.action === 'kick' ? t('guard.raid_accounts_are_being_kicked') : ''),
  );
  if (config.action === 'kick') for (const j of list) await kick(j.member, 'Anti-raid');
  // Also every channel (like /lockdown serveur), if chosen: the accounts already in can no longer write either.
  // Last: one change per channel, it takes a while on big servers
  if (config.lockChannels) await lockServer(guild, { until: now + config.lockMinutes * 60000, by: guild.client.user.id, reason: 'Anti-raid', source: 'antiraid' });
  return config.action === 'kick';
}

async function endRaid(guild) {
  const state = raids.get(guild.id);
  if (!state.until) return false;
  raids.save(guild.id, { until: 0, previousLevel: null });
  if (state.previousLevel !== null) await guild.setVerificationLevel(state.previousLevel, t('guard.anti_raid_lockdown_ended')).catch(() => {});
  await unlockServer(guild, (entry) => entry.source === 'antiraid'); // channels locked by /lockdown stay locked
  await raidAlert(guild, { ...getFeature(guild.id, 'antiRaid'), alertRole: '' }, t('guard.anti_raid_lockdown_over_verification'));
  return true;
}

const raidStatus = (guildId) => raids.get(guildId).until;

function startAntiRaid(client) {
  every('anti-raid-end', 30000, async () => {
    for (const guild of client.guilds.cache.values()) {
      const { until } = raids.peek(guild.id);
      if (until && until <= Date.now()) await endRaid(guild).catch((e) => console.error('Anti-raid:', e.message));
    }
  });
}

// =====================================================================
// Invite tracking
// data/invites.json = { <guildId>: { stats: { <inviterId>: { joins, leaves } }, joins: { <memberId>: inviterId } } }
// =====================================================================

const invites = createStore('invites', { stats: {}, joins: {} });
const cache = new Map(); // guildId → Map(code → { uses, inviterId, maxUses })

async function cacheInvites(guild) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) return null;
  const list = await guild.invites.fetch({ cache: false }).catch(() => null);
  if (!list) return null;
  const map = new Map(list.map((i) => [i.code, { uses: i.uses ?? 0, inviterId: i.inviterId, maxUses: i.maxUses }]));
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity) map.set('vanity', { uses: vanity.uses, inviterId: null, maxUses: 0 });
  }
  cache.set(guild.id, map);
  return map;
}

async function startInvites(client) {
  for (const guild of client.guilds.cache.values()) if (getFeature(guild.id, 'invites').enabled) await cacheInvites(guild);
}

function handleInviteCreate(invite) {
  cache.get(invite.guild?.id)?.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviterId, maxUses: invite.maxUses });
}

const inviteCount = (guildId, userId) => {
  const s = invites.get(guildId).stats[userId] ?? { joins: 0, leaves: 0 };
  return { ...s, total: s.joins - s.leaves };
};

async function trackJoin(member) {
  const { guild } = member;
  const config = getFeature(guild.id, 'invites');
  if (!config.enabled) return;
  const before = cache.get(guild.id) ?? new Map();
  const after = await cacheInvites(guild);
  if (!after) return;

  // Invite whose counter went up, otherwise a limited-use invite that just disappeared
  let used = [...after].find(([code, i]) => i.uses > (before.get(code)?.uses ?? 0));
  if (!used) {
    const gone = [...before].filter(([code, i]) => !after.has(code) && i.maxUses && i.uses + 1 >= i.maxUses);
    if (gone.length === 1) used = gone[0];
  }
  const [code, invite] = used ?? [null, null];
  const inviterId = invite?.inviterId ?? null;

  const data = invites.get(guild.id);
  if (inviterId) {
    data.stats[inviterId] ??= { joins: 0, leaves: 0 };
    data.stats[inviterId].joins++;
    data.joins[member.id] = inviterId;
    invites.save(guild.id, data);
  }

  const channel = guild.channels.cache.get(config.channelId);
  if (!channel || !config.message) return;
  // The dashboard message is sent as is (keep): words added by the bot are translated here
  const tr = translatorFor(guild);
  const inviter = inviterId ? (await guild.client.users.fetch(inviterId).catch(() => null))?.username ?? tr(t('guard.unknown')) : tr(code === 'vanity' ? t('guard.vanity_link') : t('guard.unknown'));
  const content = keep(fillVars(config.message, {
    user: `${member}`, name: member.displayName, server: guild.name, inviter, invites: inviterId ? inviteCount(guild.id, inviterId).total : 0,
  }), 2000);
  await channel.send({ content, allowedMentions: { users: [member.id] } }).catch(() => {});
}

function trackLeave(member) {
  const data = invites.get(member.guild.id);
  const inviterId = data.joins[member.id];
  if (!inviterId) return;
  data.stats[inviterId] ??= { joins: 0, leaves: 0 };
  data.stats[inviterId].leaves++;
  delete data.joins[member.id];
  invites.save(member.guild.id, data);
}

const inviteTop = (guildId, limit = 10) =>
  Object.entries(invites.get(guildId).stats)
    .map(([userId, s]) => ({ userId, ...s, total: s.joins - s.leaves }))
    .filter((s) => s.joins > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

module.exports = { guardJoin, endRaid, raidStatus, startAntiRaid, startQuarantine, handleQuarantineButton, quarantineCount, cacheInvites, startInvites, handleInviteCreate, trackJoin, trackLeave, inviteCount, inviteTop };

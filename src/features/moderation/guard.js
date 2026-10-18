const { GuildVerificationLevel, PermissionFlagsBits } = require('discord.js');
const { createStore } = require('../../core/store');
const { getFeature, fillVars } = require('../../core/feature-config');
const { keep } = require('../../dashboard/public/i18n');
const { translatorFor } = require('../../core/language');

// Security and arrivals: anti-raid (automatic lockdown, accounts too new) and invite tracking.

// =====================================================================
// Anti-raid
// data/anti-raid.json = { <guildId>: { until (end of lockdown), previousLevel (verification level to restore) } }
// =====================================================================

const raids = createStore('anti-raid', { until: 0, previousLevel: null });
const recentJoins = new Map(); // guildId → [{ member, at }]

async function raidAlert(guild, config, text) {
  const channel = guild.channels.cache.get(config.alertChannel);
  const ping = config.alertRole ? `<@&${config.alertRole}> ` : '';
  await channel?.send({ content: `${ping}${text}`, allowedMentions: { roles: config.alertRole ? [config.alertRole] : [] } }).catch(() => {});
}

const kick = (member, reason) => member.kickable && member.kick(reason).catch(() => {});

// Returns true if the member was kicked (no welcome message in that case)
async function guardJoin(member) {
  const { guild } = member;
  const config = getFeature(guild.id, 'antiRaid');
  if (!config.enabled || member.user.bot) return false;

  // Account too new
  if (config.minAge && Date.now() - member.user.createdTimestamp < config.minAge * 86400000) {
    await member.send(`🚫 Ton compte Discord est trop récent pour rejoindre **${guild.name}** (au moins ${config.minAge} jour${config.minAge > 1 ? 's' : ''}). Réessaie plus tard !`).catch(() => {});
    await kick(member, `Anti-raid : compte créé il y a moins de ${config.minAge} jours`);
    return true;
  }

  // Raid in progress: newcomers are kicked if requested
  if (raids.peek(guild.id).until > Date.now()) {
    if (config.action !== 'kick') return false;
    await kick(member, 'Anti-raid : serveur verrouillé');
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
    `🚨 **Raid détecté** : ${list.length} arrivées en moins de ${config.seconds} secondes.\n` +
      (locked ? `🔒 Serveur verrouillé (vérification maximale) pendant ${config.lockMinutes} minutes.` : '⚠️ Impossible de verrouiller : il me faut la permission « Gérer le serveur ».') +
      (config.action === 'kick' ? '\n👢 Les comptes du raid sont expulsés.' : ''),
  );
  if (config.action === 'kick') for (const j of list) await kick(j.member, 'Anti-raid');
  return config.action === 'kick';
}

async function endRaid(guild) {
  const state = raids.get(guild.id);
  if (!state.until) return false;
  raids.save(guild.id, { until: 0, previousLevel: null });
  if (state.previousLevel !== null) await guild.setVerificationLevel(state.previousLevel, 'Anti-raid : fin du verrouillage').catch(() => {});
  await raidAlert(guild, { ...getFeature(guild.id, 'antiRaid'), alertRole: '' }, '🔓 Fin du verrouillage anti-raid : le niveau de vérification est revenu à la normale.');
  return true;
}

const raidStatus = (guildId) => raids.get(guildId).until;

function startAntiRaid(client) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const { until } = raids.peek(guild.id);
      if (until && until <= Date.now()) await endRaid(guild).catch((e) => console.error('Anti-raid:', e.message));
    }
  }, 30000);
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
  const t = translatorFor(guild);
  const inviter = inviterId ? (await guild.client.users.fetch(inviterId).catch(() => null))?.username ?? t('inconnu') : t(code === 'vanity' ? 'le lien personnalisé' : 'inconnu');
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

module.exports = { guardJoin, endRaid, raidStatus, startAntiRaid, cacheInvites, startInvites, handleInviteCreate, trackJoin, trackLeave, inviteCount, inviteTop };

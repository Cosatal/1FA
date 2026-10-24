const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { readJson, writeJson, DATA_DIR } = require('../core/store');
const { getFeature, fillVars } = require('../core/feature-config');
const { fetchImage } = require('./welcome/welcome-card');
const { keep } = require('../dashboard/public/i18n');
const { every } = require('../core/scheduler');
const { t } = require('../core/i18n');

// Levels: XP earned by chatting (once per cooldown) and in voice, roles given at milestones, /rank card.
// data/xp.json = { <guildId>: { <userId>: xp } }. Written at most every 15 s (one message = one change).

const FILE = path.join(DATA_DIR, 'xp.json');
let data = null;
let dirty = false;
const all = () => (data ??= readJson(FILE, {}));
const guildXp = (guildId) => (all()[guildId] ??= {});

function flush() {
  if (!dirty) return;
  dirty = false;
  writeJson(FILE, data, false);
}
every('xp-save', 15000, () => {
  flush();
  // Forget expired cooldowns (otherwise one entry per person who ever chatted stays in memory)
  for (const [key, at] of lastGain) if (Date.now() - at > 3600000) lastGain.delete(key);
});
process.on('exit', flush);

// Same curve as MEE6: XP to go from level n to level n+1
const xpFor = (level) => 5 * level ** 2 + 50 * level + 100;
function levelInfo(xp) {
  let level = 0;
  let rest = xp;
  while (rest >= xpFor(level)) rest -= xpFor(level++);
  return { level, current: rest, needed: xpFor(level), xp };
}
// Total XP to reach a level
const totalFor = (level) => Array.from({ length: level }, (_, i) => xpFor(i)).reduce((a, b) => a + b, 0);

const ranking = (guildId) =>
  Object.entries(guildXp(guildId))
    .filter(([, xp]) => xp > 0)
    .sort((a, b) => b[1] - a[1]);

function stats(guildId, userId) {
  const list = ranking(guildId);
  const index = list.findIndex(([id]) => id === userId);
  return { ...levelInfo(guildXp(guildId)[userId] ?? 0), rank: index < 0 ? null : index + 1 };
}

// Roles of the milestones reached (only the highest if rewards don't stack)
async function syncRewards(member, level, config) {
  const reached = config.rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
  const keep = new Set((config.stackRewards ? reached : reached.slice(-1)).map((r) => r.roleId));
  const editable = (id) => member.guild.roles.cache.get(id)?.editable;
  const add = [...keep].filter((id) => !member.roles.cache.has(id) && editable(id));
  const remove = config.rewards.map((r) => r.roleId).filter((id) => !keep.has(id) && member.roles.cache.has(id) && editable(id));
  if (add.length) await member.roles.add(add, `Niveau ${level}`).catch(() => {});
  if (remove.length) await member.roles.remove(remove, `Niveau ${level}`).catch(() => {});
}

async function announce(member, level, config, channel) {
  if (config.announce === 'off' || !config.message) return;
  // Message written in the dashboard: sent as is, never translated
  const content = keep(fillVars(config.message, { user: `${member}`, name: member.displayName, level, server: member.guild.name }), 2000);
  const payload = { content, allowedMentions: { users: [member.id] } };
  if (config.announce === 'dm') return member.send(payload).catch(() => {});
  const target = config.announce === 'custom' ? member.guild.channels.cache.get(config.announceChannel) : channel;
  await target?.send(payload).catch(() => {});
}

// Adds (or removes) XP. channel: where to announce a level-up in "message channel" mode
async function addXp(member, amount, channel = null, config = getFeature(member.guild.id, 'levels')) {
  const users = guildXp(member.guild.id);
  const before = levelInfo(users[member.id] ?? 0).level;
  users[member.id] = Math.max(0, (users[member.id] ?? 0) + amount);
  dirty = true;
  const after = levelInfo(users[member.id]).level;
  if (after === before) return;
  await syncRewards(member, after, config);
  if (after > before) await announce(member, after, config, channel);
}

const setXp = (member, xp) => addXp(member, xp - (guildXp(member.guild.id)[member.id] ?? 0));

function resetUser(guildId, userId) {
  delete guildXp(guildId)[userId];
  dirty = true;
}
function resetGuild(guildId) {
  all()[guildId] = {};
  dirty = true;
}

const excluded = (member, channel, config) =>
  member.roles.cache.some((r) => config.noXpRoles.includes(r.id)) ||
  config.noXpChannels.includes(channel.id) ||
  (channel.parentId && config.noXpChannels.includes(channel.parentId));

// One XP gain per cooldown and per member
const lastGain = new Map(); // guildId:userId → date
async function handleLevelMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return;
  const config = getFeature(message.guild.id, 'levels');
  if (!config.enabled || excluded(message.member, message.channel, config)) return;
  const key = `${message.guild.id}:${message.author.id}`;
  if (Date.now() - (lastGain.get(key) ?? 0) < config.cooldown * 1000) return;
  lastGain.set(key, Date.now());
  const [min, max] = [Math.min(config.xpMin, config.xpMax), Math.max(config.xpMin, config.xpMax)];
  await addXp(message.member, min + Math.floor(Math.random() * (max - min + 1)), message.channel, config);
}

// Voice XP, every minute: at least 2 humans in the channel, and not deafened
function startVoiceXp(client) {
  every('voice-xp', 60000, async () => {
    for (const guild of client.guilds.cache.values()) {
      // Nobody in voice: nothing to do (avoids reading every server's config every minute)
      if (!guild.voiceStates.cache.size) continue;
      const config = getFeature(guild.id, 'levels');
      if (!config.enabled || !config.voiceXp) continue;
      for (const channel of guild.channels.cache.filter((c) => c.isVoiceBased()).values()) {
        const humans = channel.members.filter((m) => !m.user.bot);
        if (humans.size < 2 || channel.id === guild.afkChannelId) continue;
        for (const member of humans.values()) {
          if (member.voice.selfDeaf || member.voice.serverDeaf || excluded(member, channel, config)) continue;
          await addXp(member, config.voiceXp, channel, config).catch(() => {});
        }
      }
    }
  });
}

// Leaderboard with names and avatars (those who left the server stay, with their last known name)
async function leaderboard(guild, limit = 10, offset = 0) {
  const page = ranking(guild.id).slice(offset, offset + limit);
  const missing = page.map(([id]) => id).filter((id) => !guild.members.cache.has(id));
  if (missing.length) await guild.members.fetch({ user: missing }).catch(() => null);
  return page.map(([id, xp], i) => {
    const member = guild.members.cache.get(id);
    const user = member?.user ?? guild.client.users.cache.get(id);
    return {
      id,
      rank: offset + i + 1,
      name: member?.displayName ?? user?.username ?? t('levels.former_member'),
      avatar: (member ?? user)?.displayAvatarURL({ size: 64 }) ?? 'https://cdn.discordapp.com/embed/avatars/0.png',
      ...levelInfo(xp),
    };
  });
}

const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

// /rank card: avatar, name, rank, level and progress bar
// tr: translator of the server language (the card is an image: its texts don't go through the messages' translator)
async function rankCard({ name, avatarUrl, rank, level, current, needed, color = '#2f7ff0', tr = (text) => text }) {
  const W = 934;
  const H = 282;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#16171c';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 28);
  ctx.fill();
  ctx.fillStyle = '#1f2027';
  ctx.beginPath();
  ctx.roundRect(20, 20, W - 40, H - 40, 22);
  ctx.fill();

  // Round avatar with a ring in the theme color
  const avatar = await fetchImage(avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(141, 141, 82, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(141, 141, 74, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, 67, 67, 148, 148);
  else {
    ctx.fillStyle = '#4e5058';
    ctx.fillRect(67, 67, 148, 148);
  }
  ctx.restore();

  // Rank and level, right-aligned
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  let x = W - 60;
  const part = (label, value, valueColor) => {
    ctx.font = 'bold 56px sans-serif';
    ctx.fillStyle = valueColor;
    ctx.fillText(value, x, 100);
    x -= ctx.measureText(value).width + 10;
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#b5bac1';
    ctx.fillText(label, x, 100);
    x -= ctx.measureText(label).width + 30;
  };
  part(tr('NIVEAU'), `${level}`, color);
  part(tr('RANG'), rank ? `#${rank}` : '-', '#ffffff');

  // Name (shortened if too long) and XP
  ctx.textAlign = 'left';
  ctx.font = 'bold 38px sans-serif';
  ctx.fillStyle = '#ffffff';
  let shown = name;
  while (ctx.measureText(shown).width > 430 && shown.length > 3) shown = shown.slice(0, -2);
  ctx.fillText(shown === name ? name : `${shown}…`, 260, 175);
  ctx.textAlign = 'right';
  ctx.font = '26px sans-serif';
  ctx.fillStyle = '#b5bac1';
  ctx.fillText(`${short(current)} / ${short(needed)} XP`, W - 60, 175);

  // Progress bar
  ctx.fillStyle = '#2b2d36';
  ctx.beginPath();
  ctx.roundRect(260, 195, W - 320, 36, 18);
  ctx.fill();
  const width = Math.max(36, (W - 320) * Math.min(1, current / needed));
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(260, 195, width, 36, 18);
  ctx.fill();

  return canvas.encode('png');
}

module.exports = { handleLevelMessage, startVoiceXp, addXp, setXp, resetUser, resetGuild, stats, leaderboard, rankCard, levelInfo, totalFor, syncRewards, ranking };

const path = require('node:path');
const { readJson, writeJson, DATA_DIR } = require('../core/store');

// Server statistics for the dashboard: joins, leaves, messages per day, peak hours, most active members.
// data/stats.json = { <guildId>: { <day YYYY-MM-DD>: { joins, leaves, messages, hours: [24], users: { <userId>: messages } } } }
// Days in Paris time. 90 days kept; per-member details only 30 days. Written at most once per minute.

const FILE = path.join(DATA_DIR, 'stats.json');
const KEEP_DAYS = 90;
const KEEP_USERS = 30;
let data = null;
let dirty = false;
const all = () => (data ??= readJson(FILE, {}));

// Formatter created only once (creating one on every message would be costly)
const PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const parisParts = (date = new Date()) => {
  const p = Object.fromEntries(PARIS.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};
// Current day and hour, recomputed at most every 10 seconds (called on every message)
let now = { at: 0 };
const current = () => (Date.now() - now.at > 10000 ? (now = { ...parisParts(), at: Date.now() }) : now);

function today(guildId) {
  const { day, hour } = current();
  const guild = (all()[guildId] ??= {});
  const entry = (guild[day] ??= { joins: 0, leaves: 0, messages: 0, hours: Array(24).fill(0), users: {} });
  dirty = true;
  return { entry, hour };
}

function countMessage(message) {
  if (!message.guild || message.author.bot) return;
  const { entry, hour } = today(message.guild.id);
  entry.messages++;
  entry.hours[hour]++;
  entry.users[message.author.id] = (entry.users[message.author.id] ?? 0) + 1;
}
const countJoin = (member) => void today(member.guild.id).entry.joins++;
const countLeave = (member) => void today(member.guild.id).entry.leaves++;

// Cleanup (days too old) then write
function flush() {
  if (!dirty) return;
  dirty = false;
  const limit = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  for (const guild of Object.values(all())) {
    for (const [day, entry] of Object.entries(guild)) {
      if (day < limit(KEEP_DAYS)) delete guild[day];
      else if (day < limit(KEEP_USERS)) delete entry.users;
    }
  }
  writeJson(FILE, data, false);
}
setInterval(flush, 60000).unref();
process.on('exit', flush);

// The last "days" days (today included), from oldest to newest, empty days included
function guildStats(guildId, days = 30) {
  const guild = all()[guildId] ?? {};
  const list = [];
  const hours = Array(24).fill(0);
  const users = {};
  for (let i = days - 1; i >= 0; i--) {
    const { day } = parisParts(new Date(Date.now() - i * 86400000));
    const entry = guild[day];
    list.push({ day, joins: entry?.joins ?? 0, leaves: entry?.leaves ?? 0, messages: entry?.messages ?? 0 });
    entry?.hours.forEach((n, h) => (hours[h] += n));
    for (const [id, n] of Object.entries(entry?.users ?? {})) users[id] = (users[id] ?? 0) + n;
  }
  const top = Object.entries(users)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, messages]) => ({ userId, messages }));
  return { days: list, hours, top };
}

module.exports = { countMessage, countJoin, countLeave, guildStats };

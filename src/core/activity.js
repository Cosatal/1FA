// Activity log of each server, shown in the dashboard's "Logs" tab: what was changed on the dashboard, the bot's commands
// used on Discord, what the bot did on its own (anti-raid, end of a temp ban…) and the tickets.
// data/activity/<guildId>.json = [{ id, at, source, action, title, author: { id, name } | null, details }], oldest first.
// 3000 entries and 90 days kept per server. Written shortly after each new entry.
const path = require('node:path');
const { readJson, writeJson, scheduleWrite, DATA_DIR } = require('./store');

const SOURCES = ['dashboard', 'discord', 'bot', 'tickets'];
const MAX = 3000;
const KEEP = 90 * 86400000;
const PAGE = 50;
const DIR = path.join(DATA_DIR, 'activity');

const fileOf = (guildId) => path.join(DIR, `${guildId}.json`);
const logs = new Map(); // guildId → entries (read once from disk)
function load(guildId) {
  if (!logs.has(guildId)) logs.set(guildId, readJson(fileOf(guildId), []));
  return logs.get(guildId);
}

// Secrets never go into the log: keys, passwords, tokens…
const SECRET = /key|password|secret|token/i;
function detailsOf(data) {
  if (data == null) return null;
  const json = JSON.stringify(data, (name, value) => (name && SECRET.test(name) && value ? '••••••••' : value));
  return json.length > 4000 ? `${json.slice(0, 4000)}…` : json;
}

// Who did it, from a Discord user / member, or the dashboard session ({ id, username })
const authorOf = (who) => (who ? { id: who.id, name: who.displayName ?? who.globalName ?? who.username ?? who.id } : null);

// source: dashboard | discord | bot | tickets · action: short code (e.g. "tickets.updated") · title: the readable sentence
function logActivity(guildId, { source, action, title, author = null, data = null }) {
  if (!guildId || !SOURCES.includes(source)) return;
  const list = load(guildId);
  list.push({
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
    source,
    action,
    title: String(title).slice(0, 300),
    author: authorOf(author),
    details: detailsOf(data),
  });
  const limit = Date.now() - KEEP;
  const drop = Math.max(list.length - MAX, list.findIndex((e) => e.at >= limit));
  if (drop > 0) list.splice(0, drop);
  scheduleWrite(fileOf(guildId), () => writeJson(fileOf(guildId), list, false));
}

// Entries matching the filters, newest first, 50 per page. Also returns every action code (for the filter menu)
function queryActivity(guildId, { source = '', author = '', action = '', from = 0, to = 0, page = 1 } = {}) {
  const list = load(guildId);
  const who = author.trim().toLowerCase();
  const found = list.filter(
    (e) =>
      (!source || e.source === source) &&
      (!action || e.action === action) &&
      (!from || e.at >= from) &&
      (!to || e.at <= to) &&
      (!who || e.author?.id === who || e.author?.name.toLowerCase().includes(who)),
  );
  const pages = Math.max(1, Math.ceil(found.length / PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const start = found.length - current * PAGE;
  return {
    entries: found.slice(Math.max(0, start), start + PAGE).reverse(),
    total: found.length,
    page: current,
    pages,
    actions: [...new Set(list.filter((e) => !source || e.source === source).map((e) => e.action))].sort(),
  };
}

module.exports = { logActivity, queryActivity, SOURCES };

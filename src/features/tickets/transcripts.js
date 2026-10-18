const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, readJson, writeJson } = require('../../core/store');

// Tickets and their whole conversation, managed in the staff panel (/staff).
//   data/transcripts/<guildId>/index.json       : summary of each ticket (for the list and search)
//   data/transcripts/<guildId>/<ticketId>.json  : the full ticket with all its messages
//   data/transcripts/<guildId>/<ticketId>/      : attached files (copied: Discord links expire)

const DIR = path.join(DATA_DIR, 'transcripts');
const MAX_FILE = 10 * 1024 * 1024;

const guildDir = (guildId) => path.join(DIR, guildId);
const ticketFile = (guildId, ticketId) => path.join(guildDir(guildId), `${ticketId}.json`);
const filesDir = (guildId, ticketId) => path.join(guildDir(guildId), ticketId);
const isId = (value) => /^\d{17,20}$/.test(value);

// In-memory index per server (read once from disk)
const indexes = new Map();
function index(guildId) {
  if (!indexes.has(guildId)) indexes.set(guildId, readJson(path.join(guildDir(guildId), 'index.json'), []));
  return indexes.get(guildId);
}

// Recently read tickets are kept in memory (the staff panel rereads them every 5 seconds); a copy is returned.
// 300 at most: the oldest are forgotten (reread from disk if needed), so memory doesn't grow forever
const MAX_CACHED = 300;
const tickets = new Map(); // <guildId>/<ticketId> → ticket, from least to most recent
function remember(key, ticket) {
  tickets.delete(key);
  tickets.set(key, ticket);
  if (tickets.size > MAX_CACHED) tickets.delete(tickets.keys().next().value);
}
function get(guildId, ticketId) {
  if (!isId(guildId) || !isId(ticketId)) return null;
  const key = `${guildId}/${ticketId}`;
  remember(key, tickets.has(key) ? tickets.get(key) : readJson(ticketFile(guildId, ticketId), null));
  return structuredClone(tickets.get(key));
}

function summarize(ticket) {
  const first = ticket.messages.find((m) => m.from === 'member' && m.content);
  const last = ticket.messages.at(-1);
  return {
    id: ticket.id,
    user: ticket.user,
    type: ticket.type,
    openedAt: ticket.openedAt,
    closedAt: ticket.closedAt,
    closedBy: ticket.closedBy,
    count: ticket.messages.length,
    preview: first?.content.slice(0, 120) ?? '',
    lastAt: last?.at ?? ticket.openedAt,
    lastFrom: last?.from ?? null, // 'member' = waiting for a staff reply
    ...(ticket.channelId && { channelId: ticket.channelId }), // regular ticket: its channel on the server
  };
}

function save(ticket) {
  remember(`${ticket.guildId}/${ticket.id}`, structuredClone(ticket));
  writeJson(ticketFile(ticket.guildId, ticket.id), ticket, false);
  const list = index(ticket.guildId);
  const i = list.findIndex((t) => t.id === ticket.id);
  if (i === -1) list.push(summarize(ticket));
  else list[i] = summarize(ticket);
  writeJson(path.join(guildDir(ticket.guildId), 'index.json'), list, false);
}

// Copies attachments into the ticket's folder. Each item: a Discord attachment (url)
// or a file sent from the panel ({ name, buffer, contentType }). Too big or not found: only the link is kept
async function storeFiles(guildId, ticketId, attachments) {
  const files = [];
  for (const a of attachments) {
    const image = Boolean(a.contentType?.startsWith('image/'));
    try {
      let buffer = a.buffer;
      if (!buffer) {
        if (a.size > MAX_FILE) throw new Error('trop lourd');
        const res = await fetch(a.url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buffer = Buffer.from(await res.arrayBuffer());
      }
      const name = `${Date.now().toString(36)}-${a.name.replace(/[^\w.-]/g, '_').slice(-80)}`;
      fs.mkdirSync(filesDir(guildId, ticketId), { recursive: true });
      fs.writeFileSync(path.join(filesDir(guildId, ticketId), name), buffer);
      files.push({ name: a.name, file: name, image });
    } catch {
      files.push({ name: a.name, url: a.url ?? null, image });
    }
  }
  return files;
}

// A message: { from: 'member' | 'staff' | 'ai', author, content, attachments, at, mid (Discord message id, avoids duplicates) }
async function toRecord(guildId, ticketId, m) {
  const files = await storeFiles(guildId, ticketId, [...(m.attachments ?? []).values()]);
  return { from: m.from, author: m.author ?? null, content: m.content ?? '', files, at: m.at ?? Date.now(), ...(m.mid && { mid: m.mid }) };
}

// ---------- Writing ----------

// Saved right away (without waiting) so the following messages can be added to it
// channelId: regular ticket (private channel on the server); missing: DM ticket
function createTicket({ guildId, id, user, type, channelId = null }) {
  save({ id, guildId, user, type, ...(channelId && { channelId }), openedAt: Date.now(), closedAt: null, closedBy: null, notify: null, messages: [] });
}

// What the member wrote before opening, added at the start of the conversation
async function addRecap(guildId, ticketId, messages) {
  const records = [];
  for (const m of messages) records.push(await toRecord(guildId, ticketId, m));
  // Reread after the download: messages may have arrived in the meantime (and already be in the recap)
  const ticket = get(guildId, ticketId);
  if (!ticket) return;
  const known = new Set(ticket.messages.map((m) => m.mid).filter(Boolean));
  ticket.messages.unshift(...records.filter((r) => !r.mid || !known.has(r.mid)));
  save(ticket);
}

async function addMessage(guildId, ticketId, message) {
  const record = await toRecord(guildId, ticketId, message);
  const ticket = get(guildId, ticketId);
  if (!ticket) return false;
  ticket.messages.push(record);
  save(ticket);
  return true;
}

function updateTicket(guildId, ticketId, patch) {
  const ticket = get(guildId, ticketId);
  if (!ticket) return null;
  Object.assign(ticket, patch);
  save(ticket);
  return ticket;
}

// ---------- Reading ----------

// Most active first. query: name, id, mention, type or word of the first message; status: 'open' | 'closed' | 'waiting'
function listTickets(guildId, { query = '', userId = '', status = '' } = {}) {
  const q = query.trim().toLowerCase().replace(/^<@!?(\d+)>$/, '$1');
  const keep = {
    open: (t) => !t.closedAt,
    closed: (t) => Boolean(t.closedAt),
    waiting: (t) => !t.closedAt && t.lastFrom !== 'staff',
  }[status];
  return index(guildId)
    .filter((t) => !userId || t.user.id === userId)
    .filter((t) => !keep || keep(t))
    .filter((t) => !q || t.user.id === q || t.user.tag.toLowerCase().includes(q) || t.type.toLowerCase().includes(q) || t.preview.toLowerCase().includes(q))
    .sort((a, b) => (b.lastAt ?? b.openedAt) - (a.lastAt ?? a.openedAt));
}

// One row per member (all their tickets grouped), most active first.
// status: 'waiting' (open ticket with no staff reply) | 'open' (open ticket) | 'closed' (no open ticket)
function listConversations(guildId, { query = '', status = '' } = {}) {
  const byUser = new Map();
  for (const t of index(guildId)) {
    const c = byUser.get(t.user.id) ?? { user: t.user, tickets: 0, openedAt: 0, lastAt: 0, open: null, preview: '', type: '', search: t.user.id };
    c.tickets += 1;
    // The most recent ticket gives the name, avatar and preview
    if (t.openedAt >= c.openedAt) Object.assign(c, { user: t.user, openedAt: t.openedAt, preview: t.preview, type: t.type });
    c.lastAt = Math.max(c.lastAt, t.lastAt ?? t.openedAt);
    if (!t.closedAt) c.open = { id: t.id, lastFrom: t.lastFrom };
    c.search += ` ${t.user.tag} ${t.type} ${t.preview}`.toLowerCase();
    byUser.set(t.user.id, c);
  }

  const q = query.trim().toLowerCase().replace(/^<@!?(\d+)>$/, '$1');
  const keep = {
    waiting: (c) => c.open && c.open.lastFrom !== 'staff',
    open: (c) => Boolean(c.open),
    closed: (c) => !c.open,
  }[status];
  return [...byUser.values()]
    .filter((c) => !keep || keep(c))
    .filter((c) => !q || c.search.includes(q))
    .sort((a, b) => b.lastAt - a.lastAt)
    .map(({ search, ...c }) => c);
}

// All of a member's tickets, from oldest to newest
const userTickets = (guildId, userId) =>
  index(guildId)
    .filter((t) => t.user.id === userId)
    .map((t) => get(guildId, t.id))
    .filter(Boolean)
    .sort((a, b) => a.openedAt - b.openedAt);

function filePath(guildId, ticketId, name) {
  if (!isId(guildId) || !isId(ticketId) || !/^[\w.-]+$/.test(name)) return null;
  const file = path.join(filesDir(guildId, ticketId), name);
  return fs.existsSync(file) ? file : null;
}

module.exports = { createTicket, addRecap, addMessage, updateTicket, getTicket: get, listTickets, listConversations, userTickets, filePath };

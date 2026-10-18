const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const { createStore, readJson, writeJson, DATA_DIR } = require('../../core/store');
const { getFeature, saveFeature } = require('../../core/feature-config');
const { queryServer, resolveHost } = require('./game-query');
const { rconCommand } = require('./rcon');
const { ownsGuild } = require('../ai/ai-support');
const { translatorFor } = require('../../core/language');

// Game servers: a status message updated automatically (online or not, players, map, ping, mods),
// an alert when a server goes down or comes back, and RCON restarts with an in-game countdown
// (at fixed times or with the dashboard button). Settings: feature-config.js (gameServers).
// data/game-servers.json = { <guildId>: { messages: { <server id>: status message id } } }

const store = createStore('game-servers', { messages: {} });

// RCON commands per game (editable in the dashboard). {message} = announcement text, {player} = in-game name
const PRESETS = {
  zomboid: { announce: 'servermsg "{message}"', restart: 'quit', whitelistAdd: 'addusertowhitelist "{player}"', whitelistRemove: 'removeuserfromwhitelist "{player}"' },
  minecraft: { announce: 'say {message}', restart: 'stop', whitelistAdd: 'whitelist add {player}', whitelistRemove: 'whitelist remove {player}' },
  ark: { announce: 'ServerChat {message}', restart: 'DoExit' },
  palworld: { announce: 'Broadcast {message}', restart: 'Shutdown 1' },
  rust: { announce: 'say {message}', restart: 'quit' },
  cs2: { announce: 'say {message}', restart: 'quit' },
  gmod: { announce: 'say {message}', restart: 'quit' },
};
Object.setPrototypeOf(PRESETS, null);
const commandOf = (server, action) => server[`${action}Cmd`]?.trim() || PRESETS[server.game]?.[action] || '';
// Quotes and line breaks would break the command
const fillCommand = (template, message, player = '') =>
  template.replaceAll('{message}', String(message).replace(/["\r\n]/g, ' ').trim()).replaceAll('{player}', String(player).replace(/["\r\n]/g, '').trim());

// ---------- Player history (dashboard chart) ----------
// data/game-history.json = { <guildId>:<serverId>: [[10-min slot, players (null = offline)]] } · 7 days kept

const HISTORY_FILE = path.join(DATA_DIR, 'game-history.json');
const SLOT = 10 * 60000;
let history = null;
let historyDirty = false;
const allHistory = () => (history ??= readJson(HISTORY_FILE, {}));
function record(key, players) {
  const slot = Math.floor(Date.now() / SLOT);
  const points = (allHistory()[key] ??= []);
  const last = points.at(-1);
  // One value per 10-minute slot: keep the maximum number of players seen in the slot
  if (last?.[0] === slot) last[1] = players === null ? last[1] : Math.max(last[1] ?? 0, players);
  else points.push([slot, players]);
  while (points.length && points[0][0] < slot - 7 * 24 * 6) points.shift();
  historyDirty = true;
}
function flushHistory() {
  if (!historyDirty) return;
  historyDirty = false;
  writeJson(HISTORY_FILE, history, false);
}
setInterval(flushHistory, 60000).unref();
process.on('exit', flushHistory);
// A server's points: [[date in ms, players or null]]
const playerHistory = (guild, server) => (allHistory()[`${guild.id}:${server.id}`] ?? []).map(([slot, players]) => [slot * SLOT, players]);

// On the bot owner's Discord servers, a local address is allowed (game server on the same machine)
const allowPrivate = (guild) => ownsGuild(guild);

// ---------- Status ----------

const states = new Map(); // guildId:serverId → { online, info, fails, error, at }
const stateOf = (guild, server) => states.get(`${guild.id}:${server.id}`) ?? { online: null, info: null, fails: 0 };

async function check(guild, server) {
  const key = `${guild.id}:${server.id}`;
  const previous = states.get(key) ?? { online: null, info: null, fails: 0 };
  let next;
  try {
    const info = await queryServer(server, { allowPrivate: allowPrivate(guild), withPlayers: server.showPlayers });
    next = { online: true, info, fails: 0, error: null, at: Date.now() };
  } catch (error) {
    // Offline only after 2 failures in a row (a lost packet isn't an outage)
    const fails = previous.fails + 1;
    next = { ...previous, online: fails >= 2 ? false : previous.online, fails, error: error.message, at: Date.now() };
  }
  states.set(key, next);
  if (next.online !== null) record(key, next.online ? next.info.players : null);

  // No "offline" alert during a planned restart (15 minutes at most)
  if (previous.online === true && next.online === false && !(next.restarting > Date.now())) await alert(guild, server, `🔴 **${server.name}** est hors ligne.`, true);
  else if (previous.online === false && next.online === true) {
    await alert(guild, server, `🟢 **${server.name}** est de nouveau en ligne.`);
    next.restarting = 0;
  }
  return next;
}

const modsOf = (server) => server.mods.split('\n').map((m) => m.trim()).filter(Boolean);

function statusEmbed(server, state) {
  const { info } = state;
  const online = state.online !== false && info;
  const embed = new EmbedBuilder()
    .setColor(online ? 0x3ba55c : state.online === false ? 0xed4245 : 0x4e5058)
    .setTitle(`🎮 ${server.name}`)
    .setTimestamp(state.at ?? Date.now())
    .setFooter({ text: 'Mis à jour' });
  // Mod list (and planned restart), shown whether the server is online or not
  const extras = () => {
    const mods = modsOf(server);
    if (mods.length) embed.addFields({ name: `🧩 Mods (${mods.length})`, value: mods.map((m) => `• ${m}`).join('\n').slice(0, 1024) });
    const planned = restarts.get(server.key);
    if (planned) embed.addFields({ name: '🔄 Redémarrage prévu', value: `<t:${Math.floor(planned.at / 1000)}:R>` });
    return embed;
  };
  if (!online) {
    embed
      .setDescription(state.online === false ? '🔴 **Hors ligne**' : '⏳ En attente de la première vérification…')
      .addFields({ name: 'Adresse', value: `\`${server.host}:${server.port}\``, inline: true });
    return extras();
  }
  embed.setDescription(`🟢 **En ligne**${info.name ? `\n${info.name.slice(0, 200)}` : ''}`).addFields(
    { name: 'Joueurs', value: `${info.players}/${info.maxPlayers}`, inline: true },
    ...(info.map ? [{ name: 'Map', value: info.map.slice(0, 100), inline: true }] : []),
    { name: 'Ping', value: `${info.ping} ms`, inline: true },
    { name: 'Adresse', value: `\`${server.host}:${server.port}\``, inline: true },
  );
  if (server.showPlayers && info.playerNames.length) {
    const names = info.playerNames.slice(0, 40).map((n) => n.replace(/[`*_~|]/g, '')).join(', ');
    embed.addFields({ name: 'Connectés', value: `${names}${info.playerNames.length > 40 ? '…' : ''}`.slice(0, 1024) });
  }
  return extras();
}

// The status message: edited if it still exists, otherwise posted again
async function updateStatusMessage(guild, server, state) {
  const channel = server.statusChannel ? guild.channels.cache.get(server.statusChannel) : null;
  if (!channel?.isTextBased()) return;
  const data = store.get(guild.id);
  const payload = { embeds: [statusEmbed({ ...server, key: `${guild.id}:${server.id}` }, state)] };
  const old = data.messages[server.id] && (await channel.messages.fetch(data.messages[server.id]).catch(() => null));
  if (old) return void (await old.edit(payload).catch(() => {}));
  const sent = await channel.send(payload).catch(() => null);
  if (!sent) return;
  data.messages[server.id] = sent.id;
  store.save(guild.id, data);
}

async function alert(guild, server, text, ping = false) {
  const channel = server.alertChannel ? guild.channels.cache.get(server.alertChannel) : null;
  if (!channel?.isTextBased()) return;
  const role = ping && server.alertRole ? `<@&${server.alertRole}> ` : '';
  await channel.send({ content: `${role}${text}`, allowedMentions: { roles: role ? [server.alertRole] : [] } }).catch(() => {});
}

// Checks a server right away (save, dashboard button) and updates its message
async function refresh(guild, server) {
  const state = await check(guild, server);
  await updateStatusMessage(guild, server, state);
  return state;
}

// ---------- Restarts with countdown (RCON) ----------

async function rcon(guild, server, command) {
  if (!server.rconPort || !server.rconPassword) throw new Error(`le RCON n’est pas configuré pour ${server.name} (port et mot de passe).`);
  const ip = await resolveHost(server.host, allowPrivate(guild));
  return rconCommand(ip, server.rconPort, server.rconPassword, command);
}

const restarts = new Map(); // guildId:serverId → { timers, at }
const STEPS = [60, 30, 15, 10, 5, 3, 2, 1].map((m) => m * 60).concat([30, 10]); // seconds before the restart: in-game announcements
const delayText = (s) => (s >= 60 ? `${s / 60} minute${s >= 120 ? 's' : ''}` : `${s} secondes`);

function scheduleRestart(guild, server, minutes, reason) {
  const key = `${guild.id}:${server.id}`;
  if (restarts.has(key)) throw new Error(`un redémarrage de ${server.name} est déjà prévu.`);
  if (!server.rconPort || !server.rconPassword) throw new Error(`le RCON n’est pas configuré pour ${server.name} (port et mot de passe).`);
  if (!commandOf(server, 'restart')) throw new Error('pas de commande de redémarrage connue pour ce jeu : indique-la dans les réglages.');
  const total = minutes * 60;
  const at = Date.now() + total * 1000;
  const announce = commandOf(server, 'announce');
  const t = translatorFor(guild); // in-game messages: in the server language (they don't go through Discord)
  const timers = announce
    ? STEPS.filter((s) => s <= total).map((s) =>
        setTimeout(() => rcon(guild, server, fillCommand(announce, t(`Redémarrage du serveur dans ${delayText(s)} !`))).catch(() => {}), (total - s) * 1000),
      )
    : [];
  timers.push(
    setTimeout(async () => {
      restarts.delete(key);
      const state = states.get(key);
      if (state) state.restarting = Date.now() + 15 * 60000;
      try {
        await rcon(guild, server, commandOf(server, 'restart'));
        await alert(guild, server, `🔄 **${server.name}** redémarre maintenant.`);
      } catch (error) {
        // The server often closes the connection while stopping: that's not a failure
        if (!/close|ECONNRESET|pas de réponse/i.test(error.message)) await alert(guild, server, `⚠️ Redémarrage de **${server.name}** impossible : ${error.message}`);
      }
    }, total * 1000),
  );
  restarts.set(key, { timers, at });
  alert(guild, server, `🔄 **${server.name}** va redémarrer <t:${Math.floor(at / 1000)}:R> (${reason}).`);
  updateStatusMessage(guild, server, stateOf(guild, server)).catch(() => {});
  return at;
}

function cancelRestart(guild, server) {
  const key = `${guild.id}:${server.id}`;
  const planned = restarts.get(key);
  if (!planned) return false;
  planned.timers.forEach(clearTimeout);
  restarts.delete(key);
  const announce = commandOf(server, 'announce');
  if (announce) rcon(guild, server, fillCommand(announce, translatorFor(guild)('Le redémarrage du serveur est annulé.'))).catch(() => {});
  alert(guild, server, `❎ Redémarrage de **${server.name}** annulé.`);
  updateStatusMessage(guild, server, stateOf(guild, server)).catch(() => {});
  return true;
}

const plannedRestart = (guild, server) => restarts.get(`${guild.id}:${server.id}`)?.at ?? null;

// ---------- Discord ↔ in-game name link, automatic whitelist ----------
// data/game-links.json = { <guildId>: { users: { <userId>: in-game name } } }
// Members who have the chosen role (whitelistRole) are added to the whitelist of the servers where it's enabled, and removed
// when they lose that role, leave the Discord server or remove their in-game name.

const links = createStore('game-links', { users: {} });
const linkOf = (guildId, userId) => links.peek(guildId).users[userId] ?? null;
const linkCount = (guildId) => Object.keys(links.peek(guildId).users).length;

// Servers whose whitelist is managed by the bot
const whitelistServers = (config) =>
  config.servers.filter((s) => s.whitelist && s.rconPort && s.rconPassword && commandOf(s, 'whitelistAdd') && commandOf(s, 'whitelistRemove'));

// Adds (or removes) a name on every whitelist. Returns one line per server: ✅ or ⚠️ with the error
async function syncWhitelist(guild, pseudo, add) {
  const config = getFeature(guild.id, 'gameServers');
  if (!config.enabled) return [];
  const results = [];
  for (const server of whitelistServers(config)) {
    try {
      await rcon(guild, server, fillCommand(commandOf(server, add ? 'whitelistAdd' : 'whitelistRemove'), '', pseudo));
      results.push(`✅ ${server.name}`);
    } catch (error) {
      results.push(`⚠️ ${server.name} : ${error.message}`);
    }
  }
  return results;
}

const hasWhitelistRole = (member, config = getFeature(member.guild.id, 'gameServers')) => Boolean(config.whitelistRole && member.roles.cache.has(config.whitelistRole));

// The member links (or changes) their in-game name. Returns { previous, results }
async function setLink(member, pseudo) {
  const data = links.get(member.guild.id);
  const previous = data.users[member.id] ?? null;
  data.users[member.id] = pseudo;
  links.save(member.guild.id, data);
  const results = [];
  if (hasWhitelistRole(member)) {
    if (previous && previous !== pseudo) await syncWhitelist(member.guild, previous, false);
    results.push(...(await syncWhitelist(member.guild, pseudo, true)));
  }
  return { previous, results };
}

async function removeLink(member) {
  const data = links.get(member.guild.id);
  const pseudo = data.users[member.id];
  if (!pseudo) return null;
  delete data.users[member.id];
  links.save(member.guild.id, data);
  if (hasWhitelistRole(member)) await syncWhitelist(member.guild, pseudo, false);
  return pseudo;
}

// Whitelist role gained or lost (GuildMemberUpdate): the whitelist follows
async function handleWhitelistRoles(before, after) {
  const config = getFeature(after.guild.id, 'gameServers');
  if (!config.enabled || !config.whitelistRole || before.partial) return;
  const had = before.roles.cache.has(config.whitelistRole);
  const has = after.roles.cache.has(config.whitelistRole);
  const pseudo = linkOf(after.guild.id, after.id);
  if (had !== has && pseudo) await syncWhitelist(after.guild, pseudo, has);
}

// Leaving the Discord server: removed from the whitelist (the name stays linked if they come back)
async function handleWhitelistLeave(member) {
  const pseudo = linkOf(member.guild.id, member.id);
  const config = getFeature(member.guild.id, 'gameServers');
  if (pseudo && config.enabled && config.whitelistRole) await syncWhitelist(member.guild, pseudo, false);
}

// Paris time "HH:MM" (formatter created only once)
const PARIS_TIME = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const parisTime = (date) => PARIS_TIME.format(date);

// Deletes a server from the config, along with its status message on Discord
async function removeServer(guild, serverId) {
  const config = getFeature(guild.id, 'gameServers');
  const server = config.servers.find((s) => s.id === serverId);
  if (!server) throw new Error('Serveur introuvable.');
  saveFeature(guild.id, 'gameServers', { ...config, servers: config.servers.filter((s) => s.id !== serverId) });
  if (restarts.has(`${guild.id}:${serverId}`)) cancelRestart(guild, server);
  states.delete(`${guild.id}:${serverId}`);
  if (allHistory()[`${guild.id}:${serverId}`]) {
    delete history[`${guild.id}:${serverId}`];
    historyDirty = true;
  }
  const data = store.get(guild.id);
  const messageId = data.messages[serverId];
  if (messageId) {
    const channel = guild.channels.cache.get(server.statusChannel);
    await (await channel?.messages.fetch(messageId).catch(() => null))?.delete().catch(() => {});
    delete data.messages[serverId];
    store.save(guild.id, data);
  }
  return server;
}

// ---------- Loop: each server is checked at the chosen interval ----------

function startGameServers(client) {
  let running = false;
  const lastCheck = new Map(); // guildId:serverId → date
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const due = []; // servers to check now
      for (const guild of client.guilds.cache.values()) {
        const config = getFeature(guild.id, 'gameServers');
        if (!config.enabled || !config.servers.length) continue;
        for (const server of config.servers) {
          const key = `${guild.id}:${server.id}`;
          // Scheduled restart: the countdown starts "countdown" minutes before the planned time
          const times = server.restartTimes.split(',').map((t) => t.trim().padStart(5, '0')).filter((t) => t !== '00000');
          if (server.rconPort && times.includes(parisTime(Date.now() + server.countdown * 60000)) && !restarts.has(key)) {
            try {
              scheduleRestart(guild, server, server.countdown, 'redémarrage programmé');
            } catch (error) {
              console.error(`Scheduled restart (${guild.name}):`, error.message);
            }
          }
          if (Date.now() - (lastCheck.get(key) ?? 0) < config.interval * 60000 - 5000) continue;
          lastCheck.set(key, Date.now());
          due.push([guild, server]);
        }
      }
      // 8 checks at a time: an offline server makes you wait 3 seconds, it doesn't block the others
      for (let i = 0; i < due.length; i += 8) {
        await Promise.all(due.slice(i, i + 8).map(([guild, server]) => refresh(guild, server).catch((e) => console.error(`Game server (${guild.name}):`, e.message))));
      }
    } finally {
      running = false;
    }
  };
  setInterval(tick, 30000);
  setTimeout(tick, 10000);
}

module.exports = {
  stateOf, refresh, removeServer, scheduleRestart, cancelRestart, plannedRestart, startGameServers, playerHistory,
  linkOf, linkCount, setLink, removeLink, handleWhitelistRoles, handleWhitelistLeave,
};

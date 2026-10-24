const dgram = require('node:dgram');
const net = require('node:net');
const dns = require('node:dns/promises');
const { isPrivate } = require('../../core/public-fetch');
const { t } = require('../../core/i18n');

// Status of a game server: Steam query (A2S, most Steam games), Minecraft (Server List Ping) or FiveM (HTTP).
// Returns { name, map, players, maxPlayers, playerNames, ping, version }. Throws an error if the server doesn't answer.
// The address is given by a Discord server: addresses of the VPS's private network are refused (unless allowPrivate).

const TIMEOUT = 3000;

async function resolveHost(host, allowPrivate) {
  const ip = net.isIP(host) ? host : (await dns.lookup(host).catch(() => null))?.address;
  if (!ip) throw new Error('adresse introuvable');
  if (!allowPrivate && isPrivate(ip)) throw new Error(t('gameServers.private_address_refused'));
  return ip;
}

// ---------- Steam (A2S) ----------

function udpRequest(ip, port, packet) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket(net.isIPv6(ip) ? 'udp6' : 'udp4');
    const timer = setTimeout(() => done(new Error(t('gameServers.no_response'))), TIMEOUT);
    const done = (error, data) => {
      clearTimeout(timer);
      socket.close();
      error ? reject(error) : resolve(data);
    };
    socket.on('message', (data) => done(null, data));
    socket.on('error', (error) => done(error));
    socket.send(packet, port, ip);
  });
}

// Reading A2S replies (little-endian integers, zero-terminated strings)
function reader(buffer, offset) {
  return {
    byte: () => buffer[offset++],
    short: () => ((offset += 2), buffer.readUInt16LE(offset - 2)),
    long: () => ((offset += 4), buffer.readInt32LE(offset - 4)),
    float: () => ((offset += 4), buffer.readFloatLE(offset - 4)),
    string() {
      const end = buffer.indexOf(0, offset);
      const text = buffer.toString('utf8', offset, end < 0 ? buffer.length : end);
      offset = end < 0 ? buffer.length : end + 1;
      return text;
    },
    done: () => offset >= buffer.length,
  };
}

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const INFO = Buffer.concat([HEADER, Buffer.from('TSource Engine Query\0', 'latin1')]);

async function querySteam(ip, port, withPlayers) {
  let start = Date.now();
  let res = await udpRequest(ip, port, INFO);
  // Some servers first ask for a "challenge" to send back
  if (res[4] === 0x41) {
    start = Date.now();
    res = await udpRequest(ip, port, Buffer.concat([INFO, res.subarray(5, 9)]));
  }
  const ping = Date.now() - start;
  if (res[4] !== 0x49) throw new Error(t('gameServers.unexpected_response_it_right_query'));
  const r = reader(res, 5);
  r.byte(); // protocol version
  const name = r.string();
  const map = r.string();
  r.string(); // game folder
  const game = r.string();
  r.short(); // Steam id of the game
  const players = r.byte();
  const maxPlayers = r.byte();
  const bots = r.byte();

  let playerNames = [];
  if (withPlayers && players > 0) {
    try {
      let list = await udpRequest(ip, port, Buffer.concat([HEADER, Buffer.from([0x55, 0xff, 0xff, 0xff, 0xff])]));
      if (list[4] === 0x41) list = await udpRequest(ip, port, Buffer.concat([HEADER, Buffer.from([0x55]), list.subarray(5, 9)]));
      if (list[4] === 0x44) {
        const p = reader(list, 6);
        for (let i = 0; i < list[5] && !p.done(); i++) {
          p.byte();
          const playerName = p.string();
          p.long();
          p.float();
          if (playerName) playerNames.push(playerName);
        }
      }
    } catch {
      playerNames = []; // the player list is a bonus: the status stays valid without it
    }
  }
  return { name, map, players: Math.max(0, players - bots), maxPlayers, playerNames, ping, version: game };
}

// ---------- Minecraft (Server List Ping) ----------

const varint = (value) => {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
};
const mcPacket = (...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([varint(body.length), body]);
};
function readVarint(buffer, offset) {
  let value = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    if (offset >= buffer.length) return null;
    const byte = buffer[offset++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return { value, offset };
  }
  return null;
}
// Text of a Minecraft description (plain text or components)
const mcText = (d) => (typeof d === 'string' ? d : `${d?.text ?? ''}${(d?.extra ?? []).map(mcText).join('')}`).replace(/§./g, '');

function queryMinecraft(ip, port, host) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const socket = net.createConnection({ host: ip, port });
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error(t('gameServers.no_response'))), TIMEOUT);
    const done = (error, result) => {
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve(result);
    };
    socket.on('connect', () => {
      const hostBuffer = Buffer.from(host, 'utf8');
      const portBuffer = Buffer.alloc(2);
      portBuffer.writeUInt16BE(port);
      socket.write(mcPacket(varint(0), varint(765), varint(hostBuffer.length), hostBuffer, portBuffer, varint(1)));
      socket.write(mcPacket(varint(0)));
    });
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      const length = readVarint(data, 0);
      if (!length || data.length < length.offset + length.value) return;
      const id = readVarint(data, length.offset);
      const size = id && readVarint(data, id.offset);
      if (!size) return done(new Error(t('gameServers.unreadable_response')));
      try {
        const json = JSON.parse(data.toString('utf8', size.offset, size.offset + size.value));
        done(null, {
          name: mcText(json.description).trim(),
          map: '',
          players: json.players?.online ?? 0,
          maxPlayers: json.players?.max ?? 0,
          playerNames: (json.players?.sample ?? []).map((p) => p.name).filter(Boolean),
          ping: Date.now() - start,
          version: json.version?.name ?? '',
        });
      } catch {
        done(new Error(t('gameServers.unreadable_response')));
      }
    });
    socket.on('error', (error) => done(new Error(error.code === 'ECONNREFUSED' ? t('gameServers.connection_refused') : error.message)));
  });
}

// ---------- FiveM (HTTP) ----------

async function queryFivem(ip, port) {
  const start = Date.now();
  const get = (path) =>
    fetch(`http://${net.isIPv6(ip) ? `[${ip}]` : ip}:${port}${path}`, { signal: AbortSignal.timeout(TIMEOUT), redirect: 'error' }).then((r) => {
      if (!r.ok) throw new Error(t('gameServers.server_answered', { status: r.status }));
      return r.json();
    });
  const dynamic = await get('/dynamic.json');
  const ping = Date.now() - start;
  const players = await get('/players.json').catch(() => []);
  return {
    name: String(dynamic.hostname ?? '').replace(/\^\d/g, ''),
    map: dynamic.mapname ?? '',
    players: dynamic.clients ?? players.length,
    maxPlayers: Number(dynamic.sv_maxclients) || 0,
    playerNames: players.map((p) => p.name).filter(Boolean),
    ping,
    version: dynamic.gametype ?? '',
  };
}

// ---------- Entry point ----------

async function queryServer({ game, host, port }, { allowPrivate = false, withPlayers = true } = {}) {
  const ip = await resolveHost(host, allowPrivate);
  if (game === 'minecraft') return queryMinecraft(ip, port, host);
  if (game === 'fivem') return queryFivem(ip, port);
  return querySteam(ip, port, withPlayers);
}

module.exports = { queryServer, resolveHost };

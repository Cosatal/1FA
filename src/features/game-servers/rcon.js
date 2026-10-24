const net = require('node:net');
const { t } = require('../../core/i18n');

// RCON client (Source protocol, used by Project Zomboid, Minecraft, ARK, Palworld, CS2, Garry's Mod…).
// One connection per command: authenticate with the password, send the command, return the server's reply.
// ip: address already checked by game-query.js (resolveHost).

const AUTH = 3;
const EXEC = 2;
const AUTH_RESPONSE = 2;
const RESPONSE = 0;

function packet(id, type, body) {
  const text = Buffer.from(body, 'utf8');
  const buffer = Buffer.alloc(14 + text.length); // size, id, type, text, then two zero bytes
  buffer.writeInt32LE(10 + text.length, 0);
  buffer.writeInt32LE(id, 4);
  buffer.writeInt32LE(type, 8);
  text.copy(buffer, 12);
  return buffer;
}

function rconCommand(ip, port, password, command, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port });
    let buffer = Buffer.alloc(0);
    let authed = false;
    let output = '';
    let idle = null;
    const done = (error) => {
      clearTimeout(timer);
      clearTimeout(idle);
      socket.destroy();
      error ? reject(error) : resolve(output.trim());
    };
    // After the command: the reply can arrive in several pieces, so wait for a short silence before concluding
    const waitForMore = () => {
      clearTimeout(idle);
      idle = setTimeout(() => done(), 500);
    };
    const timer = setTimeout(() => (authed ? done() : done(new Error(t('gameServers.no_response_from_rcon')))), timeout);

    socket.on('connect', () => socket.write(packet(1, AUTH, password)));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const size = buffer.readInt32LE(0);
        if (size < 10 || size > 1_000_000) return done(new Error(t('gameServers.unreadable_rcon_response')));
        if (buffer.length < size + 4) break;
        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.toString('utf8', 12, size + 2);
        buffer = buffer.subarray(size + 4);
        if (!authed) {
          if (type !== AUTH_RESPONSE) continue; // some servers first send an empty reply
          if (id === -1) return done(new Error(t('gameServers.rcon_password_refused')));
          authed = true;
          socket.write(packet(2, EXEC, command));
          waitForMore();
        } else if (type === RESPONSE) {
          output += body;
          waitForMore();
        }
      }
    });
    socket.on('error', (error) => done(new Error(error.code === 'ECONNREFUSED' ? t('gameServers.rcon_connection_refused_wrong_port') : `RCON injoignable (${error.code ?? error.message})`)));
    socket.on('close', () => authed && done());
  });
}

module.exports = { rconCommand };

// Unlocking keeps what it couldn't restore · backup download with a non-Latin server name
const assert = require('node:assert');
const { test, after } = require('node:test');
const express = require('express');
const { ChannelType, Collection } = require('discord.js');
const { lockChannel, unlockChannel, isLocked } = require('../src/features/moderation/lockdown');
const { backupRoutes } = require('../src/dashboard/backup');

test('a failed restore keeps the channel locked, a retry finishes it', async () => {
  const guildId = '900000000000000001';
  let fail = false;
  const edits = [];
  const guild = { id: guildId, members: { me: {} }, roles: { cache: new Collection([[guildId, {}]]) } };
  const channel = {
    id: 'c1',
    name: 'general',
    type: ChannelType.GuildText,
    guild,
    permissionsFor: () => ({ has: () => true }),
    permissionOverwrites: {
      cache: new Collection(),
      edit: async (id, perms) => {
        if (fail) throw new Error('Discord 503');
        edits.push([id, perms]);
      },
    },
  };
  guild.channels = { cache: new Collection([['c1', channel]]) };

  assert.equal(await lockChannel(channel, { by: 'mod', reason: 'test' }), 'locked');
  fail = true;
  assert.equal(await unlockChannel(guild, 'c1'), true);
  assert.equal(isLocked(guildId, 'c1'), true); // saved permissions not lost
  fail = false;
  await unlockChannel(guild, 'c1');
  assert.equal(isLocked(guildId, 'c1'), false);
  assert.deepEqual(edits.at(-1), [guildId, { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null, CreatePrivateThreads: null }]);
});

test('backup download works with a Cyrillic server name', async () => {
  const app = express();
  const guild = { id: '900000000000000002', name: 'Сервер', roles: { cache: new Map() }, channels: { cache: new Map() } };
  const pass = (req, res, next) => ((req.guild = guild), next());
  backupRoutes(app, pass, pass, {});
  const server = app.listen(0);
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/guilds/x/backup`);
  server.close();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
});

// The stores start save timers: stop the process once the tests are done
after(() => setImmediate(() => process.exit(0)));

// Risky pure logic: private addresses (SSRF), secret encryption, durations, XP levels, ticket index
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // before secrets.js is loaded
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test, after } = require('node:test');
const { isPrivate } = require('../src/core/public-fetch');
const { encryptSecret, decryptSecret } = require('../src/core/secrets');
const { parseDuration } = require('../src/features/moderation/moderation');
const { levelInfo, totalFor } = require('../src/features/levels');
const { flushStores, DATA_DIR } = require('../src/core/store');
const transcripts = require('../src/features/tickets/transcripts');

test('isPrivate: private and reserved addresses are refused', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2002:a00::1']) {
    assert.equal(isPrivate(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) assert.equal(isPrivate(ip), false, ip);
});

test('secrets: encrypted, read back, and a tampered value reads as empty', () => {
  const stored = encryptSecret('sk-test-123');
  assert.match(stored, /^enc:v1:/);
  assert.equal(decryptSecret(stored), 'sk-test-123');
  assert.equal(decryptSecret('plain-old-value'), 'plain-old-value');
  assert.equal(decryptSecret(`${stored.slice(0, -4)}AAAA`), '');
});

test('parseDuration', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('2 j'), 172_800_000);
  assert.equal(parseDuration('1sem'), 604_800_000);
  assert.equal(parseDuration('10min'), 600_000);
  for (const bad of ['', 'abc', '5', '0m', '1x']) assert.equal(parseDuration(bad), null, bad);
});

test('levelInfo agrees with totalFor at each level boundary', () => {
  for (const level of [0, 1, 5, 30]) {
    assert.equal(levelInfo(totalFor(level)).level, level);
    assert.equal(levelInfo(totalFor(level)).current, 0);
    if (level) assert.equal(levelInfo(totalFor(level) - 1).level, level - 1);
  }
});

test('ticket index: written after a short delay, and complete', async () => {
  const guildId = '900000000000000003';
  const ticketId = '900000000000000004';
  const file = path.join(DATA_DIR, 'transcripts', guildId, 'index.json');
  transcripts.createTicket({ guildId, id: ticketId, user: { id: '1', tag: 'membre' }, type: 'Aide' });
  await transcripts.addMessage(guildId, ticketId, { from: 'member', author: 'membre', content: 'bonjour' });
  assert.equal(transcripts.listTickets(guildId)[0].count, 1); // read from memory right away
  flushStores();
  const [saved] = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.id, ticketId);
  assert.equal(saved.count, 1);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('openCounts matches the conversation list', async () => {
  const guildId = '900000000000000005';
  const open = (id, userId, from) => {
    transcripts.createTicket({ guildId, id, user: { id: userId, tag: userId }, type: 'Aide' });
    return transcripts.addMessage(guildId, id, { from, content: 'x' });
  };
  await open('900000000000000011', 'a', 'member');
  await open('900000000000000012', 'b', 'staff');
  await open('900000000000000013', 'c', 'member');
  transcripts.updateTicket(guildId, '900000000000000013', { closedAt: Date.now() });
  const list = transcripts.listConversations(guildId, { status: 'open' });
  const expected = { open: list.length, waiting: list.filter((c) => c.open.lastFrom !== 'staff').length };
  assert.deepEqual(transcripts.openCounts(guildId), expected);
  assert.deepEqual(expected, { open: 2, waiting: 1 });
  flushStores();
  fs.rmSync(path.join(DATA_DIR, 'transcripts', guildId), { recursive: true, force: true });
});

// The stores start save timers: stop the process once the tests are done
after(() => setImmediate(() => process.exit(0)));

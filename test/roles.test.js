// Who may be given a role from the dashboard, and who may sanction whom (security rules)
// Temporary data folder: the tests never touch the bot's real data/
process.env.DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), '1fa-test-'));
const assert = require('node:assert');
const { PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const { giveableRole } = require('../src/core/feature-config');
const { test, after } = require('node:test');
const { targetError } = require('../src/features/moderation/moderation');
const guild = { id: 'g', ownerId: 'owner' };
const role = (perms, extra = {}) => ({ id: 'r', guild, editable: true, managed: false, permissions: new PermissionsBitField(perms), ...extra });
test('giveableRole refuses staff roles', () => {
  assert.equal(giveableRole(role([P.SendMessages])), true);
  assert.equal(giveableRole(role([P.Administrator])), false);
  assert.equal(giveableRole(role([P.BanMembers])), false);
  assert.equal(giveableRole(role([], { editable: false })), false);
  assert.equal(giveableRole(undefined), false);
});

const pos = (n) => ({ comparePositionTo: (o) => n - o.n, n });
const member = (id, n) => ({ id, guild: { ...guild, ownerId: 'owner' }, permissions: new PermissionsBitField([]), roles: { highest: pos(n), cache: { has: () => false } } });
const inter = (id, n) => ({ user: { id }, guild, guildId: 'g', member: member(id, n) });
const ok = () => true;
test('targetError follows the role hierarchy', () => {
  assert.match(targetError(inter('junior', 2), member('senior', 5), ok), /.+/); // below: refused
  assert.match(targetError(inter('a', 3), member('b', 3), ok), /.+/); // same level: refused
  assert.equal(targetError(inter('senior', 5), member('junior', 2), ok), null); // above: allowed
  assert.equal(targetError(inter('owner', 1), member('x', 5), ok), null); // owner: allowed
});
test('giveRoles skips staff roles saved before the dashboard check', async () => {
  const { giveRoles } = require('../src/features/welcome/welcome-card');
  const roles = new Map([['ok', role([P.SendMessages], { id: 'ok' })], ['admin', role([P.Administrator], { id: 'admin' })]]);
  const given = [];
  const member = { guild: { roles: { cache: roles } }, roles: { add: async (ids) => given.push(...ids) } };
  await giveRoles(member, ['ok', 'admin'], 'test');
  assert.deepEqual(given, ['ok']);
});

// The stores start save timers: stop the process once the tests are done
after(() => setImmediate(() => process.exit(0)));

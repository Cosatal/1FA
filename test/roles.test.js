// Who may be given a role from the dashboard, and who may sanction whom (security rules)
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
// The stores start save timers: stop the process once the tests are done
after(() => setImmediate(() => process.exit(0)));

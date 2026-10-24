const { createStore } = require('../core/store');
const { logActivity } = require('../core/activity');
const { every } = require('../core/scheduler');
const { t } = require('../core/i18n');

// Temporary roles: given for a duration (/role-temporaire), removed automatically at the end, even after a restart.
// data/temp-roles.json = { <guildId>: { list: [{ userId, roleId, until, by }] } }

const store = createStore('temp-roles', { list: [] });

function addTempRole(guildId, entry) {
  const { list } = store.get(guildId);
  // Same member and same role: the new duration replaces the old one
  store.save(guildId, { list: [...list.filter((t) => !(t.userId === entry.userId && t.roleId === entry.roleId)), entry] });
}

function removeTempRole(guildId, userId, roleId) {
  const { list } = store.get(guildId);
  const kept = list.filter((t) => !(t.userId === userId && t.roleId === roleId));
  store.save(guildId, { list: kept });
  return kept.length !== list.length;
}

const tempRoles = (guildId) => store.peek(guildId).list;

// Every minute: roles that have ended are removed (directly by id: the member isn't necessarily cached)
function startTempRoles(client) {
  every('temp-roles', 60000, async () => {
    for (const guild of client.guilds.cache.values()) {
      const due = tempRoles(guild.id).filter((entry) => entry.until <= Date.now());
      for (const entry of due) {
        removeTempRole(guild.id, entry.userId, entry.roleId);
        await guild.members.removeRole({ user: entry.userId, role: entry.roleId, reason: t('tempRoles.end_temporary_role') }).catch(() => {});
        const name = guild.members.cache.get(entry.userId)?.displayName ?? entry.userId;
        const role = guild.roles.cache.get(entry.roleId)?.name ?? entry.roleId;
        logActivity(guild.id, { source: 'bot', action: 'temp_role.ended', title: `Rôle temporaire @${role} retiré à ${name} (durée terminée)`, data: { membre: entry.userId, rôle: entry.roleId } });
      }
    }
  });
}

module.exports = { addTempRole, removeTempRole, tempRoles, startTempRoles };

const { createStore } = require('../core/store');
const { logActivity } = require('../core/activity');

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
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const due = tempRoles(guild.id).filter((t) => t.until <= Date.now());
      for (const t of due) {
        removeTempRole(guild.id, t.userId, t.roleId);
        await guild.members.removeRole({ user: t.userId, role: t.roleId, reason: 'Fin du rôle temporaire' }).catch(() => {});
        const name = guild.members.cache.get(t.userId)?.displayName ?? t.userId;
        const role = guild.roles.cache.get(t.roleId)?.name ?? t.roleId;
        logActivity(guild.id, { source: 'bot', action: 'temp_role.ended', title: `Rôle temporaire @${role} retiré à ${name} (durée terminée)`, data: { membre: t.userId, rôle: t.roleId } });
      }
    }
  }, 60000).unref();
}

module.exports = { addTempRole, removeTempRole, tempRoles, startTempRoles };

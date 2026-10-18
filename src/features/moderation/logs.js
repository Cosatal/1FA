const { EmbedBuilder, Events, AuditLogEvent } = require('discord.js');
const { sendLog } = require('./moderation');

// Server logs: each event enabled in the dashboard is sent to the logs channel (moderation.js).
// needs: required privileged intent ("members" = Server Members Intent, "content" = Message Content Intent)

const LOG_EVENTS = [
  { group: 'Événements de modération (commandes du bot)', items: [
    ['modMute', 'Membre rendu muet'], ['modUnmute', 'Membre dé-mute'], ['modBan', 'Ban de modération'], ['modUnban', 'Débannissement de modération'],
    ['modKick', 'Expulsion'], ['modWarn', 'Avertissement'], ['modClear', 'Messages supprimés avec /clear'],
  ] },
  { group: 'Événements de message', items: [['messageEdit', 'Message modifié', 'content'], ['messageDelete', 'Message supprimé', 'content'], ['invitePosted', 'Invitation postée', 'content']] },
  { group: 'Événements des membres', items: [
    ['memberNick', 'Surnom changé', 'members'], ['memberBan', 'Membre banni'], ['memberJoin', 'Un membre a rejoint le serveur', 'members'],
    ['memberLeave', 'Un membre a quitté le serveur', 'members'], ['memberUnban', 'Membre débanni'], ['memberUpdate', 'Membre modifié (avatar de serveur, exclusion)', 'members'],
  ] },
  { group: 'Événements de rôle', items: [['roleCreate', 'Rôle créé'], ['roleUpdate', 'Rôle modifié'], ['roleDelete', 'Rôle supprimé'], ['memberRoles', 'Rôles du membre modifiés', 'members']] },
  { group: 'Événements vocaux', items: [['voiceJoin', 'Un membre a rejoint un salon vocal'], ['voiceLeave', 'Un membre a quitté un salon vocal']] },
  { group: 'Événements du serveur', items: [['guildUpdate', 'Serveur modifié'], ['emojis', 'Émojis modifiés']] },
  { group: 'Événements des salons', items: [['channelCreate', 'Salon créé'], ['channelUpdate', 'Salon mis à jour'], ['channelDelete', 'Salon supprimé']] },
];

const COLORS = { add: 0x3ba55c, remove: 0xed4245, edit: 0xf5a524, info: 0x2f7ff0 };
const clip = (text, max = 1024) => (text.length > max ? `${text.slice(0, max - 1)}…` : text) || '*(vide)*';
const ts = (date) => `<t:${Math.floor(date / 1000)}:R>`;

function embed(color, title, { user, description, fields = [] } = {}) {
  const e = new EmbedBuilder().setColor(COLORS[color]).setTitle(title).setTimestamp();
  if (user) e.setAuthor({ name: user.tag ?? user.username, iconURL: user.displayAvatarURL() }).setFooter({ text: `ID : ${user.id}` });
  if (description) e.setDescription(clip(description, 4000));
  if (fields.length) e.addFields(fields.map((f) => ({ ...f, value: clip(f.value) })));
  return e;
}

// List of changes between two versions (role, channel, server): "Name: before → after"
function changes(before, after, labels) {
  return Object.entries(labels)
    .map(([key, label]) => {
      const [a, b] = [before[key], after[key]].map((v) => (v?.bitfield !== undefined ? v.bitfield.toString() : v));
      return a === b ? null : `**${label}** : ${a ?? '—'} → ${b ?? '—'}`;
    })
    .filter(Boolean);
}

// Who did the action, according to the audit log (null if unknown or no permission)
async function executor(guild, type, targetId) {
  const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
  const entry = logs?.entries.find((e) => e.target?.id === targetId && Date.now() - e.createdTimestamp < 10000);
  return entry?.executor ?? null;
}

function registerLogs(client) {
  const on = (event, handler) =>
    client.on(event, (...args) => Promise.resolve().then(() => handler(...args)).catch((error) => console.error(`Logs (${event}):`, error.message)));

  // ---------- Messages ----------
  const INVITE = /(discord\.gg|discord(app)?\.com\/invite)\/[\w-]+/i;
  on(Events.MessageCreate, async (m) => {
    if (m.guild && !m.author.bot && INVITE.test(m.content)) {
      await sendLog(m.guild, 'invitePosted', embed('edit', '✉️ Invitation postée', { user: m.author, description: m.content, fields: [{ name: 'Salon', value: `${m.channel} · [voir](${m.url})` }] }));
    }
  });
  on(Events.MessageUpdate, async (before, after) => {
    if (!after.guild || after.author?.bot || before.content === after.content || after.partial) return;
    await sendLog(after.guild, 'messageEdit', embed('edit', '✏️ Message modifié', {
      user: after.author,
      fields: [
        { name: 'Salon', value: `${after.channel} · [voir le message](${after.url})` },
        { name: 'Avant', value: before.partial ? '*(message trop ancien, contenu inconnu)*' : before.content },
        { name: 'Après', value: after.content },
      ],
    }));
  });
  on(Events.MessageDelete, async (m) => {
    if (!m.guild || m.author?.bot) return;
    const files = [...(m.attachments?.values() ?? [])].map((a) => a.name).join(', ');
    await sendLog(m.guild, 'messageDelete', embed('remove', '🗑️ Message supprimé', {
      user: m.author,
      description: m.partial ? '*(message trop ancien, contenu inconnu)*' : m.content || '*(sans texte)*',
      fields: [{ name: 'Salon', value: `${m.channel}` }, ...(files ? [{ name: 'Fichiers', value: files }] : [])],
    }));
  });

  // ---------- Members ----------
  on(Events.GuildMemberAdd, (member) =>
    sendLog(member.guild, 'memberJoin', embed('add', '📥 Membre arrivé', { user: member.user, description: `${member} · compte créé ${ts(member.user.createdTimestamp)}`, fields: [{ name: 'Membres', value: `${member.guild.memberCount}` }] })),
  );
  on(Events.GuildMemberRemove, (member) =>
    sendLog(member.guild, 'memberLeave', embed('remove', '📤 Membre parti', { user: member.user, description: `${member.user}${member.joinedTimestamp ? ` · arrivé ${ts(member.joinedTimestamp)}` : ''}` })),
  );
  // The audit log is only read if this log is enabled (sendLog calls the function only in that case)
  on(Events.GuildBanAdd, (ban) =>
    sendLog(ban.guild, 'memberBan', async () => {
      const by = await executor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      return embed('remove', '🔨 Membre banni', { user: ban.user, fields: [...(by ? [{ name: 'Par', value: `${by}` }] : []), ...(ban.reason ? [{ name: 'Raison', value: ban.reason }] : [])] });
    }),
  );
  on(Events.GuildBanRemove, (ban) =>
    sendLog(ban.guild, 'memberUnban', async () => {
      const by = await executor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
      return embed('add', '🕊️ Membre débanni', { user: ban.user, fields: by ? [{ name: 'Par', value: `${by}` }] : [] });
    }),
  );
  on(Events.GuildMemberUpdate, async (before, after) => {
    if (before.partial) return; // previous state unknown: impossible to tell what changed
    const { guild, user } = after;
    if (before.nickname !== after.nickname) {
      await sendLog(guild, 'memberNick', embed('edit', '🏷️ Surnom changé', { user, fields: [{ name: 'Avant', value: before.nickname ?? '*(aucun)*', inline: true }, { name: 'Après', value: after.nickname ?? '*(aucun)*', inline: true }] }));
    }
    const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
    if (added.size || removed.size) {
      await sendLog(guild, 'memberRoles', embed('edit', '🎭 Rôles du membre modifiés', {
        user,
        fields: [...(added.size ? [{ name: 'Ajoutés', value: added.map((r) => `${r}`).join(' ') }] : []), ...(removed.size ? [{ name: 'Retirés', value: removed.map((r) => `${r}`).join(' ') }] : [])],
      }));
    }
    const lines = [];
    if (before.avatar !== after.avatar) lines.push('Avatar de serveur modifié');
    if (before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp) {
      lines.push(after.isCommunicationDisabled() ? `Exclu temporairement jusqu’à ${ts(after.communicationDisabledUntilTimestamp)}` : 'Exclusion temporaire levée');
    }
    if (lines.length) await sendLog(guild, 'memberUpdate', embed('edit', '👤 Membre modifié', { user, description: lines.join('\n') }));
  });

  // ---------- Roles ----------
  const ROLE = { name: 'Nom', hexColor: 'Couleur', hoist: 'Affiché à part', mentionable: 'Mentionnable', permissions: 'Permissions (valeur)' };
  on(Events.GuildRoleCreate, (role) => sendLog(role.guild, 'roleCreate', embed('add', '➕ Rôle créé', { description: `${role} · ${role.name}` })));
  on(Events.GuildRoleDelete, (role) => sendLog(role.guild, 'roleDelete', embed('remove', '➖ Rôle supprimé', { description: role.name })));
  on(Events.GuildRoleUpdate, async (before, after) => {
    const lines = changes(before, after, ROLE);
    if (lines.length) await sendLog(after.guild, 'roleUpdate', embed('edit', '✏️ Rôle modifié', { description: `${after}\n${lines.join('\n')}` }));
  });

  // ---------- Voice ----------
  on(Events.VoiceStateUpdate, async (before, after) => {
    if (before.channelId === after.channelId) return;
    const user = after.member?.user ?? before.member?.user;
    if (!user || user.bot) return;
    if (before.channel) await sendLog(before.guild, 'voiceLeave', embed('remove', '🔇 Salon vocal quitté', { user, description: `${user} a quitté ${before.channel}` }));
    if (after.channel) await sendLog(after.guild, 'voiceJoin', embed('add', '🔊 Salon vocal rejoint', { user, description: `${user} a rejoint ${after.channel}` }));
  });

  // ---------- Server ----------
  const GUILD = { name: 'Nom', icon: 'Icône', banner: 'Bannière', description: 'Description', verificationLevel: 'Niveau de vérification', systemChannelId: 'Salon système', afkChannelId: 'Salon AFK' };
  on(Events.GuildUpdate, async (before, after) => {
    const lines = changes(before, after, GUILD);
    if (lines.length) await sendLog(after, 'guildUpdate', embed('edit', '⚙️ Serveur modifié', { description: lines.join('\n') }));
  });
  on(Events.GuildEmojiCreate, (e) => sendLog(e.guild, 'emojis', embed('add', '😀 Émoji ajouté', { description: `${e} \`:${e.name}:\`` })));
  on(Events.GuildEmojiDelete, (e) => sendLog(e.guild, 'emojis', embed('remove', '😶 Émoji supprimé', { description: `\`:${e.name}:\`` })));
  on(Events.GuildEmojiUpdate, (before, after) => sendLog(after.guild, 'emojis', embed('edit', '✏️ Émoji renommé', { description: `${after} \`:${before.name}:\` → \`:${after.name}:\`` })));

  // ---------- Channels ----------
  const CHANNEL = { name: 'Nom', topic: 'Sujet', nsfw: 'NSFW', rateLimitPerUser: 'Mode lent (s)', parentId: 'Catégorie' };
  on(Events.ChannelCreate, (c) => c.guild && sendLog(c.guild, 'channelCreate', embed('add', '📁 Salon créé', { description: `${c} · ${c.name}` })));
  on(Events.ChannelDelete, (c) => c.guild && sendLog(c.guild, 'channelDelete', embed('remove', '🗑️ Salon supprimé', { description: `#${c.name}` })));
  on(Events.ChannelUpdate, async (before, after) => {
    if (!after.guild) return;
    const lines = changes(before, after, CHANNEL);
    if (lines.length) await sendLog(after.guild, 'channelUpdate', embed('edit', '✏️ Salon mis à jour', { description: `${after}\n${lines.join('\n')}` }));
  });
}

module.exports = { LOG_EVENTS, registerLogs };

const { EmbedBuilder, Events, AuditLogEvent } = require('discord.js');
const { sendLog } = require('./moderation');
const { t } = require('../../core/i18n');

// Server logs: each event enabled in the dashboard is sent to the logs channel (moderation.js).
// needs: required privileged intent ("members" = Server Members Intent, "content" = Message Content Intent)

const LOG_EVENTS = [
  { group: t('logs.moderation_events_bot_commands'), items: [
    ['modMute', t('logs.member_muted')], ['modUnmute', t('logs.member_unmuted')], ['modBan', t('logs.moderation_ban')], ['modUnban', t('logs.moderation_unban')],
    ['modKick', t('logs.kick')], ['modWarn', t('logs.warning')], ['modClear', t('logs.messages_deleted_with_clear')],
  ] },
  { group: t('logs.message_events'), items: [['messageEdit', t('logs.message_edited'), 'content'], ['messageDelete', t('logs.message_deleted'), 'content'], ['invitePosted', t('logs.invite_posted'), 'content']] },
  { group: t('logs.member_events'), items: [
    ['memberNick', t('logs.nickname_changed'), 'members'], ['memberBan', t('logs.member_banned')], ['memberJoin', t('logs.member_joined_server'), 'members'],
    ['memberLeave', t('logs.member_left_server'), 'members'], ['memberUnban', t('logs.member_unbanned')], ['memberUpdate', t('logs.member_updated_server_avatar_timeout'), 'members'],
  ] },
  { group: t('logs.role_events'), items: [['roleCreate', t('logs.role_created')], ['roleUpdate', t('logs.role_updated')], ['roleDelete', t('logs.role_deleted')], ['memberRoles', t('logs.member_roles_updated'), 'members']] },
  { group: t('logs.voice_events'), items: [['voiceJoin', t('logs.member_joined_voice_channel')], ['voiceLeave', t('logs.member_left_voice_channel')]] },
  { group: t('logs.server_events'), items: [['guildUpdate', t('logs.server_updated')], ['emojis', t('logs.emojis_updated')]] },
  { group: t('logs.channel_events'), items: [['channelCreate', t('logs.channel_created')], ['channelUpdate', t('logs.channel_updated')], ['channelDelete', t('logs.channel_deleted')]] },
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
      await sendLog(m.guild, 'invitePosted', embed('edit', t('logs.invite_posted_2'), { user: m.author, description: m.content, fields: [{ name: t('logs.channel'), value: `${m.channel} · [voir](${m.url})` }] }));
    }
  });
  on(Events.MessageUpdate, async (before, after) => {
    if (!after.guild || after.author?.bot || before.content === after.content || after.partial) return;
    await sendLog(after.guild, 'messageEdit', embed('edit', t('logs.message_edited_2'), {
      user: after.author,
      fields: [
        { name: t('logs.channel'), value: t('logs.view_message', { channel: after.channel, url: after.url }) },
        { name: t('logs.before'), value: before.partial ? t('logs.message_too_old_content_unknown') : before.content },
        { name: t('logs.after'), value: after.content },
      ],
    }));
  });
  on(Events.MessageDelete, async (m) => {
    if (!m.guild || m.author?.bot) return;
    const files = [...(m.attachments?.values() ?? [])].map((a) => a.name).join(', ');
    await sendLog(m.guild, 'messageDelete', embed('remove', t('logs.message_deleted_2'), {
      user: m.author,
      description: m.partial ? t('logs.message_too_old_content_unknown') : m.content || '*(sans texte)*',
      fields: [{ name: t('logs.channel'), value: `${m.channel}` }, ...(files ? [{ name: t('logs.files'), value: files }] : [])],
    }));
  });

  // ---------- Members ----------
  on(Events.GuildMemberAdd, (member) =>
    sendLog(member.guild, 'memberJoin', embed('add', t('logs.member_joined'), { user: member.user, description: t('logs.account_created', { member, ts: ts(member.user.createdTimestamp) }), fields: [{ name: t('logs.members'), value: `${member.guild.memberCount}` }] })),
  );
  on(Events.GuildMemberRemove, (member) =>
    sendLog(member.guild, 'memberLeave', embed('remove', t('logs.member_left'), { user: member.user, description: `${member.user}${member.joinedTimestamp ? t('logs.joined', { ts: ts(member.joinedTimestamp) }) : ''}` })),
  );
  // The audit log is only read if this log is enabled (sendLog calls the function only in that case)
  on(Events.GuildBanAdd, (ban) =>
    sendLog(ban.guild, 'memberBan', async () => {
      const by = await executor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      return embed('remove', t('logs.member_banned_2'), { user: ban.user, fields: [...(by ? [{ name: t('logs.by'), value: `${by}` }] : []), ...(ban.reason ? [{ name: t('logs.reason'), value: ban.reason }] : [])] });
    }),
  );
  on(Events.GuildBanRemove, (ban) =>
    sendLog(ban.guild, 'memberUnban', async () => {
      const by = await executor(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
      return embed('add', t('logs.member_unbanned_2'), { user: ban.user, fields: by ? [{ name: t('logs.by'), value: `${by}` }] : [] });
    }),
  );
  on(Events.GuildMemberUpdate, async (before, after) => {
    if (before.partial) return; // previous state unknown: impossible to tell what changed
    const { guild, user } = after;
    if (before.nickname !== after.nickname) {
      await sendLog(guild, 'memberNick', embed('edit', t('logs.nickname_changed_2'), { user, fields: [{ name: t('logs.before'), value: before.nickname ?? '*(aucun)*', inline: true }, { name: t('logs.after'), value: after.nickname ?? '*(aucun)*', inline: true }] }));
    }
    const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
    const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
    if (added.size || removed.size) {
      await sendLog(guild, 'memberRoles', embed('edit', t('logs.member_roles_updated_2'), {
        user,
        fields: [...(added.size ? [{ name: t('logs.added'), value: added.map((r) => `${r}`).join(' ') }] : []), ...(removed.size ? [{ name: t('logs.removed'), value: removed.map((r) => `${r}`).join(' ') }] : [])],
      }));
    }
    const lines = [];
    if (before.avatar !== after.avatar) lines.push(t('logs.server_avatar_changed'));
    if (before.communicationDisabledUntilTimestamp !== after.communicationDisabledUntilTimestamp) {
      lines.push(after.isCommunicationDisabled() ? t('logs.timed_out_until', { ts: ts(after.communicationDisabledUntilTimestamp) }) : t('logs.timeout_removed'));
    }
    if (lines.length) await sendLog(guild, 'memberUpdate', embed('edit', t('logs.member_updated'), { user, description: lines.join('\n') }));
  });

  // ---------- Roles ----------
  const ROLE = { name: t('logs.name'), hexColor: t('logs.color'), hoist: t('logs.displayed_separately'), mentionable: t('logs.mentionable'), permissions: t('logs.permissions_value') };
  on(Events.GuildRoleCreate, (role) => sendLog(role.guild, 'roleCreate', embed('add', t('logs.role_created_2'), { description: `${role} · ${role.name}` })));
  on(Events.GuildRoleDelete, (role) => sendLog(role.guild, 'roleDelete', embed('remove', t('logs.role_deleted_2'), { description: role.name })));
  on(Events.GuildRoleUpdate, async (before, after) => {
    const lines = changes(before, after, ROLE);
    if (lines.length) await sendLog(after.guild, 'roleUpdate', embed('edit', t('logs.role_updated_2'), { description: `${after}\n${lines.join('\n')}` }));
  });

  // ---------- Voice ----------
  on(Events.VoiceStateUpdate, async (before, after) => {
    if (before.channelId === after.channelId) return;
    const user = after.member?.user ?? before.member?.user;
    if (!user || user.bot) return;
    if (before.channel) await sendLog(before.guild, 'voiceLeave', embed('remove', t('logs.left_voice_channel'), { user, description: t('logs.left', { user, channel: before.channel }) }));
    if (after.channel) await sendLog(after.guild, 'voiceJoin', embed('add', t('logs.joined_voice_channel'), { user, description: t('logs.joined', { user, channel: after.channel }) }));
  });

  // ---------- Server ----------
  const GUILD = { name: t('logs.name'), icon: t('logs.icon'), banner: t('logs.banner'), description: 'Description', verificationLevel: t('logs.verification_level'), systemChannelId: t('logs.system_channel'), afkChannelId: t('logs.afk_channel') };
  on(Events.GuildUpdate, async (before, after) => {
    const lines = changes(before, after, GUILD);
    if (lines.length) await sendLog(after, 'guildUpdate', embed('edit', t('logs.server_updated_2'), { description: lines.join('\n') }));
  });
  on(Events.GuildEmojiCreate, (e) => sendLog(e.guild, 'emojis', embed('add', t('logs.emoji_added'), { description: `${e} \`:${e.name}:\`` })));
  on(Events.GuildEmojiDelete, (e) => sendLog(e.guild, 'emojis', embed('remove', t('logs.emoji_deleted'), { description: `\`:${e.name}:\`` })));
  on(Events.GuildEmojiUpdate, (before, after) => sendLog(after.guild, 'emojis', embed('edit', t('logs.emoji_renamed'), { description: `${after} \`:${before.name}:\` → \`:${after.name}:\`` })));

  // ---------- Channels ----------
  const CHANNEL = { name: t('logs.name'), topic: t('logs.topic'), nsfw: 'NSFW', rateLimitPerUser: t('logs.slow_mode'), parentId: t('logs.category') };
  on(Events.ChannelCreate, (c) => c.guild && sendLog(c.guild, 'channelCreate', embed('add', t('logs.channel_created_2'), { description: `${c} · ${c.name}` })));
  on(Events.ChannelDelete, (c) => c.guild && sendLog(c.guild, 'channelDelete', embed('remove', t('logs.channel_deleted_2'), { description: `#${c.name}` })));
  on(Events.ChannelUpdate, async (before, after) => {
    if (!after.guild) return;
    const lines = changes(before, after, CHANNEL);
    if (lines.length) await sendLog(after.guild, 'channelUpdate', embed('edit', t('logs.channel_updated_2'), { description: `${after}\n${lines.join('\n')}` }));
  });
}

module.exports = { LOG_EVENTS, registerLogs };

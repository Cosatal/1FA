// Moderation: Discord's native AutoMod filters (created and kept up to date by the bot), immune roles,
// warnings, temporary bans, command settings and the logs channel (see also logs.js).
const {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { createStore } = require('../../core/store');
const { logActivity } = require('../../core/activity');
const { LANGUAGES, wordsFor } = require('./insult-lists');
const { every } = require('../../core/scheduler');
const { t } = require('../../core/i18n');

// Checked languages. Older configs (a single "français" checkbox): French, unless it was unchecked
const presetLanguages = (presets) => (Array.isArray(presets.languages) ? presets.languages : presets.french === false ? [] : ['fr']).filter((id) => LANGUAGES[id]);

const store = createStore('moderation', {
  logsId: '', // logs channel: AutoMod alerts, sanctions and server events
  // Events sent to the logs (sanctions are enabled by default, the rest is in logs.js)
  logEvents: { modBan: true, modUnban: true, modMute: true, modUnmute: true, modKick: true, modWarn: true, modClear: true },
  words: { enabled: false, list: [], timeout: 0 }, // timeout in minutes (0 = no timeout)
  // Word lists provided by Discord (English only) + languages: the bot's insult lists (insult-lists.js)
  presets: { enabled: false, profanity: true, sexual: true, slurs: true, languages: ['fr'] },
  invites: { enabled: false }, // invites to other servers
  links: { enabled: false, allow: [] }, // every link, except allowed domains
  mentions: { enabled: false, limit: 5, timeout: 10 },
  spam: { enabled: false },
  exemptRoles: [], // immune roles: neither AutoMod nor the moderation commands affect them
  exemptChannels: [],
  rules: {}, // ids of the AutoMod rules managed by the bot, per filter
});

// Warnings: data/warnings.json = { <guildId>: { <userId>: [{ reason, by, at, case }] } } (case: its number, see cases.js)
const warnings = createStore('warnings', {});
// Temporary bans to lift: data/tempbans.json = { <guildId>: { list: [{ userId, until }] } }
const tempbans = createStore('tempbans', { list: [] });
// Command settings: data/commands.json = { <guildId>: { <name>: { enabled, roles, channels } } }
const commandRules = createStore('commands', {});

const T = AutoModerationRuleTriggerType;
// "french": the rule for insults in languages other than English (the key name is kept for rules already created)
const NAMES = {
  words: t('moderation.banned_words'),
  presets: t('moderation.inappropriate_language'),
  french: 'Insultes (autres langues)',
  invites: t('moderation.discord_invites'),
  links: t('moderation.links'),
  mentions: t('moderation.mass_mentions'),
  spam: 'Spam',
};
const BLOCK_MESSAGE = {
  words: t('moderation.this_message_contains_word_banned'),
  presets: t('moderation.this_message_contains_language_banned'),
  french: t('moderation.this_message_contains_insult_that'),
  invites: t('moderation.invites_other_servers_aren_allowed'),
  links: t('moderation.links_aren_allowed_this_server'),
  mentions: t('moderation.too_many_mentions_single_message'),
  spam: t('moderation.this_message_looks_like_spam'),
};

// What each filter asks Discord for (null = filter disabled)
function trigger(key, c) {
  // Insults of the checked languages, all in a single rule: enabled with "Langage inapproprié"
  if (key === 'french') {
    const words = c.presets.enabled ? wordsFor(presetLanguages(c.presets)) : [];
    return words.length ? { triggerType: T.Keyword, triggerMetadata: { keywordFilter: words } } : null;
  }
  if (!c[key].enabled) return null;
  switch (key) {
    case 'words':
      return c.words.list.length ? { triggerType: T.Keyword, triggerMetadata: { keywordFilter: c.words.list }, timeout: c.words.timeout } : null;
    case 'presets': {
      const P = AutoModerationRuleKeywordPresetType;
      const presets = [c.presets.profanity && P.Profanity, c.presets.sexual && P.SexualContent, c.presets.slurs && P.Slurs].filter(Boolean);
      return presets.length ? { triggerType: T.KeywordPreset, triggerMetadata: { presets } } : null;
    }
    case 'invites':
      return { triggerType: T.Keyword, triggerMetadata: { regexPatterns: ['(discord\\.gg|discord(app)?\\.com/invite)/[a-zA-Z0-9-]+'] } };
    case 'links':
      return {
        triggerType: T.Keyword,
        triggerMetadata: { regexPatterns: ['https?://[^\\s]+'], allowList: c.links.allow.map((d) => `*${d}*`) },
      };
    case 'mentions':
      return { triggerType: T.MentionSpam, triggerMetadata: { mentionTotalLimit: c.mentions.limit, mentionRaidProtectionEnabled: true }, timeout: c.mentions.timeout };
    case 'spam':
      return { triggerType: T.Spam, triggerMetadata: {} };
    default:
      return null;
  }
}

// These rule types exist only once per server: reuse the existing one instead of creating another
const SINGLE = [T.Spam, T.MentionSpam, T.KeywordPreset];

// Creates, updates or deletes the AutoMod rules so they match the config.
// Returns the rule ids and the errors (a refused filter doesn't prevent the others from being applied)
async function syncRules(guild, config) {
  let existing;
  try {
    existing = await guild.autoModerationRules.fetch();
  } catch {
    return { ids: config.rules, errors: [t('moderation.bot_needs_manage_server_permission')] };
  }
  const ids = {};
  const errors = [];
  for (const key of Object.keys(NAMES)) {
    const def = trigger(key, config);
    let rule = config.rules[key] && existing.get(config.rules[key]);
    if (!def) {
      if (rule) await rule.delete().catch(() => {});
      continue;
    }
    if (!rule && SINGLE.includes(def.triggerType)) rule = existing.find((r) => r.triggerType === def.triggerType);

    const actions = [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: BLOCK_MESSAGE[key] } }];
    if (config.logsId) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: config.logsId } });
    if (def.timeout > 0) actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: Math.min(def.timeout * 60, 2419200) } });

    const data = {
      name: `[Bot] ${NAMES[key]}`,
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerMetadata: def.triggerMetadata,
      actions,
      enabled: true,
      exemptRoles: config.exemptRoles,
      exemptChannels: config.exemptChannels,
    };
    try {
      rule = rule ? await rule.edit(data) : await guild.autoModerationRules.create({ ...data, triggerType: def.triggerType });
    } catch (error) {
      errors.push(`Filtre « ${NAMES[key]} » : ${error.message}`);
    }
    if (rule) ids[key] = rule.id;
  }
  return { ids, errors };
}

// ---------- Logs ----------

// Logs channel if this event is enabled in the dashboard, otherwise null. Checked before preparing the log
// (no audit log call or embed built for nothing on servers that haven't enabled this event)
function logChannel(guild, event) {
  const config = store.peek(guild.id);
  if (!config.logEvents[event]) return null;
  const channel = guild.channels.cache.get(config.logsId);
  return channel?.isTextBased() ? channel : null;
}

// Sends an embed to the logs channel. embed: the embed, or a function (possibly async) that builds it
async function sendLog(guild, event, embed) {
  const channel = logChannel(guild, event);
  if (!channel) return;
  const built = typeof embed === 'function' ? await embed() : embed;
  await channel.send({ embeds: [built], allowedMentions: { parse: [] } }).catch(() => {});
}

// Sanction done with a bot command. event: modBan, modMute… · action: "Bannissement", "Avertissement"… · caseN: its case number (cases.js)
function modLog(guild, { event, action, color = 0xed4245, target, moderator, reason, extra = [], caseN = null }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: caseN ? `${action} · ${t('cases.case_n', { n: caseN })}` : action, iconURL: target?.displayAvatarURL?.() })
    .addFields(
      ...(target ? [{ name: t('moderation.member'), value: `${target} · \`${target.id}\``, inline: true }] : []),
      ...(moderator ? [{ name: t('moderation.by'), value: `${moderator}`, inline: true }] : []),
      ...(reason ? [{ name: t('moderation.reason'), value: reason.slice(0, 1024) }] : []),
      ...extra,
    )
    .setTimestamp();
  return sendLog(guild, event, embed);
}

// ---------- Immune roles and command checks ----------

// Why this member can't be sanctioned (null if they can)
function immunity(member) {
  if (member.id === member.guild.ownerId) return t('moderation.they_re_server_owner');
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return t('moderation.they_re_administrator');
  const role = store.peek(member.guild.id).exemptRoles.find((id) => member.roles.cache.has(id));
  return role ? t('moderation.they_have_immune_role', { role }) : null;
}

// Error message if the target can't be sanctioned. canAct: (member) => the bot has the permission
function targetError(interaction, member, canAct) {
  if (!member) return null; // not (or no longer) on the server
  if (member.id === interaction.user.id) return t('moderation.can_sanction_yourself');
  const immune = immunity(member);
  if (immune) return t('moderation.not_possible', { immune });
  if (!canAct(member)) return t('moderation.can_sanction_this_member_their');
  return null;
}

// Duration written like "30m", "2h", "7j", "1h30m" → milliseconds (null if unreadable)
function parseDuration(text) {
  const units = { s: 1, m: 60, min: 60, h: 3600, j: 86400, d: 86400, sem: 604800, w: 604800 };
  const clean = text.toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+(sem|min|s|m|h|j|d|w))+$/.test(clean)) return null;
  return [...clean.matchAll(/(\d+)(sem|min|s|m|h|j|d|w)/g)].reduce((ms, [, n, unit]) => ms + n * units[unit] * 1000, 0) || null;
}

// Command disabled, or limited to some channels / roles in the dashboard: returns the message to show
function commandBlocked(interaction) {
  const rule = commandRules.peek(interaction.guildId ?? '')[interaction.commandName];
  if (!rule || !interaction.guild) return null;
  if (rule.enabled === false) return t('moderation.this_command_disabled_this_server');
  if (rule.channels?.length && !rule.channels.includes(interaction.channelId)) return t('moderation.this_command_isn_available_this');
  const { member } = interaction;
  if (rule.roles?.length && !member.permissions.has(PermissionFlagsBits.Administrator) && !rule.roles.some((id) => member.roles.cache.has(id))) {
    return t('moderation.don_have_role_needed_for');
  }
  return null;
}

// Refuses the command if it is blocked (true = already replied)
async function refuseBlocked(interaction) {
  const reason = commandBlocked(interaction);
  if (reason) await interaction.reply({ content: `⛔ ${reason}`, flags: MessageFlags.Ephemeral });
  return Boolean(reason);
}

// ---------- Temporary bans ----------

function addTempban(guildId, userId, until) {
  const { list } = tempbans.get(guildId);
  tempbans.save(guildId, { list: [...list.filter((t) => t.userId !== userId), { userId, until }] });
}

const removeTempban = (guildId, userId) => tempbans.save(guildId, { list: tempbans.get(guildId).list.filter((t) => t.userId !== userId) });

// Checks every 30 seconds for temporary bans that have ended (also works after a restart)
function startTempbanTimer(client) {
  every('tempbans-end', 30000, async () => {
    for (const guild of client.guilds.cache.values()) {
      const due = tempbans.peek(guild.id).list.filter((t) => t.until <= Date.now());
      for (const { userId } of due) {
        removeTempban(guild.id, userId);
        const user = await guild.members.unban(userId, t('moderation.temporary_ban_ended')).catch(() => null);
        if (!user) continue;
        logActivity(guild.id, { source: 'bot', action: 'tempban.ended', title: `Fin du ban temporaire de ${user.tag} : débanni automatiquement`, data: { id: user.id } });
        await modLog(guild, { event: 'modUnban', action: t('moderation.temporary_ban_ended'), color: 0x3ba55c, target: user, moderator: client.user });
      }
    }
  });
}

// ---------- Warnings ----------

function addWarning(guildId, userId, warning) {
  const all = warnings.get(guildId);
  all[userId] = [...(all[userId] ?? []), warning];
  warnings.save(guildId, all);
  return all[userId].length;
}

const getWarnings = (guildId, userId) => warnings.get(guildId)[userId] ?? [];

// Removes the warning of a case (accepted appeal)
function removeWarning(guildId, userId, caseN) {
  const all = warnings.get(guildId);
  if (!all[userId]) return;
  all[userId] = all[userId].filter((w) => w.case !== caseN);
  if (!all[userId].length) delete all[userId];
  warnings.save(guildId, all);
}

// Without userId: clears the warnings of the whole server. Returns the number cleared
function clearWarnings(guildId, userId = null) {
  const all = warnings.get(guildId);
  const count = userId ? (all[userId]?.length ?? 0) : Object.values(all).flat().length;
  if (userId) delete all[userId];
  warnings.save(guildId, userId ? all : {});
  return count;
}

// The server's latest warnings, for the dashboard
function recentWarnings(guildId, limit = 30) {
  return Object.entries(warnings.get(guildId))
    .flatMap(([userId, list]) => list.map((w) => ({ userId, ...w })))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

module.exports = {
  getModeration: store.get,
  saveModeration: store.save,
  getCommandRules: commandRules.get,
  saveCommandRules: commandRules.save,
  syncRules,
  presetLanguages,
  INSULT_LANGUAGES: Object.entries(LANGUAGES).map(([id, l]) => ({ id, name: l.name, count: l.words.length })),
  logChannel,
  sendLog,
  modLog,
  targetError,
  parseDuration,
  refuseBlocked,
  addTempban,
  removeTempban,
  startTempbanTimer,
  addWarning,
  getWarnings,
  removeWarning,
  clearWarnings,
  recentWarnings,
};

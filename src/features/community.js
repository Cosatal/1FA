const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { createStore } = require('../core/store');
const { getFeature, fillVars } = require('../core/feature-config');
const { keep } = require('../dashboard/public/i18n');
const { every } = require('../core/scheduler');
const { t } = require('../core/i18n');

// Community modules: suggestions, starboard, birthdays.

// =====================================================================
// Suggestions
// data/suggestions.json = { <guildId>: { count, list: [{ n, channelId, messageId, userId, author, avatar, text, up: [], down: [], status, reason, by }] } }
// =====================================================================

const suggestions = createStore('suggestions', { count: 0, list: [] });
const STATUS = {
  pending: { color: 0x5865f2, text: t('community.waiting_for_votes') },
  accepted: { color: 0x3ba55c, text: t('community.accepted') },
  refused: { color: 0xed4245, text: t('community.declined') },
};

function suggestionMessage(s) {
  const status = STATUS[s.status];
  const embed = new EmbedBuilder()
    .setColor(status.color)
    .setAuthor({ name: s.author, iconURL: s.avatar })
    .setDescription(s.text)
    .setFooter({ text: t('community.suggestion', { n: s.n, text: status.text }) });
  if (s.status !== 'pending') embed.addFields({ name: t('community.reply_from', { by: s.by }), value: s.reason || '—' });
  const done = s.status !== 'pending';
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sug:vote:up:${s.n}`).setStyle(ButtonStyle.Success).setEmoji('👍').setLabel(`${s.up.length}`).setDisabled(done),
      new ButtonBuilder().setCustomId(`sug:vote:down:${s.n}`).setStyle(ButtonStyle.Danger).setEmoji('👎').setLabel(`${s.down.length}`).setDisabled(done),
    ),
  ];
  if (!done) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sug:accept:${s.n}`).setStyle(ButtonStyle.Secondary).setLabel(t('community.accept_staff')),
        new ButtonBuilder().setCustomId(`sug:refuse:${s.n}`).setStyle(ButtonStyle.Secondary).setLabel(t('community.decline_staff')),
      ),
    );
  }
  return { embeds: [embed], components: rows };
}

function updateSuggestion(guildId, n, change) {
  const data = suggestions.get(guildId);
  const s = data.list.find((x) => x.n === n);
  if (!s) return null;
  change(s);
  suggestions.save(guildId, data);
  return s;
}

async function createSuggestion(interaction, text) {
  const { guild, member } = interaction;
  const config = getFeature(guild.id, 'suggestions');
  const channel = guild.channels.cache.get(config.channelId);
  if (!config.enabled || !channel) return interaction.reply({ content: t('community.suggestions_aren_enabled_this_server'), flags: MessageFlags.Ephemeral });

  const data = suggestions.get(guild.id);
  const s = {
    n: data.count + 1, channelId: channel.id, messageId: null, userId: member.id, author: member.displayName,
    avatar: member.displayAvatarURL(), text, up: [], down: [], status: 'pending', reason: '', by: '',
  };
  let message;
  try {
    message = await channel.send(suggestionMessage(s));
  } catch {
    return interaction.reply({ content: t('community.can_write_suggestions_channel'), flags: MessageFlags.Ephemeral });
  }
  s.messageId = message.id;
  // Keep the last 500
  suggestions.save(guild.id, { count: s.n, list: [...data.list, s].slice(-500) });
  if (config.thread) await message.startThread({ name: `💬 ${text.replace(/\s+/g, ' ').slice(0, 90)}`, autoArchiveDuration: 1440 }).catch(() => {});
  await interaction.reply({ content: t('community.suggestion_posted', { n: s.n, url: message.url }), flags: MessageFlags.Ephemeral });
}

async function handleSuggestion(interaction) {
  const parts = interaction.customId.split(':');
  const n = Number(parts.at(-1));
  const { guild } = interaction;

  if (parts[1] === 'vote') {
    const side = parts[2];
    const other = side === 'up' ? 'down' : 'up';
    // Voting closed: nothing is changed or saved
    const current = suggestions.peek(guild.id).list.find((x) => x.n === n);
    if (current?.status !== 'pending') return interaction.reply({ content: t('community.voting_closed'), flags: MessageFlags.Ephemeral });
    const s = updateSuggestion(guild.id, n, (x) => {
      const id = interaction.user.id;
      x[other] = x[other].filter((u) => u !== id);
      x[side] = x[side].includes(id) ? x[side].filter((u) => u !== id) : [...x[side], id];
    });
    return interaction.update(suggestionMessage(s));
  }

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ content: t('community.staff_only_manage_messages_permission'), flags: MessageFlags.Ephemeral });
  }

  // Accept / refuse button: modal for the answer
  if (parts[1] === 'accept' || parts[1] === 'refuse') {
    const modal = new ModalBuilder()
      .setCustomId(`sug:modal:${parts[1]}:${n}`)
      .setTitle(parts[1] === 'accept' ? t('community.accept_suggestion') : t('community.decline_suggestion'))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel(t('community.reply_optional')).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000),
        ),
      );
    return interaction.showModal(modal);
  }

  if (parts[1] === 'modal') {
    const status = parts[2] === 'accept' ? 'accepted' : 'refused';
    const s = updateSuggestion(guild.id, n, (x) => Object.assign(x, { status, reason: interaction.fields.getTextInputValue('reason').trim(), by: interaction.member.displayName }));
    if (!s) return interaction.reply({ content: t('community.suggestion_not_found'), flags: MessageFlags.Ephemeral });
    await interaction.update(suggestionMessage(s));
    if (getFeature(guild.id, 'suggestions').dm) {
      const verdict = status === 'accepted' ? t('community.suggestion_was_accepted', { n: s.n, name: guild.name }) : t('community.suggestion_was_refused', { n: s.n, name: guild.name });
      const text = `${verdict}${s.reason ? `\n> ${s.reason}` : ''}`;
      await interaction.client.users.send(s.userId, text).catch(() => {});
    }
  }
}

// =====================================================================
// Starboard
// data/starboard.json = { <guildId>: { posts: { <original message>: <starboard message> } } }
// =====================================================================

const starboard = createStore('starboard', { posts: {} });
const emojiKey = (text) => (/^<a?:\w+:(\d+)>$/.exec(text)?.[1] ?? text).replace(/️/g, '');
const queue = new Map(); // only one processing at a time per message

function handleStarReaction(reaction) {
  const id = reaction.message.id;
  const next = (queue.get(id) ?? Promise.resolve()).then(() => updateStar(reaction)).catch((e) => console.error('Starboard:', e.message));
  queue.set(id, next);
  next.finally(() => queue.get(id) === next && queue.delete(id));
}

async function updateStar(reaction) {
  const guild = reaction.message.guild;
  if (!guild) return;
  const config = getFeature(guild.id, 'starboard');
  if (!config.enabled || !config.channelId) return;
  if ((reaction.emoji.id ?? reaction.emoji.name?.replace(/️/g, '')) !== emojiKey(config.emoji)) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message || message.author?.bot || message.channelId === config.channelId) return;
  if (config.ignoredChannels.includes(message.channelId) || config.ignoredChannels.includes(message.channel.parentId)) return;

  const current = message.reactions.cache.find((r) => (r.emoji.id ?? r.emoji.name?.replace(/️/g, '')) === emojiKey(config.emoji));
  let count = current?.count ?? 0;
  if (count && !config.selfStar) {
    const users = await current.users.fetch().catch(() => null);
    if (users?.has(message.author.id)) count--;
  }

  const board = guild.channels.cache.get(config.channelId);
  const data = starboard.get(guild.id);
  const postId = data.posts[message.id];
  const post = postId ? await board?.messages.fetch(postId).catch(() => null) : null;

  if (count < config.threshold) {
    if (post) await post.delete().catch(() => {});
    if (postId) {
      delete data.posts[message.id];
      starboard.save(guild.id, data);
    }
    return;
  }

  const image = message.attachments.find((a) => a.contentType?.startsWith('image/'))?.url ?? message.embeds.find((e) => e.image)?.image.url;
  const embed = new EmbedBuilder()
    .setColor(0xf5a524)
    .setAuthor({ name: message.member?.displayName ?? message.author.username, iconURL: message.author.displayAvatarURL() })
    .setDescription(message.content?.slice(0, 4000) || null)
    .addFields({ name: 'Source', value: t('community.jump_message', { url: message.url }) })
    .setTimestamp(message.createdTimestamp);
  if (image) embed.setImage(image);
  const payload = { content: `${config.emoji} **${count}** · ${message.channel}`, embeds: [embed] };

  if (post) return post.edit(payload).catch(() => {});
  const sent = await board?.send(payload).catch(() => null);
  if (!sent) return;
  data.posts[message.id] = sent.id;
  // Keep the last 2000
  const entries = Object.entries(data.posts);
  if (entries.length > 2000) data.posts = Object.fromEntries(entries.slice(-2000));
  starboard.save(guild.id, data);
}

// =====================================================================
// Birthdays
// data/birthdays.json = { <guildId>: { users: { <userId>: { day, month } }, lastDay, holders: [ids that have the role of the day] } }
// =====================================================================

const birthdays = createStore('birthdays', { users: {}, lastDay: '', holders: [] });
const MONTHS = [t('community.january'), t('community.february'), t('community.march'), t('community.april'), t('community.may'), t('community.june'), t('community.july'), t('community.august'), t('community.september'), t('community.october'), t('community.november'), t('community.december')];
const formatDate = ({ day, month }) => `${day === 1 ? '1er' : day} ${MONTHS[month - 1]}`;

function validDate(day, month) {
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(2024, month, 0).getDate(); // 2024: leap year, February 29 is allowed
}

function setBirthday(guildId, userId, day, month) {
  const data = birthdays.get(guildId);
  data.users[userId] = { day, month };
  birthdays.save(guildId, data);
}
function removeBirthday(guildId, userId) {
  const data = birthdays.get(guildId);
  const had = Boolean(data.users[userId]);
  delete data.users[userId];
  birthdays.save(guildId, data);
  return had;
}
const getBirthday = (guildId, userId) => birthdays.get(guildId).users[userId] ?? null;

// Date and time in Paris (formatter created only once)
const PARIS = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });
function parisNow() {
  const parts = Object.fromEntries(PARIS.formatToParts(new Date()).map((p) => [p.type, Number(p.value)]));
  return { ...parts, key: `${parts.year}-${parts.month}-${parts.day}` };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// Days before the next birthday (0 = today)
function daysUntil({ day, month }, now = parisNow()) {
  const today = Date.UTC(now.year, now.month - 1, now.day);
  let next = Date.UTC(now.year, month - 1, day);
  if (next < today) next = Date.UTC(now.year + 1, month - 1, day);
  return Math.round((next - today) / 86400000);
}

const upcoming = (guildId, limit = 10) =>
  Object.entries(birthdays.get(guildId).users)
    .map(([userId, date]) => ({ userId, ...date, in: daysUntil(date) }))
    .sort((a, b) => a.in - b.in)
    .slice(0, limit);

function startBirthdays(client) {
  const check = async () => {
    const now = parisNow();
    for (const guild of client.guilds.cache.values()) {
      const config = getFeature(guild.id, 'birthdays');
      if (!config.enabled || now.hour < config.hour || birthdays.peek(guild.id).lastDay === now.key) continue;
      const data = birthdays.get(guild.id);

      // The role of the day is removed from yesterday's members (directly by their id: they aren't necessarily cached)
      const role = config.roleId && guild.roles.cache.get(config.roleId);
      if (role?.editable) for (const id of data.holders) await guild.members.removeRole({ user: id, role, reason: t('community.end_birthday') }).catch(() => {});

      // February 29 is celebrated on the 28th in other years
      const today = Object.entries(data.users).filter(
        ([, d]) => (d.day === now.day && d.month === now.month) || (d.day === 29 && d.month === 2 && now.month === 2 && now.day === 28 && !isLeap(now.year)),
      );
      const holders = [];
      for (const [userId] of today) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;
        holders.push(userId);
        if (role?.editable) await member.roles.add(role).catch(() => {});
        const content = keep(fillVars(config.message, { user: `${member}`, name: member.displayName, server: guild.name }), 2000); // dashboard text, as is
        await guild.channels.cache.get(config.channelId)?.send({ content, allowedMentions: { users: [userId] } }).catch(() => {});
      }
      birthdays.save(guild.id, { ...data, lastDay: now.key, holders });
    }
  };
  every('birthdays', 5 * 60000, () => check().catch((e) => console.error('Birthdays:', e.message)));
  check().catch(() => {});
}

const recentSuggestions = (guildId, limit = 10) => suggestions.get(guildId).list.slice(-limit).reverse();

module.exports = {
  createSuggestion, handleSuggestion, handleStarReaction, recentSuggestions,
  setBirthday, removeBirthday, getBirthday, upcoming, validDate, formatDate, startBirthdays,
};

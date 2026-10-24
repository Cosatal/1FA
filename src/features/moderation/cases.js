const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { createStore } = require('../../core/store');
const { getFeature } = require('../../core/feature-config');
const { logActivity } = require('../../core/activity');
const { PANEL_COLOR } = require('../../core/credits');
const { keep } = require('../../dashboard/public/i18n');
const { modLog, removeTempban, removeWarning, getWarnings } = require('./moderation');
const { t } = require('../../core/i18n');

// Cases: every sanction of the bot (/ban, /mute, /warn…, AI moderation buttons) gets a number.
// The sanctioned member gets a DM with the case, and an "Appeal" button if appeals are enabled ("Cas et appels" tab):
// the appeal goes to the staff's appeals channel, where it is accepted (the sanction is lifted) or refused.
// data/cases.json = { <guildId>: { next, list: [{ n, type, userId, userTag, modId, modTag, reason, at, until, dm, appeal }] } }
// dm = { channelId, messageId } of the DM sent to the member · appeal = { text, at, status: pending|accepted|refused, by, answer }

const MAX_CASES = 5000;
const store = createStore('cases', { next: 1, list: [] });

const ICONS = { ban: '🔨', tempban: '⏳', kick: '👢', mute: '🔇', tempmute: '🔇', warn: '⚠️', unban: '🔓', unmute: '🔊' };
const typeName = (type) => t(`cases.types.${type}`);
// Setting of the "Cas et appels" tab that allows appeals for each type of sanction
const APPEAL_SETTING = { ban: 'bans', tempban: 'bans', mute: 'mutes', tempmute: 'mutes', warn: 'warns' };
const canAppeal = (config, type) => config.enabled && Boolean(config.channelId) && config[APPEAL_SETTING[type]] === true;

// Records a sanction. user and moderator: discord.js users. until: end date of a temporary sanction
function addCase(guild, { type, user, moderator, reason, until = null }) {
  const data = store.get(guild.id);
  const entry = {
    n: data.next,
    type,
    userId: user.id,
    userTag: user.tag ?? user.username,
    modId: moderator.id,
    modTag: moderator.tag ?? moderator.username,
    reason: reason ?? '',
    at: Date.now(),
    until,
    dm: null,
    appeal: null,
  };
  data.next++;
  data.list = [...data.list, entry].slice(-MAX_CASES);
  store.save(guild.id, data);
  return entry;
}

const getCase = (guildId, n) => store.peek(guildId).list.find((c) => c.n === n) ?? null;
const userCases = (guildId, userId) => store.peek(guildId).list.filter((c) => c.userId === userId);
const recentCases = (guildId, limit = 30) => store.peek(guildId).list.slice(-limit).reverse();
const pendingAppeals = (guildId) => store.peek(guildId).list.filter((c) => c.appeal?.status === 'pending').length;

function updateCase(guildId, n, patch) {
  const data = store.get(guildId);
  const entry = data.list.find((c) => c.n === n);
  if (!entry) return null;
  Object.assign(entry, patch);
  store.save(guildId, data);
  return entry;
}

// The sanction failed (Discord refused it): its number is given back if it was the last one
function discardCase(guildId, n) {
  const data = store.get(guildId);
  if (data.list.at(-1)?.n !== n) return;
  data.list.pop();
  data.next = n;
  store.save(guildId, data);
}

// Last line of the command replies: "-# ⚖️ Cas n°12"
const caseLine = (entry) => `\n${t('cases.footer', { n: entry.n })}`;

// ---------- DM to the sanctioned member ----------

function sanctionEmbed(guild, entry) {
  const config = getFeature(guild.id, 'cases');
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(t(`cases.dm_title.${entry.type}`, { server: guild.name }))
    .addFields(
      { name: t('cases.field_case'), value: `#${entry.n}`, inline: true },
      ...(entry.until ? [{ name: t('cases.field_end'), value: `<t:${Math.floor(entry.until / 1000)}:R>`, inline: true }] : []),
      { name: t('cases.field_reason'), value: keep(entry.reason || t('cases.no_reason'), 1024) },
    )
    .setTimestamp(entry.at);
  if (guild.iconURL()) embed.setThumbnail(guild.iconURL());
  const appeal = canAppeal(config, entry.type);
  if (appeal) {
    const from = entry.at + config.delayHours * 3600000;
    embed.setDescription(from > Date.now() ? t('cases.appeal_hint_later', { time: `<t:${Math.floor(from / 1000)}:f>` }) : t('cases.appeal_hint'));
  }
  return { embed, appeal };
}

const appealButton = (guildId, n, disabled = false) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`appeal:open:${guildId}:${n}`).setLabel(t('cases.appeal_button')).setEmoji('📝').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );

// Sends the DM (before a ban or a kick: afterwards, the bot can no longer write to the member). Never fails
async function notifySanction(guild, entry, user) {
  const { embed, appeal } = sanctionEmbed(guild, entry);
  const message = await user.send({ embeds: [embed], components: appeal ? [appealButton(guild.id, entry.n)] : [] }).catch(() => null);
  if (message) updateCase(guild.id, entry.n, { dm: { channelId: message.channelId, messageId: message.id } });
  return Boolean(message);
}

// ---------- Appeals ----------

// Is the sanction still in force? (an appeal for a sanction already lifted makes no sense)
async function stillActive(guild, entry) {
  if (entry.type === 'ban' || entry.type === 'tempban') return Boolean(await guild.bans.fetch({ user: entry.userId, force: true }).catch(() => null));
  if (entry.type === 'mute' || entry.type === 'tempmute') {
    const member = await guild.members.fetch(entry.userId).catch(() => null);
    return Boolean(member?.isCommunicationDisabled());
  }
  if (entry.type === 'warn') return getWarnings(guild.id, entry.userId).some((w) => w.case === entry.n);
  return false;
}

// Why the member can't appeal this case (null if they can)
async function appealError(guild, entry, userId) {
  if (!guild) return t('cases.server_gone');
  if (!entry) return t('cases.case_not_found');
  if (entry.userId !== userId) return t('cases.not_your_case');
  const config = getFeature(guild.id, 'cases');
  if (!config.enabled || !config.channelId) return t('cases.appeals_disabled');
  if (!canAppeal(config, entry.type)) return t('cases.not_appealable');
  if (entry.appeal) return t('cases.already_appealed', { n: entry.n });
  const from = entry.at + config.delayHours * 3600000;
  if (from > Date.now()) return t('cases.appeal_too_early', { time: `<t:${Math.floor(from / 1000)}:f>` });
  if (!(await stillActive(guild, entry))) return t('cases.sanction_lifted');
  return null;
}

const decisionButtons = (n) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`appeal:accept:${n}`).setLabel(t('cases.accept')).setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`appeal:refuse:${n}`).setLabel(t('cases.refuse')).setEmoji('❌').setStyle(ButtonStyle.Danger),
  );

function appealEmbed(entry) {
  return new EmbedBuilder()
    .setColor(PANEL_COLOR)
    .setTitle(t('cases.appeal_title', { n: entry.n }))
    .addFields(
      { name: t('cases.field_member'), value: `<@${entry.userId}> · \`${entry.userTag}\``, inline: true },
      { name: t('cases.field_sanction'), value: `${ICONS[entry.type]} ${typeName(entry.type)}`, inline: true },
      { name: t('cases.field_by'), value: `<@${entry.modId}>`, inline: true },
      { name: t('cases.field_reason'), value: keep(entry.reason || t('cases.no_reason'), 1024) },
      { name: t('cases.field_date'), value: `<t:${Math.floor(entry.at / 1000)}:f>`, inline: true },
      { name: t('cases.field_appeal'), value: keep(entry.appeal.text, 1024) },
    )
    .setTimestamp(entry.appeal.at);
}

// The member's form
function appealModal(guildId, entry) {
  return new ModalBuilder()
    .setCustomId(`appeal:submit:${guildId}:${entry.n}`)
    .setTitle(t('cases.modal_title', { n: entry.n }))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel(t('cases.modal_label'))
          .setPlaceholder(t('cases.modal_placeholder'))
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(20)
          .setMaxLength(1000)
          .setRequired(true),
      ),
    );
}

// The staff's answer (optional), before accepting or refusing
function decisionModal(decision, n) {
  return new ModalBuilder()
    .setCustomId(`appeal:decide:${decision}:${n}`)
    .setTitle(t(decision === 'accept' ? 'cases.accept_title' : 'cases.refuse_title', { n }))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('answer').setLabel(t('cases.answer_label')).setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false),
      ),
    );
}

// Permission needed to handle an appeal: the one of the sanction's command
const PERMISSION = { ban: PermissionFlagsBits.BanMembers, tempban: PermissionFlagsBits.BanMembers, mute: PermissionFlagsBits.ModerateMembers, tempmute: PermissionFlagsBits.ModerateMembers, warn: PermissionFlagsBits.ModerateMembers };

// Lifts the sanction of an accepted appeal. Returns an error message, or null
async function liftSanction(guild, entry) {
  const reason = t('cases.lift_reason', { n: entry.n });
  try {
    if (entry.type === 'ban' || entry.type === 'tempban') {
      removeTempban(guild.id, entry.userId);
      await guild.members.unban(entry.userId, reason).catch((error) => {
        if (error.code !== 10026) throw error; // 10026: not banned anymore
      });
    } else if (entry.type === 'mute' || entry.type === 'tempmute') {
      const member = await guild.members.fetch(entry.userId).catch(() => null);
      if (member?.isCommunicationDisabled()) await member.timeout(null, reason);
    } else if (entry.type === 'warn') {
      removeWarning(guild.id, entry.userId, entry.n);
    }
    return null;
  } catch (error) {
    return error.message;
  }
}

// One-use invite (7 days) to come back after an accepted ban appeal, if the bot can create one
async function comebackInvite(guild) {
  const channel = guild.systemChannel ?? guild.channels.cache.find((c) => c.isTextBased() && !c.isThread() && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite));
  const invite = await channel?.createInvite({ maxUses: 1, maxAge: 7 * 86400, unique: true, reason: 'Appel accepté' }).catch(() => null);
  return invite?.url ?? null;
}

// Tells the member the decision: new DM, and their first DM loses its button
async function tellMember(guild, entry, accepted, answer, invite) {
  const user = await guild.client.users.fetch(entry.userId).catch(() => null);
  if (!user) return false;
  if (entry.dm) {
    const dm = await user.createDM().catch(() => null);
    await dm?.messages.edit(entry.dm.messageId, { components: [appealButton(guild.id, entry.n, true)] }).catch(() => {});
  }
  const lines = [t(accepted ? 'cases.member_accepted' : 'cases.member_refused', { n: entry.n, server: guild.name })];
  if (invite) lines.push(t('cases.member_comeback', { invite }));
  // The staff's answer in an embed: a text written by someone is never translated (keep), and keep only works on a whole field
  const embeds = answer ? [new EmbedBuilder().setColor(PANEL_COLOR).setAuthor({ name: t('cases.staff_answer') }).setDescription(keep(answer, 4096))] : [];
  return Boolean(await user.send({ content: lines.join('\n'), embeds }).catch(() => null));
}

async function handleAppeal(interaction) {
  const [, action, ...rest] = interaction.customId.split(':');

  // Member, in DMs: "Appeal" button, then the form
  if (action === 'open' || action === 'submit') {
    const [guildId, n] = rest;
    const guild = interaction.client.guilds.cache.get(guildId);
    const entry = guild && getCase(guild.id, Number(n));
    const error = await appealError(guild, entry, interaction.user.id);
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    if (action === 'open') return interaction.showModal(appealModal(guild.id, entry));

    const text = interaction.fields.getTextInputValue('text').trim();
    const config = getFeature(guild.id, 'cases');
    const channel = guild.channels.cache.get(config.channelId);
    if (!channel?.isTextBased()) return interaction.reply({ content: t('cases.appeals_disabled'), flags: MessageFlags.Ephemeral });
    const saved = updateCase(guild.id, entry.n, { appeal: { text, at: Date.now(), status: 'pending', by: null, answer: '' } });
    const sent = await channel
      .send({
        content: config.roleId ? `<@&${config.roleId}>` : undefined,
        embeds: [appealEmbed(saved)],
        components: [decisionButtons(entry.n)],
        allowedMentions: { roles: config.roleId ? [config.roleId] : [] },
      })
      .catch(() => null);
    if (!sent) {
      updateCase(guild.id, entry.n, { appeal: null });
      return interaction.reply({ content: t('cases.appeal_not_sent'), flags: MessageFlags.Ephemeral });
    }
    logActivity(guild.id, { source: 'discord', action: 'case.appeal', title: `${entry.userTag} a fait appel du cas n°${entry.n}`, author: interaction.user, data: { appel: text } });
    await interaction.reply({ content: t('cases.appeal_sent', { server: guild.name }) });
    // The button of the DM can't be used twice
    await interaction.message?.edit({ components: [appealButton(guild.id, entry.n, true)] }).catch(() => {});
    return;
  }

  // Staff, in the appeals channel: "Accept" / "Refuse" buttons, then the optional answer
  if (!interaction.inCachedGuild()) return;
  const decision = action === 'decide' ? rest[0] : action;
  const n = Number(action === 'decide' ? rest[1] : rest[0]);
  const entry = getCase(interaction.guild.id, n);
  if (!entry?.appeal) return interaction.reply({ content: t('cases.case_not_found'), flags: MessageFlags.Ephemeral });
  if (entry.appeal.status !== 'pending') return interaction.reply({ content: t('cases.already_handled'), flags: MessageFlags.Ephemeral });
  if (!interaction.memberPermissions.has(PERMISSION[entry.type])) return interaction.reply({ content: t('cases.no_permission'), flags: MessageFlags.Ephemeral });
  if (action !== 'decide') return interaction.showModal(decisionModal(decision, n));

  await interaction.deferUpdate();
  const accepted = decision === 'accept';
  const answer = interaction.fields.getTextInputValue('answer').trim();
  const liftError = accepted ? await liftSanction(interaction.guild, entry) : null;
  const done = updateCase(interaction.guild.id, n, { appeal: { ...entry.appeal, status: accepted ? 'accepted' : 'refused', by: interaction.user.id, answer } });
  const invite = accepted && !liftError && (entry.type === 'ban' || entry.type === 'tempban') ? await comebackInvite(interaction.guild) : null;
  const told = await tellMember(interaction.guild, done, accepted, answer, invite);

  const decisionText = [
    t(accepted ? 'cases.decision_accepted' : 'cases.decision_refused', { mod: `${interaction.user}` }),
    ...(liftError ? [t('cases.lift_failed', { error: liftError.slice(0, 300) })] : []),
    told ? t('cases.member_notified') : t('cases.member_not_notified'),
  ].join('\n');
  const embed = EmbedBuilder.from(interaction.message.embeds[0]).addFields(
    { name: t('cases.field_decision'), value: decisionText },
    ...(answer ? [{ name: t('cases.staff_answer'), value: keep(answer, 1024) }] : []),
  );
  await interaction.message.edit({ embeds: [embed], components: [] }).catch(() => {});

  logActivity(interaction.guild.id, {
    source: 'discord',
    action: accepted ? 'case.appeal.accepted' : 'case.appeal.refused',
    title: `${interaction.member.displayName} a ${accepted ? 'accepté' : 'refusé'} l’appel du cas n°${n} (${entry.userTag})`,
    author: interaction.member,
    data: answer ? { réponse: answer } : null,
  });
  if (accepted) {
    const event = entry.type.endsWith('ban') ? 'modUnban' : entry.type === 'warn' ? 'modWarn' : 'modUnmute';
    const target = await interaction.client.users.fetch(entry.userId).catch(() => null);
    await modLog(interaction.guild, { event, action: t('cases.appeal_accepted_log', { n }), color: 0x3ba55c, target, moderator: interaction.user, reason: answer || null });
  }
}

// ---------- Display ----------

// A case as an embed field: "🔨 Cas n°12 · Bannissement" / date, moderator, reason, appeal
const caseField = (entry) => ({
  name: t('cases.summary_title', { icon: ICONS[entry.type], n: entry.n, type: typeName(entry.type) }),
  value: keep(
    [
      `<t:${Math.floor(entry.at / 1000)}:f> · <@${entry.modId}>`,
      `> ${(entry.reason || '—').slice(0, 300)}`,
      ...(entry.appeal ? [`📝 ${{ pending: '🕓', accepted: '✅', refused: '❌' }[entry.appeal.status]}`] : []),
    ].join('\n'),
    1024,
  ),
});

module.exports = {
  ICONS,
  typeName,
  addCase,
  getCase,
  userCases,
  recentCases,
  pendingAppeals,
  discardCase,
  caseLine,
  caseField,
  notifySanction,
  handleAppeal,
};

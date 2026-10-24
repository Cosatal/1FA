const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const welcomeStore = require('./welcome-store');
const { giveRoles } = require('./welcome-card');
const { PANEL_COLOR } = require('../../core/credits');
const { logActivity } = require('../../core/activity');
const { t } = require('../../core/i18n');

// Verification captcha: a message with a button in the chosen channel. The member reads a code drawn in an image,
// then picks it among 5 propositions or types it, depending on the security level; if they succeed, they get
// the access role (and the welcome's automatic roles). Settings: dashboard → Captcha (stored in welcome.json → captcha).
// The server must be set up so that only members with this role see the other channels.

const BASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: too easy to confuse
const SYMBOLS = '#@%&+=?!';
// Security levels: code length, characters used and how the member answers (choice in a menu, or typed)
const LEVELS = {
  permissive: { length: 5, chars: BASE, mode: 'choice' },
  standard: { length: 5, chars: BASE, mode: 'type' },
  aggressive: { length: 6, chars: BASE + SYMBOLS, mode: 'type' },
  maximum: { length: 8, chars: BASE + SYMBOLS, mode: 'type' },
};
Object.setPrototypeOf(LEVELS, null);
// Settings of a server, with the defaults for the ones saved before they existed
const DEFAULTS = { enabled: false, channelId: '', roleId: '', messageId: '', level: 'standard', maxFails: 3, kick: false, cooldown: 3, ttl: 300 };
const captchaConfig = (guildId) => ({ ...DEFAULTS, ...welcomeStore.peek(guildId).captcha });

const pending = new Map(); // <guildId>:<userId> → { code, expires, retryAt }
const fails = new Map(); // <guildId>:<userId> → { count, at } (kept across new codes, forgotten after 1 hour)

const rand = (min, max) => min + Math.random() * (max - min);
const newCode = ({ length, chars }) => Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

// The code drawn crooked on a noisy background (lines and dots)
function captchaImage(code) {
  const width = 70 + code.length * 55;
  const canvas = createCanvas(width, 120);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e1f24';
  ctx.fillRect(0, 0, width, 120);
  for (let i = 0; i < 6 + code.length; i++) {
    ctx.strokeStyle = `hsla(${rand(0, 360)}, 60%, 55%, 0.7)`;
    ctx.lineWidth = rand(1, 3);
    ctx.beginPath();
    ctx.moveTo(rand(0, width), rand(0, 120));
    ctx.bezierCurveTo(rand(0, width), rand(0, 120), rand(0, width), rand(0, 120), rand(0, width), rand(0, 120));
    ctx.stroke();
  }
  [...code].forEach((char, i) => {
    ctx.save();
    ctx.translate(62 + i * 55, 64 + rand(-12, 12));
    ctx.rotate(rand(-0.45, 0.45));
    ctx.font = `bold ${Math.round(rand(42, 54))}px sans-serif`;
    ctx.fillStyle = `hsl(${rand(0, 360)}, 75%, 72%)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, 0, 0);
    ctx.restore();
  });
  for (let i = 0; i < 120 * code.length; i++) {
    ctx.fillStyle = `hsla(${rand(0, 360)}, 50%, 70%, 0.5)`;
    ctx.fillRect(rand(0, width), rand(0, 120), 2, 2);
  }
  return canvas.encode('png');
}

// Posts the verification message, or updates the one already posted in the same channel. Returns the message id
async function publishCaptcha(guild, captcha) {
  const channel = guild.channels.cache.get(captcha.channelId);
  if (!channel?.isTextBased()) throw new Error(t('captcha.verification_channel_not_found'));
  const choice = LEVELS[captcha.level]?.mode === 'choice';
  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(PANEL_COLOR)
        .setTitle(t('captcha.verification'))
        .setDescription(choice
          ? t('captcha.access_server_prove_re_human')
          : t('captcha.access_server_prove_re_human_2'))
        .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined }),
    ],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cap:start').setStyle(ButtonStyle.Success).setLabel(t('captcha.not_robot')).setEmoji('✅'))],
  };
  const old = captcha.messageId ? await channel.messages.fetch(captcha.messageId).catch(() => null) : null;
  try {
    return (old ? await old.edit(payload) : await channel.send(payload)).id;
  } catch (error) {
    throw new Error(t('captcha.couldn_send_captcha_make_sure', { message: error.message }));
  }
}

const answerRow = () =>
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cap:answer').setStyle(ButtonStyle.Primary).setLabel(t('captcha.enter_code')).setEmoji('⌨️'));
const retryRow = () =>
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cap:start').setStyle(ButtonStyle.Secondary).setLabel(t('captcha.new_code')).setEmoji('🔄'));

// Choice mode: the code and 4 decoys of the same shape, in a random order
function choiceRow(code, level) {
  const options = new Set([code]);
  while (options.size < 5) options.add(newCode(level));
  const shuffled = [...options].sort(() => Math.random() - 0.5);
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('cap:pick').setPlaceholder(t('captcha.pick_code_from_image')).addOptions(shuffled.map((c) => ({ label: c, value: c }))),
  );
}

// A new code for the member: image + the way to answer (menu or button)
async function sendChallenge(interaction, key, config, intro = '') {
  const level = LEVELS[config.level] ?? LEVELS.standard;
  const code = newCode(level);
  pending.set(key, { code, expires: Date.now() + config.ttl * 1000, retryAt: 0 });
  const image = new AttachmentBuilder(await captchaImage(code), { name: 'captcha.png' });
  const minutes = Math.round(config.ttl / 60);
  const delay = config.ttl < 120 ? t('captcha.seconds', { ttl: config.ttl }) : `${minutes} minutes`;
  const content = `${intro}${level.mode === 'choice'
    ? t('captcha.pick_code_shown_image_from', { delay })
    : t('captcha.type_code_below_upper_lower', { delay })}`;
  const payload = { content, files: [image], components: [level.mode === 'choice' ? choiceRow(code, level) : answerRow()], flags: MessageFlags.Ephemeral };
  return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
}

// "Je ne suis pas un robot" / "Nouveau code" buttons, "Saisir le code" button, input modal and choice menu
async function handleCaptcha(interaction) {
  const { guild, member, customId } = interaction;
  const config = captchaConfig(guild.id);
  const key = `${guild.id}:${member.id}`;
  const ephemeral = (content, extra = {}) => interaction.reply({ content, flags: MessageFlags.Ephemeral, ...extra });

  if (!config.enabled) return ephemeral(t('captcha.verification_disabled_this_server'));
  if (member.roles.cache.has(config.roleId)) return ephemeral(t('captcha.re_already_verified'));

  // Forget abandoned codes and old failures
  for (const [k, v] of pending) if (v.expires < Date.now() - 3600000) pending.delete(k);
  for (const [k, v] of fails) if (v.at < Date.now() - 3600000) fails.delete(k);

  // Cooldown after a wrong answer: no new attempt (nor new code) before the end of the delay
  const entry = pending.get(key);
  const wait = entry?.retryAt > Date.now() ? Math.ceil((entry.retryAt - Date.now()) / 1000) : 0;
  if (wait) return ephemeral(t('captcha.wait_before_trying_again', { wait, v1: wait > 1 ? 's' : '' }));

  if (customId === 'cap:start') return sendChallenge(interaction, key, config);

  // Code expired: refused, a new captcha is generated right away
  if (!entry || entry.expires < Date.now()) return sendChallenge(interaction, key, config, t('captcha.code_expired_new_one'));

  if (customId === 'cap:answer') {
    const { length } = LEVELS[config.level] ?? LEVELS.standard;
    const input = new TextInputBuilder().setCustomId('code').setLabel(t('captcha.code_image')).setStyle(TextInputStyle.Short).setMinLength(length).setMaxLength(length).setRequired(true);
    return interaction.showModal(new ModalBuilder().setCustomId('cap:modal').setTitle(t('captcha.verification_2')).addComponents(new ActionRowBuilder().addComponents(input)));
  }

  // cap:modal (typed code) or cap:pick (code chosen in the menu)
  const answer = customId === 'cap:pick' ? interaction.values[0] : interaction.fields.getTextInputValue('code').trim().toUpperCase();
  if (answer === entry.code) {
    pending.delete(key);
    fails.delete(key);
    const role = guild.roles.cache.get(config.roleId);
    const given = role?.editable && (await member.roles.add(role, t('captcha.captcha_passed')).then(() => true, () => false));
    if (!given) return ephemeral(t('captcha.can_give_access_role_let'));
    const { autoroles } = welcomeStore.peek(guild.id);
    if (autoroles.enabled) await giveRoles(member, autoroles.roles, t('captcha.auto_roles'));
    logActivity(guild.id, { source: 'bot', action: 'captcha.passed', title: `${member.displayName} a réussi le captcha`, author: member });
    return ephemeral(t('captcha.verified_welcome_server'));
  }

  // Wrong answer: one more failure, and a delay before the next attempt
  const failed = { count: (fails.get(key)?.count ?? 0) + 1, at: Date.now() };
  fails.set(key, failed);
  entry.retryAt = Date.now() + config.cooldown * 1000;
  const choice = customId === 'cap:pick';
  if (failed.count >= config.maxFails) {
    fails.delete(key);
    // The code can't be used anymore, but the delay before a new one still applies
    pending.set(key, { ...entry, expires: 0 });
    if (config.kick && member.kickable) {
      await ephemeral(t('captcha.too_many_mistakes_re_going')).catch(() => {});
      await member.kick(t('captcha.captcha_too_many_failures')).catch(() => {});
      logActivity(guild.id, { source: 'bot', action: 'captcha.kicked', title: `${member.displayName} a été expulsé après ${failed.count} échecs au captcha`, author: member });
      return;
    }
    return ephemeral(t('captcha.too_many_mistakes_click_new'), { components: [retryRow()] });
  }
  const left = config.maxFails - failed.count;
  const tries = t('captcha.attempts_left', { left, v1: left > 1 ? 's' : '' });
  // In choice mode, a wrong pick removes a decoy: a new code is needed
  if (choice) {
    pending.set(key, { ...entry, expires: 0 });
    return ephemeral(t('captcha.wrong_code_click_new_code', { tries, cooldown: config.cooldown }), { components: [retryRow()] });
  }
  return ephemeral(t('captcha.wrong_code_can_try_again', { tries, cooldown: config.cooldown }), { components: [answerRow()] });
}

module.exports = { publishCaptcha, handleCaptcha, captchaConfig, CAPTCHA_LEVELS: Object.keys(LEVELS), CAPTCHA_DEFAULTS: DEFAULTS };

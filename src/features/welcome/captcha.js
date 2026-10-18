const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const welcomeStore = require('./welcome-store');
const { giveRoles } = require('./welcome-card');

// Verification captcha: a message with a button in the chosen channel. The member copies a code drawn
// in an image; if they succeed, they get the access role (and the welcome's automatic roles).
// The server must be set up so that only members with this role see the other channels.

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: too easy to confuse
const LENGTH = 5;
const TTL = 5 * 60 * 1000;
const pending = new Map(); // <guildId>:<userId> → { code, expires, tries }

const rand = (min, max) => min + Math.random() * (max - min);

// The code drawn crooked on a noisy background (lines and dots)
function captchaImage(code) {
  const canvas = createCanvas(340, 120);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1e1f24';
  ctx.fillRect(0, 0, 340, 120);
  for (let i = 0; i < 10; i++) {
    ctx.strokeStyle = `hsla(${rand(0, 360)}, 60%, 55%, 0.7)`;
    ctx.lineWidth = rand(1, 3);
    ctx.beginPath();
    ctx.moveTo(rand(0, 340), rand(0, 120));
    ctx.bezierCurveTo(rand(0, 340), rand(0, 120), rand(0, 340), rand(0, 120), rand(0, 340), rand(0, 120));
    ctx.stroke();
  }
  [...code].forEach((char, i) => {
    ctx.save();
    ctx.translate(45 + i * 62, 64 + rand(-12, 12));
    ctx.rotate(rand(-0.45, 0.45));
    ctx.font = `bold ${Math.round(rand(42, 54))}px sans-serif`;
    ctx.fillStyle = `hsl(${rand(0, 360)}, 75%, 72%)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(char, 0, 0);
    ctx.restore();
  });
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `hsla(${rand(0, 360)}, 50%, 70%, 0.5)`;
    ctx.fillRect(rand(0, 340), rand(0, 120), 2, 2);
  }
  return canvas.encode('png');
}

// Posts the verification message, or updates the one already posted in the same channel. Returns the message id
async function publishCaptcha(guild, captcha) {
  const channel = guild.channels.cache.get(captcha.channelId);
  if (!channel?.isTextBased()) throw new Error('Salon de vérification introuvable.');
  const payload = {
    embeds: [
      new EmbedBuilder()
        .setColor(0x2f7ff0)
        .setTitle('🛡️ Vérification')
        .setDescription('Pour accéder au serveur, prouve que tu es humain : clique sur le bouton ci-dessous et recopie le code affiché.')
        .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined }),
    ],
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cap:start').setStyle(ButtonStyle.Success).setLabel('Je ne suis pas un robot').setEmoji('✅'))],
  };
  const old = captcha.messageId ? await channel.messages.fetch(captcha.messageId).catch(() => null) : null;
  try {
    return (old ? await old.edit(payload) : await channel.send(payload)).id;
  } catch (error) {
    throw new Error(`Envoi du captcha impossible : ${error.message}. Vérifie que le bot peut écrire dans ce salon.`);
  }
}

const answerRow = () =>
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cap:answer').setStyle(ButtonStyle.Primary).setLabel('Saisir le code').setEmoji('⌨️'));

// "Je ne suis pas un robot" button, "Saisir le code" button and input modal
async function handleCaptcha(interaction) {
  const { guild, member, customId } = interaction;
  const config = welcomeStore.get(guild.id);
  const key = `${guild.id}:${member.id}`;
  const ephemeral = (content, extra = {}) => interaction.reply({ content, flags: MessageFlags.Ephemeral, ...extra });

  if (!config.captcha.enabled) return ephemeral('La vérification est désactivée sur ce serveur.');
  if (member.roles.cache.has(config.captcha.roleId)) return ephemeral('✅ Tu es déjà vérifié.');

  if (customId === 'cap:start') {
    // Forget abandoned codes
    for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
    const code = Array.from({ length: LENGTH }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
    pending.set(key, { code, expires: Date.now() + TTL, tries: 0 });
    const image = new AttachmentBuilder(await captchaImage(code), { name: 'captcha.png' });
    return ephemeral('Recopie le code ci-dessous (majuscules et minuscules acceptées), tu as 5 minutes :', { files: [image], components: [answerRow()] });
  }

  const entry = pending.get(key);
  if (!entry || entry.expires < Date.now()) {
    pending.delete(key);
    return ephemeral('⌛ Code expiré : clique à nouveau sur « Je ne suis pas un robot ».');
  }

  if (customId === 'cap:answer') {
    const input = new TextInputBuilder().setCustomId('code').setLabel('Le code de l’image').setStyle(TextInputStyle.Short).setMinLength(LENGTH).setMaxLength(LENGTH).setRequired(true);
    return interaction.showModal(new ModalBuilder().setCustomId('cap:modal').setTitle('Vérification').addComponents(new ActionRowBuilder().addComponents(input)));
  }

  // cap:modal: checks the typed code
  if (interaction.fields.getTextInputValue('code').trim().toUpperCase() === entry.code) {
    pending.delete(key);
    const role = guild.roles.cache.get(config.captcha.roleId);
    const given = role?.editable && (await member.roles.add(role, 'Captcha réussi').then(() => true, () => false));
    if (!given) return ephemeral('❌ Je ne peux pas te donner le rôle d’accès. Préviens un membre du staff.');
    if (config.autoroles.enabled) await giveRoles(member, config.autoroles.roles, 'Rôles automatiques');
    return ephemeral('✅ Vérification réussie, bienvenue sur le serveur !');
  }
  entry.tries += 1;
  if (entry.tries >= 3) {
    pending.delete(key);
    return ephemeral('❌ Trop d’erreurs : clique à nouveau sur « Je ne suis pas un robot » pour avoir un nouveau code.');
  }
  return ephemeral(`❌ Mauvais code, réessaie (${3 - entry.tries} essai${3 - entry.tries > 1 ? 's' : ''} restant${3 - entry.tries > 1 ? 's' : ''}).`, { components: [answerRow()] });
}

module.exports = { publishCaptcha, handleCaptcha };

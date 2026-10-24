// Welcome and goodbye: message sent when a member joins and leaves, DM, automatic roles
// and welcome image. The image is drawn by dashboard/public/card-renderer.js, the same code as the dashboard preview.
// Settings: welcome-store.js (data/welcome.json) · custom banners: data/banners/
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const welcomeStore = require('./welcome-store');
const { DATA_DIR } = require('../../core/store');
const { registerAll } = require('../../core/fonts');
const { W, H, drawCard, fillVars } = require('../../dashboard/public/card-renderer');
const { keep } = require('../../dashboard/public/i18n');
const { defaultsFor } = require('../../core/language');
const { t } = require('../../core/i18n');

registerAll();

const BANNERS_DIR = path.join(DATA_DIR, 'banners');

const bannerFile = (guildId) => path.join(BANNERS_DIR, `${guildId}.img`);

// Server's custom banner, otherwise none (plain background)
function bannerPath(guildId, config) {
  return config.banner === 'custom' && fs.existsSync(bannerFile(guildId)) ? bannerFile(guildId) : null;
}

// Already decoded banners, so the image isn't reread on every join (reloaded if the file changes)
const banners = new Map(); // path → { mtime, image }
async function loadBanner(file) {
  const { mtimeMs } = fs.statSync(file);
  const cached = banners.get(file);
  if (cached?.mtime === mtimeMs) return cached.image;
  const image = await loadImage(file);
  banners.set(file, { mtime: mtimeMs, image });
  return image;
}

async function fetchImage(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null; // avatar unavailable: a colored circle is drawn instead
  }
}

// Generates a server's card with its config (used by the bot and by the dashboard's "final render")
async function renderForGuild(guild, config, { avatarUrl, name }) {
  const canvas = createCanvas(W, H);
  const file = bannerPath(guild.id, config);
  const [banner, avatar] = await Promise.all([file ? loadBanner(file) : null, fetchImage(avatarUrl)]);
  drawCard(canvas.getContext('2d'), config, { banner, avatar }, { user: name, name, server: guild.name, count: guild.memberCount }, defaultsFor(guild));
  return canvas.encode('jpeg', 90);
}

const varsOf = (member) => ({ user: `${member}`, name: member.displayName, server: member.guild.name, count: member.guild.memberCount });

// The welcome message, by format: simple message (text + image if enabled), embed (image inside) or canvas (the image alone,
// with an optional text above)
async function buildWelcomeMessage(member) {
  const { guild } = member;
  const config = welcomeStore.get(guild.id);
  // Texts written in the dashboard: sent as is, never translated (keep). max = Discord's limit for the field
  const fill = (text, max) => keep(fillVars(text, varsOf(member)), max);
  const files = [];
  if (config.card || config.format === 'canvas') {
    const card = await renderForGuild(guild, config, { avatarUrl: member.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }), name: member.displayName });
    files.push(new AttachmentBuilder(card, { name: 'bienvenue.jpg' }));
  }
  const content = config.message ? fill(config.message, 2000) : undefined;
  if (config.format !== 'embed') return { content, files };

  const e = config.embed;
  const embed = new EmbedBuilder().setColor(parseInt(e.color.slice(1), 16));
  if (e.author) embed.setAuthor({ name: fill(e.author, 256), iconURL: guild.iconURL() ?? undefined });
  if (e.title) embed.setTitle(fill(e.title, 256));
  if (e.description) embed.setDescription(fill(e.description, 4096));
  if (e.fields.length) embed.addFields(e.fields.map((f) => ({ name: fill(f.name, 256), value: fill(f.value, 1024), inline: f.inline })));
  if (e.thumbnail) embed.setThumbnail(member.displayAvatarURL({ size: 256 }));
  if (e.footer) embed.setFooter({ text: fill(e.footer, 2048) });
  if (config.card) embed.setImage('attachment://bienvenue.jpg');
  return { content, embeds: [embed], files };
}

// A member joins: welcome message, DM and automatic roles (after the captcha if enabled)
async function handleMemberJoin(member) {
  if (member.user.bot) return;
  const config = welcomeStore.get(member.guild.id);

  if (config.enabled) {
    const channel = config.channelId ? member.guild.channels.cache.get(config.channelId) : member.guild.systemChannel;
    await channel?.send(await buildWelcomeMessage(member)).catch((error) => console.error('Unable to send the welcome message:', error.message));
  }
  // DMs may be closed: the error is ignored
  if (config.dm.enabled) await member.send(keep(fillVars(config.dm.message, varsOf(member)), 2000)).catch(() => {});
  if (config.autoroles.enabled && !config.captcha.enabled) await giveRoles(member, config.autoroles.roles, t('welcome.auto_roles'));
}

// A member leaves: goodbye message
async function handleMemberLeave(member) {
  const { goodbye } = welcomeStore.get(member.guild.id);
  if (!goodbye.enabled || member.user?.bot) return;
  const channel = member.guild.channels.cache.get(goodbye.channelId);
  const vars = { user: member.user ? `**${member.user.username}**` : t('welcome.member'), name: member.displayName ?? member.user?.username ?? t('welcome.member'), server: member.guild.name, count: member.guild.memberCount };
  await channel?.send({ content: keep(fillVars(goodbye.message, vars), 2000), allowedMentions: { parse: [] } }).catch((error) => console.error('Unable to send the goodbye message:', error.message));
}

// Gives the roles the bot is allowed to give (the others are ignored)
async function giveRoles(member, roleIds, reason) {
  const roles = roleIds.filter((id) => member.guild.roles.cache.get(id)?.editable);
  if (roles.length) await member.roles.add(roles, reason).catch((error) => console.error(`${reason} :`, error.message));
}

module.exports = { renderForGuild, buildWelcomeMessage, handleMemberJoin, handleMemberLeave, giveRoles, fetchImage, bannerFile, BANNERS_DIR };

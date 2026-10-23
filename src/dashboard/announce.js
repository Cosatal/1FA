const { ButtonStyle, ComponentType, EmbedBuilder, MessageFlags, SeparatorSpacingSize, SnowflakeUtil } = require('discord.js');
const { createStore } = require('../core/store');
const { logActivity } = require('../core/activity');
const { HEX, str, isUrl, isText } = require('./util');
const { keep } = require('./public/i18n');

// Dashboard announcements: validation, building the message (plain, embed or Components V2), sending right away
// or at a chosen date. Scheduled announcements: data/scheduled-announces.json = { <guildId>: { list: [{ id, at, value, by }] } }

const scheduled = createStore('scheduled-announces', { list: [] });
const MAX_SCHEDULED = 25;

// Blocks of a Components V2 announcement: validation (returns an error message or the cleaned block) and conversion for Discord
const V2_BLOCKS = {
  text: {
    parse: (b) => (str(b.content) ? { content: str(b.content) } : 'le texte est vide.'),
    build: (b) => ({ type: ComponentType.TextDisplay, content: b.content }),
    count: () => 1,
  },
  section: {
    parse: (b) => {
      if (!str(b.content)) return 'le texte est vide.';
      if (!isUrl(str(b.thumbnail))) return 'le lien de la miniature doit commencer par https://';
      return { content: str(b.content), thumbnail: str(b.thumbnail) };
    },
    build: (b) => ({
      type: ComponentType.Section,
      components: [{ type: ComponentType.TextDisplay, content: b.content }],
      accessory: { type: ComponentType.Thumbnail, media: { url: b.thumbnail } },
    }),
    count: () => 3,
  },
  gallery: {
    parse: (b) => {
      const urls = (Array.isArray(b.urls) ? b.urls : []).map(str).filter(Boolean);
      if (!urls.length || urls.length > 10) return 'mets entre 1 et 10 images.';
      if (!urls.every(isUrl)) return 'chaque lien d’image doit commencer par https://';
      return { urls };
    },
    build: (b) => ({ type: ComponentType.MediaGallery, items: b.urls.map((url) => ({ media: { url } })) }),
    count: () => 1,
  },
  separator: {
    parse: (b) => ({ divider: b.divider !== false, spacing: b.spacing === 'large' ? 'large' : 'small' }),
    build: (b) => ({
      type: ComponentType.Separator,
      divider: b.divider,
      spacing: b.spacing === 'large' ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small,
    }),
    count: () => 1,
  },
  buttons: {
    parse: (b) => {
      if (!Array.isArray(b.buttons) || !b.buttons.length || b.buttons.length > 5) return 'mets entre 1 et 5 boutons.';
      const buttons = b.buttons.map((x) => ({ label: str(x?.label), url: str(x?.url) }));
      if (buttons.some((x) => !x.label || x.label.length > 80)) return 'le nom d’un bouton doit faire entre 1 et 80 caractères.';
      if (!buttons.every((x) => isUrl(x.url))) return 'le lien d’un bouton doit commencer par https://';
      return { buttons };
    },
    build: (b) => ({
      type: ComponentType.ActionRow,
      components: b.buttons.map((x) => ({ type: ComponentType.Button, style: ButtonStyle.Link, label: x.label, url: x.url })),
    }),
    count: (b) => 1 + b.buttons.length,
  },
};

// Prototype-less table: a block of type "constructor" is refused as an unknown type
Object.setPrototypeOf(V2_BLOCKS, null);

function parseV2(body) {
  const color = str(body?.color);
  if (color && !HEX.test(color)) return { error: 'Couleur du cadre invalide (format #9b4dff).' };
  if (!Array.isArray(body?.blocks) || !body.blocks.length) return { error: 'Ajoute au moins un bloc.' };
  if (body.blocks.length > 30) return { error: '30 blocs maximum.' };

  const blocks = [];
  for (const [i, b] of body.blocks.entries()) {
    const def = V2_BLOCKS[b?.type];
    if (!def) return { error: `Bloc ${i + 1} : type inconnu.` };
    const result = def.parse(b);
    if (typeof result === 'string') return { error: `Bloc ${i + 1} : ${result}` };
    blocks.push({ type: b.type, ...result });
  }
  return { value: { color, blocks } };
}

function parseAnnounce(body, guild) {
  const channelId = str(body.channelId);
  const mention = str(body.mention);
  const content = str(body.content);
  if (!isText(guild, channelId)) return { error: 'Choisis un salon texte.' };
  if (mention && !['everyone', 'here'].includes(mention) && !guild.roles.cache.has(mention)) return { error: 'Rôle à mentionner introuvable.' };
  if (content.length > 1900) return { error: 'Le texte du message fait 1900 caractères max.' };

  if (body.mode === 'v2') {
    const parsed = parseV2(body.v2);
    if (parsed.error) return parsed;
    const v2 = parsed.value;
    // Discord limits: 40 components and 4000 characters of text for the whole message
    const count = 2 + v2.blocks.reduce((n, b) => n + V2_BLOCKS[b.type].count(b), 0);
    if (count > 40) return { error: `Annonce trop chargée (${count}/40 éléments) : retire quelques blocs ou boutons.` };
    const chars = content.length + v2.blocks.reduce((n, b) => n + (b.content?.length ?? 0), 0);
    if (chars > 4000) return { error: `Trop de texte (${chars}/4000 caractères pour toute l’annonce).` };
    return { value: { channelId, mention, content, embed: null, v2 } };
  }

  let embed = null;
  if (body.embed?.enabled === true) {
    const title = str(body.embed.title);
    const description = str(body.embed.description);
    const color = str(body.embed.color);
    const image = str(body.embed.image);
    if (title.length > 256) return { error: 'Le titre fait 256 caractères max.' };
    if (description.length > 4000) return { error: 'La description fait 4000 caractères max.' };
    if (!title && !description && !image) return { error: 'L’embed est vide : ajoute un titre, une description ou une image.' };
    if (!HEX.test(color)) return { error: 'Couleur invalide (format #9b4dff).' };
    if (image && !isUrl(image)) return { error: 'Le lien de l’image doit commencer par https://' };
    embed = { title, description, color, image, footer: body.embed.footer === true };
  }
  if (!content && !embed && !mention) return { error: 'L’annonce est vide.' };

  return { value: { channelId, mention, content, embed, v2: null } };
}

// The Discord message of an already validated announcement. All the text comes from the dashboard: sent as is, never translated
// (the KEEP marker at the start of the content protects the whole message; without content, each text is marked)
function buildAnnounce(guild, { mention, content, embed, v2 }) {
  // @everyone, @here and non-mentionable roles only ping if the bot has "Mention @everyone"
  const ping = mention === 'everyone' ? '@everyone' : mention === 'here' ? '@here' : mention ? `<@&${mention}>` : '';
  const top = [ping, content].filter(Boolean).join('\n');
  if (v2) v2 = { ...v2, blocks: v2.blocks.map((b) => (b.content ? { ...b, content: keep(b.content, 4000) } : b.buttons ? { ...b, buttons: b.buttons.map((x) => ({ ...x, label: keep(x.label, 80) })) } : b)) };
  if (embed) embed = { ...embed, title: keep(embed.title, 256), description: keep(embed.description, 4096) };
  const message = {
    allowedMentions: { parse: mention === 'everyone' || mention === 'here' ? ['everyone'] : [], roles: /^\d+$/.test(mention) ? [mention] : [] },
  };
  if (v2) {
    // Components V2: no content or embed, the mention and the text go in a text block above the container
    message.flags = MessageFlags.IsComponentsV2;
    message.components = [
      ...(top ? [{ type: ComponentType.TextDisplay, content: keep(top, 4000) }] : []),
      {
        type: ComponentType.Container,
        ...(v2.color && { accent_color: parseInt(v2.color.slice(1), 16) }),
        components: v2.blocks.map((b) => V2_BLOCKS[b.type].build(b)),
      },
    ];
    return message;
  }
  message.content = top ? keep(top, 2000) : undefined;
  if (embed) {
    const e = new EmbedBuilder().setColor(parseInt(embed.color.slice(1), 16));
    if (embed.title) e.setTitle(embed.title);
    if (embed.description) e.setDescription(embed.description);
    if (embed.image) e.setImage(embed.image);
    if (embed.footer) e.setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined }).setTimestamp();
    message.embeds = [e];
  }
  return message;
}

async function sendAnnounce(guild, value) {
  const channel = guild.channels.cache.get(value.channelId);
  if (!channel?.isTextBased()) throw new Error('le salon n’existe plus');
  return channel.send(buildAnnounce(guild, value));
}

// ---------- Dashboard routes ----------

function announceRoutes(app, auth, guildAccess) {
  // Sent right away, or scheduled if scheduleAt (date in milliseconds) is given
  app.post('/api/guilds/:id/announce', auth, guildAccess, async (req, res) => {
    const g = req.guild;
    const parsed = parseAnnounce(req.body ?? {}, g);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    if (req.body?.scheduleAt != null) {
      const at = Number(req.body.scheduleAt);
      if (!Number.isFinite(at) || at < Date.now() + 60000) return res.status(400).json({ error: 'Choisis une date au moins une minute dans le futur.' });
      if (at > Date.now() + 90 * 86400000) return res.status(400).json({ error: 'Une annonce se programme au plus 90 jours à l’avance.' });
      const { list } = scheduled.get(g.id);
      if (list.length >= MAX_SCHEDULED) return res.status(400).json({ error: `${MAX_SCHEDULED} annonces programmées au maximum.` });
      const item = { id: SnowflakeUtil.generate().toString(), at, value: parsed.value, by: req.session.user.username };
      scheduled.save(g.id, { list: [...list, item] });
      return res.json({ scheduled: summary(g, item) });
    }

    try {
      const sent = await sendAnnounce(g, parsed.value);
      res.json({ url: sent.url });
    } catch (error) {
      res.status(400).json({ error: `Envoi impossible : ${error.message}. Vérifie que le bot peut écrire dans ce salon.` });
    }
  });

  app.get('/api/guilds/:id/announce/scheduled', auth, guildAccess, (req, res) => {
    res.json({ list: [...scheduled.peek(req.guild.id).list].sort((a, b) => a.at - b.at).map((item) => summary(req.guild, item)) });
  });

  app.delete('/api/guilds/:id/announce/scheduled/:sid', auth, guildAccess, (req, res) => {
    const { list } = scheduled.get(req.guild.id);
    if (!list.some((item) => item.id === req.params.sid)) return res.status(404).json({ error: 'Annonce introuvable.' });
    scheduled.save(req.guild.id, { list: list.filter((item) => item.id !== req.params.sid) });
    res.json({ ok: true });
  });
}

// What the dashboard shows of a scheduled announcement
function summary(guild, { id, at, value, by }) {
  const preview = value.content || value.embed?.title || value.embed?.description || value.v2?.blocks.find((b) => b.content)?.content || '(annonce)';
  return { id, at, by, channel: guild.channels.cache.get(value.channelId)?.name ?? 'salon supprimé', preview: preview.slice(0, 120) };
}

// ---------- Sending scheduled announcements (every 30 seconds, also works after a restart) ----------

function startScheduledAnnouncements(client) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const now = Date.now();
      const due = scheduled.peek(guild.id).list.filter((item) => item.at <= now);
      if (!due.length) continue;
      // Removed before sending (an announcement is never sent twice): exactly the ones about to be sent
      const sending = new Set(due.map((item) => item.id));
      scheduled.save(guild.id, { list: scheduled.peek(guild.id).list.filter((item) => !sending.has(item.id)) });
      for (const item of due) {
        const sent = await sendAnnounce(guild, item.value).catch((e) => console.error(`Scheduled announcement (${guild.name}):`, e.message));
        const channel = guild.channels.cache.get(item.value.channelId)?.name ?? '?';
        logActivity(guild.id, {
          source: 'bot',
          action: sent ? 'announce.scheduled_sent' : 'announce.scheduled_failed',
          title: sent ? `Annonce programmée par ${item.by} envoyée dans #${channel}` : `Annonce programmée par ${item.by} impossible à envoyer dans #${channel}`,
        });
      }
    }
  }, 30000).unref();
}

module.exports = { announceRoutes, startScheduledAnnouncements, parseAnnounce, buildAnnounce };

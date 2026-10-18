const { PROVIDERS, keyFor, aiUnavailableReason, resolveAi, autoModel, generateAi, NO_AI } = require('./ai-support');
const { getFeature } = require('../../core/feature-config');
const { guildLang } = require('../../core/language');
const { KEEP } = require('../../dashboard/public/i18n');

// Server AI tools: /resume, /traduire (and right-click → Traduire), translation by flag reaction,
// /image and the dashboard's "✨ Rédiger" button. Settings in the "Outils IA" tab (feature-config.js: aiTools).

const LANGS = {
  fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian',
  pl: 'Polish', tr: 'Turkish', uk: 'Ukrainian', ar: 'Arabic', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
};
const FLAGS = {
  '🇫🇷': 'fr', '🇬🇧': 'en', '🇺🇸': 'en', '🇪🇸': 'es', '🇩🇪': 'de', '🇮🇹': 'it', '🇵🇹': 'pt', '🇧🇷': 'pt', '🇳🇱': 'nl', '🇷🇺': 'ru',
  '🇵🇱': 'pl', '🇹🇷': 'tr', '🇺🇦': 'uk', '🇸🇦': 'ar', '🇯🇵': 'ja', '🇰🇷': 'ko', '🇨🇳': 'zh',
};
// A member's Discord language (e.g. "pt-BR") → LANGS code
const langOfLocale = (locale) => (LANGS[locale?.slice(0, 2)] ? locale.slice(0, 2) : 'en');

// ---------- Per-member limits ----------

const uses = new Map(); // guildId:userId:type → [dates]
// Every hour: forget counters whose uses are all older than a day (the longest window)
setInterval(() => {
  for (const [key, dates] of uses) if (Date.now() - dates.at(-1) > 86400000) uses.delete(key);
}, 3600000).unref();
function takeQuota(guildId, userId, type, max, windowMs) {
  const key = `${guildId}:${userId}:${type}`;
  const recent = (uses.get(key) ?? []).filter((at) => Date.now() - at < windowMs);
  if (recent.length >= max) return Math.ceil((recent[0] + windowMs - Date.now()) / 60000); // minutes before being able to try again
  recent.push(Date.now());
  uses.set(key, recent);
  return 0;
}

// ---------- Text ----------

// Error shown to the member when the AI isn't usable on this server
class AiError extends Error {}

// The server's AI ("IA du serveur" tab): the same as the ticket assistant
async function complete(guild, system, prompt) {
  const ai = resolveAi(guild);
  if (!ai) throw new AiError(NO_AI);
  // Small tasks: with Claude and no chosen model, a fast model (Haiku) rather than the default model
  const model = ai.model || (ai.provider === 'anthropic' ? await autoModel(ai.provider, ai.apiKey) : '');
  const { text, refused } = await generateAi({ ...ai, model }, system, [{ role: 'user', content: [{ type: 'text', text: prompt }] }]);
  if (refused || !text.trim()) throw new AiError('L’IA n’a pas pu répondre à cette demande.');
  return text.trim();
}

// Checks that a tool is enabled and that the member hasn't exceeded their limit. Returns an error message or null
function refuse(guild, userId, tool) {
  const config = getFeature(guild.id, 'aiTools');
  if (!config.enabled || !config[tool]) return 'Cet outil IA n’est pas activé sur ce serveur.';
  const wait = takeQuota(guild.id, userId, 'text', config.perHour, 3600000);
  return wait ? `Tu as atteint la limite d’utilisation de l’IA. Réessaie dans ${wait} min.` : null;
}

// ---------- Channel summary ----------

async function summarize(channel, count, lang) {
  const fetched = [];
  let before;
  while (fetched.length < count) {
    const page = await channel.messages.fetch({ limit: Math.min(100, count - fetched.length), before });
    if (!page.size) break;
    fetched.push(...page.values());
    before = page.last().id;
  }
  const lines = fetched
    .reverse()
    .filter((m) => m.content || m.attachments.size)
    .map((m) => `${m.member?.displayName ?? m.author.username}${m.author.bot ? ' (bot)' : ''}: ${m.content || '[pièce jointe]'}`);
  if (!lines.length) return null;
  const text = lines.join('\n').slice(-15000);
  const system = [
    'You summarize Discord conversations for someone who missed them.',
    `Write in ${LANGS[lang]}. Use 3 to 10 short bullet points ("- "), most important first. Mention who said what when it matters.`,
    'No title, no introduction, no conclusion. Do not invent anything that is not in the conversation.',
  ].join('\n');
  return complete(channel.guild, system, `Conversation in #${channel.name}:\n\n${text}`);
}

// ---------- Translation ----------

function translate(guild, text, lang) {
  const system = [
    `Translate the user's message into ${LANGS[lang]}.`,
    'Reply with the translation only: no quotes, no notes, no explanations. Keep emojis, mentions (<@…>), links and Discord formatting unchanged.',
    `If the message is already in ${LANGS[lang]}, return it unchanged.`,
  ].join('\n');
  return complete(guild, system, text.slice(0, 3000));
}

// Reaction with a flag: the bot replies to the message with its translation (only once per message and per language)
const translated = new Map(); // messageId:lang → date
async function handleFlagReaction(reaction, user) {
  const lang = FLAGS[reaction.emoji.name];
  if (!lang || user.bot || !reaction.message.guild) return;
  // Settings checked before fetching the message (no call to Discord on servers without this tool)
  const config = getFeature(reaction.message.guild.id, 'aiTools');
  if (!config.enabled || !config.reactions) return;
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild || !message.content?.trim() || message.author.bot) return;
  const key = `${message.id}:${lang}`;
  if (translated.has(key)) return;
  if (takeQuota(message.guild.id, user.id, 'text', config.perHour, 3600000)) return;
  translated.set(key, Date.now());
  setTimeout(() => translated.delete(key), 3600000).unref();
  try {
    const text = await translate(message.guild, message.content, lang);
    await message.reply({ content: `${KEEP}${reaction.emoji.name} ${text}`.slice(0, 2000), allowedMentions: { parse: [], repliedUser: false } });
  } catch (error) {
    translated.delete(key);
    if (!(error instanceof AiError)) console.error('Translation:', error.message);
  }
}

// ---------- Images ----------

const IMAGE_MODELS = { openai: 'gpt-image-1', gemini: 'gemini-2.5-flash-image' };

async function generateImage(guild, prompt) {
  const config = getFeature(guild.id, 'aiTools');
  const provider = config.imageProvider;
  const apiKey = keyFor(provider, guild);
  if (!apiKey) throw new AiError(aiUnavailableReason(provider, guild));
  const model = config.imageModel || IMAGE_MODELS[provider];
  const call = async (url, headers, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AiError(data.error?.message ?? `${PROVIDERS[provider].name} a répondu ${res.status}`);
    return data;
  };

  if (provider === 'openai') {
    const data = await call('https://api.openai.com/v1/images/generations', { Authorization: `Bearer ${apiKey}` }, { model, prompt, size: '1024x1024', n: 1 });
    const image = data.data?.[0];
    if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
    if (image?.url) return Buffer.from(await (await fetch(image.url)).arrayBuffer());
  } else {
    const data = await call(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': apiKey },
      { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } },
    );
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (part) return Buffer.from(part.inlineData.data, 'base64');
  }
  throw new AiError('L’IA n’a pas pu créer cette image (demande refusée ou image vide).');
}

// ---------- "✨ Rédiger" in the dashboard ----------

const WRITE_KINDS = {
  welcome: 'a Discord welcome message for new members. Variables you may use (keep them exactly as written): {user} (mention), {name} (username), {server} (server name), {count} (member count).',
  dm: 'a private message sent to new members when they join. Variables: {user}, {name}, {server}, {count}.',
  goodbye: 'a message posted when a member leaves the server. Variables: {name}, {server}, {count}.',
  announce: 'a Discord announcement. You can use Discord markdown: **bold**, *italic*, # / ## headings, - lists, and emojis.',
  ticket: 'a message sent by DM to a member who contacted the server staff through a ticket. Variable: {server} (server name).',
  command: 'the reply of a custom Discord bot command. Variables: {user} (mention), {name} (username), {server}, {channel}.',
  auto: 'a message the bot posts regularly in a channel (reminder, useful links…). Variable: {server}.',
  levelup: 'a level-up message. Variables: {user} (mention), {name}, {level}, {server}.',
  generic: 'a short text for a Discord server.',
};

function writeText(guild, { kind, prompt, current, max }) {
  const system = [
    `You write ${WRITE_KINDS[kind] ?? WRITE_KINDS.generic}`,
    `Write in ${LANGS[guildLang(guild)]}. Server name: ${guild.name}.`,
    `Reply with the final text only, ready to paste (no quotes, no explanation). At most ${max} characters. Friendly tone, a few emojis are welcome.`,
  ].join('\n');
  const request = current ? `Current text:\n${current}\n\nChange it as follows: ${prompt || 'improve it'}` : prompt;
  return complete(guild, system, request).then((text) => text.slice(0, max));
}

module.exports = { LANGS, langOfLocale, takeQuota, refuse, summarize, translate, handleFlagReaction, generateImage, writeText, AiError };

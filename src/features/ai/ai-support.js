const Anthropic = require('@anthropic-ai/sdk');
const { getSetting, getGuildKey } = require('../../core/settings');
const { guildLang } = require('../../core/language');
const { KEEP } = require('../../dashboard/public/i18n');
const { publicRequest } = require('../../core/public-fetch');
const { createStore } = require('../../core/store');
const { peekTicketConfig } = require('../tickets/ticket-store');

// Ticket AI assistant: it answers the member in their ticket channel, as long as staff hasn't taken over.
// Each server picks its AI (provider + model) and its key in a single place: the dashboard's "IA du serveur" tab.
// This setting is used for everything: ticket assistant, AI tools (/resume, /traduire, flag translation, ✨ Rédiger button).
// The history is reread from the channel on every reply: member's messages = user, bot's text replies = assistant.

// Claude goes through Anthropic's SDK; all the others offer the same API as OpenAI (base = its address)
const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic)', key: 'anthropicKey', site: 'https://console.anthropic.com' },
  openai: { name: 'ChatGPT (OpenAI)', key: 'openaiKey', site: 'https://platform.openai.com/api-keys', base: 'https://api.openai.com/v1' },
  gemini: { name: 'Gemini (Google)', key: 'geminiKey', site: 'https://aistudio.google.com/apikey', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  mistral: { name: 'Mistral AI', key: 'mistralKey', site: 'https://console.mistral.ai/api-keys', base: 'https://api.mistral.ai/v1' },
  deepseek: { name: 'DeepSeek', key: 'deepseekKey', site: 'https://platform.deepseek.com/api_keys', base: 'https://api.deepseek.com', noImages: true },
  groq: { name: 'Groq (Llama…)', key: 'groqKey', site: 'https://console.groq.com/keys', base: 'https://api.groq.com/openai/v1' },
  openrouter: { name: 'OpenRouter (toutes les IA)', key: 'openrouterKey', site: 'https://openrouter.ai/keys', base: 'https://openrouter.ai/api/v1' },
  // Self-hosted AI (Ollama, LM Studio…): the bot owner's (LOCAL_AI_URL in .env, can be on the VPS itself),
  // or a server's, which runs on their side and that the bot reaches through a public https address (tunnel)
  local: { name: 'IA locale (Ollama, LM Studio…)', key: 'localKey', site: 'https://ollama.com', local: true, noImages: true },
};

// Prototype-less table: PROVIDERS['constructor'] (sent by a forged request) is undefined, not a JavaScript function
Object.setPrototypeOf(PROVIDERS, null);

// API address of the owner's local AI, without a trailing "/"
const localBase = () => getSetting('localUrl').replace(/\/+$/, '');

// For the local AI, the "key" passed around also contains the address: "origin\naddress\nkey".
// origin = owner (owner's address, local network allowed) or guild (a server's address, public Internet only)
const localCred = (origin, url, key) => [origin, url.replace(/\/+$/, ''), key || 'local'].join('\n');
const parseCred = (cred) => {
  const [origin, base, key] = cred.split('\n');
  return { origin, base, key };
};

// Model used for Claude if none is chosen (it benefits from the automatic fallback if refused)
const DEFAULT_CLAUDE = 'claude-opus-5-5';

// The bot owner's keys (.env) are only used on the servers they own: other servers set their own key
function ownsGuild(guild) {
  const owner = guild.client.application?.owner;
  return owner?.members ? owner.members.has(guild.ownerId) : owner?.id === guild.ownerId;
}
const canUseShared = (guild) => ownsGuild(guild);

// Key to use: the server's ("IA du serveur" tab), otherwise the owner's if allowed. Without a server: the owner's
function keyFor(provider, guild) {
  const name = PROVIDERS[provider]?.key;
  if (!name) return '';
  // Local AI: the server's if it connected one, otherwise the owner's if allowed (the key is often unnecessary)
  if (PROVIDERS[provider].local) {
    const own = guild ? getGuildKey(guild.id, 'localUrl') : '';
    if (own) return localCred('guild', own, getGuildKey(guild.id, name));
    if (!localBase() || (guild && !canUseShared(guild))) return '';
    return localCred('owner', localBase(), getSetting(name));
  }
  if (!guild) return getSetting(name);
  return getGuildKey(guild.id, name) || (canUseShared(guild) ? getSetting(name) : '');
}

// own: the server has its own key (ending shown) · shared: it can use the owner's
const listProviders = (guild) =>
  Object.entries(PROVIDERS).map(([id, p]) => {
    const own = guild ? getGuildKey(guild.id, p.local ? 'localUrl' : p.key) : '';
    const shared = p.local ? Boolean(localBase()) : Boolean(getSetting(p.key));
    return {
      id, name: p.name, site: p.site, key: p.key, local: Boolean(p.local),
      ready: Boolean(keyFor(id, guild)), own: Boolean(own), ending: p.local ? '' : own.slice(-4), shared: Boolean(guild && canUseShared(guild) && shared),
      // Server's local AI: its address (not secret for its admins) and whether a key comes with it
      ...(p.local && own && { url: own, hasKey: Boolean(getGuildKey(guild.id, p.key)) }),
    };
  });

// One Claude client per key
const claudes = new Map();
function getClaude(apiKey) {
  if (!claudes.has(apiKey)) claudes.set(apiKey, new Anthropic({ apiKey }));
  return claudes.get(apiKey);
}

// null if the chosen AI can work on this server, otherwise the reason
function aiUnavailableReason(provider = 'anthropic', guild) {
  if (!PROVIDERS[provider]) return 'IA inconnue.';
  if (keyFor(provider, guild)) return null;
  if (PROVIDERS[provider].local) return 'L’IA locale n’est pas branchée : indique son adresse dans l’onglet 🧠 IA du serveur du dashboard.';
  return `Ajoute ta clé ${PROVIDERS[provider].name} dans l’onglet 🧠 IA du serveur du dashboard.`;
}

// ---------- The server's AI: a single setting for everything ----------
// data/ai-guild.json = { <guildId>: { provider, model } }. Without a setting: the AI and model chosen earlier in the Tickets tab

const guildAiStore = createStore('ai-guild', { provider: '', model: '' });
function guildAi(guildId) {
  const saved = guildAiStore.peek(guildId);
  if (saved.provider) return { provider: saved.provider, model: saved.model };
  const legacy = peekTicketConfig(guildId).ai;
  return { provider: legacy.provider || 'anthropic', model: legacy.model || '' };
}
const setGuildAi = (guildId, { provider, model }) => guildAiStore.save(guildId, { provider, model });

// The AI to use: the server's if it has a key, otherwise the first AI that has one (the chosen model goes with its AI).
// Returns { provider, apiKey, model } or null if no AI is usable
function resolveAi(guild) {
  const choice = guildAi(guild.id);
  for (const [provider, model] of [[choice.provider, choice.model], ...Object.keys(PROVIDERS).map((id) => [id, ''])]) {
    const apiKey = PROVIDERS[provider] && keyFor(provider, guild);
    if (apiKey) return { provider, apiKey, model };
  }
  return null;
}
const NO_AI = 'Aucune IA n’a de clé sur ce serveur : ajoute-en une dans l’onglet 🧠 IA du serveur du dashboard.';

// Generates with the server's AI (resolveAi). Without a chosen model: automatic model (Claude: its default model).
// OpenRouter with a free model (chosen or automatic), or without credit (key at $0, credits used up):
// free models are tried one after another, up to 5, as long as the previous one is overloaded
async function generateAi(ai, system, history) {
  const model = ai.model || (ai.provider === 'anthropic' ? '' : await autoModel(ai.provider, ai.apiKey));
  let firstError;
  try {
    return await generate(ai.provider, ai.apiKey, model, system, history);
  } catch (error) {
    const noCredit = error.status === 402 || /limit exceeded|credits|insufficient/i.test(error.message);
    if (ai.provider !== 'openrouter' || !(noCredit || (model.endsWith(':free') && busyModel(error)))) throw error;
    firstError = error;
  }
  const others = freeModels(await listModels('openrouter', null, ai.apiKey)).filter((m) => m !== model).slice(0, 5);
  for (const free of others) {
    try {
      const result = await generate(ai.provider, ai.apiKey, free, system, history);
      console.log(`AI: ${model} unavailable (${firstError.message.slice(0, 80)}), answered with the free model ${free}.`);
      return result;
    } catch (error) {
      if (!busyModel(error)) throw error;
    }
  }
  throw firstError;
}

// OpenRouter's free chat models, from best to worst. They are often overloaded: they are tried one after another.
// Excluded: code models, moderation models, very small ones, or those reserved for certain apps (inkling)
function freeModels(models) {
  const free = models.filter((m) => m.endsWith(':free') && !/code|safety|guard|embed|omni|nano|lfm|inkling|-xs\b/i.test(m));
  const score = (m) => {
    const size = Number(/(\d+)b/i.exec(m)?.[1] ?? 30); // bigger models answer better
    return (/llama|mistral|qwen|deepseek|gemma|nemotron|gpt|glm/i.test(m) ? 1000 : 0) + Math.min(size, 600);
  };
  return free.sort((a, b) => score(b) - score(a));
}
const freeModel = (models) => freeModels(models)[0] ?? null;
// The free model is overloaded or unavailable: the next one can be tried
const busyModel = (error) => [403, 404, 408, 429, 500, 502, 503].includes(error.status) || /rate-limited|upstream|provider returned error|overloaded|limit reached/i.test(error.message);

// Without a chosen model: a fast and cheap model of the AI (found in the provider's list, cached for 1 hour)
const autoModels = new Map(); // provider:key ending → { model, at }
async function autoModel(provider, apiKey) {
  if (provider === 'anthropic') return 'claude-haiku-5-5';
  const key = `${provider}:${apiKey.slice(-6)}`;
  const cached = autoModels.get(key);
  if (cached && Date.now() - cached.at < 3600000) return cached.model;
  const models = await listModels(provider, null, apiKey);
  // OpenRouter: a free model (":free"), usable even without credit. A general-purpose model rather than a
  // code or moderation model. The list of free models changes often: it is reread every hour
  const free = provider === 'openrouter' && freeModel(models);
  const model = free || (models.find((m) => /mini|flash|small|lite|haiku|8b|instant/i.test(m) && !/preview|audio|vision|image/i.test(m)) ?? models[0]);
  if (!model) throw new Error(`aucun modèle disponible chez ${PROVIDERS[provider].name}`);
  autoModels.set(key, { model, at: Date.now() });
  return model;
}

// Call to an OpenAI-compatible API
async function openaiApi(provider, apiKey, path, body) {
  const p = PROVIDERS[provider];
  if (p.local) return localApi(apiKey, path, body);
  const res = await fetch(`${p.base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error?.message ?? data.message ?? `${p.name} a répondu ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

// Local AI (see localCred). A server's address goes through publicRequest: never towards the VPS's private network
async function localApi(cred, path, body) {
  const { origin, base, key } = parseCred(cred);
  const options = {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  };
  const unreachable = (error) => {
    const why =
      error.code === 'EPRIVATE' ? 'adresse privée refusée : utilise une adresse publique, par exemple un tunnel'
      : /https|invalide|trop grande/.test(error.message) ? error.message
      : origin === 'guild' ? 'est-elle lancée et joignable depuis Internet ?'
      : 'est-elle lancée ?';
    throw new Error(`IA locale injoignable à ${base} (${why})`);
  };
  // a local AI can be slow on a small PC: 5 minutes max
  const { ok, status, json: data } =
    origin === 'guild'
      ? await publicRequest(`${base}${path}`, { ...options, timeout: 300000 }).catch(unreachable)
      : await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(300000) })
          .then(async (res) => ({ ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) }))
          .catch(unreachable);
  if (!ok) {
    const error = new Error(data.error?.message ?? data.message ?? `L’IA locale a répondu ${status}`);
    error.status = status;
    throw error;
  }
  return data;
}

// Models available with the key (the dashboard offers them): those that don't do chat are left out
const NOT_CHAT = /embed|tts|whisper|dall-e|moderation|audio|realtime|transcribe|image|search|rerank|guard|imagen|veo|aqa/i;
// apiKey: a specific key (test before saving it), otherwise the server's
async function listModels(provider, guild, apiKey = keyFor(provider, guild)) {
  if (!PROVIDERS[provider]) throw new Error('IA inconnue.');
  if (!apiKey) throw new Error(aiUnavailableReason(provider, guild));
  if (provider === 'anthropic') {
    const page = await getClaude(apiKey).models.list({ limit: 100 });
    return page.data.map((m) => m.id);
  }
  const { data = [] } = await openaiApi(provider, apiKey, '/models');
  return data
    .map((m) => m.id.replace(/^models\//, ''))
    .filter((id) => !NOT_CHAT.test(id))
    .sort();
}

// Checks a key (dashboard "Tester" / "Enregistrer" buttons). Returns the number of models
async function testProvider(provider, guild, apiKey) {
  try {
    // OpenRouter gives the model list to anyone (even with a fake key): the key is checked separately
    if (provider === 'openrouter') await openaiApi(provider, apiKey ?? keyFor(provider, guild), '/key');
    const models = await listModels(provider, guild, apiKey);
    return models.length;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error.status === 401 || error.status === 403) throw new Error('clé refusée');
    throw error;
  }
}

// Generates the reply with the chosen AI. Returns { text, refused }
async function generate(provider, apiKey, model, system, history) {
  if (provider === 'anthropic') {
    const chosen = model || DEFAULT_CLAUDE;
    const request = { model: chosen, max_tokens: 16000, system, messages: history, cache_control: { type: 'ephemeral' } };
    const response =
      chosen === DEFAULT_CLAUDE
        ? await getClaude(apiKey).beta.messages.create({
            ...request,
            // If Claude refuses for safety reasons, the API automatically retries with another model
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'low' }, // support chat: quick answers
          })
        : await getClaude(apiKey).messages.create(request);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return { text, refused: response.stop_reason === 'refusal' };
  }

  // OpenAI format: images become "image_url" (or a mention if the provider can't read images)
  const toOpenAi = (withImages) =>
    history.map((turn) => ({
      role: turn.role,
      content: turn.content.map((b) =>
        b.type === 'text' ? { type: 'text', text: b.text } : withImages ? { type: 'image_url', image_url: { url: b.source.url } } : { type: 'text', text: '[Image jointe]' },
      ),
    }));
  const ask = (withImages) => openaiApi(provider, apiKey, '/chat/completions', { model, messages: [{ role: 'system', content: system }, ...toOpenAi(withImages)] });
  const hasImages = history.some((t) => t.content.some((b) => b.type === 'image'));
  let data;
  try {
    data = await ask(hasImages && !PROVIDERS[provider].noImages);
  } catch (error) {
    // Model that can't read images: retry without them
    if (!hasImages || error.status !== 400) throw error;
    data = await ask(false);
  }
  const choice = data.choices?.[0];
  return { text: choice?.message?.content ?? '', refused: choice?.finish_reason === 'content_filter' };
}

function systemPrompt(guild, config, type) {
  return [
    `Tu es l’assistant de support du serveur Discord « ${guild.name} ». Tu réponds dans le salon de ticket d’un membre qui a contacté l’équipe.`,
    `Réponds en ${guildLang(guild) === 'en' ? 'anglais' : 'français'} (ou dans la langue du membre), de façon courte et claire : c’est une discussion Discord, quelques phrases suffisent. Pas de titres Markdown.`,
    'Tu ne peux faire aucune action sur le serveur (sanction, rôle, remboursement…). Ne promets jamais qu’une action sera faite.',
    'Si tu ne connais pas la réponse, si la demande nécessite l’équipe (signalement, sanction, problème de compte, paiement, décision du staff) ou si le membre veut parler à un humain, dis-lui de cliquer sur le bouton « Parler à l’équipe » en haut du ticket.',
    'Pour tout ce qui concerne le serveur, base-toi uniquement sur les informations ci-dessous, écrites par l’équipe. N’invente pas de règles ou d’informations.',
    `<infos_serveur>\n${config.ai.instructions.trim() || '(aucune information fournie)'}\n</infos_serveur>`,
    type ? `Le membre a choisi le type de demande « ${type} ».` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Rebuilds the conversation from the last 100 messages of the DM posted after "since"
async function buildHistory(channel, userId, since) {
  const fetched = await channel.messages.fetch({ limit: 100 });
  const messages = [...fetched.values()]
    .filter((m) => BigInt(m.id) > BigInt(since))
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const history = [];
  for (const m of messages) {
    let role;
    if (m.author.id === userId) role = 'user';
    // AI replies = the bot's text messages (the bot's interface messages are embeds)
    else if (m.author.id === channel.client.user.id && !m.embeds.length && m.content) role = 'assistant';
    else continue;

    const blocks = [];
    if (m.content.trim()) blocks.push({ type: 'text', text: m.content });
    if (role === 'user') {
      for (const a of m.attachments.values()) {
        if (a.contentType?.startsWith('image/')) blocks.push({ type: 'image', source: { type: 'url', url: a.url } });
        else blocks.push({ type: 'text', text: `[Fichier joint : ${a.name}]` });
      }
    }
    if (!blocks.length) continue;

    // Several messages in a row from the same author = a single turn
    const last = history.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else history.push({ role, content: blocks });
  }
  while (history[0]?.role === 'assistant') history.shift();
  return history;
}

// Discord limits messages to 2000 characters: split at line breaks
async function send(channel, text, keep = false) {
  const chunks = [];
  let rest = text;
  while (rest.length > 1900) {
    const cut = rest.lastIndexOf('\n', 1900) > 500 ? rest.lastIndexOf('\n', 1900) : 1900;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  chunks.push(rest);
  // keep: text written by the AI, never passed to the bot's translator
  for (const content of chunks) await channel.send({ content: keep ? `${KEEP}${content}` : content, allowedMentions: { parse: [] } });
}

// getContext() returns { userId, since, guild, config, type, onReply? }, or null if the AI must stop answering
async function reply(channel, getContext) {
  const ctx = getContext();
  if (!ctx) return;

  await channel.sendTyping().catch(() => {});
  const typing = setInterval(() => channel.sendTyping().catch(() => {}), 8000);
  let usedProvider = null; // for the error message in the console
  try {
    const history = await buildHistory(channel, ctx.userId, ctx.since);
    if (history.at(-1)?.role !== 'user') return;

    // The server's AI ("IA du serveur" tab). Without a model: Claude takes its default model, the others a cheap model
    const ai = resolveAi(ctx.guild);
    if (!ai) throw new Error(NO_AI);
    usedProvider = ai.provider;
    const { text, refused } = await generateAi(ai, systemPrompt(ctx.guild, ctx.config, ctx.type), history);
    // The member asked for the team while the AI was thinking: nothing more is sent
    if (!getContext()) return;

    if (refused) {
      return await send(channel, 'Je ne peux pas t’aider sur ce sujet. Clique sur « Parler à l’équipe » pour qu’un membre du staff prenne le relais.');
    }
    if (text.trim()) {
      await send(channel, text.trim(), true);
      await ctx.onReply?.(text.trim());
    }
  } catch (error) {
    const provider = PROVIDERS[usedProvider]?.name ?? 'IA';
    if (error instanceof Anthropic.AuthenticationError || error.status === 401) console.error(`AI: invalid ${provider} key (server ${ctx.guild.name}).`);
    else if (error instanceof Anthropic.RateLimitError || error.status === 429) console.error(`AI: ${provider} rate limit reached.`);
    else console.error(`AI (${provider}): unable to answer:`, error.message);
    await send(channel, '⚠️ L’assistant IA n’est pas disponible pour le moment. Clique sur « Parler à l’équipe » pour joindre le staff.').catch(() => {});
  } finally {
    clearInterval(typing);
  }
}

// A single call at a time per channel: if the member writes while the AI is answering, it then answers everything at once
const busy = new Map(); // channelId → new message that arrived during the reply
function askAi(channel, getContext) {
  if (busy.has(channel.id)) return busy.set(channel.id, true);
  busy.set(channel.id, false);
  (async () => {
    try {
      do {
        busy.set(channel.id, false);
        await reply(channel, getContext);
      } while (busy.get(channel.id));
    } finally {
      busy.delete(channel.id);
    }
  })();
}

// A server's local AI, to test before saving it (dashboard)
const guildLocalCred = (url, key) => localCred('guild', url, key);

module.exports = {
  PROVIDERS, aiUnavailableReason, askAi, listProviders, listModels, testProvider, keyFor, generate, guildLocalCred, ownsGuild,
  guildAi, setGuildAi, resolveAi, autoModel, generateAi, NO_AI,
};

const { ChannelType, Events } = require('discord.js');
const { createStore } = require('./store');
const { createTranslator, translatePayload, KEEP } = require('../dashboard/public/i18n');
const EN = require('../dashboard/public/i18n-en');
const { keyedDictionary } = require('./i18n');
const { every } = require('./scheduler');

// Bot language on each server (English by default, French can be chosen in the dashboard).
// Everything the bot sends to Discord (messages, embeds, buttons, modals, names of channels it creates) goes through here
// and is translated into English if the server is in English. Texts stay written in French in the code.
// data/language.json = { <guildId>: { lang: 'fr' | 'en' } }

const store = createStore('language', { lang: null });
// Dictionary: the texts of the bot's messages by key (locales/fr.json → en.json, see i18n.js), plus the dashboard's
// dictionary for the texts it shares with the bot (errors shown in both, defaults…)
// The bot's keyed texts (locales/*.json) win over the older dictionary
const toEnglish = createTranslator(EN, { first: keyedDictionary() });
// The bot's default texts (see DEFAULTS in i18n-en.js), translated only when they are unchanged
const defaultsToEnglish = createTranslator(EN.DEFAULTS, { whole: true });
const same = (text) => text;

// Language of a server: the one chosen in the dashboard, otherwise English
function guildLang(guild) {
  if (!guild) return 'en';
  return store.peek(guild.id).lang ?? 'en'; // called on every send to Discord: read without copy
}
const setGuildLang = (guildId, lang) => store.save(guildId, { lang });

// Language of a member in DMs: their Discord language (known as soon as they use a button or a command),
// otherwise the language of the servers they share with the bot
const userLocale = new Map(); // userId → 'fr' | 'en'
const localeLang = (locale) => (locale?.startsWith('fr') ? 'fr' : 'en');
function userLang(client, userId) {
  if (userLocale.has(userId)) return userLocale.get(userId);
  const langs = new Set(client.guilds.cache.filter((g) => g.members.cache.has(userId)).map(guildLang));
  return langs.size === 1 ? [...langs][0] : 'en';
}

// Language of each ongoing interaction (reply, follow-ups): 15 minutes, like Discord's tokens
// A single cleanup every 5 minutes (instead of one timer per interaction)
const interactionLang = new Map(); // id or token → { lang, at }
function remember(key, lang) {
  interactionLang.set(key, { lang, at: Date.now() });
}
every('language-cleanup', 5 * 60000, () => {
  for (const [key, { at }] of interactionLang) if (Date.now() - at > 15 * 60000) interactionLang.delete(key);
});

// A t(text) function for a server, to use where the text isn't sent to Discord (images…)
const translatorForLang = (lang) => (lang === 'en' ? toEnglish : same);
const translatorFor = (guild) => translatorForLang(guildLang(guild));
// Same for the default texts only (welcome image texts, templates filled later…): admins' own texts stay as they are
const defaultsFor = (guild) => (guildLang(guild) === 'en' ? defaultsToEnglish : same);

function routeLang(client, route) {
  let m;
  if ((m = /^\/interactions\/(\d+)\//.exec(route))) return interactionLang.get(m[1])?.lang;
  if ((m = /^\/webhooks\/\d+\/([^/]+)/.exec(route))) return interactionLang.get(m[1])?.lang;
  if ((m = /^\/(?:channels|guilds)\/(\d+)/.exec(route))) {
    const guild = client.guilds.cache.get(m[1]);
    if (guild) return guildLang(guild);
    const channel = client.channels.cache.get(m[1]);
    if (channel?.guild) return guildLang(channel.guild);
    if (channel?.type === ChannelType.DM) return userLang(client, channel.recipientId);
  }
  return 'en';
}

// Only these routes carry a channel name and topic chosen by the bot (temporary channels, counters, tickets)
const NAMED = /^\/guilds\/\d+\/channels$|^\/channels\/\d+$/;
// AutoMod rules created by the bot: their name and the message shown to the member
const AUTOMOD = /^\/guilds\/\d+\/auto-moderation\/rules(\/\d+)?$/;

function installTranslator(client) {
  // Listened to before all the others: the language is known before the reply
  client.prependListener(Events.InteractionCreate, (interaction) => {
    if (!interaction.guild) userLocale.set(interaction.user.id, localeLang(interaction.locale));
    const lang = interaction.guild ? guildLang(interaction.guild) : localeLang(interaction.locale);
    remember(interaction.id, lang);
    remember(interaction.token, lang);
  });

  const request = client.rest.request.bind(client.rest);
  // French server: nothing to translate, only the "do not translate" character is removed
  // (marked texts can be anywhere: content, embeds, buttons…)
  const keepOnly = (body) => (JSON.stringify(body).includes(KEEP) ? translatePayload(structuredClone(body), same) : body);
  client.rest.request = (options) => {
    const english = routeLang(client, options.fullRoute) === 'en';
    if (options.body && typeof options.body === 'object') {
      let body;
      if (english) {
        body = translatePayload(structuredClone(options.body), toEnglish, defaultsToEnglish);
        if (NAMED.test(options.fullRoute)) {
          if (typeof body.name === 'string') body.name = toEnglish(body.name);
          if (typeof body.topic === 'string') body.topic = toEnglish(body.topic);
        }
        if (AUTOMOD.test(options.fullRoute)) {
          if (typeof body.name === 'string') body.name = toEnglish(body.name);
          for (const action of body.actions ?? []) {
            if (typeof action.metadata?.custom_message === 'string') action.metadata.custom_message = toEnglish(action.metadata.custom_message);
          }
        }
      } else body = keepOnly(options.body);
      options = { ...options, body };
    }
    // Reason shown in the server's audit log
    if (english && typeof options.reason === 'string') options = { ...options, reason: toEnglish(options.reason) };
    return request(options);
  };
}

module.exports = { installTranslator, guildLang, setGuildLang, translatorFor, translatorForLang, defaultsFor, userLocale };

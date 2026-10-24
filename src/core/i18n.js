// Texts of the bot's messages on Discord, by key: src/locales/fr.json and src/locales/en.json (same keys in both).
//   t('tickets.claimed_ticket', { signature }) → the French text with its variables filled in.
// The bot writes in French; language.js translates every message sent to an English server, and the pairs of these two
// files are part of its dictionary: a text changed in fr.json keeps its English version, since both are tied by the key.
// npm run check:i18n checks that every key has both versions with the same variables.
// The dashboard keeps its own dictionary (dashboard/public/i18n-en.js).
const fr = require('../locales/fr.json');
const en = require('../locales/en.json');

// { tickets: { closed: "…" } } → { "tickets.closed": "…" }
const flatten = (obj, prefix = '') =>
  Object.entries(obj).reduce((all, [k, v]) => (typeof v === 'object' ? Object.assign(all, flatten(v, `${prefix}${k}.`)) : Object.assign(all, { [`${prefix}${k}`]: v })), {});
const FR = flatten(fr);
const EN = flatten(en);

// A missing key is shown as the key itself (and reported once in the console) rather than breaking the message
const reported = new Set();
function t(key, vars = {}) {
  const text = FR[key];
  if (text === undefined) {
    if (!reported.has(key)) console.error(`Missing translation key: ${key}`);
    reported.add(key);
    return key;
  }
  return text.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all));
}

// French text → English text of every key, for the translator of the messages (language.js)
const keyedDictionary = () => Object.fromEntries(Object.keys(FR).filter((key) => EN[key] !== undefined).map((key) => [FR[key].trim(), EN[key].trim()]));

module.exports = { t, keyedDictionary, FR, EN };

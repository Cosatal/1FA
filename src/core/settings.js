const { createStore } = require('./store');

// Settings shared by the whole bot: Twitch credentials (editable in the dashboard by the bot owner) and the owner's
// AI keys (from .env only, used on the owner's own servers). data/settings.json = { global: { twitchClientId, twitchClientSecret } }
// An empty value in the dashboard = the value from the .env file is used (if there is one).

const store = createStore('settings', {});

const ENV = {
  twitchClientId: 'TWITCH_CLIENT_ID',
  twitchClientSecret: 'TWITCH_CLIENT_SECRET',
  // AI keys for the ticket assistant (see ai-support.js)
  anthropicKey: 'ANTHROPIC_API_KEY',
  openaiKey: 'OPENAI_API_KEY',
  geminiKey: 'GEMINI_API_KEY',
  mistralKey: 'MISTRAL_API_KEY',
  deepseekKey: 'DEEPSEEK_API_KEY',
  groqKey: 'GROQ_API_KEY',
  openrouterKey: 'OPENROUTER_API_KEY',
  // Local AI (Ollama, LM Studio…): address of its OpenAI-compatible API, optional key
  localUrl: 'LOCAL_AI_URL',
  localKey: 'LOCAL_AI_KEY',
};

const getSetting = (name) => store.peek('global')[name] || process.env[ENV[name]] || '';

// Only known keys are saved; null = clear the dashboard value
function updateSettings(changes) {
  const current = store.get('global');
  for (const [name, value] of Object.entries(changes)) {
    if (!(name in ENV) || value === undefined) continue;
    if (value === null) delete current[name];
    else current[name] = value;
  }
  store.save('global', current);
}

// Where each setting comes from: 'dashboard', 'env' or null (missing)
const settingSource = (name) => (store.peek('global')[name] ? 'dashboard' : process.env[ENV[name]] ? 'env' : null);

// Each server's own AI keys (set by its admins in the "IA du serveur" tab): data/ai-keys.json = { guildId: { anthropicKey… } }
const guildKeys = createStore('ai-keys', {});
const getGuildKey = (guildId, name) => guildKeys.peek(guildId)[name] || '';
function setGuildKey(guildId, name, value) {
  const keys = guildKeys.get(guildId);
  if (value) keys[name] = value;
  else delete keys[name];
  guildKeys.save(guildId, keys);
}

module.exports = { getSetting, updateSettings, settingSource, getGuildKey, setGuildKey };

const { createStore } = require('../../core/store');
const { DEFAULT_LAYOUT } = require('../../dashboard/public/card-renderer');

// Per-server welcome / goodbye config, saved in data/welcome.json
// Variables usable in texts: {user} (mention), {name}, {server}, {count}
module.exports = createStore('welcome', {
  enabled: true,
  channelId: '', // empty = the server's system channel
  format: 'text', // 'text': simple message + image · 'embed': embed with the image inside · 'canvas': the image alone
  message: '', // message text (above the embed in embed mode; empty = nothing)
  card: true, // attach the welcome image drawn in the editor
  embed: {
    color: '#2f7ff0',
    author: '',
    title: 'Bienvenue sur {server} !',
    description: 'Salut {user}, tu es le membre n°{count} 🎉',
    fields: [], // [{ name, value, inline }]
    thumbnail: true, // member's avatar as a thumbnail
    footer: '',
  },
  dm: { enabled: false, message: 'Bienvenue sur **{server}**, {name} ! 👋' }, // DM to the new member
  autoroles: { enabled: false, roles: [] }, // roles given on join (after the captcha if enabled)
  goodbye: { enabled: false, channelId: '', message: '**{name}** a quitté le serveur. Nous sommes maintenant {count}.' },
  // Captcha (its own dashboard tab): a message with a button in channelId; passing the captcha gives roleId (+ the automatic roles).
  // level: permissive | standard | aggressive | maximum · maxFails: failures before the penalty · kick: kick after too many failures
  // cooldown: seconds between two attempts · ttl: seconds a code stays valid. Older configs: see captchaConfig (captcha.js)
  captcha: { enabled: false, channelId: '', roleId: '', messageId: '', level: 'standard', maxFails: 3, kick: false, cooldown: 3, ttl: 300 },
  banner: 'none', // 'none' (plain background) or 'custom' (data/banners/<guildId>.img). The old 'default' means 'none'
  ...DEFAULT_LAYOUT, // background, overlay, elements: the whole drawing of the image
});

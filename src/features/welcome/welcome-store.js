const { createStore } = require('../../core/store');
const { DEFAULT_LAYOUT } = require('../../dashboard/public/card-renderer');

// Per-server welcome / goodbye config, saved in data/welcome.json
// Variables usable in texts: {user} (mention), {name}, {server}, {count}
module.exports = createStore('welcome', {
  enabled: true,
  channelId: '', // empty = the server's system channel
  format: 'text', // 'text': text + image · 'embed': embed with the image inside
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
  // Captcha: a message with a button in channelId; passing the captcha gives roleId (+ the automatic roles)
  captcha: { enabled: false, channelId: '', roleId: '', messageId: '' },
  banner: 'none', // 'none' (plain background) or 'custom' (data/banners/<guildId>.img). The old 'default' means 'none'
  ...DEFAULT_LAYOUT, // background, overlay, elements: the whole drawing of the image
});

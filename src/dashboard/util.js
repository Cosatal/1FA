const { ChannelType } = require('discord.js');

// Small validation helpers shared by the dashboard routes

const HEX = /^#[0-9a-f]{6}$/i;
const str = (value) => (typeof value === 'string' ? value.trim() : '');
const isUrl = (value) => /^https?:\/\/\S+$/.test(value);
const isText = (guild, id) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(guild.channels.cache.get(id)?.type);
// Integer between min and max, otherwise null
const int = (value, min, max) => (Number.isInteger(value) && value >= min && value <= max ? value : null);

function fail(message) {
  throw new Error(message);
}

module.exports = { HEX, str, isUrl, isText, int, fail };

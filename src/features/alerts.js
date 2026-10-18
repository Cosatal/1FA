const { EmbedBuilder, SnowflakeUtil } = require('discord.js');
const { createStore } = require('../core/store');
const { getSetting } = require('../core/settings');
const { keep } = require('../dashboard/public/i18n');
const { defaultsFor } = require('../core/language');

// Social media alerts: the bot regularly checks accounts and posts a message for each new item.
//   Twitch    : going live (official API, credentials set by the bot owner in the dashboard's alerts tab)
//   YouTube   : new videos (the channel's public feed, no key)
//   Reddit    : new posts of a subreddit (public feed, no key)
//   X, Instagram, TikTok, other: an RSS feed (these platforms have no free API, so a service like rss.app is used)
// data/alerts.json = { <guildId>: { feeds: [{ id, platform, source, name, url, channelId, roleId, message, seen, live, error }] } }

const store = createStore('alerts', { feeds: [] });
const getFeeds = (guildId) => store.get(guildId).feeds;
const saveFeeds = (guildId, feeds) => store.save(guildId, { feeds });

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot alertes)' };

const DEFAULT_MESSAGES = {
  twitch: '🔴 **{name}** est en live sur Twitch !',
  youtube: '📺 **{name}** a publié une nouvelle vidéo !\n{link}',
  reddit: '📰 Nouveau post sur **{name}** : {title}\n{link}',
  twitter: '🐦 **{name}** a publié un nouveau post !\n{link}',
  instagram: '📸 **{name}** a publié sur Instagram !\n{link}',
  tiktok: '🎵 **{name}** a publié un nouveau TikTok !\n{link}',
  rss: '🔔 Nouveau sur **{name}** : {title}\n{link}',
};

const twitchReady = () => Boolean(getSetting('twitchClientId') && getSetting('twitchClientSecret'));

// ---------- Reading RSS / Atom feeds ----------

const decode = (text) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const tag = (xml, name) => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decode(match[1]) : '';
};

// Returns the feed title and its items, from newest to oldest
function parseFeed(xml) {
  const head = xml.split(/<item[\s>]|<entry[\s>]/)[0];
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)]
    .map(([block]) => {
      const link = tag(block, 'link') || decode(/<link[^>]*href="([^"]+)"/.exec(block)?.[1] ?? '');
      return {
        id: tag(block, 'yt:videoId') || tag(block, 'guid') || tag(block, 'id') || link,
        title: tag(block, 'title').replace(/<[^>]+>/g, ''),
        link,
      };
    })
    .filter((item) => item.id);
  return { title: tag(head, 'title'), items };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`le site a répondu ${res.status}`);
  return res.text();
}

// ---------- Twitch ----------

let twitchToken = null; // { value, expires, clientId }
async function twitchHeaders() {
  if (!twitchReady()) throw new Error('le propriétaire du bot doit régler les identifiants Twitch dans l’onglet Alertes réseaux du dashboard');
  const clientId = getSetting('twitchClientId');
  // New token if it expires soon, or if the credentials changed in the dashboard
  if (!twitchToken || twitchToken.clientId !== clientId || twitchToken.expires < Date.now() + 60000) {
    const params = new URLSearchParams({ client_id: clientId, client_secret: getSetting('twitchClientSecret'), grant_type: 'client_credentials' });
    const res = await fetch(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST', signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!data.access_token) throw new Error('identifiants Twitch refusés, vérifie le Client ID et le Client Secret');
    twitchToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000, clientId };
  }
  return { 'Client-Id': clientId, Authorization: `Bearer ${twitchToken.value}` };
}

// Checks the Twitch credentials (dashboard "Tester" button)
async function testTwitch() {
  twitchToken = null;
  await twitchHeaders();
}

async function twitchApi(path) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: await twitchHeaders(), signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Twitch a répondu ${res.status}`);
  return (await res.json()).data;
}

// Live streams for a list of usernames (100 max per call)
async function twitchStreams(logins) {
  const live = new Map();
  for (let i = 0; i < logins.length; i += 100) {
    const params = logins.slice(i, i + 100).map((l) => `user_login=${encodeURIComponent(l)}`).join('&');
    for (const s of await twitchApi(`streams?${params}`)) live.set(s.user_login.toLowerCase(), s);
  }
  return live;
}

// ---------- Adding an alert: find the account and note what already exists (no alert for old content) ----------

async function resolveYoutube(input) {
  const id = /(UC[\w-]{22})/.exec(input)?.[1];
  if (id) return id;
  const handle = /@([\w.-]+)/.exec(input)?.[1] ?? input.replace(/^.*youtube\.com\//, '').replace(/\/.*$/, '');
  const html = await fetchText(`https://www.youtube.com/@${encodeURIComponent(handle)}`).catch(() => '');
  // The page's official URL first: the page also mentions other channels (featured channels…)
  const found =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html)?.[1] ?? /"externalId":"(UC[\w-]{22})"/.exec(html)?.[1];
  if (!found) throw new Error('chaîne YouTube introuvable (mets le lien de la chaîne ou son @pseudo)');
  return found;
}

async function inspect(platform, source) {
  if (platform === 'twitch') {
    const login = source.replace(/^.*twitch\.tv\//, '').replace(/[/?].*$/, '').toLowerCase();
    const [user] = await twitchApi(`users?login=${encodeURIComponent(login)}`);
    if (!user) throw new Error('chaîne Twitch introuvable');
    const live = (await twitchStreams([user.login])).has(user.login);
    return { name: user.display_name, url: `https://www.twitch.tv/${user.login}`, source: user.login, live, seen: [] };
  }
  let url;
  if (platform === 'youtube') url = `https://www.youtube.com/feeds/videos.xml?channel_id=${await resolveYoutube(source)}`;
  else if (platform === 'reddit') url = `https://www.reddit.com/r/${source.replace(/^.*\/r\/|^r\//, '').replace(/\/.*$/, '')}/new/.rss`;
  else url = source;
  if (!/^https?:\/\//.test(url)) throw new Error('mets l’adresse complète du flux RSS (https://…)');

  const feed = parseFeed(await fetchText(url));
  if (!feed.title && !feed.items.length) throw new Error('ce lien n’est pas un flux RSS lisible');
  const name = platform === 'reddit' ? `r/${/\/r\/([^/]+)/.exec(url)[1]}` : feed.title.replace(/ - YouTube$/, '') || source;
  return { name, url, source, live: false, seen: feed.items.slice(0, 30).map((i) => i.id) };
}

async function addFeed(guildId, { platform, source, channelId, roleId, message }) {
  const info = await inspect(platform, source);
  const feed = { id: SnowflakeUtil.generate().toString(), platform, channelId, roleId, message: message || DEFAULT_MESSAGES[platform], error: null, ...info };
  saveFeeds(guildId, [...getFeeds(guildId), feed]);
  return feed;
}

function removeFeed(guildId, id) {
  saveFeeds(guildId, getFeeds(guildId).filter((f) => f.id !== id));
}

// ---------- Sending ----------

const fill = (template, vars) => template.replace(/\{(name|title|link|game)\}/g, (_, key) => vars[key] ?? '');

async function post(guild, feed, vars, embed = null) {
  const channel = guild.channels.cache.get(feed.channelId);
  if (!channel?.isTextBased()) throw new Error('salon introuvable');
  const ping = feed.roleId ? (feed.roleId === guild.id ? '@everyone ' : `<@&${feed.roleId}> `) : '';
  await channel.send({
    // dashboard message, as is (the default message follows the server language: translated before the role ping is added)
    content: keep(`${ping}${fill(defaultsFor(guild)(feed.message), vars)}`, 2000),
    embeds: embed ? [embed] : [],
    allowedMentions: { parse: feed.roleId === guild.id ? ['everyone'] : [], roles: feed.roleId && feed.roleId !== guild.id ? [feed.roleId] : [] },
  });
}

function liveEmbed(feed, stream) {
  return new EmbedBuilder()
    .setColor(0x9146ff)
    .setAuthor({ name: `${feed.name} est en live`, url: feed.url })
    .setTitle(stream.title || 'Live')
    .setURL(feed.url)
    .addFields({ name: 'Jeu', value: stream.game_name || '—', inline: true }, { name: 'Spectateurs', value: `${stream.viewer_count}`, inline: true })
    .setImage(`${stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720')}?t=${Date.now()}`)
    .setTimestamp(new Date(stream.started_at));
}

// Immediately sends the latest post (or the ongoing live) to check that the alert works
async function testFeed(guild, id) {
  const feed = getFeeds(guild.id).find((f) => f.id === id);
  if (!feed) throw new Error('Alerte introuvable.');
  if (feed.platform === 'twitch') {
    const stream = (await twitchStreams([feed.source])).get(feed.source);
    const vars = { name: feed.name, title: stream?.title ?? 'Titre du live', link: feed.url, game: stream?.game_name ?? '' };
    const fake = { title: 'Exemple de live', game_name: 'Jeu', viewer_count: 0, thumbnail_url: 'https://static-cdn.jtvnw.net/ttv-static/404_preview-{width}x{height}.jpg', started_at: new Date().toISOString() };
    return post(guild, { ...feed, roleId: '' }, vars, liveEmbed(feed, stream ?? fake));
  }
  const [item] = parseFeed(await fetchText(feed.url)).items;
  if (!item) throw new Error('Aucune publication pour l’instant.');
  return post(guild, { ...feed, roleId: '' }, { name: feed.name, title: item.title, link: item.link });
}

// ---------- Regular check ----------

async function checkGuild(guild) {
  const feeds = getFeeds(guild.id);
  if (!feeds.length) return;
  let changed = false;

  // Twitch: a single call for all the server's channels
  const twitch = feeds.filter((f) => f.platform === 'twitch');
  let streams = null;
  if (twitch.length && twitchReady()) {
    streams = await twitchStreams(twitch.map((f) => f.source)).catch((error) => {
      for (const f of twitch) f.error = error.message;
      changed = true;
      return null;
    });
  }

  for (const feed of feeds) {
    try {
      if (feed.platform === 'twitch') {
        if (!streams) continue;
        const stream = streams.get(feed.source);
        if (stream && !feed.live) await post(guild, feed, { name: feed.name, title: stream.title, link: feed.url, game: stream.game_name }, liveEmbed(feed, stream));
        if (Boolean(stream) !== feed.live) changed = true;
        feed.live = Boolean(stream);
      } else {
        const { items } = parseFeed(await fetchText(feed.url));
        // Oldest first, 3 max per check so the channel isn't flooded
        const fresh = items.filter((i) => !feed.seen.includes(i.id)).slice(0, 3).reverse();
        for (const item of fresh) await post(guild, feed, { name: feed.name, title: item.title, link: item.link });
        if (fresh.length) {
          feed.seen = [...items.map((i) => i.id), ...feed.seen].filter((id, i, all) => all.indexOf(id) === i).slice(0, 60);
          changed = true;
        }
      }
      if (feed.error) changed = true;
      feed.error = null;
    } catch (error) {
      if (feed.error !== error.message) changed = true;
      feed.error = error.message;
    }
  }

  // Reread just before saving: an alert may have been added or deleted during the check
  if (changed) {
    const updated = new Map(feeds.map((f) => [f.id, f]));
    saveFeeds(guild.id, getFeeds(guild.id).map((f) => (updated.has(f.id) ? { ...f, seen: updated.get(f.id).seen, live: updated.get(f.id).live, error: updated.get(f.id).error } : f)));
  }
}

function startAlerts(client) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    for (const guild of client.guilds.cache.values()) await checkGuild(guild).catch((error) => console.error('Alerts:', error.message));
    running = false;
  };
  setTimeout(run, 10000);
  setInterval(run, 2 * 60 * 1000);
}

module.exports = { getFeeds, addFeed, removeFeed, testFeed, startAlerts, twitchReady, testTwitch, DEFAULT_MESSAGES };

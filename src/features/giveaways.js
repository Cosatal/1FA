const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SnowflakeUtil } = require('discord.js');
const { createStore } = require('../core/store');
const { logActivity } = require('../core/activity');

// Giveaways: a message with a "Participer" button, automatic draw at the end. Created in the dashboard.
// data/giveaways.json = { <guildId>: { list: [{ id, channelId, messageId, prize, description, winners, endsAt, host,
//   requiredRoleId, entrants: [userId], ended, winnerIds }] } }

const store = createStore('giveaways', { list: [] });
const getGiveaways = (guildId) => store.get(guildId).list;
// Read without copy (the entrant list can be long): must not be modified
const peekGiveaways = (guildId) => store.peek(guildId).list;
const saveGiveaways = (guildId, list) => store.save(guildId, { list });

function update(guildId, id, change) {
  const list = getGiveaways(guildId);
  const gw = list.find((g) => g.id === id);
  if (!gw) return null;
  change(gw);
  saveGiveaways(guildId, list);
  return gw;
}

const mentions = (ids) => ids.map((id) => `<@${id}>`).join(', ');
const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

function buildMessage(gw) {
  const lines = [
    gw.description,
    '',
    gw.ended ? `**Terminé** ${ts(gw.endsAt, 'R')}` : `Fin ${ts(gw.endsAt, 'R')} (${ts(gw.endsAt, 'f')})`,
    gw.ended ? `**Gagnant${gw.winnerIds.length > 1 ? 's' : ''} :** ${gw.winnerIds.length ? mentions(gw.winnerIds) : 'personne'}` : `**Gagnant${gw.winners > 1 ? 's' : ''} :** ${gw.winners}`,
    gw.requiredRoleId ? `**Rôle requis :** <@&${gw.requiredRoleId}>` : '',
    `Organisé par **${gw.host}**`,
  ].filter((line, i) => line || i === 1);
  const embed = new EmbedBuilder()
    .setColor(gw.ended ? 0x4e5058 : 0xf5a524)
    .setTitle(`🎉 ${gw.prize}`)
    .setDescription(lines.join('\n').trim())
    .setFooter({ text: `${gw.entrants.length} participant${gw.entrants.length > 1 ? 's' : ''}` })
    .setTimestamp(gw.endsAt);
  const button = new ButtonBuilder()
    .setCustomId(`gw:${gw.id}`)
    .setStyle(gw.ended ? ButtonStyle.Secondary : ButtonStyle.Primary)
    .setEmoji('🎉')
    .setLabel(gw.ended ? 'Terminé' : `Participer (${gw.entrants.length})`)
    .setDisabled(gw.ended);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)], allowedMentions: { parse: [] } };
}

async function fetchMessage(guild, gw) {
  return guild.channels.cache.get(gw.channelId)?.messages.fetch(gw.messageId).catch(() => null);
}

async function createGiveaway(guild, { channelId, prize, description, winners, durationMs, requiredRoleId, host }) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) throw new Error('Salon introuvable.');
  const gw = {
    id: SnowflakeUtil.generate().toString(),
    channelId,
    messageId: null,
    prize,
    description,
    winners,
    endsAt: Date.now() + durationMs,
    host,
    requiredRoleId,
    entrants: [],
    ended: false,
    winnerIds: [],
  };
  try {
    gw.messageId = (await channel.send(buildMessage(gw))).id;
  } catch (error) {
    throw new Error(`Envoi impossible : ${error.message}. Vérifie que le bot peut écrire dans ce salon.`);
  }
  saveGiveaways(guild.id, [...getGiveaways(guild.id), gw]);
  return gw;
}

// Draws among the entrants (excluding those to exclude)
function draw(entrants, count, exclude = []) {
  const pool = entrants.filter((id) => !exclude.includes(id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

async function announce(guild, gw, winnerIds, reroll = false) {
  const message = await fetchMessage(guild, gw);
  const text = winnerIds.length
    ? `🎉 ${reroll ? 'Nouveau tirage ! ' : ''}Félicitations ${mentions(winnerIds)}, tu gagnes **${gw.prize}** !`
    : `😢 Pas assez de participants pour **${gw.prize}**.`;
  const payload = { content: text, allowedMentions: { users: winnerIds } };
  if (message) await message.reply(payload).catch(() => {});
  else await guild.channels.cache.get(gw.channelId)?.send(payload).catch(() => {});
}

async function endGiveaway(guild, id) {
  const gw = update(guild.id, id, (g) => {
    if (g.ended) throw new Error('Ce giveaway est déjà terminé.');
    g.ended = true;
    g.endsAt = Math.min(g.endsAt, Date.now());
    g.winnerIds = draw(g.entrants, g.winners);
  });
  if (!gw) throw new Error('Giveaway introuvable.');
  const message = await fetchMessage(guild, gw);
  await message?.edit(buildMessage(gw)).catch(() => {});
  await announce(guild, gw, gw.winnerIds);
  return gw;
}

// Reroll: a single new winner, among those who haven't won yet
async function rerollGiveaway(guild, id) {
  let picked = [];
  const gw = update(guild.id, id, (g) => {
    if (!g.ended) throw new Error('Termine le giveaway avant de refaire un tirage.');
    picked = draw(g.entrants, 1, g.winnerIds);
    g.winnerIds.push(...picked);
  });
  if (!gw) throw new Error('Giveaway introuvable.');
  if (!picked.length) throw new Error('Plus personne à tirer au sort.');
  await announce(guild, gw, picked, true);
  return gw;
}

async function deleteGiveaway(guild, id) {
  const gw = getGiveaways(guild.id).find((g) => g.id === id);
  if (!gw) throw new Error('Giveaway introuvable.');
  const message = await fetchMessage(guild, gw);
  await message?.delete().catch(() => {});
  saveGiveaways(guild.id, getGiveaways(guild.id).filter((g) => g.id !== id));
}

// The button counter is updated at most every 3 seconds (Discord limits message edits)
const pendingEdits = new Map();
function scheduleEdit(guild, id) {
  if (pendingEdits.has(id)) return;
  pendingEdits.set(
    id,
    setTimeout(async () => {
      pendingEdits.delete(id);
      const gw = peekGiveaways(guild.id).find((g) => g.id === id);
      if (gw && !gw.ended) await (await fetchMessage(guild, gw))?.edit(buildMessage(gw)).catch(() => {});
    }, 3000),
  );
}

// Click on "Participer": joins, or leaves if the person was already entered
async function handleGiveawayButton(interaction) {
  const id = interaction.customId.split(':')[1];
  const gw = peekGiveaways(interaction.guild.id).find((g) => g.id === id);
  if (!gw || gw.ended) return interaction.reply({ content: 'Ce giveaway est terminé.', flags: MessageFlags.Ephemeral });
  if (gw.requiredRoleId && !interaction.member.roles.cache.has(gw.requiredRoleId)) {
    return interaction.reply({ content: `Il faut le rôle <@&${gw.requiredRoleId}> pour participer.`, flags: MessageFlags.Ephemeral });
  }

  let joined = false;
  update(interaction.guild.id, id, (g) => {
    joined = !g.entrants.includes(interaction.user.id);
    g.entrants = joined ? [...g.entrants, interaction.user.id] : g.entrants.filter((u) => u !== interaction.user.id);
  });
  scheduleEdit(interaction.guild, id);
  await interaction.reply({
    content: joined ? `🎉 Tu participes au giveaway **${gw.prize}** ! Bonne chance.` : `Tu ne participes plus au giveaway **${gw.prize}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

// Checks every 15 seconds for giveaways that have ended (also works after a restart)
function startGiveawayTimer(client) {
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      const due = peekGiveaways(guild.id).filter((gw) => !gw.ended && gw.endsAt <= Date.now());
      for (const gw of due) {
        await endGiveaway(guild, gw.id).catch((error) => console.error('Giveaway end:', error.message));
        logActivity(guild.id, { source: 'bot', action: 'giveaway.auto_ended', title: `Giveaway « ${gw.prize} » terminé automatiquement` });
      }
    }
  }, 15000);
}

module.exports = { getGiveaways, createGiveaway, endGiveaway, rerollGiveaway, deleteGiveaway, handleGiveawayButton, startGiveawayTimer };

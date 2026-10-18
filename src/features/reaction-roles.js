const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, parseEmoji } = require('discord.js');
const { createStore } = require('../core/store');
const { keep } = require('../dashboard/public/i18n');
const { PANEL_COLOR } = require('../core/credits');

// Reaction roles: messages ("panels") where members give themselves roles.
// Three formats: buttons, dropdown or emoji reactions. Panels are created in the dashboard. Color: PANEL_COLOR (credits.js).
// data/reaction-roles.json = { <guildId>: { panels: [{ id, channelId, messageId, mode, title, description, unique, roles: [{ roleId, emoji, label }] }] } }

const store = createStore('reaction-roles', { panels: [] });

const getPanels = (guildId) => store.get(guildId).panels;
function savePanels(guildId, panels) {
  store.save(guildId, { panels });
}

// Custom emoji <:name:id> → its id, Unicode emoji → itself: used to compare with a reaction
const emojiKey = (text) => /^<a?:\w+:(\d+)>$/.exec(text)?.[1] ?? text;

function buildMessage(guild, panel) {
  const lines = panel.roles.map((r) => `${r.emoji ? `${r.emoji} ` : ''}<@&${r.roleId}>`);
  const embed = new EmbedBuilder()
    .setColor(PANEL_COLOR)
    // Texts written in the dashboard: sent as is, never translated (keep)
    .setTitle(keep(panel.title, 256))
    .setDescription(keep([panel.description, panel.mode === 'reactions' ? lines.join('\n') : ''].filter(Boolean).join('\n\n') || '​', 4096))
    .setFooter({ text: panel.unique ? 'Un seul rôle à la fois' : guild.name });

  const label = (r) => keep(r.label || guild.roles.cache.get(r.roleId)?.name || 'Rôle', 80);
  let components = [];
  if (panel.mode === 'buttons') {
    for (let i = 0; i < panel.roles.length; i += 5) {
      components.push(
        new ActionRowBuilder().addComponents(
          panel.roles.slice(i, i + 5).map((r) => {
            const button = new ButtonBuilder().setCustomId(`rr:${panel.id}:${r.roleId}`).setStyle(ButtonStyle.Secondary).setLabel(label(r).slice(0, 80));
            if (r.emoji) button.setEmoji(parseEmoji(r.emoji));
            return button;
          }),
        ),
      );
    }
  } else if (panel.mode === 'select') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rr:${panel.id}`)
      .setPlaceholder('Choisis tes rôles…')
      .setMinValues(0)
      .setMaxValues(panel.unique ? 1 : panel.roles.length)
      .addOptions(panel.roles.map((r) => ({ label: label(r).slice(0, 100), value: r.roleId, ...(r.emoji && { emoji: parseEmoji(r.emoji) }) })));
    components = [new ActionRowBuilder().addComponents(menu)];
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

// Posts the panel, or updates the message already posted if it's still in the same channel
async function publishPanel(guild, panel) {
  const channel = guild.channels.cache.get(panel.channelId);
  if (!channel?.isTextBased()) throw new Error('Salon introuvable.');
  const payload = buildMessage(guild, panel);

  let message = panel.messageId ? await channel.messages.fetch(panel.messageId).catch(() => null) : null;
  try {
    message = message ? await message.edit(payload) : await channel.send(payload);
  } catch (error) {
    throw new Error(`Envoi impossible : ${error.message}. Vérifie que le bot peut écrire dans ce salon.`);
  }

  if (panel.mode === 'reactions') {
    // Removes the reactions of deleted roles, then adds the missing ones
    const keys = panel.roles.map((r) => emojiKey(r.emoji));
    for (const reaction of message.reactions.cache.values()) {
      if (!keys.includes(reaction.emoji.id ?? reaction.emoji.name)) await reaction.remove().catch(() => {});
    }
    for (const r of panel.roles) await message.react(r.emoji).catch(() => {});
  } else if (message.reactions.cache.size) {
    await message.reactions.removeAll().catch(() => {});
  }
  return message.id;
}

async function deletePanel(guild, panel) {
  const message = await guild.channels.cache.get(panel.channelId)?.messages.fetch(panel.messageId).catch(() => null);
  await message?.delete().catch(() => {});
}

// Gives or removes a role. unique: removes the panel's other roles when one is taken
async function setRole(member, panel, roleId, give) {
  const role = member.guild.roles.cache.get(roleId);
  if (!role) throw new Error('Ce rôle n’existe plus.');
  if (!role.editable) throw new Error(`Je ne peux pas donner le rôle ${role.name} : il est au-dessus du mien, ou il me manque « Gérer les rôles ».`);
  if (give) {
    if (panel.unique) {
      const others = panel.roles.map((r) => r.roleId).filter((id) => id !== roleId && member.roles.cache.has(id));
      if (others.length) await member.roles.remove(others, 'Rôles-réactions');
    }
    await member.roles.add(role, 'Rôles-réactions');
  } else {
    await member.roles.remove(role, 'Rôles-réactions');
  }
  return role;
}

// ---------- Buttons and menu ----------

async function handleRoleComponent(interaction) {
  const [, panelId, roleId] = interaction.customId.split(':');
  const panel = getPanels(interaction.guild.id).find((p) => p.id === panelId);
  if (!panel) return interaction.reply({ content: 'Ce panneau n’existe plus.', flags: MessageFlags.Ephemeral });
  const { member } = interaction;

  try {
    if (interaction.isButton()) {
      const has = member.roles.cache.has(roleId);
      const role = await setRole(member, panel, roleId, !has);
      return interaction.reply({ content: has ? `➖ Rôle **${role.name}** retiré.` : `✅ Rôle **${role.name}** ajouté.`, flags: MessageFlags.Ephemeral });
    }

    // Menu: chosen roles are added, the panel's other roles removed
    const chosen = new Set(interaction.values);
    const added = [];
    const removed = [];
    for (const r of panel.roles) {
      const has = member.roles.cache.has(r.roleId);
      if (chosen.has(r.roleId) && !has) added.push((await setRole(member, { ...panel, unique: false }, r.roleId, true)).name);
      if (!chosen.has(r.roleId) && has) removed.push((await setRole(member, panel, r.roleId, false)).name);
    }
    const summary = [added.length && `✅ Ajouté : ${added.join(', ')}`, removed.length && `➖ Retiré : ${removed.join(', ')}`].filter(Boolean).join('\n');
    return interaction.reply({ content: summary || 'Aucun changement.', flags: MessageFlags.Ephemeral });
  } catch (error) {
    return interaction.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral });
  }
}

// ---------- Emoji reactions ----------

async function handleReaction(reaction, user, added) {
  if (user.bot) return;
  // The message id and the emoji are known even for an uncached reaction: check that it's a panel
  // before asking Discord anything (otherwise every reaction on the server would cost a call)
  const guild = reaction.message.guild;
  if (!guild) return;
  const panel = store.peek(guild.id).panels.find((p) => p.mode === 'reactions' && p.messageId === reaction.message.id);
  const entry = panel?.roles.find((r) => emojiKey(r.emoji) === (reaction.emoji.id ?? reaction.emoji.name));
  if (!entry) return;
  if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
  if (!reaction) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  try {
    await setRole(member, panel, entry.roleId, added);
    // One role at a time: also remove their other reactions on the panel
    if (added && panel.unique) {
      for (const r of reaction.message.reactions.cache.values()) {
        if (r !== reaction && r.users.cache.has(user.id)) await r.users.remove(user.id).catch(() => {});
      }
    }
  } catch (error) {
    console.error('Reaction roles:', error.message);
  }
}

module.exports = { getPanels, savePanels, publishPanel, deletePanel, handleRoleComponent, handleReaction };

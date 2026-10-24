const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getFeature, fillVars } = require('../core/feature-config');
const { keep } = require('../dashboard/public/i18n');
const { defaultsFor } = require('../core/language');
const { t } = require('../core/i18n');

// Custom commands: created in the dashboard, registered as slash commands of that server only.

// The default description follows the server language (the commands are synced again on every startup)
async function syncCustomCommands(guild, list = getFeature(guild.id, 'commands').list) {
  const defaults = defaultsFor(guild);
  await guild.commands.set(list.map((c) => ({ name: c.name, description: defaults(c.description || 'Commande personnalisée') })));
}

// On startup: only the servers that have some (avoids one call to Discord per server)
async function syncAllCustomCommands(client) {
  for (const guild of client.guilds.cache.values()) {
    if (getFeature(guild.id, 'commands').list.length) await syncCustomCommands(guild).catch((e) => console.error(`Custom commands (${guild.name}):`, e.message));
  }
}

// Checks the names before saving: unique and different from the bot's commands
function checkCustomCommands(list, builtIn) {
  const seen = new Set();
  for (const c of list) {
    if (builtIn.has(c.name)) throw new Error(t('customCommands.already_exists_bot_choose_another', { name: c.name }));
    if (seen.has(c.name)) throw new Error(t('customCommands.two_commands_are_named', { name: c.name }));
    seen.add(c.name);
  }
}

async function handleCustomCommand(interaction) {
  const command = getFeature(interaction.guild.id, 'commands').list.find((c) => c.name === interaction.commandName);
  if (!command) {
    // Command deleted but still shown by Discord (the "/" menu takes a little while to update)
    await interaction.reply({ content: t('customCommands.this_command_no_longer_exists'), flags: MessageFlags.Ephemeral });
    return false;
  }
  const { member, guild } = interaction;
  let text = fillVars(command.response, { user: `${member}`, name: member.displayName, server: guild.name, channel: `${interaction.channel}` });

  // Role given, or removed if the person already has it
  const role = command.roleId && guild.roles.cache.get(command.roleId);
  if (role?.editable) {
    const has = member.roles.cache.has(role.id);
    const ok = await (has ? member.roles.remove(role) : member.roles.add(role)).then(() => true).catch(() => false);
    if (ok) text += `\n${has ? '➖' : '➕'} ${role}`;
  }

  // Reply written in the dashboard: sent as is, never translated (keep)
  const payload = command.embed
    ? { embeds: [new EmbedBuilder().setColor(parseInt(command.color.slice(1), 16)).setDescription(keep(text, 4096))] }
    : { content: keep(text, 2000) };
  await interaction.reply({ ...payload, allowedMentions: { users: [member.id] }, ...(command.ephemeral && { flags: MessageFlags.Ephemeral }) });
  return true;
}

module.exports = { syncCustomCommands, syncAllCustomCommands, checkCustomCommands, handleCustomCommand };

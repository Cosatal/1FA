// Public identity of the bot: invite link (with the required permissions), status and "Made by" credit.
const { ActivityType, OAuth2Scopes, PermissionFlagsBits } = require('discord.js');

// Permissions requested when someone adds the bot to their server (all dashboard modules)
const INVITE_PERMISSIONS = [
  'ViewChannel', 'SendMessages', 'SendPolls', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions',
  'UseExternalEmojis', 'MentionEveryone', 'ManageMessages', 'ManageChannels', 'ManageRoles', 'ManageGuild',
  'KickMembers', 'BanMembers', 'ModerateMembers', 'ViewAuditLog', 'MoveMembers', 'Connect', 'CreatePublicThreads', 'SendMessagesInThreads',
  'ManageWebhooks', // staff messages in tickets, shown with their name, avatar and role
].reduce((all, name) => all | PermissionFlagsBits[name], 0n);

// Link to add the bot to a server (guildId: preselected server)
function inviteUrl(client, guildId) {
  return client.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: INVITE_PERMISSIONS,
    ...(guildId && { guild: guildId, disableGuildSelect: true }),
  });
}

// Displayed creator: a plain name, never linked to a Discord account (no mention, no id)
const CREATOR = 'cosatal';
// Color of every panel posted by the bot (tickets, reaction roles): the 1FA red, not configurable
const PANEL_COLOR = 0xed4245;
// Official source code: 1FA is free, anyone who paid for a copy was scammed (shown in /bot-info, the dashboard and the console)
const OFFICIAL_URL = 'https://github.com/Cosatal/1FA';

// Signature visible to everyone: bot status and the "About me" of its profile ("Made by …" at the end)
async function applyBranding(client) {
  client.user.setPresence({ activities: [{ type: ActivityType.Custom, name: 'custom', state: `Made by ${CREATOR} • /bot-info` }] });
  await client.application.fetch();
  const description = client.application.description ?? '';
  const credit = `Made by ${CREATOR} • 100% free: ${OFFICIAL_URL}`;
  // Only one credit, always at the end (older "Créé par …" / "Made by …" lines are replaced)
  const clean = description.replace(/\s*(Créé par|Made by) [^\n]*/g, '').trim();
  const wanted = `${clean}\n\n${credit}`.trim().slice(0, 400);
  if (wanted !== description.trim()) {
    await client.application.edit({ description: wanted }).catch((e) => console.error('Bot description not updated:', e.message));
  }
}

module.exports = { CREATOR, OFFICIAL_URL, PANEL_COLOR, inviteUrl, applyBranding };

// Bot entry point (npm start): connects to Discord, loads the commands of the commands/ folder,
// starts the web dashboard and the recurring tasks, then routes each Discord event to its module.
// This file contains almost no logic: each feature lives in its own file (see ARCHITECTURE.md).
const fs = require('node:fs');
const path = require('node:path');
const { ApplicationFlags, Client, Collection, Events, GatewayIntentBits, MessageFlags, Options, Partials } = require('discord.js');
const { handleMemberJoin, handleMemberLeave } = require('./features/welcome/welcome-card');
const { handleCaptcha } = require('./features/welcome/captcha');
const { startDashboard } = require('./dashboard/server');
const { handleDm, handleTicketComponent } = require('./features/tickets/tickets');
const { handleTicketPanel, handleTicketChannelMessage, handleTicketChannelDelete, restoreTicketChannels } = require('./features/tickets/ticket-channels');
const { handleRoleComponent, handleReaction } = require('./features/reaction-roles');
const { handleGiveawayButton, startGiveawayTimer } = require('./features/giveaways');
const { startAlerts } = require('./features/alerts');
const { refuseBlocked, startTempbanTimer } = require('./features/moderation/moderation');
const { registerLogs } = require('./features/moderation/logs');
const { CREATOR, OFFICIAL_URL, applyBranding } = require('./core/credits');
const { handleLevelMessage, startVoiceXp } = require('./features/levels');
const { handleCustomCommand, syncAllCustomCommands } = require('./features/custom-commands');
const { startAutoMessages, handleTempVoice, cleanTempVoice, startCounters } = require('./features/server-tools');
const { handleSuggestion, handleStarReaction, startBirthdays } = require('./features/community');
const { guardJoin, startAntiRaid, startQuarantine, handleQuarantineButton, startInvites, handleInviteCreate, trackJoin, trackLeave } = require('./features/moderation/guard');
const { handleAppeal } = require('./features/moderation/cases');
const { startLockdowns } = require('./features/moderation/lockdown');
const { queueAiModeration, handleAiModButton, startAiModeration } = require('./features/moderation/ai-moderation');
const { installTranslator } = require('./core/language');
const { handleFlagReaction } = require('./features/ai/ai-tools');
const { startGameServers, handleWhitelistRoles, handleWhitelistLeave } = require('./features/game-servers/game-servers');
const { countMessage, countJoin, countLeave } = require('./features/stats');
const { startTempRoles } = require('./features/temp-roles');
const { startScheduledAnnouncements } = require('./dashboard/announce');
const { logActivity } = require('./core/activity');

// A forgotten error somewhere must not stop the whole bot
process.on('unhandledRejection', (error) => console.error('Unhandled error:', error));
// Ctrl+C, or stop by the host (SIGTERM: pm2, systemd, Docker…): the connection to Discord is closed properly,
// then the bot exits (everything not saved yet is written on exit, see store.js). 5 seconds max
let client = null;
const shutdown = () => {
  setTimeout(() => process.exit(0), 5000).unref();
  Promise.resolve(client?.destroy()).finally(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

// Privileged intents enabled in the Developer Portal (Bot tab). Requesting them without having enabled them
// would make Discord refuse the connection: so first check what the application is allowed to use
async function privilegedIntents() {
  const res = await fetch('https://discord.com/api/v10/applications/@me', { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } }).catch(() => null);
  const flags = (await res?.json().catch(() => null))?.flags ?? 0;
  const has = (...names) => names.some((n) => (flags & ApplicationFlags[n]) !== 0);
  return {
    members: has('GatewayGuildMembers', 'GatewayGuildMembersLimited'), // welcome, joins/leaves, nicknames, member roles
    content: has('GatewayMessageContent', 'GatewayMessageContentLimited'), // text of edited/deleted messages, invites
  };
}

async function main() {
  const privileged = await privilegedIntents();
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages, // reply to DMs that tickets are done on the server
    GatewayIntentBits.GuildMessageReactions, // reaction roles in "emoji reactions" format
    GatewayIntentBits.GuildMessages, // logs of edited / deleted messages
    GatewayIntentBits.GuildModeration, // ban logs
    GatewayIntentBits.GuildVoiceStates, // voice logs
    GatewayIntentBits.GuildExpressions, // emoji logs
    GatewayIntentBits.GuildInvites, // invite tracking
    ...(privileged.members ? [GatewayIntentBits.GuildMembers] : []),
    ...(privileged.content ? [GatewayIntentBits.MessageContent] : []),
  ];
  if (!privileged.members) console.log('Server Members Intent disabled: no welcome messages or member logs.');
  if (!privileged.content) console.log('Message Content Intent disabled: logs won’t see the text of messages.');

  // Partials: without them, discord.js ignores DMs and reactions on messages not cached yet (e.g. after a restart)
  client = new Client({
    intents,
    partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User, Partials.GuildMember],
    // Memory: 50 messages kept per channel instead of 200 (they are used for the "message edited / deleted" logs),
    // and those older than 2 hours are forgotten. On many servers, this is most of the bot's memory
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 50 }),
    sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 1800, lifetime: 7200 } },
  });
  // English servers: everything the bot sends is translated (language.js)
  installTranslator(client);

  // Loads every command of the commands/ folder
  client.commands = new Collection();
  const commandsPath = path.join(__dirname, 'commands');
  for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    client.commands.set(command.data.name, command);
  }

  client.once(Events.ClientReady, (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    console.log(`1FA is 100% free (made by ${CREATOR}). If you paid for this bot, you were scammed: ${OFFICIAL_URL}`);
    restoreTicketChannels(client);
    startDashboard(client);
    startGiveawayTimer(client);
    startTempbanTimer(client);
    startAlerts(client);
    applyBranding(client).catch((e) => console.error('Bot branding:', e.message));
    startVoiceXp(client);
    startAutoMessages(client);
    startCounters(client);
    startBirthdays(client);
    startAntiRaid(client);
    startQuarantine(client);
    startLockdowns(client);
    startAiModeration(client);
    startGameServers(client);
    startTempRoles(client);
    startScheduledAnnouncements(client);
    startInvites(client).catch(console.error);
    cleanTempVoice(client).catch(console.error);
    syncAllCustomCommands(client).catch(console.error);
  });

  client.on(Events.Error, (error) => console.error('Discord client error:', error.message));
  registerLogs(client);

  // Reaction roles ("emoji reactions" format)
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    handleReaction(reaction, user, true).catch(console.error);
    handleStarReaction(reaction);
    handleFlagReaction(reaction, user).catch(console.error); // AI translation (flag reaction)
  });
  client.on(Events.MessageReactionRemove, (reaction, user) => {
    handleReaction(reaction, user, false).catch(console.error);
    handleStarReaction(reaction);
  });

  // Messages: XP on servers and ticket channels (copied to the /staff panel, AI assistant).
  // In DMs: the bot says that tickets are done on the server
  client.on(Events.MessageCreate, (message) => {
    if (message.author.bot) return;
    if (message.guild) {
      countMessage(message); // dashboard statistics
      queueAiModeration(message); // AI moderation: analyzed by batches
      handleTicketChannelMessage(message).catch(console.error);
      return handleLevelMessage(message).catch(console.error);
    }
    handleDm(message).catch(console.error);
  });
  client.on(Events.ChannelDelete, handleTicketChannelDelete);

  // Joins: anti-raid first (a kicked account isn't welcomed), then invites and welcome
  client.on(Events.GuildMemberAdd, async (member) => {
    countJoin(member);
    try {
      if (await guardJoin(member)) return;
      await Promise.all([trackJoin(member), handleMemberJoin(member)]);
    } catch (error) {
      console.error(error);
    }
  });
  client.on(Events.GuildMemberRemove, (member) => {
    countLeave(member);
    trackLeave(member);
    handleMemberLeave(member).catch(console.error);
    handleWhitelistLeave(member).catch(console.error); // removed from the game servers' whitelist
  });
  // Game servers whitelist role gained or lost
  client.on(Events.GuildMemberUpdate, (before, after) => handleWhitelistRoles(before, after).catch(console.error));
  client.on(Events.InviteCreate, handleInviteCreate);

  // Temporary voice channels
  client.on(Events.VoiceStateUpdate, (oldState, newState) => handleTempVoice(oldState, newState).catch(console.error));

  // Buttons, menus and modals, by the start of their id: tickets (tk:; mm_ and ticket_ = old messages), reaction roles, giveaways, captcha, suggestions,
  // appeals (appeal:, also in DMs), quarantine (qr:) and AI moderation reports (aimod:)
  const COMPONENTS = {
    mm_: handleTicketComponent, ticket_: handleTicketComponent, 'tk:': handleTicketPanel, 'rr:': handleRoleComponent, 'gw:': handleGiveawayButton, 'cap:': handleCaptcha, 'sug:': handleSuggestion,
    'appeal:': handleAppeal, 'qr:': handleQuarantineButton, 'aimod:': handleAiModButton,
  };

  // An error in a button or a command: tell the person instead of leaving "The application did not respond"
  async function failed(interaction, error) {
    console.error(error);
    const reply = { content: 'Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu() || interaction.isModalSubmit()) {
      const handler = Object.entries(COMPONENTS).find(([prefix]) => interaction.customId.startsWith(prefix))?.[1];
      try {
        await handler?.(interaction);
      } catch (error) {
        await failed(interaction, error);
      }
      return;
    }

    // Slash commands and right-click on a message (Apps → Traduire)
    if (!interaction.isChatInputCommand() && !interaction.isMessageContextMenuCommand()) return;
    // The bot's commands work on a server (in DMs, Discord no longer offers them, but an old list may remain)
    if (!interaction.inCachedGuild()) {
      return interaction.reply({ content: 'Cette commande s’utilise sur un serveur.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const command = client.commands.get(interaction.commandName);
    try {
      // Not a bot command: maybe a custom command of the server
      if (!command) {
        await handleCustomCommand(interaction);
        return logCommand(interaction);
      }
      // Command disabled or limited to some channels / roles in the dashboard
      if (await refuseBlocked(interaction)) return;
      await command.execute(interaction);
      logCommand(interaction);
    } catch (error) {
      await failed(interaction, error);
    }
  });

  // Logs tab of the dashboard: who used which command, with its options
  function logCommand(interaction) {
    const name = interaction.isMessageContextMenuCommand()
      ? `« ${interaction.commandName} » sur un message`
      : `/${[interaction.commandName, interaction.options.getSubcommandGroup(false), interaction.options.getSubcommand(false)].filter(Boolean).join(' ')}`;
    const options = {};
    const read = (list) => {
      for (const o of list ?? []) {
        if (o.options) read(o.options);
        else options[o.name] = o.user?.tag ?? o.role?.name ?? o.channel?.name ?? o.value;
      }
    };
    read(interaction.options.data);
    logActivity(interaction.guildId, {
      source: 'discord',
      action: `command.${interaction.commandName}`,
      title: `${interaction.member.displayName} a utilisé ${name}`,
      author: interaction.member,
      data: Object.keys(options).length ? { salon: interaction.channel?.name, ...options } : { salon: interaction.channel?.name },
    });
  }

  await client.login(process.env.DISCORD_TOKEN);
}

main().catch((error) => {
  // Invalid token, no Internet…: no point staying on without being connected
  console.error('Unable to start:', error.message);
  process.exit(1);
});

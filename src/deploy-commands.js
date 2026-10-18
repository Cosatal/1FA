// Registers the slash commands of the commands/ folder with Discord (npm run deploy).
// Run it again after adding a command or changing its name, options or description (not for the rest of the code).
// English names and descriptions are added by core/locales.js.
const fs = require('node:fs');
const path = require('node:path');
const { ApplicationIntegrationType, InteractionContextType, REST, Routes } = require('discord.js');
const { localize } = require('./core/locales');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
// npm run deploy -- --test: only on GUILD_ID (instant, for testing)
const testOnly = process.argv.includes('--test');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const data = localize(require(path.join(commandsPath, file)).data.toJSON());
  // Every command is meant for a server: they aren't offered in DMs with the bot
  commands.push({ ...data, contexts: [InteractionContextType.Guild], integration_types: [ApplicationIntegrationType.GuildInstall] });
}

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    if (testOnly) {
      const data = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      return console.log(`${data.length} command(s) registered on the test server.`);
    }
    // Global commands: available on every server that adds the bot
    const data = await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`${data.length} command(s) registered for every server.`);
    // Server commands (custom commands) aren't touched: the bot updates them on startup
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();

// English version of the slash commands: Discord shows these names and descriptions to every member whose Discord isn't in French.
// Key = command, command.subcommand, command.option or command.subcommand.option; "*.option" applies to every command.
// Value = [English name (null = unchanged), English description]

const EN = {
  '*.membre': ['member', 'The member'],
  '*.raison': ['reason', 'The reason'],
  '*.durée': ['duration', 'Duration, e.g. 10m, 2h, 3d'],

  avatar: [null, 'Show a member’s avatar in full size'],
  'avatar.membre': ['member', 'The member (you by default)'],
  ban: [null, 'Ban a member from the server'],
  'ban.membre': ['member', 'The member to ban'],
  'bot-info': [null, 'About the bot'],
  clear: [null, 'Delete messages in a channel'],
  'clear.nombre': ['amount', 'Number of messages (1 to 100)'],
  'clear-all-infractions': [null, 'Delete every infraction of every member of the server'],
  'clear-all-infractions.confirmer': ['confirm', 'Choose “True” to confirm: this cannot be undone'],
  infractions: [null, 'Show a member’s infractions'],
  'infractions.effacer': ['clear', 'Delete all of their infractions'],
  kick: [null, 'Kick a member from the server'],
  'kick.membre': ['member', 'The member to kick'],
  mute: [null, 'Mute a member (28 days, Discord’s maximum)'],
  'role-info': [null, 'Get information about a role'],
  'role-info.rôle': ['role', 'The role'],
  'server-info': [null, 'Get information about the server'],
  slowmode: [null, 'Turn slow mode on or off in a channel'],
  'slowmode.durée': ['delay', 'Delay between two messages, e.g. 5s, 1m, 1h (0 or off to disable)'],
  tempban: [null, 'Temporarily ban a member from the server'],
  'tempban.membre': ['member', 'The member to ban'],
  'tempban.durée': ['duration', 'E.g. 30m, 12h, 7d, 2w'],
  tempmute: [null, 'Temporarily mute a member'],
  'tempmute.durée': ['duration', 'E.g. 10m, 2h, 3d (28 days max)'],
  tickets: [null, 'List a member’s tickets (staff)'],
  unban: [null, 'Unban a member'],
  'unban.id': [null, 'The ID of the banned member'],
  unmute: [null, 'Unmute a member'],
  'user-info': [null, 'Get information about a member'],
  'user-info.membre': ['member', 'The member (you by default)'],
  warn: [null, 'Warn a member'],

  rank: [null, 'See your level and XP'],
  'rank.membre': ['member', 'The member (you by default)'],
  leaderboard: [null, 'Ranking of the most active members'],
  'leaderboard.page': [null, 'Leaderboard page'],
  xp: [null, 'Manage members’ XP'],
  'xp.ajouter': ['add', 'Give XP'],
  'xp.ajouter.montant': ['amount', 'XP to give'],
  'xp.retirer': ['remove', 'Remove XP'],
  'xp.retirer.montant': ['amount', 'XP to remove'],
  'xp.niveau': ['level', 'Set a member to a specific level'],
  'xp.niveau.niveau': ['level', 'The level'],
  'xp.reset': [null, 'Reset a member’s XP to zero'],
  suggestion: [null, 'Suggest an idea for the server'],
  'suggestion.idee': ['idea', 'Your idea'],
  anniversaire: ['birthday', 'Your birthday on the server'],
  'anniversaire.definir': ['set', 'Save your birthday'],
  'anniversaire.definir.jour': ['day', 'Day (1 to 31)'],
  'anniversaire.definir.mois': ['month', 'Month (1 to 12)'],
  'anniversaire.voir': ['view', 'See a member’s birthday'],
  'anniversaire.voir.membre': ['member', 'The member (you by default)'],
  'anniversaire.supprimer': ['remove', 'Remove your birthday'],
  'anniversaire.prochains': ['upcoming', 'Upcoming birthdays on the server'],
  resume: ['summary', 'Summarize the channel’s latest messages with AI'],
  'resume.nombre': ['amount', 'Number of messages to summarize (50 by default)'],
  'resume.public': [null, 'Show the summary to everyone (otherwise only you see it)'],
  traduire: ['translate', 'Translate a text with AI'],
  'traduire.texte': ['text', 'The text to translate'],
  'traduire.langue': ['language', 'Target language (default: your Discord language)'],
  'traduire.prive': ['private', 'Only you see the translation'],
  Traduire: ['Translate', null],
  image: [null, 'Create an image with AI'],
  'image.description': [null, 'What the image should show'],
  'role-temporaire': ['temp-role', 'Give a role for a limited time'],
  'role-temporaire.donner': ['give', 'Give a temporary role'],
  'role-temporaire.donner.rôle': ['role', 'The role'],
  'role-temporaire.donner.durée': ['duration', 'E.g. 2h, 7d, 1w (1 year max)'],
  'role-temporaire.retirer': ['remove', 'Remove a temporary role right now'],
  'role-temporaire.retirer.rôle': ['role', 'The role'],
  'role-temporaire.liste': ['list', 'Current temporary roles'],
  'pseudo-jeu': ['game-name', 'Link your Discord account to your name on the game servers'],
  'pseudo-jeu.lier': ['link', 'Save (or change) your in-game name'],
  'pseudo-jeu.lier.pseudo': ['name', 'Your exact in-game name'],
  'pseudo-jeu.retirer': ['remove', 'Remove your in-game name (and your whitelist spot)'],
  'pseudo-jeu.voir': ['view', 'See a member’s in-game name'],
  'pseudo-jeu.voir.membre': ['member', 'The member (you by default)'],
  invites: [null, 'Member invites'],
  'invites.voir': ['view', 'How many members someone invited'],
  'invites.voir.membre': ['member', 'The member (you by default)'],
  'invites.classement': ['top', 'The server’s best inviters'],
};

// The commands are written in French in the code: every Discord language except French gets the English version
const LOCALES = [
  'en-US', 'en-GB', 'bg', 'cs', 'da', 'de', 'el', 'es-ES', 'es-419', 'fi', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko',
  'lt', 'nl', 'no', 'pl', 'pt-BR', 'ro', 'ru', 'sv-SE', 'th', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW',
];
const allButFrench = (text) => Object.fromEntries(LOCALES.map((locale) => [locale, text]));

// Adds the translations to a command (discord.js JSON format), options and subcommands included
function localize(item, path = item.name) {
  const [name, description] = EN[path] ?? EN[`*.${item.name}`] ?? [];
  if (name) item.name_localizations = allButFrench(name);
  if (description) item.description_localizations = allButFrench(description);
  for (const option of item.options ?? []) localize(option, `${path}.${option.name}`);
  return item;
}

module.exports = { localize };

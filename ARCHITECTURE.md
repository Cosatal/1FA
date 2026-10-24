# How 1FA is built

This guide explains how the bot is organized, so you can find your way around the code and change it.
Every file also starts with a short comment explaining what it does.

> Code comments are in English. The texts the bot sends (messages, buttons, dashboard labels) are written in **French**
> in the code, and translated into English automatically on English servers (see [Languages](#languages)).

## The big picture

1FA is **one Node.js program** that does two things at once:

1. **The Discord bot** ([discord.js](https://discord.js.org)): it listens to Discord events (messages, new members,
   buttons, slash commands…) and reacts to them.
2. **The web dashboard** ([Express](https://expressjs.com)): a website, started by the bot, where server admins
   change the settings. It shares the bot's memory, so a setting saved in the dashboard is used by the bot instantly.

There is **no database**: everything is saved as JSON files in the `data/` folder (see [Data](#data)).

```
Discord  ⇄  src/index.js  →  src/features/…  ⇄  data/*.json
                                    ⇅
Browser  ⇄  src/dashboard/server.js (+ routes)  →  src/dashboard/public/ (pages)
```

## Project layout

```
.env.example          settings to copy into .env (token, keys…)
data/                 all saved data (created on first launch, never share it)
src/
├── index.js          entry point (npm start)
├── deploy-commands.js  registers the slash commands (npm run deploy)
├── core/             shared tools used by every feature
├── features/         one file (or folder) per feature of the bot
├── commands/         one file per slash command
└── dashboard/        the web dashboard
    └── public/       the pages sent to the browser (HTML, CSS, JS)
```

### `src/core/`: shared tools

| File | Role |
|---|---|
| `store.js` | Saving and loading the JSON files in `data/`. Used by almost every feature. |
| `feature-config.js` | Settings of the simpler features, described as a **schema** (see [Adding a feature](#adding-a-simple-feature)). |
| `settings.js` | Global settings of the bot owner (API keys), and each server's own AI keys. |
| `language.js` | Server language, and automatic translation of everything the bot sends. |
| `locales.js` | English names and descriptions of the slash commands. |
| `credits.js` | Invite link, bot status and "Made by" credit. |
| `public-fetch.js` | Safe web requests to addresses given by a server (blocks the VPS's private network). |
| `fonts.js` | Fonts uploaded from the dashboard for the welcome image. |
| `secrets.js` | Encryption (AES-256-GCM, `ENCRYPTION_KEY` in `.env`) of the secrets saved in `data/`: AI keys, Twitch secret, RCON passwords. |
| `activity.js` | Activity log of each server (dashboard "Logs" tab): call `logActivity(guildId, { source, action, title, author, data })` to add an entry. |
| `i18n.js` | `t('area.key', { vars })`: the texts the bot sends on Discord, stored in `src/locales/fr.json` and `en.json`. |
| `scheduler.js` | Every repeating task of the bot: `every(name, ms, fn)`. A run never overlaps the previous one, and errors are logged instead of stopping the task. |

### `src/features/`: what the bot does

| Feature | Files |
|---|---|
| Welcome, goodbye, captcha | `welcome/welcome-card.js`, `welcome/welcome-store.js` (settings), `welcome/captcha.js` |
| Tickets | `tickets/ticket-channels.js` (ticket channels and panel), `tickets/tickets.js` (staff panel actions, `/tickets`), `tickets/ticket-store.js` (settings), `tickets/transcripts.js` (saved conversations) |
| AI | `ai/ai-support.js` (choosing the AI and talking to it, ticket assistant), `ai/ai-tools.js` (`/resume`, `/traduire`, `/image`, flag reactions) |
| Moderation and security | `moderation/moderation.js` (AutoMod, warnings, temp bans), `moderation/cases.js` (numbered sanctions and appeals), `moderation/lockdown.js` (`/lockdown`, permissions saved and restored), `moderation/ai-moderation.js` (AI reports to the staff), `moderation/insult-lists.js` (insults in 11 languages), `moderation/logs.js` (server logs), `moderation/guard.js` (anti-raid, account age and quarantine, invite tracking) |
| Game servers | `game-servers/game-servers.js` (status, alerts, restarts, whitelist), `game-servers/game-query.js` (asking a server its status), `game-servers/rcon.js` (sending commands to it) |
| Levels | `levels.js` |
| Reaction roles | `reaction-roles.js` |
| Giveaways | `giveaways.js` |
| Social alerts | `alerts.js` (Twitch, YouTube, Reddit, RSS) |
| Custom commands | `custom-commands.js` |
| Auto messages, temp voice, counters | `server-tools.js` |
| Suggestions, starboard, birthdays | `community.js` |
| Statistics | `stats.js` |
| Temporary roles | `temp-roles.js` |

### `src/commands/`: slash commands

One file per command. Each file exports the same two things:

```js
module.exports = {
  data: new SlashCommandBuilder().setName('...').setDescription('...'), // what Discord shows
  async execute(interaction) { ... },                                     // what happens when it's used
};
```

`src/index.js` loads every file of this folder automatically.

### `src/dashboard/`: the web dashboard

**Server side** (runs in Node, next to the bot):

| File | Role |
|---|---|
| `server.js` | The web server: Discord login, security, and the welcome, tickets, AI, fonts, language and settings pages. |
| `modules.js` | Routes for reaction roles, moderation, bot commands, polls, giveaways, alerts and the bot settings. |
| `features.js` | Routes for all the schema-based features (one generic route for all of them). |
| `announce.js` | Announcements, sent now or scheduled. |
| `backup.js` | Exporting and importing a server's settings. |
| `staff.js` | The staff panel for tickets (`/staff`). |
| `util.js` | Small checks shared by the routes. |
| `security.js` | Security headers (strict CSP), request limits, and changes only accepted from the dashboard's own pages. |

**Browser side** (`public/`, plain HTML, CSS and JavaScript, no build step):

| File | Role |
|---|---|
| `index.html`, `style.css` | The dashboard page. |
| `app.js` | Dashboard core: login, server choice, tabs, home page, saving. |
| `app-welcome.js`, `app-tickets.js`, `app-ai.js`, `app-announce.js` | One tab each: welcome/goodbye, tickets, server AI, announcements. Loaded right after `app.js` (plain scripts sharing the same globals, no build step). |
| `modules.js` | Tabs for reaction roles, moderation, polls, giveaways, alerts. |
| `features.js` | Builds the forms of the schema-based features automatically. |
| `insights.js`, `chart.js` | Statistics tab, backup tab and their charts. |
| `activity.js` | Logs tab: filters by source, author, action and dates. |
| `common.js` | Helpers shared by all pages (`$`, `api`, `toast`…). |
| `card-renderer.js` | Draws the welcome image. **Shared with the bot**, so the preview looks exactly like the real image. |
| `i18n.js`, `i18n-en.js`, `lang.js` | French → English translation, also **shared with the bot**. |
| `select.js`, `colors.js`, `emoji-picker.js`, `theme.js`, `ai-write.js` | UI pieces: dropdowns, color picker, emoji picker, light/dark theme, "✨ Rédiger" AI button. |
| `staff.html`, `staff.css`, `staff.js` | The staff panel for tickets. |
| `leaderboard.html`, `leaderboard.js` | The public level leaderboard of a server. |

## Key ideas

### How an event reaches its feature

`src/index.js` only routes events. For example, a new message goes to statistics, tickets and levels:

```js
client.on(Events.MessageCreate, (message) => {
  countMessage(message);               // features/stats.js
  handleTicketChannelMessage(message); // features/tickets/ticket-channels.js
  handleLevelMessage(message);         // features/levels.js
});
```

Buttons, menus and forms are routed by the **start of their id** (`customId`): `tk:` → tickets, `rr:` → reaction roles,
`gw:` → giveaways, `cap:` → captcha, `sug:` → suggestions, `appeal:` → appeals, `qr:` → quarantine, `aimod:` → AI moderation reports.
See the `COMPONENTS` table in `src/index.js`.

A sanction command records a **case** with `addCase()` (`src/features/moderation/cases.js`), sends the member the DM with
`notifySanction()` (before a ban or a kick: afterwards the bot can no longer write to them), and passes `caseN` to `modLog()`.

### Data

Each feature has its own file in `data/`, holding the settings of every server:
`data/tickets.json = { "<server id>": { ...settings } }`. The comment at the top of each feature file shows the shape of its data.

```js
const store = createStore('tickets', { /* default values */ });
store.get(guildId);          // the settings of a server (a copy you can modify)
store.save(guildId, config); // save them
```

Files are kept in memory and written to disk shortly after each change. If you edit a JSON file by hand, restart the bot.

### Languages

The bot, the dashboard and the slash commands are in **English by default**; each server can switch the bot to French
in the dashboard, and each visitor can switch the dashboard to French.

The texts the bot sends on Discord are **keys**: `t('tickets.closed_by', { user })`. Each key has a French text in
`src/locales/fr.json` and an English one in `src/locales/en.json`; `{name}` marks a part that changes.
`src/core/language.js` hooks into discord.js so that everything the bot sends (messages, embeds, buttons…) is in the
server's language: on English servers, the French texts are replaced by their English version.

The dashboard pages are translated by the dictionary in `src/dashboard/public/i18n-en.js` (French text → English text),
which the bot also uses for its few texts that aren't keys yet.

`npm run check:i18n` checks it all: both locale files have the same keys and variables, every `t('…')` in the code
exists, and lists the dashboard texts the dictionary doesn't translate. Run it after changing texts.

Texts written by admins in the dashboard (welcome message, ticket panel…) must **never** be translated:
they go through `keep(text)` before being sent. The only exception is the bot's **default texts** (the `DEFAULTS` list
at the end of `i18n-en.js`): as long as an admin hasn't changed them, they follow the server language.
If you add a setting with a default text, add that text to `DEFAULTS`.

### AI

Each server picks its AI provider, model and key in one place: the **"🧠 IA du serveur"** tab.
`resolveAi(guild)` in `src/features/ai/ai-support.js` returns the AI to use, and everything that uses AI
(ticket assistant, AI tools) goes through it. Keys are never sent back to the browser.

## Common changes

### Adding a slash command

1. Create a file in `src/commands/` (copy a simple one like `server-info.js`).
2. Add its English name and description in `src/core/locales.js`, and its texts as keys in `src/locales/fr.json` and `en.json`.
3. Run `npm run deploy`, then restart the bot.

### Adding a simple feature

Most simple features don't need any dashboard code: they are described by a **schema**, and the dashboard builds the form by itself.

1. Add an entry in the `FEATURES` table of `src/core/feature-config.js`: the list of fields (`bool`, `int`, `text`, `channel`, `role`…) with their default values.
2. Add its name to the `NAMES` list in `src/dashboard/public/features.js`, and a link in the sidebar of `src/dashboard/public/index.html`.
3. Write the bot logic in a new file in `src/features/`, read the settings with `getFeature(guildId, 'yourFeature')`, and connect it to the right event in `src/index.js`.

### Translating a text

- **Bot message**: add the key to both `src/locales/fr.json` and `src/locales/en.json`, then use `t('area.key', { name })` in the code.
- **Dashboard text**: add a line to `src/dashboard/public/i18n-en.js`: `"Texte en français": "English text",`. `{0}` or `{name}` mark parts that change.

Then run `npm run check:i18n`.

### Adding a repeating task

Use `every('task-name', 60000, async () => { ... })` from `src/core/scheduler.js` instead of `setInterval`.

$$\Huge\color{red}\textsf{Better a pig than a fascist.}$$

<p align="center"><i>— Porco Rosso</i></p>

# 1FA — One For All

A free, all-in-one Discord bot, fully configurable from a web dashboard, in French and English.

> 💚 **1FA is 100% free.** The only official version is https://github.com/Cosatal/1FA.
> If you paid for this bot, you were scammed: please report the seller.

## Why this bot?

I made this bot because I was tired of paying for premium bots that lock basic features behind a subscription.
Running a Discord server shouldn't cost a monthly fee just so a few rich bot owners can keep taking our money.
So here it is: every feature, for everyone, **100% free**, forever.

I'll push updates from time to time, and maybe add new features. Otherwise, feel free to modify it however you like:
that's exactly why I'm releasing the full source code.

**Modules:** welcome (custom image, captcha, auto roles) · tickets in private channels with an AI assistant and a staff panel ·
moderation (Discord's native AutoMod, insult filter in 11 languages, warnings, temporary bans, logs) · levels and public leaderboard ·
reaction roles · polls · giveaways · announcements (schedulable) · Twitch / YouTube / Reddit / RSS alerts · custom commands ·
automatic messages · temporary voice channels · counters · suggestions · starboard · birthdays · anti-raid · invite tracking ·
AI tools (/resume, /traduire, /image) · game servers (status, RCON restarts, whitelist) · statistics · config backup.

## Installation

You need **Node.js 22 or newer**.

1. Create an application on the [Discord Developer Portal](https://discord.com/developers/applications):
   - **Bot** tab: copy the token, and enable **Server Members Intent** and **Message Content Intent**;
   - **OAuth2** tab: copy the Client Secret, and add the redirect `http://localhost:3000/callback`;
   - **Installation** tab: disable "Requires OAuth2 Code Grant".
2. In the bot folder:
   ```bash
   npm install
   cp .env.example .env    # then fill in .env (at least DISCORD_TOKEN, CLIENT_ID, CLIENT_SECRET and SESSION_SECRET)
   npm run deploy          # registers the slash commands (can take up to 1 hour to show up everywhere)
   npm start
   ```
3. Open `http://localhost:3000`, log in with Discord and add the bot to your server.

To test the commands right away on a single server: put its id in `GUILD_ID` and run `npm run deploy -- --test`.

## Language

Everything is in **English** by default. French is available too:

- **Dashboard**: pick "Français" in the language menu at the top of the page.
- **Bot on a server**: pick French in "Bot language" on the server's dashboard. Messages, buttons, tickets and the
  default texts (welcome message, ticket panel…) then switch to French. Texts you wrote yourself are never changed.
- **Slash commands**: Discord shows them in French to members whose Discord is in French, in English to everyone else.

## Hosting the bot

On a VPS: install Node.js, copy the folder (without `node_modules`), run `npm install`, then keep the bot running with
[pm2](https://pm2.keymetrics.io/) (`pm2 start src/index.js --node-args="--env-file=.env"`). Put the dashboard's public address in
`DASHBOARD_URL` (using https) and add `<DASHBOARD_URL>/callback` to the OAuth2 redirects.

## Data

Everything is stored in the `data/` folder (created on first launch): server settings, AI keys, tickets, XP…
Don't share it, and back it up regularly. Never publish the `.env` file.

## Modifying the bot

Want to change something or add a feature? Read [ARCHITECTURE.md](ARCHITECTURE.md): it explains how the project is organized,
which file does what, and how to add a command or a feature.

## License

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE).

- ✅ You can use it, host it, modify it and share it, for free.
- ✅ You must keep the `Required Notice: Copyright (c) 2026 cosatal` line and the license with every copy.
- ❌ You can't sell it or make it paid in any way: no paid version, no premium features, no paid hosting of this bot.

This bot is free and must stay free.

---

Made by cosatal

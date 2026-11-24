# Changelog

## Unreleased

- Docker: `Dockerfile` and `docker-compose.yml` (see README, "Hosting with Docker").
- On English servers, a reason typed by a moderator (`/ban`, `/kick`, `/mute`, `/warn`…) is no longer translated,
  and the default reason ("No reason") is now translated in case messages.

## 1.2.0

### Security
- Dashboard: someone with only "Manage Server" could make the bot give them a role with staff permissions
  (Administrator, Ban…) through reaction roles, auto roles, level rewards, the captcha or a custom command.
  Those roles are now refused when settings are saved, and never given by the bot, even from older settings.
- Moderation commands (`/ban`, `/kick`, `/mute`, `/tempban`, `/tempmute`, `/warn`) and the AI moderation buttons
  follow the role hierarchy: a moderator can only sanction members below them (the server owner excepted).
- RSS alerts can no longer reach the private network of the machine running the bot (localhost, cloud metadata…),
  redirects included.

### Fixes
- A lockdown whose unlock failed (Discord error, missing permission) no longer loses the saved permissions:
  the channel stays known as locked and the unlock can be retried.
- Backup download works for servers with a non-Latin name (Cyrillic, Arabic, Chinese…).
- On English servers, members' own words in the message logs and the starboard are no longer translated.

### Performance
- Settings read without a copy on every message and reaction (levels, AI moderation, starboard, translations).
- Ticket index written shortly after a message instead of on every message.
- Staff panel counters computed in one pass.
- Message logs only build their embed when the log is enabled.

### Updates
- `@anthropic-ai/sdk` 1.x (Claude API version 2026-10-21), discord.js 14.28, @napi-rs/canvas 1.2.
- Security fix in a dependency of Express (body-parser).

### For hosts
- `DATA_DIR` in `.env` moves the data folder (default: `data/`).
- `npm test` runs the tests (in a temporary folder: the bot's data is never touched).
- The tests and the translation check run on every pull request (GitHub Actions), and Dependabot proposes
  dependency updates.

To update: `git pull`, `npm install`, then restart the bot. No setting needs to be changed.

## 1.1

First public version.

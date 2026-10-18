const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getFeature } = require('../core/feature-config');
const games = require('../features/game-servers/game-servers');

// Link your Discord account to your in-game name (automatic whitelist: dashboard → Game servers)
const VALID = /^[\p{L}\p{N}_.\- ]{2,32}$/u;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pseudo-jeu')
    .setDescription('Lier ton compte Discord à ton pseudo sur les serveurs de jeu')
    .addSubcommand((sub) =>
      sub.setName('lier').setDescription('Enregistrer (ou changer) ton pseudo en jeu')
        .addStringOption((opt) => opt.setName('pseudo').setDescription('Ton pseudo exact en jeu').setRequired(true).setMaxLength(32)))
    .addSubcommand((sub) => sub.setName('retirer').setDescription('Retirer ton pseudo (et ta place sur la whitelist)'))
    .addSubcommand((sub) =>
      sub.setName('voir').setDescription('Voir le pseudo en jeu d’un membre').addUserOption((opt) => opt.setName('membre').setDescription('Le membre (toi par défaut)'))),

  async execute(interaction) {
    const { guild, member } = interaction;
    const config = getFeature(guild.id, 'gameServers');
    const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (!config.enabled) return ephemeral('Les serveurs de jeu ne sont pas activés sur ce serveur.');
    const sub = interaction.options.getSubcommand();

    if (sub === 'voir') {
      const user = interaction.options.getUser('membre') ?? interaction.user;
      const pseudo = games.linkOf(guild.id, user.id);
      return interaction.reply({ content: pseudo ? `🎮 Le pseudo en jeu de ${user} est **${pseudo}**.` : `${user} n’a pas lié de pseudo (/pseudo-jeu lier).`, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'retirer') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const pseudo = await games.removeLink(member);
      return interaction.editReply(pseudo ? `🗑️ Ton pseudo **${pseudo}** a été retiré.` : 'Tu n’avais pas lié de pseudo.');
    }

    const pseudo = interaction.options.getString('pseudo').trim();
    if (!VALID.test(pseudo)) return ephemeral('Pseudo invalide : 2 à 32 caractères (lettres, chiffres, espace, _ . -).');
    // The whitelist goes through RCON: a few seconds
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { previous, results } = await games.setLink(member, pseudo);
    const whitelist = results.length
      ? `\nWhitelist :\n${results.join('\n')}`
      : config.whitelistRole && !member.roles.cache.has(config.whitelistRole)
        ? `\nTu seras ajouté à la whitelist quand tu auras le rôle <@&${config.whitelistRole}>.`
        : '';
    return interaction.editReply({ content: `🎮 Pseudo ${previous ? 'changé' : 'enregistré'} : **${pseudo}**.${whitelist}`, allowedMentions: { parse: [] } });
  },
};

const { SlashCommandBuilder, EmbedBuilder, GatewayIntentBits, MessageFlags } = require('discord.js');
const { refuse, summarize, langOfLocale, AiError } = require('../features/ai/ai-tools');
const { guildLang, translatorForLang } = require('../core/language');
const { KEEP } = require('../dashboard/public/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Résumer les derniers messages du salon avec l’IA')
    .addIntegerOption((opt) => opt.setName('nombre').setDescription('Nombre de messages à résumer (50 par défaut)').setMinValue(10).setMaxValue(300))
    .addBooleanOption((opt) => opt.setName('public').setDescription('Montrer le résumé à tout le monde (sinon toi seul le vois)')),
  async execute(interaction) {
    const { guild, channel, client } = interaction;
    const isPublic = interaction.options.getBoolean('public') ?? false;
    const error = refuse(guild, interaction.user.id, 'summary');
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    if (!client.options.intents.has(GatewayIntentBits.MessageContent)) {
      return interaction.reply({ content: 'Le bot ne peut pas lire les messages : active « Message Content Intent » dans le Developer Portal.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply(isPublic ? {} : { flags: MessageFlags.Ephemeral });
    // Public summary: server language. Private summary: the member's Discord language
    const lang = isPublic ? guildLang(guild) : langOfLocale(interaction.locale);
    const t = translatorForLang(lang === 'fr' ? 'fr' : 'en');
    const count = interaction.options.getInteger('nombre') ?? 50;
    try {
      const summary = await summarize(channel, count, lang);
      if (!summary) return interaction.editReply('Il n’y a rien à résumer ici.');
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📋 ${t('Résumé')} · #${channel.name}`)
        .setDescription(summary.slice(0, 4000))
        .setFooter({ text: `${t('Résumé par l’IA, vérifie les infos importantes')} · ${count} messages` });
      // KEEP: the AI's text is sent as is (the title is already in the right language)
      await interaction.editReply({ content: KEEP, embeds: [embed] });
    } catch (e) {
      if (!(e instanceof AiError)) console.error('Summary:', e.message);
      await interaction.editReply(e instanceof AiError ? `⚠️ ${e.message}` : '⚠️ Le résumé a échoué, réessaie plus tard.');
    }
  },
};

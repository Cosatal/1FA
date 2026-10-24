const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { LANGS, refuse, translate, langOfLocale, AiError } = require('../features/ai/ai-tools');
const { KEEP } = require('../dashboard/public/i18n');
const { t } = require('../core/i18n');

// Names of the languages offered in the command
const NAMES = {
  fr: 'Français', en: 'English', es: 'Español', de: 'Deutsch', it: 'Italiano', pt: 'Português', nl: 'Nederlands', ru: 'Русский',
  pl: 'Polski', tr: 'Türkçe', uk: 'Українська', ar: 'العربية', ja: '日本語', ko: '한국어', zh: '中文',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('traduire')
    .setDescription('Traduire un texte avec l’IA')
    .addStringOption((opt) => opt.setName('texte').setDescription('Le texte à traduire').setRequired(true).setMaxLength(1500))
    .addStringOption((opt) =>
      opt.setName('langue').setDescription('Langue voulue (par défaut : celle de ton Discord)').addChoices(...Object.keys(LANGS).map((code) => ({ name: NAMES[code], value: code }))))
    .addBooleanOption((opt) => opt.setName('prive').setDescription('Toi seul vois la traduction')),
  async execute(interaction) {
    const error = refuse(interaction.guild, interaction.user.id, 'translate');
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    const lang = interaction.options.getString('langue') ?? langOfLocale(interaction.locale);
    await interaction.deferReply(interaction.options.getBoolean('prive') ? { flags: MessageFlags.Ephemeral } : {});
    try {
      const text = await translate(interaction.guild, interaction.options.getString('texte'), lang);
      await interaction.editReply({ content: `${KEEP}🌐 **${NAMES[lang]}** : ${text}`.slice(0, 2000), allowedMentions: { parse: [] } });
    } catch (e) {
      if (!(e instanceof AiError)) console.error('Translation:', e.message);
      await interaction.editReply(e instanceof AiError ? `⚠️ ${e.message}` : t('commands.traduire.translation_failed_try_again_later'));
    }
  },
};

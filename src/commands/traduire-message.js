const { ContextMenuCommandBuilder, ApplicationCommandType, MessageFlags } = require('discord.js');
const { refuse, translate, langOfLocale, AiError } = require('../features/ai/ai-tools');
const { KEEP } = require('../dashboard/public/i18n');

// Right-click on a message → Apps → Traduire: translates into the member's Discord language, visible only to them
module.exports = {
  data: new ContextMenuCommandBuilder().setName('Traduire').setType(ApplicationCommandType.Message),
  async execute(interaction) {
    const error = refuse(interaction.guild, interaction.user.id, 'translate');
    if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
    const message = interaction.targetMessage;
    if (!message.content?.trim()) return interaction.reply({ content: 'Ce message n’a pas de texte à traduire.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const text = await translate(interaction.guild, message.content, langOfLocale(interaction.locale));
      await interaction.editReply({ content: `${KEEP}🌐 ${text}`.slice(0, 2000), allowedMentions: { parse: [] } });
    } catch (e) {
      if (!(e instanceof AiError)) console.error('Translation:', e.message);
      await interaction.editReply(e instanceof AiError ? `⚠️ ${e.message}` : '⚠️ La traduction a échoué, réessaie plus tard.');
    }
  },
};

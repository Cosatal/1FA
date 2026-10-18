const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { takeQuota, generateImage, AiError } = require('../features/ai/ai-tools');
const { getFeature } = require('../core/feature-config');
const { KEEP } = require('../dashboard/public/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('image')
    .setDescription('Créer une image avec l’IA')
    .addStringOption((opt) => opt.setName('description').setDescription('Ce que l’image doit montrer').setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    const { guild, user } = interaction;
    const config = getFeature(guild.id, 'aiTools');
    if (!config.enabled || !config.images) return interaction.reply({ content: 'La création d’images n’est pas activée sur ce serveur.', flags: MessageFlags.Ephemeral });
    const wait = takeQuota(guild.id, user.id, 'image', config.imagesPerDay, 86400000);
    if (wait) {
      return interaction.reply({ content: `Tu as atteint ta limite de ${config.imagesPerDay} image(s) par jour. Réessaie dans ${Math.ceil(wait / 60)} h.`, flags: MessageFlags.Ephemeral });
    }

    const prompt = interaction.options.getString('description');
    await interaction.deferReply();
    try {
      const image = await generateImage(guild, prompt);
      // KEEP: the description written by the member is shown as is
      await interaction.editReply({ content: `${KEEP}🎨 **${prompt.slice(0, 300)}**`, files: [new AttachmentBuilder(image, { name: 'image.png' })], allowedMentions: { parse: [] } });
    } catch (e) {
      if (!(e instanceof AiError)) console.error('Image:', e.message);
      await interaction.editReply(e instanceof AiError ? `⚠️ ${e.message}` : '⚠️ La création de l’image a échoué, réessaie plus tard.');
    }
  },
};

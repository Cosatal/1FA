const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { parseDuration } = require('../features/moderation/moderation');
const { addTempRole, removeTempRole, tempRoles } = require('../features/temp-roles');

// A role given for a limited time, then removed automatically (VIP, event…)
module.exports = {
  data: new SlashCommandBuilder()
    .setName('role-temporaire')
    .setDescription('Donner un rôle pour une durée limitée')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) =>
      sub.setName('donner').setDescription('Donner un rôle temporaire')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
        .addRoleOption((opt) => opt.setName('rôle').setDescription('Le rôle').setRequired(true))
        .addStringOption((opt) => opt.setName('durée').setDescription('Ex : 2h, 7j, 1sem (1 an max)').setRequired(true)))
    .addSubcommand((sub) =>
      sub.setName('retirer').setDescription('Retirer un rôle temporaire tout de suite')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre').setRequired(true))
        .addRoleOption((opt) => opt.setName('rôle').setDescription('Le rôle').setRequired(true)))
    .addSubcommand((sub) => sub.setName('liste').setDescription('Les rôles temporaires en cours')),

  async execute(interaction) {
    const { guild, member } = interaction;
    const sub = interaction.options.getSubcommand();
    const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (sub === 'liste') {
      const list = [...tempRoles(guild.id)].sort((a, b) => a.until - b.until);
      const embed = new EmbedBuilder()
        .setColor(0x2f7ff0)
        .setTitle(`⏳ Rôles temporaires (${list.length})`)
        .setDescription(list.slice(0, 30).map((t) => `<@${t.userId}> · <@&${t.roleId}> · fin <t:${Math.floor(t.until / 1000)}:R>`).join('\n') || 'Aucun rôle temporaire en cours.');
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('membre');
    const role = interaction.options.getRole('rôle');
    if (!target) return ephemeral('Ce membre n’est pas sur le serveur.');

    if (sub === 'retirer') {
      const had = removeTempRole(guild.id, target.id, role.id);
      await target.roles.remove(role, `Rôle temporaire retiré par ${interaction.user.tag}`).catch(() => {});
      return ephemeral(had ? `➖ ${role} retiré à ${target}.` : `${target} n’avait pas ${role} en rôle temporaire.`);
    }

    // give: the bot must be able to give it, and nobody gives a role higher than their own (except the owner)
    const ms = parseDuration(interaction.options.getString('durée'));
    if (!ms || ms > 366 * 86400000) return ephemeral('Durée illisible ou trop longue (1 an max). Exemples : `2h`, `7j`, `1sem`.');
    if (role.managed || role.id === guild.id || !role.editable) return ephemeral(`Je ne peux pas donner ${role} : place mon rôle au-dessus de lui.`);
    if (member.id !== guild.ownerId && member.roles.highest.comparePositionTo(role) <= 0) return ephemeral(`Tu ne peux pas donner ${role} : il est au-dessus de ton rôle le plus haut.`);

    await target.roles.add(role, `Rôle temporaire donné par ${interaction.user.tag}`);
    const until = Date.now() + ms;
    addTempRole(guild.id, { userId: target.id, roleId: role.id, until, by: interaction.user.id });
    return interaction.reply({ content: `⏳ ${target} a ${role} jusqu’à <t:${Math.floor(until / 1000)}:f> (<t:${Math.floor(until / 1000)}:R>).`, allowedMentions: { parse: [] } });
  },
};

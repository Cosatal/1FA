const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { parseDuration } = require('../features/moderation/moderation');
const { addTempRole, removeTempRole, tempRoles } = require('../features/temp-roles');
const { t } = require('../core/i18n');

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
        .setTitle(t('commands.roleTemporaire.temporary_roles', { length: list.length }))
        .setDescription(list.slice(0, 30).map((t) => `<@${t.userId}> · <@&${t.roleId}> · fin <t:${Math.floor(t.until / 1000)}:R>`).join('\n') || t('commands.roleTemporaire.no_temporary_role'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getMember('membre');
    const role = interaction.options.getRole('rôle');
    if (!target) return ephemeral(t('commands.roleTemporaire.this_member_isn_server'));

    if (sub === 'retirer') {
      const had = removeTempRole(guild.id, target.id, role.id);
      await target.roles.remove(role, t('commands.roleTemporaire.temporary_role_removed_by', { tag: interaction.user.tag })).catch(() => {});
      return ephemeral(had ? t('commands.roleTemporaire.removed_from', { role, target }) : t('commands.roleTemporaire.didnt_have_temporary_role', { target, role }));
    }

    // give: the bot must be able to give it, and nobody gives a role higher than their own (except the owner)
    const ms = parseDuration(interaction.options.getString('durée'));
    if (!ms || ms > 366 * 86400000) return ephemeral(t('commands.roleTemporaire.unreadable_or_too_long_duration'));
    if (role.managed || role.id === guild.id || !role.editable) return ephemeral(t('commands.roleTemporaire.i_cant_give_role', { role }));
    if (member.id !== guild.ownerId && member.roles.highest.comparePositionTo(role) <= 0) return ephemeral(t('commands.roleTemporaire.you_cant_give_role', { role }));

    await target.roles.add(role, t('commands.roleTemporaire.temporary_role_given_by', { tag: interaction.user.tag }));
    const until = Date.now() + ms;
    addTempRole(guild.id, { userId: target.id, roleId: role.id, until, by: interaction.user.id });
    return interaction.reply({ content: t('commands.roleTemporaire.has_until', { target, role, floor: Math.floor(until / 1000) }), allowedMentions: { parse: [] } });
  },
};

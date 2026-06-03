'use strict';
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { setConfig } = require('../../db/config');
const Categories = require('../../db/categories');

module.exports = {
  enabled: true,
  data: new SlashCommandBuilder()
    .setName('quicksetup')
    .setDescription('Thiết lập nhanh Heiznerd Tickets cho máy chủ')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(o => o.setName('staff_role').setDescription('Role nhân viên hỗ trợ').setRequired(true))
    .addChannelOption(o => o.setName('ticket_category').setDescription('Discord category chứa kênh ticket').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .addChannelOption(o => o.setName('logs_channel').setDescription('Kênh ghi log ticket').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addChannelOption(o => o.setName('panel_channel').setDescription('Kênh để gửi panel ticket').setRequired(true).addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName('category_name').setDescription('Tên danh mục ticket mặc định').setRequired(false)),

  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const staffRole      = interaction.options.getRole('staff_role');
    const ticketCategory = interaction.options.getChannel('ticket_category');
    const logsChannel    = interaction.options.getChannel('logs_channel');
    const panelChannel   = interaction.options.getChannel('panel_channel');
    const categoryName   = interaction.options.getString('category_name') || 'Hỗ Trợ';

    try {
      // 1. Save global config
      setConfig('staffRoles',          [staffRole.id]);
      setConfig('ticket.logsChannelID', logsChannel.id);
      setConfig('ticket.maxTickets',    1);
      setConfig('ticket.deleteTime',    5);
      setConfig('ticket.selectMenu',    true);
      setConfig('claiming.enabled',     true);

      // 2. Create default category if none exists
      const existing = Categories.findAll();
      const catKey = 'ho-tro';
      if (!existing.find(c => c.categoryKey === catKey)) {
        Categories.create({
          categoryKey:         catKey,
          categoryName,
          description:         'Danh mục hỗ trợ mặc định',
          parentCategoryID:    ticketCategory.id,
          embedTitle:          `Ticket {category}`,
          embedMessage:        `> Xin chào <@!{user}>, cảm ơn bạn đã liên hệ!\n> Nhân viên hỗ trợ sẽ phản hồi sớm nhất có thể.`,
          categoryEmoji:       '🎫',
          buttonColor:         'Green',
          supportRoles:        [staffRole.id],
          mentionSupportRoles: false,
          channelName:         'ticket-{username}',
          logsChannelID:       logsChannel.id,
          requiredRoles:       [],
          questions:           [],
          sortOrder:           0,
          enabled:             true,
          dmOnClose:           true,
          dmCloseMessage:      'Ticket **{ticketType}** của bạn trong **{guildName}** đã được đóng lúc {closedAt}.',
        });
      }

      // 3. Send panel to panel channel
      const { EmbedBuilder: EB, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const { getConfig: gc } = require('../../db/config');
      const embedColor = gc('bot.embedColor', '#59d4b5');

      const panelEmbed = new EB()
        .setColor(embedColor)
        .setTitle('🎫 Hỗ Trợ Ticket')
        .setDescription('> Nhấn vào menu bên dưới để tạo ticket và được hỗ trợ.');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('categorySelect')
        .setPlaceholder('Chọn loại ticket...')
        .setMinValues(1).setMaxValues(1)
        .addOptions([{ label: categoryName, value: `ticket-${catKey}`, emoji: '🎫' }]);

      const row = new ActionRowBuilder().addComponents(menu);
      const sentMsg = await panelChannel.send({ embeds: [panelEmbed], components: [row] });

      // Save panel record
      const Panels = require('../../db/panels');
      Panels.upsert(interaction.guild.id, 'quicksetup-panel', sentMsg.id, [
        { label: categoryName, value: `ticket-${catKey}`, emoji: '🎫' },
      ]);

      // 4. Reply with summary
      const summary = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('✅ Thiết lập hoàn tất!')
        .addFields(
          { name: '👮 Staff Role',       value: `<@&${staffRole.id}>`,      inline: true },
          { name: '📂 Category Ticket',  value: `<#${ticketCategory.id}>`,  inline: true },
          { name: '📋 Kênh Log',         value: `<#${logsChannel.id}>`,     inline: true },
          { name: '📢 Kênh Panel',       value: `<#${panelChannel.id}>`,    inline: true },
          { name: '🎫 Danh mục',         value: `\`${categoryName}\``,      inline: true },
          { name: '🔗 Panel',            value: `[Xem panel](${sentMsg.url})`, inline: true },
        )
        .setDescription('Bot đã sẵn sàng nhận ticket. Bạn có thể tinh chỉnh thêm trong **Dashboard → Cài đặt**.')
        .setTimestamp();

      await interaction.editReply({ embeds: [summary] });
    } catch (err) {
      console.error('[quicksetup]', err);
      await interaction.editReply({ content: `❌ Lỗi: ${err.message}` });
    }
  },
};

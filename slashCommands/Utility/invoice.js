/**
 * slashCommands/Utility/invoice.js
 * Lệnh thanh toán VietQR — thay thế PayPal/Stripe cũ
 * TODO: Tích hợp VietQR API (https://vietqr.io/danh-sach-api)
 */
'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const commands = require('js-yaml').load(require('fs').readFileSync('./commands.yml', 'utf8'));
const Tickets  = require('../../db/tickets');
const { getConfig } = require('../../db/config');

module.exports = {
  enabled: commands.Utility.Invoice.Enabled,
  data: new SlashCommandBuilder()
    .setName('invoice')
    .setDescription(commands.Utility.Invoice.Description)
    .addUserOption(opt =>
      opt.setName('user').setDescription('Người nhận hóa đơn').setRequired(true)
    )
    .addNumberOption(opt =>
      opt.setName('amount').setDescription('Số tiền (VND)').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('service').setDescription('Dịch vụ / mô tả').setRequired(true)
    ),

  async execute(interaction, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    if (interaction.deferred === false) return; // interaction đã hết hạn

    const ticketDB = Tickets.findByChannelID(interaction.channel.id);
    const onlyInTickets = getConfig('vietqr.onlyInTickets', false);
    if (onlyInTickets && !ticketDB) {
      return interaction.editReply({ content: '❌ Lệnh này chỉ dùng được trong kênh ticket!', flags: MessageFlags.Ephemeral });
    }

    const user    = interaction.options.getUser('user');
    const amount  = interaction.options.getNumber('amount');
    const service = interaction.options.getString('service');

    // ── Cấu hình VietQR (lấy từ SQLite config hoặc config.yml) ──────────────
    const bankId     = getConfig('vietqr.bankId',     '');   // Mã ngân hàng, vd: "970422" (MB Bank)
    const accountNo  = getConfig('vietqr.accountNo',  '');   // Số tài khoản
    const accountName= getConfig('vietqr.accountName','');   // Tên chủ tài khoản
    const template   = getConfig('vietqr.template',   'compact2'); // compact, compact2, qr_only, print

    if (!bankId || !accountNo) {
      return interaction.editReply({
        content: '⚠️ VietQR chưa được cấu hình! Dùng `/setup vietqr` để thiết lập.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Tạo URL QR VietQR ────────────────────────────────────────────────────
    const addInfo   = encodeURIComponent(`${service} - ${interaction.user.username}`);
    const qrURL     = `https://img.vietqr.io/image/${bankId}-${accountNo}-${template}.png?amount=${amount}&addInfo=${addInfo}&accountName=${encodeURIComponent(accountName)}`;

    const embedColor = getConfig('bot.embedColor', '#5e99ff');
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('💳 Hóa đơn thanh toán VietQR')
      .setDescription(`Vui lòng quét mã QR bên dưới để thanh toán.`)
      .addFields(
        { name: '👤 Người nhận', value: `<@${user.id}>`, inline: true },
        { name: '💰 Số tiền',    value: `**${amount.toLocaleString('vi-VN')} VND**`, inline: true },
        { name: '📋 Dịch vụ',   value: service, inline: false },
        { name: '🏦 Ngân hàng', value: accountName || accountNo, inline: true },
      )
      .setImage(qrURL)
      .setFooter({ text: `Tạo bởi ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Gửi vào channel nếu đang trong ticket
    if (ticketDB) {
      await interaction.channel.send({ content: `<@${user.id}>`, embeds: [embed] });
    }

    // Ghi log vào kênh logs nếu có
    const utils = require('../../utils.js');
    const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);
    if (logsChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor('#FFA726')
        .setTitle('💳 Nhật ký | Hóa đơn VietQR')
        .addFields(
          { name: 'Người tạo', value: `<@${interaction.user.id}> \`${interaction.user.username}\``, inline: true },
          { name: 'Người nhận', value: `<@${user.id}> \`${user.username}\``, inline: true },
          { name: 'Số tiền', value: `${amount.toLocaleString('vi-VN')} VND`, inline: true },
          { name: 'Dịch vụ', value: service, inline: false },
        )
        .setTimestamp();
      logsChannel.send({ embeds: [logEmbed] }).catch(() => {});
    }
  },
};

/**
 * slashCommands/Utility/crypto.js
 * Lệnh này đã bị xóa (Crypto payment).
 * Thay thế bằng /invoice (VietQR).
 * File giữ lại để tránh lỗi load — lệnh bị tắt.
 */
'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const { MessageFlags } = require('discord.js');
const fs   = require('fs');
const yaml = require('js-yaml');
const commands = require('js-yaml').load(require('fs').readFileSync('./commands.yml', 'utf8'));

module.exports = {
  enabled: false, // Đã xóa — dùng /invoice thay thế
  data: new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('Lệnh này đã bị xóa. Dùng /invoice thay thế.'),
  async execute(interaction) {
    await interaction.reply({
      content: '❌ Lệnh `/crypto` đã bị xóa. Vui lòng dùng `/invoice` để thanh toán qua VietQR.',
      flags: MessageFlags.Ephemeral,
    });
  },
};

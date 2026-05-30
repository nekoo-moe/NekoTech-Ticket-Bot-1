const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const StickyDB = require('../../db/sticky');
const config = yaml.load(fs.readFileSync('./addons/StickyMessages/config.yml', 'utf8'));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sticky')
    .setDescription('Quản lý Sticky Messages')
    .addSubcommand(sub =>
      sub.setName('create').setDescription('Tạo sticky message trong kênh này')
        .addStringOption(opt => opt.setName('msg').setDescription('Nội dung sticky message').setRequired(true))
    )
    .addSubcommand(sub =>
      sub.setName('delete').setDescription('Xóa sticky message trong kênh này')
    )
    .addSubcommand(sub =>
      sub.setName('list').setDescription('Liệt kê tất cả sticky messages đang hoạt động')
    ),

  async execute(interaction, client) {
    if (!interaction.member.permissions.has('ManageMessages'))
      return interaction.reply({ content: 'Bạn không có quyền dùng lệnh này!', ephemeral: true });
    if (config.Enabled === false)
      return interaction.reply({ content: 'Lệnh này đã bị tắt trong config!', ephemeral: true });

    const subCmd = interaction.options.getSubcommand();

    if (subCmd === 'create') {
      if (StickyDB.find(interaction.channel.id))
        return interaction.reply({
          content: 'Đã có sticky message trong kênh này! Xóa cái cũ trước khi tạo cái mới.',
          ephemeral: true,
        });

      const msg = interaction.options.getString('msg');

      const embed = new Discord.EmbedBuilder();
      if (config.EmbedSettings?.Embed?.Title)  embed.setTitle(config.EmbedSettings.Embed.Title);
      embed.setDescription(msg);
      if (config.EmbedSettings?.Embed?.Color)  embed.setColor(config.EmbedSettings.Embed.Color);
      if (config.EmbedSettings?.Embed?.Timestamp) embed.setTimestamp();
      if (config.EmbedSettings?.Embed?.Footer?.Enabled && config.EmbedSettings.Embed.Footer.text) {
        embed.setFooter({ text: config.EmbedSettings.Embed.Footer.text });
      }

      StickyDB.upsert(interaction.channel.id, msg);

      interaction.reply({ content: 'Đã tạo sticky message thành công!', ephemeral: true });
      if (config.EnableEmbeds === false) interaction.channel.send(`${config.StickiedMessageTitle}\n\n${msg}`);
      if (config.EnableEmbeds === true)  interaction.channel.send({ embeds: [embed] });
      if (config.EnableSlowmode) interaction.channel.setRateLimitPerUser(config.SlowmodeDelay);

    } else if (subCmd === 'delete') {
      const stickyMessage = StickyDB.find(interaction.channel.id);
      if (!stickyMessage)
        return interaction.reply({ content: 'Không có sticky message trong kênh này!', ephemeral: true });

      StickyDB.delete(interaction.channel.id);

      const msgs = await interaction.channel.messages.fetch();
      msgs.forEach(async (m) => {
        if (m.content.includes(stickyMessage.message)) await m.delete().catch(() => {});
      });

      if (config.EnableSlowmode) interaction.channel.setRateLimitPerUser('0');
      interaction.reply({ content: 'Đã xóa sticky message thành công!', ephemeral: true });

    } else if (subCmd === 'list') {
      // Lấy tất cả sticky messages từ SQLite
      const db = require('../../db/index');
      const allSticky = db.prepare('SELECT * FROM sticky_messages').all();

      if (!allSticky.length)
        return interaction.reply({ content: 'Không có sticky message nào đang hoạt động.', ephemeral: true });

      const embed = new Discord.EmbedBuilder()
        .setTitle('Sticky Messages Đang Hoạt Động')
        .setColor('Green');

      for (const sticky of allSticky) {
        const ch = client.channels.cache.get(sticky.channelId);
        if (ch) {
          embed.addFields(
            { name: 'Kênh',    value: ch.name,        inline: true },
            { name: 'Nội dung', value: sticky.message, inline: true },
          );
        } else {
          StickyDB.delete(sticky.channelId);
        }
      }

      interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};

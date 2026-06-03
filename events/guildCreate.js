const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

module.exports = async (client, guild) => {
  if (!config.GuildID.includes(guild.id)) {
    guild.leave();
    console.log('\x1b[31m%s\x1b[0m', `[INFO] Left unauthorized server: ${guild.name}`);
    return;
  }

  const channel = guild.systemChannel || guild.channels.cache.find(c =>
    c.type === 0 && c.permissionsFor(guild.members.me)?.has('SendMessages')
  );
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor('#59d4b5')
    .setTitle('👋 Cảm ơn bạn đã thêm Heiznerd Tickets!')
    .setDescription(
      '> Cảm ơn bạn đã tin tưởng sử dụng **Heiznerd Tickets**!\n\n' +
      '**Bắt đầu nhanh:** Dùng lệnh `/quicksetup` để thiết lập hệ thống ticket chỉ trong 30 giây.\n\n' +
      '📖 Cần hỗ trợ? Tham gia server của chúng tôi bên dưới.'
    )
    .setFooter({ text: 'Heiznerd Tickets • Powered by NekoStudio' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('⚡ /quicksetup')
      .setStyle(ButtonStyle.Primary)
      .setCustomId('noop_quicksetup')
      .setDisabled(true),
    new ButtonBuilder()
      .setLabel('NekoStudio')
      .setStyle(ButtonStyle.Link)
      .setURL('https://dsc.gg/nekostudio'),
    new ButtonBuilder()
      .setLabel('Support Server')
      .setStyle(ButtonStyle.Link)
      .setURL('https://dsc.gg/nekostudio')
  );

  channel.send({ embeds: [embed], components: [row] }).catch(() => {});
};
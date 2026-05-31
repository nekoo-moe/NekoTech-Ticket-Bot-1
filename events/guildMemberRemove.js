const Discord = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const config   = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const Tickets  = require("../db/tickets");
const { t }    = require("../lang/index");
const { getConfig } = require("../db/config");

module.exports = async (client, member) => {
  try {
    const userOpenTickets = Tickets.findOpenByUserID(member.id, config.GuildID);

    for (const ticket of userOpenTickets) {
      const logsChannel = member.guild.channels.cache.get(ticket.channelID);
      if (!logsChannel) continue;

      const deleteEmoji = getConfig('buttons.emojis.deleteTicket', '⛔');
      const deleteColor = getConfig('buttons.colors.deleteTicket', 'Secondary');

      const ticketDeleteButton = new Discord.ButtonBuilder()
        .setCustomId('deleteTicket')
        .setLabel(t('ticket.delete.button'))
        .setEmoji(deleteEmoji)
        .setStyle(deleteColor);

      const row = new Discord.ActionRowBuilder().addComponents(ticketDeleteButton);

      Tickets.updateByChannelID(ticket.channelID, { closeReason: 'Người dùng đã rời server' });

      const embed = new Discord.EmbedBuilder()
        .setColor('#FF5555')
        .setAuthor({
          name:    t('ticket.userLeft.title'),
          iconURL: member.user.displayAvatarURL({ dynamic: true }),
        })
        .setDescription(`⚠️ ${t('ticket.userLeft.description', { user: member.user.username })}\n\n**User ID:** \`${member.user.id}\``)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
        .setFooter({ text: member.user.username, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

      logsChannel.send({ embeds: [embed], components: [row] });
    }
  } catch (error) {
    console.error('Lỗi xử lý sự kiện rời server:', error);
  }
};

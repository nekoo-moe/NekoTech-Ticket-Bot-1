const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require("discord.js");
const fs = require('fs');
const config = require('../config');
const utils   = require("../utils.js");
const { t }   = require("../lang/index");
const { getConfig } = require("../db/config");
const Reviews = require("../db/reviews");
const db      = require("../db/index");

module.exports = async (client, ticketDB, attachment, closeLogMsgID, closeLogChannelID, timestamp, meetsMessageRequirement) => {
  const guild       = client.guilds.cache.get(config.GuildID);
  const ticketAuthor = client.users.cache.get(ticketDB.userID);
  const claimUser    = ticketDB.claimUser ? client.users.cache.get(ticketDB.claimUser) : null;
  const closeReason  = ticketDB.closeReason || 'Không có lý do.';

  const dashboardDB     = db.prepare('SELECT * FROM dashboard WHERE guildID = ?').get(config.GuildID);
  const dashboardExists = await utils.checkDashboard();

  const reviewEnabled  = getConfig('review.enabled', true);
  const dmEnabled      = getConfig('ticket.userCloseDM.enabled', true);
  const sendTranscript = getConfig('ticket.userCloseDM.sendTranscript', true);
  const showTicketInfo = getConfig('ticket.userCloseDM.ticketInformation', true);
  const showCloseReason= getConfig('ticket.userCloseDM.showCloseReason', true);
  const showClosedBy   = getConfig('ticket.userCloseDM.showClosedBy', true);
  const showParticipants = getConfig('ticket.userCloseDM.showParticipants', true);
  const embedColor     = getConfig('bot.embedColor', '#5e99ff');
  const claimingEnabled= getConfig('claiming.enabled', true);

  const reviewReqEnabled = getConfig('review.requirements.enabled', false);
  const reviewReqMessages= getConfig('review.requirements.totalMessages', 5);
  let meetRequirement = true;
  if (reviewReqEnabled && ticketDB.messages < reviewReqMessages) meetRequirement = false;

  const createCloseEmbed = (isReviewEmbed = false) => {
    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setAuthor({ name: t('dm.close.msg', { guildName: guild?.name || '' }) })
      .setTimestamp();

    if (ticketAuthor?.avatar) {
      embed.setThumbnail(`https://cdn.discordapp.com/avatars/${ticketAuthor.id}/${ticketAuthor.avatar}.webp?size=240`);
    }

    let desc = t('dm.close.msg', { guildName: guild?.name || '' });
    if (isReviewEmbed && meetRequirement) {
      desc += `\n\n${getConfig('review.prompt', t('review.prompt'))}`;
    }
    embed.setDescription(desc);
    embed.setFooter({
      text: `#${ticketDB.identifier} | ${t('logs.totalMessages')} ${ticketDB.messages}`,
      iconURL: ticketAuthor?.avatar
        ? `https://cdn.discordapp.com/avatars/${ticketAuthor.id}/${ticketAuthor.avatar}.webp?size=16`
        : null,
    });
    return embed;
  };

  const addTicketInfoField = (embed) => {
    if (!showTicketInfo) return embed;

    let info = `> **${t('dm.close.category')}** \`${ticketDB.ticketType}\`\n`;

    if (showCloseReason) {
      info += `> **${t('dm.close.closeReason')}** \`${closeReason}\`\n`;
    }
    if (showClosedBy && ticketDB.closeUserID) {
      const closer = client.users.cache.get(ticketDB.closeUserID);
      info += `> **${t('logs.closedBy')}** ${closer ? `<@${closer.id}> \`${closer.username}\`` : `<@${ticketDB.closeUserID}>`}\n`;
    }
    if (claimingEnabled) {
      const claimInfo = claimUser ? `<@${claimUser.id}>` : t('dm.close.notClaimed');
      info += `> **${t('dm.close.claimedBy')}** ${claimInfo}\n`;
    }
    info += `> **${t('logs.totalMessages')}** \`${ticketDB.messages}\``;

    embed.addFields([{ name: `\`📋\` **${t('logs.details')}**`, value: info }]);

    if (showParticipants && ticketDB.participants?.length > 0) {
      const sorted = [...ticketDB.participants].sort((a, b) => b.messageCount - a.messageCount);
      const pContent = sorted.map(p => `> <@!${p.userID}> — **${p.messageCount}** tin nhắn`).join('\n');
      embed.addFields([{ name: `\`👥\` **${t('logs.participants')}**`, value: pContent }]);
    }
    return embed;
  };

  const addTranscript = (opts) => {
    if (!sendTranscript || !meetsMessageRequirement) return opts;
    if (dashboardExists && dashboardDB) {
      const link = `> **[${t('ticket.transcript.clickHere')}](${dashboardDB.url}/transcript?channelId=${ticketDB.channelID}&dateNow=${timestamp})**`;
      opts.embeds[0].addFields([{ name: `\`📝\` **${t('ticket.transcript.button')}**`, value: link }]);
    } else if (attachment) {
      opts.files = [attachment];
    }
    return opts;
  };

  if (!ticketAuthor || (!dmEnabled && !reviewEnabled)) return;

  try {
    if (reviewEnabled) {
      const starMenu = meetRequirement
        ? new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('ratingSelect')
              .setPlaceholder(t('review.select'))
              .setMinValues(1).setMaxValues(1)
              .addOptions([
                { label: '5 Sao', value: 'five_star',  emoji: '⭐' },
                { label: '4 Sao', value: 'four_star',  emoji: '⭐' },
                { label: '3 Sao', value: 'three_star', emoji: '⭐' },
                { label: '2 Sao', value: 'two_star',   emoji: '⭐' },
                { label: '1 Sao', value: 'one_star',   emoji: '⭐' },
              ])
          )
        : null;

      const embed = createCloseEmbed(true);
      addTicketInfoField(embed);
      let opts = { embeds: [embed] };
      opts = addTranscript(opts);
      if (starMenu) opts.components = [starMenu];

      let reviewDMUserMsg;
      await ticketAuthor.send(opts).then(msg => { reviewDMUserMsg = msg.id; });

      Reviews.create({
        ticketCreatorID:    ticketAuthor.id,
        guildID:            config.GuildID,
        ticketChannelID:    ticketDB.channelID,
        userID:             ticketAuthor.id,
        tCloseLogMsgID:     closeLogMsgID,
        tCloseLogChannelID: closeLogChannelID,
        reviewDMUserMsgID:  reviewDMUserMsg,
        category:           ticketDB.ticketType,
        totalMessages:      ticketDB.messages,
        transcriptID:       String(timestamp),
        alreadyRated:       false,
      });

    } else if (dmEnabled) {
      const embed = createCloseEmbed(false);
      addTicketInfoField(embed);
      let opts = { embeds: [embed] };
      opts = addTranscript(opts);
      await ticketAuthor.send(opts);
    }
  } catch (e) {
    if (e.code === 50007 || e.message?.includes('Cannot send messages')) {
      console.log('\x1b[33m%s\x1b[0m', "[INFO] Không thể gửi DM cho người dùng (DM bị khóa).");
    } else {
      console.error('[sendUserDM] Lỗi:', e.message);
    }
    fs.appendFile('./logs.txt', `\n\n[${new Date().toLocaleString()}] [ERROR] ${e.stack}`, () => {});
  }
};

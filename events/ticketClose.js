const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder, Message, MessageAttachment, ModalBuilder, TextInputBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const utils   = require("../utils.js");
const { t }   = require("../lang/index");
const { getConfig } = require("../db/config");
const Guild   = require("../db/guild");
const Tickets = require("../db/tickets");
const Reviews = require("../db/reviews");
const { incrementStat } = require("../staffStats.js");

module.exports = async (client, interaction) => {

  const ticketDB    = Tickets.findByChannelID(interaction.channel.id);
  const dashboardDB = require('../db/index').prepare(
    'SELECT * FROM dashboard WHERE guildID = ?'
  ).get(config.GuildID);

  async function CloseTicket() {
    let ticketAuthor = await client.users.cache.get(ticketDB.userID);
    let closeUserID = await client.users.cache.get(ticketDB.closeUserID);
    let closeReason = ticketDB.closeReason || "No reason provided.";
    let claimUser = await client.users.cache.get(ticketDB.claimUser);
    let totalMessages = ticketDB.messages;

    let attachment = null;
    let timestamp = Date.now();

    if (totalMessages >= config.TicketTranscriptSettings.MessagesRequirement) {
      const transcriptData = await utils.saveTranscript(interaction);
      attachment = transcriptData.attachment;
      timestamp = transcriptData.timestamp;
    }

    const logEmbed = new EmbedBuilder()
      .setColor('#FF5D5D')
      .setAuthor({ name: t('ticket.close.title') })
      .setThumbnail(`https://cdn.discordapp.com/avatars/${ticketAuthor.id}/${ticketAuthor.avatar}.webp?size=240`)
      .setTimestamp();

    let mainContent = '';

    mainContent += `> **${t('logs.ticketAuthor')}:** <@!${ticketAuthor.id}> \`${ticketAuthor.username}\`\n`;

    if (closeUserID) {
      mainContent += `> **${t('logs.closedBy')}:** <@!${closeUserID.id}> \`${closeUserID.username}\`\n`;
    }

    if (claimUser && getConfig('claiming.enabled', true)) {
      mainContent += `> **${t('ticket.claim.claimedBy')}:** <@!${claimUser.id}> \`${claimUser.username}\`\n`;
    }

    mainContent += `> **${t('logs.category')}:** \`${ticketDB.ticketType}\`\n`;

    if (getConfig('ticket.closeReason', false) && closeReason) {
      mainContent += `> **${t('logs.reason')}:** ${closeReason}`;
    }

    logEmbed.addFields([
      {
        name: `\`📋\` **${t('logs.details')}**`,
        value: mainContent
      }
    ]);

    if (ticketDB.participants && ticketDB.participants.length > 0) {
      let participantsContent = '';

      const sortedParticipants = [...ticketDB.participants].sort((a, b) => b.messageCount - a.messageCount);

      for (const participant of sortedParticipants) {
        participantsContent += `> <@!${participant.userID}> — **${participant.messageCount}** messages\n`;
      }

      logEmbed.addFields([
        {
          name: `\`👥\` **${t('logs.participants')}**`,
          value: participantsContent
        }
      ]);
    }

    logEmbed.setFooter({
      text: `#${ticketDB.identifier} | ${t('logs.totalMessages')} ${totalMessages}`,
      iconURL: `https://cdn.discordapp.com/avatars/${ticketAuthor.id}/${ticketAuthor.avatar}.webp?size=16`
    });

    let closeLogMsgID;
    const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);

    const dashboardExists = await utils.checkDashboard();
    const meetsMessageRequirement = totalMessages >= config.TicketTranscriptSettings.MessagesRequirement;

    if (logsChannel) {
      const embedOptions = { embeds: [logEmbed] };

      if (meetsMessageRequirement && !dashboardExists && attachment) {
        embedOptions.files = [attachment];
      }

      if (meetsMessageRequirement && dashboardExists &&
        getConfig('transcript.type', 'HTML') === "HTML" &&
        getConfig('transcript.saveInFolder', true) === true) {
        const viewTranscriptButton = new ButtonBuilder()
          .setLabel(t('ticket.transcript.button'))
          .setStyle('Link')
          .setURL(`${dashboardDB.url}/transcript?channelId=${ticketDB.channelID}&dateNow=${timestamp}`)
          .setEmoji('📝');

        const row = new ActionRowBuilder().addComponents(viewTranscriptButton);

        embedOptions.components = [row];
      }

      await logsChannel.send(embedOptions).then(async function (msg) {
        closeLogMsgID = msg.id;
      });
    }

    client.emit('sendUserDM', ticketDB, attachment, closeLogMsgID, logsChannel.id, timestamp, meetsMessageRequirement);

    let dTime = getConfig('ticket.deleteTime', 5) * 1000;
    let deleteTicketCountdown = t('ticket.close.deleting', { time: String(getConfig('ticket.deleteTime', 5)) });
    const delEmbed = new EmbedBuilder()
      .setDescription(deleteTicketCountdown)
      .setColor("Red")

    const ticketDeleteButton = new ButtonBuilder()
      .setCustomId('closeTicket')
      .setLabel(t('buttons.close'))
      .setStyle(getConfig('buttons.colors.closeTicket', 'Danger'))
      .setEmoji(getConfig('buttons.emojis.closeTicket', '🔒'))
      .setDisabled(true)

    let row1 = new ActionRowBuilder().addComponents(ticketDeleteButton);

    await interaction.channel.messages.fetch(ticketDB.msgID).then(msg => {
      msg.edit({ components: [row1] })
    })

    if (!interaction.dashboard) {
      if (interaction.customId === "closeReason") {
        if (interaction.deferred) await interaction.followUp({ embeds: [delEmbed] });
        if (!interaction.deferred) await interaction.reply({ embeds: [delEmbed] });
      } else {
        if (!interaction.deferred) await interaction.deferUpdate();
        await interaction.channel.send({ embeds: [delEmbed] });
      }
    } else if (interaction.dashboard) {
      await interaction.channel.send({ embeds: [delEmbed] });
    }

    setTimeout(async () => {
      await incrementStat(closeUserID, 'close', 1, { ticketID: interaction.channel.id });
      await interaction.channel.delete().catch(e => { })
    }, dTime)

    let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET CLOSED] A ticket has been successfully closed`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });
  }

  CloseTicket()

};
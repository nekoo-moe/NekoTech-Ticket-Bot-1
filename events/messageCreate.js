const { Discord, EmbedBuilder, ButtonBuilder, ActionRowBuilder } = require("discord.js");
const fs = require('fs');
const config = require('../config');
const color  = require('ansi-colors');
const utils  = require("../utils.js");
const { t }  = require("../lang/index");
const Tickets     = require("../db/tickets");
const Guild       = require("../db/guild");
const AIResponses = require("../db/aiResponses");
const { getConfig } = require("../db/config");
const { incrementStat } = require("../staffStats.js");
const OpenAI = require('openai');

module.exports = async (client, message) => {
    if(!message.channel.type === 0) return;
    const ticketDB = Tickets.findByChannelID(message.channel.id);
    if(message.author.bot) return;

if (ticketDB) {
  if (!message.author.bot) {
    let supportRole = await utils.checkIfUserHasSupportRoles(null, message);

    if(supportRole) await incrementStat(message.author, 'message', 1, { ticketID: message.channel.id });

    const waitingReplyFrom = supportRole ? "user" : "staff";

   // Auto-claim feature
    if (supportRole && config.ClaimingSystem?.AutoClaim?.Enabled) {
      if (message.author.id !== ticketDB.userID) {
        const shouldClaim = 
          !ticketDB.claimed || 
          (config.ClaimingSystem.AutoClaim.OverridePreviousClaims && ticketDB.claimUser !== message.author.id);
        
        if (shouldClaim) {
          await autoClaimTicket(client, message, ticketDB);
        }
      }
    }

if (supportRole && !ticketDB.firstStaffResponse) {
  try {
    const responseTime = Date.now() - new Date(ticketDB.createdAt || ticketDB.ticketCreationDate).getTime();
    await incrementStat(message.author, 'responseTime', responseTime, {
      ticketID: message.channel.id, responseTime,
    });
    Tickets.updateByChannelID(message.channel.id, { firstStaffResponse: new Date().toISOString() });
  } catch (error) {
    console.error("Lỗi tracking response time:", error);
    Tickets.updateByChannelID(message.channel.id, { firstStaffResponse: new Date().toISOString() });
  }
}

    // Cập nhật participants
    const ticket = Tickets.findByChannelID(message.channel.id);
    const participants = ticket?.participants || [];
    const existingParticipant = participants.find(p => p.userID === message.author.id);

    if (existingParticipant) {
      existingParticipant.messageCount = (existingParticipant.messageCount || 0) + 1;
      existingParticipant.lastMessage  = new Date().toISOString();
    } else {
      participants.push({
        userID:       message.author.id,
        messageCount: 1,
        firstMessage: new Date().toISOString(),
        lastMessage:  new Date().toISOString(),
      });
    }

    Tickets.updateByChannelID(message.channel.id, {
      lastMessageSent:  new Date().toISOString(),
      waitingReplyFrom: waitingReplyFrom,
      messages:         (ticket?.messages || 0) + 1,
      participants,
    });
  }

  Guild.increment(message.guild.id, 'totalMessages');

  if (getConfig('alert.enabled', true)) {
    const alertTicket = Tickets.findByChannelID(message.channel.id);
    if (alertTicket && alertTicket.closeNotificationTime > 0) {
      Tickets.updateByChannelID(message.channel.id, { closeNotificationTime: 0, closeReason: null });
      if (alertTicket.closeNotificationMsgID) {
        message.channel.messages.fetch(alertTicket.closeNotificationMsgID).then(msg => {
          try { msg.delete(); } catch (_) {}
        }).catch(() => {});
      }
    }
  }
}

// AI AutoResponse System
const aiEnabled   = getConfig('ai.enabled', false);
const aiResponses = getConfig('ai.responses', {});
if (aiEnabled && Object.keys(aiResponses).length > 0) {
  let supportRole = await utils.checkIfUserHasSupportRoles(null, message);
  if (supportRole) return;

  if (getConfig('ai.channelFilter.mode', 'DISABLED') !== "DISABLED") {
    const channelId = message.channel.id;
    const categoryId = message.channel.parent?.id;
    const filterChannels   = getConfig('ai.channelFilter.channels', []);
    const filterCategories = getConfig('ai.channelFilter.categories', []);
    const filterMode       = getConfig('ai.channelFilter.mode', 'DISABLED');
    
    const isChannelListed  = filterChannels.includes(channelId);
    const isCategoryListed = categoryId && filterCategories.includes(categoryId);
    const isListed = isChannelListed || isCategoryListed;
    
    if (filterMode === "WHITELIST" && !isListed) return;
    if (filterMode === "BLACKLIST" && isListed)  return;
  }

  const userMessage = message.content;
  const responses   = aiResponses;
  
  const isInTicket = !!ticketDB;
  const availableResponses = {};
  
  Object.entries(responses).forEach(([key, response]) => {
    if (response.OnlyInTickets === true && !isInTicket) {
      return; 
    }
    
    availableResponses[key] = response;
  });
  
  if (Object.keys(availableResponses).length === 0) {
    return;
  }
  
  const systemPrompt = `You are a helpful customer support AI for a Discord server. Analyze user messages and determine if they match any of the available responses. You should identify the intent and context of the user's message, not just keywords.
  
  Return a JSON response with:
  - "match": true/false (whether the message matches any response)
  - "response_key": the key of the best matching response (or null if no match)
  - "confidence": a number between 0.0 and 1.0 indicating how confident you are
  - "reasoning": brief explanation of why you chose this response
  
  Available responses and their contexts:`;
  
  let fullSystemPrompt = systemPrompt;
  Object.entries(availableResponses).forEach(([key, response]) => {
    fullSystemPrompt += `\n- "${key}": Triggers for: ${response.Triggers.join(', ')}`;
  });

  try {
    const openai = new OpenAI({ apiKey: getConfig('ai.openaiKey', '') });

    const response = await openai.chat.completions.create({
      model: getConfig('ai.model', 'gpt-3.5-turbo'),
      messages: [
        { role: 'system', content: fullSystemPrompt },
        { role: 'user',   content: `Analyze this user message: "${userMessage}"` },
      ],
      temperature: 0.3,
      max_tokens: 150,
    });

    const aiResult = JSON.parse(response.choices[0].message.content);
    
    if (aiResult.match && 
        aiResult.confidence >= getConfig('ai.confidenceThreshold', 0.7) &&
        availableResponses[aiResult.response_key]) {
      
      const responseConfig = availableResponses[aiResult.response_key];
      const responseMsg = responseConfig.Message;
      const responseType = responseConfig.Type || "TEXT";

      let sentMessage;

      if (responseType === "EMBED") {
        const aiEmbed = new EmbedBuilder();
        
        const embedColor = responseConfig.Color || getConfig('ai.embed.color', '#5865F2') || config.EmbedColors || "#5865F2";
        aiEmbed.setColor(embedColor);
        
        if (getConfig('ai.embed.title', '?? AI Assistant') && getConfig('ai.embed.title', '?? AI Assistant').trim() !== "") {
          aiEmbed.setTitle(getConfig('ai.embed.title', '?? AI Assistant'));
        }
        
        aiEmbed.setDescription(responseMsg);
        
        if (getConfig('ai.embed.thumbnailURL', '') && getConfig('ai.embed.thumbnailURL', '').trim() !== "") {
          aiEmbed.setThumbnail(getConfig('ai.embed.thumbnailURL', ''));
        }
        
        if (getConfig('ai.embed.footer', {}) && getConfig('ai.embed.footer.text', 'Powered by AI') && getConfig('ai.embed.footer.text', 'Powered by AI').trim() !== "") {
          const footerOptions = {
            text: getConfig('ai.embed.footer.text', 'Powered by AI')
          };
          
          if (getConfig('ai.embed.footer.showUserAvatar', true) !== false) {
            footerOptions.iconURL = message.author.displayAvatarURL({ dynamic: true });
          }
          
          aiEmbed.setFooter(footerOptions);
        }

        if (getConfig('ai.embed.footer', {}) && getConfig('ai.embed.footer.showTimestamp', true) !== false) {
          aiEmbed.setTimestamp();
        }

        if (getConfig('ai.buttonSettings.enabled', true)) {
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`ai_helpful_${message.id}`)
                .setLabel(getConfig('ai.buttonSettings.helpfulButton', '?? H?u �ch'))
                .setStyle('Success'),
              new ButtonBuilder()
                .setCustomId(`ai_not_helpful_${message.id}`)
                .setLabel(getConfig('ai.buttonSettings.notHelpfulButton', '?? C?n h? tr? th�m'))
                .setStyle('Secondary')
            );

          sentMessage = await message.reply({ 
            embeds: [aiEmbed], 
            components: [row] 
          });
        } else {
          sentMessage = await message.reply({ embeds: [aiEmbed] });
        }

      } else if (responseType === "TEXT") {
        if (getConfig('ai.buttonSettings.enabled', true)) {
          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`ai_helpful_${message.id}`)
                .setLabel(getConfig('ai.buttonSettings.helpfulButton', '?? H?u �ch'))
                .setStyle('Success'),
              new ButtonBuilder()
                .setCustomId(`ai_not_helpful_${message.id}`)
                .setLabel(getConfig('ai.buttonSettings.notHelpfulButton', '?? C?n h? tr? th�m'))
                .setStyle('Secondary')
            );

          sentMessage = await message.reply({ 
            content: responseMsg, 
            components: [row] 
          });
        } else {
          sentMessage = await message.reply({ content: responseMsg });
        }
      }

      if (getConfig('ai.enabled', false) && getConfig('ai.statistics.enabled', true)) {
        const now = new Date();
        AIResponses.create({
          messageId:      message.id,
          userId:         message.author.id,
          channelId:      message.channel.id,
          guildId:        message.guild.id,
          userMessage,
          responseKey:    aiResult.response_key,
          aiConfidence:   aiResult.confidence,
          aiReasoning:    aiResult.reasoning,
          responseType,
          responseMessage: responseMsg,
          month: now.getMonth() + 1,
          year:  now.getFullYear(),
        });

      if (getConfig('ai.statistics.logsChannelID', '') && getConfig('ai.statistics.logsChannelID', '') !== "CHANNEL_ID") {
        const logsChannel = message.guild.channels.cache.get(getConfig('ai.statistics.logsChannelID', ''));
        if (logsChannel) {
          const logEmbed = new EmbedBuilder()
            .setColor('#00FF7F')
            .setAuthor({ name: '🤖 AI AutoResponse Triggered' })
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

          let logContent = '';
          logContent += `> **User:** <@!${message.author.id}> \`${message.author.username}\`\n`;
          logContent += `> **Channel:** <#${message.channel.id}>\n`;
          logContent += `> **Response:** \`${aiResult.response_key}\`\n`;
          logContent += `> **Confidence:** \`${(aiResult.confidence * 100).toFixed(1)}%\`\n`;
          logContent += `> **Context:** \`${isInTicket ? 'Ticket' : 'General'}\`\n`;
          logContent += `> **Message:** ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}`;

          logEmbed.addFields([{
            name: '`📊` **AI Analysis Details**',
            value: logContent
          }]);

          logEmbed.setFooter({
            text: `AI Reasoning: ${aiResult.reasoning}`,
            iconURL: message.author.displayAvatarURL({ dynamic: true })
          });

          logsChannel.send({ embeds: [logEmbed] });
        }
      }
      } // đóng if (getConfig('ai.statistics.enabled'))
    }

  } catch (error) {
    console.error('AI AutoResponse Error:', error);
  }
}

async function autoClaimTicket(client, message, ticketDB) {
  try {
    let logMsg = `\n\n[${new Date().toLocaleString()}] [AUTO-CLAIM] User: ${message.author.username}`;
    fs.appendFile("./logs.txt", logMsg, (e) => { 
      if(e) console.log(e);
    });
    

    const maxClaims = getConfig('claiming.maxPerStaff', 3);
    if (maxClaims > 0) {
      const exemptRoles = getConfig('claiming.exemptRoles', []);
      const isExempt = exemptRoles.some(roleId => message.member.roles.cache.has(roleId));

      if (!isExempt) {
        const db = require('../db/index');
        const claimedTickets = db.prepare(
          "SELECT COUNT(*) AS cnt FROM tickets WHERE claimUser = ? AND claimed = 1 AND status = 'Open'"
        ).get(message.author.id).cnt;

        if (claimedTickets >= maxClaims) return false;
      }
    }

    const autoClaimMsg = getConfig('claiming.autoClaim.message', 'Ticket này đã được tự động nhận bởi {user}');
    const embedClaimVar = autoClaimMsg.replace(/{user}/g, `<@!${message.author.id}>`);
    
    const embed = new EmbedBuilder()
      .setTitle(t('ticket.claim.claimedTitle'))
      .setColor("Green")
      .setDescription(embedClaimVar)
      .setTimestamp()
      .setFooter({ 
        text: `${t('ticket.claim.claimedBy')} ${message.author.username}`, 
        iconURL: message.author.displayAvatarURL({ dynamic: true }),
      });
    
    if (getConfig('claiming.autoClaim.showMessage', true)) {
      await message.channel.send({ embeds: [embed] });
    }
    
    try {
      const msg = await message.channel.messages.fetch(ticketDB.msgID);
      
      if (msg && msg.embeds && msg.embeds.length > 0) {
        const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
        
        originalEmbed.data.fields = originalEmbed.data.fields || [];
        if (originalEmbed.data.fields.length > 0) {
          originalEmbed.data.fields[0] = { 
            name: t('ticket.claim.claimedBy'), 
            value: `> <@!${message.author.id}> (${message.author.username})` 
          };
        } else {
          originalEmbed.addFields([{
            name: t('ticket.claim.claimedBy'), 
            value: `> <@!${message.author.id}> (${message.author.username})`
          }]);
        }
        
        const ticketDeleteButton = new ButtonBuilder()
          .setCustomId('closeTicket')
          .setLabel(t('buttons.close'))
          .setStyle(getConfig('buttons.colors.closeTicket', 'Danger'))
          .setEmoji(getConfig('buttons.emojis.closeTicket', '🔒'));
          
        const ticketClaimButton = new ButtonBuilder()
          .setCustomId('ticketclaim')
          .setLabel(t('ticket.claim.button'))
          .setEmoji(getConfig('buttons.emojis.ticketClaim', '👋'))
          .setStyle(getConfig('buttons.colors.ticketClaim', 'Success'))
          .setDisabled(true);
          
        const ticketUnClaimButton = new ButtonBuilder()
          .setCustomId('ticketunclaim')
          .setLabel(t('ticket.claim.unclaimButton'))
          .setStyle(getConfig('buttons.colors.ticketUnclaim', 'Primary'));
          
        const row = new ActionRowBuilder().addComponents(ticketDeleteButton, ticketClaimButton, ticketUnClaimButton);
        
        await msg.edit({ embeds: [originalEmbed], components: [row] });
      }
    } catch (error) {
      console.error("Lỗi cập nhật tin nhắn ticket:", error);
    }
    
    const userPermsEnabled = getConfig('claiming.userPerms', null);
    if (userPermsEnabled) {
      try {
        const Categories = require('../db/categories');
        const cat = Categories.findAll().find(c => c.categoryName === ticketDB.ticketType);
        
        if (cat?.supportRoles) {
          await Promise.all(cat.supportRoles.map(async (sRoles) => {
            const role = message.guild.roles.cache.get(sRoles);
            if (role) {
              await message.channel.permissionOverwrites.edit(role, {
                SendMessages: getConfig('claiming.userPerms.sendMessages', false),
                ViewChannel:  getConfig('claiming.userPerms.viewChannel', true),
              });
            }
          }));
        }
        
        await message.channel.permissionOverwrites.edit(message.author, {
          SendMessages: true, ViewChannel: true,
          AttachFiles: true, EmbedLinks: true, ReadMessageHistory: true,
        });
      } catch (error) {
        console.error("Lỗi cập nhật permissions:", error);
      }
    }

    const moveEnabled   = getConfig('claiming.moveEnabled', true);
    const moveCategoryID= getConfig('claiming.moveCategoryID', '');
    if (moveEnabled && moveCategoryID) {
        const claimedCategory = message.guild.channels.cache.get(moveCategoryID);
        if (claimedCategory && claimedCategory.type === 4) {
            Tickets.updateByChannelID(message.channel.id, {
                originalCategoryID: message.channel.parentId,
            });
            await message.channel.setParent(moveCategoryID, { lockPermissions: false })
              .catch(err => console.error('Lỗi di chuyển ticket:', err));
        }
    }
    
    Tickets.updateByChannelID(message.channel.id, {
      claimed:   true,
      claimUser: message.author.id,
    });
    

      try {
        const logsChannel = await utils.getCategoryLogsChannel(message.channel.id);
        
        if (logsChannel) {
          const log = new EmbedBuilder()
            .setColor('#4CAF50')
            .setAuthor({ 
              name: config.Locale.ticketClaimedLog
            })
            .setThumbnail(message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
            .setTimestamp();
            
          let mainContent = '';
          mainContent += `> **${t('logs.executor')}:** <@!${message.author.id}> \`${message.author.username}\`\n`;
          mainContent += `> **${t('logs.ticket')}:** <#${message.channel.id}> \`#${message.channel.name}\`\n`;
          mainContent += `> **${t('logs.category')}:** \`${ticketDB.ticketType}\`\n`;
          mainContent += `> **${t('ticket.claim.autoClaimedNote')}:** \`Tự động nhận khi phản hồi đầu tiên\``;
          
          log.addFields([
            { 
              name: `\`🎫\` **${t('logs.claimDetails')}**`, 
              value: mainContent 
            }
          ]);
          
          log.setFooter({ 
            text: message.author.username, 
            iconURL: message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 16 }) 
          });
          
          await logsChannel.send({ embeds: [log] });
        }
      } catch (error) {
        console.error("Error sending claim log:", error);
      }
    
    try {
      client.emit('ticketClaim', message);
    } catch (error) {
      console.error("Error tracking claim stat:", error);
    }
  } catch (error) {
    console.error("Error in auto-claim function:", error);
  }
}

};

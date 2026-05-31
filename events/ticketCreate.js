const { Discord, StringSelectMenuBuilder, EmbedBuilder, ActionRowBuilder, TextInputBuilder, ModalBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const Guild   = require("../db/guild");
const Tickets = require("../db/tickets");
const { getConfig } = require("../db/config");
const { incrementStat } = require("../staffStats.js");
const moment = require('moment-timezone');

const MAX_RETRIES = 2; // Maximum number of retries for editing questions into original ticket embed
const RETRY_DELAY = 3000; // Delay between retries in milliseconds
const SECOND_UPDATE_DELAY = 5000; // Delay for second update regardless of error

module.exports = async (client, interaction, channel, buttonConfig) => {
    try {
        const ticket = Tickets.findByChannelID(channel.id);
        if (!ticket) {
            console.error('No ticket found for channel:', channel.id);
            return;
        }

        // Tăng totalTickets
        Guild.increment(config.GuildID, 'totalTickets');

        // Sync openTickets
        const openNow = Guild.syncOpenTickets(config.GuildID);

        // Cảnh báo overload
        const overloadEnabled   = getConfig('overload.enabled', true);
        const overloadThreshold = getConfig('overload.threshold', 20);
        const overloadMsg       = getConfig('overload.warningMessage',
          '## ⚠️ Lượng ticket cao!\nThời gian phản hồi có thể lâu hơn bình thường.');

        if (overloadEnabled && openNow >= overloadThreshold) {
            const overloadEmbed = new EmbedBuilder()
                .setColor("Yellow")
                .setDescription(overloadMsg)
                .setFooter({
                    text: interaction.user.username,
                    iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }),
                })
                .setTimestamp();

            await channel.send({ embeds: [overloadEmbed] }).catch(console.error);
        }

        await handleWorkingHoursNotice(client, interaction, channel);

        if (!ticket.questions?.length) return;

        await updateTicketMessage(channel, ticket, interaction);
        
        setTimeout(async () => {
            await updateTicketMessage(channel, ticket, interaction);
        }, SECOND_UPDATE_DELAY);

    } catch (error) {
        console.error('Error in ticketCreate event:', error);
    }
};

async function updateTicketMessage(channel, ticket, interaction) {
    const config = require('../db/config');
    const formatting = {
      QuestionPrefix:       config.getConfig('ticket.questionFormatting.prefix', '`❓`'),
      QuestionStyle:        config.getConfig('ticket.questionFormatting.questionStyle', 'Bold'),
      AnswerStyle:          config.getConfig('ticket.questionFormatting.answerStyle', 'CodeBlock'),
      NotAnsweredText:      config.getConfig('ticket.questionFormatting.notAnsweredText', 'Chưa trả lời'),
      DisplaySideBySide:    config.getConfig('ticket.questionFormatting.displaySideBySide', false),
      AddSpaceBetweenQuestions: false,
    };
    try {
        const ticketMessage = await channel.messages.fetch(ticket.msgID);
        if (!ticketMessage) {
            console.error('Could not find original ticket message');
            return false;
        }

        const originalEmbed = ticketMessage.embeds[0];
        if (!originalEmbed) {
            console.error('No embed found in original message');
            return false;
        }

        const updatedEmbed = EmbedBuilder.from(originalEmbed);

        const hasQuestionsAlready = originalEmbed.fields?.some(field => 
            ticket.questions.some(q => 
                field.name.includes(q.question) || 
                (q.response && field.value.includes(q.response))
            )
        );

        if (hasQuestionsAlready) {
            return true;
        }

        let fieldsToKeep = [];
        if (originalEmbed.fields) {
            fieldsToKeep = originalEmbed.fields.filter(field => {
                return !ticket.questions.some(q => q.question === field.name);
            });
        }
        
        updatedEmbed.setFields(fieldsToKeep);

        // formatting d� khai b�o ? d?u h�m
        for (const question of ticket.questions) {
            if (formatting.AddSpaceBetweenQuestions && updatedEmbed.fields.length > 0) {
                updatedEmbed.addFields({ name: '\u200B', value: '\u200B', inline: false });
            }
            
            let questionText = question.question;
            
            if (formatting.QuestionPrefix) {
                questionText = `${formatting.QuestionPrefix} ${questionText}`;
            }
            
            if (formatting.QuestionStyle) {
                if (formatting.QuestionStyle.toLowerCase() === 'bold') {
                    questionText = `**${questionText}**`;
                } else if (formatting.QuestionStyle.toLowerCase() === 'italic') {
                    questionText = `*${questionText}*`;
                }
            }
            
            let answerText;
            const notAnsweredText = formatting.NotAnsweredText || "Not answered";
            
            if (question.response) {
                const style = formatting.AnswerStyle?.toLowerCase() || 'codeblock';
                
                if (style === 'codeblock') {
                    answerText = `\`\`\`\n${question.response}\n\`\`\``;
                } else if (style === 'quoteblock') {
                    answerText = question.response.split('\n')
                        .map(line => `> ${line}`)
                        .join('\n');
                } else if (style === 'bold') {
                    answerText = `**${question.response}**`;
                } else if (style === 'italic') {
                    answerText = `*${question.response}*`;
                } else {
                    answerText = question.response;
                }
            } else {
                answerText = `\`\`\`\n${notAnsweredText}\n\`\`\``;
            }
            
            updatedEmbed.addFields({
                name: questionText,
                value: answerText,
                inline: formatting.DisplaySideBySide === true
            });
        }

        await ticketMessage.edit({ embeds: [updatedEmbed] }).catch(() => {});
        return true;
    } catch (error) {
        console.error(`Error updating ticket message:`, error);
        
        const success = await updateTicketMessageWithRetry(channel, ticket, interaction, config, 0);
        return success;
    }
}

async function updateTicketMessageWithRetry(channel, ticket, interaction, config, retryCount = 0) {
    try {
        const ticketMessage = await channel.messages.fetch(ticket.msgID);
        if (!ticketMessage) {
            console.error('Could not find original ticket message');
            return false;
        }

        const originalEmbed = ticketMessage.embeds[0];
        if (!originalEmbed) {
            console.error('No embed found in original message');
            return false;
        }

        const hasQuestionsAlready = originalEmbed.fields?.some(field => 
            ticket.questions.some(q => 
                field.name.includes(q.question) || 
                (q.response && field.value.includes(q.response))
            )
        );

        if (hasQuestionsAlready) {
            return true;
        }

        const updatedEmbed = EmbedBuilder.from(originalEmbed);

        let fieldsToKeep = [];
        if (originalEmbed.fields) {
            fieldsToKeep = originalEmbed.fields.filter(field => {
                return !ticket.questions.some(q => q.question === field.name);
            });
        }
        
        updatedEmbed.setFields(fieldsToKeep);

        // formatting d� khai b�o ? d?u h�m
        for (const question of ticket.questions) {
            if (formatting.AddSpaceBetweenQuestions && updatedEmbed.fields.length > 0) {
                updatedEmbed.addFields({ name: '\u200B', value: '\u200B', inline: false });
            }
            
            let questionText = question.question;
            
            if (formatting.QuestionPrefix) {
                questionText = `${formatting.QuestionPrefix} ${questionText}`;
            }
            
            if (formatting.QuestionStyle) {
                if (formatting.QuestionStyle.toLowerCase() === 'bold') {
                    questionText = `**${questionText}**`;
                } else if (formatting.QuestionStyle.toLowerCase() === 'italic') {
                    questionText = `*${questionText}*`;
                }
            }
            
            let answerText;
            const notAnsweredText = formatting.NotAnsweredText || "Not answered";
            
            if (question.response) {
                const style = formatting.AnswerStyle?.toLowerCase() || 'codeblock';
                
                if (style === 'codeblock') {
                    answerText = `\`\`\`\n${question.response}\n\`\`\``;
                } else if (style === 'quoteblock') {
                    answerText = question.response.split('\n')
                        .map(line => `> ${line}`)
                        .join('\n');
                } else if (style === 'bold') {
                    answerText = `**${question.response}**`;
                } else if (style === 'italic') {
                    answerText = `*${question.response}*`;
                } else {
                    answerText = question.response;
                }
            } else {
                answerText = `\`\`\`\n${notAnsweredText}\n\`\`\``;
            }
            
            updatedEmbed.addFields({
                name: questionText,
                value: answerText,
                inline: formatting.DisplaySideBySide === true
            });
        }

        await ticketMessage.edit({ embeds: [updatedEmbed] }).catch(() => {});
        return true;
    } catch (error) {
        console.error(`Error updating ticket message (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
        
        if (retryCount < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return updateTicketMessageWithRetry(channel, ticket, interaction, retryCount + 1);
        } else {
            console.error('Failed to update ticket message after all retry attempts');
            return false;
        }
    }
}

// Cập nhật working hours để dùng getConfig thay vì config.yml
async function handleWorkingHoursNotice(client, interaction, channel) {
  const { getConfig } = require('../db/config');
  const { t }         = require('../lang/index');
  const whEnabled = getConfig('workingHours.enabled', true);
  const whAllow   = getConfig('workingHours.allowOutside', false);
  const whNotice  = getConfig('workingHours.sendNotice', true);
  if (!whEnabled || !whAllow || !whNotice) return;

  const timezone    = getConfig('workingHours.timezone', 'Asia/Ho_Chi_Minh');
  const exemptRoles = getConfig('workingHours.exemptRoles', []);
  const schedule    = getConfig('workingHours.schedule', {});

  if (exemptRoles.length > 0) {
    const userRoles = interaction.member.roles.cache.map(r => r.id);
    if (exemptRoles.some(id => userRoles.includes(id))) return;
  }

  const workingHoursRegex = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;
  const currentDay   = moment().tz(timezone).format('dddd');
  const workingHours = schedule[currentDay];

  const isDayDisabled = workingHours &&
    ['disabled', 'off', 'closed'].includes(workingHours.toLowerCase());

  let withinWorkingHours = false;

  if (isDayDisabled) {
    withinWorkingHours = false;
  } else if (!workingHours) {
    return;
  } else {
    const match = workingHours.match(workingHoursRegex);
    if (!match) return;
    const now       = moment().tz(timezone);
    const dateStr   = now.format('YYYY-MM-DD');
    const startTime = moment.tz(`${dateStr} ${match[1]}`, 'YYYY-MM-DD H:mm', timezone);
    const endTime   = moment.tz(`${dateStr} ${match[2]}`, 'YYYY-MM-DD H:mm', timezone);
    if (!startTime.isValid() || !endTime.isValid() || startTime.isSameOrAfter(endTime)) return;
    withinWorkingHours = now.isBetween(startTime, endTime);
  }

  if (!withinWorkingHours) {
    let msg = t('ticket.workingHours.noticeMsg');

    if (isDayDisabled) {
      msg = msg.replace(/{startTime-currentDay} to {endTime-currentDay}/g, 'Đóng cửa hôm nay')
               .replace(/{startTime-currentDay}/g, 'Đóng')
               .replace(/{endTime-currentDay}/g, 'Đóng');
    } else {
      const match   = workingHours.match(workingHoursRegex);
      const dateStr = moment().tz(timezone).format('YYYY-MM-DD');
      const start   = moment.tz(`${dateStr} ${match[1]}`, 'YYYY-MM-DD H:mm', timezone);
      const end     = moment.tz(`${dateStr} ${match[2]}`, 'YYYY-MM-DD H:mm', timezone);
      msg = msg.replace(/{startTime-currentDay}/g, `<t:${start.unix()}:t>`)
               .replace(/{endTime-currentDay}/g,   `<t:${end.unix()}:t>`);
    }

    for (const [day, hours] of Object.entries(schedule)) {
      if (!hours) continue;
      if (['disabled', 'off', 'closed'].includes(hours.toLowerCase())) {
        msg = msg.replace(new RegExp(`{startTime-${day}} to {endTime-${day}}`, 'g'), 'Đóng')
                 .replace(new RegExp(`{startTime-${day}}`, 'g'), 'Đóng')
                 .replace(new RegExp(`{endTime-${day}}`, 'g'), 'Đóng');
      } else {
        const m = hours.match(workingHoursRegex);
        if (m) {
          const dateStr = moment().tz(timezone).format('YYYY-MM-DD');
          const s = moment.tz(`${dateStr} ${m[1]}`, 'YYYY-MM-DD H:mm', timezone);
          const e = moment.tz(`${dateStr} ${m[2]}`, 'YYYY-MM-DD H:mm', timezone);
          msg = msg.replace(new RegExp(`{startTime-${day}}`, 'g'), `<t:${s.unix()}:t>`)
                   .replace(new RegExp(`{endTime-${day}}`, 'g'), `<t:${e.unix()}:t>`);
        }
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(t('ticket.workingHours.title'))
      .setColor('Red')
      .setDescription(msg)
      .setFooter({
        text:    interaction.user.username,
        iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }),
      })
      .setTimestamp();

    if (channel) channel.send({ embeds: [embed] });
  }
}

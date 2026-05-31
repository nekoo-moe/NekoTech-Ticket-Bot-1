const { Collection, Client, Discord, Intents, AttachmentBuilder, ActionRowBuilder, EmbedBuilder, ButtonBuilder } = require('discord.js');
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const client = require("./index.js")
const color = require('ansi-colors');

const { getConfig } = require('./db/config');
const Guild   = require('./db/guild');
const Tickets = require('./db/tickets');
const Reviews = require('./db/reviews');

// Chỉ load discord-html-transcripts nếu transcript type là HTML
let discordTranscripts;
const transcriptType = getConfig('transcript.type', 'HTML');
if (transcriptType === "HTML") {
  try { discordTranscripts = require('discord-html-transcripts'); }
  catch (_) {}
}

const { EventEmitter } = require('events');
const eventHandler = new EventEmitter();
  
exports.eventHandler = eventHandler;

client.cooldowns = new Collection();

// Khởi tạo VietQR — cấu hình qua /setup vietqr hoặc SQLite config
// Không cần khởi tạo SDK, VietQR dùng REST API thuần qua axios

// Get average ticket rating — dùng SQLite
  exports.averageRating = async function (client) {
    try {
      const avg = Reviews.averageRating(config.GuildID);
      Guild.update(config.GuildID, { averageRating: avg });
      return avg.toFixed(1);
    } catch (error) {
      console.error('Lỗi lấy averageRating:', error);
      return "0.0";
    }
  };

  exports.createSuggestionButtons = async function (suggestion, disabled = false) {
    const totalVotes = suggestion.upVotes + suggestion.downVotes;
    const upvotePercentage   = totalVotes > 0 ? Math.round((suggestion.upVotes   / totalVotes) * 100) : 0;
    const downvotePercentage = totalVotes > 0 ? Math.round((suggestion.downVotes / totalVotes) * 100) : 0;
    
    const buttonStyleMap = { Blurple: 'Primary', Gray: 'Secondary', Green: 'Success', Red: 'Danger' };

    const upvoteColor   = getConfig('suggestion.upvote.buttonColor',   'Gray');
    const downvoteColor = getConfig('suggestion.downvote.buttonColor', 'Gray');
    const resetColor    = getConfig('suggestion.resetvote.buttonColor','Gray');
    const upvoteEmoji   = getConfig('suggestion.upvote.buttonEmoji',   '⬆️');
    const downvoteEmoji = getConfig('suggestion.downvote.buttonEmoji', '⬇️');
    const resetEmoji    = getConfig('suggestion.resetvote.buttonEmoji','🗑️');
    const upvoteName    = getConfig('suggestion.upvote.buttonName',    '{count} votes • {percentage}%');
    const downvoteName  = getConfig('suggestion.downvote.buttonName',  '{count} votes • {percentage}%');
    const resetName     = getConfig('suggestion.resetvote.buttonName', 'Đặt lại phiếu');

    const upvoteLabel   = upvoteName.replace('{count}', suggestion.upVotes).replace('{percentage}', upvotePercentage);
    const downvoteLabel = downvoteName.replace('{count}', suggestion.downVotes).replace('{percentage}', downvotePercentage);
    
    const upvoteButton = new ButtonBuilder()
        .setCustomId('upvote').setLabel(upvoteLabel)
        .setStyle(buttonStyleMap[upvoteColor] || 'Secondary')
        .setEmoji(upvoteEmoji).setDisabled(disabled);

    const downvoteButton = new ButtonBuilder()
        .setCustomId('downvote').setLabel(downvoteLabel)
        .setStyle(buttonStyleMap[downvoteColor] || 'Secondary')
        .setEmoji(downvoteEmoji).setDisabled(disabled);

    const resetvoteButton = new ButtonBuilder()
        .setCustomId('resetvote').setLabel(resetName)
        .setStyle(buttonStyleMap[resetColor] || 'Secondary')
        .setEmoji(resetEmoji).setDisabled(disabled);
  
    return new ActionRowBuilder().addComponents(upvoteButton, downvoteButton, resetvoteButton);
  };

  exports.checkConfig = async function(client) {
    let foundErrors = [];
    try {
      let guild = client.guilds.cache.get(config.GuildID);
      if (!guild) {
        console.log('\x1b[31m%s\x1b[0m', `[LỖI NGHIÊM TRỌNG] GuildID không hợp lệ trong config!`);
        foundErrors.push("GuildID không hợp lệ trong config!");
      }

      // Kiểm tra màu embed
      const embedColor = getConfig('bot.embedColor', '#5e99ff');
      const hexColorRegex = /^#([0-9a-f]{3}){1,2}$/i;
      if (!hexColorRegex.test(embedColor)) {
        console.log('\x1b[31m%s\x1b[0m', `[CẢNH BÁO] embedColor không phải màu HEX hợp lệ!`);
        foundErrors.push("embedColor không phải màu HEX hợp lệ!");
      }

      // Kiểm tra logsChannelID
      const logsChannelID = getConfig('ticket.logsChannelID', '');
      if (!logsChannelID || logsChannelID.trim() === '') {
        console.log('\x1b[33m%s\x1b[0m', `[CẢNH BÁO] ticket.logsChannelID chưa được cấu hình. Dùng /setup ticket logschannel để cấu hình.`);
      } else if (guild && !guild.channels.cache.get(logsChannelID)) {
        console.log('\x1b[31m%s\x1b[0m', `[LỖI] ticket.logsChannelID không phải kênh hợp lệ!`);
        foundErrors.push("ticket.logsChannelID không phải kênh hợp lệ!");
      }

      // Kiểm tra categories
      const Categories = require('./db/categories');
      const cats = Categories.findAll();
      if (!cats.length) {
        console.log('\x1b[33m%s\x1b[0m', `[CẢNH BÁO] Chưa có danh mục ticket nào. Dùng /setup category create để tạo.`);
      }

      let dashboardExists = await exports.checkDashboard();
      if (dashboardExists) {
        const transcriptType     = getConfig('transcript.type', 'HTML');
        const transcriptInFolder = getConfig('transcript.saveInFolder', true);
        if (transcriptType !== 'HTML') {
          console.log('\x1b[31m%s\x1b[0m', `[LỖI] Dashboard bật nhưng transcript.type không phải "HTML"!`);
          foundErrors.push('Dashboard bật nhưng transcript.type không phải "HTML"!');
        }
        if (!transcriptInFolder) {
          console.log('\x1b[31m%s\x1b[0m', `[LỖI] Dashboard bật nhưng transcript.saveInFolder = false!`);
          foundErrors.push('Dashboard bật nhưng transcript.saveInFolder = false!');
        }
      }

      if (foundErrors.length > 0) {
        console.log('\x1b[31m%s\x1b[0m', `[CONFIG] Tìm thấy ${foundErrors.length} lỗi cấu hình.`);
      } else {
        console.log('\x1b[32m%s\x1b[0m', `[CONFIG] Cấu hình hợp lệ ✅`);
      }

      return foundErrors;
    } catch (err) {
      console.error('[CONFIG] Lỗi kiểm tra config:', err);
      return foundErrors;
    }
  };

// ─── checkDashboard ──────────────────────────────────────────────────────────
exports.checkDashboard = async function() {
  try {
    return fs.existsSync('./addons/Dashboard/dashboard.js');
  } catch (_) {
    return false;
  }
};

// ─── getCategoryLogsChannel ───────────────────────────────────────────────────
exports.getCategoryLogsChannel = async function(channelID) {
  try {
    const Tickets    = require('./db/tickets');
    const { getConfig } = require('./db/config');
    const ticket     = Tickets.findByChannelID(channelID);
    const Categories = require('./db/categories');

    if (ticket) {
      const cat = Categories.findAll().find(c => c.categoryName === ticket.ticketType);
      if (cat && cat.logsChannelID) {
        const ch = client.channels.cache.get(cat.logsChannelID);
        if (ch) return ch;
      }
    }

    const defaultLogsID = getConfig('ticket.logsChannelID', '');
    if (defaultLogsID) {
      const ch = client.channels.cache.get(defaultLogsID);
      if (ch) return ch;
    }
    return null;
  } catch (err) {
    console.error('[utils] getCategoryLogsChannel error:', err);
    return null;
  }
};

// ─── saveTranscript ───────────────────────────────────────────────────────────
exports.saveTranscript = async function(interaction) {
  try {
    const { getConfig } = require('./db/config');
    const transcriptType     = getConfig('transcript.type', 'HTML');
    const saveInFolder       = getConfig('transcript.saveInFolder', true);
    const saveImages         = getConfig('transcript.saveImages', false);
    const dashboardExists    = await exports.checkDashboard();
    const timestamp          = Date.now();

    let attachment = null;

    if (transcriptType === 'HTML' && discordTranscripts) {
      const transcript = await discordTranscripts.createTranscript(interaction.channel, {
        limit: -1,
        returnBuffer: false,
        filename: `transcript-${interaction.channel.id}-${timestamp}.html`,
        saveImages,
      });

      attachment = transcript;

      if (saveInFolder) {
        const folder = dashboardExists ? './addons/Dashboard/transcripts' : './transcripts';
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        const filePath = `${folder}/transcript-${interaction.channel.id}-${timestamp}.html`;
        fs.writeFileSync(filePath, transcript.attachment);
      }
    } else if (transcriptType === 'TXT') {
      const messages = await interaction.channel.messages.fetch({ limit: 100 });
      const lines    = messages.reverse().map(m =>
        `[${new Date(m.createdTimestamp).toLocaleString('vi-VN')}] ${m.author.tag}: ${m.content}`
      );
      const content  = lines.join('\n');
      const { AttachmentBuilder } = require('discord.js');
      attachment = new AttachmentBuilder(Buffer.from(content), {
        name: `transcript-${interaction.channel.id}-${timestamp}.txt`,
      });

      if (saveInFolder) {
        const folder = dashboardExists ? './addons/Dashboard/transcripts' : './transcripts';
        if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(`${folder}/transcript-${interaction.channel.id}-${timestamp}.txt`, content);
      }
    }

    return { attachment, timestamp };
  } catch (err) {
    console.error('[utils] saveTranscript error:', err);
    return { attachment: null, timestamp: Date.now() };
  }
};

// ─── getHolidayMessage ────────────────────────────────────────────────────────
exports.getHolidayMessage = async function() {
  // Placeholder — có thể mở rộng sau
  return null;
};

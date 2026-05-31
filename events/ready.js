/**
 * events/ready.js
 * Khởi động bot: load slash commands, seed DB, set activity.
 * Đã chuyển từ MongoDB → SQLite, từ config.yml Locale → lang/vi.json
 */

'use strict';

const fs      = require('fs');
const yaml    = require('js-yaml');
const config  = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const color   = require('ansi-colors');
const Discord = require('discord.js');
const { Collection } = Discord;
const ms      = require('ms');
const moment  = require('moment-timezone');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { glob } = require('glob');
const path    = require('path');

const botVersion = require('../package.json');
const utils      = require('../utils.js');
const { t }      = require('../lang/index');

// DB modules
const Guild      = require('../db/guild');
const Tickets    = require('../db/tickets');
const { getConfig, setConfig, seedDefaults } = require('../db/config');
const Categories = require('../db/categories');

// Guard: chỉ chạy toàn bộ ready logic 1 lần dù event fire nhiều lần
let _readyExecuted = false;

module.exports = async (client) => {
  if (_readyExecuted) {
    // Reconnect — chỉ cập nhật activity, không load lại commands/addons
    console.log(color.yellow('[READY] Bot đã reconnect — bỏ qua re-init.'));
    return;
  }
  _readyExecuted = true;

  client.commands     = new Collection();
  client.slashCommands = new Collection();

  // ── Kiểm tra GuildID ──────────────────────────────────────────────────────
  const guild = client.guilds.cache.get(config.GuildID);
  if (!guild) {
    console.log(color.red(
      `[LỖI] GuildID trong config không hợp lệ hoặc bot chưa vào server!\n` +
      `Mời bot: https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`
    ));
    process.exit();
  }

  // ── Seed config mặc định vào SQLite (chỉ insert nếu chưa có) ─────────────
  seedDefaults({
    // Thông tin cơ bản
    'bot.guildID':      config.GuildID,
    'bot.embedColor':   '#5e99ff',
    'bot.logCommands':  false,

    // Ticket settings
    'ticket.logsChannelID':          '',
    'ticket.blacklistedRoles':       [],
    'ticket.mentionAuthor':          false,
    'ticket.maxTickets':             1,
    'ticket.deleteTime':             5,
    'ticket.restrictClose':          false,
    'ticket.cooldown':               0,
    'ticket.selectMenu':             true,
    'ticket.deleteCommandTranscript':true,
    'ticket.channelTopic':           'Người tạo: {username} | Danh mục: {category}',
    'ticket.closeReason':            false,

    // Transcript
    'transcript.type':               'HTML',
    'transcript.saveInFolder':       true,
    'transcript.saveImages':         false,
    'transcript.messagesRequirement':1,

    // Claiming
    'claiming.enabled':              true,
    'claiming.maxPerStaff':          3,
    'claiming.exemptRoles':          [],
    'claiming.lockNewTickets':       true,
    'claiming.moveEnabled':          true,
    'claiming.moveCategoryID':       '',
    'claiming.autoClaim.enabled':    true,
    'claiming.autoClaim.showMessage':true,
    'claiming.autoClaim.override':   false,
    'claiming.autoClaim.message':    'Ticket này đã được tự động nhận bởi {user}',

    // Working hours
    'workingHours.enabled':          true,
    'workingHours.timezone':         'Asia/Ho_Chi_Minh',
    'workingHours.exemptRoles':      [],
    'workingHours.schedule': {
      Monday: '07:00-16:00', Tuesday: '07:00-16:00', Wednesday: '07:00-16:00',
      Thursday: '07:00-16:00', Friday: '07:00-16:00',
      Saturday: 'closed', Sunday: 'closed',
    },
    'workingHours.allowOutside':     false,
    'workingHours.sendNotice':       true,

    // Alert
    'alert.enabled':                 true,
    'alert.time':                    '12h',
    'alert.dmUser':                  false,
    'alert.autoAlert.enabled':       false,
    'alert.autoAlert.inactiveTime':  '3d',

    // Overload
    'overload.enabled':              true,
    'overload.threshold':            20,

    // Review
    'review.enabled':                true,
    'review.askWhyModal':            false,
    'review.minimumWords':           20,
    'review.maximumWords':           250,
    'review.channel.enabled':        false,
    'review.channel.channelID':      '',

    // Archive
    'archive.enabled':               false,
    'archive.hideFromCreator':       true,
    'archive.moveToCategory':        true,
    'archive.categoryID':            '',
    'archive.channelNamePrefix':     'archived-',

    // Priority
    'priority.enabled':              false,

    // Suggestion
    'suggestion.enabled':            false,
    'suggestion.channelID':          '',
    'suggestion.createThreads':      true,

    // Staff roles
    'staffRoles':                    [],

    // Channel stats
    'channelStats.totalTickets.enabled':    false,
    'channelStats.totalTickets.channelID':  '',
    'channelStats.openTickets.enabled':     false,
    'channelStats.openTickets.channelID':   '',
    'channelStats.averageRating.enabled':   false,
    'channelStats.averageRating.channelID': '',
    'channelStats.memberCount.enabled':     false,
    'channelStats.memberCount.channelID':   '',

    // Bot activity
    'activity.enabled':              true,
    'activity.type':                 'WATCHING',
    'activity.status':               'ONLINE',
    'activity.interval':             30,
    'activity.statuses':             ['{total-tickets} tickets', '{total-users} users'],

    // Tags
    'tags.enabled':                  false,
    'tags.list':                     {},

    // AI
    'ai.enabled':                    false,
    'ai.openaiKey':                  '',
    'ai.model':                      'gpt-3.5-turbo',

    // PayPal
    'paypal.enabled':                false,
    'paypal.clientID':               '',
    'paypal.secretKey':              '',
    'paypal.email':                  '',
    'paypal.currency':               'USD',
    'paypal.currencySymbol':         '$',
    'paypal.onlyInTickets':          false,
    'paypal.logsChannelID':          '',

    // Stripe
    'stripe.enabled':                false,
    'stripe.secretKey':              '',
    'stripe.currency':               'USD',
    'stripe.currencySymbol':         '$',
    'stripe.onlyInTickets':          false,
    'stripe.logsChannelID':          '',

    // Crypto
    'crypto.enabled':                false,
    'crypto.currency':               'USD',
    'crypto.currencySymbol':         '$',
    'crypto.onlyInTickets':          false,
    'crypto.logsChannelID':          '',
    'crypto.addresses':              { BTC: '', ETH: '', USDT: '', LTC: '' },

    // Button customization
    'buttons.emojis.deleteTicket':   '⛔',
    'buttons.emojis.closeTicket':    '🔒',
    'buttons.emojis.ticketCreated':  '🎫',
    'buttons.emojis.ticketClaim':    '👋',
    'buttons.colors.deleteTicket':   'Secondary',
    'buttons.colors.closeTicket':    'Danger',
    'buttons.colors.ticketClaim':    'Success',
    'buttons.colors.ticketUnclaim':  'Primary',

    // Inactivity monitor
    'inactivity.enabled':            false,
    'inactivity.checkInterval':      '1h',
    'inactivity.unrespondedDuration':'24h',
    'inactivity.logChannel':         '',
    'inactivity.rolesToPing':        [],
  });

  // ── Seed categories từ config.yml nếu có (migration một lần) ─────────────
  // Sau khi seed xong, categories được quản lý qua /setup category
  // (Phần này chỉ chạy nếu bạn vẫn còn TicketCategories trong config.yml cũ)

  // ── Khởi tạo guild stats ──────────────────────────────────────────────────
  const statsDB = Guild.getOrCreate(config.GuildID);
  Guild.increment(config.GuildID, 'timesBotStarted');
  Guild.syncOpenTickets(config.GuildID);

  // ── Load Slash Commands ───────────────────────────────────────────────────
  if (config.GuildID) {
    try {
      console.log(color.cyan('[SLASH] Đang tải slash commands...'));
      const slashCommands = [];

      // Load từ slashCommands/
      try {
        const files = await glob('./slashCommands/**/*.js');
        for (const file of files) {
          try {
            const command  = require(path.resolve(file));
            const fileName = path.basename(file, '.js');
            const parts    = file.split(/[\/\\]/);
            const category = parts[parts.length - 2];

            if (category === 'contextMenu') {
              if (!command.data && !command.execute) continue;
              if (command.enabled === false) continue;
              if (command.data) {
                slashCommands.push(command.data.toJSON());
                client.slashCommands.set(command.data.name, command);
              }
              console.log(color.green(`[CONTEXT MENU] ${fileName} đã tải!`));
            } else {
              if (!command.data || !command.execute) continue;
              if (command.enabled === false) continue;
              slashCommands.push(command.data.toJSON());
              client.slashCommands.set(command.data.name, command);
              console.log(color.green(`[SLASH COMMAND] ${fileName} đã tải!`));
            }
          } catch (err) {
            console.error(color.red(`[LỖI] Không tải được ${file}:`), err.message);
          }
        }
      } catch (err) {
        console.error(color.red('[LỖI] Không tải được file commands:'), err);
      }

      // Load addons
      const loadedAddons = new Set();
      const eventHandler = {
        on:   (event, cb) => client.on(event, cb),
        emit: (event, ...args) => client.emit(event, ...args),
      };

      try {
        const files = await glob('./addons/**/*.js');
        for (const file of files) {
          if (!file.endsWith('.js')) continue;
          const parts      = file.split(/[\/\\]/);
          const addonsIdx  = parts.findIndex(p => p === 'addons');
          if (addonsIdx === -1) continue;
          const folderName = parts[addonsIdx + 1];

          if (!loadedAddons.has(folderName)) {
            loadedAddons.add(folderName);
            console.log(color.green(`[ADDON] ${folderName} đã tải!`));
          }

          try {
            const addon = require(path.resolve(file));
            if (addon && typeof addon.register === 'function') {
              addon.register({ on: eventHandler.on, emit: eventHandler.emit, client });
            }
            if (addon && addon.data?.toJSON) {
              const data = addon.data.toJSON();
              client.slashCommands.set(data.name, addon);
              slashCommands.push(data);
            }
          } catch (err) {
            console.error(color.red(`[LỖI] ${folderName}: ${err.message}`));
          }
        }
      } catch (err) {
        console.error(color.red('[LỖI] Không tải được addons:'), err);
      }

      // Đăng ký commands lên Discord
      if (slashCommands.length > 0) {
        console.log(color.cyan(`[SLASH] Đang đăng ký ${slashCommands.length} commands...`));
        try {
          const rest = new REST({ version: '10' }).setToken(config.Token);
          const res  = await rest.put(
            Routes.applicationGuildCommands(client.user.id, config.GuildID),
            { body: slashCommands }
          );
          console.log(color.green(`[SLASH] Đã đăng ký ${res.length} commands thành công.`));
        } catch (err) {
          console.error(color.red('[LỖI] Đăng ký commands thất bại:'), err.message);
        }
      }
    } catch (err) {
      console.error(color.red('[LỖI] Hệ thống slash commands:'), err);
    }
  }

  // ── Bot Activity ──────────────────────────────────────────────────────────
  const activityEnabled  = getConfig('activity.enabled', true);
  const activityStatuses = getConfig('activity.statuses', ['{total-tickets} tickets']);
  const activityType     = getConfig('activity.type', 'WATCHING');
  const activityStatus   = getConfig('activity.status', 'ONLINE');
  const activityInterval = getConfig('activity.interval', 30);

  const activityTypeMap = {
    WATCHING:  Discord.ActivityType.Watching,
    PLAYING:   Discord.ActivityType.Playing,
    COMPETING: Discord.ActivityType.Competing,
    LISTENING: Discord.ActivityType.Listening,
  };
  const statusMap = {
    ONLINE: 'online', IDLE: 'idle', DND: 'dnd', INVISIBLE: 'invisible',
  };

  if (activityEnabled && activityStatuses.length > 0) {
    let index = 0;
    const freshStats = () => Guild.getOrCreate(config.GuildID);

    const setActivity = async () => {
      const s   = freshStats();
      const msg = activityStatuses[index]
        .replace(/{total-users}/g,    guild.memberCount.toLocaleString('vi-VN'))
        .replace(/{total-tickets}/g,  (s.totalTickets || 0).toLocaleString('vi-VN'))
        .replace(/{open-tickets}/g,   (s.openTickets  || 0).toLocaleString('vi-VN'))
        .replace(/{total-messages}/g, (s.totalMessages|| 0).toLocaleString('vi-VN'))
        .replace(/{average-rating}/g, await utils.averageRating(client))
        .replace(/{average-completion}/g, s.averageCompletion || 'N/A')
        .replace(/{average-response}/g,   s.averageResponse   || 'N/A');

      client.user.setPresence({
        activities: [{ name: msg, type: activityTypeMap[activityType] || Discord.ActivityType.Watching }],
        status:     statusMap[activityStatus] || 'online',
      });
      index = (index + 1) % activityStatuses.length;
    };

    setActivity();
    setInterval(setActivity, activityInterval * 1000);
  }

  // ── Rời server lạ ─────────────────────────────────────────────────────────
  client.guilds.cache.forEach(g => {
    if (g.id !== config.GuildID) {
      g.leave();
      console.log(color.yellow(`[INFO] Đã rời server không được phép: ${g.name}`));
    }
  });

  if (guild && !guild.members.me.permissions.has('Administrator')) {
    console.log(color.red('[LỖI] Bot thiếu quyền ADMINISTRATOR!'));
  }

  // ── Channel stats (cập nhật mỗi 5 phút) ──────────────────────────────────
  const formatDuration = (ms_) => {
    const s = Math.floor(ms_ / 1000), m = Math.floor(s / 60),
          h = Math.floor(m / 60),     d = Math.floor(h / 24);
    if (d > 0) return `${h % 24 >= 12 ? d + 1 : d} ngày`;
    if (h > 0) return `${m % 60 >= 30 ? h + 1 : h} giờ`;
    if (m > 0) return `${s % 60 >= 30 ? m + 1 : m} phút`;
    return `${s} giây`;
  };

  setInterval(async () => {
    const s = Guild.getOrCreate(config.GuildID);

    const updateChannel = (key, nameKey, replacements) => {
      const enabled   = getConfig(`channelStats.${key}.enabled`, false);
      const channelID = getConfig(`channelStats.${key}.channelID`, '');
      if (!enabled || !channelID) return;
      const ch = guild.channels.cache.get(channelID);
      if (!ch) return;
      let name = getConfig(`channelStats.${key}.channelName`, nameKey);
      for (const [k, v] of Object.entries(replacements)) {
        name = name.replace(new RegExp(`{${k}}`, 'g'), v);
      }
      ch.setName(name).catch(() => {});
    };

    updateChannel('totalTickets', 'Tổng Ticket: {total-tickets}',
      { 'total-tickets': (s.totalTickets || 0).toLocaleString('vi-VN') });
    updateChannel('openTickets', 'Ticket Mở: {open-tickets}',
      { 'open-tickets': (s.openTickets || 0).toLocaleString('vi-VN') });
    updateChannel('averageRating', 'Đánh giá: ⭐{average-rating}/5.0',
      { 'average-rating': await utils.averageRating(client) });
    updateChannel('memberCount', 'Thành viên: {member-count}',
      { 'member-count': guild.memberCount.toLocaleString('vi-VN') });

    // Tính thời gian trung bình
    const avgCompMs = Tickets.avgCompletionTime(config.GuildID);
    const avgRespMs = Tickets.avgResponseTime(config.GuildID);
    Guild.update(config.GuildID, {
      averageCompletion: avgCompMs ? formatDuration(avgCompMs) : 'N/A',
      averageResponse:   avgRespMs ? formatDuration(avgRespMs) : 'N/A',
    });

    // Auto-alert
    const alertEnabled     = getConfig('alert.enabled', true);
    const autoAlertEnabled = getConfig('alert.autoAlert.enabled', false);

    if (alertEnabled && autoAlertEnabled) {
      const inactiveTime = getConfig('alert.autoAlert.inactiveTime', '3d');
      const alertTime    = getConfig('alert.time', '12h');
      const openTickets  = Tickets.findAllOpen(config.GuildID);

      for (const ticket of openTickets) {
        if (!ticket.channelID || !ticket.lastMessageSent) continue;
        if (ticket.closeNotificationTime > 0) continue;

        const lastMsg   = new Date(ticket.lastMessageSent);
        const diffMin   = Math.floor((Date.now() - lastMsg) / 60000);
        const threshMin = ms(inactiveTime) / 60000;

        if (diffMin >= threshMin && ticket.waitingReplyFrom !== 'staff') {
          const ticketChannel = guild.channels.cache.get(ticket.channelID);
          if (!ticketChannel) continue;

          const durationSec = Math.floor(ms(alertTime) / 1000);
          const unixTs      = Math.floor(Date.now() / 1000) + durationSec;

          const formatDiff = (msDiff) => {
            const ts = Math.floor(msDiff / 1000);
            const d  = Math.floor(ts / 86400), h = Math.floor((ts % 86400) / 3600),
                  m  = Math.floor((ts % 3600) / 60);
            const parts = [];
            if (d > 0) parts.push(`${d} ngày`);
            if (h > 0) parts.push(`${h} giờ`);
            if (m > 0) parts.push(`${m} phút`);
            return parts.join(', ') || '0 phút';
          };

          const inactiveStr = formatDiff(Date.now() - lastMsg);
          const desc = t('ticket.alert.msg', { time: `<t:${unixTs}:R>`, 'inactive-time': inactiveStr });

          const closeBtn = new Discord.ButtonBuilder()
            .setCustomId('closeTicket')
            .setLabel(t('buttons.close'))
            .setStyle(Discord.ButtonStyle.Danger)
            .setEmoji('🔒');

          const cancelBtn = new Discord.ButtonBuilder()
            .setCustomId('cancelClosure')
            .setLabel(t('buttons.cancelClosure'))
            .setStyle(Discord.ButtonStyle.Secondary)
            .setEmoji('🚫');

          const embed = new Discord.EmbedBuilder()
            .setColor(getConfig('bot.embedColor', '#5e99ff'))
            .setDescription(desc)
            .setTimestamp();

          const row = new Discord.ActionRowBuilder().addComponents(closeBtn, cancelBtn);

          ticketChannel.send({
            content: `<@!${ticket.userID}>`,
            embeds:  [embed],
            components: [row],
          }).then(msg => {
            Tickets.updateByChannelID(ticket.channelID, {
              closeNotificationTime:   Date.now(),
              closeNotificationMsgID:  msg.id,
              closeNotificationUserID: client.user.id,
              closeUserID:             client.user.id,
              closeReason:             'Tự động đóng do không hoạt động',
            });
          }).catch(() => {});
        }
      }
    }

    // Tự động đóng ticket sau khi hết thời gian alert
    if (alertEnabled) {
      const alertTime   = getConfig('alert.time', '12h');
      const alertMs     = ms(alertTime);
      const pendingClose = Tickets.findPendingClose(config.GuildID);

      for (const ticket of pendingClose) {
        if (!ticket.closeNotificationTime) continue;
        const elapsed = Date.now() - ticket.closeNotificationTime;
        if (elapsed >= alertMs) {
          const ch = guild.channels.cache.get(ticket.channelID);
          if (ch) {
            client.emit('ticketClose', {
              channel:   ch,
              user:      client.user,
              dashboard: false,
              customId:  'autoClose',
              deferred:  false,
              deferUpdate: async () => {},
              followUp:  async () => {},
              reply:     async () => {},
            });
          }
        }
      }
    }
  }, 5 * 60 * 1000); // mỗi 5 phút

  // ── Thông báo khởi động ───────────────────────────────────────────────────
  const dashboardExists = await utils.checkDashboard();
  const freshStats      = Guild.getOrCreate(config.GuildID);

  console.log('――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――');
  console.log(color.green.bold.underline(`Heiznerd-TK2 v${botVersion.version} đã Online!`));
  console.log(`• Database: ${color.cyan('SQLite')} (${require('../db/index').name})`);
  if (config.Statistics) {
    console.log(`• Tổng ticket: ${color.cyan(freshStats.totalTickets)}`);
    console.log(`• Ticket đang mở: ${color.cyan(freshStats.openTickets)}`);
    console.log(`• Tổng tin nhắn: ${color.cyan(freshStats.totalMessages)}`);
  }
  if (dashboardExists) {
    console.log(`• ${color.green('Dashboard addon đã được tải.')}`);
  }
  console.log('――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――');

  await utils.checkConfig(client);

  const logMsg = `\n\n[${new Date().toLocaleString()}] [READY] Bot đã sẵn sàng!`;
  fs.appendFile('./logs.txt', logMsg, () => {});
};

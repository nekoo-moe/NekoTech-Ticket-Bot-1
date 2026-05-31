const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, InteractionType, MessageFlags, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const fs = require('fs');
const config = require('../config');
const utils  = require("../utils.js");
const moment = require('moment-timezone');
const { t }  = require("../lang/index");
const { getConfig } = require("../db/config");
const Guild       = require("../db/guild");
const Tickets     = require("../db/tickets");
const Panels      = require("../db/panels");
const Reviews     = require("../db/reviews");
const Blacklist   = require("../db/blacklist");
const Suggestions = require("../db/suggestions");
const Categories  = require("../db/categories");
const AIResponses = require("../db/aiResponses");
const db          = require("../db/index");
const color = require('ansi-colors');
const { eventHandler } = require('../utils.js');
const { SnowflakeUtil } = require("discord.js")
const { incrementStat, trackRating } = require("../staffStats.js");

// ── Compatibility shims — đọc từ SQLite thay vì config.yml cũ ────────────────

// ── Config đã được load từ config/index.js (SQLite-backed) ──────────────────
// Không cần patchConfigFromDB() nữa — config/index.js xử lý tất cả.

// ── Model shims — thay Mongoose bằng SQLite wrappers ─────────────────────────
// ── Model shims — thay Mongoose bằng SQLite wrappers ─────────────────────────
// Các hàm này giả lập API Mongoose để không cần sửa từng dòng code bên dưới

const ticketModel = {
  findOne: (query) => {
    if (query.channelID) return Promise.resolve(Tickets.findByChannelID(query.channelID));
    if (query.userID && query.status === 'Open') {
      const open = Tickets.findOpenByUserID(query.userID, config.GuildID);
      return Promise.resolve(open.length > 0 ? open[0] : null);
    }
    if (query.closeNotificationTime) {
      // findOne với closeNotificationTime — dùng findByChannelID
      if (query.channelID) return Promise.resolve(Tickets.findByChannelID(query.channelID));
    }
    return Promise.resolve(null);
  },
  countDocuments: (query) => {
    if (query.claimUser && query.claimed) {
      const all = Tickets.findAllOpen(config.GuildID);
      const count = all.filter(t => t.claimUser === query.claimUser && t.claimed).length;
      return Promise.resolve(count);
    }
    return Promise.resolve(0);
  },
  updateOne: (filter, update) => {
    const channelID = filter.channelID;
    if (!channelID) return Promise.resolve();
    const setData = update.$set || update;
    const unsetData = update.$unset || {};
    const updates = { ...setData };
    for (const k of Object.keys(unsetData)) updates[k] = null;
    Tickets.updateByChannelID(channelID, updates);
    return Promise.resolve();
  },
  findOneAndUpdate: (filter, update) => {
    const channelID = filter.channelID;
    if (!channelID) return Promise.resolve(null);
    const setData = update.$set || update;
    const unsetData = update.$unset || {};
    const updates = { ...setData };
    for (const k of Object.keys(unsetData)) updates[k] = null;
    Tickets.updateByChannelID(channelID, updates);
    return Promise.resolve(Tickets.findByChannelID(channelID));
  },
  // Constructor shim — new ticketModel({...}).save()
};
// Cho phép dùng new ticketModel({...})
function TicketModelConstructor(data) { this._data = data; }
TicketModelConstructor.findOne        = ticketModel.findOne;
TicketModelConstructor.countDocuments = ticketModel.countDocuments;
TicketModelConstructor.updateOne      = ticketModel.updateOne;
TicketModelConstructor.findOneAndUpdate = ticketModel.findOneAndUpdate;
TicketModelConstructor.prototype.save = function() {
  try { Tickets.create(this._data); } catch (_) {}
  return Promise.resolve(this);
};
const ticketModelClass = TicketModelConstructor;
// Override ticketModel để hỗ trợ cả new và static calls
Object.assign(ticketModel, { prototype: TicketModelConstructor.prototype });

const blacklistModel = {
  findOne: (query) => {
    const userId = query.userId;
    if (!userId) return Promise.resolve(null);
    const isBlacklisted = Blacklist.isBlacklisted(userId);
    return Promise.resolve(isBlacklisted ? { userId, blacklisted: true } : null);
  },
};

const guildModel = {
  findOne: (query) => {
    return Promise.resolve(Guild.getOrCreate(query.guildID || config.GuildID));
  },
  updateOne: (filter, update) => {
    const guildID = filter.guildID || config.GuildID;
    const setData  = update.$set  || {};
    const incData  = update.$inc  || {};
    const pushData = update.$push || {};

    if (Object.keys(setData).length > 0) Guild.update(guildID, setData);
    for (const [k, v] of Object.entries(incData)) Guild.increment(guildID, k, v);

    // Handle $push — append to JSON array field
    for (const [field, val] of Object.entries(pushData)) {
      const stats = Guild.getOrCreate(guildID);
      let arr = Array.isArray(stats[field]) ? [...stats[field]] : [];
      const each = val?.$each;
      if (each) arr = arr.concat(each);
      else arr.push(val);
      Guild.update(guildID, { [field]: arr });
    }

    return Promise.resolve();
  },
};

const ticketPanelModel = {
  findOne: (query) => {
    if (query.msgID) {
      const all = Panels.findAll(config.GuildID);
      const panel = all.find(p => p.msgID === query.msgID);
      return Promise.resolve(panel || null);
    }
    return Promise.resolve(null);
  },
};

const reviewsModel = {
  findOne: (query) => {
    if (query.reviewDMUserMsgID) {
      const row = db.prepare('SELECT * FROM reviews WHERE reviewDMUserMsgID = ?').get(query.reviewDMUserMsgID);
      return Promise.resolve(row || null);
    }
    return Promise.resolve(null);
  },
};

const Cooldown = new Map();

const validCategoryConfigs = {};

for (const categoryId in config.TicketCategories) {
  const categoryConfig = config.TicketCategories[categoryId];
  if (categoryConfig?.Questions?.length > 0) {
    const components = categoryConfig.Questions.map(question => {
      const input = new TextInputBuilder()
        .setCustomId(question.customId)
        .setLabel(question.question)
        .setStyle(TextInputStyle[question.style.charAt(0).toUpperCase() + question.style.slice(1).toLowerCase()])
        .setRequired(question.required)
        .setMaxLength(2000);
        
      if(question.minLength) input.setMinLength(question.minLength);
      if(question.placeholder) input.setPlaceholder(question.placeholder);
      
      return new ActionRowBuilder().addComponents(input);
    });

    const modal = new ModalBuilder()
      .setCustomId(`questionModal-${categoryId}-template`)
      .setTitle(categoryConfig.CategoryName)
      .addComponents(...components);

    validCategoryConfigs[categoryId] = {
      modal: modal,
      name: categoryConfig.CategoryName
    };
  }
}

module.exports = async (client, interaction) => {
    if(interaction.isChatInputCommand()) {
      const command = client.slashCommands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction, client);

        let logMsg = `\n\n[${new Date().toLocaleString()}] [SLASH COMMAND] Command: ${interaction.commandName}, User: ${interaction.user.username}`;
        fs.appendFile("./logs.txt", logMsg, (e) => { 
          if(e) console.log(e);
        });
      
        if(config.LogCommands) console.log(`${color.yellow(`[SLASH COMMAND] ${color.cyan(`${interaction.user.username}`)} used ${color.cyan(`/${interaction.commandName}`)}`)}`);
        return
      } catch (error) {
          if (error) return console.error(error);
      }
    }

    if(interaction.customId) {
      let logMsg2 = `\n\n[${new Date().toLocaleString()}] [INTERACTION] ${interaction.customId}`;
      fs.appendFile("./logs.txt", logMsg2, (e) => { 
        if(e) console.log(e);
      });
    }

let sMenu;
if (interaction.values && interaction.values[0]) {
    sMenu = interaction.values[0];
} else if (interaction.customId) {
    sMenu = interaction.customId;
} else {
    sMenu = null;
}

    // deferReply cho ticket- được xử lý bên dưới tại handleTicketCreation

function validateWorkingHours(interaction) {
  return new Promise((resolve) => {
    if (!config.WorkingHours || !config.WorkingHours.Enabled || config.WorkingHours.AllowTicketsOutsideWorkingHours) {
      return resolve({ outsideHours: false });
    }

    let userIsExempt = false;
    
    if (config.WorkingHours.ExemptRoles && Array.isArray(config.WorkingHours.ExemptRoles) && config.WorkingHours.ExemptRoles.length > 0) {
      const userRoles = interaction.member.roles.cache.map(role => role.id);
      userIsExempt = config.WorkingHours.ExemptRoles.some(exemptRoleId => userRoles.includes(exemptRoleId));
    }
    
    if (userIsExempt) {
      return resolve({ outsideHours: false });
    }

    const workingHoursRegex = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;
    
    const currentDay = moment().tz(config.WorkingHours.Timezone).format('dddd');
    const workingHours = config.WorkingHours.Schedule[currentDay];
    
    const isDayDisabled = workingHours && 
      (workingHours.toLowerCase() === "disabled" || 
       workingHours.toLowerCase() === "off" ||
       workingHours.toLowerCase() === "closed");
    
    let withinWorkingHours = false;
    const currentTime = moment().tz(config.WorkingHours.Timezone);
    const startDate = currentTime.format('YYYY-MM-DD');
    let currentStartTime, currentEndTime;
    
    if (isDayDisabled) {
      withinWorkingHours = false;
    } else if (!workingHours) {
      console.log('\x1b[31m%s\x1b[0m', `[ERROR] Working hours not configured for ${currentDay}. Contact support and provide your config.yml file.`);
      return resolve({ outsideHours: false });
    } else {
      const workingHoursMatch = workingHours.match(workingHoursRegex);
      
      if (!workingHoursMatch) {
        console.log('\x1b[31m%s\x1b[0m', `[ERROR] Invalid working hours configuration for ${currentDay} (format). Contact support and provide your config.yml file.`);
        return resolve({ outsideHours: false });
      }

      currentStartTime = moment.tz(startDate + ' ' + workingHoursMatch[1], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
      currentEndTime = moment.tz(startDate + ' ' + workingHoursMatch[2], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
      
      if (!currentStartTime.isValid() || !currentEndTime.isValid() || currentStartTime.isSameOrAfter(currentEndTime)) {
        console.log('\x1b[31m%s\x1b[0m', `[ERROR] Invalid working hours configuration for ${currentDay}. Contact support and provide your config.yml file.`);
        return resolve({ outsideHours: false });
      }
      
      withinWorkingHours = currentTime.isBetween(currentStartTime, currentEndTime);
    }

    if (withinWorkingHours) {
      return resolve({ outsideHours: false });
    }

    // Generate working hours embed
    let workingHoursEmbedLocale = config.WorkingHours.outsideWorkingHours;
    
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    for (const day of days) {
      const dayHours = config.WorkingHours.Schedule[day];
      
      if (dayHours && (dayHours.toLowerCase() === "disabled" || 
                      dayHours.toLowerCase() === "off" || 
                      dayHours.toLowerCase() === "closed")) {
        
        workingHoursEmbedLocale = workingHoursEmbedLocale.replace(new RegExp(`\\{startTime-${day}\\} to \\{endTime-${day}\\}`, 'g'), 'Closed');
        workingHoursEmbedLocale = workingHoursEmbedLocale.replace(new RegExp(`\\{startTime-${day}\\}`, 'g'), 'Closed');
        workingHoursEmbedLocale = workingHoursEmbedLocale.replace(new RegExp(`\\{endTime-${day}\\}`, 'g'), 'Closed');
        
      } else if (dayHours) {
        const match = dayHours.match(workingHoursRegex);
        if (match) {
          const start = moment.tz(startDate + ' ' + match[1], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
          const end = moment.tz(startDate + ' ' + match[2], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
          
          workingHoursEmbedLocale = workingHoursEmbedLocale.replace(new RegExp(`\\{startTime-${day}\\} to \\{endTime-${day}\\}`, 'g'), `<t:${start.unix()}:t> to <t:${end.unix()}:t>`);
          workingHoursEmbedLocale = workingHoursEmbedLocale.replace(new RegExp(`\\{startTime-${day}\\}`, 'g'), `<t:${start.unix()}:t>`);
          workingHoursEmbedLocale = workingHoursEmbedLocale.replace(new RegExp(`\\{endTime-${day}\\}`, 'g'), `<t:${end.unix()}:t>`);
        }
      }
    }
    
    if (isDayDisabled) {
      workingHoursEmbedLocale = workingHoursEmbedLocale.replace(/\{startTime-currentDay\} to \{endTime-currentDay\}/g, 'Closed today');
      workingHoursEmbedLocale = workingHoursEmbedLocale.replace(/\{startTime-currentDay\}/g, 'Closed');
      workingHoursEmbedLocale = workingHoursEmbedLocale.replace(/\{endTime-currentDay\}/g, 'Closed');
    } else if (currentStartTime && currentEndTime) {
      workingHoursEmbedLocale = workingHoursEmbedLocale.replace(/\{startTime-currentDay\} to \{endTime-currentDay\}/g, `<t:${currentStartTime.unix()}:t> to <t:${currentEndTime.unix()}:t>`);
      workingHoursEmbedLocale = workingHoursEmbedLocale.replace(/\{startTime-currentDay\}/g, `<t:${currentStartTime.unix()}:t>`);
      workingHoursEmbedLocale = workingHoursEmbedLocale.replace(/\{endTime-currentDay\}/g, `<t:${currentEndTime.unix()}:t>`);
    }

    const workingHoursEmbed = new EmbedBuilder()
      .setTitle(config.WorkingHours.outsideWorkingHoursTitle)
      .setColor("Red")
      .setDescription(workingHoursEmbedLocale)
      .setFooter({
        text: `${interaction.user.username}`,
        iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
      })
      .setTimestamp();

    resolve({ 
      outsideHours: true, 
      embed: workingHoursEmbed 
    });
  });
}

    async function handleSelectMenuUpdate(interaction, categoryId) {
      try {
        const tPanel = await ticketPanelModel.findOne({ msgID: interaction.message.id });
        
        if (!tPanel) {
          console.log('\x1b[31m%s\x1b[0m', `[WARNING] Panel not found for message ID: ${interaction.message.id}`);
          return;
        }
    
        let msg;
        try {
          msg = await interaction.channel.messages.fetch(tPanel.msgID);
        } catch (fetchError) {
          console.error('\x1b[31m%s\x1b[0m', `[ERROR] Failed to fetch panel message: ${fetchError.message}`);
          return;
        }
    
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("categorySelect")
          .setPlaceholder(config.Locale.selectCategory)
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(tPanel.selectMenuOptions);
        
        const sRow = new ActionRowBuilder().addComponents(selectMenu);
        
        try {
          await msg.edit({ components: [sRow] });
        } catch (editError) {
          console.error('\x1b[31m%s\x1b[0m', `[ERROR] Failed to edit panel message: ${editError.message}`);
        }
      } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `[SELECT MENU UPDATE] Unexpected error: ${error.message}`);
      }
    }

    async function processTicketCreation(interaction, categoryConfig, customIdentifier, categoryId, responses = {}) {
      const statsDB = await guildModel.findOne({ guildID: config.GuildID });

      // Check cooldown
      const cooldown = Cooldown.get(interaction.user.id);
      const remainingTimeSeconds = Math.ceil((cooldown + (config.TicketSettings.TicketCooldown * 1000 - Date.now())) / 1000);
      const unixTimestamp = Math.floor(Date.now() / 1000) + remainingTimeSeconds;

      if (Cooldown.has(interaction.user.id)) {
        let cooldownEmbedLocale = config.Locale.cooldownEmbedMsg.replace(/{time}/g, `<t:${unixTimestamp}:R>`);
        let cooldownEmbed = new EmbedBuilder()
            .setTitle(config.Locale.cooldownEmbedMsgTitle)
            .setColor("Red")
            .setDescription(cooldownEmbedLocale)
            .setFooter({
                text: `${interaction.user.username}`,
                iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
            })
            .setTimestamp();
        return interaction.editReply({ embeds: [cooldownEmbed], flags: MessageFlags.Ephemeral });
      }

      let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET CREATION] Category: ${categoryId}, User: ${interaction.user.username}`;
      fs.appendFile("./logs.txt", logMsg, (e) => {
          if (e) console.log(e);
      });

      if(categoryConfig.RequiredRoles && categoryConfig.RequiredRoles?.length > 0) {
        let reqRole = false;
        let ticketRoleNotAllowed = new EmbedBuilder()
            .setTitle(config.Locale.requiredRoleTitle)
            .setColor("Red")
            .setDescription(config.Locale.requiredRoleMissing)
            .setFooter({
                text: `${interaction.user.username}`,
                iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
            })
            .setTimestamp();

        // Check if user has any of the required roles
        for (let i = 0; i < categoryConfig.RequiredRoles.length; i++) {
            if (!interaction.guild.roles.cache.get(categoryConfig.RequiredRoles[i])) {
              reqRole = true;
              break;
            }
            if (interaction.member.roles.cache.has(categoryConfig.RequiredRoles[i])) {
              reqRole = true;
              break;
            }
        }
        if (reqRole === false) return interaction.editReply({ embeds: [ticketRoleNotAllowed], flags: MessageFlags.Ephemeral });
      }

      // Check for blacklisted user
      let userBlacklisted = new EmbedBuilder()
          .setTitle(config.Locale.userBlacklistedTitle)
          .setColor("Red")
          .setDescription(config.Locale.userBlacklistedMsg)
          .setFooter({
              text: `${interaction.user.username}`,
              iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
          })
          .setTimestamp();

      const blacklistedUser = await blacklistModel.findOne({ userId: interaction.user.id });
      if (blacklistedUser && blacklistedUser.blacklisted) {
        return interaction.editReply({ embeds: [userBlacklisted], flags: MessageFlags.Ephemeral });
      }

      // Check for blacklisted roles
      let blRole = false;
      let ticketRoleBlacklisted = new EmbedBuilder()
          .setTitle(config.Locale.RoleBlacklistedTitle)
          .setColor("Red")
          .setDescription(config.Locale.RoleBlacklistedMsg)
          .setFooter({
              text: `${interaction.user.username}`,
              iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
          })
          .setTimestamp();

      for (let i = 0; i < config.TicketSettings.BlacklistedRoles.length; i++) {
          if (interaction.member.roles.cache.has(config.TicketSettings.BlacklistedRoles[i])) blRole = true;
      }
      if (blRole === true) return interaction.editReply({ embeds: [ticketRoleBlacklisted], flags: MessageFlags.Ephemeral });

      // Validate ticket category exists
      if (!interaction.guild.channels.cache.get(categoryConfig.ParentCategoryID)) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.ParentCategoryID is not a valid category!`);
        return interaction.editReply({ 
          content: "Danh mục ticket không tồn tại. Vui lòng liên hệ quản trị viên.", flags: MessageFlags.Ephemeral
        });
      }

      // Check max tickets per user
      let max = config.TicketSettings.MaxTickets;
      let tNow = 0;

      let maxTickets = config.Locale.AlreadyOpenMsg.replace(/{max}/g, `${max}`);
      let ticketAlreadyOpened = new EmbedBuilder()
          .setTitle(config.Locale.AlreadyOpenTitle)
          .setColor("Red")
          .setDescription(maxTickets)
          .setFooter({
              text: `${interaction.user.username}`,
              iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
          })
          .setTimestamp();

      const ticketDB = await ticketModel.findOne({ userID: interaction.user.id, status: 'Open' });

      if (ticketDB) {
          const channels = Array.from(interaction.guild.channels.cache);
          for (const c of channels) {
              const ticketInChannel = await ticketModel.findOne({ channelID: c[1].id });
              if (ticketInChannel) {
                  let ticketData = ticketInChannel.userID;
                  if (ticketData && ticketData === interaction.user.id && ticketInChannel.status !== "Closed") {
                      tNow = tNow + 1;
                  }
              }
          }
      }
          
      if (tNow >= max) {
          if(interaction.deferred) return interaction.editReply({ embeds: [ticketAlreadyOpened], flags: MessageFlags.Ephemeral }).then(() => { tNow = 0; });
          if(!interaction.deferred) return interaction.reply({ embeds: [ticketAlreadyOpened], flags: MessageFlags.Ephemeral }).then(() => { tNow = 0; });
      }

      let permissionOverwriteArray = [
        {
          id: interaction.member.id,
          allow: ['SendMessages', 'ViewChannel', 'AttachFiles', 'EmbedLinks', 'ReadMessageHistory']
        },
        {
          id: interaction.guild.id,
          deny: ['SendMessages', 'ViewChannel']
        },
        {
          id: client.user.id,
          allow: ['SendMessages', 'ViewChannel']
        }
      ];

      if (config.ClaimingSystem?.Enabled && config.ClaimingSystem?.LockNewTickets) {
        categoryConfig.SupportRoles.forEach(roleId => {
          const role = interaction.guild.roles.cache.get(roleId);
          if (!role) return console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.SupportRoles contains an invalid role ID!`);

          let tempArray = {
            id: role.id,
            allow: ['ViewChannel', 'ReadMessageHistory'],
            deny: ['SendMessages']
          };
          permissionOverwriteArray.push(tempArray);
        });
      } else {
        categoryConfig.SupportRoles.forEach(roleId => {
          const role = interaction.guild.roles.cache.get(roleId);
          if (!role) return console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${categoryId}.SupportRoles contains an invalid role ID!`);

          let tempArray = {
            id: role.id,
            allow: ['SendMessages', 'ViewChannel', 'AttachFiles', 'EmbedLinks', 'ReadMessageHistory']
          };
          permissionOverwriteArray.push(tempArray);
        });
      }

      // Check for priority role
      const priorityRole = config.PriorityRoles && config.PriorityRoles.Roles ? 
          config.PriorityRoles.Roles.find(role => interaction.member.roles.cache.has(role.RoleID)) : null;

      let channel;
      let priorityActive = false;
      let priorityLevel;

      // Set channel name based on config
      let tChannelName = categoryConfig.ChannelName
          .replace(/{username}/g, `${interaction.user.username}`)
          .replace(/{total-tickets}/g, `${statsDB?.totalTickets || 0}`)
          .replace(/{user-id}/g, `${interaction.user.id}`);

      // Check if category needs an overflow
      const maxChannelsPerCategory = 50;
      const parentCategory = interaction.guild.channels.cache.get(categoryConfig.ParentCategoryID);
      const categoryChannels = interaction.guild.channels.cache.filter(channel => channel.parentId === parentCategory.id);
      const channelCount = categoryChannels.size;

      if (channelCount >= maxChannelsPerCategory) {
          const existingOverflow = interaction.guild.channels.cache.find(
              channel => channel.type === 4 && channel.name === `${parentCategory.name} Overflow`
          );
          
          if (existingOverflow) {
              categoryConfig.ParentCategoryID = existingOverflow.id;
          } else {
              const newCategory = await interaction.guild.channels.create({
                  name: `${parentCategory.name} Overflow`,
                  type: 4,
                  position: parentCategory.rawPosition + 1,
                  permissionOverwrites: parentCategory.permissionOverwrites.cache.map(perm => perm),
              });

              categoryConfig.ParentCategoryID = newCategory.id;
          }
      }

      // Handle priority settings if enabled
      if (config.PrioritySettings?.Enabled && config.PriorityRoles?.Enabled && priorityRole) {
        priorityLevel = priorityRole.PriorityLevel.toLowerCase();
        const matchingPriorityLevel = config.PrioritySettings.Levels.find(level => level.priority.toLowerCase() === priorityLevel);

        if (matchingPriorityLevel) {
            const { channelName } = matchingPriorityLevel;
            const newChannelName = channelName ? `${channelName}${tChannelName}` : `${tChannelName}`;

            channel = await interaction.guild.channels.create({
                name: newChannelName,
                type: 0,
                parent: categoryConfig.ParentCategoryID,
                topic: config.TicketSettings.ChannelTopic
                    .replace(/{username}/g, `<@!${interaction.user.id}>`)
                    .replace(/{category}/g, `${categoryConfig.CategoryName}`),
                permissionOverwrites: permissionOverwriteArray,
                position: 1
            });

            priorityActive = true;
        }
      }

      if(priorityActive === false) {
        channel = await interaction.guild.channels.create({
            name: tChannelName,
            type: 0,
            parent: categoryConfig.ParentCategoryID,
            topic: config.TicketSettings.ChannelTopic
                .replace(/{username}/g, `<@!${interaction.user.id}>`)
                .replace(/{category}/g, `${categoryConfig.CategoryName}`),
            permissionOverwrites: permissionOverwriteArray
        });
      }

      const ticketDeleteButton = new ButtonBuilder()
          .setCustomId('closeTicket')
          .setLabel(config.Locale.CloseTicketButton)
          .setStyle(config.ButtonColors.closeTicket)
          .setEmoji(config.ButtonEmojis.closeTicket);

      const ticketClaimButton = new ButtonBuilder()
          .setCustomId('ticketclaim')
          .setLabel(config.Locale.claimTicketButton)
          .setEmoji(config.ButtonEmojis.ticketClaim)
          .setStyle(config.ButtonColors.ticketClaim);

      let row1 = config.ClaimingSystem?.Enabled
          ? new ActionRowBuilder().addComponents(ticketDeleteButton, ticketClaimButton)
          : new ActionRowBuilder().addComponents(ticketDeleteButton);

      let NewTicketMsg = categoryConfig.EmbedMessage
          .replace(/{user}/g, `<@!${interaction.user.id}>`)
          .replace(/{createdAt}/g, `<t:${(Date.now() / 1000 | 0)}:R>`);
          
      let NewTicketMsgTitle = categoryConfig.EmbedTitle
          .replace(/{category}/g, `${categoryConfig.CategoryName}`);
          
      var userIcon = interaction.user.displayAvatarURL({
          format: 'png',
          dynamic: true,
          size: 1024
      });
      
      // Create ticket embed
      const deleteEmbed = new EmbedBuilder();
      
      if (config.TicketOpenEmbed.UserIconAuthor) {
          deleteEmbed.setAuthor({
              name: `${NewTicketMsgTitle}`,
              iconURL: `${userIcon}`
          });
      } else {
          deleteEmbed.setAuthor({
              name: `${NewTicketMsgTitle}`
          });
      }
      
      if (!config.TicketOpenEmbed.EmbedColor) deleteEmbed.setColor(config.EmbedColors);
      if (config.TicketOpenEmbed.EmbedColor) deleteEmbed.setColor(config.TicketOpenEmbed.EmbedColor);
      if (config.TicketOpenEmbed.UserIconThumbnail) deleteEmbed.setThumbnail(userIcon);
      
      deleteEmbed.setDescription(`${NewTicketMsg}`);
      
      if (config.ClaimingSystem?.Enabled) {
          deleteEmbed.addFields([{
              name: `${config.Locale.ticketClaimedBy}`,
              value: `> ${config.Locale.ticketNotClaimed}`
          }]);
      }
      
      if (config.TicketOpenEmbed.FooterMsg) {
          deleteEmbed.setFooter({
              text: `${config.TicketOpenEmbed.FooterMsg}`
          });
      }
      
      if (config.TicketOpenEmbed.FooterMsg && config.TicketOpenEmbed.FooterIcon) {
          deleteEmbed.setFooter({
              text: `${config.TicketOpenEmbed.FooterMsg}`,
              iconURL: `${config.TicketOpenEmbed.FooterIcon}`
          });
      }
      
      if (config.TicketOpenEmbed.Timestamp) deleteEmbed.setTimestamp();

      channel.send({
          embeds: [deleteEmbed],
          components: [row1],
          fetchReply: true
      }).then(async (m2) => {
          let ticketOpened = new EmbedBuilder()
              .setTitle(config.Locale.ticketCreatedTitle)
              .setColor("Green")
              .setDescription(`Your ticket has been created <#${channel.id}>`)
              .setFooter({
                  text: `${interaction.user.username}`,
                  iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
              })
              .setTimestamp();

          const row2 = new ActionRowBuilder()
              .addComponents(
                  new ButtonBuilder()
                  .setStyle('Link')
                  .setURL(`${m2.url}`)
                  .setLabel(config.Locale.logsTicket)
                  .setEmoji(config.ButtonEmojis.ticketCreated));

          if(interaction.deferred) {
              interaction.editReply({ embeds: [ticketOpened], components: [row2], flags: MessageFlags.Ephemeral });
          } else {
              interaction.reply({ embeds: [ticketOpened], components: [row2], flags: MessageFlags.Ephemeral });
          }

          // Mention user if enabled
          if (config.TicketSettings.MentionAuthor) {
              channel.send({
                  content: `<@!${interaction.user.id}>`
              }).then(msg => setTimeout(() => msg.delete().catch(e => {}), 500));
          }

          // Mention support roles if enabled
          if (categoryConfig.MentionSupportRoles) {
              let supp = categoryConfig.SupportRoles.map((r) => {
                  let findSupport = interaction.guild.roles.cache.get(r);
                  if (findSupport) return findSupport;
              });

              channel.send(supp.join(" ")).then((msg) => setTimeout(() => msg.delete().catch(e => {}), 500));
          }

          // Create ticket in database with questions if present
          if (categoryConfig.Questions && categoryConfig.Questions.length > 0) {
            // Convert responses object to maintain same data structure
            const questionsWithResponses = categoryConfig.Questions.map(question => ({
              ...question,
              response: responses[question.customId] || '',
            }));
            
            const newModel = Tickets.create({
                guildID: interaction.guild.id,
                channelID: channel.id,
                userID: interaction.user.id,
                ticketType: categoryConfig.CategoryName,
                button: categoryId,
                msgID: m2.id,
                claimed: false,
                claimUser: null,
                messages: 0,
                lastMessageSent: new Date().toISOString(),
                status: "Open",
                closeUserID: null,
                waitingReplyFrom: "staff",
                questions: questionsWithResponses,
                ticketCreationDate: new Date().toISOString(),
                identifier: customIdentifier,
            });
          } else {
            const newModel = Tickets.create({
                guildID: interaction.guild.id,
                channelID: channel.id,
                userID: interaction.user.id,
                ticketType: categoryConfig.CategoryName,
                button: categoryId,
                msgID: m2.id,
                claimed: false,
                claimUser: null,
                messages: 0,
                lastMessageSent: new Date().toISOString(),
                status: "Open",
                closeUserID: null,
                waitingReplyFrom: "staff",
                ticketCreationDate: new Date().toISOString(),
                identifier: customIdentifier,
            });
          }

          // Update priority info if active
          if(priorityActive && priorityLevel) {
            await ticketModel.findOneAndUpdate(
              { channelID: channel.id },
              {
                  priority: priorityLevel,
                  priorityName: tChannelName,
              }
            );
          }

          // Set cooldown when user creates ticket
          let ticketCooldown = config.TicketSettings.TicketCooldown * 1000;
          if (config.TicketSettings.TicketCooldown > 0) {
            Cooldown.set(interaction.user.id, Date.now());
            setTimeout(() => Cooldown.delete(interaction.user.id), ticketCooldown);
          }

          client.emit('ticketCreate', interaction, channel, categoryId);
      });
    }

    // Handle showing the ticket form modal
    async function handleTicketButton(interaction, categoryConfig, categoryId) {
      try {
        const interactionCreationTime = interaction.createdTimestamp;

        const cachedConfig = validCategoryConfigs[categoryId];
        
        if (!categoryConfig) {
          console.error(`Invalid category configuration for ${categoryId}`);
          return interaction.reply({ 
            content: '�� x?y ra l?i c?u h�nh ticket.', flags: MessageFlags.Ephemeral
          });
        }

        // If no questions, just create the ticket
        if (!cachedConfig?.modal) {
          try {
            const customIdentifier = generateUniqueIdentifier();
            
            // Update the select menu if needed
            if (config.TicketSettings.SelectMenu) {
              handleSelectMenuUpdate(interaction, categoryId).catch(console.error);
            }

        const workingHoursResult = await validateWorkingHours(interaction);
        if (workingHoursResult.outsideHours) {
          return interaction.reply({
            embeds: [workingHoursResult.embed],
            flags: MessageFlags.Ephemeral
          });
        }

            await processTicketCreation(interaction, categoryConfig, customIdentifier, categoryId);
            return;
          } catch (processError) {
            console.error('\x1b[31m%s\x1b[0m', 'Ticket creation process error:', processError);
            
            console.log(`- Error Time: ${new Date().toISOString()}`);
            console.log(`- Interaction Age at Error: ${Date.now() - interactionCreationTime} ms`);
            
            return interaction.editReply({ 
              content: 'Kh�ng th? t?o ticket. Vui l�ng th? l?i.', flags: MessageFlags.Ephemeral
            });
          }
        }

        const modal = new ModalBuilder()
          .setCustomId(`questionModal-${categoryId}-${Date.now()}`)
          .setTitle(cachedConfig.name);

        try {
          cachedConfig.modal.components.forEach(row => {
            modal.addComponents(ActionRowBuilder.from(row));
          });
        } catch (modalError) {
          console.error('\x1b[31m%s\x1b[0m', 'Modal component error:', modalError);
          
          return interaction.reply({ 
            content: 'Kh�ng th? chu?n b? form ticket. Vui l�ng li�n h? h? tr?.', flags: MessageFlags.Ephemeral
          });
        }

        try {
          await interaction.showModal(modal);

          if (config.TicketSettings.SelectMenu) {
            handleSelectMenuUpdate(interaction, categoryId).catch(console.error);
          }
        } catch (modalShowError) {
          console.error('\x1b[31m%s\x1b[0m', 'Failed to show modal:', modalShowError);
          
          return interaction.reply({ 
            content: 'Kh�ng th? m? form ticket. Vui l�ng th? l?i.', flags: MessageFlags.Ephemeral
          });
        }
      } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', 'Comprehensive ticket button handling error:', error);
        
        console.log(`- Error Time: ${new Date().toISOString()}`);
        console.log(`- Interaction Age at Error: ${Date.now() - interactionCreationTime} ms`);
        console.log(`- Error Name: ${error.name}`);
        console.log(`- Error Message: ${error.message}`);
        
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: '�� x?y ra l?i kh�ng mong mu?n. Vui l�ng th? l?i.', flags: MessageFlags.Ephemeral
            });
          } else if (interaction.deferred) {
            await interaction.editReply({
              content: '�� x?y ra l?i kh�ng mong mu?n. Vui l�ng th? l?i.', flags: MessageFlags.Ephemeral
            });
          }
        } catch (fallbackError) {
          console.error('Failed to send error message:', fallbackError);
        }
      }
    }

    function generateUniqueIdentifier() {
      const characters = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
      let identifier = '';
      for (let i = 0; i < 6; i++) {
        identifier += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      return identifier;
    }

    async function handleModalSubmission(interaction, categoryConfig, categoryId) {
      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(deferError => {
          console.error('Lỗi defer modal reply:', deferError);
        });

        if (!categoryConfig || !categoryConfig.Questions) {
          console.error('Invalid category configuration or missing questions');
          return interaction.editReply({
            content: 'L?i c?u h�nh ticket. Vui l�ng li�n h? h? tr?.', flags: MessageFlags.Ephemeral
          });
        }

        const responses = {};
        try {
          categoryConfig.Questions.forEach(question => {
            const response = interaction.fields.getTextInputValue(question.customId);
            
            if (question.required && (!response || response.trim() === '')) {
              throw new Error(`Required question "${question.question}" is empty`);
            }

            responses[question.customId] = response;
          });
        } catch (responseError) {
          console.error('Error processing modal responses:', responseError);
          return interaction.editReply({
            content: `Validation error: ${responseError.message}`, flags: MessageFlags.Ephemeral
          });
        }

        const [blacklistResult, workingHoursResult] = await Promise.all([
          blacklistModel.findOne({ userId: interaction.user.id }),
          validateWorkingHours(interaction)
        ]).catch(validationError => {
          console.error('Validation check error:', validationError);
          return [null, null];
        });

        let userBlacklisted = new EmbedBuilder()
        .setTitle(config.Locale.userBlacklistedTitle)
        .setColor("Red")
        .setDescription(config.Locale.userBlacklistedMsg)
        .setFooter({
            text: `${interaction.user.username}`,
            iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
        })
        .setTimestamp();

        // Blacklist check
        if (blacklistResult?.blacklisted) {
          return interaction.editReply({ 
            embeds: [userBlacklisted], flags: MessageFlags.Ephemeral
          });
        }

        // Working hours check
        if (workingHoursResult?.outsideHours) {
          return interaction.editReply({ 
            embeds: [workingHoursResult.embed], flags: MessageFlags.Ephemeral
          });
        }

        try {
          const customIdentifier = generateUniqueIdentifier();
          await processTicketCreation(interaction, categoryConfig, customIdentifier, categoryId, responses);
        } catch (creationError) {
          console.error('Ticket creation error:', creationError);
          return interaction.editReply({
            content: 'Kh�ng th? t?o ticket. Vui l�ng th? l?i ho?c li�n h? h? tr?.', flags: MessageFlags.Ephemeral
          });
        }
      } catch (error) {
        console.error('Comprehensive modal submission error:', error);
        
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: '�� x?y ra l?i khi g?i ticket.', flags: MessageFlags.Ephemeral
            });
          } else if (interaction.deferred) {
            await interaction.editReply({
              content: '�� x?y ra l?i khi g?i ticket.', flags: MessageFlags.Ephemeral
            });
          }
        } catch (fallbackError) {
          console.error('Failed to send error message:', fallbackError);
        }
      }
    }

    // Handle modal submission for ticket questions
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('questionModal')) {
      const [, categoryId, timestamp] = interaction.customId.split('-');
      
      const categoryConfig = config.TicketCategories[categoryId];
      
      if (!categoryConfig) {
        console.error(`Category config not found for key: ${categoryId}`);
        return;
      }

      await handleModalSubmission(interaction, categoryConfig, categoryId);
    }

    // Main function to handle ticket category selection
    const handleTicketCategory = async (categoryId, categoryConfig, interaction) => {

      if (!categoryConfig || (!categoryConfig.Questions || categoryConfig.Questions.length === 0)) {  
        if (!interaction.replied && !interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        const customIdentifier = generateUniqueIdentifier();
        
        if (config.TicketSettings.SelectMenu) {
          handleSelectMenuUpdate(interaction, categoryId).catch(console.error);
        }

      const workingHoursResult = await validateWorkingHours(interaction);
      if (workingHoursResult.outsideHours) {
        return interaction.editReply({
          embeds: [workingHoursResult.embed],
          flags: MessageFlags.Ephemeral
        });
      }

        await processTicketCreation(interaction, categoryConfig, customIdentifier, categoryId, {});
        return;
      }
      
      await handleTicketButton(interaction, categoryConfig, categoryId);
    };

    if (sMenu && sMenu.startsWith('ticket-')) {
      const categoryId = sMenu.replace('ticket-', '');
      const categoryConfig = config.TicketCategories[categoryId];
      
      if (categoryConfig) {
        await handleTicketCategory(categoryId, categoryConfig, interaction);
      }
    }

    if (interaction.customId === 'closeTicket') {
      const handleCloseTicket = async () => {
        if(!config.TicketSettings.TicketCloseReason) {
          await interaction.deferReply().catch(() => {});
        }

        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        if (config.TicketSettings.RestrictTicketClose && !supportRole) {
          if(!config.TicketSettings.TicketCloseReason) {
            return interaction.editReply({ content: config.Locale.restrictTicketClose, flags: MessageFlags.Ephemeral });
          }
          if(config.TicketSettings.TicketCloseReason) {
            return interaction.reply({ content: config.Locale.restrictTicketClose, flags: MessageFlags.Ephemeral });
          }
        }
      
        await ticketModel.updateOne({ channelID: interaction.channel.id }, { $set: { closeUserID: interaction.user.id, closedAt: Date.now() } });

        if(config.TicketSettings.TicketCloseReason) {
          const modal = new ModalBuilder()
            .setCustomId('closeReason')
            .setTitle(config.Locale.ticketCloseReasonTitle);
          
          const reasonForClose = new TextInputBuilder()
            .setCustomId('reasonForClose')
            .setLabel(config.Locale.whyCloseTicket)
            .setRequired(false)
            .setStyle("Short");
          
          const row1 = new ActionRowBuilder().addComponents(reasonForClose);
          
          modal.addComponents(row1);
          return await interaction.showModal(modal);
        }
        
        await client.emit('ticketClose', interaction);
      };

      handleCloseTicket().catch(error => {
        console.error('Error handling closeTicket interaction:', error);
      });
    }

  if (interaction.customId === 'ticketclaim') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    let ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

    let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET CLAIM] User: ${interaction.user.username}`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });


    if (config.ClaimingSystem.Enabled === false) return interaction.editReply({ content: "H? th?ng nh?n ticket dang b? t?t!", flags: MessageFlags.Ephemeral })

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
    if (config.ClaimingSystem.Enabled && !supportRole) {
      return interaction.editReply({ content: config.Locale.restrictTicketClaim, flags: MessageFlags.Ephemeral });
    }


    if (config.ClaimingSystem.MaxClaimsPerStaff > 0) {
      const isExempt = config.ClaimingSystem.MaxClaimsExemptRoles?.some(roleId =>
        interaction.member.roles.cache.has(roleId)
      );

      if (!isExempt) {
        const claimedTickets = await ticketModel.countDocuments({
          claimUser: interaction.user.id,
          claimed: true,
          status: "Open"
        });

        if (claimedTickets >= config.ClaimingSystem.MaxClaimsPerStaff) {
          return interaction.editReply({
            content: `You cannot claim more than ${config.ClaimingSystem.MaxClaimsPerStaff} tickets at once. Please close or unclaim some of your current tickets first.`, flags: MessageFlags.Ephemeral
          });
        }
      }
    }

    let embedClaimVar = config.Locale.ticketClaimed.replace(/{user}/g, `<@!${interaction.user.id}>`);
    const embed = new EmbedBuilder()
      .setTitle(config.Locale.ticketClaimedTitle)
      .setColor("Green")
      .setDescription(embedClaimVar)
      .setTimestamp()
      .setFooter({ text: `${config.Locale.ticketClaimedBy} ${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` })
    interaction.editReply({ content: config.Locale.claimTicketMsg, ephemeral: false })
    interaction.channel.send({ embeds: [embed], ephemeral: false })
    interaction.channel.messages.fetch(ticketDB.msgID).then(async msg => {

      const embed = msg.embeds[0]
      embed.fields[0] = { name: `${config.Locale.ticketClaimedBy}`, value: `> <@!${interaction.user.id}> (${interaction.user.username})` }

      const ticketDeleteButton = new ButtonBuilder()
        .setCustomId('closeTicket')
        .setLabel(config.Locale.CloseTicketButton)
        .setStyle(config.ButtonColors.closeTicket)
        .setEmoji(config.ButtonEmojis.closeTicket)

      const ticketClaimButton = new ButtonBuilder()
        .setCustomId('ticketclaim')
        .setLabel(config.Locale.claimTicketButton)
        .setEmoji(config.ButtonEmojis.ticketClaim)
        .setStyle(config.ButtonColors.ticketClaim)
        .setDisabled(true)

      const ticketUnClaimButton = new ButtonBuilder()
        .setCustomId('ticketunclaim')
        .setLabel(config.Locale.unclaimTicketButton)
        .setStyle(config.ButtonColors.ticketUnclaim)

      let row2 = new ActionRowBuilder().addComponents(ticketDeleteButton, ticketClaimButton, ticketUnClaimButton);

      msg.edit({ embeds: [embed], components: [row2] })
      client.emit('ticketClaim', interaction);

      const editPermissionOverwrites = async (interaction, supportRoles) => {
        await Promise.all(supportRoles.map(async (sRoles) => {
          const role = interaction.guild.roles.cache.get(sRoles);
          if (role) {
            await interaction.channel.permissionOverwrites.edit(role, {
              SendMessages: config.ClaimingSystem.UserPerms.SendMessages,
              ViewChannel: config.ClaimingSystem.UserPerms.ViewChannel
            });
          }
        }));
      };

      let tButton = ticketDB.button;
      const categoryConfig = config.TicketCategories[tButton];
      if (categoryConfig && categoryConfig.SupportRoles) {
        await editPermissionOverwrites(interaction, categoryConfig.SupportRoles);
      }

      await interaction.channel.permissionOverwrites.edit(interaction.user, {
        SendMessages: true,
        ViewChannel: true,
        AttachFiles: true,
        EmbedLinks: true,
        ReadMessageHistory: true
      })

      if (config.ClaimingSystem.MoveClaimedTickets?.Enabled &&
        config.ClaimingSystem.MoveClaimedTickets?.CategoryID) {
        const claimedCategoryID = config.ClaimingSystem.MoveClaimedTickets.CategoryID;
        const claimedCategory = interaction.guild.channels.cache.get(claimedCategoryID);

        if (claimedCategory && claimedCategory.type === 4) {
          await ticketModel.updateOne(
            { channelID: interaction.channel.id },
            {
              $set: {
                originalCategoryID: interaction.channel.parentId,
              },
            }
          );

          await interaction.channel.setParent(claimedCategoryID, {
            lockPermissions: false
          }).catch(error => {
            console.error(`Error moving ticket to claimed category: ${error}`);
          });
        }
      }

      await ticketModel.updateOne(
        { channelID: interaction.channel.id },
        {
          $set: {
            claimed: true,
            claimUser: interaction.user.id,
          },
        }
      );

      const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);

      const log = new EmbedBuilder()
        .setColor('#4CAF50')
        .setAuthor({
          name: config.Locale.ticketClaimedLog
        })
        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
        .setTimestamp();

      let mainContent = '';
      mainContent += `> **${config.Locale.logsExecutor}:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
      mainContent += `> **${config.Locale.logsTicket}:** <#${interaction.channel.id}> \`#${interaction.channel.name}\`\n`;
      mainContent += `> **${config.Locale.ticketCategory}:** \`${ticketDB.ticketType}\``;

      log.addFields([
        {
          name: `\`🎫\` **${config.Locale.claimDetails}**`,
          value: mainContent
        }
      ]);

      log.setFooter({
        text: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 16 })
      });
      if (logsChannel) logsChannel.send({ embeds: [log] })

    })
  }

  if (interaction.customId === 'ticketunclaim') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    let ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

    let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET UNCLAIM] User: ${interaction.user.username}`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });

    if (config.ClaimingSystem.Enabled === false) return interaction.editReply({ content: "H? th?ng nh?n ticket dang b? t?t!", flags: MessageFlags.Ephemeral })
    if (ticketDB.claimed === false) return interaction.editReply({ content: "Ticket n�y chua du?c nh?n!", flags: MessageFlags.Ephemeral })
    let msgClaimUserVar = config.Locale.ticketDidntClaim.replace(/{user}/g, `<@!${ticketDB.claimUser}>`);
    if (ticketDB.claimUser !== interaction.user.id && !interaction.member.permissions.has("ManageGuild")) return interaction.editReply({ content: msgClaimUserVar, flags: MessageFlags.Ephemeral });

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
    if (config.ClaimingSystem.Enabled && !supportRole) {
      return interaction.editReply({ content: config.Locale.restrictTicketClaim, flags: MessageFlags.Ephemeral });
    }

    let tButton = ticketDB.button;

    const applyPermissionOverwrites = async (interaction, supportRoles) => {
      await Promise.all(supportRoles.map(async (sRoles) => {
        const role = interaction.guild.roles.cache.get(sRoles);
        if (role) {
          await interaction.channel.permissionOverwrites.edit(role, {
            SendMessages: true,
            ViewChannel: true
          });
        }
      }));
    };

    const categoryConfig = config.TicketCategories[tButton];
    if (categoryConfig && categoryConfig.SupportRoles) {
      await applyPermissionOverwrites(interaction, categoryConfig.SupportRoles);
    }

    if (config.ClaimingSystem.MoveClaimedTickets?.Enabled &&
      ticketDB.originalCategoryID) {

      const originalCategoryID = ticketDB.originalCategoryID;
      const originalCategory = interaction.guild.channels.cache.get(originalCategoryID);

      if (originalCategory && originalCategory.type === 4) {
        await interaction.channel.setParent(originalCategoryID, {
          lockPermissions: false
        }).catch(error => {
          console.error(`Error moving ticket back to original category: ${error}`);
        });
      } else if (categoryConfig && categoryConfig.ParentCategoryID) {
        const configCategoryID = categoryConfig.ParentCategoryID;
        const configCategory = interaction.guild.channels.cache.get(configCategoryID);

        if (configCategory && configCategory.type === 4) {
          await interaction.channel.setParent(configCategoryID, {
            lockPermissions: false
          }).catch(error => {
            console.error(`Error moving ticket back to config category: ${error}`);
          });
        }
      }
    }

    let embedClaimVar2 = config.Locale.ticketUnClaimed.replace(/{user}/g, `<@!${interaction.user.id}>`);
    const embed = new EmbedBuilder()
      .setTitle(config.Locale.ticketUnClaimedTitle)
      .setColor("Red")
      .setDescription(embedClaimVar2)
      .setTimestamp()
      .setFooter({ text: `${config.Locale.ticketUnClaimedBy} ${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` })
    interaction.editReply({ content: config.Locale.unclaimTicketMsg, flags: MessageFlags.Ephemeral })
    interaction.channel.send({ embeds: [embed] })

    interaction.channel.messages.fetch(ticketDB.msgID).then(async msg => {

      const embed = msg.embeds[0]
      embed.fields[0] = { name: `${config.Locale.ticketClaimedBy}`, value: `> ${config.Locale.ticketNotClaimed}` }


      const ticketDeleteButton = new ButtonBuilder()
        .setCustomId('closeTicket')
        .setLabel(config.Locale.CloseTicketButton)
        .setStyle(config.ButtonColors.closeTicket)
        .setEmoji(config.ButtonEmojis.closeTicket)

      const ticketClaimButton = new ButtonBuilder()
        .setCustomId('ticketclaim')
        .setLabel(config.Locale.claimTicketButton)
        .setEmoji(config.ButtonEmojis.ticketClaim)
        .setStyle(config.ButtonColors.ticketClaim)

      let row3 = new ActionRowBuilder().addComponents(ticketDeleteButton, ticketClaimButton);

      msg.edit({ embeds: [embed], components: [row3] })


      await ticketModel.updateOne(
        { channelID: interaction.channel.id },
        {
          $set: {
            claimed: false,
            claimUser: "",
            originalCategoryID: null,
          },
        }
      );

      const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);

      const log = new EmbedBuilder()
        .setColor('#F44336')
        .setAuthor({
          name: config.Locale.ticketUnClaimedLog
        })
        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
        .setTimestamp();

      let mainContent = '';
      mainContent += `> **${config.Locale.logsExecutor}:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
      mainContent += `> **${config.Locale.logsTicket}:** <#${interaction.channel.id}> \`#${interaction.channel.name}\`\n`;
      mainContent += `> **${config.Locale.ticketCategory}:** \`${ticketDB.ticketType}\``;

      log.addFields([
        {
          name: `\`🔓\` **${config.Locale.unclaimDetails}**`,
          value: mainContent
        }
      ]);

      log.setFooter({
        text: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 16 })
      });
      if (logsChannel) logsChannel.send({ embeds: [log] })
    })
  }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'closeReason') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(err => {});
      
      const reason = interaction.fields.getTextInputValue('reasonForClose') || config.Locale.noCloseReason;
      
      await ticketModel.updateOne(
        { channelID: interaction.channel.id },
        { $set: { closeReason: reason } }
      );
      
      client.emit('ticketClose', interaction);
      
      if (interaction.deferred) {
        await interaction.editReply({ content: config.Locale.closingTicket, flags: MessageFlags.Ephemeral }).catch(err => {});
      } else {
        await interaction.reply({ content: config.Locale.closingTicket, flags: MessageFlags.Ephemeral }).catch(err => {});
      }
    }


// Upvote button
if (interaction.customId === 'upvote') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const suggestion = await suggestionModel.findOne({ msgID: interaction.message.id });
    if (!suggestion) return interaction.editReply('Không tìm thấy đề xuất trong cơ sở dữ liệu.');

    const statsDB = await guildModel.findOne({ guildID: config.GuildID });

    let cantvoteVariable = config.Locale.suggestionCantVote.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let cantVote = new EmbedBuilder()
        .setTitle(config.Locale.suggestionCantVoteTitle)
        .setColor("Red")
        .setDescription(cantvoteVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    if (suggestion.status === 'Accepted' || suggestion.status === 'Denied') {
        return interaction.editReply({ embeds: [cantVote], flags: MessageFlags.Ephemeral });
    }

    let alreadyvotedVariable = config.Locale.suggestionAlreadyVoted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let alreadyVoted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionAlreadyVotedTitle)
        .setColor("Red")
        .setDescription(alreadyvotedVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    const existingVote = suggestion.voters.find(voter => voter.userID === interaction.user.id);
    if (existingVote) return interaction.editReply({ embeds: [alreadyVoted], flags: MessageFlags.Ephemeral });

    suggestion.upVotes += 1;
    suggestion.voters.push({ userID: interaction.user.id, voteType: 'upvote' });
    await suggestion.save();

    const msg = await interaction.channel.messages.fetch(suggestion.msgID);
    
    let upvotedVariable = config.Locale.suggestionUpvoted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let sugUpvoted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionUpvotedTitle)
        .setColor("Green")
        .setDescription(upvotedVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    await interaction.editReply({ embeds: [sugUpvoted], flags: MessageFlags.Ephemeral });

    const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
    
    let infoContent = '';
    infoContent += `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n`;
    infoContent += `> **${config.Locale.suggestionUpvotes}** \`${suggestion.upVotes}\`\n`;
    infoContent += `> **${config.Locale.suggestionDownvotes}** \`${suggestion.downVotes}\``;
    
    if (config.SuggestionSettings.EnableAcceptDenySystem) {
        infoContent += `\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Pending}`;
    }
    
    originalEmbed.data.fields[1] = { 
        name: `\`ℹ️\` **${config.Locale.suggestionInformation}**`,
        value: infoContent
    };
    
    const updatedRow = await utils.createSuggestionButtons(suggestion);
    
    await msg.edit({ embeds: [originalEmbed], components: [updatedRow] });
    
    let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
    if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) {
        const upvoteLog = new EmbedBuilder()
            .setColor("Green")
            .setDescription(`${config.SuggestionUpvote.ButtonEmoji} | <@!${interaction.user.id}> (${interaction.user.username}) has **upvoted** [this](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`);
        
        await suggestionLogsChannel.send({ embeds: [upvoteLog] });
    }

    statsDB.totalSuggestionUpvotes++;
    await statsDB.save();
}

// Downvote button
if (interaction.customId === 'downvote') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const suggestion = await suggestionModel.findOne({ msgID: interaction.message.id });
    if (!suggestion) return interaction.editReply('Không tìm thấy đề xuất trong cơ sở dữ liệu.');

    const statsDB = await guildModel.findOne({ guildID: config.GuildID });

    let cantvoteVariable = config.Locale.suggestionCantVote.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let cantVote = new EmbedBuilder()
        .setTitle(config.Locale.suggestionCantVoteTitle)
        .setColor("Red")
        .setDescription(cantvoteVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    if (suggestion.status === 'Accepted' || suggestion.status === 'Denied') {
        return interaction.editReply({ embeds: [cantVote], flags: MessageFlags.Ephemeral });
    }

    let alreadyVotedVariable = config.Locale.suggestionAlreadyVoted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let alreadyVoted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionAlreadyVotedTitle)
        .setColor("Red")
        .setDescription(alreadyVotedVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    const existingVote = suggestion.voters.find(voter => voter.userID === interaction.user.id);
    if (existingVote) return interaction.editReply({ embeds: [alreadyVoted], flags: MessageFlags.Ephemeral });

    suggestion.downVotes += 1;
    suggestion.voters.push({ userID: interaction.user.id, voteType: 'downvote' });
    await suggestion.save();

    const msg = await interaction.channel.messages.fetch(suggestion.msgID);
    
    let downvotedVariable = config.Locale.suggestionDownvoted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let sugDownvoted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionDownvotedTitle)
        .setColor("Red")
        .setDescription(downvotedVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    await interaction.editReply({ embeds: [sugDownvoted], flags: MessageFlags.Ephemeral });

    const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
    
    let infoContent = '';
    infoContent += `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n`;
    infoContent += `> **${config.Locale.suggestionUpvotes}** \`${suggestion.upVotes}\`\n`;
    infoContent += `> **${config.Locale.suggestionDownvotes}** \`${suggestion.downVotes}\``;
    
    if (config.SuggestionSettings.EnableAcceptDenySystem) {
        infoContent += `\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Pending}`;
    }
    
    originalEmbed.data.fields[1] = { 
        name: `\`ℹ️\` **${config.Locale.suggestionInformation}**`,
        value: infoContent
    };
    
    const updatedRow = await utils.createSuggestionButtons(suggestion);
    
    await msg.edit({ embeds: [originalEmbed], components: [updatedRow] });
    
    let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
    if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) {
        const downvoteLog = new EmbedBuilder()
            .setColor("Red")
            .setDescription(`${config.SuggestionDownvote.ButtonEmoji} | <@!${interaction.user.id}> (${interaction.user.username}) has **downvoted** [this](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`);
        
        await suggestionLogsChannel.send({ embeds: [downvoteLog] });
    }

    statsDB.totalSuggestionDownvotes++;
    await statsDB.save();
}

// Reset vote button
if (interaction.customId === 'resetvote') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const suggestion = await suggestionModel.findOne({ msgID: interaction.message.id });
    if (!suggestion) return interaction.editReply('Không tìm thấy đề xuất trong cơ sở dữ liệu.');

    let noVoteVariable = config.Locale.suggestionNoVote.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let noVote = new EmbedBuilder()
        .setTitle(config.Locale.suggestionNoVoteTitle)
        .setColor("Red")
        .setDescription(noVoteVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    const existingVote = suggestion.voters.find(voter => voter.userID === interaction.user.id);
    if (!existingVote) return interaction.editReply({ embeds: [noVote], flags: MessageFlags.Ephemeral });

    let cantvoteVariable = config.Locale.suggestionCantVote.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let cantVote = new EmbedBuilder()
        .setTitle(config.Locale.suggestionCantVoteTitle)
        .setColor("Red")
        .setDescription(cantvoteVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    if (suggestion.status === 'Accepted' || suggestion.status === 'Denied') {
        return interaction.editReply({ embeds: [cantVote], flags: MessageFlags.Ephemeral });
    }

    if (existingVote.voteType === 'upvote') {
        suggestion.upVotes -= 1;
    } else if (existingVote.voteType === 'downvote') {
        suggestion.downVotes -= 1;
    }

    suggestion.voters = suggestion.voters.filter(voter => voter.userID !== interaction.user.id);
    await suggestion.save();

    const msg = await interaction.channel.messages.fetch(suggestion.msgID);
    
    let voteResetVariable = config.Locale.suggestionVoteReset.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let voteReset = new EmbedBuilder()
        .setTitle(config.Locale.suggestionVoteResetTitle)
        .setColor("Green")
        .setDescription(voteResetVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    await interaction.editReply({ embeds: [voteReset], flags: MessageFlags.Ephemeral });

    const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
    
    let infoContent = '';
    infoContent += `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n`;
    infoContent += `> **${config.Locale.suggestionUpvotes}** \`${suggestion.upVotes}\`\n`;
    infoContent += `> **${config.Locale.suggestionDownvotes}** \`${suggestion.downVotes}\``;
    
    if (config.SuggestionSettings.EnableAcceptDenySystem) {
        infoContent += `\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Pending}`;
    }
    
    originalEmbed.data.fields[1] = { 
        name: `\`ℹ️\` **${config.Locale.suggestionInformation}**`,
        value: infoContent
    };
    
    const updatedRow = await utils.createSuggestionButtons(suggestion);
    
    await msg.edit({ embeds: [originalEmbed], components: [updatedRow] });
    
    let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
    if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) {
        const resetLog = new EmbedBuilder()
            .setColor("Orange")
            .setDescription(`${config.SuggestionResetvote.ButtonEmoji} | <@!${interaction.user.id}> (${interaction.user.username}) has **reset their vote for** [this](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`);
        
        await suggestionLogsChannel.send({ embeds: [resetLog] });
    }
}

// Accept suggestion
if (interaction.isMessageContextMenuCommand() && interaction.commandName.startsWith('Accept')) {
    if (config.SuggestionSettings.EnableAcceptDenySystem === false) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const suggestion = await suggestionModel.findOne({ msgID: interaction.targetId });
    if (!suggestion) return interaction.editReply('Không tìm thấy đề xuất trong cơ sở dữ liệu.');

    let hasPermission = false;
    for (const roleId of config.SuggestionSettings.AllowedRoles) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (role && interaction.member.roles.cache.has(role.id)) {
            hasPermission = true;
            break;
        }
    }
    
    if (!hasPermission) return interaction.editReply({ content: config.Locale.suggestionNoPerms, flags: MessageFlags.Ephemeral });

    suggestion.status = "Accepted";
    await suggestion.save();

    const msg = await interaction.channel.messages.fetch(suggestion.msgID);
    
    let acceptedVariable = config.Locale.suggestionAccepted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let sugAccepted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionAcceptedTitle)
        .setColor("Green")
        .setDescription(acceptedVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    await interaction.editReply({ embeds: [sugAccepted], flags: MessageFlags.Ephemeral });

    const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
    originalEmbed.setColor(config.SuggestionStatusesEmbedColors.Accepted);
    
    let infoContent = '';
    infoContent += `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n`;
    infoContent += `> **${config.Locale.suggestionUpvotes}** \`${suggestion.upVotes}\`\n`;
    infoContent += `> **${config.Locale.suggestionDownvotes}** \`${suggestion.downVotes}\`\n`;
    infoContent += `> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Accepted}`;
    
    originalEmbed.data.fields[1] = { 
        name: `\`ℹ️\` **${config.Locale.suggestionInformation}**`,
        value: infoContent
    };
    
    if (config.SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied) {
        await msg.edit({ embeds: [originalEmbed], components: [] });
    } else {
        const updatedRow = await utils.createSuggestionButtons(suggestion, true);
        await msg.edit({ embeds: [originalEmbed], components: [updatedRow] });
    }
    
    let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
    if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) {
        const acceptLog = new EmbedBuilder()
            .setColor("Green")
            .setDescription(`${config.SuggestionAccept.Emoji} | <@!${interaction.user.id}> (${interaction.user.username}) has **accepted** [this](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`);
        
        await suggestionLogsChannel.send({ embeds: [acceptLog] });
    }
}

// Deny suggestion
if (interaction.isMessageContextMenuCommand() && interaction.commandName.startsWith('Deny')) {
    if (config.SuggestionSettings.EnableAcceptDenySystem === false) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    
    const suggestion = await suggestionModel.findOne({ msgID: interaction.targetId });
    if (!suggestion) return interaction.editReply('Không tìm thấy đề xuất trong cơ sở dữ liệu.');

    let hasPermission = false;
    for (const roleId of config.SuggestionSettings.AllowedRoles) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (role && interaction.member.roles.cache.has(role.id)) {
            hasPermission = true;
            break;
        }
    }
    
    if (!hasPermission) return interaction.editReply({ content: config.Locale.suggestionNoPerms, flags: MessageFlags.Ephemeral });

    suggestion.status = "Denied";
    await suggestion.save();

    const msg = await interaction.channel.messages.fetch(suggestion.msgID);
    
    let deniedVariable = config.Locale.suggestionDenied.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let sugDenied = new EmbedBuilder()
        .setTitle(config.Locale.suggestionDeniedTitle)
        .setColor("Red")
        .setDescription(deniedVariable)
        .setFooter({ 
            text: interaction.user.username, 
            iconURL: interaction.user.displayAvatarURL({ dynamic: true, size: 16 }) 
        })
        .setTimestamp();

    await interaction.editReply({ embeds: [sugDenied], flags: MessageFlags.Ephemeral });

    const originalEmbed = EmbedBuilder.from(msg.embeds[0]);
    originalEmbed.setColor(config.SuggestionStatusesEmbedColors.Denied);
    
    let infoContent = '';
    infoContent += `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n`;
    infoContent += `> **${config.Locale.suggestionUpvotes}** \`${suggestion.upVotes}\`\n`;
    infoContent += `> **${config.Locale.suggestionDownvotes}** \`${suggestion.downVotes}\`\n`;
    infoContent += `> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Denied}`;
    
    originalEmbed.data.fields[1] = { 
        name: `\`ℹ️\` **${config.Locale.suggestionInformation}**`,
        value: infoContent
    };
    
    if (config.SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied) {
        await msg.edit({ embeds: [originalEmbed], components: [] });
    } else {
        const updatedRow = await utils.createSuggestionButtons(suggestion, true);
        await msg.edit({ embeds: [originalEmbed], components: [updatedRow] });
    }
    
    let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
    if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) {
        const denyLog = new EmbedBuilder()
            .setColor("Red")
            .setDescription(`${config.SuggestionDeny.Emoji} | <@!${interaction.user.id}> (${interaction.user.username}) has **denied** [this](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`);
        
        await suggestionLogsChannel.send({ embeds: [denyLog] });
    }
}




// Ticket Rating System
if (interaction.customId === 'ratingSelect') {

  // Find review message
  const reviewDataDB = await reviewsModel.findOne({
    reviewDMUserMsgID: interaction.message.id,
    userID: interaction.user.id,
  });
  if(!reviewDataDB) return;

    const modal = new ModalBuilder()
    .setCustomId('modal-whyRating')
    .setTitle(config.Locale.ticketRating)

    const reviewInput = new TextInputBuilder()
    .setCustomId('textinput-whyRating')
    .setLabel(config.Locale.ticketRating)
    .setStyle('Paragraph')
    .setMinLength(config.TicketReviewSettings.MinimumWords)
    .setMaxLength(config.TicketReviewSettings.MaximumWords)
    .setPlaceholder(config.Locale.explainWhyRating)
    .setRequired(true)

    const modalActionRow = new ActionRowBuilder().addComponents(reviewInput);
    modal.addComponents(modalActionRow);

    async function handleStarRating(interaction, rating) {
      const arr = [{
        rating: rating,
        guildID: config.GuildID,
        userID: interaction.user.id,
      }];
    

      if (config.TicketReviewSettings.AskWhyModal) await interaction.showModal(modal);
    
      if(!reviewDataDB.alreadyRated || reviewDataDB.alreadyRated === false) {
      // Update reviewsModel and set rating
      await reviewsModel.updateOne(
        { reviewDMUserMsgID: interaction.message.id },
        {
          $set: { rating: rating, alreadyRated: true }
        }
      );
    
      // Update guildModel with rating and totalReview stats
      await guildModel.updateOne(
        { guildID: config.GuildID },
        {
          $push: { reviews: { $each: arr } },
          $inc: { totalReviews: 1 }
        }
      );
      await trackRating(reviewDataDB.ticketChannelID, rating);
}
    

      const reviewDB = await reviewsModel.findOne({ reviewDMUserMsgID: interaction.message.id });
      const logsChannel = await utils.getCategoryLogsChannel(reviewDB.tCloseLogChannelID);

      let star = "⭐".repeat(rating);
    
      if (config.TicketReviewSettings.AskWhyModal === false) {
        logsChannel.messages.fetch(reviewDB.tCloseLogMsgID).then(msg => {
          const originalEmbed = msg.embeds[0];
          const updatedEmbed = EmbedBuilder.from(originalEmbed);
          
          let ratingContent = `> ${star} \`(${rating}/5)\``;
          
          updatedEmbed.addFields([
            { 
              name: `\`⭐\` **${config.Locale.ticketRating}**`, 
              value: ratingContent 
            }
          ]);
          
          msg.edit({ embeds: [updatedEmbed] });
        });
      
        interaction.channel.messages.fetch(reviewDB.reviewDMUserMsgID).then(msg => {
          msg.edit({ components: [] });
          interaction.reply({ content: config.TicketReviewSettings.ReviewMsg, flags: MessageFlags.Ephemeral });
        });
      }
    }
    
    switch (interaction.values[0]) {
      case "one_star":
        await handleStarRating(interaction, 1);
        break;
    
      case "two_star":
        await handleStarRating(interaction, 2);
        break;
    
      case "three_star":
        await handleStarRating(interaction, 3);
        break;
    
      case "four_star":
        await handleStarRating(interaction, 4);
        break;
    
      case "five_star":
        await handleStarRating(interaction, 5);
        break;
    
      default:
        // Handle other cases
    }
  }

if (interaction.type === InteractionType.ModalSubmit && config.TicketReviewSettings.AskWhyModal && !interaction.customId.startsWith('questionModal') && interaction.customId !== "closeReason" && interaction.customId === 'modal-whyRating') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const reviewDB = await reviewsModel.findOne({ reviewDMUserMsgID: interaction.message.id });
    const statsDB = await guildModel.findOne({ guildID: config.GuildID });
    const ticketDB = await ticketModel.findOne({ channelID: reviewDB.ticketChannelID });


    if(interaction.customId === 'modal-whyRating' && reviewDB.reviewDMUserMsgID === interaction.message.id && reviewDB.userID === interaction.user.id) {
    const firstResponse = interaction.fields.getTextInputValue('textinput-whyRating');

    let guild = client.guilds.cache.get(config.GuildID)
    const logsChannel = await utils.getCategoryLogsChannel(interaction.channel.id);


    const channel = interaction.channel || (await client.channels.fetch(interaction.channelId));
    if (channel) {
      await channel.messages.fetch(reviewDB.reviewDMUserMsgID).then(async (msg) => {

      let claimUser = await client.users.cache.get(ticketDB.claimUser)
      if (!claimUser) claimUser = config.Locale.notClaimedCloseDM;

      let star = ""
      for (var i = 0; i < reviewDB.rating; i++) {
          star += "⭐"
      }

      // Update reviewsModel and set rating
      await reviewsModel.updateOne(
        { reviewDMUserMsgID: interaction.message.id },
        {
          $set: { reviewMessage: firstResponse }
        }
      );

      let ticketCloseLocale = config.TicketUserCloseDM.CloseEmbedMsg.replace(/{guildName}/g, `${guild.name}`).replace(/{closedAt}/g, `<t:${(ticketDB.closedAt / 1000 | 0)}:R>`).replace(/{close-reason}/g, `${ticketDB.closeReason}`);
      let ticketCloseReviewLocale = config.TicketReviewSettings.ticketReviewed.replace(/{star}/g, `${star}`).replace(/{rating}/g, `${reviewDB.rating}`).replace(/{reviewMessage}/g, `${firstResponse}`).replace(/{close-reason}/g, `${ticketDB.closeReason}`);
      let ticketCloseRatingLocale = config.TicketReviewSettings.ticketRated.replace(/{star}/g, `${star}`).replace(/{rating}/g, `${reviewDB.rating}`);

      const originalEmbed = msg.embeds[0];

      const embed = new EmbedBuilder()
      embed.setTitle(config.Locale.ticketClosedCloseDM)
      if(!config.TicketUserCloseDM.Enabled && firstResponse) embed.setDescription(ticketCloseReviewLocale)
      if(config.TicketUserCloseDM.Enabled && firstResponse) embed.setDescription(`${config.TicketUserCloseDM.CloseEmbedMsg}\n${ticketCloseReviewLocale}`)
      if(config.TicketUserCloseDM.Enabled) embed.setDescription(`${ticketCloseLocale}\n${ticketCloseRatingLocale}`)
      if(!config.TicketUserCloseDM.Enabled) embed.setDescription(`${ticketCloseRatingLocale}`)
      originalEmbed.fields.forEach(field => {
        embed.addFields(field);
      });
      embed.setColor(config.EmbedColors)

        msg.edit({ embeds: [embed], components: [] })
      });
    } else {
      console.error("Channel not found!");
    }

    await interaction.editReply({ content: config.TicketReviewSettings.ReviewMsg, flags: MessageFlags.Ephemeral })


    let star = ""
    for (var i = 0; i < reviewDB.rating; i++) {
        star += "⭐"
    }

    let ticketAuthor = client.users.cache.get(reviewDB.ticketCreatorID)
    let reviewChannel = guild.channels.cache.get(config.ReviewChannel.ChannelID);

    const embedSettings = config.ReviewChannel.Embed;
    const embed = new EmbedBuilder()
        if(embedSettings.Title) embed.setTitle(embedSettings.Title.replace('{totalReviews}', statsDB.totalReviews).replace('{ticketCreator.username}', ticketAuthor.username).replace('{ticket.totalMessages}', reviewDB.totalMessages).replace('{ticketCategory}', reviewDB.category).replace('{ticketCategory}', reviewDB.category))
        if(embedSettings.Color) embed.setColor(embedSettings.Color);
        if(!embedSettings.Color) embed.setColor(config.EmbedColors);
  
if(embedSettings.ThumbnailEnabled) {
    if (embedSettings.CustomThumbnail && embedSettings.CustomThumbnail !== '') {
        embed.setThumbnail(embedSettings.CustomThumbnail);
    } else {
        embed.setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true }));
    }
  }
    
    embed.addFields(embedSettings.Fields.map(field => ({
        name: field.name,
        value: field.value
            .replace('{ticketCreator.id}', ticketAuthor.id)
            .replace('{ticketCreator.username}', ticketAuthor.username)
            .replace('{ticketCategory}', reviewDB.category)
            .replace('{ticket.totalMessages}', reviewDB.totalMessages)
            .replace('{stars}', star)
            .replace('{reviewMessage}', firstResponse),
    })));
    
    if (embedSettings.Timestamp) {
        embed.setTimestamp();
    }
    
    const footerText = embedSettings.Footer.text
        .replace('{ticketCreator.username}', ticketAuthor.username)
        .replace('{ticketCategory}', reviewDB.category)
        .replace('{ticket.totalMessages}', reviewDB.totalMessages)
    
    // Check if footer.text is not blank before setting the footer
    if (footerText.trim() !== '') {
        if (embedSettings.Footer.Enabled && embedSettings.Footer.CustomIconURL == '' && embedSettings.Footer.IconEnabled) {
            embed.setFooter({
                text: footerText,
                iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true }),
            });
        } else {
            embed.setFooter({
                text: footerText,
            });
        }
    }
    
    // Additional customization options from config.yaml
    if (footerText.trim() !== '' && embedSettings.Footer.CustomIconURL !== '' && embedSettings.Footer.IconEnabled) {
        embed.setFooter({
            text: footerText,  // Include text if it's not empty
            iconURL: embedSettings.Footer.CustomIconURL,
        });
    }
    
    const nonce = SnowflakeUtil.generate();

    if(reviewChannel && config.ReviewChannel.Enabled) reviewChannel.send({ embeds: [embed], enforceNonce: true, nonce: nonce.toString() })

      await logsChannel.messages.fetch(reviewDB.tCloseLogMsgID).then(async (msg) => {
        const originalEmbed = msg.embeds[0];
        const updatedEmbed = EmbedBuilder.from(originalEmbed);
        
        let ratingContent = `> ${star} \`(${reviewDB.rating}/5)\`\n`;
        ratingContent += `> ${firstResponse}`;
        
        updatedEmbed.addFields([
          { 
            name: `\`⭐\` **${config.Locale.ticketRating}**`, 
            value: ratingContent 
          }
        ]);
        
        await msg.edit({ embeds: [updatedEmbed] });
      });

}
}

// Delete ticket button
if (interaction.customId === 'deleteTicket') {

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
    if (!supportRole) {
      return interaction.reply({ content: config.Locale.notAllowedDelete, flags: MessageFlags.Ephemeral });
    }

    if(!config.TicketSettings.TicketCloseReason) await interaction.deferReply().catch()

    let ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

    interaction.channel.messages.fetch(ticketDB.archiveMsgID).then(msg => {
        msg.delete()
    })

              // set closerUserID in the tickets db
              await ticketModel.updateOne(
                { channelID: interaction.channel.id },
                {
                    $set: {
                        closeUserID: interaction.user.id,
                        closedAt: Date.now(),
                    },
                }
            );
    await client.emit('ticketClose', interaction);
}

if (interaction.customId === 'cancelClosure') {
  await interaction.deferReply().catch(() => {});
  
  const ticketDB = await ticketModel.findOne({
    closeNotificationTime: { $exists: true, $ne: null },
    channelID: interaction.channel.id
  });
  
  if (!ticketDB) return interaction.editReply({ 
    content: "Kh�ng t�m th?y y�u c?u d�ng ticket dang ho?t d?ng." 
  });
  
  await ticketModel.findOneAndUpdate(
    { channelID: interaction.channel.id },
    { $unset: { closeReason: 1 }, $set: { closeNotificationTime: 0 } }
  );
  
        const cancelEmbed = new EmbedBuilder()
            .setColor(config.EmbedColors)
            .setDescription(`🔄 **Automatic closure cancelled**\n\n<@${interaction.user.id}> has cancelled the automatic closure of this ticket.`)
            .setFooter({ 
                text: `Cancelled by ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL({ dynamic: true })
            })
            .setTimestamp();
  
  await interaction.editReply({ embeds: [cancelEmbed] });
  
  try {
    const alertMessage = await interaction.channel.messages.fetch(ticketDB.closeNotificationMsgID);
    if (alertMessage) {
      await alertMessage.delete();
    }
  } catch (error) {
    console.error("Error deleting message:", error);
  }
}

// Handle AI AutoResponse button interactions
if (interaction.isButton() && interaction.customId.startsWith('ai_')) {
  if (interaction.customId.includes('ai_helpful_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    
    const messageId = interaction.customId.replace('ai_helpful_', '');
    const type = 'helpful';
    
    const aiResponse = await AIAutoResponseModel.findOne({ messageId: messageId });
    
    if (!aiResponse) {
      return interaction.editReply({ 
        content: "Ph?n h?i AI d� h?t h?n ho?c kh�ng t�m th?y."
      });
    }

    if (config.AIAutoResponse.ButtonSettings.RestrictToOriginalUser && interaction.user.id !== aiResponse.userId) {
      return interaction.editReply({
        content: "Ch? ngu?i d�ng d� k�ch ho?t ph?n h?i AI m?i c� th? d�nh gi�."
      });
    }

    aiResponse.buttonInteractionCount += 1;
    aiResponse.feedbackTimestamp = new Date();
    aiResponse.userFeedback = 'helpful';
    
    await aiResponse.save();

    try {
      await interaction.message.edit({ components: [] });
    } catch (error) {}

    await interaction.editReply({ 
      content: "Cảm ơn phản hồi của bạn! Rất vui được giúp đỡ. 😊"
    });

    if (config.AIAutoResponse.Statistics.LogsChannelID && config.AIAutoResponse.Statistics.LogsChannelID !== "CHANNEL_ID") {
      const logsChannel = interaction.guild.channels.cache.get(config.AIAutoResponse.Statistics.LogsChannelID);
      if (logsChannel) {
        const feedbackEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setAuthor({ name: '📊 AI Response Feedback' })
          .setTimestamp();

        let feedbackContent = '';
        feedbackContent += `> **User:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
        feedbackContent += `> **Response Key:** \`${aiResponse.responseKey}\`\n`;
        feedbackContent += `> **Feedback:** \`${aiResponse.userFeedback}\`\n`;
        feedbackContent += `> **AI Confidence:** \`${(aiResponse.aiConfidence * 100).toFixed(1)}%\``;

        feedbackEmbed.addFields([{
          name: '`💬` **User Feedback Details**',
          value: feedbackContent
        }]);

        feedbackEmbed.setFooter({
          text: `Original Message: ${aiResponse.userMessage.substring(0, 50)}...`,
          iconURL: interaction.user.displayAvatarURL({ dynamic: true })
        });

        logsChannel.send({ embeds: [feedbackEmbed] });
      }
    }
    
  } else if (interaction.customId.includes('ai_not_helpful_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    
    const messageId = interaction.customId.replace('ai_not_helpful_', '');
    const type = 'not_helpful';
    
    const aiResponse = await AIAutoResponseModel.findOne({ messageId: messageId });
    
    if (!aiResponse) {
      return interaction.editReply({ 
        content: "Ph?n h?i AI d� h?t h?n ho?c kh�ng t�m th?y."
      });
    }

    if (config.AIAutoResponse.ButtonSettings.RestrictToOriginalUser && interaction.user.id !== aiResponse.userId) {
      return interaction.editReply({
        content: "Ch? ngu?i d�ng d� k�ch ho?t ph?n h?i AI m?i c� th? d�nh gi�."
      });
    }

    aiResponse.buttonInteractionCount += 1;
    aiResponse.feedbackTimestamp = new Date();
    aiResponse.userFeedback = 'not_helpful';
    
    await aiResponse.save();

    try {
      await interaction.message.edit({ components: [] });
    } catch (error) {}

    await interaction.editReply({ 
      content: "I'm sorry my response wasn't helpful. Please feel free to ask for more specific help or contact staff directly!"
    });

    if (config.AIAutoResponse.Statistics.LogsChannelID && config.AIAutoResponse.Statistics.LogsChannelID !== "CHANNEL_ID") {
      const logsChannel = interaction.guild.channels.cache.get(config.AIAutoResponse.Statistics.LogsChannelID);
      if (logsChannel) {
        const feedbackEmbed = new EmbedBuilder()
          .setColor('#FF9900')
          .setAuthor({ name: '📊 AI Response Feedback' })
          .setTimestamp();

        let feedbackContent = '';
        feedbackContent += `> **User:** <@!${interaction.user.id}> \`${interaction.user.username}\`\n`;
        feedbackContent += `> **Response Key:** \`${aiResponse.responseKey}\`\n`;
        feedbackContent += `> **Feedback:** \`${aiResponse.userFeedback}\`\n`;
        feedbackContent += `> **AI Confidence:** \`${(aiResponse.aiConfidence * 100).toFixed(1)}%\``;

        feedbackEmbed.addFields([{
          name: '`💬` **User Feedback Details**',
          value: feedbackContent
        }]);

        feedbackEmbed.setFooter({
          text: `Original Message: ${aiResponse.userMessage.substring(0, 50)}...`,
          iconURL: interaction.user.displayAvatarURL({ dynamic: true })
        });

        logsChannel.send({ embeds: [feedbackEmbed] });
      }
    }
  }
}

eventHandler.emit('interactionCreate', interaction);

}
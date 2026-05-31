/**
 * slashCommands/Admin/setup.js
 * Lệnh /setup — cấu hình toàn bộ bot qua Discord
 * Yêu cầu quyền Administrator
 */
'use strict';

const { SlashCommandBuilder } = require('@discordjs/builders');
const {
  EmbedBuilder, PermissionFlagsBits, MessageFlags, ChannelType,
} = require('discord.js');
const config = require('../../config');
const { getConfig, setConfig } = require('../../db/config');
const Categories = require('../../db/categories');

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ok  = msg => new EmbedBuilder().setColor('#57F287').setDescription(`✅ ${msg}`).setTimestamp();
const err = msg => new EmbedBuilder().setColor('#ED4245').setDescription(`❌ ${msg}`).setTimestamp();
function info(title, desc) {
  const e = new EmbedBuilder().setColor(getConfig('bot.embedColor','#5e99ff')).setTitle(title).setTimestamp();
  if (desc) e.setDescription(desc);
  return e;
}
function parseRoles(raw, guild) {
  const ids = raw.split(',').map(r => r.trim()).filter(Boolean);
  const bad = ids.filter(id => !guild.roles.cache.has(id));
  return { ids, bad };
}

// ─── Slash Command Definition ─────────────────────────────────────────────────
const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('⚙️ Cấu hình bot Heiznerd Tickets')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// ── Group: ticket ─────────────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('ticket').setDescription('Cài đặt hệ thống ticket')
  .addSubcommand(s => s.setName('logschannel').setDescription('Kênh log ticket mặc định')
    .addChannelOption(o => o.setName('channel').setDescription('Kênh').setRequired(true).addChannelTypes(ChannelType.GuildText)))
  .addSubcommand(s => s.setName('maxtickets').setDescription('Số ticket tối đa/người')
    .addIntegerOption(o => o.setName('amount').setDescription('1-10').setRequired(true).setMinValue(1).setMaxValue(10)))
  .addSubcommand(s => s.setName('deletetime').setDescription('Giây trước khi xóa ticket sau đóng')
    .addIntegerOption(o => o.setName('seconds').setDescription('0-60').setRequired(true).setMinValue(0).setMaxValue(60)))
  .addSubcommand(s => s.setName('cooldown').setDescription('Cooldown tạo ticket (giây, 0=tắt)')
    .addIntegerOption(o => o.setName('seconds').setDescription('Giây').setRequired(true).setMinValue(0)))
  .addSubcommand(s => s.setName('mentionuser').setDescription('Mention người tạo khi mở ticket?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('restrictclose').setDescription('Chỉ staff đóng ticket?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('closereason').setDescription('Yêu cầu lý do khi đóng ticket?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('selectmenu').setDescription('Dùng dropdown thay vì nút?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('embedcolor').setDescription('Màu embed mặc định (hex)')
    .addStringOption(o => o.setName('color').setDescription('Ví dụ: #5e99ff').setRequired(true)))
  .addSubcommand(s => s.setName('staffroles').setDescription('Xem danh sách staff roles hiện tại'))
  .addSubcommand(s => s.setName('staffroles-add').setDescription('Thêm role vào danh sách staff')
    .addRoleOption(o => o.setName('role').setDescription('Role cần thêm').setRequired(true)))
  .addSubcommand(s => s.setName('staffroles-remove').setDescription('Xóa role khỏi danh sách staff')
    .addRoleOption(o => o.setName('role').setDescription('Role cần xóa').setRequired(true)))
  .addSubcommand(s => s.setName('info').setDescription('Xem cấu hình ticket hiện tại'))
);

// ── Group: category ───────────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('category').setDescription('Quản lý danh mục ticket')
  .addSubcommand(s => s.setName('create').setDescription('Tạo danh mục mới')
    .addStringOption(o => o.setName('key').setDescription('Key (chữ thường, gạch ngang, vd: ho-tro)').setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('Tên hiển thị').setRequired(true))
    .addChannelOption(o => o.setName('category_channel').setDescription('Discord category chứa ticket').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
    .addStringOption(o => o.setName('support_roles').setDescription('ID role hỗ trợ, cách nhau bằng dấu phẩy').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji nút (tùy chọn)'))
    .addStringOption(o => o.setName('description').setDescription('Mô tả ngắn (tùy chọn)'))
    .addStringOption(o => o.setName('button_color').setDescription('Màu nút')
      .addChoices({name:'🟢 Xanh lá',value:'Green'},{name:'🔵 Xanh dương',value:'Blurple'},{name:'⚫ Xám',value:'Gray'},{name:'🔴 Đỏ',value:'Red'}))
    .addChannelOption(o => o.setName('logs_channel').setDescription('Kênh log riêng (tùy chọn)').addChannelTypes(ChannelType.GuildText))
    .addStringOption(o => o.setName('channel_name').setDescription('Tên kênh ticket (mặc định: ticket-{username})'))
    .addStringOption(o => o.setName('embed_title').setDescription('Tiêu đề embed khi tạo ticket'))
    .addStringOption(o => o.setName('embed_message').setDescription('Nội dung embed khi tạo ticket'))
    .addBooleanOption(o => o.setName('mention_roles').setDescription('Mention role khi tạo ticket?'))
  )
  .addSubcommand(s => s.setName('edit').setDescription('Chỉnh sửa danh mục')
    .addStringOption(o => o.setName('key').setDescription('Key danh mục').setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('Tên mới'))
    .addStringOption(o => o.setName('emoji').setDescription('Emoji mới'))
    .addStringOption(o => o.setName('description').setDescription('Mô tả mới'))
    .addChannelOption(o => o.setName('category_channel').setDescription('Category channel mới').addChannelTypes(ChannelType.GuildCategory))
    .addStringOption(o => o.setName('support_roles').setDescription('Role hỗ trợ mới (ID cách nhau bằng dấu phẩy)'))
    .addChannelOption(o => o.setName('logs_channel').setDescription('Kênh log mới').addChannelTypes(ChannelType.GuildText))
    .addBooleanOption(o => o.setName('mention_roles').setDescription('Mention role khi tạo ticket?'))
    .addStringOption(o => o.setName('channel_name').setDescription('Tên kênh ticket'))
    .addStringOption(o => o.setName('embed_title').setDescription('Tiêu đề embed'))
    .addStringOption(o => o.setName('embed_message').setDescription('Nội dung embed'))
  )
  .addSubcommand(s => s.setName('delete').setDescription('Xóa danh mục')
    .addStringOption(o => o.setName('key').setDescription('Key danh mục').setRequired(true)))
  .addSubcommand(s => s.setName('list').setDescription('Xem danh sách danh mục'))
);

// ── Group: transcript ─────────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('transcript').setDescription('Cài đặt transcript')
  .addSubcommand(s => s.setName('type').setDescription('Loại transcript (HTML/TXT)')
    .addStringOption(o => o.setName('type').setDescription('Loại').setRequired(true)
      .addChoices({name:'HTML',value:'HTML'},{name:'TXT',value:'TXT'})))
  .addSubcommand(s => s.setName('saveinfolder').setDescription('Lưu transcript vào thư mục local?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('messagesrequirement').setDescription('Số tin nhắn tối thiểu để tạo transcript')
    .addIntegerOption(o => o.setName('amount').setDescription('Số lượng').setRequired(true).setMinValue(0)))
);

// ── Group: claiming ───────────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('claiming').setDescription('Cài đặt claiming')
  .addSubcommand(s => s.setName('enabled').setDescription('Bật/tắt claiming')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('maxperstaff').setDescription('Số ticket tối đa mỗi staff nhận')
    .addIntegerOption(o => o.setName('amount').setDescription('Số lượng (0=không giới hạn)').setRequired(true).setMinValue(0)))
  .addSubcommand(s => s.setName('locknewtickets').setDescription('Khóa ticket mới cho đến khi được nhận?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('autoclaim').setDescription('Tự động nhận ticket khi staff phản hồi?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('movecategory').setDescription('Category để chuyển ticket đã nhận')
    .addChannelOption(o => o.setName('category').setDescription('Discord category').setRequired(true).addChannelTypes(ChannelType.GuildCategory)))
);

// ── Group: alert ──────────────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('alert').setDescription('Cài đặt cảnh báo không hoạt động')
  .addSubcommand(s => s.setName('enabled').setDescription('Bật/tắt hệ thống alert')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('time').setDescription('Thời gian trước khi đóng (vd: 12h, 3d)')
    .addStringOption(o => o.setName('time').setDescription('Ví dụ: 12h, 3d, 30m').setRequired(true)))
  .addSubcommand(s => s.setName('dmuser').setDescription('DM người dùng khi sắp đóng?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('autoalert').setDescription('Tự động gửi alert khi ticket không hoạt động?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('inactivetime').setDescription('Thời gian không hoạt động trước khi auto-alert (vd: 3d)')
    .addStringOption(o => o.setName('time').setDescription('Ví dụ: 3d, 12h').setRequired(true)))
);

// ── Group: workinghours ───────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('workinghours').setDescription('Cài đặt giờ làm việc')
  .addSubcommand(s => s.setName('enabled').setDescription('Bật/tắt giờ làm việc')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('timezone').setDescription('Múi giờ (vd: Asia/Ho_Chi_Minh)')
    .addStringOption(o => o.setName('timezone').setDescription('Múi giờ').setRequired(true)))
  .addSubcommand(s => s.setName('schedule').setDescription('Đặt lịch làm việc cho một ngày')
    .addStringOption(o => o.setName('day').setDescription('Ngày trong tuần').setRequired(true)
      .addChoices(
        {name:'Thứ Hai',value:'Monday'},{name:'Thứ Ba',value:'Tuesday'},
        {name:'Thứ Tư',value:'Wednesday'},{name:'Thứ Năm',value:'Thursday'},
        {name:'Thứ Sáu',value:'Friday'},{name:'Thứ Bảy',value:'Saturday'},
        {name:'Chủ Nhật',value:'Sunday'}))
    .addStringOption(o => o.setName('hours').setDescription('Giờ làm việc (vd: 08:00-17:00) hoặc "closed"').setRequired(true)))
  .addSubcommand(s => s.setName('allowoutside').setDescription('Cho phép tạo ticket ngoài giờ?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('info').setDescription('Xem lịch làm việc hiện tại'))
);

// ── Group: review ─────────────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('review').setDescription('Cài đặt hệ thống đánh giá')
  .addSubcommand(s => s.setName('enabled').setDescription('Bật/tắt đánh giá sau khi đóng ticket')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('channel').setDescription('Kênh đăng đánh giá công khai')
    .addChannelOption(o => o.setName('channel').setDescription('Kênh').setRequired(true).addChannelTypes(ChannelType.GuildText)))
  .addSubcommand(s => s.setName('channeloff').setDescription('Tắt kênh đánh giá công khai'))
);

// ── Group: suggestion ─────────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('suggestion').setDescription('Cài đặt hệ thống đề xuất')
  .addSubcommand(s => s.setName('enabled').setDescription('Bật/tắt hệ thống đề xuất')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('channel').setDescription('Kênh đăng đề xuất')
    .addChannelOption(o => o.setName('channel').setDescription('Kênh').setRequired(true).addChannelTypes(ChannelType.GuildText)))
  .addSubcommand(s => s.setName('createthreads').setDescription('Tạo thread cho mỗi đề xuất?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
);

// ── Group: channelstats ───────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('channelstats').setDescription('Kênh thống kê tự động cập nhật')
  .addSubcommand(s => s.setName('totaltickets').setDescription('Kênh hiển thị tổng số ticket')
    .addChannelOption(o => o.setName('channel').setDescription('Voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('opentickets').setDescription('Kênh hiển thị ticket đang mở')
    .addChannelOption(o => o.setName('channel').setDescription('Voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('averagerating').setDescription('Kênh hiển thị đánh giá trung bình')
    .addChannelOption(o => o.setName('channel').setDescription('Voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('membercount').setDescription('Kênh hiển thị số thành viên')
    .addChannelOption(o => o.setName('channel').setDescription('Voice channel').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
);

// ── Group: archive ────────────────────────────────────────────────────────────
data.addSubcommandGroup(g => g.setName('archive').setDescription('Cài đặt hệ thống lưu trữ ticket')
  .addSubcommand(s => s.setName('enabled').setDescription('Bật/tắt lưu trữ thay vì xóa ngay')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
  .addSubcommand(s => s.setName('category').setDescription('Category để chuyển ticket đã lưu trữ')
    .addChannelOption(o => o.setName('category').setDescription('Discord category').setRequired(true).addChannelTypes(ChannelType.GuildCategory)))
  .addSubcommand(s => s.setName('hidefromcreator').setDescription('Ẩn ticket đã lưu trữ khỏi người tạo?')
    .addBooleanOption(o => o.setName('enabled').setDescription('Bật/tắt').setRequired(true)))
);

// ── Top-level: info ───────────────────────────────────────────────────────────
data.addSubcommand(s => s.setName('info').setDescription('Xem tổng quan cấu hình bot'));

module.exports = {
  enabled: true,
  data,
  async execute(interaction, client) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ embeds: [err('Bạn cần quyền **Administrator**!')], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const group = interaction.options.getSubcommandGroup(false);
    const sub   = interaction.options.getSubcommand();

    if (!group && sub === 'info') return handleTopInfo(interaction);
    if (group === 'ticket')       return handleTicket(interaction, sub);
    if (group === 'category')     return handleCategory(interaction, sub);
    if (group === 'transcript')   return handleTranscript(interaction, sub);
    if (group === 'claiming')     return handleClaiming(interaction, sub);
    if (group === 'alert')        return handleAlert(interaction, sub);
    if (group === 'workinghours') return handleWorkingHours(interaction, sub);
    if (group === 'review')       return handleReview(interaction, sub);
    if (group === 'suggestion')   return handleSuggestion(interaction, sub);
    if (group === 'channelstats') return handleChannelStats(interaction, sub);
    if (group === 'archive')      return handleArchive(interaction, sub);
  },
};

// ─── /setup info ─────────────────────────────────────────────────────────────
async function handleTopInfo(interaction) {
  const cats    = Categories.findAll();
  const logsID  = getConfig('ticket.logsChannelID','');
  const embed   = info('⚙️ Cấu hình Heiznerd Tickets')
    .addFields(
      { name:'🎫 Ticket', value:
        `> **Kênh log:** ${logsID?`<#${logsID}>`:'❌ Chưa đặt'}\n`+
        `> **Tối đa/người:** \`${getConfig('ticket.maxTickets',1)}\`\n`+
        `> **Thời gian xóa:** \`${getConfig('ticket.deleteTime',5)}s\`\n`+
        `> **Cooldown:** \`${getConfig('ticket.cooldown',0)}s\`\n`+
        `> **Màu embed:** \`${getConfig('bot.embedColor','#5e99ff')}\`\n`+
        `> **Dropdown menu:** \`${getConfig('ticket.selectMenu',true)?'Bật':'Tắt'}\`\n`+
        `> **Restrict close:** \`${getConfig('ticket.restrictClose',false)?'Bật':'Tắt'}\``, inline:false },
      { name:'👥 Staff Roles', value: (getConfig('staffRoles',[])).length
        ? getConfig('staffRoles',[]).map(r=>`<@&${r}>`).join(', ')
        : '❌ Chưa đặt', inline:false },
      { name:'📋 Danh mục', value: cats.length
        ? cats.map(c=>`> \`${c.categoryKey}\` — **${c.categoryName}** ${c.categoryEmoji||''}`).join('\n')
        : '❌ Chưa có. Dùng `/setup category create`', inline:false },
      { name:'🔔 Alert', value:
        `> **Bật:** \`${getConfig('alert.enabled',true)?'Có':'Không'}\`\n`+
        `> **Thời gian:** \`${getConfig('alert.time','12h')}\`\n`+
        `> **Auto-alert:** \`${getConfig('alert.autoAlert.enabled',false)?'Bật':'Tắt'}\``, inline:true },
      { name:'⏰ Giờ làm việc', value:
        `> **Bật:** \`${getConfig('workingHours.enabled',true)?'Có':'Không'}\`\n`+
        `> **Múi giờ:** \`${getConfig('workingHours.timezone','Asia/Ho_Chi_Minh')}\``, inline:true },
      { name:'🔧 Khác', value:
        `> **Claiming:** \`${getConfig('claiming.enabled',true)?'Bật':'Tắt'}\`\n`+
        `> **Transcript:** \`${getConfig('transcript.type','HTML')}\`\n`+
        `> **Archive:** \`${getConfig('archive.enabled',false)?'Bật':'Tắt'}\`\n`+
        `> **Review:** \`${getConfig('review.enabled',true)?'Bật':'Tắt'}\`\n`+
        `> **Suggestion:** \`${getConfig('suggestion.enabled',false)?'Bật':'Tắt'}\``, inline:false },
    );
  return interaction.editReply({ embeds:[embed] });
}

// ─── /setup ticket * ─────────────────────────────────────────────────────────
async function handleTicket(interaction, sub) {
  switch(sub) {
    case 'logschannel': {
      const ch = interaction.options.getChannel('channel');
      setConfig('ticket.logsChannelID', ch.id);
      return interaction.editReply({ embeds:[ok(`Kênh log → <#${ch.id}>`)] });
    }
    case 'maxtickets': {
      const n = interaction.options.getInteger('amount');
      setConfig('ticket.maxTickets', n);
      return interaction.editReply({ embeds:[ok(`Tối đa ticket/người → \`${n}\``)] });
    }
    case 'deletetime': {
      const s = interaction.options.getInteger('seconds');
      setConfig('ticket.deleteTime', s);
      return interaction.editReply({ embeds:[ok(`Thời gian xóa → \`${s}s\``)] });
    }
    case 'cooldown': {
      const s = interaction.options.getInteger('seconds');
      setConfig('ticket.cooldown', s);
      return interaction.editReply({ embeds:[ok(`Cooldown tạo ticket → \`${s}s\``)] });
    }
    case 'mentionuser': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('ticket.mentionAuthor', v);
      return interaction.editReply({ embeds:[ok(`Mention người tạo → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'restrictclose': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('ticket.restrictClose', v);
      return interaction.editReply({ embeds:[ok(`Chỉ staff đóng ticket → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'closereason': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('ticket.closeReason', v);
      return interaction.editReply({ embeds:[ok(`Yêu cầu lý do đóng → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'selectmenu': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('ticket.selectMenu', v);
      return interaction.editReply({ embeds:[ok(`Dropdown menu → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'embedcolor': {
      const color = interaction.options.getString('color').trim();
      if (!/^#([0-9a-fA-F]{3}){1,2}$/.test(color))
        return interaction.editReply({ embeds:[err('Màu không hợp lệ! Dùng hex, vd: `#5e99ff`')] });
      setConfig('bot.embedColor', color);
      return interaction.editReply({ embeds:[ok(`Màu embed → \`${color}\``)] });
    }
    case 'staffroles': {
      const current = getConfig('staffRoles', []);
      if (!current.length) return interaction.editReply({ embeds:[info('👥 Staff Roles', '❌ Chưa có staff role nào.\nDùng `/setup ticket staffroles-add @role` để thêm.')] });
      const e = info('👥 Staff Roles', current.map((r, i) => `${i+1}. <@&${r}> \`${r}\``).join('\n'));
      return interaction.editReply({ embeds:[e] });
    }
    case 'staffroles-add': {
      const role = interaction.options.getRole('role');
      const current = getConfig('staffRoles', []);
      if (current.includes(role.id))
        return interaction.editReply({ embeds:[err(`<@&${role.id}> đã có trong danh sách staff rồi!`)] });
      setConfig('staffRoles', [...current, role.id]);
      return interaction.editReply({ embeds:[ok(`Đã thêm <@&${role.id}> vào staff roles.\n**Hiện tại:** ${[...current, role.id].map(r=>`<@&${r}>`).join(', ')}`)] });
    }
    case 'staffroles-remove': {
      const role = interaction.options.getRole('role');
      const current = getConfig('staffRoles', []);
      if (!current.includes(role.id))
        return interaction.editReply({ embeds:[err(`<@&${role.id}> không có trong danh sách staff!`)] });
      const updated = current.filter(r => r !== role.id);
      setConfig('staffRoles', updated);
      return interaction.editReply({ embeds:[ok(`Đã xóa <@&${role.id}> khỏi staff roles.\n**Còn lại:** ${updated.length ? updated.map(r=>`<@&${r}>`).join(', ') : '_(trống)_'}`)] });
    }
    case 'info': return handleTopInfo(interaction);
  }
}

// ─── /setup category * ───────────────────────────────────────────────────────
async function handleCategory(interaction, sub) {
  switch(sub) {
    case 'create': {
      const key  = interaction.options.getString('key').toLowerCase().replace(/\s+/g,'-');
      const name = interaction.options.getString('name');
      const catCh= interaction.options.getChannel('category_channel');
      const raw  = interaction.options.getString('support_roles');
      const { ids: supportRoles, bad } = parseRoles(raw, interaction.guild);
      if (!/^[a-z0-9-]+$/.test(key))
        return interaction.editReply({ embeds:[err('Key chỉ được chứa chữ thường, số và dấu gạch ngang!')] });
      if (Categories.findByKey(key))
        return interaction.editReply({ embeds:[err(`Danh mục \`${key}\` đã tồn tại!`)] });
      if (bad.length) return interaction.editReply({ embeds:[err(`Không tìm thấy role: ${bad.join(', ')}`)] });

      const logsCh    = interaction.options.getChannel('logs_channel');
      const emoji     = interaction.options.getString('emoji')        || '';
      const desc      = interaction.options.getString('description')  || '';
      const btnColor  = interaction.options.getString('button_color') || 'Green';
      const chName    = interaction.options.getString('channel_name') || 'ticket-{username}';
      const embedTitle= interaction.options.getString('embed_title')  || `Ticket Hỗ Trợ ({category})`;
      const embedMsg  = interaction.options.getString('embed_message')|| '> Cảm ơn bạn đã liên hệ. Vui lòng mô tả vấn đề và chờ nhân viên hỗ trợ.';
      const mention   = interaction.options.getBoolean('mention_roles') ?? false;

      Categories.create({
        categoryKey: key, categoryName: name, description: desc,
        parentCategoryID: catCh.id, embedTitle, embedMessage: embedMsg,
        categoryEmoji: emoji, buttonColor: btnColor, supportRoles,
        mentionSupportRoles: mention, channelName: chName,
        logsChannelID: logsCh ? logsCh.id : '',
        requiredRoles: [], questions: [],
        sortOrder: Categories.findAll().length, enabled: true,
      });

      const e = ok(`Danh mục **${name}** (\`${key}\`) đã tạo!`)
        .addFields(
          { name:'Category', value:`<#${catCh.id}>`, inline:true },
          { name:'Support Roles', value:supportRoles.map(r=>`<@&${r}>`).join(', '), inline:true },
          { name:'Màu nút', value:btnColor, inline:true },
        );
      if (logsCh) e.addFields({ name:'Kênh log', value:`<#${logsCh.id}>`, inline:true });
      return interaction.editReply({ embeds:[e] });
    }
    case 'edit': {
      const key = interaction.options.getString('key').toLowerCase();
      const cat = Categories.findByKey(key);
      if (!cat) return interaction.editReply({ embeds:[err(`Không tìm thấy danh mục \`${key}\`!`)] });

      const updates = {};
      const newName   = interaction.options.getString('name');
      const newEmoji  = interaction.options.getString('emoji');
      const newDesc   = interaction.options.getString('description');
      const newCatCh  = interaction.options.getChannel('category_channel');
      const newRaw    = interaction.options.getString('support_roles');
      const newLogsCh = interaction.options.getChannel('logs_channel');
      const newMention= interaction.options.getBoolean('mention_roles');
      const newChName = interaction.options.getString('channel_name');
      const newTitle  = interaction.options.getString('embed_title');
      const newMsg    = interaction.options.getString('embed_message');

      if (newName)    updates.categoryName     = newName;
      if (newEmoji !== null) updates.categoryEmoji = newEmoji;
      if (newDesc !== null)  updates.description   = newDesc;
      if (newCatCh)   updates.parentCategoryID = newCatCh.id;
      if (newLogsCh)  updates.logsChannelID    = newLogsCh.id;
      if (newMention !== null) updates.mentionSupportRoles = newMention;
      if (newChName)  updates.channelName      = newChName;
      if (newTitle)   updates.embedTitle       = newTitle;
      if (newMsg)     updates.embedMessage     = newMsg;
      if (newRaw) {
        const { ids, bad } = parseRoles(newRaw, interaction.guild);
        if (bad.length) return interaction.editReply({ embeds:[err(`Không tìm thấy role: ${bad.join(', ')}`)] });
        updates.supportRoles = ids;
      }
      if (!Object.keys(updates).length)
        return interaction.editReply({ embeds:[err('Không có thay đổi nào!')] });

      Categories.update(key, updates);
      return interaction.editReply({ embeds:[ok(`Đã cập nhật danh mục **${cat.categoryName}** (\`${key}\`)`)] });
    }
    case 'delete': {
      const key = interaction.options.getString('key').toLowerCase();
      const cat = Categories.findByKey(key);
      if (!cat) return interaction.editReply({ embeds:[err(`Không tìm thấy danh mục \`${key}\`!`)] });
      Categories.delete(key);
      return interaction.editReply({ embeds:[ok(`Đã xóa danh mục **${cat.categoryName}** (\`${key}\`)`)] });
    }
    case 'list': {
      const cats = Categories.findAll();
      if (!cats.length)
        return interaction.editReply({ embeds:[info('📋 Danh mục ticket','❌ Chưa có danh mục nào.\nDùng `/setup category create` để tạo.')] });
      const e = info(`📋 Danh mục ticket (${cats.length})`);
      for (const cat of cats) {
        e.addFields({ name:`${cat.categoryEmoji||'🎫'} ${cat.categoryName} (\`${cat.categoryKey}\`)`,
          value:`> **Category:** <#${cat.parentCategoryID}>\n`+
                `> **Support Roles:** ${cat.supportRoles.length?cat.supportRoles.map(r=>`<@&${r}>`).join(', '):'Chưa đặt'}\n`+
                `> **Log Channel:** ${cat.logsChannelID?`<#${cat.logsChannelID}>`:'Mặc định'}\n`+
                `> **Màu nút:** ${cat.buttonColor}`, inline:false });
      }
      return interaction.editReply({ embeds:[e] });
    }
  }
}

// ─── /setup transcript * ─────────────────────────────────────────────────────
async function handleTranscript(interaction, sub) {
  switch(sub) {
    case 'type': {
      const t = interaction.options.getString('type');
      setConfig('transcript.type', t);
      return interaction.editReply({ embeds:[ok(`Loại transcript → \`${t}\``)] });
    }
    case 'saveinfolder': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('transcript.saveInFolder', v);
      return interaction.editReply({ embeds:[ok(`Lưu transcript vào thư mục → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'messagesrequirement': {
      const n = interaction.options.getInteger('amount');
      setConfig('transcript.messagesRequirement', n);
      return interaction.editReply({ embeds:[ok(`Số tin nhắn tối thiểu để tạo transcript → \`${n}\``)] });
    }
  }
}

// ─── /setup claiming * ───────────────────────────────────────────────────────
async function handleClaiming(interaction, sub) {
  switch(sub) {
    case 'enabled': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('claiming.enabled', v);
      return interaction.editReply({ embeds:[ok(`Claiming → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'maxperstaff': {
      const n = interaction.options.getInteger('amount');
      setConfig('claiming.maxPerStaff', n);
      return interaction.editReply({ embeds:[ok(`Tối đa ticket/staff → \`${n===0?'Không giới hạn':n}\``)] });
    }
    case 'locknewtickets': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('claiming.lockNewTickets', v);
      return interaction.editReply({ embeds:[ok(`Khóa ticket mới cho đến khi nhận → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'autoclaim': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('claiming.autoClaim.enabled', v);
      return interaction.editReply({ embeds:[ok(`Auto-claim → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'movecategory': {
      const ch = interaction.options.getChannel('category');
      setConfig('claiming.moveEnabled', true);
      setConfig('claiming.moveCategoryID', ch.id);
      return interaction.editReply({ embeds:[ok(`Ticket đã nhận sẽ chuyển vào <#${ch.id}>`)] });
    }
  }
}

// ─── /setup alert * ──────────────────────────────────────────────────────────
async function handleAlert(interaction, sub) {
  switch(sub) {
    case 'enabled': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('alert.enabled', v);
      return interaction.editReply({ embeds:[ok(`Alert → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'time': {
      const t = interaction.options.getString('time');
      setConfig('alert.time', t);
      return interaction.editReply({ embeds:[ok(`Thời gian alert → \`${t}\``)] });
    }
    case 'dmuser': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('alert.dmUser', v);
      return interaction.editReply({ embeds:[ok(`DM người dùng khi alert → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'autoalert': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('alert.autoAlert.enabled', v);
      return interaction.editReply({ embeds:[ok(`Auto-alert → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'inactivetime': {
      const t = interaction.options.getString('time');
      setConfig('alert.autoAlert.inactiveTime', t);
      return interaction.editReply({ embeds:[ok(`Thời gian không hoạt động trước auto-alert → \`${t}\``)] });
    }
  }
}

// ─── /setup workinghours * ───────────────────────────────────────────────────
async function handleWorkingHours(interaction, sub) {
  switch(sub) {
    case 'enabled': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('workingHours.enabled', v);
      return interaction.editReply({ embeds:[ok(`Giờ làm việc → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'timezone': {
      const tz = interaction.options.getString('timezone');
      setConfig('workingHours.timezone', tz);
      return interaction.editReply({ embeds:[ok(`Múi giờ → \`${tz}\``)] });
    }
    case 'schedule': {
      const day   = interaction.options.getString('day');
      const hours = interaction.options.getString('hours').toLowerCase();
      // Validate format: HH:MM-HH:MM or "closed"
      if (hours !== 'closed' && !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(hours))
        return interaction.editReply({ embeds:[err('Định dạng không hợp lệ! Dùng `HH:MM-HH:MM` hoặc `closed`')] });
      const schedule = getConfig('workingHours.schedule', {});
      schedule[day] = hours;
      setConfig('workingHours.schedule', schedule);
      const dayVi = { Monday:'Thứ Hai', Tuesday:'Thứ Ba', Wednesday:'Thứ Tư',
        Thursday:'Thứ Năm', Friday:'Thứ Sáu', Saturday:'Thứ Bảy', Sunday:'Chủ Nhật' };
      return interaction.editReply({ embeds:[ok(`Lịch **${dayVi[day]}** → \`${hours}\``)] });
    }
    case 'allowoutside': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('workingHours.allowOutside', v);
      return interaction.editReply({ embeds:[ok(`Cho phép tạo ticket ngoài giờ → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'info': {
      const schedule = getConfig('workingHours.schedule', {});
      const dayVi = { Monday:'Thứ Hai', Tuesday:'Thứ Ba', Wednesday:'Thứ Tư',
        Thursday:'Thứ Năm', Friday:'Thứ Sáu', Saturday:'Thứ Bảy', Sunday:'Chủ Nhật' };
      const lines = Object.entries(schedule).map(([d,h]) => `> **${dayVi[d]||d}:** \`${h}\``).join('\n') || '> Chưa cấu hình';
      const e = info('⏰ Lịch làm việc',
        `**Bật:** \`${getConfig('workingHours.enabled',true)?'Có':'Không'}\`\n`+
        `**Múi giờ:** \`${getConfig('workingHours.timezone','Asia/Ho_Chi_Minh')}\`\n`+
        `**Cho phép ngoài giờ:** \`${getConfig('workingHours.allowOutside',false)?'Có':'Không'}\`\n\n`+
        lines);
      return interaction.editReply({ embeds:[e] });
    }
  }
}

// ─── /setup review * ─────────────────────────────────────────────────────────
async function handleReview(interaction, sub) {
  switch(sub) {
    case 'enabled': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('review.enabled', v);
      return interaction.editReply({ embeds:[ok(`Hệ thống đánh giá → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'channel': {
      const ch = interaction.options.getChannel('channel');
      setConfig('review.channel.enabled', true);
      setConfig('review.channel.channelID', ch.id);
      return interaction.editReply({ embeds:[ok(`Kênh đánh giá công khai → <#${ch.id}>`)] });
    }
    case 'channeloff': {
      setConfig('review.channel.enabled', false);
      return interaction.editReply({ embeds:[ok('Đã tắt kênh đánh giá công khai')] });
    }
  }
}

// ─── /setup suggestion * ─────────────────────────────────────────────────────
async function handleSuggestion(interaction, sub) {
  switch(sub) {
    case 'enabled': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('suggestion.enabled', v);
      return interaction.editReply({ embeds:[ok(`Hệ thống đề xuất → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'channel': {
      const ch = interaction.options.getChannel('channel');
      setConfig('suggestion.channelID', ch.id);
      return interaction.editReply({ embeds:[ok(`Kênh đề xuất → <#${ch.id}>`)] });
    }
    case 'createthreads': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('suggestion.createThreads', v);
      return interaction.editReply({ embeds:[ok(`Tạo thread cho đề xuất → \`${v?'Bật':'Tắt'}\``)] });
    }
  }
}

// ─── /setup channelstats * ───────────────────────────────────────────────────
async function handleChannelStats(interaction, sub) {
  const ch      = interaction.options.getChannel('channel');
  const enabled = interaction.options.getBoolean('enabled');
  const keyMap  = {
    totaltickets:  'channelStats.totalTickets',
    opentickets:   'channelStats.openTickets',
    averagerating: 'channelStats.averageRating',
    membercount:   'channelStats.memberCount',
  };
  const key = keyMap[sub];
  if (!key) return;
  setConfig(`${key}.enabled`,   enabled);
  setConfig(`${key}.channelID`, ch.id);
  return interaction.editReply({ embeds:[ok(`Kênh thống kê **${sub}** → <#${ch.id}> (\`${enabled?'Bật':'Tắt'}\`)`)] });
}

// ─── /setup archive * ────────────────────────────────────────────────────────
async function handleArchive(interaction, sub) {
  switch(sub) {
    case 'enabled': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('archive.enabled', v);
      return interaction.editReply({ embeds:[ok(`Hệ thống lưu trữ → \`${v?'Bật':'Tắt'}\``)] });
    }
    case 'category': {
      const ch = interaction.options.getChannel('category');
      setConfig('archive.moveToCategory', true);
      setConfig('archive.categoryID', ch.id);
      return interaction.editReply({ embeds:[ok(`Ticket lưu trữ sẽ chuyển vào <#${ch.id}>`)] });
    }
    case 'hidefromcreator': {
      const v = interaction.options.getBoolean('enabled');
      setConfig('archive.hideFromCreator', v);
      return interaction.editReply({ embeds:[ok(`Ẩn ticket lưu trữ khỏi người tạo → \`${v?'Bật':'Tắt'}\``)] });
    }
  }
}

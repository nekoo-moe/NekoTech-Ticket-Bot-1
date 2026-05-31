/**
 * config/index.js
 * Module config trung tâm — load YAML tối giản rồi patch từ SQLite.
 * Tất cả file trong bot import từ đây thay vì tự load config.yml.
 *
 * Dùng:
 *   const config = require('../config');   // từ events/
 *   const config = require('../../config'); // từ slashCommands/
 */
'use strict';

const fs   = require('fs');
const yaml = require('js-yaml');
const path = require('path');

// Load YAML tối giản (chỉ Token, GuildID, DatabasePath)
const raw = yaml.load(fs.readFileSync(path.join(__dirname, '../config.yml'), 'utf8'));

// Lazy-load db để tránh circular dependency khi db/index.js chưa sẵn sàng
function getDB() {
  return require('../db/config');
}

function gc(key, def) {
  try { return getDB().getConfig(key, def); }
  catch { return def; }
}

// ─── Build config object ──────────────────────────────────────────────────────
const config = {
  // Bắt buộc từ YAML
  Token:        raw.Token,
  GuildID:      raw.GuildID,
  DatabasePath: raw.DatabasePath || './data/bot.db',
};

// ─── Getter helpers — đọc từ SQLite mỗi lần gọi (luôn fresh) ─────────────────
Object.defineProperties(config, {
  EmbedColors: { get: () => gc('bot.embedColor', '#5e99ff'), enumerable: true },
  LogCommands: { get: () => gc('bot.logCommands', false),   enumerable: true },
  Statistics:  { get: () => gc('bot.statistics',  false),   enumerable: true },

  TicketSettings: { get: () => ({
    LogsChannelID:           gc('ticket.logsChannelID', ''),
    BlacklistedRoles:        gc('ticket.blacklistedRoles', []),
    MentionAuthor:           gc('ticket.mentionAuthor', false),
    MaxTickets:              gc('ticket.maxTickets', 1),
    DeleteTime:              gc('ticket.deleteTime', 5),
    RestrictTicketClose:     gc('ticket.restrictClose', false),
    TicketCooldown:          gc('ticket.cooldown', 0),
    SelectMenu:              gc('ticket.selectMenu', true),
    DeleteCommandTranscript: gc('ticket.deleteCommandTranscript', true),
    ChannelTopic:            gc('ticket.channelTopic', 'Người tạo: {username} | Danh mục: {category}'),
    TicketCloseReason:       gc('ticket.closeReason', false),
  }), enumerable: true },

  TicketTranscriptSettings: { get: () => ({
    TranscriptType:       gc('transcript.type', 'HTML'),
    SaveInFolder:         gc('transcript.saveInFolder', true),
    SaveImages:           gc('transcript.saveImages', false),
    MessagesRequirement:  gc('transcript.messagesRequirement', 1),
  }), enumerable: true },

  ClaimingSystem: { get: () => ({
    Enabled:           gc('claiming.enabled', true),
    MaxClaimsPerStaff: gc('claiming.maxPerStaff', 3),
    ExemptRoles:       gc('claiming.exemptRoles', []),
    LockNewTickets:    gc('claiming.lockNewTickets', true),
    UserPerms: {
      ViewChannel:  gc('claiming.userPerms.viewChannel',  true),
      SendMessages: gc('claiming.userPerms.sendMessages', false),
    },
    MoveClaimedTickets: {
      Enabled:    gc('claiming.moveEnabled', false),
      CategoryID: gc('claiming.moveCategoryID', ''),
    },
    AutoClaim: {
      Enabled:                gc('claiming.autoClaim.enabled', true),
      ShowMessage:            gc('claiming.autoClaim.showMessage', true),
      OverridePreviousClaims: gc('claiming.autoClaim.override', false),
      Message:                gc('claiming.autoClaim.message', 'Ticket này đã được tự động nhận bởi {user}'),
    },
  }), enumerable: true },

  TicketAlert: { get: () => ({
    Enabled:  gc('alert.enabled', true),
    Time:     gc('alert.time', '12h'),
    DMUser:   gc('alert.dmUser', false),
    Message:  gc('alert.message', '## ⏳ Cảnh báo Không Hoạt Động\nTicket này sẽ tự động đóng vào **{time}** nếu không có phản hồi.'),
    DMMessage:gc('alert.dmMessage', '## ⏳ Cảnh báo Không Hoạt Động\nTicket của bạn sẽ tự động đóng vào **{time}**.'),
    AutoAlert: {
      Enabled:      gc('alert.autoAlert.enabled', false),
      InactiveTime: gc('alert.autoAlert.inactiveTime', '3d'),
    },
  }), enumerable: true },

  WorkingHours: { get: () => ({
    Enabled:                          gc('workingHours.enabled', true),
    Timezone:                         gc('workingHours.timezone', 'Asia/Ho_Chi_Minh'),
    ExemptRoles:                      gc('workingHours.exemptRoles', []),
    Schedule:                         gc('workingHours.schedule', {}),
    AllowTicketsOutsideWorkingHours:  gc('workingHours.allowOutside', false),
    SendNoticeInTicket:               gc('workingHours.sendNotice', true),
    outsideWorkingHoursTitle:         'Ngoài Giờ Làm Việc',
    outsideWorkingHours:              'Bạn chỉ có thể tạo ticket trong giờ làm việc!',
    outsideWorkingHoursMsg:           'Bạn đã tạo ticket ngoài giờ làm việc.',
  }), enumerable: true },

  TicketOverload: { get: () => ({
    Enabled:        gc('overload.enabled', true),
    Threshold:      gc('overload.threshold', 20),
    WarningMessage: gc('overload.warningMessage', '## ⚠️ Lượng ticket cao!\nDo có nhiều ticket đang mở, thời gian phản hồi có thể lâu hơn bình thường.'),
  }), enumerable: true },

  ArchiveSystem: { get: () => ({
    Enabled:           gc('archive.enabled', false),
    HideFromCreator:   gc('archive.hideFromCreator', true),
    MoveToCategory:    gc('archive.moveToCategory', true),
    ArchiveCategoryID: gc('archive.categoryID', ''),
    ChannelNamePrefix: gc('archive.channelNamePrefix', 'archived-'),
  }), enumerable: true },

  PrioritySettings: { get: () => ({
    Enabled: gc('priority.enabled', false),
    Levels:  gc('priority.levels', []),
  }), enumerable: true },

  SuggestionSettings: { get: () => ({
    Enabled:       gc('suggestion.enabled', false),
    ChannelID:     gc('suggestion.channelID', ''),
    CreateThreads: gc('suggestion.createThreads', true),
    EnableAcceptDenySystem:          gc('suggestion.enableAcceptDeny', true),
    RemoveAllButtonsIfAcceptedOrDenied: gc('suggestion.removeButtonsOnDecision', true),
    AllowedRoles:  gc('suggestion.allowedRoles', []),
    LogsChannel:   gc('suggestion.logsChannel', ''),
  }), enumerable: true },

  SuggestionStatuses: { get: () => ({
    Pending:  '🟠 Pending',
    Accepted: '🟢 Accepted',
    Denied:   '🔴 Denied',
  }), enumerable: true },

  SuggestionStatusesEmbedColors: { get: () => ({
    Pending:  '#5e99ff',
    Accepted: '#2ECC71',
    Denied:   '#E74C3C',
  }), enumerable: true },

  TicketReviewSettings: { get: () => ({
    Enabled:      gc('review.enabled', true),
    AskWhyModal:  gc('review.askWhyModal', false),
    MinimumWords: gc('review.minimumWords', 20),
    MaximumWords: gc('review.maximumWords', 250),
    ReviewPrompt: '> Chúng tôi trân trọng phản hồi của bạn.\n> Vui lòng đánh giá từ **1-5** sao bên dưới.',
    ReviewMsg:    'Cảm ơn bạn đã để lại đánh giá!',
    ticketRated:  '> Bạn đã đánh giá ticket này: {star} ({rating}/5)',
    ticketReviewed: '> Bạn đã đánh giá ticket này: {star} ({rating}/5)\n> Nhận xét: {reviewMessage}',
  }), enumerable: true },

  TicketReviewRequirements: { get: () => ({
    Enabled:       gc('review.requirements.enabled', false),
    TotalMessages: gc('review.requirements.totalMessages', 5),
  }), enumerable: true },

  ReviewChannel: { get: () => ({
    Enabled:   gc('review.channel.enabled', false),
    ChannelID: gc('review.channel.channelID', ''),
  }), enumerable: true },

  Tags: { get: () => ({
    Enabled:              gc('tags.enabled', false),
    RestrictToSupportRoles: gc('tags.restrictToSupportRoles', true),
    OnlyInTickets:        gc('tags.onlyInTickets', false),
    TagsList:             gc('tags.list', {}),
  }), enumerable: true },

  ButtonColors: { get: () => ({
    closeTicket:   gc('buttons.colors.closeTicket',   'Danger'),
    ticketClaim:   gc('buttons.colors.ticketClaim',   'Success'),
    ticketUnclaim: gc('buttons.colors.ticketUnclaim', 'Secondary'),
    deleteTicket:  gc('buttons.colors.deleteTicket',  'Danger'),
    reopenTicket:  gc('buttons.colors.reopenTicket',  'Success'),
    transcriptTicket: gc('buttons.colors.transcriptTicket', 'Primary'),
  }), enumerable: true },

  ButtonEmojis: { get: () => ({
    closeTicket:   gc('buttons.emojis.closeTicket',   '🔒'),
    ticketClaim:   gc('buttons.emojis.ticketClaim',   '🎫'),
    ticketUnclaim: gc('buttons.emojis.ticketUnclaim', '↩️'),
    deleteTicket:  gc('buttons.emojis.deleteTicket',  '🗑️'),
    reopenTicket:  gc('buttons.emojis.reopenTicket',  '🔓'),
    transcriptTicket: gc('buttons.emojis.transcriptTicket', '📝'),
    ticketCreated: gc('buttons.emojis.ticketCreated', '🎫'),
  }), enumerable: true },

  StaffRoles: { get: () => gc('staffRoles', []), enumerable: true },

  AI: { get: () => ({
    Enabled:      gc('ai.enabled', false),
    OpenAIAPIKey: gc('ai.openaiKey', ''),
    Model:        gc('ai.model', 'gpt-3.5-turbo'),
  }), enumerable: true },

  AIAutoResponse: { get: () => ({
    Enabled: gc('ai.enabled', false),
  }), enumerable: true },

  TicketCategories: { get: () => {
    try {
      const Categories = require('../db/categories');
      const cats = Categories.findAll();
      const result = {};
      for (const cat of cats) {
        result[cat.categoryKey] = {
          CategoryName:        cat.categoryName,
          Description:         cat.description || '',
          ParentCategoryID:    cat.parentCategoryID,
          EmbedTitle:          cat.embedTitle   || `Ticket ${cat.categoryName}`,
          EmbedMessage:        cat.embedMessage || '> Cảm ơn bạn đã liên hệ.\n> Vui lòng mô tả vấn đề và chờ nhân viên hỗ trợ.',
          CategoryEmoji:       cat.categoryEmoji || '',
          ButtonColor:         cat.buttonColor  || 'Green',
          SupportRoles:        Array.isArray(cat.supportRoles) ? cat.supportRoles : [],
          MentionSupportRoles: cat.mentionSupportRoles || false,
          ChannelName:         cat.channelName  || 'ticket-{username}',
          LogsChannelID:       cat.logsChannelID || '',
          RequiredRoles:       Array.isArray(cat.requiredRoles) ? cat.requiredRoles : [],
          Questions:           Array.isArray(cat.questions) ? cat.questions : [],
        };
      }
      return result;
    } catch { return {}; }
  }, enumerable: true },

  TicketOpenEmbed: { get: () => ({
    EmbedColor:        gc('ticketOpenEmbed.color', ''),
    FooterMsg:         gc('ticketOpenEmbed.footerMsg', ''),
    FooterIcon:        gc('ticketOpenEmbed.footerIcon', ''),
    Timestamp:         gc('ticketOpenEmbed.timestamp', true),
    UserIconThumbnail: gc('ticketOpenEmbed.userIconThumbnail', true),
    UserIconAuthor:    gc('ticketOpenEmbed.userIconAuthor', true),
  }), enumerable: true },

  TicketQuestionFormatting: { get: () => ({
    QuestionStyle:     gc('ticket.questionFormatting.questionStyle', 'Bold'),
    QuestionPrefix:    gc('ticket.questionFormatting.prefix', '`❓`'),
    AnswerStyle:       gc('ticket.questionFormatting.answerStyle', 'CodeBlock'),
    NotAnsweredText:   gc('ticket.questionFormatting.notAnsweredText', 'Chưa trả lời'),
    DisplaySideBySide: gc('ticket.questionFormatting.displaySideBySide', false),
    UseSeparateEmbed:  false,
    SeparateEmbedTitle: '`📋` Câu hỏi Ticket',
    SeparateEmbedColor: '',
  }), enumerable: true },

  TicketUserCloseDM: { get: () => ({
    Enabled:          gc('closeDM.enabled', true),
    SendTranscript:   gc('closeDM.sendTranscript', true),
    TicketInformation:gc('closeDM.ticketInformation', true),
    ShowCloseReason:  gc('closeDM.showCloseReason', true),
    ShowClosedBy:     gc('closeDM.showClosedBy', true),
    ShowParticipants: gc('closeDM.showParticipants', true),
    CloseEmbedMsg:    gc('closeDM.message', '> Ticket của bạn đã được đóng trong ``{guildName}``'),
  }), enumerable: true },

  InactivityMonitor: { get: () => ({
    Enabled:             gc('inactivity.enabled', false),
    CheckInterval:       gc('inactivity.checkInterval', '1h'),
    UnrespondedDuration: gc('inactivity.unrespondedDuration', '24h'),
    LogChannel:          gc('inactivity.logChannel', ''),
    RolesToPing:         gc('inactivity.rolesToPing', []),
  }), enumerable: true },

  BotActivitySettings: { get: () => ({
    Enabled:      gc('activity.enabled', true),
    ActivityType: gc('activity.type', 'WATCHING'),
    Status:       gc('activity.status', 'ONLINE'),
    Interval:     gc('activity.interval', 30),
    Statuses:     gc('activity.statuses', ['{total-tickets} tickets']),
  }), enumerable: true },

  PayPalSettings: { get: () => ({
    Enabled:          gc('paypal.enabled', false),
    PayPalClientID:   gc('paypal.clientID', ''),
    PayPalSecretKey:  gc('paypal.secretKey', ''),
    Email:            gc('paypal.email', ''),
    Currency:         gc('paypal.currency', 'USD'),
    CurrencySymbol:   gc('paypal.currencySymbol', '$'),
    OnlyInTicketChannels: gc('paypal.onlyInTickets', false),
    LogsChannelID:    gc('paypal.logsChannelID', ''),
    AllowedRoles:     gc('paypal.allowedRoles', []),
    Description:      gc('paypal.description', ''),
    Logo:             gc('paypal.logo', ''),
    RoleToGive:       gc('paypal.roleToGive', ''),
    StatusUnpaid:     'UNPAID',
    StatusPaid:       'PAID',
  }), enumerable: true },

  StripeSettings: { get: () => ({
    Enabled:          gc('stripe.enabled', false),
    StripeSecretKey:  gc('stripe.secretKey', ''),
    Currency:         gc('stripe.currency', 'USD'),
    CurrencySymbol:   gc('stripe.currencySymbol', '$'),
    OnlyInTicketChannels: gc('stripe.onlyInTickets', false),
    LogsChannelID:    gc('stripe.logsChannelID', ''),
    AllowedRoles:     gc('stripe.allowedRoles', []),
    RoleToGive:       gc('stripe.roleToGive', ''),
    PaymentMethods:   gc('stripe.paymentMethods', ['card']),
    StatusUnpaid:     'UNPAID',
    StatusPaid:       'PAID',
  }), enumerable: true },

  CryptoSettings: { get: () => ({
    Enabled:          gc('crypto.enabled', false),
    Currency:         gc('crypto.currency', 'USD'),
    CurrencySymbol:   gc('crypto.currencySymbol', '$'),
    OnlyInTicketChannels: gc('crypto.onlyInTickets', false),
    LogsChannelID:    gc('crypto.logsChannelID', ''),
    AllowedRoles:     gc('crypto.allowedRoles', []),
  }), enumerable: true },

  CryptoAddresses: { get: () => gc('crypto.addresses', { BTC:'', ETH:'', USDT:'', LTC:'' }), enumerable: true },

  VietQRSettings: { get: () => ({
    Enabled:       gc('vietqr.enabled', false),
    BankId:        gc('vietqr.bankId', ''),
    AccountNo:     gc('vietqr.accountNo', ''),
    AccountName:   gc('vietqr.accountName', ''),
    Template:      gc('vietqr.template', 'compact'),
    OnlyInTicketChannels: gc('vietqr.onlyInTickets', false),
  }), enumerable: true },

  PriorityRoles: { get: () => ({
    Enabled: gc('priorityRoles.enabled', false),
    Roles:   gc('priorityRoles.roles', []),
  }), enumerable: true },

  // trustProxy cho dashboard
  trustProxy: { get: () => gc('dashboard.trustProxy', false), enumerable: true },
});

// ─── Locale — đọc từ lang/vi.json qua t() với fallback hardcoded ─────────────
const localeDefaults = {
  NoPermsMessage: 'Bạn không có quyền thực hiện hành động này!',
  NotInTicketChannel: 'Lệnh này chỉ có thể dùng trong kênh ticket!',
  notAllowedDelete: 'Bạn không có quyền xóa ticket này!',
  RoleBlacklistedTitle: 'Vai trò Bị Chặn',
  RoleBlacklistedMsg: 'Vai trò của bạn không được phép tạo ticket!',
  AlreadyOpenTitle: 'Đã Có Ticket Mở',
  AlreadyOpenMsg: 'Bạn chỉ được mở tối đa **{max} ticket** cùng lúc.',
  CloseTicketButton: 'Đóng Ticket',
  ticketCreatedTitle: 'Ticket Đã Tạo',
  deletingTicketMsg: 'Đang xóa ticket sau {time} giây...',
  ticketUserAdd: 'Đã thêm **{user}** vào ticket.',
  ticketUserRemove: 'Đã xóa **{user}** khỏi ticket.',
  ticketRenamed: 'Ticket đã được đổi tên thành **{newName}**!',
  userAddTitle: 'Nhật ký | Người Dùng Đã Thêm',
  userRemoveTitle: 'Nhật ký | Người Dùng Đã Xóa',
  ticketRenameTitle: 'Nhật ký | Ticket Đã Đổi Tên',
  logsExecutor: 'Người thực hiện',
  logsTicket: 'Ticket',
  logsUser: 'Người dùng',
  logsTicketAuthor: 'Người tạo ticket',
  logsDeletedBy: 'Xóa bởi',
  restrictTicketClose: 'Chỉ có nhân viên hỗ trợ mới có thể đóng ticket này!',
  ticketPinned: '📌 Ticket này đã được ghim!',
  ticketAlreadyPinned: 'Ticket này đã được ghim rồi!',
  cooldownEmbedMsgTitle: 'Vui lòng chờ!',
  cooldownEmbedMsg: 'Bạn phải chờ {time} trước khi tạo ticket mới!',
  selectCategory: 'Chọn một danh mục...',
  userBlacklistedTitle: 'Bị Chặn',
  userBlacklistedMsg: 'Bạn đã bị chặn và không thể tạo ticket!',
  requiredRoleTitle: 'Thiếu Vai Trò Yêu Cầu',
  requiredRoleMissing: 'Bạn cần có vai trò yêu cầu để tạo ticket trong danh mục này!',
  ticketClaimedBy: 'Nhận bởi:',
  ticketNotClaimed: 'Ticket này chưa được nhận.',
  ticketClaimed: 'Ticket này đã được nhận bởi {user}\nHọ sẽ hỗ trợ bạn ngay!',
  ticketUnClaimed: 'Ticket này đã được trả lại bởi {user}',
  ticketDidntClaim: 'Bạn chưa nhận ticket này!',
  claimTicketButton: 'Nhận Ticket',
  unclaimTicketButton: 'Trả Ticket',
  ticketClaimedTitle: 'Nhật ký | Ticket Đã Được Nhận',
  ticketUnClaimedTitle: 'Nhật ký | Ticket Đã Được Trả',
  ticketClaimedLog: 'đã nhận ticket',
  ticketUnClaimedLog: 'đã trả ticket',
  claimTicketMsg: 'Bạn đã nhận ticket này thành công!',
  unclaimTicketMsg: 'Bạn đã trả ticket này thành công!',
  restrictTicketClaim: 'Chỉ có nhân viên hỗ trợ mới có thể nhận ticket!',
  totalMessagesLog: 'Tổng tin nhắn:',
  totalTickets: 'Tổng Ticket:',
  openTickets: 'Ticket Đang Mở:',
  totalClaims: 'Tổng Lần Nhận:',
  guildStatistics: 'Thống kê Server',
  statsTickets: 'Ticket',
  alreadyBlacklisted: '{user} đã bị chặn rồi!',
  successfullyBlacklisted: '{user} đã bị chặn thành công!',
  notBlacklisted: '{user} chưa bị chặn!',
  successfullyUnblacklisted: '{user} đã được bỏ chặn thành công!',
  ticketForceDeleted: 'Ticket Đã Bị Xóa',
  ticketDetails: 'Chi tiết Ticket',
  ticketParticipants: 'Người tham gia',
  userDetails: 'Chi tiết Người Dùng',
  oldName: 'Tên cũ',
  newName: 'Tên mới',
  renameDetails: 'Chi tiết đổi tên',
  claimDetails: 'Chi tiết nhận ticket',
  unclaimDetails: 'Chi tiết trả ticket',
  transcriptTitle: '📝 Transcript Ticket',
  transcriptDescription: 'Transcript cho ticket **#{identifier}** đã được tạo.',
  transcriptFooter: 'Tạo bởi {user}',
  transcriptGenerationFailed: 'Không thể tạo transcript.',
  transcriptError: 'Đã xảy ra lỗi khi tạo transcript.',
  transcriptLogTitle: 'Nhật ký | Transcript Đã Tạo',
  transcriptDetails: 'Chi tiết Transcript',
  viewTranscriptButton: 'Xem Transcript',
  deleteTicketButton: 'Xóa',
  reOpenButton: 'Mở lại',
  transcriptButton: 'Transcript',
  notAllowedDelete: 'Bạn không được phép xóa ticket này!',
  ticketCategory: 'Danh mục',
  whyCloseTicket: 'Tại sao bạn đóng ticket này?',
  ticketCloseReasonTitle: 'Lý do đóng ticket',
  noCloseReason: 'Không có lý do.',
  averageCompletionTime: 'Thời gian hoàn thành TB:',
  averageResponseTime: 'Thời gian phản hồi TB:',
  averageRating: 'Đánh giá TB:',
  totalReviews: 'Tổng đánh giá:',
  ticketRating: 'Đánh giá Ticket',
  explainWhyRating: 'Vui lòng giải thích lý do đánh giá',
  ratingsStats: 'Đánh giá',
  ticketClosedCloseDM: '> Ticket của bạn đã được đóng trong ``{guildName}``',
  notClaimedCloseDM: 'Không có',
  ticketUnClaimedBy: 'Trả bởi:',
  ticketClaimedBy: 'Nhận bởi:',
  suggestionSubmit: 'Đề xuất của bạn đã được gửi, cảm ơn!',
  suggestionTitle: 'Đề xuất mới',
  newSuggestionTitle: '💡 Đề xuất mới',
  suggestionStatsTitle: 'Thống kê Đề xuất',
  suggestionsTotal: 'Tổng đề xuất:',
  suggestionsTotalUpvotes: 'Tổng lượt thích:',
  suggestionsTotalDownvotes: 'Tổng lượt không thích:',
  suggestionInformation: 'Thông tin đề xuất',
  suggestionUpvotes: 'Lượt thích:',
  suggestionDownvotes: 'Lượt không thích:',
  suggestionFrom: 'Từ:',
  suggestionStatus: 'Trạng thái:',
  suggestionVoteResetTitle: 'Đặt lại phiếu bầu',
  suggestionVoteReset: 'Phiếu bầu của bạn đã được đặt lại.',
  suggestionNoVoteTitle: 'Chưa bầu',
  suggestionNoVote: 'Bạn chưa bầu cho đề xuất này!',
  suggestionDownvotedTitle: 'Đã không thích',
  suggestionDownvoted: 'Bạn đã không thích đề xuất này.',
  suggestionAlreadyVotedTitle: 'Đã bầu rồi',
  suggestionAlreadyVoted: 'Bạn đã bầu cho đề xuất này rồi!',
  suggestionUpvotedTitle: 'Đã thích',
  suggestionUpvoted: 'Bạn đã thích đề xuất này.',
  suggestionAcceptedTitle: 'Đề xuất Được Chấp Nhận',
  suggestionAccepted: 'Đề xuất này đã được chấp nhận!',
  suggestionDeniedTitle: 'Đề xuất Bị Từ Chối',
  suggestionDenied: 'Đề xuất này đã bị từ chối.',
  suggestionNoPerms: 'Bạn không có quyền chấp nhận/từ chối đề xuất!',
  suggestionCantVoteTitle: 'Không thể bầu',
  suggestionCantVote: 'Bạn không thể bầu cho đề xuất của chính mình!',
};

config.Locale = localeDefaults;

module.exports = config;

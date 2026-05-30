/**
 * scripts/migrate-mongo-to-sqlite.js
 * Chuyển dữ liệu từ MongoDB sang SQLite một lần duy nhất.
 *
 * Cách dùng:
 *   MONGO_URI=mongodb+srv://... node scripts/migrate-mongo-to-sqlite.js
 *
 * Hoặc tạo file .env với MONGO_URI và chạy:
 *   node scripts/migrate-mongo-to-sqlite.js
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

// Khởi tạo SQLite (sẽ tạo bảng nếu chưa có)
const db = require('../db/index');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('[MIGRATE] Thiếu biến môi trường MONGO_URI!');
  console.error('  Dùng: MONGO_URI=mongodb+srv://... node scripts/migrate-mongo-to-sqlite.js');
  process.exit(1);
}

// ─── Mongoose Schemas (chỉ dùng cho migration) ──────────────────────────────

const ticketSchema = new mongoose.Schema({}, { strict: false });
const guildSchema  = new mongoose.Schema({}, { strict: false });
const staffSchema  = new mongoose.Schema({}, { strict: false });
const reviewSchema = new mongoose.Schema({}, { strict: false });
const blackSchema  = new mongoose.Schema({}, { strict: false });
const panelSchema  = new mongoose.Schema({}, { strict: false });
const suggestSchema= new mongoose.Schema({}, { strict: false });
const aiSchema     = new mongoose.Schema({}, { strict: false });
const paypalSchema = new mongoose.Schema({}, { strict: false });
const stripeSchema = new mongoose.Schema({}, { strict: false });
const giveawaySchema = new mongoose.Schema({}, { strict: false });
const stickySchema = new mongoose.Schema({}, { strict: false });

const TicketM   = mongoose.model('ticket',        ticketSchema);
const GuildM    = mongoose.model('guild',          guildSchema);
const StaffM    = mongoose.model('staffStats',     staffSchema);
const ReviewM   = mongoose.model('review',         reviewSchema);
const BlackM    = mongoose.model('blacklistedUser',blackSchema);
const PanelM    = mongoose.model('ticketPanel',    panelSchema);
const SuggestM  = mongoose.model('suggestion',     suggestSchema);
const AIM       = mongoose.model('AIAutoResponse', aiSchema);
const PaypalM   = mongoose.model('paypal',         paypalSchema);
const StripeM   = mongoose.model('stripe',         stripeSchema);
const GiveawayM = mongoose.model('Giveaway',       giveawaySchema);
const StickyM   = mongoose.model('StickyMessage',  stickySchema);

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeJSON(val) {
  if (val === undefined || val === null) return '[]';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function safeDate(val) {
  if (!val) return null;
  try { return new Date(val).toISOString(); }
  catch { return null; }
}

function bool(val) { return val ? 1 : 0; }

// ─── Migration functions ─────────────────────────────────────────────────────

async function migrateTickets() {
  const docs = await TicketM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Tickets: 0 bản ghi'); return; }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tickets
      (guildID, channelID, userID, ticketType, button, msgID, claimed, claimUser,
       messages, lastMessageSent, status, closeUserID, questions, participants,
       ticketCreationDate, closedAt, identifier, closeReason, closeNotificationTime,
       closeNotificationMsgID, closeNotificationUserID, transcriptID, priority,
       priorityName, waitingReplyFrom, firstStaffResponse, inactivityWarningSent,
       originalCategoryID, archived, archivedBy, archivedAt, archiveMsgID, aiSummary,
       createdAt, updatedAt)
    VALUES
      (@guildID, @channelID, @userID, @ticketType, @button, @msgID, @claimed, @claimUser,
       @messages, @lastMessageSent, @status, @closeUserID, @questions, @participants,
       @ticketCreationDate, @closedAt, @identifier, @closeReason, @closeNotificationTime,
       @closeNotificationMsgID, @closeNotificationUserID, @transcriptID, @priority,
       @priorityName, @waitingReplyFrom, @firstStaffResponse, @inactivityWarningSent,
       @originalCategoryID, @archived, @archivedBy, @archivedAt, @archiveMsgID, @aiSummary,
       @createdAt, @updatedAt)
  `);

  const run = db.transaction((rows) => {
    for (const t of rows) {
      insert.run({
        guildID:                 t.guildID                 || '',
        channelID:               t.channelID               || '',
        userID:                  t.userID                  || '',
        ticketType:              t.ticketType              || null,
        button:                  t.button                  || null,
        msgID:                   t.msgID                   || null,
        claimed:                 bool(t.claimed),
        claimUser:               t.claimUser               || null,
        messages:                t.messages                || 0,
        lastMessageSent:         safeDate(t.lastMessageSent),
        status:                  t.status                  || 'Open',
        closeUserID:             t.closeUserID             || null,
        questions:               safeJSON(t.questions),
        participants:            safeJSON(t.participants),
        ticketCreationDate:      safeDate(t.ticketCreationDate),
        closedAt:                safeDate(t.closedAt),
        identifier:              t.identifier              || null,
        closeReason:             t.closeReason             || 'Không có lý do.',
        closeNotificationTime:   t.closeNotificationTime   || 0,
        closeNotificationMsgID:  t.closeNotificationMsgID  || null,
        closeNotificationUserID: t.closeNotificationUserID || null,
        transcriptID:            t.transcriptID            || null,
        priority:                t.priority                || null,
        priorityName:            t.priorityName            || null,
        waitingReplyFrom:        t.waitingReplyFrom        || null,
        firstStaffResponse:      safeDate(t.firstStaffResponse),
        inactivityWarningSent:   bool(t.inactivityWarningSent),
        originalCategoryID:      t.originalCategoryID      || null,
        archived:                bool(t.archived),
        archivedBy:              t.archivedBy              || null,
        archivedAt:              t.archivedAt              || null,
        archiveMsgID:            t.archiveMsgID            || null,
        aiSummary:               t.aiSummary               || null,
        createdAt:               safeDate(t.createdAt)     || new Date().toISOString(),
        updatedAt:               safeDate(t.updatedAt)     || new Date().toISOString(),
      });
    }
  });

  run(docs);
  console.log(`[MIGRATE] Tickets: ${docs.length} bản ghi ✅`);
}

async function migrateGuild() {
  const docs = await GuildM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Guild stats: 0 bản ghi'); return; }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO guild_stats
      (guildID, totalTickets, openTickets, totalClaims, totalMessages,
       totalSuggestions, totalSuggestionUpvotes, totalSuggestionDownvotes,
       totalReviews, averageRating, timesBotStarted, averageCompletion, averageResponse, reviews)
    VALUES
      (@guildID, @totalTickets, @openTickets, @totalClaims, @totalMessages,
       @totalSuggestions, @totalSuggestionUpvotes, @totalSuggestionDownvotes,
       @totalReviews, @averageRating, @timesBotStarted, @averageCompletion, @averageResponse, @reviews)
  `);

  const run = db.transaction((rows) => {
    for (const g of rows) {
      insert.run({
        guildID:                  g.guildID || '',
        totalTickets:             g.totalTickets             || 0,
        openTickets:              g.openTickets              || 0,
        totalClaims:              g.totalClaims              || 0,
        totalMessages:            g.totalMessages            || 0,
        totalSuggestions:         g.totalSuggestions         || 0,
        totalSuggestionUpvotes:   g.totalSuggestionUpvotes   || 0,
        totalSuggestionDownvotes: g.totalSuggestionDownvotes || 0,
        totalReviews:             g.totalReviews             || 0,
        averageRating:            g.averageRating            || 0,
        timesBotStarted:          g.timesBotStarted          || 0,
        averageCompletion:        g.averageCompletion        || 'N/A',
        averageResponse:          g.averageResponse          || 'N/A',
        reviews:                  safeJSON(g.reviews),
      });
    }
  });

  run(docs);
  console.log(`[MIGRATE] Guild stats: ${docs.length} bản ghi ✅`);
}

async function migrateStaffStats() {
  const docs = await StaffM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Staff stats: 0 bản ghi'); return; }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO staff_stats
      (userID, username, avatarURL, totalMessages, totalClaims, totalClosedTickets,
       averageResponseTime, lastActive, totalRatings, totalRatingScore, averageRating,
       weekly, monthly, yearly, ticketsHistory)
    VALUES
      (@userID, @username, @avatarURL, @totalMessages, @totalClaims, @totalClosedTickets,
       @averageResponseTime, @lastActive, @totalRatings, @totalRatingScore, @averageRating,
       @weekly, @monthly, @yearly, @ticketsHistory)
  `);

  const run = db.transaction((rows) => {
    for (const s of rows) {
      insert.run({
        userID:              s.userID              || '',
        username:            s.username            || null,
        avatarURL:           s.avatarURL           || null,
        totalMessages:       s.totalMessages       || 0,
        totalClaims:         s.totalClaims         || 0,
        totalClosedTickets:  s.totalClosedTickets  || 0,
        averageResponseTime: s.averageResponseTime || 0,
        lastActive:          safeDate(s.lastActive),
        totalRatings:        s.totalRatings        || 0,
        totalRatingScore:    s.totalRatingScore    || 0,
        averageRating:       s.averageRating       || 0,
        weekly:              safeJSON(s.weekly),
        monthly:             safeJSON(s.monthly),
        yearly:              safeJSON(s.yearly),
        ticketsHistory:      safeJSON(s.ticketsHistory),
      });
    }
  });

  run(docs);
  console.log(`[MIGRATE] Staff stats: ${docs.length} bản ghi ✅`);
}

async function migrateReviews() {
  const docs = await ReviewM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Reviews: 0 bản ghi'); return; }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO reviews
      (ticketCreatorID, guildID, ticketChannelID, userID, tCloseLogMsgID,
       tCloseLogChannelID, reviewDMUserMsgID, rating, reviewMessage, category,
       totalMessages, transcriptID, alreadyRated, createdAt, updatedAt)
    VALUES
      (@ticketCreatorID, @guildID, @ticketChannelID, @userID, @tCloseLogMsgID,
       @tCloseLogChannelID, @reviewDMUserMsgID, @rating, @reviewMessage, @category,
       @totalMessages, @transcriptID, @alreadyRated, @createdAt, @updatedAt)
  `);

  const run = db.transaction((rows) => {
    for (const r of rows) {
      insert.run({
        ticketCreatorID:    r.ticketCreatorID    || null,
        guildID:            r.guildID            || null,
        ticketChannelID:    r.ticketChannelID    || null,
        userID:             r.userID             || null,
        tCloseLogMsgID:     r.tCloseLogMsgID     || null,
        tCloseLogChannelID: r.tCloseLogChannelID || null,
        reviewDMUserMsgID:  r.reviewDMUserMsgID  || null,
        rating:             r.rating             || 0,
        reviewMessage:      r.reviewMessage      || null,
        category:           r.category           || null,
        totalMessages:      r.totalMessages      || 0,
        transcriptID:       r.transcriptID       || null,
        alreadyRated:       bool(r.alreadyRated),
        createdAt:          safeDate(r.createdAt) || new Date().toISOString(),
        updatedAt:          safeDate(r.updatedAt) || new Date().toISOString(),
      });
    }
  });

  run(docs);
  console.log(`[MIGRATE] Reviews: ${docs.length} bản ghi ✅`);
}

async function migrateBlacklist() {
  const docs = await BlackM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Blacklist: 0 bản ghi'); return; }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO blacklisted_users (userId, blacklisted) VALUES (?, ?)'
  );
  const run = db.transaction((rows) => {
    for (const b of rows) insert.run(b.userId || '', bool(b.blacklisted));
  });
  run(docs);
  console.log(`[MIGRATE] Blacklist: ${docs.length} bản ghi ✅`);
}

async function migratePanels() {
  const docs = await PanelM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Panels: 0 bản ghi'); return; }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO ticket_panels (guildID, panelId, msgID, selectMenuOptions)
    VALUES (?, ?, ?, ?)
  `);
  const run = db.transaction((rows) => {
    for (const p of rows) {
      insert.run(p.guildID || '', p.panelId || '', p.msgID || '', safeJSON(p.selectMenuOptions));
    }
  });
  run(docs);
  console.log(`[MIGRATE] Panels: ${docs.length} bản ghi ✅`);
}

async function migrateSuggestions() {
  const docs = await SuggestM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Suggestions: 0 bản ghi'); return; }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO suggestions (msgID, userID, suggestion, upVotes, downVotes, status, voters)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const run = db.transaction((rows) => {
    for (const s of rows) {
      insert.run(
        s.msgID || '', s.userID || '', s.suggestion || '',
        s.upVotes || 0, s.downVotes || 0, s.status || 'pending',
        safeJSON(s.voters)
      );
    }
  });
  run(docs);
  console.log(`[MIGRATE] Suggestions: ${docs.length} bản ghi ✅`);
}

async function migrateInvoices() {
  const paypalDocs = await PaypalM.find({}).lean();
  const stripeDocs = await StripeM.find({}).lean();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO invoices
      (type, invoiceID, userID, sellerID, channelID, messageID, customerID, price, service, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction((rows) => {
    for (const inv of rows) {
      insert.run(
        inv._type || 'paypal', inv.invoiceID || null, inv.userID || null,
        inv.sellerID || null, inv.channelID || null, inv.messageID || null,
        inv.customerID || null, inv.price || 0, inv.service || null,
        inv.status || 'UNPAID'
      );
    }
  });

  const combined = [
    ...paypalDocs.map(d => ({ ...d, _type: 'paypal' })),
    ...stripeDocs.map(d => ({ ...d, _type: 'stripe' })),
  ];
  run(combined);
  console.log(`[MIGRATE] Invoices: ${combined.length} bản ghi ✅`);
}

async function migrateGiveaways() {
  const docs = await GiveawayM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Giveaways: 0 bản ghi'); return; }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO giveaways
      (messageId, channelId, startedBy, prize, winners, endTime, entrants, status, minServerJoinDate, minJoinDurationMs)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const run = db.transaction((rows) => {
    for (const g of rows) {
      insert.run(
        g.messageId, g.channelId, g.startedBy, g.prize, g.winners, g.endTime,
        safeJSON(g.entrants), g.status || 'active',
        g.minServerJoinDate || null, g.minJoinDurationMs || 0
      );
    }
  });
  run(docs);
  console.log(`[MIGRATE] Giveaways: ${docs.length} bản ghi ✅`);
}

async function migrateSticky() {
  const docs = await StickyM.find({}).lean();
  if (!docs.length) { console.log('[MIGRATE] Sticky messages: 0 bản ghi'); return; }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO sticky_messages (channelId, message, msgCount) VALUES (?, ?, ?)'
  );
  const run = db.transaction((rows) => {
    for (const s of rows) insert.run(s.channelId, s.message, s.msgCount || 0);
  });
  run(docs);
  console.log(`[MIGRATE] Sticky messages: ${docs.length} bản ghi ✅`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[MIGRATE] Kết nối MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[MIGRATE] Đã kết nối MongoDB ✅');
  console.log('[MIGRATE] Bắt đầu migration...\n');

  await migrateTickets();
  await migrateGuild();
  await migrateStaffStats();
  await migrateReviews();
  await migrateBlacklist();
  await migratePanels();
  await migrateSuggestions();
  await migrateInvoices();
  await migrateGiveaways();
  await migrateSticky();

  console.log('\n[MIGRATE] ✅ Migration hoàn tất!');
  console.log(`[MIGRATE] Database SQLite: ${require('../db/index').name}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[MIGRATE] Lỗi:', err);
  process.exit(1);
});

/**
 * db/migrations.js
 * Tạo tất cả bảng SQLite nếu chưa tồn tại.
 * Chạy tự động khi db/index.js được require.
 */

'use strict';

/**
 * @param {import('better-sqlite3').Database} db
 */
module.exports = function runMigrations(db) {
  db.exec(`
    -- =====================================================
    -- TICKETS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS tickets (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      guildID                 TEXT NOT NULL,
      channelID               TEXT UNIQUE NOT NULL,
      userID                  TEXT NOT NULL,
      ticketType              TEXT,
      button                  TEXT,
      msgID                   TEXT,
      claimed                 INTEGER DEFAULT 0,
      claimUser               TEXT,
      messages                INTEGER DEFAULT 0,
      lastMessageSent         TEXT,
      status                  TEXT DEFAULT 'Open',
      closeUserID             TEXT,
      questions               TEXT DEFAULT '[]',
      participants            TEXT DEFAULT '[]',
      ticketCreationDate      TEXT,
      closedAt                TEXT,
      identifier              TEXT,
      closeReason             TEXT DEFAULT 'Không có lý do.',
      closeNotificationTime   INTEGER DEFAULT 0,
      closeNotificationMsgID  TEXT,
      closeNotificationUserID TEXT,
      transcriptID            TEXT,
      priority                TEXT,
      priorityName            TEXT,
      waitingReplyFrom        TEXT,
      firstStaffResponse      TEXT,
      inactivityWarningSent   INTEGER DEFAULT 0,
      priorityCooldown        TEXT,
      originalCategoryID      TEXT,
      archived                INTEGER DEFAULT 0,
      archivedBy              TEXT,
      archivedAt              INTEGER,
      archiveMsgID            TEXT,
      aiSummary               TEXT,
      createdAt               TEXT DEFAULT (datetime('now')),
      updatedAt               TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_guildID  ON tickets(guildID);
    CREATE INDEX IF NOT EXISTS idx_tickets_userID   ON tickets(userID);
    CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_channelID ON tickets(channelID);

    -- =====================================================
    -- GUILD STATS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS guild_stats (
      guildID                   TEXT PRIMARY KEY,
      totalTickets              INTEGER DEFAULT 0,
      openTickets               INTEGER DEFAULT 0,
      totalClaims               INTEGER DEFAULT 0,
      totalMessages             INTEGER DEFAULT 0,
      totalSuggestions          INTEGER DEFAULT 0,
      totalSuggestionUpvotes    INTEGER DEFAULT 0,
      totalSuggestionDownvotes  INTEGER DEFAULT 0,
      totalReviews              INTEGER DEFAULT 0,
      averageRating             REAL    DEFAULT 0,
      timesBotStarted           INTEGER DEFAULT 0,
      averageCompletion         TEXT    DEFAULT 'N/A',
      averageResponse           TEXT    DEFAULT 'N/A',
      reviews                   TEXT    DEFAULT '[]'
    );

    -- =====================================================
    -- STAFF STATS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS staff_stats (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      userID              TEXT UNIQUE NOT NULL,
      username            TEXT,
      avatarURL           TEXT,
      totalMessages       INTEGER DEFAULT 0,
      totalClaims         INTEGER DEFAULT 0,
      totalClosedTickets  INTEGER DEFAULT 0,
      averageResponseTime REAL    DEFAULT 0,
      lastActive          TEXT,
      totalRatings        INTEGER DEFAULT 0,
      totalRatingScore    REAL    DEFAULT 0,
      averageRating       REAL    DEFAULT 0,
      weekly              TEXT    DEFAULT '[]',
      monthly             TEXT    DEFAULT '[]',
      yearly              TEXT    DEFAULT '[]',
      ticketsHistory      TEXT    DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_staff_userID ON staff_stats(userID);

    -- =====================================================
    -- REVIEWS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS reviews (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      ticketCreatorID     TEXT,
      guildID             TEXT,
      ticketChannelID     TEXT,
      userID              TEXT,
      tCloseLogMsgID      TEXT,
      tCloseLogChannelID  TEXT,
      reviewDMUserMsgID   TEXT,
      rating              INTEGER,
      reviewMessage       TEXT,
      category            TEXT,
      totalMessages       INTEGER,
      transcriptID        TEXT,
      alreadyRated        INTEGER DEFAULT 0,
      createdAt           TEXT DEFAULT (datetime('now')),
      updatedAt           TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_guildID ON reviews(guildID);

    -- =====================================================
    -- BLACKLISTED USERS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS blacklisted_users (
      userId      TEXT PRIMARY KEY,
      blacklisted INTEGER DEFAULT 1,
      createdAt   TEXT DEFAULT (datetime('now')),
      updatedAt   TEXT DEFAULT (datetime('now'))
    );

    -- =====================================================
    -- TICKET PANELS (Discord message IDs)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS ticket_panels (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      guildID           TEXT NOT NULL,
      panelId           TEXT NOT NULL,
      msgID             TEXT NOT NULL,
      selectMenuOptions TEXT DEFAULT '[]',
      createdAt         TEXT DEFAULT (datetime('now')),
      updatedAt         TEXT DEFAULT (datetime('now')),
      UNIQUE(guildID, panelId)
    );

    -- =====================================================
    -- TICKET CATEGORIES (thay thế config.yml TicketCategories)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS ticket_categories (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      categoryKey         TEXT UNIQUE NOT NULL,
      categoryName        TEXT NOT NULL,
      description         TEXT    DEFAULT '',
      parentCategoryID    TEXT    NOT NULL,
      embedTitle          TEXT,
      embedMessage        TEXT,
      categoryEmoji       TEXT    DEFAULT '',
      buttonColor         TEXT    DEFAULT 'Green',
      supportRoles        TEXT    DEFAULT '[]',
      mentionSupportRoles INTEGER DEFAULT 0,
      channelName         TEXT    DEFAULT 'ticket-{username}',
      logsChannelID       TEXT    DEFAULT '',
      requiredRoles       TEXT    DEFAULT '[]',
      questions           TEXT    DEFAULT '[]',
      sortOrder           INTEGER DEFAULT 0,
      enabled             INTEGER DEFAULT 1
    );

    -- =====================================================
    -- GUILD CONFIG (config động, thay thế phần lớn config.yml)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS guild_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- =====================================================
    -- SUGGESTIONS
    -- =====================================================
    CREATE TABLE IF NOT EXISTS suggestions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      msgID      TEXT UNIQUE,
      userID     TEXT,
      suggestion TEXT,
      upVotes    INTEGER DEFAULT 0,
      downVotes  INTEGER DEFAULT 0,
      status     TEXT    DEFAULT 'pending',
      voters     TEXT    DEFAULT '[]'
    );

    -- =====================================================
    -- AI AUTO RESPONSES
    -- =====================================================
    CREATE TABLE IF NOT EXISTS ai_responses (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      messageId              TEXT UNIQUE NOT NULL,
      userId                 TEXT NOT NULL,
      channelId              TEXT NOT NULL,
      guildId                TEXT NOT NULL,
      userMessage            TEXT NOT NULL,
      responseKey            TEXT NOT NULL,
      aiConfidence           REAL NOT NULL,
      aiReasoning            TEXT,
      responseType           TEXT NOT NULL,
      responseMessage        TEXT NOT NULL,
      userFeedback           TEXT,
      feedbackTimestamp      TEXT,
      responseTimestamp      TEXT DEFAULT (datetime('now')),
      buttonInteractionCount INTEGER DEFAULT 0,
      month                  INTEGER NOT NULL,
      year                   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ai_userId    ON ai_responses(userId);
    CREATE INDEX IF NOT EXISTS idx_ai_monthYear ON ai_responses(month, year);

    -- =====================================================
    -- DASHBOARD (url/port tracking)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS dashboard (
      guildID TEXT PRIMARY KEY,
      url     TEXT,
      port    TEXT
    );

    -- =====================================================
    -- INVOICES (PayPal + Stripe hợp nhất)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS invoices (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL,
      invoiceID  TEXT,
      userID     TEXT,
      sellerID   TEXT,
      channelID  TEXT,
      messageID  TEXT,
      customerID TEXT,
      price      REAL,
      service    TEXT,
      currency   TEXT,
      status     TEXT DEFAULT 'UNPAID',
      invoiceURL TEXT,
      createdAt  TEXT DEFAULT (datetime('now')),
      updatedAt  TEXT DEFAULT (datetime('now'))
    );

    -- =====================================================
    -- GIVEAWAYS (addon)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS giveaways (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      messageId         TEXT UNIQUE NOT NULL,
      channelId         TEXT NOT NULL,
      startedBy         TEXT NOT NULL,
      prize             TEXT NOT NULL,
      winners           INTEGER NOT NULL,
      endTime           INTEGER NOT NULL,
      entrants          TEXT    DEFAULT '[]',
      status            TEXT    DEFAULT 'active',
      minServerJoinDate TEXT,
      minJoinDurationMs INTEGER DEFAULT 0
    );

    -- =====================================================
    -- STICKY MESSAGES (addon)
    -- =====================================================
    CREATE TABLE IF NOT EXISTS sticky_messages (
      channelId TEXT PRIMARY KEY,
      message   TEXT NOT NULL,
      msgCount  INTEGER DEFAULT 0
    );
  `);

  // ── Add new columns if they don't exist (safe ALTER TABLE) ──
  const addCol = (col, def) => {
    try { db.prepare(`ALTER TABLE ticket_categories ADD COLUMN ${col} ${def}`).run(); } catch (_) {}
  };
  addCol('embedThumbnailURL', "TEXT DEFAULT ''");
  addCol('embedImageURL',     "TEXT DEFAULT ''");
  addCol('embedFooterText',   "TEXT DEFAULT ''");
  addCol('embedFooterIconURL',"TEXT DEFAULT ''");
  addCol('dmOnClose',         "INTEGER DEFAULT 0");
  addCol('dmCloseMessage',    "TEXT DEFAULT ''");
};

/**
 * db/tickets.js
 * CRUD cho bảng tickets — thay thế ticketModel.js (Mongoose)
 */

'use strict';

const db = require('./index');

// ─── Helpers ────────────────────────────────────────────────────────────────

const JSON_FIELDS = ['questions', 'participants'];
const BOOL_FIELDS = ['claimed', 'archived', 'inactivityWarningSent'];

function serialize(data) {
  const out = { ...data };
  for (const f of JSON_FIELDS) {
    if (out[f] !== undefined) out[f] = JSON.stringify(out[f]);
  }
  return out;
}

function parse(row) {
  if (!row) return null;
  const out = { ...row };
  for (const f of JSON_FIELDS) {
    try { out[f] = JSON.parse(out[f] || '[]'); }
    catch { out[f] = []; }
  }
  for (const f of BOOL_FIELDS) {
    if (out[f] !== undefined) out[f] = Boolean(out[f]);
  }
  return out;
}

// ─── API ────────────────────────────────────────────────────────────────────

const Tickets = {

  /**
   * Tạo ticket mới.
   * @param {Object} data
   * @returns {Object} ticket vừa tạo
   */
  create(data) {
    const row = serialize({
      guildID:           data.guildID,
      channelID:         data.channelID,
      userID:            data.userID,
      ticketType:        data.ticketType   || null,
      button:            data.button       || null,
      msgID:             data.msgID        || null,
      claimed:           0,
      claimUser:         null,
      messages:          0,
      status:            'Open',
      questions:         data.questions    || [],
      participants:      data.participants || [],
      ticketCreationDate: new Date().toISOString(),
      identifier:        data.identifier  || null,
      closeReason:       'Không có lý do.',
    });

    db.prepare(`
      INSERT INTO tickets
        (guildID, channelID, userID, ticketType, button, msgID, claimed, claimUser,
         messages, status, questions, participants, ticketCreationDate, identifier, closeReason)
      VALUES
        (@guildID, @channelID, @userID, @ticketType, @button, @msgID, @claimed, @claimUser,
         @messages, @status, @questions, @participants, @ticketCreationDate, @identifier, @closeReason)
    `).run(row);

    return Tickets.findByChannelID(data.channelID);
  },

  /** @returns {Object|null} */
  findByChannelID(channelID) {
    return parse(db.prepare('SELECT * FROM tickets WHERE channelID = ?').get(channelID));
  },

  /** @returns {Object|null} */
  findByID(id) {
    return parse(db.prepare('SELECT * FROM tickets WHERE id = ?').get(id));
  },

  /** Tìm tất cả ticket đang mở của một user trong guild */
  findOpenByUserID(userID, guildID) {
    return db.prepare(
      "SELECT * FROM tickets WHERE userID = ? AND guildID = ? AND status = 'Open'"
    ).all(userID, guildID).map(parse);
  },

  /** Đếm ticket đang mở trong guild */
  countOpen(guildID) {
    return db.prepare(
      "SELECT COUNT(*) AS cnt FROM tickets WHERE guildID = ? AND status = 'Open'"
    ).get(guildID).cnt;
  },

  /** Tìm tất cả ticket đang mở (dùng cho auto-alert) */
  findAllOpen(guildID) {
    return db.prepare(
      "SELECT * FROM tickets WHERE guildID = ? AND status = 'Open'"
    ).all(guildID).map(parse);
  },

  /** Tìm ticket có closeNotificationTime > 0 (đang chờ tự động đóng) */
  findPendingClose(guildID) {
    return db.prepare(
      'SELECT * FROM tickets WHERE guildID = ? AND closeNotificationTime > 0'
    ).all(guildID).map(parse);
  },

  /**
   * Cập nhật ticket theo channelID.
   * @param {string} channelID
   * @param {Object} updates
   */
  updateByChannelID(channelID, updates) {
    if (!updates || Object.keys(updates).length === 0) return;
    const serialized = serialize(updates);
    // Chuyển boolean thành 0/1 cho SQLite
    for (const key of BOOL_FIELDS) {
      if (serialized[key] !== undefined) serialized[key] = serialized[key] ? 1 : 0;
    }
    const fields = Object.keys(serialized)
      .map(k => `${k} = @${k}`)
      .join(', ');
    db.prepare(
      `UPDATE tickets SET ${fields}, updatedAt = datetime('now') WHERE channelID = @channelID`
    ).run({ ...serialized, channelID });
  },

  /** Xóa ticket theo channelID */
  deleteByChannelID(channelID) {
    db.prepare('DELETE FROM tickets WHERE channelID = ?').run(channelID);
  },

  /** Tính thời gian phản hồi trung bình (ms) */
  avgResponseTime(guildID) {
    const rows = db.prepare(
      'SELECT ticketCreationDate, firstStaffResponse FROM tickets ' +
      'WHERE guildID = ? AND firstStaffResponse IS NOT NULL AND ticketCreationDate IS NOT NULL'
    ).all(guildID);

    if (!rows.length) return null;
    const total = rows.reduce((sum, r) => {
      return sum + (new Date(r.firstStaffResponse) - new Date(r.ticketCreationDate));
    }, 0);
    return total / rows.length;
  },

  /** Tính thời gian hoàn thành trung bình (ms) */
  avgCompletionTime(guildID) {
    const rows = db.prepare(
      'SELECT ticketCreationDate, closedAt FROM tickets ' +
      'WHERE guildID = ? AND closedAt IS NOT NULL AND ticketCreationDate IS NOT NULL'
    ).all(guildID);

    if (!rows.length) return null;
    const total = rows.reduce((sum, r) => {
      return sum + (new Date(r.closedAt) - new Date(r.ticketCreationDate));
    }, 0);
    return total / rows.length;
  },
};

module.exports = Tickets;

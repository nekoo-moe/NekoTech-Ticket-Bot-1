/**
 * db/staffStats.js
 * CRUD cho bảng staff_stats — thay thế staffStatsModel.js (Mongoose)
 * Giữ nguyên logic tính toán từ staffStats.js gốc.
 */

'use strict';

const db = require('./index');

const JSON_FIELDS = ['weekly', 'monthly', 'yearly', 'ticketsHistory'];

function parse(row) {
  if (!row) return null;
  const out = { ...row };
  for (const f of JSON_FIELDS) {
    try { out[f] = JSON.parse(out[f] || '[]'); }
    catch { out[f] = []; }
  }
  return out;
}

function serialize(data) {
  const out = { ...data };
  for (const f of JSON_FIELDS) {
    if (out[f] !== undefined) out[f] = JSON.stringify(out[f]);
  }
  return out;
}

// ─── Helpers thời gian (giữ nguyên từ staffStats.js gốc) ────────────────────

function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getWeekStartEnd(date) {
  const cur  = new Date(date);
  const day  = cur.getDay();
  const diff = cur.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(cur.setDate(diff));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthStartEnd(date) {
  const y = date.getFullYear(), m = date.getMonth();
  const start = new Date(y, m, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(y, m + 1, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getYearStartEnd(date) {
  const y = date.getFullYear();
  const start = new Date(y, 0, 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(y, 11, 31);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ─── API ────────────────────────────────────────────────────────────────────

const StaffStats = {

  findByUserID(userID) {
    return parse(db.prepare('SELECT * FROM staff_stats WHERE userID = ?').get(userID));
  },

  findAll() {
    return db.prepare('SELECT * FROM staff_stats').all().map(parse);
  },

  upsert(data) {
    const row = serialize(data);
    db.prepare(`
      INSERT INTO staff_stats
        (userID, username, avatarURL, totalMessages, totalClaims, totalClosedTickets,
         averageResponseTime, lastActive, totalRatings, totalRatingScore, averageRating,
         weekly, monthly, yearly, ticketsHistory)
      VALUES
        (@userID, @username, @avatarURL, @totalMessages, @totalClaims, @totalClosedTickets,
         @averageResponseTime, @lastActive, @totalRatings, @totalRatingScore, @averageRating,
         @weekly, @monthly, @yearly, @ticketsHistory)
      ON CONFLICT(userID) DO UPDATE SET
        username            = excluded.username,
        avatarURL           = excluded.avatarURL,
        totalMessages       = excluded.totalMessages,
        totalClaims         = excluded.totalClaims,
        totalClosedTickets  = excluded.totalClosedTickets,
        averageResponseTime = excluded.averageResponseTime,
        lastActive          = excluded.lastActive,
        totalRatings        = excluded.totalRatings,
        totalRatingScore    = excluded.totalRatingScore,
        averageRating       = excluded.averageRating,
        weekly              = excluded.weekly,
        monthly             = excluded.monthly,
        yearly              = excluded.yearly,
        ticketsHistory      = excluded.ticketsHistory
    `).run({
      userID:              row.userID,
      username:            row.username            || null,
      avatarURL:           row.avatarURL           || null,
      totalMessages:       row.totalMessages       || 0,
      totalClaims:         row.totalClaims         || 0,
      totalClosedTickets:  row.totalClosedTickets  || 0,
      averageResponseTime: row.averageResponseTime || 0,
      lastActive:          row.lastActive          || new Date().toISOString(),
      totalRatings:        row.totalRatings        || 0,
      totalRatingScore:    row.totalRatingScore    || 0,
      averageRating:       row.averageRating       || 0,
      weekly:              row.weekly              || '[]',
      monthly:             row.monthly             || '[]',
      yearly:              row.yearly              || '[]',
      ticketsHistory:      row.ticketsHistory      || '[]',
    });
    return StaffStats.findByUserID(row.userID);
  },

  /**
   * Lấy hoặc tạo mới staff member.
   * @param {Object} user - Discord user object { id, username, displayAvatarURL }
   */
  getOrCreate(user) {
    let staff = StaffStats.findByUserID(user.id);
    if (!staff) {
      staff = StaffStats.upsert({
        userID:    user.id,
        username:  user.username,
        avatarURL: typeof user.displayAvatarURL === 'function'
          ? user.displayAvatarURL({ dynamic: true })
          : (user.avatarURL || null),
        weekly:         [],
        monthly:        [],
        yearly:         [],
        ticketsHistory: [],
      });
    }
    return staff;
  },

  /**
   * Lấy hoặc tạo các period hiện tại (week/month/year) trong object staff.
   * Trả về { staff (đã cập nhật), currentWeek, currentMonth, currentYear }
   */
  getCurrentPeriods(staff) {
    const now        = new Date();
    const weekNumber = getISOWeek(now);
    const year       = now.getFullYear();
    const month      = now.getMonth();

    let currentWeek = staff.weekly.find(w => w.weekNumber === weekNumber && w.year === year);
    if (!currentWeek) {
      const { start, end } = getWeekStartEnd(now);
      currentWeek = { weekNumber, year, startDate: start, endDate: end,
        messages: 0, claims: 0, closedTickets: 0, responseTime: 0,
        ratings: 0, ratingScore: 0, averageRating: 0 };
      staff.weekly.push(currentWeek);
    }

    let currentMonth = staff.monthly.find(m => m.month === month && m.year === year);
    if (!currentMonth) {
      const { start, end } = getMonthStartEnd(now);
      currentMonth = { month, year, startDate: start, endDate: end,
        messages: 0, claims: 0, closedTickets: 0, responseTime: 0,
        ratings: 0, ratingScore: 0, averageRating: 0 };
      staff.monthly.push(currentMonth);
    }

    let currentYear = staff.yearly.find(y => y.year === year);
    if (!currentYear) {
      const { start, end } = getYearStartEnd(now);
      currentYear = { year, startDate: start, endDate: end,
        messages: 0, claims: 0, closedTickets: 0, responseTime: 0,
        ratings: 0, ratingScore: 0, averageRating: 0 };
      staff.yearly.push(currentYear);
    }

    return { staff, currentWeek, currentMonth, currentYear };
  },

  // Re-export helpers para uso externo
  getISOWeek,
  getWeekStartEnd,
  getMonthStartEnd,
  getYearStartEnd,
};

module.exports = StaffStats;

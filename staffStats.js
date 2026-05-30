/**
 * staffStats.js
 * Thay thế phiên bản Mongoose bằng SQLite (db/staffStats.js).
 * API giữ nguyên để không phá vỡ các file đang import.
 */

'use strict';

const StaffStatsDB = require('./db/staffStats');
const Tickets      = require('./db/tickets');

// ─── incrementStat ───────────────────────────────────────────────────────────

async function incrementStat(user, statType, value = 1, ticketData = null) {
  try {
    let staff = StaffStatsDB.getOrCreate(user);
    const { currentWeek, currentMonth, currentYear } = StaffStatsDB.getCurrentPeriods(staff);

    switch (statType) {
      case 'message':
        staff.totalMessages += value;
        currentWeek.messages  += value;
        currentMonth.messages += value;
        currentYear.messages  += value;

        if (ticketData?.ticketID) {
          const idx = staff.ticketsHistory.findIndex(t => t.ticketID === ticketData.ticketID);
          if (idx !== -1) {
            staff.ticketsHistory[idx].messageCount += value;
          } else {
            staff.ticketsHistory.push({
              ticketID: ticketData.ticketID, claimedAt: new Date(),
              messageCount: value, responseTime: 0,
            });
          }
        }
        break;

      case 'claim':
        staff.totalClaims += value;
        currentWeek.claims  += value;
        currentMonth.claims += value;
        currentYear.claims  += value;

        if (ticketData?.ticketID) {
          const idx = staff.ticketsHistory.findIndex(t => t.ticketID === ticketData.ticketID);
          if (idx !== -1) {
            staff.ticketsHistory[idx].claimedAt = new Date();
          } else {
            staff.ticketsHistory.push({
              ticketID: ticketData.ticketID, claimedAt: new Date(),
              messageCount: 0, responseTime: 0,
            });
          }
        }
        break;

      case 'close':
        staff.totalClosedTickets += value;
        currentWeek.closedTickets  += value;
        currentMonth.closedTickets += value;
        currentYear.closedTickets  += value;

        if (ticketData?.ticketID) {
          const idx = staff.ticketsHistory.findIndex(t => t.ticketID === ticketData.ticketID);
          if (idx !== -1) staff.ticketsHistory[idx].closedAt = new Date();
        }
        break;

      case 'responseTime': {
        const rtVal = parseInt(value);
        if (isNaN(rtVal) || rtVal <= 0) break;

        if (ticketData?.ticketID) {
          const idx = staff.ticketsHistory.findIndex(t => t.ticketID === ticketData.ticketID);
          if (idx !== -1) {
            staff.ticketsHistory[idx].responseTime = rtVal;
          } else {
            staff.ticketsHistory.push({
              ticketID: ticketData.ticketID, claimedAt: new Date(),
              messageCount: 0, responseTime: rtVal,
            });
          }

          // Tính lại averageResponseTime
          const withRT = staff.ticketsHistory.filter(t => t.responseTime > 0);
          if (withRT.length > 0) {
            staff.averageResponseTime = Math.floor(
              withRT.reduce((s, t) => s + t.responseTime, 0) / withRT.length
            );
          }

          // Tính lại cho week/month/year
          const calcPeriodRT = (periodStart, periodEnd) => {
            const pts = withRT.filter(t => {
              const d = new Date(t.claimedAt);
              return d >= new Date(periodStart) && d <= new Date(periodEnd);
            });
            if (!pts.length) return 0;
            return Math.floor(pts.reduce((s, t) => s + t.responseTime, 0) / pts.length);
          };

          currentWeek.responseTime  = calcPeriodRT(currentWeek.startDate,  currentWeek.endDate);
          currentMonth.responseTime = calcPeriodRT(currentMonth.startDate, currentMonth.endDate);
          currentYear.responseTime  = calcPeriodRT(currentYear.startDate,  currentYear.endDate);
        }
        break;
      }
    }

    staff.lastActive = new Date().toISOString();
    StaffStatsDB.upsert(staff);
    return staff;
  } catch (err) {
    console.error(`[staffStats] Lỗi incrementStat (${statType}):`, err);
    throw err;
  }
}

// ─── getStaffMemberStats ─────────────────────────────────────────────────────

async function getStaffMemberStats(userID) {
  try {
    const staff = StaffStatsDB.findByUserID(userID);
    if (!staff) return null;

    const now        = new Date();
    const weekNumber = StaffStatsDB.getISOWeek(now);
    const year       = now.getFullYear();
    const month      = now.getMonth();

    return {
      userID:             staff.userID,
      username:           staff.username,
      avatarURL:          staff.avatarURL,
      totalMessages:      staff.totalMessages,
      totalClaims:        staff.totalClaims,
      totalClosedTickets: staff.totalClosedTickets,
      averageResponseTime:staff.averageResponseTime,
      lastActive:         staff.lastActive,
      currentWeek:  staff.weekly.find(w => w.weekNumber === weekNumber && w.year === year) || null,
      currentMonth: staff.monthly.find(m => m.month === month && m.year === year)         || null,
      currentYear:  staff.yearly.find(y => y.year === year)                               || null,
    };
  } catch (err) {
    console.error('[staffStats] Lỗi getStaffMemberStats:', err);
    throw err;
  }
}

// ─── getStaffStats ───────────────────────────────────────────────────────────

async function getStaffStats(timeframe = 'lifetime', sortBy = 'claims') {
  try {
    const allStaff = StaffStatsDB.findAll();
    if (!allStaff.length) return [];

    const now          = new Date();
    const currentYear  = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentWeek  = StaffStatsDB.getISOWeek(now);

    const processed = allStaff.map(staff => ({
      userID:             staff.userID,
      username:           staff.username,
      avatarURL:          staff.avatarURL,
      totalMessages:      staff.totalMessages,
      totalClaims:        staff.totalClaims,
      totalClosedTickets: staff.totalClosedTickets,
      averageResponseTime:staff.averageResponseTime,
      lastActive:         staff.lastActive,
      currentWeek:  staff.weekly.find(w => w.weekNumber === currentWeek && w.year === currentYear) || null,
      currentMonth: staff.monthly.find(m => m.month === currentMonth && m.year === currentYear)    || null,
      currentYear:  staff.yearly.find(y => y.year === currentYear)                                 || null,
    }));

    const getValue = (s) => {
      const period = timeframe === 'weekly'  ? s.currentWeek
                   : timeframe === 'monthly' ? s.currentMonth
                   : timeframe === 'yearly'  ? s.currentYear
                   : null;

      if (timeframe !== 'lifetime' && !period) return 0;

      if (timeframe === 'lifetime') {
        return sortBy === 'messages'      ? s.totalMessages
             : sortBy === 'claims'        ? s.totalClaims
             : sortBy === 'responseTime'  ? s.averageResponseTime
             : s.totalClosedTickets;
      }
      return sortBy === 'messages'     ? period.messages
           : sortBy === 'claims'       ? period.claims
           : sortBy === 'responseTime' ? period.responseTime
           : period.closedTickets;
    };

    return processed.sort((a, b) => {
      const av = getValue(a), bv = getValue(b);
      if (sortBy === 'responseTime') {
        if (av === 0) return 1;
        if (bv === 0) return -1;
        return av - bv;
      }
      return bv - av;
    });
  } catch (err) {
    console.error('[staffStats] Lỗi getStaffStats:', err);
    throw err;
  }
}

// ─── trackRating ─────────────────────────────────────────────────────────────

async function trackRating(ticketId, rating) {
  try {
    const ticketData = Tickets.findByChannelID(ticketId);
    if (!ticketData || !ticketData.claimed || !ticketData.claimUser) return null;

    let staff = StaffStatsDB.findByUserID(ticketData.claimUser);
    if (!staff) return null;

    const { currentWeek, currentMonth, currentYear } = StaffStatsDB.getCurrentPeriods(staff);

    staff.totalRatings     = (staff.totalRatings     || 0) + 1;
    staff.totalRatingScore = (staff.totalRatingScore || 0) + rating;
    staff.averageRating    = staff.totalRatingScore / staff.totalRatings;

    currentWeek.ratings      = (currentWeek.ratings      || 0) + 1;
    currentWeek.ratingScore  = (currentWeek.ratingScore  || 0) + rating;
    currentWeek.averageRating = currentWeek.ratingScore / currentWeek.ratings;

    currentMonth.ratings      = (currentMonth.ratings      || 0) + 1;
    currentMonth.ratingScore  = (currentMonth.ratingScore  || 0) + rating;
    currentMonth.averageRating = currentMonth.ratingScore / currentMonth.ratings;

    currentYear.ratings      = (currentYear.ratings      || 0) + 1;
    currentYear.ratingScore  = (currentYear.ratingScore  || 0) + rating;
    currentYear.averageRating = currentYear.ratingScore / currentYear.ratings;

    const idx = staff.ticketsHistory.findIndex(t => t.ticketID === ticketId);
    if (idx !== -1) {
      staff.ticketsHistory[idx].rating = rating;
    } else {
      staff.ticketsHistory.push({
        ticketID: ticketId, claimedAt: new Date(),
        closedAt: ticketData.closedAt ? new Date(ticketData.closedAt) : null,
        messageCount: 0, responseTime: 0, rating,
      });
    }

    return StaffStatsDB.upsert(staff);
  } catch (err) {
    console.error('[staffStats] Lỗi trackRating:', err);
    return null;
  }
}

module.exports = {
  incrementStat,
  getStaffStats,
  getStaffMemberStats,
  trackRating,
  // Re-export helpers
  getCurrentTimePeriods: (staff) => StaffStatsDB.getCurrentPeriods(staff),
  getISOWeek:    StaffStatsDB.getISOWeek,
  getWeekStartEnd:  StaffStatsDB.getWeekStartEnd,
  getMonthStartEnd: StaffStatsDB.getMonthStartEnd,
  getYearStartEnd:  StaffStatsDB.getYearStartEnd,
};

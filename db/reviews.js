/**
 * db/reviews.js — thay thế reviewsModel.js
 */
'use strict';
const db = require('./index');

const Reviews = {
  create(data) {
    db.prepare(`
      INSERT INTO reviews
        (ticketCreatorID, guildID, ticketChannelID, userID, tCloseLogMsgID,
         tCloseLogChannelID, reviewDMUserMsgID, rating, reviewMessage, category,
         totalMessages, transcriptID, alreadyRated)
      VALUES
        (@ticketCreatorID, @guildID, @ticketChannelID, @userID, @tCloseLogMsgID,
         @tCloseLogChannelID, @reviewDMUserMsgID, @rating, @reviewMessage, @category,
         @totalMessages, @transcriptID, @alreadyRated)
    `).run({
      ticketCreatorID:    data.ticketCreatorID    || null,
      guildID:            data.guildID            || null,
      ticketChannelID:    data.ticketChannelID    || null,
      userID:             data.userID             || null,
      tCloseLogMsgID:     data.tCloseLogMsgID     || null,
      tCloseLogChannelID: data.tCloseLogChannelID || null,
      reviewDMUserMsgID:  data.reviewDMUserMsgID  || null,
      rating:             data.rating             || 0,
      reviewMessage:      data.reviewMessage      || null,
      category:           data.category           || null,
      totalMessages:      data.totalMessages      || 0,
      transcriptID:       data.transcriptID       || null,
      alreadyRated:       data.alreadyRated ? 1 : 0,
    });
  },

  findByChannelID(channelID) {
    return db.prepare('SELECT * FROM reviews WHERE ticketChannelID = ?').get(channelID);
  },

  findAllByGuild(guildID) {
    return db.prepare('SELECT * FROM reviews WHERE guildID = ? ORDER BY createdAt DESC').all(guildID);
  },

  markRated(channelID) {
    db.prepare("UPDATE reviews SET alreadyRated = 1, updatedAt = datetime('now') WHERE ticketChannelID = ?")
      .run(channelID);
  },

  countByGuild(guildID) {
    return db.prepare('SELECT COUNT(*) AS cnt FROM reviews WHERE guildID = ?').get(guildID).cnt;
  },

  averageRating(guildID) {
    const row = db.prepare(
      'SELECT AVG(rating) AS avg FROM reviews WHERE guildID = ? AND rating > 0'
    ).get(guildID);
    return row && row.avg ? parseFloat(row.avg.toFixed(1)) : 0.0;
  },
};

module.exports = Reviews;

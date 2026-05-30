/**
 * db/guild.js
 * CRUD cho bảng guild_stats — thay thế guildModel.js (Mongoose)
 */

'use strict';

const db = require('./index');

const Guild = {

  /**
   * Lấy hoặc tạo mới guild stats.
   * @param {string} guildID
   * @returns {Object}
   */
  getOrCreate(guildID) {
    let row = db.prepare('SELECT * FROM guild_stats WHERE guildID = ?').get(guildID);
    if (!row) {
      db.prepare(`
        INSERT OR IGNORE INTO guild_stats (guildID) VALUES (?)
      `).run(guildID);
      row = db.prepare('SELECT * FROM guild_stats WHERE guildID = ?').get(guildID);
    }
    return Guild._parse(row);
  },

  /**
   * Cập nhật một hoặc nhiều field.
   * @param {string} guildID
   * @param {Object} updates
   */
  update(guildID, updates) {
    if (!updates || Object.keys(updates).length === 0) return;
    const serialized = { ...updates };
    if (serialized.reviews !== undefined) {
      serialized.reviews = JSON.stringify(serialized.reviews);
    }
    const fields = Object.keys(serialized).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE guild_stats SET ${fields} WHERE guildID = @guildID`)
      .run({ ...serialized, guildID });
  },

  /** Incrementa um campo numérico de forma atômica */
  increment(guildID, field, amount = 1) {
    db.prepare(`UPDATE guild_stats SET ${field} = ${field} + ? WHERE guildID = ?`)
      .run(amount, guildID);
  },

  /** Sincroniza openTickets com a contagem real */
  syncOpenTickets(guildID) {
    const count = db.prepare(
      "SELECT COUNT(*) AS cnt FROM tickets WHERE guildID = ? AND status = 'Open'"
    ).get(guildID).cnt;
    db.prepare('UPDATE guild_stats SET openTickets = ? WHERE guildID = ?')
      .run(count, guildID);
    return count;
  },

  _parse(row) {
    if (!row) return null;
    let reviews = [];
    try { reviews = JSON.parse(row.reviews || '[]'); } catch { reviews = []; }
    return { ...row, reviews };
  },
};

module.exports = Guild;

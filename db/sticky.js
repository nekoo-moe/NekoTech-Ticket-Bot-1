/**
 * db/sticky.js — thay thế StickyModel.js (addon StickyMessages)
 */
'use strict';
const db = require('./index');

const Sticky = {
  upsert(channelId, message) {
    db.prepare(`
      INSERT INTO sticky_messages (channelId, message, msgCount)
      VALUES (?, ?, 0)
      ON CONFLICT(channelId) DO UPDATE SET message = excluded.message, msgCount = 0
    `).run(channelId, message);
  },

  find(channelId) {
    return db.prepare('SELECT * FROM sticky_messages WHERE channelId = ?').get(channelId);
  },

  incrementCount(channelId) {
    db.prepare('UPDATE sticky_messages SET msgCount = msgCount + 1 WHERE channelId = ?').run(channelId);
  },

  resetCount(channelId) {
    db.prepare('UPDATE sticky_messages SET msgCount = 0 WHERE channelId = ?').run(channelId);
  },

  delete(channelId) {
    db.prepare('DELETE FROM sticky_messages WHERE channelId = ?').run(channelId);
  },
};

module.exports = Sticky;

/**
 * db/blacklist.js — thay thế blacklistedUsersModel.js
 */
'use strict';
const db = require('./index');

const Blacklist = {
  isBlacklisted(userId) {
    const row = db.prepare(
      'SELECT blacklisted FROM blacklisted_users WHERE userId = ?'
    ).get(userId);
    return row ? Boolean(row.blacklisted) : false;
  },

  add(userId) {
    db.prepare(
      'INSERT INTO blacklisted_users (userId, blacklisted) VALUES (?, 1) ' +
      'ON CONFLICT(userId) DO UPDATE SET blacklisted = 1, updatedAt = datetime(\'now\')'
    ).run(userId);
  },

  remove(userId) {
    db.prepare(
      "UPDATE blacklisted_users SET blacklisted = 0, updatedAt = datetime('now') WHERE userId = ?"
    ).run(userId);
  },

  findAll() {
    return db.prepare('SELECT * FROM blacklisted_users WHERE blacklisted = 1').all();
  },
};

module.exports = Blacklist;

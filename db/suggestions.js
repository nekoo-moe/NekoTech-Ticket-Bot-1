/**
 * db/suggestions.js — thay thế suggestionModel.js
 */
'use strict';
const db = require('./index');

function parse(row) {
  if (!row) return null;
  try { row.voters = JSON.parse(row.voters || '[]'); }
  catch { row.voters = []; }
  return row;
}

const Suggestions = {
  create(data) {
    db.prepare(`
      INSERT INTO suggestions (msgID, userID, suggestion, upVotes, downVotes, status, voters)
      VALUES (@msgID, @userID, @suggestion, 0, 0, 'pending', '[]')
    `).run({ msgID: data.msgID, userID: data.userID, suggestion: data.suggestion });
    return Suggestions.findByMsgID(data.msgID);
  },

  findByMsgID(msgID) {
    return parse(db.prepare('SELECT * FROM suggestions WHERE msgID = ?').get(msgID));
  },

  update(msgID, updates) {
    const row = { ...updates };
    if (row.voters !== undefined) row.voters = JSON.stringify(row.voters);
    const fields = Object.keys(row).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE suggestions SET ${fields} WHERE msgID = @msgID`).run({ ...row, msgID });
  },

  countAll() {
    return db.prepare('SELECT COUNT(*) AS cnt FROM suggestions').get().cnt;
  },

  totalUpvotes() {
    return db.prepare('SELECT SUM(upVotes) AS total FROM suggestions').get().total || 0;
  },

  totalDownvotes() {
    return db.prepare('SELECT SUM(downVotes) AS total FROM suggestions').get().total || 0;
  },
};

module.exports = Suggestions;

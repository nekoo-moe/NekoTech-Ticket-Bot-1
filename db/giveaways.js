/**
 * db/giveaways.js — thay thế GiveawayModel.js (addon Giveaways)
 */
'use strict';
const db = require('./index');

function parse(row) {
  if (!row) return null;
  try { row.entrants = JSON.parse(row.entrants || '[]'); }
  catch { row.entrants = []; }
  return row;
}

const Giveaways = {
  create(data) {
    db.prepare(`
      INSERT INTO giveaways
        (messageId, channelId, startedBy, prize, winners, endTime,
         entrants, status, minServerJoinDate, minJoinDurationMs)
      VALUES
        (@messageId, @channelId, @startedBy, @prize, @winners, @endTime,
         @entrants, @status, @minServerJoinDate, @minJoinDurationMs)
    `).run({
      messageId:         data.messageId,
      channelId:         data.channelId,
      startedBy:         data.startedBy,
      prize:             data.prize,
      winners:           data.winners,
      endTime:           data.endTime,
      entrants:          JSON.stringify(data.entrants || []),
      status:            data.status            || 'active',
      minServerJoinDate: data.minServerJoinDate || null,
      minJoinDurationMs: data.minJoinDurationMs || 0,
    });
    return Giveaways.findByMessageID(data.messageId);
  },

  findByMessageID(messageId) {
    return parse(db.prepare('SELECT * FROM giveaways WHERE messageId = ?').get(messageId));
  },

  findActive() {
    return db.prepare("SELECT * FROM giveaways WHERE status = 'active'").all().map(parse);
  },

  update(messageId, updates) {
    const row = { ...updates };
    if (row.entrants !== undefined) row.entrants = JSON.stringify(row.entrants);
    const fields = Object.keys(row).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE giveaways SET ${fields} WHERE messageId = @messageId`).run({ ...row, messageId });
  },

  delete(messageId) {
    db.prepare('DELETE FROM giveaways WHERE messageId = ?').run(messageId);
  },
};

module.exports = Giveaways;

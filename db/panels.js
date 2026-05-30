/**
 * db/panels.js — thay thế ticketPanelModel.js
 */
'use strict';
const db = require('./index');

const Panels = {
  upsert(guildID, panelId, msgID, selectMenuOptions = []) {
    db.prepare(`
      INSERT INTO ticket_panels (guildID, panelId, msgID, selectMenuOptions)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guildID, panelId) DO UPDATE SET
        msgID             = excluded.msgID,
        selectMenuOptions = excluded.selectMenuOptions,
        updatedAt         = datetime('now')
    `).run(guildID, panelId, msgID, JSON.stringify(selectMenuOptions));
  },

  find(guildID, panelId) {
    const row = db.prepare(
      'SELECT * FROM ticket_panels WHERE guildID = ? AND panelId = ?'
    ).get(guildID, panelId);
    if (!row) return null;
    try { row.selectMenuOptions = JSON.parse(row.selectMenuOptions || '[]'); }
    catch { row.selectMenuOptions = []; }
    return row;
  },

  findAll(guildID) {
    return db.prepare('SELECT * FROM ticket_panels WHERE guildID = ?').all(guildID).map(row => {
      try { row.selectMenuOptions = JSON.parse(row.selectMenuOptions || '[]'); }
      catch { row.selectMenuOptions = []; }
      return row;
    });
  },

  delete(guildID, panelId) {
    db.prepare('DELETE FROM ticket_panels WHERE guildID = ? AND panelId = ?').run(guildID, panelId);
  },
};

module.exports = Panels;

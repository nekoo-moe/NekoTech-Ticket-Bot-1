// GiveawayModel.js — đã chuyển sang SQLite
// Dùng db/giveaways.js cho tất cả runtime operations
const SQLiteGiveaways = require('../../db/giveaways');

module.exports = SQLiteGiveaways;
module.exports.SQLite = SQLiteGiveaways;

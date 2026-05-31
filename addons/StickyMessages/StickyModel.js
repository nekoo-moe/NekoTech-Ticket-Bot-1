// StickyModel.js — đã chuyển sang SQLite
// Dùng db/sticky.js cho tất cả runtime operations
const SQLiteSticky = require('../../db/sticky');

module.exports = SQLiteSticky;
module.exports.SQLite = SQLiteSticky;
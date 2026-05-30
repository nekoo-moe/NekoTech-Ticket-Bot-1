const mongoose = require('mongoose');

// Giữ lại để tương thích với migration script
const stickyMessageSchema = new mongoose.Schema({
    channelId: { type: String, required: true, unique: true },
    message: { type: String, required: true },
    msgCount: { type: Number, default: 0 },
  });

let mongoModel = null;
try { mongoModel = mongoose.model('StickyMessage', stickyMessageSchema); } catch (_) {}

module.exports = mongoModel;
module.exports.SQLite = require('../../db/sticky');
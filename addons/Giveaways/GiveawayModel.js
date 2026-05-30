const mongoose = require('mongoose');

// Giữ lại để tương thích với migration script
// Trong runtime, dùng db/giveaways.js thay thế
const GiveawaySchema = new mongoose.Schema({
  messageId: { type: String, required: true },
  channelId: { type: String, required: true },
  startedBy: { type: String, required: true },
  prize: { type: String, required: true }, 
  winners: { type: Number, required: true },
  endTime: { type: Number, required: true },
  entrants: { type: [String], default: [] },
  status: { type: String, enum: ['active', 'ended'], default: 'active' },
  minServerJoinDate: { type: String, default: null },
  minJoinDurationMs: { type: Number, default: 0 },
});

// Export cả Mongoose model (cho migration) lẫn SQLite module (cho runtime)
let mongoModel = null;
try { mongoModel = mongoose.model('Giveaway', GiveawaySchema); } catch (_) {}

module.exports = mongoModel;
module.exports.SQLite = require('../../db/giveaways');

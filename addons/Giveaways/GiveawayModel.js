const mongoose = require('mongoose');

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

module.exports = mongoose.model('Giveaway', GiveawaySchema);

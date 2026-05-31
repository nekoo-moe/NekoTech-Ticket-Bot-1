const fs = require('fs');
const yaml = require("js-yaml");
const Suggestions = require("../db/suggestions");

module.exports = async (client, message) => {
  // Nếu tin nhắn bị xóa là suggestion, xóa khỏi DB
  const suggestion = Suggestions.findByMsgID(message.id);
  if (suggestion) {
    const db = require('../db/index');
    db.prepare('DELETE FROM suggestions WHERE msgID = ?').run(message.id);
  }
};

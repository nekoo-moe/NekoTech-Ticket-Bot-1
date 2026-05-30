/**
 * db/aiResponses.js — thay thế aiAutoResponseModel.js
 */
'use strict';
const db = require('./index');

const AIResponses = {
  create(data) {
    const now = new Date();
    db.prepare(`
      INSERT INTO ai_responses
        (messageId, userId, channelId, guildId, userMessage, responseKey, aiConfidence,
         aiReasoning, responseType, responseMessage, userFeedback, feedbackTimestamp,
         responseTimestamp, buttonInteractionCount, month, year)
      VALUES
        (@messageId, @userId, @channelId, @guildId, @userMessage, @responseKey, @aiConfidence,
         @aiReasoning, @responseType, @responseMessage, @userFeedback, @feedbackTimestamp,
         @responseTimestamp, @buttonInteractionCount, @month, @year)
    `).run({
      messageId:              data.messageId,
      userId:                 data.userId,
      channelId:              data.channelId,
      guildId:                data.guildId,
      userMessage:            data.userMessage,
      responseKey:            data.responseKey,
      aiConfidence:           data.aiConfidence,
      aiReasoning:            data.aiReasoning            || null,
      responseType:           data.responseType,
      responseMessage:        data.responseMessage,
      userFeedback:           data.userFeedback            || null,
      feedbackTimestamp:      data.feedbackTimestamp       || null,
      responseTimestamp:      data.responseTimestamp       || now.toISOString(),
      buttonInteractionCount: data.buttonInteractionCount  || 0,
      month:                  data.month                   || (now.getMonth() + 1),
      year:                   data.year                    || now.getFullYear(),
    });
  },

  findByMessageID(messageId) {
    return db.prepare('SELECT * FROM ai_responses WHERE messageId = ?').get(messageId);
  },

  updateFeedback(messageId, feedback) {
    db.prepare(
      "UPDATE ai_responses SET userFeedback = ?, feedbackTimestamp = datetime('now') WHERE messageId = ?"
    ).run(feedback, messageId);
  },

  getAnalytics(month, year) {
    return db.prepare(
      'SELECT responseKey, COUNT(*) AS total, ' +
      "SUM(CASE WHEN userFeedback = 'helpful' THEN 1 ELSE 0 END) AS helpful, " +
      "SUM(CASE WHEN userFeedback = 'not_helpful' THEN 1 ELSE 0 END) AS notHelpful, " +
      'AVG(aiConfidence) AS avgConfidence ' +
      'FROM ai_responses WHERE month = ? AND year = ? GROUP BY responseKey'
    ).all(month, year);
  },
};

module.exports = AIResponses;

/**
 * db/categories.js
 * CRUD cho ticket_categories — thay thế TicketCategories trong config.yml
 */
'use strict';
const db = require('./index');

const JSON_FIELDS = ['supportRoles', 'requiredRoles', 'questions'];

function parse(row) {
  if (!row) return null;
  const out = { ...row };
  for (const f of JSON_FIELDS) {
    try { out[f] = JSON.parse(out[f] || '[]'); }
    catch { out[f] = []; }
  }
  out.mentionSupportRoles = Boolean(out.mentionSupportRoles);
  out.enabled             = Boolean(out.enabled);
  return out;
}

function serialize(data) {
  const out = { ...data };
  for (const f of JSON_FIELDS) {
    if (out[f] !== undefined) out[f] = JSON.stringify(out[f]);
  }
  if (out.mentionSupportRoles !== undefined) out.mentionSupportRoles = out.mentionSupportRoles ? 1 : 0;
  if (out.enabled !== undefined)             out.enabled             = out.enabled ? 1 : 0;
  return out;
}

const Categories = {

  findAll() {
    return db.prepare('SELECT * FROM ticket_categories WHERE enabled = 1 ORDER BY sortOrder ASC').all().map(parse);
  },

  findByKey(categoryKey) {
    return parse(db.prepare('SELECT * FROM ticket_categories WHERE categoryKey = ?').get(categoryKey));
  },

  findByID(id) {
    return parse(db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(id));
  },

  create(data) {
    const row = serialize(data);
    db.prepare(`
      INSERT INTO ticket_categories
        (categoryKey, categoryName, description, parentCategoryID, embedTitle, embedMessage,
         categoryEmoji, buttonColor, supportRoles, mentionSupportRoles, channelName,
         logsChannelID, requiredRoles, questions, sortOrder, enabled)
      VALUES
        (@categoryKey, @categoryName, @description, @parentCategoryID, @embedTitle, @embedMessage,
         @categoryEmoji, @buttonColor, @supportRoles, @mentionSupportRoles, @channelName,
         @logsChannelID, @requiredRoles, @questions, @sortOrder, @enabled)
    `).run({
      categoryKey:         row.categoryKey,
      categoryName:        row.categoryName,
      description:         row.description         || '',
      parentCategoryID:    row.parentCategoryID,
      embedTitle:          row.embedTitle           || null,
      embedMessage:        row.embedMessage         || null,
      categoryEmoji:       row.categoryEmoji        || '',
      buttonColor:         row.buttonColor          || 'Green',
      supportRoles:        row.supportRoles         || '[]',
      mentionSupportRoles: row.mentionSupportRoles  || 0,
      channelName:         row.channelName          || 'ticket-{username}',
      logsChannelID:       row.logsChannelID        || '',
      requiredRoles:       row.requiredRoles        || '[]',
      questions:           row.questions            || '[]',
      sortOrder:           row.sortOrder            || 0,
      enabled:             row.enabled !== undefined ? row.enabled : 1,
    });
    return Categories.findByKey(data.categoryKey);
  },

  update(categoryKey, updates) {
    if (!updates || Object.keys(updates).length === 0) return;
    const row    = serialize(updates);
    const fields = Object.keys(row).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE ticket_categories SET ${fields} WHERE categoryKey = @categoryKey`)
      .run({ ...row, categoryKey });
  },

  delete(categoryKey) {
    db.prepare('DELETE FROM ticket_categories WHERE categoryKey = ?').run(categoryKey);
  },

  /**
   * Seed từ config.yml TicketCategories (chạy một lần khi migrate).
   * @param {Object} configCategories - config.TicketCategories
   */
  seedFromConfig(configCategories) {
    if (!configCategories) return;
    const insert = db.transaction((entries) => {
      for (const [key, cat] of entries) {
        const existing = Categories.findByKey(key);
        if (!existing) {
          Categories.create({
            categoryKey:         key,
            categoryName:        cat.CategoryName,
            description:         cat.Description         || '',
            parentCategoryID:    cat.ParentCategoryID,
            embedTitle:          cat.EmbedTitle,
            embedMessage:        cat.EmbedMessage,
            categoryEmoji:       cat.CategoryEmoji        || '',
            buttonColor:         cat.ButtonColor          || 'Green',
            supportRoles:        cat.SupportRoles         || [],
            mentionSupportRoles: cat.MentionSupportRoles  || false,
            channelName:         cat.ChannelName          || 'ticket-{username}',
            logsChannelID:       cat.LogsChannelID        || '',
            requiredRoles:       cat.RequiredRoles        || [],
            questions:           cat.Questions            || [],
            sortOrder:           0,
            enabled:             true,
          });
        }
      }
    });
    insert(Object.entries(configCategories));
  },
};

module.exports = Categories;

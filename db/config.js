/**
 * db/config.js
 * Lưu và đọc cấu hình bot động từ SQLite.
 * Thay thế việc phải sửa config.yml cho các cài đặt runtime.
 *
 * Dùng:
 *   const { getConfig, setConfig } = require('./db/config');
 *   getConfig('ticket.maxTickets', 1)
 *   setConfig('ticket.maxTickets', 3)
 */

'use strict';

const db = require('./index');

/**
 * Đọc một giá trị config từ database.
 * @param {string} key          - ví dụ: 'ticket.maxTickets'
 * @param {*}      defaultValue - giá trị mặc định nếu key chưa tồn tại
 * @returns {*}
 */
function getConfig(key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM guild_config WHERE key = ?').get(key);
  if (!row) return defaultValue;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

/**
 * Lưu một giá trị config vào database (upsert).
 * @param {string} key
 * @param {*}      value - sẽ được JSON.stringify
 */
function setConfig(key, value) {
  const json = JSON.stringify(value);
  db.prepare(
    'INSERT INTO guild_config (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, json);
}

/**
 * Lấy toàn bộ config dưới dạng object phẳng.
 * @returns {Record<string, *>}
 */
function getAllConfig() {
  const rows   = db.prepare('SELECT key, value FROM guild_config').all();
  const result = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result;
}

/**
 * Xóa một key config.
 * @param {string} key
 */
function deleteConfig(key) {
  db.prepare('DELETE FROM guild_config WHERE key = ?').run(key);
}

/**
 * Seed các giá trị mặc định nếu chưa tồn tại.
 * Gọi một lần khi bot khởi động.
 * @param {Object} defaults - object phẳng { key: value }
 */
function seedDefaults(defaults) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO guild_config (key, value) VALUES (?, ?)'
  );
  const seedAll = db.transaction((entries) => {
    for (const [key, value] of entries) {
      insert.run(key, JSON.stringify(value));
    }
  });
  seedAll(Object.entries(defaults));
}

module.exports = { getConfig, setConfig, getAllConfig, deleteConfig, seedDefaults };

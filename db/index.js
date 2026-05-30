/**
 * db/index.js
 * Khởi tạo kết nối SQLite duy nhất cho toàn bộ ứng dụng.
 * Dùng: const db = require('./db');
 */

'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const yaml     = require('js-yaml');

// Đọc config tối giản để lấy đường dẫn database
let dbPath = './data/bot.db';
try {
  const cfg = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
  if (cfg && cfg.DatabasePath) dbPath = cfg.DatabasePath;
} catch (_) {
  // config.yml chưa có hoặc lỗi → dùng đường dẫn mặc định
}

// Đảm bảo thư mục tồn tại
fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

let db;
try {
  db = new Database(path.resolve(dbPath));
} catch (err) {
  console.error(`[DB] Không thể mở database tại "${dbPath}":`, err.message);
  process.exit(1);
}

// Tối ưu hiệu năng
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// Chạy migrations (tạo bảng nếu chưa có)
require('./migrations')(db);

module.exports = db;

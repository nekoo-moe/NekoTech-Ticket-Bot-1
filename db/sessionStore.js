/**
 * db/sessionStore.js
 * Session store dùng better-sqlite3 (không cần native sqlite3 package).
 * Tương thích với express-session.
 */

'use strict';

const db = require('./index');

// Tạo bảng sessions nếu chưa có
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid     TEXT PRIMARY KEY,
    sess    TEXT NOT NULL,
    expired INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
`);

const cleanupInterval = 15 * 60 * 1000; // dọn dẹp mỗi 15 phút

/**
 * Tạo SQLite session store cho express-session.
 * @param {Object} session - express-session module
 * @returns {class} SQLiteSessionStore
 */
function createStore(session) {
  const Store = session.Store;

  class SQLiteSessionStore extends Store {
    constructor(options = {}) {
      super(options);
      this.ttl = options.ttl || 86400; // giây, mặc định 1 ngày

      // Dọn dẹp sessions hết hạn định kỳ
      setInterval(() => {
        db.prepare('DELETE FROM sessions WHERE expired < ?').run(Date.now());
      }, cleanupInterval).unref();
    }

    get(sid, callback) {
      try {
        const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired > ?')
          .get(sid, Date.now());
        if (!row) return callback(null, null);
        callback(null, JSON.parse(row.sess));
      } catch (err) {
        callback(err);
      }
    }

    set(sid, session, callback) {
      try {
        const maxAge  = session.cookie?.maxAge || this.ttl * 1000;
        const expired = Date.now() + maxAge;
        const sess    = JSON.stringify(session);
        db.prepare(`
          INSERT INTO sessions (sid, sess, expired) VALUES (?, ?, ?)
          ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired = excluded.expired
        `).run(sid, sess, expired);
        callback(null);
      } catch (err) {
        callback(err);
      }
    }

    destroy(sid, callback) {
      try {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        callback(null);
      } catch (err) {
        callback(err);
      }
    }

    touch(sid, session, callback) {
      try {
        const maxAge  = session.cookie?.maxAge || this.ttl * 1000;
        const expired = Date.now() + maxAge;
        db.prepare('UPDATE sessions SET expired = ? WHERE sid = ?').run(expired, sid);
        callback(null);
      } catch (err) {
        callback(err);
      }
    }

    length(callback) {
      try {
        const count = db.prepare('SELECT COUNT(*) AS cnt FROM sessions WHERE expired > ?')
          .get(Date.now()).cnt;
        callback(null, count);
      } catch (err) {
        callback(err);
      }
    }

    clear(callback) {
      try {
        db.prepare('DELETE FROM sessions').run();
        callback(null);
      } catch (err) {
        callback(err);
      }
    }
  }

  return SQLiteSessionStore;
}

module.exports = createStore;

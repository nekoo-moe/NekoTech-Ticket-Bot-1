/**
 * Hệ thống i18n đơn giản cho Heiznerd-TK2
 * Dùng: const { t } = require('./lang');
 *       t('ticket.close.button')          → "Đóng Ticket"
 *       t('ticket.cooldown.msg', { time: '5s' }) → "...5s..."
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let translations = {};
let currentLang  = 'vi';

/**
 * Load file ngôn ngữ vào bộ nhớ.
 * @param {string} langCode - mã ngôn ngữ, mặc định 'vi'
 */
function loadLang(langCode = 'vi') {
  const filePath = path.join(__dirname, `${langCode}.json`);
  if (!fs.existsSync(filePath)) {
    console.error(`[i18n] Không tìm thấy file ngôn ngữ: ${filePath}`);
    return;
  }
  try {
    translations = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    currentLang  = langCode;
  } catch (err) {
    console.error(`[i18n] Lỗi parse file ngôn ngữ ${langCode}:`, err.message);
  }
}

/**
 * Tra cứu chuỗi theo key phân cấp (dot notation) và thay thế biến.
 * @param {string} key   - ví dụ: 'ticket.close.button'
 * @param {Object} vars  - ví dụ: { time: '5', user: 'Nam' }
 * @returns {string}     - chuỗi tiếng Việt, fallback về key nếu không tìm thấy
 */
function t(key, vars = {}) {
  const parts = key.split('.');
  let value   = translations;

  for (const part of parts) {
    if (value == null || typeof value !== 'object') {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[i18n] Thiếu key: "${key}"`);
      }
      return key;
    }
    value = value[part];
  }

  if (typeof value !== 'string') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[i18n] Key không phải string: "${key}"`);
    }
    return key;
  }

  // Thay thế {varName} bằng giá trị tương ứng
  return value.replace(/\{(\w[\w-]*)\}/g, (_, name) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`
  );
}

/**
 * Lấy toàn bộ object ngôn ngữ (dùng khi cần truyền vào EJS template).
 */
function getTranslations() {
  return translations;
}

// Load ngôn ngữ mặc định ngay khi require
loadLang('vi');

module.exports = { t, loadLang, getTranslations };

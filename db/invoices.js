/**
 * db/invoices.js — thay thế paypalInvoicesModel.js + stripeInvoicesModel.js
 */
'use strict';
const db = require('./index');

const Invoices = {
  create(data) {
    db.prepare(`
      INSERT INTO invoices
        (type, invoiceID, userID, sellerID, channelID, messageID, customerID,
         price, service, currency, status, invoiceURL)
      VALUES
        (@type, @invoiceID, @userID, @sellerID, @channelID, @messageID, @customerID,
         @price, @service, @currency, @status, @invoiceURL)
    `).run({
      type:       data.type       || 'paypal',
      invoiceID:  data.invoiceID  || null,
      userID:     data.userID     || null,
      sellerID:   data.sellerID   || null,
      channelID:  data.channelID  || null,
      messageID:  data.messageID  || null,
      customerID: data.customerID || null,
      price:      data.price      || 0,
      service:    data.service    || null,
      currency:   data.currency   || 'USD',
      status:     data.status     || 'UNPAID',
      invoiceURL: data.invoiceURL || null,
    });
  },

  findByInvoiceID(invoiceID) {
    return db.prepare('SELECT * FROM invoices WHERE invoiceID = ?').get(invoiceID);
  },

  findByChannelAndUser(channelID, userID) {
    return db.prepare(
      'SELECT * FROM invoices WHERE channelID = ? AND userID = ? ORDER BY createdAt DESC LIMIT 1'
    ).get(channelID, userID);
  },

  updateStatus(invoiceID, status) {
    db.prepare("UPDATE invoices SET status = ?, updatedAt = datetime('now') WHERE invoiceID = ?")
      .run(status, invoiceID);
  },
};

module.exports = Invoices;

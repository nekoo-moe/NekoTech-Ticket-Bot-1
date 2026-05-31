const fs = require('fs');
const yaml = require("js-yaml");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const Guild   = require("../db/guild");
const Tickets = require("../db/tickets");

module.exports = async (client, channel) => {
  const ticketDB = Tickets.findByChannelID(channel.id);
  if (!ticketDB) return;

  Tickets.updateByChannelID(channel.id, {
    status:   'Closed',
    closedAt: new Date().toISOString(),
  });

  Guild.syncOpenTickets(config.GuildID);
};

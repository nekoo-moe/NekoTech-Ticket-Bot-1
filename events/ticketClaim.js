const { Interaction } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const Guild  = require("../db/guild");
const { incrementStat } = require("../staffStats.js");

module.exports = async (client, interactionOrMessage) => {
    const user      = interactionOrMessage.user || interactionOrMessage.author;
    const channelID = interactionOrMessage.channel?.id;
    if (!user || !channelID) return;

    Guild.increment(config.GuildID, 'totalClaims');
    await incrementStat(user, 'claim', 1, { ticketID: channelID });
};
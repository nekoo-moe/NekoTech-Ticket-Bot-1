const { Interaction } = require("discord.js");
const config = require('../config');
const Guild  = require("../db/guild");
const { incrementStat } = require("../staffStats.js");

module.exports = async (client, interactionOrMessage) => {
    const user      = interactionOrMessage.user || interactionOrMessage.author;
    const channelID = interactionOrMessage.channel?.id;
    if (!user || !channelID) return;

    Guild.increment(config.GuildID, 'totalClaims');
    await incrementStat(user, 'claim', 1, { ticketID: channelID });
};